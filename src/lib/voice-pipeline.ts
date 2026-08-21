// End-to-end browser coordinator: microphone -> short-lived-token STT -> SSE
// RAG stream -> grounded sentence buffer -> streaming TTS -> actual playback.

import { createAudioCapture, createSTTSession, type STTSession } from './stt-client'
import { createTTSPlayer, type TTSSpeaker } from './tts-client'
import { metricsCollector, type StageTiming } from './metrics'
import type { RAGResponse } from './harness'

export type PipelineStatus = 'IDLE' | 'LISTENING' | 'TRANSCRIBING' | 'RETRIEVING' | 'GENERATING' | 'SPEAKING' | 'ERROR'

export interface VoicePipelineCallbacks {
  onStatusChange: (status: PipelineStatus) => void
  onPartialTranscript: (partial: string) => void
  onFinalTranscript: (final: string) => void
  onAssistantTextDelta: (sentence: string) => void
  onRAGResponse: (response: RAGResponse) => void
  onError: (errorMessage: string) => void
  onSpeakingStateChange: (isSpeaking: boolean) => void
  onTimingUpdate: (timing: StageTiming) => void
}

interface TokenResponse { token?: unknown }

async function fetchSTTToken(signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch('/api/voice/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'realtime_scribe' }),
      signal,
    })
    if (!response.ok) return undefined
    const payload = await response.json() as TokenResponse
    return typeof payload.token === 'string' ? payload.token : undefined
  } catch {
    return undefined
  }
}

function detectLanguage(transcript: string, providerLanguage?: string): 'hi' | 'en' | 'hinglish' | 'auto' {
  if (/[\u0900-\u097F]/.test(transcript)) return 'hi'
  const markers = /\b(?:kya|kyu|kyon|ka|ki|ke|hai|hain|mein|main|kitne|batao|bataye|bharat|desh|sawal|jawab)\b/i
  if (markers.test(transcript)) return 'hinglish'
  if (providerLanguage?.startsWith('hi')) return 'hinglish'
  return providerLanguage?.startsWith('en') ? 'en' : 'auto'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && /abort|cancel/i.test(error.message)
}

export class VoicePipeline {
  private status: PipelineStatus = 'IDLE'
  private sttSession: STTSession | null = null
  private audioStreamProcessor: { stop: () => void } | null = null
  private readonly ttsPlayer: TTSSpeaker
  private abortController: AbortController | null = null
  private operationId = 0
  private pipelineStartTime = 0
  private endOfSpeechTime = 0
  private sttFirstPartialMs = 0
  private sttFinalMs = 0
  private detectedSTTLanguage: string | undefined
  private ttsRequestStartTime = 0
  private ttsFirstAudioMs = 0
  private ttsFirstAudioAt = 0
  private ttsTotalMs = 0

  constructor(private readonly callbacks: VoicePipelineCallbacks) {
    this.ttsPlayer = createTTSPlayer({
      onPlaybackStart: firstAudioMs => {
        this.ttsFirstAudioMs = firstAudioMs
        this.ttsFirstAudioAt = performance.now()
        this.callbacks.onSpeakingStateChange(true)
        this.setStatus('SPEAKING')
      },
      onPlaybackEnd: totalMs => {
        this.ttsTotalMs = totalMs
        this.callbacks.onSpeakingStateChange(false)
      },
      onError: () => this.callbacks.onSpeakingStateChange(false),
    })
  }

  private setStatus(status: PipelineStatus): void {
    this.status = status
    this.callbacks.onStatusChange(status)
  }

  getStatus(): PipelineStatus {
    return this.status
  }

  async startListening(language: 'hi' | 'en' | 'auto' = 'auto'): Promise<void> {
    this.cancel()
    const operationId = ++this.operationId
    this.abortController = new AbortController()
    this.pipelineStartTime = performance.now()
    this.endOfSpeechTime = 0
    this.sttFirstPartialMs = 0
    this.sttFinalMs = 0
    this.detectedSTTLanguage = undefined
    this.ttsFirstAudioMs = 0
    this.ttsFirstAudioAt = 0
    this.ttsTotalMs = 0
    this.setStatus('LISTENING')

    try {
      const token = await fetchSTTToken(this.abortController.signal)
      if (!this.isCurrent(operationId)) return
      this.sttSession = createSTTSession({
        token,
        language,
        onPartialTranscript: (partial, latency) => {
          if (!this.isCurrent(operationId)) return
          this.sttFirstPartialMs ||= latency
          this.setStatus('TRANSCRIBING')
          this.callbacks.onPartialTranscript(partial)
        },
        onFinalTranscript: (final, latency, detectedLanguage) => {
          if (!this.isCurrent(operationId)) return
          this.sttFinalMs = latency
          this.detectedSTTLanguage = detectedLanguage
          this.callbacks.onFinalTranscript(final)
        },
        onError: () => {
          // A cloud-STT failure can still be recovered by the browser recognizer.
        },
      })
      if (this.sttSession.usesManualAudio()) {
        const capture = await createAudioCapture()
        if (!this.isCurrent(operationId)) {
          capture.stream.getTracks().forEach(track => track.stop())
          return
        }
        this.audioStreamProcessor = capture.startStreaming(chunk => this.sttSession?.sendAudio(chunk))
      }
    } catch (error) {
      if (isAbort(error) || !this.isCurrent(operationId)) return
      this.setStatus('ERROR')
      this.callbacks.onError('Microphone access is unavailable. Please check browser permissions.')
      this.cleanupAudio()
    }
  }

