// Chunking Module — Configurable document chunking strategies with full metadata traceability
// Strategies: Fixed Overlap, Sentence Boundary (Default), Paragraph, Keyword Similarity Grouping, Sliding Window

export interface ChunkMetadata {
  docId: string
  source?: string          // source title, path, or stable corpus identifier
  language: 'hi' | 'en' | 'mixed'
  strategy: ChunkStrategy
  position: number        // chunk index within the document
  totalChunks: number     // total chunks from this doc with this strategy
  overlapChars: number    // overlap with previous chunk
  charStart: number       // start offset in original text
  charEnd: number         // end offset in original text
  queryText?: string
  answerText?: string
}

export interface Chunk {
  id: string              // unique chunk identifier
  text: string            // chunk content
  metadata: ChunkMetadata
}

export type ChunkStrategy =
  | 'fixed_overlap'       // Strategy 1: Fixed-size character window with overlap
  | 'sentence_boundary'   // Strategy 2: Sentence boundary aware (Hindi purna viram । & English .!?) - RECOMMENDED DEFAULT
  | 'paragraph'           // Strategy 3: Paragraph double-newline split
  | 'keyword_group'       // Strategy 4: Adjacent sentence grouping using Jaccard keyword overlap (not semantic)
  | 'semantic_embedding'  // Experimental: adjacent sentence embedding boundary detection
  | 'sliding_window'      // Strategy 5: Small window with 50% overlap

// ---- Language Detection ----
export function detectLanguage(text: string): 'hi' | 'en' | 'mixed' {
  const devanagari = (text.match(/[\u0900-\u097F]/g) ?? []).length
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length
  const total = devanagari + latin
  if (total === 0) return 'en'
  if (devanagari > 0 && latin > 0) {
    const ratio = devanagari / total
    if (ratio > 0.85) return 'hi'
    if (ratio < 0.05) return 'en'
    return 'mixed'
  }
  return devanagari > 0 ? 'hi' : 'en'
}

// Sentence splitting supporting Hindi (।, ॥) and English (.!?)
const SENTENCE_REGEX = /(?<=[.!?।॥])\s+/
const PARAGRAPH_REGEX = /\n\s*\n/

export function splitSentences(text: string): string[] {
  return text.split(SENTENCE_REGEX).filter(s => s.trim().length > 0)
}

export function splitParagraphs(text: string): string[] {
  return text.split(PARAGRAPH_REGEX).filter(p => p.trim().length > 0)
}

// Strategy 1: Fixed-Size with Overlap
export function chunkFixedOverlap(
  text: string,
  docId: string,
  language: 'hi' | 'en' | 'mixed',
  chunkSize = 512,
  overlap = 64,
): Chunk[] {
  const chunks: Chunk[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    const chunkText = text.slice(start, end).trim()

    if (chunkText.length > 20) {
      chunks.push({
        id: `${docId}-fixed-${chunks.length}`,
        text: chunkText,
        metadata: {
          docId,
          language,
          strategy: 'fixed_overlap',
          position: chunks.length,
          totalChunks: 0,
          overlapChars: start === 0 ? 0 : overlap,
          charStart: start,
          charEnd: end,
        },
      })
    }

    start = end - overlap
    if (start >= text.length - overlap) break
  }

  for (const c of chunks) c.metadata.totalChunks = chunks.length
  return chunks
}

