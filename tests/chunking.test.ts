import { describe, it, expect } from 'vitest'
import {
  detectLanguage,
  splitSentences,
  chunkFixedOverlap,
  chunkSentenceBoundary,
  chunkParagraph,
  chunkKeywordGroup,
  chunkSlidingWindow,
  chunkWithStrategy,
} from '../src/lib/chunking'

describe('Chunking & Language Detection', () => {
  it('detects Hindi and English languages correctly', () => {
    expect(detectLanguage('भारत एक विशाल देश है। इसकी राजधानी नई दिल्ली है।')).toBe('hi')
    expect(detectLanguage('India is a large country. Its capital is New Delhi.')).toBe('en')
    expect(detectLanguage('India भारत mixed language sentence')).toBe('mixed')
  })

  it('splits sentences respecting both English and Hindi punctuation', () => {
    const hindiText = 'भारत की राजधानी नई दिल्ली है। यहाँ कई ऐतिहासिक स्थल हैं! क्या आप जानते हैं?'
    const sentences = splitSentences(hindiText)
    expect(sentences.length).toBe(3)
    expect(sentences[0]).toContain('भारत की राजधानी')

    const engText = 'First sentence. Second sentence! Third sentence?'
    expect(splitSentences(engText).length).toBe(3)
  })

  it('chunks with fixed overlap strategy', () => {
    const text = 'This is a test document. '.repeat(40)
    const chunks = chunkFixedOverlap(text, 'doc-1', 'en', 200, 40)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.metadata.strategy).toBe('fixed_overlap')
    expect(chunks[0]!.metadata.docId).toBe('doc-1')
  })

  it('chunks with sentence boundary strategy', () => {
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four.'
    const chunks = chunkSentenceBoundary(text, 'doc-2', 'en', 50)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0]!.metadata.strategy).toBe('sentence_boundary')
  })

  it('chunks with paragraph strategy', () => {
    const text = 'Paragraph one content here.\n\nParagraph two content here.\n\nParagraph three content here.'
    const chunks = chunkParagraph(text, 'doc-3', 'en', 100)
    expect(chunks.length).toBe(3)
    expect(chunks[0]!.metadata.strategy).toBe('paragraph')
  })

  it('chunks with keyword topic grouping', () => {
    const text = 'Machine learning is fascinating. Deep learning uses neural networks. Pizza is made with cheese and dough. Italian cuisine is great.'
    const chunks = chunkKeywordGroup(text, 'doc-4', 'en')
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('chunks with sliding window strategy', () => {
    const text = 'A long sequence of words meant for sliding window testing. '.repeat(10)
    const chunks = chunkSlidingWindow(text, 'doc-5', 'en', 120, 60)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.metadata.strategy).toBe('sliding_window')
  })

  it('chunkWithStrategy routes to default sentence_boundary', () => {
    const text = 'Sentence one. Sentence two.'
    const chunks = chunkWithStrategy(text, 'doc-6')
    expect(chunks[0]!.metadata.strategy).toBe('sentence_boundary')
  })
})
