// In-Memory Vector Store — hybrid retrieval with RRF rank fusion
// Combines cosine similarity + BM25 keyword scoring using Reciprocal Rank Fusion

import type { ChunkMetadata, ChunkStrategy } from './chunking'

// ---- Types ----
export interface VectorRecord {
  id: string
  text: string
  embedding: number[]
  metadata: ChunkMetadata
}

export interface SearchResult {
  id: string
  text: string
  score: number             // combined RRF score
  cosineScore: number       // raw vector similarity score
  bm25Score: number         // raw keyword relevance score
  retrievalMethod: 'hybrid' | 'semantic_only' | 'bm25_only'
  metadata: ChunkMetadata
}

export interface StoreStats {
  totalVectors: number
  dimensions: number
  byStrategy: Record<string, number>
  byLanguage: Record<string, number>
  memorySizeMb: number
}

export interface HybridSearchTiming {
  vectorSearchMs: number
  bm25Ms: number
  hybridRankingMs: number
}

export interface TimedSearchResult {
  results: SearchResult[]
  timing: HybridSearchTiming
}

// ---- BM25 Implementation ----
class BM25Index {
  private docs: Map<string, { tokens: string[]; tf: Map<string, number> }> = new Map()
  private df: Map<string, number> = new Map()  // document frequency
  private avgDl = 0
  private N = 0

  // BM25 parameters (Okapi BM25)
  private k1 = 1.5
  private b = 0.75

  addDocument(id: string, text: string) {
    const tokens = this.tokenize(text)

    // Pre-compute term frequency map for O(1) lookups during search
    const tf = new Map<string, number>()
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1)
    }
    this.docs.set(id, { tokens, tf })

    // Update document frequency
    const uniqueTokens = new Set(tokens)
    for (const token of uniqueTokens) {
      this.df.set(token, (this.df.get(token) ?? 0) + 1)
    }

    this.N++
    this.avgDl = Array.from(this.docs.values())
      .reduce((sum, d) => sum + d.tokens.length, 0) / this.N
  }

  search(query: string, topK: number, candidateIds?: Set<string>): Map<string, number> {
    const queryTokens = this.tokenize(query)
    const scores = new Map<string, number>()

    for (const [docId, doc] of this.docs) {
      if (candidateIds && !candidateIds.has(docId)) continue
      let score = 0
      const dl = doc.tokens.length

      for (const qt of queryTokens) {
        const tf = doc.tf.get(qt) ?? 0
        const docFreq = this.df.get(qt) ?? 0
        if (docFreq === 0 || tf === 0) continue

        const idf = Math.log((this.N - docFreq + 0.5) / (docFreq + 0.5) + 1)
        const tfNorm = (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * dl / this.avgDl))
        score += idf * tfNorm
      }

      if (score > 0) {
        scores.set(docId, score)
      }
    }

    // Return top K by score
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)

    return new Map(sorted)
  }

  get indexSize(): number {
    return this.N
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s\u0900-\u097F]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2)
  }
}

// ---- Cosine Similarity ----
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dotProduct / denom : 0
}

// ---- Reciprocal Rank Fusion ----
// Combines ranked lists: RRF_score(d) = Σ 1/(k + rank_i)
const RRF_K = 60 // Standard constant from the RRF paper

function reciprocalRankFusion(
  rankedLists: Map<string, number>[],
  topK: number,
): Map<string, number> {
  const fusedScores = new Map<string, number>()

  for (const rankedList of rankedLists) {
    // Convert scores to ranks
    const sorted = Array.from(rankedList.entries())
      .sort((a, b) => b[1] - a[1])

    sorted.forEach(([id], rank) => {
      const rrfScore = 1 / (RRF_K + rank + 1)
      fusedScores.set(id, (fusedScores.get(id) ?? 0) + rrfScore)
    })
  }

  // Sort by fused score and return top K
  const sorted = Array.from(fusedScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)

  return new Map(sorted)
}

// ---- Main Vector Store ----
export class InMemoryVectorStore {
  private records: VectorRecord[] = []
  private recordMap: Map<string, VectorRecord> = new Map()
  private bm25 = new BM25Index()
  private dimensions = 0

  /**
   * Load pre-computed vectors from JSON data
   */
  load(data: VectorRecord[]) {
    this.records = data
    this.recordMap = new Map(data.map(r => [r.id, r]))
    this.dimensions = data[0]?.embedding.length ?? 0
    this.bm25 = new BM25Index()

    // Build BM25 index
    for (const record of data) {
      this.bm25.addDocument(record.id, record.text)
    }

    console.log(`[VectorStore] Loaded ${data.length} vectors (${this.dimensions}D)`)
  }

  /**
   * Add a single record
   */
  add(record: VectorRecord) {
    this.records.push(record)
    this.recordMap.set(record.id, record)
    this.bm25.addDocument(record.id, record.text)
    if (this.dimensions === 0) this.dimensions = record.embedding.length
  }

  /**
   * Hybrid search using Reciprocal Rank Fusion (RRF)
   * Combines cosine similarity ranking with BM25 keyword ranking
   */
  hybridSearch(
    queryEmbedding: number[],
    queryText: string,
    topK = 5,
    options: {
      strategyFilter?: ChunkStrategy
      languageFilter?: string
    } = {},
  ): SearchResult[] {
    return this.hybridSearchWithTimings(queryEmbedding, queryText, topK, options).results
  }

