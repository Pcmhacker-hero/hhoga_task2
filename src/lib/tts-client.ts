// Incremental TTS client. It receives a short-lived server-minted token and
// streams PCM from ElevenLabs' input WebSocket as grounded LLM sentences arrive.

export interface TTSConfig {
  onPlaybackStart?: (firstAudioLatencyMs: number) => void
  onPlaybackEnd?: (totalDurationMs: number) => void
  onError?: (error: Error) => void
}

export interface TTSSpeaker {
  startStreaming: (signal?: AbortSignal) => Promise<void>
  pushText: (text: string) => void
  endStream: () => Promise<void>
  speak: (text: string, signal?: AbortSignal) => Promise<void>
  stop: () => void
  isPlaying: () => boolean
}

interface VoiceToken {
  token: string
  voiceId: string
}

const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'
const PCM_SAMPLE_RATE = 24000

async function fetchVoiceToken(type: 'tts_websocket', signal?: AbortSignal): Promise<VoiceToken> {
  const response = await fetch('/api/voice/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
    signal,
  })
  if (!response.ok) throw new Error('Streaming voice service is unavailable')
  const payload = await response.json() as { token?: unknown; voiceId?: unknown }
  if (typeof payload.token !== 'string' || !payload.token) throw new Error('Streaming voice service returned an invalid token')
  return { token: payload.token, voiceId: typeof payload.voiceId === 'string' ? payload.voiceId : DEFAULT_VOICE_ID }
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

/** Schedules PCM chunks on one AudioContext without inter-chunk gaps. */
export class AudioChunkPlayer {
  private context: AudioContext | null = null
  private nextStartTime = 0
  private activeSources = new Set<AudioBufferSourceNode>()
  private inputFinished = false
  private playbackStarted = false
  private playbackEnded = false
  private readonly sampleRate: number
  onPlaybackStart?: () => void
  onPlaybackEnd?: () => void

  constructor(sampleRate = PCM_SAMPLE_RATE) {
    this.sampleRate = sampleRate
  }

  begin(): void {
    this.stop(false)
    this.inputFinished = false
    this.playbackStarted = false
    this.playbackEnded = false
    this.nextStartTime = 0
  }

  enqueuePCM(chunk: ArrayBuffer): void {
    if (chunk.byteLength === 0 || this.inputFinished) return
    const context = this.getContext()
    const samples = new Int16Array(chunk)
    if (samples.length === 0) return
    const channel = new Float32Array(samples.length)
    for (let index = 0; index < samples.length; index++) channel[index] = (samples[index] ?? 0) / 32768
    const buffer = context.createBuffer(1, channel.length, this.sampleRate)
    buffer.copyToChannel(channel, 0)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    const startAt = Math.max(context.currentTime + 0.025, this.nextStartTime)
    this.nextStartTime = startAt + buffer.duration
    this.activeSources.add(source)
    source.onended = () => {
      this.activeSources.delete(source)
      this.maybeFinish()
    }
    if (!this.playbackStarted) {
      this.playbackStarted = true
      this.onPlaybackStart?.()
    }
    source.start(startAt)
  }

  finishInput(): void {
    this.inputFinished = true
    this.maybeFinish()
  }

  stop(notify = true): void {
    for (const source of this.activeSources) {
      try { source.stop() } catch { /* already stopped */ }
    }
    this.activeSources.clear()
    if (this.context && this.context.state !== 'closed') void this.context.close()
    this.context = null
    this.inputFinished = true
    if (notify && this.playbackStarted && !this.playbackEnded) {
      this.playbackEnded = true
      this.onPlaybackEnd?.()
    }
  }

  get playing(): boolean {
    return this.playbackStarted && !this.playbackEnded
  }

  private getContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      const AudioContextConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextConstructor) throw new Error('Web Audio API is unavailable')
      this.context = new AudioContextConstructor({ sampleRate: this.sampleRate })
    }
    if (this.context.state === 'suspended') void this.context.resume()
    return this.context
  }

  private maybeFinish(): void {
    if (this.inputFinished && this.activeSources.size === 0 && this.playbackStarted && !this.playbackEnded) {
      this.playbackEnded = true
      this.onPlaybackEnd?.()
    }
  }
}

