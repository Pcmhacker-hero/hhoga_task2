// Compatibility endpoint for non-streaming callers. The interactive browser
// pipeline uses /api/rag/stream so it can receive grounded sentences as they arrive.

import { createServerFn } from '@tanstack/react-start'

import { completeRAGQuery } from './rag-service'
import type { RAGResponse } from './harness'

export const processRAGQuery = createServerFn({ method: 'POST' })
  .validator((data: { query: string; language?: 'hi' | 'en' | 'hinglish' | 'auto'; maxResults?: number }) => data)
  .handler(async ({ data }): Promise<RAGResponse> => completeRAGQuery(data))
