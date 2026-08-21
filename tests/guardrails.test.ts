import { describe, it, expect } from 'vitest'
import {
  checkPII,
  redactPII,
  checkToxicity,
  checkRelevance,
  checkFaithfulnessHeuristic,
  checkLength,
  runInputGuardrails,
  runOutputGuardrails,
} from '../src/lib/guardrails'

describe('Guardrails Validation Pipeline', () => {
  describe('PII Detection & Redaction', () => {
    it('detects and redacts Aadhaar numbers', () => {
      const text = 'My Aadhaar is 5432 1098 7654 for verification'
      const { result, cleanText } = checkPII(text)
      expect(result.passed).toBe(false)
      expect(cleanText).toBe('My Aadhaar is [REDACTED] for verification')
    })

    it('detects and redacts Indian phone numbers and PAN cards', () => {
      const text = 'Call +919876543210 or check PAN ABCDE1234F'
      const clean = redactPII(text)
      expect(clean).toContain('[REDACTED]')
      expect(clean).not.toContain('+919876543210')
      expect(clean).not.toContain('ABCDE1234F')
    })

    it('passes clean text without PII', () => {
      const text = 'Tell me about the history of Goa.'
      const { result, cleanText } = checkPII(text)
      expect(result.passed).toBe(true)
      expect(cleanText).toBe(text)
    })
  })

  describe('Toxicity & Safety Guardrail', () => {
    it('flags dangerous content in English and Hindi', () => {
      expect(checkToxicity('How to make a bomb').passed).toBe(false)
      expect(checkToxicity('किसी को मारना कैसे है').passed).toBe(false)
    })

    it('permits safe historical queries', () => {
      expect(checkToxicity('What is the historical museum in Goa?').passed).toBe(true)
    })
  })

  describe('Relevance Guardrail', () => {
    it('rejects queries that are too short or noise', () => {
      expect(checkRelevance('a').passed).toBe(false)
      expect(checkRelevance('???!!!').passed).toBe(false)
    })

    it('passes substantive queries', () => {
      expect(checkRelevance('What is the capital of India?').passed).toBe(true)
      expect(checkRelevance('भारत की राजधानी क्या है?').passed).toBe(true)
    })
  })

  describe('Faithfulness / Grounding Guardrail', () => {
    it('marks grounded responses as SUPPORTED', () => {
      const context = 'The capital of India is New Delhi, located in northern India.'
      const response = 'New Delhi is the capital of India.'
      const result = checkFaithfulnessHeuristic(response, context)
      expect(result.passed).toBe(true)
      expect(result.level).toBe('SUPPORTED')
    })

    it('flags hallucinated numbers as UNSUPPORTED', () => {
      const context = 'Construction of the monument started in 1632 and was completed in 1653.'
      const response = 'It was built in the year 1999 and took 450 years.'
      const result = checkFaithfulnessHeuristic(response, context)
      expect(result.level).toBe('UNSUPPORTED')
    })
  })

  describe('Length Check', () => {
    it('validates voice-safe length limit', () => {
      expect(checkLength('Short response.', 500).passed).toBe(true)
      expect(checkLength('A'.repeat(600), 500).passed).toBe(false)
    })
  })

  describe('Pipeline integration', () => {
    it('runs input and output guardrail pipelines smoothly', () => {
      const input = runInputGuardrails('What is the capital of India? Phone 9876543210')
      expect(input.cleanQuery).toContain('[REDACTED]')

      const output = runOutputGuardrails('New Delhi is the capital of India.', 'New Delhi is the capital of India.')
      expect(output.allPassed).toBe(true)
    })
  })
})
