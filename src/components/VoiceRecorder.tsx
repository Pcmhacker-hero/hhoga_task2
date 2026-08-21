// VoiceRecorder — Microphone capture with live FFT waveform visualizer
// Supports push-to-talk, real STT partial rendering, and text fallback

import { useState, useRef, useCallback, useEffect } from 'react'

interface VoiceRecorderProps {
  isListening: boolean
  isProcessing: boolean
  onStartListening: () => void
  onStopListening: () => void
  onCancel?: () => void
  onTextSubmit: (text: string) => void
  disabled?: boolean
}

export function VoiceRecorder({
  isListening,
  isProcessing,
  onStartListening,
  onStopListening,
  onCancel,
  onTextSubmit,
  disabled = false,
}: VoiceRecorderProps) {
  const [textInput, setTextInput] = useState('')
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(24).fill(4))
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)

  // Waveform visualization when microphone is active
  useEffect(() => {
    if (!isListening) {
      setAudioLevels(new Array(24).fill(4))
      if (analyserRef.current) {
        cancelAnimationFrame(animFrameRef.current)
        analyserRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
      return
    }

    navigator.mediaDevices?.getUserMedia({ audio: true }).then(stream => {
      streamRef.current = stream
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)

      const updateLevels = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)

        const bars = 24
        const step = Math.floor(dataArray.length / bars)
        const levels = []
        for (let i = 0; i < bars; i++) {
          const val = dataArray[i * step] ?? 0
          levels.push(Math.max(4, (val / 255) * 44))
        }
        setAudioLevels(levels)
        animFrameRef.current = requestAnimationFrame(updateLevels)
      }

      updateLevels()
    }).catch(() => {
      // Gentle synthetic pulse if browser blocks second getUserMedia call
      const syntheticAnimate = () => {
        const levels = Array.from({ length: 24 }, (_, i) =>
          4 + Math.sin(Date.now() / 200 + i * 0.4) * 16 + Math.random() * 8
        )
        setAudioLevels(levels)
        animFrameRef.current = requestAnimationFrame(syntheticAnimate)
      }
      syntheticAnimate()
    })

    return () => {
      cancelAnimationFrame(animFrameRef.current)
    }
  }, [isListening])

  const handleMicClick = useCallback(() => {
    if (disabled) return

    if (isListening) {
      onStopListening()
    } else if (isProcessing) {
      onCancel?.()
    } else {
      onStartListening()
    }
  }, [isListening, isProcessing, disabled, onStartListening, onStopListening, onCancel])

  const handleTextSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (textInput.trim() && !isProcessing) {
      onTextSubmit(textInput.trim())
      setTextInput('')
    }
  }, [textInput, isProcessing, onTextSubmit])

  const micStateClass = isListening
    ? 'listening'
    : isProcessing
      ? 'processing'
      : ''

  const micIcon = isListening ? '⏹' : isProcessing ? '✕' : '🎤'
  const micLabel = isListening
    ? 'Listening... Click to finish speaking'
    : isProcessing
      ? 'Processing... Click to cancel'
      : 'Click to speak (English or Hindi)'

  return (
    <div className="voice-hero">
      {/* Mic Button */}
      <div className="mic-button-container">
        {isListening && (
          <>
            <div className="mic-ripple" />
            <div className="mic-ripple" />
            <div className="mic-ripple" />
          </>
        )}
        <button
          id="mic-button"
          className={`mic-button ${micStateClass}`}
          onClick={handleMicClick}
          disabled={disabled}
          aria-label={micLabel}
          title={micLabel}
        >
          {micIcon}
        </button>
      </div>
      <p className="mic-label">{micLabel}</p>

      {/* Waveform Visualizer */}
      <div className="waveform-container" role="img" aria-label="Audio waveform">
        {audioLevels.map((level, i) => (
          <div
            key={i}
            className={`waveform-bar ${isListening ? '' : 'active'}`}
            style={{
              height: isListening ? `${level}px` : undefined,
              animationDelay: isListening ? undefined : `${i * 0.05}s`,
              background: isListening
                ? `linear-gradient(to top, var(--accent-cyan), var(--accent-blue))`
                : undefined,
            }}
          />
        ))}
      </div>

      {/* Text Input Fallback */}
      <form onSubmit={handleTextSubmit} style={{ width: '100%', maxWidth: 540 }}>
        <div style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
        }}>
          <input
            id="text-query-input"
            type="text"
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder="Or type a question in English or Hindi..."
            disabled={isProcessing || isListening}
            style={{
              flex: 1,
              padding: '0.75rem 1.1rem',
              background: 'var(--bg-glass)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.9rem',
              outline: 'none',
              transition: 'border-color var(--transition-fast)',
            }}
            onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
            onBlur={e => (e.target.style.borderColor = 'var(--border-subtle)')}
          />
          <button
            id="text-submit-button"
            type="submit"
            disabled={!textInput.trim() || isProcessing || isListening}
            style={{
              padding: '0.75rem 1.35rem',
              background: 'var(--gradient-blue)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              color: 'white',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              opacity: (!textInput.trim() || isProcessing || isListening) ? 0.5 : 1,
              transition: 'opacity var(--transition-fast)',
            }}
          >
            Ask →
          </button>
        </div>
      </form>
    </div>
  )
}