// Strategy 2: Sentence Boundary Aware (Recommended default)
export function chunkSentenceBoundary(
  text: string,
  docId: string,
  language: 'hi' | 'en' | 'mixed',
  maxChunkSize = 512,
): Chunk[] {
  const sentences = splitSentences(text)
  const chunks: Chunk[] = []
  let current = ''
  let charOffset = 0
  let chunkStartOffset = 0

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChunkSize && current.length > 0) {
      chunks.push({
        id: `${docId}-sent-${chunks.length}`,
        text: current.trim(),
        metadata: {
          docId,
          language,
          strategy: 'sentence_boundary',
          position: chunks.length,
          totalChunks: 0,
          overlapChars: 0,
          charStart: chunkStartOffset,
          charEnd: charOffset,
        },
      })
      current = ''
      chunkStartOffset = charOffset
    }
    current += (current ? ' ' : '') + sentence
    charOffset += sentence.length + 1
  }

  if (current.trim().length > 20) {
    chunks.push({
      id: `${docId}-sent-${chunks.length}`,
      text: current.trim(),
      metadata: {
        docId,
        language,
        strategy: 'sentence_boundary',
        position: chunks.length,
        totalChunks: 0,
        overlapChars: 0,
        charStart: chunkStartOffset,
        charEnd: charOffset,
      },
    })
  }

  for (const c of chunks) c.metadata.totalChunks = chunks.length
  return chunks
}

// Strategy 3: Paragraph Based
export function chunkParagraph(
  text: string,
  docId: string,
  language: 'hi' | 'en' | 'mixed',
  maxChunkSize = 1024,
): Chunk[] {
  const paragraphs = splitParagraphs(text)
  const chunks: Chunk[] = []
  let charOffset = 0

  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (trimmed.length > 20) {
      chunks.push({
        id: `${docId}-para-${chunks.length}`,
        text: trimmed.slice(0, maxChunkSize),
        metadata: {
          docId,
          language,
          strategy: 'paragraph',
          position: chunks.length,
          totalChunks: 0,
          overlapChars: 0,
          charStart: charOffset,
          charEnd: charOffset + trimmed.length,
        },
      })
    }
    charOffset += para.length + 2
  }

  for (const c of chunks) c.metadata.totalChunks = chunks.length
  return chunks
}

// Strategy 4: Keyword Topic Grouping using Jaccard similarity. This is intentionally
// not called "semantic" because it does not use embeddings.
export function chunkKeywordGroup(
  text: string,
  docId: string,
  language: 'hi' | 'en' | 'mixed',
  maxChunkSize = 600,
  similarityThreshold = 0.25,
): Chunk[] {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return []

  function getKeywords(s: string): Set<string> {
    return new Set(
      s.toLowerCase()
        .replace(/[^\w\s\u0900-\u097F]/g, '')
        .split(/\s+/)
        .filter(w => w.length >= 3)
    )
  }

  function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    const intersection = new Set([...a].filter(x => b.has(x)))
    const union = new Set([...a, ...b])
    return union.size > 0 ? intersection.size / union.size : 0
  }

  const chunks: Chunk[] = []
  let group: string[] = [sentences[0]!]
  let prevKeywords = getKeywords(sentences[0]!)
  let charOffset = 0

  for (let i = 1; i < sentences.length; i++) {
    const sentence = sentences[i]!
    const keywords = getKeywords(sentence)
    const similarity = jaccardSimilarity(prevKeywords, keywords)
    const groupText = group.join(' ')

    if (similarity >= similarityThreshold && groupText.length + sentence.length <= maxChunkSize) {
      group.push(sentence)
      prevKeywords = new Set([...prevKeywords, ...keywords])
    } else {
      const t = groupText.trim()
      if (t.length > 20) {
        chunks.push({
          id: `${docId}-kw-${chunks.length}`,
          text: t,
          metadata: {
            docId,
            language,
            strategy: 'keyword_group',
            position: chunks.length,
            totalChunks: 0,
            overlapChars: 0,
            charStart: charOffset,
            charEnd: charOffset + t.length,
          },
        })
      }
      charOffset += t.length + 1
      group = [sentence]
      prevKeywords = keywords
    }
  }

  const remaining = group.join(' ').trim()
  if (remaining.length > 20) {
    chunks.push({
      id: `${docId}-kw-${chunks.length}`,
      text: remaining,
      metadata: {
        docId,
        language,
        strategy: 'keyword_group',
        position: chunks.length,
        totalChunks: 0,
        overlapChars: 0,
        charStart: charOffset,
        charEnd: charOffset + remaining.length,
      },
    })
  }

  for (const c of chunks) c.metadata.totalChunks = chunks.length
  return chunks
}