  async stopListeningAndExecute(): Promise<void> {
    if (this.status !== 'LISTENING' && this.status !== 'TRANSCRIBING') return
    const operationId = this.operationId
    this.endOfSpeechTime = performance.now()
    this.setStatus('RETRIEVING')
    this.audioStreamProcessor?.stop()
    this.audioStreamProcessor = null

    let transcript = ''
    if (this.sttSession) {
      transcript = await this.sttSession.stop()
      const latency = this.sttSession.getLatency()
      this.sttFirstPartialMs ||= latency.firstPartialMs
      this.sttFinalMs = latency.finalMs
      this.detectedSTTLanguage = this.sttSession.getDetectedLanguage() ?? this.detectedSTTLanguage
      this.sttSession.destroy()
      this.sttSession = null
    }
    if (!this.isCurrent(operationId) || !transcript.trim()) {
      if (this.isCurrent(operationId)) this.setStatus('IDLE')
      return
    }
    await this.processQuery(transcript.trim(), detectLanguage(transcript, this.detectedSTTLanguage), operationId)
  }

  async processQuery(query: string, language: 'hi' | 'en' | 'hinglish' | 'auto' = 'auto', existingOperationId?: number): Promise<void> {
    const operationId = existingOperationId ?? ++this.operationId
    if (!this.abortController || !existingOperationId) this.abortController = new AbortController()
    if (!this.pipelineStartTime) this.pipelineStartTime = performance.now()
    if (!this.endOfSpeechTime) this.endOfSpeechTime = performance.now()
    this.ttsFirstAudioMs = 0
    this.ttsFirstAudioAt = 0
    this.ttsTotalMs = 0
    this.setStatus('RETRIEVING')
    const signal = this.abortController.signal
    let response: RAGResponse | null = null

    try {
      // Token creation and the RAG retrieval run concurrently. TTS only receives
      // complete, server-grounded sentences, never raw individual LLM tokens.
      this.ttsRequestStartTime = performance.now()
      const ttsReady = this.ttsPlayer.startStreaming(signal).catch(() => {})
      const streamResponse = await fetch('/api/rag/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ query, language }),
        signal,
      })
      if (!streamResponse.ok || !streamResponse.body) throw new Error('Answer service is unavailable')
      this.setStatus('GENERATING')

      const reader = streamResponse.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      const handleEvent = async (rawEvent: string) => {
        const dataLine = rawEvent.split('\n').find(line => line.startsWith('data:'))
        if (!dataLine) return
        const event = JSON.parse(dataLine.slice(5).trim()) as { type?: string; text?: string; response?: RAGResponse; message?: string }
        if (event.type === 'sentence' && event.text) {
          this.callbacks.onAssistantTextDelta(event.text)
          try { await ttsReady } catch { /* noop */ }
          if (this.isCurrent(operationId)) this.ttsPlayer.pushText(event.text)
        } else if (event.type === 'complete' && event.response) {
          response = event.response
          this.callbacks.onRAGResponse(event.response)
        } else if (event.type === 'error') {
          throw new Error(event.message || 'Answer service is unavailable')
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const events = pending.split('\n\n')
        pending = events.pop() ?? ''
        for (const rawEvent of events) {
          if (!this.isCurrent(operationId)) return
          await handleEvent(rawEvent)
        }
      }
      if (pending.trim()) await handleEvent(pending)
      if (!this.isCurrent(operationId)) return
      try {
        await ttsReady
        await this.ttsPlayer.endStream()
      } catch {
        /* TTS cleanup shouldn't block */
      }
      const finalResponse = response as RAGResponse | null
      if (!finalResponse) throw new Error('Answer stream completed without a response')

      const timing: StageTiming = {
        sttMs: this.sttFinalMs,
        sttFirstPartialMs: this.sttFirstPartialMs,
        sttFinalMs: this.sttFinalMs,
        embeddingMs: finalResponse.timing.embeddingMs,
        bm25Ms: finalResponse.timing.bm25Ms ?? 0,
        vectorSearchMs: finalResponse.timing.vectorSearchMs ?? 0,
        hybridRankingMs: finalResponse.timing.hybridRankingMs ?? 0,
        retrievalMs: finalResponse.timing.retrievalMs,
        llmTtftMs: finalResponse.timing.llmTtftMs ?? 0,
        llmTotalMs: finalResponse.timing.llmMs,
        guardrailsMs: finalResponse.timing.guardrailsMs,
        ttsRequestStartMs: Math.round(this.ttsRequestStartTime - this.endOfSpeechTime),
        ttsMs: this.ttsFirstAudioMs,
        ttsFirstAudioMs: this.ttsFirstAudioMs,
        ttsTotalMs: this.ttsTotalMs,
        endToEndFirstAudioMs: this.ttsFirstAudioAt > 0 ? Math.round(this.ttsFirstAudioAt - this.endOfSpeechTime) : 0,
        totalMs: Math.round(performance.now() - this.pipelineStartTime),
      }
      metricsCollector.record(query, timing)
      this.callbacks.onTimingUpdate(timing)
      this.setStatus('IDLE')
    } catch (error) {
      if (isAbort(error) || !this.isCurrent(operationId)) return
      this.setStatus('ERROR')
      this.callbacks.onError(error instanceof Error ? error.message : 'Unable to process the request')
    } finally {
      if (this.isCurrent(operationId)) this.pipelineStartTime = 0
    }
  }

  cancel(): void {
    this.operationId++
    this.abortController?.abort()
    this.abortController = null
    this.cleanupAudio()
    this.ttsPlayer.stop()
    this.callbacks.onSpeakingStateChange(false)
    this.setStatus('IDLE')
  }

  destroy(): void {
    this.cancel()
  }

  private cleanupAudio(): void {
    this.audioStreamProcessor?.stop()
    this.audioStreamProcessor = null
    this.sttSession?.destroy()
    this.sttSession = null
  }

  private isCurrent(operationId: number): boolean {
    return operationId === this.operationId && !this.abortController?.signal.aborted
  }
}
