// Server-only RAG service. It is used by the SSE route and the non-streaming
// server-function compatibility wrapper; browser code never imports provider keys.

import { GoogleGenerativeAI } from '@google/generative-ai'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { getVectorStore, type SearchResult, type VectorRecord } from './vector-store'
import {
  assessRetrievalRelevance,
  checkClaimGrounding,
  relevanceResultFromRetrieval,
  runInputGuardrails,
  runOutputGuardrails,
  type GuardrailResult,
} from './guardrails'
import {
  QueryInputSchema,
  classifyError,
  getCircuitBreaker,
  getResponseCache,
  withRetry,
  withTimeout,
  type RAGResponse,
  type SourceCitation,
} from './harness'

export type RAGStreamEvent =
  | { type: 'sentence'; text: string }
  | { type: 'complete'; response: RAGResponse }
  | { type: 'error'; message: string }

interface StreamInput {
  query: string
  language?: 'hi' | 'en' | 'hinglish' | 'auto'
  maxResults?: number
}

let geminiClient: GoogleGenerativeAI | null = null
let storeLoaded = false

const NO_KNOWLEDGE_EN = "I don't have enough information in my knowledge base to answer that reliably."
const NO_KNOWLEDGE_HI = 'मेरे ज्ञान आधार में इस प्रश्न का विश्वसनीय उत्तर देने के लिए पर्याप्त जानकारी नहीं है।'
const NO_KNOWLEDGE_HINGLISH = 'Mere knowledge base mein is sawal ka reliable jawab dene ke liye kaafi information nahi hai.'

const SYSTEM_PROMPT = `You are a multilingual voice knowledge-base assistant.
Use only the retrieved sources to answer the question directly, factually, and concisely.
Answer in 1 to 2 clear sentences in the user's dominant language (English, Hindi, or Hinglish).
Do NOT use markdown, bolding (**), bullet points (*), headers (#), or lists — output plain spoken sentences only.
If the retrieved sources do not contain sufficient information to answer the question, say: "I don't have enough information in my knowledge base to answer that reliably." (or in Hindi if the question is in Hindi).`

function getGemini(): GoogleGenerativeAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('Gemini service is not configured')
    geminiClient = new GoogleGenerativeAI(apiKey)
  }
  return geminiClient
}

import embeddingsData from '../../data/embeddings.json'

function ensureStoreLoaded(): void {
  const store = getVectorStore()
  if (storeLoaded && store.size > 0) return
  store.load(embeddingsData as VectorRecord[])
  storeLoaded = true
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Operation aborted')
}

function responseLanguage(query: string, requested: StreamInput['language']): 'en' | 'hi' | 'hinglish' {
  if (requested && requested !== 'auto') return requested
  if (/[\u0900-\u097F]/.test(query)) return 'hi'
  const hinglishMarkers = /\b(?:kya|kyu|kyon|ka|ki|ke|hai|hain|mein|main|kitne|batao|bataye|bharat|desh|sawal|jawab)\b/i
  return hinglishMarkers.test(query) ? 'hinglish' : 'en'
}

function noKnowledgeResponse(language: 'en' | 'hi' | 'hinglish'): string {
  return language === 'hi' ? NO_KNOWLEDGE_HI : language === 'hinglish' ? NO_KNOWLEDGE_HINGLISH : NO_KNOWLEDGE_EN
}

function splitCompletedSentences(buffer: string): { complete: string[]; remainder: string } {
  const sentences: string[] = []
  let lastBoundary = 0
  for (let index = 0; index < buffer.length; index++) {
    if (/[.!?।॥]/.test(buffer[index] ?? '') && /\s|$/.test(buffer[index + 1] ?? '')) {
      const sentence = buffer.slice(lastBoundary, index + 1).trim()
      if (sentence) sentences.push(sentence)
      lastBoundary = index + 1
    }
  }
  return { complete: sentences, remainder: buffer.slice(lastBoundary) }
}

function toSources(results: SearchResult[]): SourceCitation[] {
  return results.map(result => ({
    id: result.id,
    documentId: result.metadata.docId,
    source: result.metadata.source ?? `Knowledge-base document ${result.metadata.docId}`,
    position: result.metadata.position,
    text: result.text,
    score: Math.round(result.score * 1000) / 1000,
    strategy: result.metadata.strategy,
    language: result.metadata.language,
    retrievalMethod: result.retrievalMethod,
  }))
}

function buildContext(results: SearchResult[]): string {
  return results.map((result, index) => (
    `[Source ${index + 1} | Document: ${result.metadata.docId} | Chunk: ${result.id}]\n${result.text}`
  )).join('\n\n---\n\n')
}

