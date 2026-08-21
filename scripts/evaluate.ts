#!/usr/bin/env npx tsx
// Offline-safe retrieval and generation evaluation. It never invents STT/TTS
// values: those are recorded only by the live browser pipeline.

import { config } from 'dotenv'
config()

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'

import { InMemoryVectorStore, type VectorRecord } from '../src/lib/vector-store'
import { BENCHMARK_QA_SET, evaluateRetrieval } from '../src/lib/evaluation'
import { checkClaimGrounding } from '../src/lib/guardrails'

interface Summary { mean: number; p50: number; p90: number; p95: number }

function summary(values: number[]): Summary | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const percentile = (percent: number) => {
    const index = (percent / 100) * (sorted.length - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    return Math.round((sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * (index - lower))
  }
  return { mean: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), p50: percentile(50), p90: percentile(90), p95: percentile(95) }
}

function formatSummary(value: Summary | null): string {
  return value ? `${value.mean}ms / ${value.p50}ms / ${value.p90}ms / ${value.p95}ms` : 'not measured'
}

async function evaluateStrategy(
  strategy: string,
  records: VectorRecord[],
  embeddingModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null,
  llmModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null,
) {
  const store = new InMemoryVectorStore()
  store.load(records)
  const retrievalLatencies: number[] = []
  const llmTtftLatencies: number[] = []
  const llmTotalLatencies: number[] = []
  const searchResults: { queryId: string; retrievedDocs: { text: string }[] }[] = []
  let supportedAnswers = 0

  for (const benchmark of BENCHMARK_QA_SET) {
    const retrievalStart = performance.now()
    let retrieved = [] as ReturnType<InMemoryVectorStore['bm25Search']>
    if (embeddingModel) {
      try {
        const embedding = await embeddingModel.embedContent(benchmark.query)
        retrieved = store.hybridSearch(embedding.embedding.values, benchmark.query, 5)
      } catch {
        retrieved = store.bm25Search(benchmark.query, 5)
      }
    } else {
      retrieved = store.bm25Search(benchmark.query, 5)
    }
    retrievalLatencies.push(Math.round(performance.now() - retrievalStart))
    searchResults.push({ queryId: benchmark.id, retrievedDocs: retrieved })

    if (llmModel && retrieved.length > 0) {
      const context = retrieved.map((result, index) => `[Source ${index + 1}] ${result.text}`).join('\n')
      const generationStart = performance.now()
      let ttft = 0
      let answer = ''
      try {
        const response = await llmModel.generateContentStream(`Answer in two concise sentences using only this context:\n${context}\n\nQuestion: ${benchmark.query}`)
        for await (const chunk of response.stream) {
          if (ttft === 0) ttft = Math.round(performance.now() - generationStart)
          answer += chunk.text()
        }
        llmTtftLatencies.push(ttft)
        llmTotalLatencies.push(Math.round(performance.now() - generationStart))
        if (checkClaimGrounding(answer, context).level === 'SUPPORTED') supportedAnswers++
      } catch {
        // A failed provider turn is excluded from latency distributions rather than
        // being represented by a made-up value.
      }
    }
  }

  const metrics = evaluateRetrieval(searchResults, BENCHMARK_QA_SET)
  return {
    strategy,
    metrics,
    retrieval: summary(retrievalLatencies),
    llmTtft: summary(llmTtftLatencies),
    llmTotal: summary(llmTotalLatencies),
    groundingRate: llmTotalLatencies.length > 0 ? supportedAnswers / llmTotalLatencies.length : null,
  }
}

async function main(): Promise<void> {
  const dataPath = join(process.cwd(), process.argv.includes('--input') ? process.argv[process.argv.indexOf('--input') + 1] ?? '' : 'data/embeddings.json')
  if (!existsSync(dataPath)) throw new Error('data/embeddings.json not found. Run npm run ingest first.')
  const records = JSON.parse(readFileSync(dataPath, 'utf-8')) as VectorRecord[]
  const requestedStrategy = process.argv.includes('--strategy') ? process.argv[process.argv.indexOf('--strategy') + 1] : undefined
  const compare = process.argv.includes('--compare-strategies')
  const availableStrategies = [...new Set(records.map(record => record.metadata.strategy))]
  const strategies = compare ? availableStrategies : [requestedStrategy ?? availableStrategies[0] ?? 'sentence_boundary']

  const apiKey = process.env.GEMINI_API_KEY
  const client = apiKey ? new GoogleGenerativeAI(apiKey) : null
  const embeddingModel = client?.getGenerativeModel({ model: 'gemini-embedding-001' }) ?? null
  const llmModel = client?.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' }) ?? null
  console.log(`Loaded ${records.length} vectors. Provider generation: ${client ? 'enabled' : 'disabled (BM25-only evaluation)'}.`)
  if (compare && availableStrategies.length < 2) console.log('Only one indexed strategy is available. Re-ingest with --strategy all into an experimental file to compare strategies.')

  const reports = []
  for (const strategy of strategies) {
    const strategyRecords = records.filter(record => record.metadata.strategy === strategy)
    if (strategyRecords.length === 0) {
      console.log(`Skipping ${strategy}: no indexed chunks.`)
      continue
    }
    reports.push(await evaluateStrategy(strategy, strategyRecords, embeddingModel, llmModel))
  }

  console.log('\nStrategy              Recall@5   MRR     NDCG@5')
  console.log('--------------------------------------------------')
  for (const report of reports) {
    console.log(`${report.strategy.padEnd(21)} ${(report.metrics.recallAt5 * 100).toFixed(1).padStart(6)}%   ${report.metrics.mrr.toFixed(3)}   ${report.metrics.ndcgAt5.toFixed(3)}`)
  }
  console.log('\nMeasured latency (Mean / P50 / P90 / P95)')
  for (const report of reports) {
    console.log(`${report.strategy}: retrieval ${formatSummary(report.retrieval)}; LLM TTFT ${formatSummary(report.llmTtft)}; LLM total ${formatSummary(report.llmTotal)}`)
    if (report.groundingRate !== null) console.log(`  claim grounding rate: ${(report.groundingRate * 100).toFixed(1)}%`)
  }
  console.log('STT final, TTS first-audio, and end-to-end first-audio are not measured by this text-only evaluator; the live UI records their actual values and percentiles.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed')
  process.exit(1)
})
