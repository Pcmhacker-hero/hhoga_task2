import { describe, it, expect } from 'vitest'
import {
  withRetry,
  CircuitBreaker,
  CircuitState,
  ResponseCache,
  classifyError,
  QueryInputSchema,
} from '../src/lib/harness'

describe('Reliability Harness & Structured Orchestration', () => {
  describe('Zod Input Validation', () => {
    it('validates correct query input', () => {
      const parsed = QueryInputSchema.safeParse({ query: 'What is the capital of India?' })
      expect(parsed.success).toBe(true)
    })

    it('rejects empty query', () => {
      const parsed = QueryInputSchema.safeParse({ query: '' })
      expect(parsed.success).toBe(false)
    })
  })

  describe('withRetry', () => {
    it('succeeds on first attempt without retrying', async () => {
      let attempts = 0
      const { result, attempts: totalAttempts } = await withRetry(async () => {
        attempts++
        return 'success'
      })
      expect(result).toBe('success')
      expect(totalAttempts).toBe(1)
      expect(attempts).toBe(1)
    })

    it('retries on retryable errors and succeeds', async () => {
      let attempts = 0
      const { result, attempts: totalAttempts } = await withRetry(async () => {
        attempts++
        if (attempts < 2) throw new Error('rate_limit 429')
        return 'recovered'
      }, { initialDelayMs: 10, maxDelayMs: 50 })

      expect(result).toBe('recovered')
      expect(totalAttempts).toBe(2)
    })

    it('does not retry non-retryable fatal errors', async () => {
      let attempts = 0
      await expect(withRetry(async () => {
        attempts++
        throw new Error('invalid_api_key')
      }, { maxAttempts: 3 })).rejects.toThrow('invalid_api_key')

      expect(attempts).toBe(1)
    })
  })

  describe('CircuitBreaker', () => {
    it('transitions from CLOSED to OPEN after failure threshold', async () => {
      const cb = new CircuitBreaker(2, 50)
      expect(cb.getState()).toBe(CircuitState.CLOSED)

      // 1st failure
      await expect(cb.execute(async () => { throw new Error('fail') })).rejects.toThrow()
      expect(cb.getState()).toBe(CircuitState.CLOSED)

      // 2nd failure -> trips to OPEN
      await expect(cb.execute(async () => { throw new Error('fail') })).rejects.toThrow()
      expect(cb.getState()).toBe(CircuitState.OPEN)

      // Fast rejection while OPEN
      await expect(cb.execute(async () => 'ok')).rejects.toThrow('Circuit breaker is OPEN')

      // Wait for reset timeout -> HALF_OPEN -> CLOSED on success
      await new Promise(r => setTimeout(r, 60))
      const res = await cb.execute(async () => 'recovered')
      expect(res).toBe('recovered')
      expect(cb.getState()).toBe(CircuitState.CLOSED)
    })
  })

  describe('LRU ResponseCache', () => {
    it('stores and retrieves normalized queries', () => {
      const cache = new ResponseCache(2, 5000)
      const mockResponse: any = { response: 'Test response' }

      cache.set('Capital of India', mockResponse)
      expect(cache.get('capital of india ')).toEqual(mockResponse)
    })

    it('evicts oldest items when max size is reached', () => {
      const cache = new ResponseCache(2, 5000)
      cache.set('q1', { response: 'r1' } as any)
      cache.set('q2', { response: 'r2' } as any)
      cache.set('q3', { response: 'r3' } as any)

      expect(cache.get('q1')).toBeNull()
      expect(cache.get('q2')).not.toBeNull()
      expect(cache.get('q3')).not.toBeNull()
    })
  })

  describe('classifyError', () => {
    it('classifies errors accurately', () => {
      expect(classifyError(new Error('rate_limit exceeded'))).toBe('rate_limit')
      expect(classifyError(new Error('Operation aborted'))).toBe('aborted')
      expect(classifyError(new Error('ETIMEDOUT connection'))).toBe('retryable')
      expect(classifyError(new Error('Invalid validation parameters'))).toBe('user_error')
    })
  })
})
