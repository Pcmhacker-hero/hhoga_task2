// Browser STT client. Permanent ElevenLabs credentials never enter this module;
// the optional token is minted by the application server and expires after one use.

export interface STTConfig {
  token?: string
  language?: string
  onPartialTranscript?: (text: string, latencyMs: number) => void
  onFinalTranscript?: (text: string, totalMs: number, detectedLanguage?: string) => void
  onError?: (error: Error) => void
  onStateChange?: (state: 'connecting' | 'listening' | 'transcribing' | 'stopped') => void
}

export interface STTSession {
  sendAudio: (chunk: ArrayBuffer) => void
  stop: () => Promise<string>
  destroy: () => void
  getLatency: () => { firstPartialMs: number; finalMs: number }
  getDetectedLanguage: () => string | undefined
  usesManualAudio: () => boolean
}

const ELEVENLABS_STT_WS = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'


export function createSTTSession(config: STTConfig): STTSession {
  const startTime = performance.now()
  let firstPartialTime: number | null = null
  let finalTime: number | null = null
  let finalTranscript = ''
  let partialTranscript = ''
  let detectedLanguage: string | undefined
  let ws: WebSocket | null = null
  let nativeRecognition: any = null
  let resolveStop: ((text: string) => void) | null = null
  let destroyed = false
  const pendingAudio: ArrayBuffer[] = []

  const speechConstructor = typeof window !== 'undefined'
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : undefined

  const finishStop = (overrideText?: string) => {
    if (resolveStop) {
      const resolve = resolveStop
      resolveStop = null
      finalTime = Math.round(performance.now() - startTime)
      const textToReturn = overrideText !== undefined
        ? overrideText
        : (finalTranscript + ' ' + partialTranscript).trim()
      resolve(textToReturn)
    }
    config.onStateChange?.('stopped')
  }

  const markPartial = (text: string) => {
    if (!text) return
    if (firstPartialTime === null) firstPartialTime = Math.round(performance.now() - startTime)
    partialTranscript = text
    config.onStateChange?.('transcribing')
    config.onPartialTranscript?.(text, firstPartialTime)
  }

  const markFinal = (text: string, language?: string) => {
    if (!text) return
    finalTranscript = text
    partialTranscript = ''
    detectedLanguage = language ?? detectedLanguage
    finalTime = Math.round(performance.now() - startTime)
    config.onFinalTranscript?.(finalTranscript, finalTime, detectedLanguage)
  }

  const startNativeFallback = () => {
    if (!speechConstructor || nativeRecognition || destroyed) return
    try {
      nativeRecognition = new speechConstructor()
      nativeRecognition.continuous = true
      nativeRecognition.interimResults = true
      nativeRecognition.maxAlternatives = 1

      // Set recognition language
      if (config.language === 'hi') {
        nativeRecognition.lang = 'hi-IN'
      } else if (config.language === 'en') {
        nativeRecognition.lang = 'en-IN'
      } else {
        // Auto: use user browser preference or multilingual
        nativeRecognition.lang = navigator?.language || 'hi-IN'
      }

      nativeRecognition.onresult = (event: any) => {
        let fullFinal = ''
        let fullInterim = ''
        for (let i = 0; i < event.results.length; i++) {
          const item = event.results[i]
          const transcript = item?.[0]?.transcript ?? ''
          if (item?.isFinal) {
            fullFinal += (fullFinal ? ' ' : '') + transcript
          } else {
            fullInterim += (fullInterim ? ' ' : '') + transcript
          }
        }
        if (fullFinal.trim()) {
          finalTranscript = fullFinal.trim()
        }
        partialTranscript = fullInterim.trim()
        const combined = (finalTranscript + ' ' + partialTranscript).trim()
        if (combined) {
          markPartial(combined)
        }
      }

      nativeRecognition.onerror = (event: any) => {
        console.warn('Speech recognition notice:', event?.error)
      }

      nativeRecognition.onend = () => {
        if (!destroyed && !resolveStop) {
          // If stopped prematurely without user action, restart if still active
          try {
            nativeRecognition?.start()
          } catch {
            finishStop()
          }
        } else {
          finishStop()
        }
      }

      nativeRecognition.start()
      config.onStateChange?.('listening')
    } catch (err) {
      console.warn('Native speech recognition startup failed:', err)
      config.onError?.(new Error('Browser speech recognition is unavailable'))
    }
  }

  config.onStateChange?.('connecting')
  if (config.token) {
    const url = new URL(ELEVENLABS_STT_WS)
    url.searchParams.set('model_id', 'scribe_v2_realtime')
    url.searchParams.set('audio_format', 'pcm_16000')
    url.searchParams.set('token', config.token)
    if (config.language && config.language !== 'auto') url.searchParams.set('language_code', config.language)
    try {
      ws = new WebSocket(url)
      ws.onopen = () => {
        if (destroyed) return ws?.close()
        for (const audio of pendingAudio.splice(0)) sendWebSocketAudio(audio)
        config.onStateChange?.('listening')
      }
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as { message_type?: string; type?: string; text?: string; language_code?: string }
          const type = data.message_type ?? data.type
          if (type === 'partial_transcript' || type === 'interim_transcript') markPartial(data.text ?? '')
          if (type === 'committed_transcript' || type === 'final_transcript' || type === 'transcript') markFinal(data.text ?? '', data.language_code)
        } catch {
          config.onError?.(new Error('Speech service returned an invalid transcript event'))
        }
      }
      ws.onerror = () => {
        if (!destroyed) {
          startNativeFallback()
        }
      }
      ws.onclose = () => {
        ws = null
        finishStop()
      }
    } catch {
      ws = null
      startNativeFallback()
    }
  } else {
    startNativeFallback()
  }

  function sendWebSocketAudio(chunk: ArrayBuffer): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const bytes = new Uint8Array(chunk)
    let binary = ''
    for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index] ?? 0)
    ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: btoa(binary) }))
  }

  return {
    sendAudio(chunk) {
      if (ws?.readyState === WebSocket.OPEN) sendWebSocketAudio(chunk)
      else if (ws?.readyState === WebSocket.CONNECTING && pendingAudio.length < 8) pendingAudio.push(chunk)
    },
    stop() {
      return new Promise((resolve) => {
        const text = (finalTranscript + ' ' + partialTranscript).trim()
        resolveStop = resolve
        if (nativeRecognition) {
          try {
            nativeRecognition.stop()
          } catch {
            /* noop */
          }
        }
        if (ws?.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true }))
            setTimeout(() => ws?.close(), 200)
          } catch {
            /* noop */
          }
        }
        // Guarantee resolution within 250ms
        setTimeout(() => {
          finishStop(text)
        }, 250)
      })
    },
    destroy() {
      destroyed = true
      pendingAudio.length = 0
      try { nativeRecognition?.abort() } catch { /* noop */ }
      nativeRecognition = null
      try { ws?.close() } catch { /* noop */ }
      ws = null
      finishStop()
    },
    getLatency: () => ({ firstPartialMs: firstPartialTime ?? 0, finalMs: finalTime ?? Math.round(performance.now() - startTime) }),
    getDetectedLanguage: () => detectedLanguage,
    usesManualAudio: () => Boolean(ws),
  }
}

/** Captures a mono 16 kHz PCM stream and releases every audio resource on stop. */
export async function createAudioCapture(): Promise<{
  stream: MediaStream
  startStreaming: (onChunk: (chunk: ArrayBuffer) => void) => { stop: () => void }
}> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported by this browser environment')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  return {
    stream,
    startStreaming(onChunk) {
      const AudioContextConstructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextConstructor) throw new Error('Web Audio API is unavailable')
      const audioContext = new AudioContextConstructor({ sampleRate: 16000 })
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        const pcm = new Int16Array(input.length)
        for (let index = 0; index < input.length; index++) {
          const sample = Math.max(-1, Math.min(1, input[index] ?? 0))
          pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
        }
        onChunk(pcm.buffer)
      }
      source.connect(processor)
      processor.connect(audioContext.destination)
      return {
        stop() {
          processor.onaudioprocess = null
          try { processor.disconnect() } catch { /* noop */ }
          try { source.disconnect() } catch { /* noop */ }
          stream.getTracks().forEach(track => track.stop())
          void audioContext.close()
        },
      }
    },
  }
}