function makeResponse(
  input: { query: string; response: string; sources: SourceCitation[]; inputChecks: GuardrailResult[]; outputChecks: GuardrailResult[] },
  timing: { embeddingMs: number; bm25Ms: number; vectorSearchMs: number; hybridRankingMs: number; retrievalMs: number; llmTtftMs: number; llmMs: number; guardrailsMs: number; totalMs: number },
  metadata: RAGResponse['metadata'],
): RAGResponse {
  return {
    query: input.query,
    response: input.response,
    sources: input.sources,
    timing,
    guardrails: { input: input.inputChecks, output: input.outputChecks },
    metadata,
  }
}

function noKnowledgeOutputCheck(response: string): GuardrailResult {
  return {
    name: 'Grounding Enforcement',
    passed: true,
    details: response.includes('enough information') || response.includes('पर्याप्त जानकारी') || response.includes('kaafi information')
      ? 'No factual answer was generated without sufficient retrieved evidence'
      : 'Provider failure response contains no knowledge-base claim',
    durationMs: 0,
    severity: 'low',
  }
}

async function* emitNoKnowledge(
  query: string,
  language: 'en' | 'hi' | 'hinglish',
  inputChecks: GuardrailResult[],
  totalStart: number,
  reason: string,
  retrievalTiming: Partial<ReturnType<typeof emptyRetrievalTiming>> = {},
): AsyncGenerator<RAGStreamEvent> {
  const response = noKnowledgeResponse(language)
  const outputChecks = [noKnowledgeOutputCheck(response)]
  const finalResponse = makeResponse(
    { query, response, sources: [], inputChecks, outputChecks },
    {
      ...emptyRetrievalTiming(),
      ...retrievalTiming,
      guardrailsMs: inputChecks.reduce((sum, check) => sum + check.durationMs, 0),
      totalMs: Math.round(performance.now() - totalStart),
    },
    {
      retryCount: 0,
      cacheHit: false,
      modelUsed: 'none',
      chunkingStrategy: 'none',
      totalChunksSearched: getVectorStore().size,
      retrievalMethod: reason,
      faithfulnessStatus: 'NOT_APPLICABLE',
    },
  )
  yield { type: 'sentence', text: response }
  yield { type: 'complete', response: finalResponse }
}

function emptyRetrievalTiming() {
  return {
    embeddingMs: 0,
    bm25Ms: 0,
    vectorSearchMs: 0,
    hybridRankingMs: 0,
    retrievalMs: 0,
    llmTtftMs: 0,
    llmMs: 0,
  }
}

