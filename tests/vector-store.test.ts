import { describe, it, expect } from 'vitest'
import { InMemoryVectorStore, type VectorRecord } from '../src/lib/vector-store'

describe('InMemoryVectorStore with Reciprocal Rank Fusion', () => {
  const sampleRecords: VectorRecord[] = [
    {
      id: 'doc-1',
      text: 'New Delhi is the capital city of India.',
      embedding: [0.9, 0.1, 0.0],
      metadata: {
        docId: 'doc-1',
        language: 'en',
        strategy: 'sentence_boundary',
        position: 0,
        totalChunks: 1,
        overlapChars: 0,
        charStart: 0,
        charEnd: 38,
      },
    },
    {
      id: 'doc-2',
      text: 'The Taj Mahal is located in Agra and was built by Shah Jahan.',
      embedding: [0.1, 0.9, 0.1],
      metadata: {
        docId: 'doc-2',
        language: 'en',
        strategy: 'sentence_boundary',
        position: 0,
        totalChunks: 1,
        overlapChars: 0,
        charStart: 0,
        charEnd: 60,
      },
    },
    {
      id: 'doc-3',
      text: 'गोवा भारत का सबसे छोटा राज्य है। राजधानी पणजी है।',
      embedding: [0.1, 0.1, 0.9],
      metadata: {
        docId: 'doc-3',
        language: 'hi',
        strategy: 'sentence_boundary',
        position: 0,
        totalChunks: 1,
        overlapChars: 0,
        charStart: 0,
        charEnd: 48,
      },
    },
  ]

  it('loads records and constructs BM25 index correctly', () => {
    const store = new InMemoryVectorStore()
    store.load(sampleRecords)
    expect(store.size).toBe(3)

    const stats = store.getStats()
    expect(stats.totalVectors).toBe(3)
    expect(stats.dimensions).toBe(3)
    expect(stats.byLanguage['en']).toBe(2)
    expect(stats.byLanguage['hi']).toBe(1)
  })

  it('performs BM25-only keyword search', () => {
    const store = new InMemoryVectorStore()
    store.load(sampleRecords)

    const results = store.bm25Search('capital India', 2)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.id).toBe('doc-1')
    expect(results[0]!.retrievalMethod).toBe('bm25_only')
  })

  it('performs semantic-only cosine similarity search', () => {
    const store = new InMemoryVectorStore()
    store.load(sampleRecords)

    const queryEmbedding = [0.85, 0.15, 0.0]
    const results = store.semanticSearch(queryEmbedding, 2)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.id).toBe('doc-1')
    expect(results[0]!.retrievalMethod).toBe('semantic_only')
  })

  it('performs hybrid search with Reciprocal Rank Fusion (RRF)', () => {
    const store = new InMemoryVectorStore()
    store.load(sampleRecords)

    const queryEmbedding = [0.1, 0.85, 0.1]
    const results = store.hybridSearch(queryEmbedding, 'Taj Mahal Agra', 2)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.id).toBe('doc-2')
    expect(results[0]!.retrievalMethod).toBe('hybrid')
    expect(results[0]!.score).toBeGreaterThan(0)
  })

  it('computes store centroid correctly', () => {
    const store = new InMemoryVectorStore()
    store.load(sampleRecords)

    const centroid = store.getCentroid()
    expect(centroid).not.toBeNull()
    expect(centroid!.length).toBe(3)
    expect(centroid![0]).toBeCloseTo((0.9 + 0.1 + 0.1) / 3, 2)
  })
})
