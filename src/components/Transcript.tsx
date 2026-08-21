// Transcript — Live transcript display with sources, chunk metadata, and grounding indicators

import type { SourceCitation } from '../lib/harness'

export interface TranscriptEntry {
  id: string
  role: 'user' | 'assistant'
  text: string
  isStreaming?: boolean
  sources?: SourceCitation[]
  faithfulness?: string
  retrievalMethod?: string
  timingMs?: number
}

interface TranscriptProps {
  entries: TranscriptEntry[]
  partialTranscript?: string
}

export function Transcript({ entries, partialTranscript }: TranscriptProps) {
  if (entries.length === 0 && !partialTranscript) {
    return (
      <div className="transcript-section">
        <div className="transcript-empty">
          <p>🎙️ Ask a question to get started</p>
          <p style={{ fontSize: '0.8rem', marginTop: '0.5rem', color: 'var(--text-muted)' }}>
            Speak into the microphone or type in English / Hindi (MSMARCO-XI Knowledge Base)
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="transcript-section" id="transcript-area">
      {/* Live STT interim transcript */}
      {partialTranscript && (
        <div className="transcript-bubble user partial" style={{ opacity: 0.85, borderStyle: 'dashed' }}>
          <div className="transcript-bubble-label">🎤 Live STT Transcribing...</div>
          <p>{partialTranscript}</p>
        </div>
      )}

      {entries.map(entry => (
        <div
          key={entry.id}
          className={`transcript-bubble ${entry.role}`}
          id={`transcript-${entry.id}`}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <div className="transcript-bubble-label">
              {entry.role === 'user' ? '👤 You' : '🤖 Assistant'}
            </div>
            {entry.timingMs !== undefined && entry.timingMs > 0 && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                ⚡ {entry.timingMs}ms
              </span>
            )}
          </div>

          <p style={{ whiteSpace: 'pre-wrap' }}>{entry.text}</p>

          {entry.isStreaming && (
            <div className="streaming-dots">
              <span />
              <span />
              <span />
            </div>
          )}

          {/* Sources attribution */}
          {entry.sources && entry.sources.length > 0 && (
            <div className="transcript-sources" style={{ marginTop: '0.85rem', paddingTop: '0.65rem', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
                📚 Retrieved Sources ({entry.retrievalMethod ? `Mode: ${entry.retrievalMethod}` : 'Hybrid RRF'}):
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {entry.sources.map((src, i) => (
                  <div
                    key={`${src.id}-${i}`}
                    style={{
                      fontSize: '0.78rem',
                      background: 'rgba(255, 255, 255, 0.03)',
                      padding: '0.4rem 0.6rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ fontWeight: 600, color: 'var(--accent-blue-light)', marginRight: '0.4rem' }}>
                      [{i + 1}]
                    </span>
                    <span style={{
                      fontSize: '0.68rem',
                      background: 'rgba(59, 130, 246, 0.15)',
                      padding: '0.1rem 0.35rem',
                      borderRadius: '4px',
                      color: 'var(--accent-cyan)',
                      marginRight: '0.4rem',
                    }}>
                      {src.strategy}
                    </span>
                    {src.source && (
                      <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginRight: '0.4rem' }}>
                        {src.source} · {src.id}
                      </span>
                    )}
                    <span>{src.text.length > 140 ? `${src.text.slice(0, 140)}...` : src.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