/** Streams only sentence-level claims that have passed deterministic grounding. */
export async function* streamRAGQuery(input: StreamInput, signal?: AbortSignal): AsyncGenerator<RAGStreamEvent> {
  const totalStart = performance.now()
  const parsed = QueryInputSchema.safeParse({
    query: input.query,
    language: input.language ?? 'auto',
    maxResults: input.maxResults ?? 5,
  })
  if (!parsed.success) {
    yield { type: 'error', message: 'Please provide a valid question.' }
    return
  }

  const { query, maxResults } = parsed.data
  const language = responseLanguage(query, parsed.data.language)
  const inputStart = performance.now()
  const inputGuardrails = runInputGuardrails(query)
  const inputChecks = [...inputGuardrails.results]

  const toxicityFailed = inputChecks.some(check => check.name === 'Toxicity Filter' && !check.passed)
  if (toxicityFailed) {
    const response = 'I cannot help with that request.'
    const finalResponse = makeResponse(
      { query, response, sources: [], inputChecks, outputChecks: [noKnowledgeOutputCheck(response)] },
      { ...emptyRetrievalTiming(), guardrailsMs: Math.round(performance.now() - inputStart), totalMs: Math.round(performance.now() - totalStart) },
      { retryCount: 0, cacheHit: false, modelUsed: 'none', chunkingStrategy: 'none', totalChunksSearched: 0, retrievalMethod: 'blocked', faithfulnessStatus: 'NOT_APPLICABLE' },
    )
    yield { type: 'sentence', text: response }
    yield { type: 'complete', response: finalResponse }
    return
  }

  if (inputChecks.some(check => check.name === 'Relevance Check' && !check.passed)) {
    yield* emitNoKnowledge(query, language, inputChecks, totalStart, 'invalid_query')
    return
  }

  // PII is redacted before retrieval but a PII-containing request is intentionally not cached.
  const cleanQuery = inputGuardrails.cleanQuery
  const cache = getResponseCache()
  const cached = !inputChecks.some(check => check.name === 'PII Detection' && !check.passed) ? cache.get(cleanQuery) : null
  if (cached) {
    for (const sentence of splitCompletedSentences(cached.response).complete) yield { type: 'sentence', text: sentence }
    const remaining = splitCompletedSentences(cached.response).remainder.trim()
    if (remaining) yield { type: 'sentence', text: remaining }
    yield { type: 'complete', response: { ...cached, metadata: { ...cached.metadata, cacheHit: true } } }
    return
  }

  ensureStoreLoaded()
  const store = getVectorStore()
  if (store.size === 0) {
    yield* emitNoKnowledge(query, language, inputChecks, totalStart, 'empty_index')
    return
  }

  let queryEmbedding: number[] = []
  let embeddingMs = 0
  let retryCount = 0
  const embeddingStart = performance.now()
  try {
    const embedding = await withRetry(
      () => getCircuitBreaker().execute(() => withTimeout(async () => {
        throwIfAborted(signal)
        const model = getGemini().getGenerativeModel({ model: 'gemini-embedding-001' })
        const result = await model.embedContent(cleanQuery)
        throwIfAborted(signal)
        return result.embedding.values
      }, 8000, 'Query embedding', signal)),
      { maxAttempts: 2 },
      signal,
    )
    queryEmbedding = embedding.result
    retryCount = embedding.attempts - 1
  } catch (error) {
    if (classifyError(error) === 'aborted') throw error
  }
  embeddingMs = Math.round(performance.now() - embeddingStart)

  const retrievalStart = performance.now()
  let searchResults: SearchResult[] = []
  let retrievalMethod = 'bm25_only'
  let vectorSearchMs = 0
  let bm25Ms = 0
  let hybridRankingMs = 0
  if (queryEmbedding.length > 0) {
    const searched = store.hybridSearchWithTimings(queryEmbedding, cleanQuery, maxResults)
    searchResults = searched.results
    retrievalMethod = 'hybrid'
    vectorSearchMs = searched.timing.vectorSearchMs
    bm25Ms = searched.timing.bm25Ms
    hybridRankingMs = searched.timing.hybridRankingMs
    if (searchResults.length === 0) {
      const semanticStart = performance.now()
      searchResults = store.semanticSearch(queryEmbedding, maxResults)
      vectorSearchMs += Math.round(performance.now() - semanticStart)
      retrievalMethod = 'semantic_only'
    }
  } else {
    const bm25Start = performance.now()
    searchResults = store.bm25Search(cleanQuery, maxResults)
    bm25Ms = Math.round(performance.now() - bm25Start)
  }
  const retrievalMs = Math.round(performance.now() - retrievalStart)

  const topSemantic = searchResults.reduce((max, result) => Math.max(max, result.cosineScore), -1)
  const topBm25 = searchResults.reduce((max, result) => Math.max(max, result.bm25Score), 0)
  const configuredThreshold = Number(process.env.RELEVANCE_THRESHOLD ?? '0.35')
  const assessment = queryEmbedding.length > 0
    ? assessRetrievalRelevance(topSemantic, topBm25, Number.isFinite(configuredThreshold) ? configuredThreshold : 0.35)
    : { level: topBm25 > 0 ? 'RELEVANT' as const : 'IRRELEVANT' as const, semanticScore: -1, bm25Score: topBm25, threshold: 0 }
  inputChecks.push(relevanceResultFromRetrieval(assessment))

  if (assessment.level !== 'RELEVANT' || searchResults.length === 0) {
    yield* emitNoKnowledge(query, language, inputChecks, totalStart, assessment.level.toLowerCase(), {
      embeddingMs, bm25Ms, vectorSearchMs, hybridRankingMs, retrievalMs,
    })
    return
  }

  const sources = toSources(searchResults)
  const context = buildContext(searchResults)
  const prompt = `Retrieved context:\n${context}\n\nQuestion: ${cleanQuery}`
  const llmStart = performance.now()
  let llmTtftMs = 0
  let sentenceBuffer = ''
  let emittedAnswer = ''
  let groundingFailure: ReturnType<typeof checkClaimGrounding> | null = null
  let activeModelUsed = 'unavailable'

  const candidateModels = [
    process.env.GEMINI_MODEL,
    'gemini-3.5-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
  ].filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i)

  for (const candidateModel of candidateModels) {
    try {
      sentenceBuffer = ''
      emittedAnswer = ''
      groundingFailure = null

      const generation = await withRetry(
        () => getCircuitBreaker().execute(() => withTimeout(async () => {
          throwIfAborted(signal)
          const model = getGemini().getGenerativeModel({
            model: candidateModel,
            systemInstruction: SYSTEM_PROMPT,
            generationConfig: { temperature: 0.1, maxOutputTokens: 250 },
          })
          return model.generateContentStream(prompt)
        }, 12000, `LLM ${candidateModel} stream start`, signal)),
        { maxAttempts: 1 },
        signal,
      )

      for await (const chunk of generation.result.stream) {
        throwIfAborted(signal)
        const text = chunk.text()
        if (!text) continue
        if (llmTtftMs === 0) llmTtftMs = Math.round(performance.now() - llmStart)
        sentenceBuffer += text
        const extracted = splitCompletedSentences(sentenceBuffer)
        sentenceBuffer = extracted.remainder
        for (const sentence of extracted.complete) {
          const grounding = checkClaimGrounding(sentence, context)
          if (grounding.level !== 'SUPPORTED') {
            groundingFailure = grounding
            break
          }
          emittedAnswer += `${emittedAnswer ? ' ' : ''}${sentence}`
          yield { type: 'sentence', text: sentence }
        }
        if (groundingFailure) break
      }

      if (!groundingFailure && sentenceBuffer.trim()) {
        const grounding = checkClaimGrounding(sentenceBuffer.trim(), context)
        if (grounding.level === 'SUPPORTED') {
          emittedAnswer += `${emittedAnswer ? ' ' : ''}${sentenceBuffer.trim()}`
          yield { type: 'sentence', text: sentenceBuffer.trim() }
        } else {
          groundingFailure = grounding
        }
      }

      activeModelUsed = candidateModel
      break // Successful generation, exit model loop
    } catch (error) {
      if (classifyError(error) === 'aborted') throw error
      console.warn(`[RAG] Model ${candidateModel} failed, trying next candidate...`, error instanceof Error ? error.message : error)
    }
  }

  const modelName = activeModelUsed
  const llmMs = Math.round(performance.now() - llmStart)
  const outputStart = performance.now()
  let response = emittedAnswer.trim()
  let outputChecks: GuardrailResult[]
  let faithfulnessStatus = 'SUPPORTED'
  if (groundingFailure || !response) {
    const noKnowledge = noKnowledgeResponse(language)
    const withheld = groundingFailure
      ? [{ ...groundingFailure, name: 'Faithfulness', details: `Withheld unsupported claim: ${groundingFailure.details}` }]
      : []
    const enforcement = noKnowledgeOutputCheck(noKnowledge)
    response = emittedAnswer ? `${emittedAnswer} ${noKnowledge}` : noKnowledge
    outputChecks = [...withheld, enforcement]
    faithfulnessStatus = groundingFailure && emittedAnswer ? 'PARTIALLY_SUPPORTED' : 'UNSUPPORTED_REJECTED'
    yield { type: 'sentence', text: noKnowledge }
  } else {
    const output = runOutputGuardrails(response, context)
    outputChecks = output.results
    const ground = outputChecks.find(check => check.name === 'Faithfulness')
    if (!ground?.passed) {
      // This is defensive: sentence verification should already have prevented it.
      response = noKnowledgeResponse(language)
      outputChecks.push(noKnowledgeOutputCheck(response))
      faithfulnessStatus = 'UNSUPPORTED_REJECTED'
      yield { type: 'sentence', text: response }
    }
  }
  const guardrailsMs = inputChecks.reduce((sum, check) => sum + check.durationMs, 0)
    + Math.round(performance.now() - outputStart)
  const finalResponse = makeResponse(
    { query, response, sources: response === noKnowledgeResponse(language) ? [] : sources, inputChecks, outputChecks },
    { embeddingMs, bm25Ms, vectorSearchMs, hybridRankingMs, retrievalMs, llmTtftMs, llmMs, guardrailsMs, totalMs: Math.round(performance.now() - totalStart) },
    {
      retryCount,
      cacheHit: false,
      modelUsed: modelName,
      chunkingStrategy: Array.from(new Set(sources.map(source => source.strategy))).join(', ') || 'none',
      totalChunksSearched: store.size,
      retrievalMethod,
      faithfulnessStatus,
    },
  )

  if (faithfulnessStatus === 'SUPPORTED' && !inputChecks.some(check => check.name === 'PII Detection' && !check.passed)) {
    cache.set(cleanQuery, finalResponse)
  }
  yield { type: 'complete', response: finalResponse }
}

/** Compatibility helper for existing server-function consumers. */
export async function completeRAGQuery(input: StreamInput, signal?: AbortSignal): Promise<RAGResponse> {
  let completed: RAGResponse | null = null
  for await (const event of streamRAGQuery(input, signal)) {
    if (event.type === 'complete') completed = event.response
    if (event.type === 'error') throw new Error(event.message)
  }
  if (!completed) throw new Error('RAG stream ended without a response')
  return completed
}