export function createTTSPlayer(config: TTSConfig): TTSSpeaker {
  const player = new AudioChunkPlayer()
  let streamSocket: WebSocket | null = null
  let mode: 'idle' | 'elevenlabs' | 'native' = 'idle'
  let sessionStart = 0
  let finished = false
  let nativeCurrent: SpeechSynthesisUtterance | null = null
  let nativeQueue: string[] = []
  let nativeInputFinished = false
  let resolveFinished: (() => void) | null = null
  let rejectFinished: ((error: Error) => void) | null = null
  let finishedPromise: Promise<void> = Promise.resolve()

  const complete = () => {
    if (finished) return
    finished = true
    const elapsed = Math.round(performance.now() - sessionStart)
    resolveFinished?.()
    resolveFinished = null
    rejectFinished = null
    config.onPlaybackEnd?.(elapsed)
  }

  const fail = (error: Error) => {
    if (finished) return
    config.onError?.(error)
    rejectFinished?.(error)
    resolveFinished = null
    rejectFinished = null
    finished = true
  }

  const startNative = () => {
    mode = 'native'
    nativeQueue = []
    nativeInputFinished = false
  }

  const drainNative = () => {
    if (mode !== 'native' || nativeCurrent || nativeQueue.length === 0) {
      if (mode === 'native' && nativeInputFinished && !nativeCurrent && nativeQueue.length === 0) complete()
      return
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      fail(new Error('No text-to-speech engine is available in this browser'))
      return
    }
    const text = nativeQueue.shift()
    if (!text) return
    const utterance = new SpeechSynthesisUtterance(text)
    nativeCurrent = utterance
    utterance.lang = /[\u0900-\u097F]/.test(text) ? 'hi-IN' : 'en-IN'
    utterance.onstart = () => config.onPlaybackStart?.(Math.round(performance.now() - sessionStart))
    utterance.onend = () => {
      nativeCurrent = null
      drainNative()
    }
    utterance.onerror = () => {
      nativeCurrent = null
      drainNative()
    }
    window.speechSynthesis.speak(utterance)
  }

  const startStreaming = async (signal?: AbortSignal) => {
    if (mode !== 'idle') return
    sessionStart = performance.now()
    finished = false
    finishedPromise = new Promise<void>((resolve, reject) => {
      resolveFinished = resolve
      rejectFinished = reject
    })
    player.begin()
    player.onPlaybackStart = () => config.onPlaybackStart?.(Math.round(performance.now() - sessionStart))
    player.onPlaybackEnd = complete

    let credential: VoiceToken
    try {
      credential = await fetchVoiceToken('tts_websocket', signal)
    } catch {
      startNative()
      return
    }
    if (signal?.aborted) throw new Error('Operation aborted')

    const url = new URL(`wss://api.elevenlabs.io/v1/text-to-speech/${credential.voiceId}/stream-input`)
    url.searchParams.set('model_id', 'eleven_flash_v2_5')
    url.searchParams.set('output_format', 'pcm_24000')
    url.searchParams.set('single_use_token', credential.token)
    url.searchParams.set('auto_mode', 'true')
    mode = 'elevenlabs'

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Streaming voice connection timed out')), 8000)
      streamSocket = new WebSocket(url.toString())
      streamSocket.onopen = () => {
        window.clearTimeout(timeout)
        streamSocket?.send(JSON.stringify({
          text: ' ',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          generation_config: { chunk_length_schedule: [80, 120, 180, 240] },
        }))
        resolve()
      }
      streamSocket.onmessage = event => {
        try {
          const payload = JSON.parse(String(event.data)) as { audio?: string; is_final?: boolean; isFinal?: boolean }
          if (payload.audio) player.enqueuePCM(decodeBase64(payload.audio))
          if (payload.is_final || payload.isFinal) player.finishInput()
        } catch {
          fail(new Error('Streaming voice service returned invalid audio'))
        }
      }
      streamSocket.onerror = () => {
        window.clearTimeout(timeout)
        if (!finished) fail(new Error('Streaming voice service failed'))
        reject(new Error('Streaming voice service failed'))
      }
      streamSocket.onclose = () => {
        window.clearTimeout(timeout)
        if (!finished) player.finishInput()
      }
      signal?.addEventListener('abort', () => {
        window.clearTimeout(timeout)
        try { streamSocket?.close() } catch { /* noop */ }
        reject(new Error('Operation aborted'))
      }, { once: true })
    }).catch(error => {
      streamSocket = null
      if (signal?.aborted) throw error
      // Connection failures before text is submitted can safely fall back.
      startNative()
    })
  }

  return {
    startStreaming,
    pushText(text) {
      const phrase = text.trim()
      if (!phrase || finished) return
      if (mode === 'native') {
        nativeQueue.push(phrase)
        drainNative()
        return
      }
      if (mode === 'elevenlabs' && streamSocket?.readyState === WebSocket.OPEN) {
        streamSocket.send(JSON.stringify({ text: `${phrase} ` }))
      }
    },
    endStream() {
      if (mode === 'idle') return Promise.resolve()
      if (mode === 'native') {
        nativeInputFinished = true
        drainNative()
      } else if (mode === 'elevenlabs' && streamSocket?.readyState === WebSocket.OPEN) {
        streamSocket.send(JSON.stringify({ text: '' }))
      } else if (mode === 'elevenlabs') {
        player.finishInput()
      }
      return finishedPromise
    },
    async speak(text, signal) {
      await startStreaming(signal)
      this.pushText(text)
      await this.endStream()
    },
    stop() {
      try { streamSocket?.close() } catch { /* noop */ }
      streamSocket = null
      player.stop(false)
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
      nativeCurrent = null
      nativeQueue = []
      nativeInputFinished = true
      resolveFinished?.()
      resolveFinished = null
      rejectFinished = null
      finished = true
      mode = 'idle'
    },
    isPlaying: () => player.playing || Boolean(nativeCurrent) || (typeof window !== 'undefined' && window.speechSynthesis?.speaking === true),
  }
}