// Strategy 5: Sliding Window (Small chunk, high overlap)
export function chunkSlidingWindow(
  text: string,
  docId: string,
  language: 'hi' | 'en' | 'mixed',
  windowSize = 256,
  stepSize = 128,
): Chunk[] {
  const chunks: Chunk[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + windowSize, text.length)
    const chunkText = text.slice(start, end).trim()

    if (chunkText.length > 20) {
      chunks.push({
        id: `${docId}-slide-${chunks.length}`,
        text: chunkText,
        metadata: {
          docId,
          language,
          strategy: 'sliding_window',
          position: chunks.length,
          totalChunks: 0,
          overlapChars: start === 0 ? 0 : windowSize - stepSize,
          charStart: start,
          charEnd: end,
        },
      })
    }

    start += stepSize
  }

  for (const c of chunks) c.metadata.totalChunks = chunks.length
  return chunks
}

/**
 * Optional experimental semantic chunker. The caller supplies sentence embeddings
 * so production ingestion can keep the default strategy inexpensive.
 */
export async function chunkSemanticEmbedding(
  text: string,
  docId: string,
  language: 'hi' | 'en' | 'mixed',
  embed: (sentence: string) => Promise<number[]>,
  similarityThreshold = 0.68,
  maxChunkSize = 600,
): Promise<Chunk[]> {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return []

  const embeddings = await Promise.all(sentences.map(embed))
  const cosine = (a: number[], b: number[]): number => {
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += a[i]! * b[i]!
      normA += a[i]! * a[i]!
      normB += b[i]! * b[i]!
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB)
    return denominator === 0 ? 0 : dot / denominator
  }

  const chunks: Chunk[] = []
  let group = [sentences[0]!]
  let charOffset = 0
  for (let index = 1; index < sentences.length; index++) {
    const sentence = sentences[index]!
    const similarity = cosine(embeddings[index - 1]!, embeddings[index]!)
    const groupText = group.join(' ')
    if (similarity >= similarityThreshold && groupText.length + sentence.length <= maxChunkSize) {
      group.push(sentence)
      continue
    }
    const chunkText = groupText.trim()
    if (chunkText.length > 20) {
      chunks.push({
        id: `${docId}-semantic-${chunks.length}`,
        text: chunkText,
        metadata: { docId, language, strategy: 'semantic_embedding', position: chunks.length, totalChunks: 0, overlapChars: 0, charStart: charOffset, charEnd: charOffset + chunkText.length },
      })
    }
    charOffset += chunkText.length + 1
    group = [sentence]
  }
  const remaining = group.join(' ').trim()
  if (remaining.length > 20) {
    chunks.push({
      id: `${docId}-semantic-${chunks.length}`,
      text: remaining,
      metadata: { docId, language, strategy: 'semantic_embedding', position: chunks.length, totalChunks: 0, overlapChars: 0, charStart: charOffset, charEnd: charOffset + remaining.length },
    })
  }
  for (const chunk of chunks) chunk.metadata.totalChunks = chunks.length
  return chunks
}

/**
 * Apply a specified strategy to a document (default: sentence_boundary)
 */
export function chunkWithStrategy(
  text: string,
  docId: string,
  strategy: ChunkStrategy = 'sentence_boundary',
  language?: 'hi' | 'en' | 'mixed',
): Chunk[] {
  const lang = language ?? detectLanguage(text)

  switch (strategy) {
    case 'fixed_overlap':
      return chunkFixedOverlap(text, docId, lang)
    case 'sentence_boundary':
      return chunkSentenceBoundary(text, docId, lang)
    case 'paragraph':
      return chunkParagraph(text, docId, lang)
    case 'keyword_group':
      return chunkKeywordGroup(text, docId, lang)
    case 'semantic_embedding':
      throw new Error('semantic_embedding requires chunkSemanticEmbedding and an embedding function')
    case 'sliding_window':
      return chunkSlidingWindow(text, docId, lang)
    default:
      return chunkSentenceBoundary(text, docId, lang)
  }
}
