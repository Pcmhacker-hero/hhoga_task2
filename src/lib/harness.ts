// Harness — Structured orchestration with retries, circuit breaker, caching, and Zod schemas
// HH Goa 2026 requirement: "structured orchestration around the model"

import { z } from 'zod'

// ---- Zod Schemas for Structured I/O ----
export const QueryInputSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty').max(2000, 'Query exceeds 2000 characters'),
  language: z.enum(['hi', 'en', 'hinglish', 'auto']).default('auto'),
  maxResults: z.number().int().min(1).max(20).default(5),
  strategy: z.enum([
    'fixed_overlap', 'sentence_boundary', 'paragraph',
    'semantic_embedding', 'keyword_group', 'sliding_window', 'all',
  ]).default('all'),
})

export type QueryInput = z.infer<typeof QueryInputSchema>

export const SourceCitationSchema = z.object({
  id: z.string(),
  documentId: z.string().optional(),
  source: z.string().optional(),
  position: z.number().int().nonnegative().optional(),
  text: z.string(),
  score: z.number(),
  strategy: z.string(),
  language: z.string(),
  retrievalMethod: z.string().optional(),
})

export type SourceCitation = z.infer<typeof SourceCitationSchema>

export const GuardrailResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  details: z.string(),
  durationMs: z.number(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
})

export const RAGResponseSchema = z.object({
  query: z.string(),
  response: z.string(),
  sources: z.array(SourceCitationSchema),
  timing: z.object({
    embeddingMs: z.number(),
    bm25Ms: z.number().optional(),
    vectorSearchMs: z.number().optional(),
    hybridRankingMs: z.number().optional(),
    retrievalMs: z.number(),
    llmMs: z.number(),
    llmTtftMs: z.number().optional(),
    guardrailsMs: z.number(),
    totalMs: z.number(),
  }),
  guardrails: z.object({
    input: z.array(GuardrailResultSchema),
    output: z.array(GuardrailResultSchema),
  }),
  metadata: z.object({
    retryCount: z.number(),
    cacheHit: z.boolean(),
    modelUsed: z.string(),
    chunkingStrategy: z.string(),
    totalChunksSearched: z.number(),
    retrievalMethod: z.string(),
    faithfulnessStatus: z.string().optional(),
  }),
})

export type RAGResponse = z.infer<typeof RAGResponseSchema>

// ---- Retry with Exponential Backoff + Jitter ----
export interface RetryConfig {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  backoffMultiplier: number
  retryableErrors: string[]
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 4000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
    'rate_limit', '429', '503', '502', '504',
    'overloaded', 'timeout', 'resource_exhausted',
  ],
}

export function isRetryableError(error: unknown, config = DEFAULT_RETRY_CONFIG): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return config.retryableErrors.some(re => message.includes(re.toLowerCase()))
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  signal?: AbortSignal,
): Promise<{ result: T; attempts: number }> {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config }
  let lastError: unknown = null
  let delay = cfg.initialDelayMs

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }
    try {
      const result = await fn()
      return { result, attempts: attempt }
    } catch (error) {
      lastError = error
      console.warn(`[Harness] Attempt ${attempt}/${cfg.maxAttempts} failed:`, error instanceof Error ? error.message : error)

      if (attempt === cfg.maxAttempts || !isRetryableError(error, cfg)) {
        break
      }

      // Add full jitter (0 to delay)
      const jitter = delay * (0.5 + Math.random() * 0.5)
      await abortableDelay(jitter, signal)
      delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelayMs)
    }
  }

  throw lastError
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Operation aborted'))
    }, { once: true })
  })
}

// ---- Circuit Breaker ----
export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation
  OPEN = 'OPEN',           // Failing, fast-reject calls
  HALF_OPEN = 'HALF_OPEN', // Probing if remote service recovered
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failureCount = 0
  private lastFailureTime = 0
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number

  constructor(failureThreshold = 5, resetTimeoutMs = 20000) {
    this.failureThreshold = failureThreshold
    this.resetTimeoutMs = resetTimeoutMs
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN
        console.log('[CircuitBreaker] Probing service → Transitioning to HALF_OPEN')
      } else {
        throw new Error('Circuit breaker is OPEN — upstream service temporarily paused')
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess() {
    this.failureCount = 0
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED
      console.log('[CircuitBreaker] Service recovered → CLOSED')
    }
  }

  private onFailure() {
    this.failureCount++
    this.lastFailureTime = Date.now()
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN
      console.warn(`[CircuitBreaker] Threshold reached (${this.failureCount} failures) → OPEN`)
    }
  }

  getState(): CircuitState {
    return this.state
  }

  reset() {
    this.state = CircuitState.CLOSED
    this.failureCount = 0
    this.lastFailureTime = 0
  }
}

// ---- LRU Response Cache ----
export class ResponseCache {
  private cache = new Map<string, { response: RAGResponse; timestamp: number }>()
  private readonly maxSize: number
  private readonly ttlMs: number

  constructor(maxSize = 100, ttlMs = 5 * 60 * 1000) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
  }

  get(query: string): RAGResponse | null {
    const key = this.normalizeKey(query)
    const entry = this.cache.get(key)

    if (!entry) return null

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return null
    }

    // Move to end (MRU)
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.response
  }

  set(query: string, response: RAGResponse) {
    const key = this.normalizeKey(query)

    // Evict oldest (LRU) if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }

    this.cache.set(key, { response, timestamp: Date.now() })
  }

  clear() {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }

  private normalizeKey(query: string): string {
    return query.trim().toLowerCase().replace(/\s+/g, ' ')
  }
}

// ---- Timeout Wrapper with AbortSignal support ----
export async function withTimeout<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label = 'Operation',
  externalSignal?: AbortSignal,
): Promise<T> {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer)
      throw new Error(`${label} was aborted before execution`)
    }
    externalSignal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    const result = await fn(timeoutController.signal)
    return result
  } catch (error) {
    if (timeoutController.signal.aborted && !externalSignal?.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// ---- Error Classification ----
export type ErrorClass = 'retryable' | 'fatal' | 'user_error' | 'rate_limit' | 'aborted'

export function classifyError(error: unknown): ErrorClass {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()

  if (msg.includes('abort') || msg.includes('cancel')) return 'aborted'
  if (msg.includes('rate_limit') || msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) return 'rate_limit'
  if (msg.includes('invalid') || msg.includes('validation') || msg.includes('bad request')) return 'user_error'
  if (
    msg.includes('timeout') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('connection')
  ) return 'retryable'
  return 'fatal'
}

// ---- Singleton Instances ----
let circuitBreakerInstance: CircuitBreaker | null = null
let responseCacheInstance: ResponseCache | null = null

export function getCircuitBreaker(): CircuitBreaker {
  if (!circuitBreakerInstance) {
    circuitBreakerInstance = new CircuitBreaker(5, 20000)
  }
  return circuitBreakerInstance
}

export function getResponseCache(): ResponseCache {
  if (!responseCacheInstance) {
    responseCacheInstance = new ResponseCache(100, 5 * 60 * 1000)
  }
  return responseCacheInstance
}
