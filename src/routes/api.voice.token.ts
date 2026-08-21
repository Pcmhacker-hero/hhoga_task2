import { createFileRoute } from '@tanstack/react-router'

type TokenType = 'realtime_scribe' | 'tts_websocket'

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || origin === new URL(request.url).origin
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export const Route = createFileRoute('/api/voice/token')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return errorResponse('Cross-origin token requests are not allowed.', 403)

        const apiKey = process.env.ELEVENLABS_API_KEY
        if (!apiKey) return errorResponse('Voice provider is not configured.', 503)

        let type: TokenType | undefined
        try {
          const body = await request.json() as { type?: unknown }
          if (body.type === 'realtime_scribe' || body.type === 'tts_websocket') type = body.type
        } catch {
          return errorResponse('Invalid token request.', 400)
        }
        if (!type) return errorResponse('Unsupported voice token type.', 400)

        try {
          // Map token type to correct ElevenLabs API endpoint
          const endpointMap: Record<TokenType, string> = {
            realtime_scribe: 'https://api.elevenlabs.io/v1/speech-to-text/get-single-use-token',
            tts_websocket: 'https://api.elevenlabs.io/v1/text-to-speech/get-single-use-token',
          }
          const providerResponse = await fetch(endpointMap[type], {
            method: 'POST',
            headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
            signal: request.signal,
          })
          if (!providerResponse.ok) return errorResponse('Voice provider token request failed.', 502)
          const payload = await providerResponse.json() as { token?: unknown }
          if (typeof payload.token !== 'string' || !payload.token) return errorResponse('Voice provider returned an invalid token.', 502)
          return Response.json(
            { token: payload.token, voiceId: process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb' },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch {
          return errorResponse('Voice provider is unavailable.', 503)
        }
      },
    },
  },
})
