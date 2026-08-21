import { createFileRoute } from '@tanstack/react-router'

import { streamRAGQuery, type RAGStreamEvent } from '../lib/rag-service'

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

function encodeEvent(encoder: TextEncoder, event: RAGStreamEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

export const Route = createFileRoute('/api/rag/stream')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return Response.json({ error: 'Cross-origin streaming requests are not allowed.' }, { status: 403 })

        let body: { query?: unknown; language?: unknown; maxResults?: unknown }
        try {
          body = await request.json() as { query?: unknown; language?: unknown; maxResults?: unknown }
        } catch {
          return Response.json({ error: 'Invalid request body.' }, { status: 400 })
        }
        if (typeof body.query !== 'string') return Response.json({ error: 'A query is required.' }, { status: 400 })

        const abortController = new AbortController()
        request.signal.addEventListener('abort', () => abortController.abort(), { once: true })
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const event of streamRAGQuery({
                query: body.query as string,
                language: body.language === 'hi' || body.language === 'en' || body.language === 'hinglish' ? body.language : 'auto',
                maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
              }, abortController.signal)) {
                if (abortController.signal.aborted) break
                controller.enqueue(encodeEvent(encoder, event))
              }
            } catch (error) {
              if (!abortController.signal.aborted) {
                controller.enqueue(encodeEvent(encoder, { type: 'error', message: 'The answer service is unavailable. Please try again.' }))
              }
            } finally {
              controller.close()
            }
          },
          cancel() {
            abortController.abort()
          },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        })
      },
    },
  },
})