  hybridSearchWithTimings(
    queryEmbedding: number[],
    queryText: string,
    topK = 5,
    options: {
      strategyFilter?: ChunkStrategy
      languageFilter?: string
    } = {},
  ): TimedSearchResult {
    const { strategyFilter, languageFilter } = options

    // Filter records
    let candidates = this.records
    if (strategyFilter) {
      candidates = candidates.filter(r => r.metadata.strategy === strategyFilter)
    }
    if (languageFilter) {
      candidates = candidates.filter(r => r.metadata.language === languageFilter)
    }

    const vectorStart = performance.now()
    const cosineScores = new Map<string, number>()
    for (const record of candidates) {
      const sim = cosineSimilarity(queryEmbedding, record.embedding)
      cosineScores.set(record.id, sim)
    }
    const vectorSearchMs = Math.round(performance.now() - vectorStart)

    const bm25Start = performance.now()
    const bm25Scores = this.bm25.search(queryText, topK * 5, new Set(candidates.map(candidate => candidate.id)))
    const bm25Ms = Math.round(performance.now() - bm25Start)

    const rankingStart = performance.now()
    const fusedScores = reciprocalRankFusion([cosineScores, bm25Scores], topK)

    // Build results
    const results: SearchResult[] = []
    for (const [id, score] of fusedScores) {
      const record = this.recordMap.get(id)
      if (!record) continue
      results.push({
        id: record.id,
        text: record.text,
        score,
        cosineScore: cosineScores.get(id) ?? 0,
        bm25Score: bm25Scores.get(id) ?? 0,
        retrievalMethod: 'hybrid',
        metadata: record.metadata,
      })
    }

    results.sort((a, b) => b.score - a.score)
    const hybridRankingMs = Math.round(performance.now() - rankingStart)

    return {
      results: results.slice(0, topK),
      timing: { vectorSearchMs, bm25Ms, hybridRankingMs },
    }
  }

  /**
   * Semantic-only search (cosine similarity) — fallback when BM25 unavailable
   */
  semanticSearch(
    queryEmbedding: number[],
    topK = 5,
    options: {
      strategyFilter?: ChunkStrategy
      languageFilter?: string
    } = {},
  ): SearchResult[] {
    const { strategyFilter, languageFilter } = options

    let candidates = this.records
    if (strategyFilter) {
      candidates = candidates.filter(r => r.metadata.strategy === strategyFilter)
    }
    if (languageFilter) {
      candidates = candidates.filter(r => r.metadata.language === languageFilter)
    }

    const results: SearchResult[] = candidates.map(record => {
      const score = cosineSimilarity(queryEmbedding, record.embedding)
      return {
        id: record.id,
        text: record.text,
        score,
        cosineScore: score,
        bm25Score: 0,
        retrievalMethod: 'semantic_only' as const,
        metadata: record.metadata,
      }
    })

    results.sort((a, b) => b.score - a.score)

    return results.slice(0, topK)
  }

  /**
   * BM25-only search — fallback when embeddings unavailable
   */
  bm25Search(
    queryText: string,
    topK = 5,
  ): SearchResult[] {
    const bm25Scores = this.bm25.search(queryText, topK)
    const results: SearchResult[] = []

    for (const [id, score] of bm25Scores) {
      const record = this.recordMap.get(id)
      if (!record) continue
      results.push({
        id: record.id,
        text: record.text,
        score,
        cosineScore: 0,
        bm25Score: score,
        retrievalMethod: 'bm25_only',
        metadata: record.metadata,
      })
    }

    results.sort((a, b) => b.score - a.score)

    return results.slice(0, topK)
  }

  /**
   * Get store statistics
   */
  getStats(): StoreStats {
    const byStrategy: Record<string, number> = {}
    const byLanguage: Record<string, number> = {}

    for (const r of this.records) {
      byStrategy[r.metadata.strategy] = (byStrategy[r.metadata.strategy] ?? 0) + 1
      byLanguage[r.metadata.language] = (byLanguage[r.metadata.language] ?? 0) + 1
    }

    // Rough memory estimate
    const embeddingBytes = this.records.length * this.dimensions * 8
    const textBytes = this.records.reduce((sum, r) => sum + r.text.length * 2, 0)
    const memorySizeMb = (embeddingBytes + textBytes) / (1024 * 1024)

    return {
      totalVectors: this.records.length,
      dimensions: this.dimensions,
      byStrategy,
      byLanguage,
      memorySizeMb: Math.round(memorySizeMb * 100) / 100,
    }
  }

  /**
   * Get the average embedding for relevance checking
   * Returns centroid of all stored vectors
   */
  getCentroid(): number[] | null {
    if (this.records.length === 0 || this.dimensions === 0) return null
    const centroid = new Array<number>(this.dimensions).fill(0)
    for (const record of this.records) {
      for (let i = 0; i < this.dimensions; i++) {
        centroid[i]! += record.embedding[i]!
      }
    }
    for (let i = 0; i < this.dimensions; i++) {
      centroid[i]! /= this.records.length
    }
    return centroid
  }

  get size(): number {
    return this.records.length
  }
}

// ---- Singleton instance ----
let storeInstance: InMemoryVectorStore | null = null

export function getVectorStore(): InMemoryVectorStore {
  if (!storeInstance) {
    storeInstance = new InMemoryVectorStore()
  }
  return storeInstance
}
