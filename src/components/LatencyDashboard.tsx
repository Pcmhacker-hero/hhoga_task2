// LatencyDashboard — P50 / P70 / P90 / P100 metrics display
// Collapsible analytics panel with stage breakdown bars, percentile table, and query history

import { useState } from 'react'
import {
  type DashboardMetrics,
  type PercentileMetrics,
  formatMs,
  latencyClass,
} from '../lib/metrics'

interface LatencyDashboardProps {
  metrics: DashboardMetrics
}

export function LatencyDashboard({ metrics }: LatencyDashboardProps) {
  const [isOpen, setIsOpen] = useState(true)

  return (
    <div className="dashboard-section" id="latency-dashboard">
      <button
        className="dashboard-toggle"
        onClick={() => setIsOpen(prev => !prev)}
        id="dashboard-toggle"
      >
        <span>📊 Real-Time Latency Analytics</span>
        <span className={`dashboard-toggle-icon ${isOpen ? 'open' : ''}`}>▼</span>
        {metrics.totalQueries > 0 && (
          <span style={{
            background: 'var(--gradient-blue)',
            padding: '0.1rem 0.6rem',
            borderRadius: 'var(--radius-full)',
            fontSize: '0.7rem',
            fontWeight: 700,
            color: 'white',
          }}>
            {metrics.totalQueries} {metrics.totalQueries === 1 ? 'query' : 'queries'}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="dashboard-grid">
          {/* Summary Metric Cards */}
          <div className="glass-card metric-card">
            <div className="metric-card-label">End-to-End P50</div>
            <div className={`metric-card-value ${latencyClass(metrics.total.p50)}`}>
              {metrics.totalQueries > 0 ? formatMs(metrics.total.p50) : '—'}
            </div>
          </div>
          <div className="glass-card metric-card">
            <div className="metric-card-label">First Audio P95</div>
            <div className={`metric-card-value ${latencyClass(metrics.endToEndFirstAudio.p95)}`}>
              {metrics.totalQueries > 0 ? formatMs(metrics.endToEndFirstAudio.p95) : '—'}
            </div>
          </div>
          <div className="glass-card metric-card">
            <div className="metric-card-label">Retrieval P50</div>
            <div className={`metric-card-value ${latencyClass(metrics.retrieval.p50)}`}>
              {metrics.totalQueries > 0 ? formatMs(metrics.retrieval.p50) : '—'}
            </div>
          </div>
          <div className="glass-card metric-card">
            <div className="metric-card-label">LLM TTFT P50</div>
            <div className={`metric-card-value ${latencyClass(metrics.llmTtft.p50)}`}>
              {metrics.totalQueries > 0 ? formatMs(metrics.llmTtft.p50) : '—'}
            </div>
          </div>

          {/* Last Query Breakdown */}
          {metrics.lastTiming && (
            <div className="glass-card" style={{ gridColumn: '1 / -1' }}>
              <div className="glass-card-header">
                <span className="glass-card-title">Last Pipeline Execution Breakdown</span>
                <span style={{
                  fontSize: '0.78rem',
                  color: 'var(--accent-cyan)',
                  fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  Total: {formatMs(metrics.lastTiming.totalMs)}
                </span>
              </div>
              <div className="glass-card-body">
                <StageBreakdown timing={metrics.lastTiming} />
              </div>
            </div>
          )}

          {/* Percentile Table */}
          {metrics.totalQueries > 0 && (
            <div className="glass-card" style={{ gridColumn: '1 / -1' }}>
              <div className="glass-card-header">
                <span className="glass-card-title">Stage Percentile Distribution</span>
              </div>
              <div className="glass-card-body">
                <PercentileTable metrics={metrics} />
              </div>
            </div>
          )}

          {/* Query History */}
          {metrics.history.length > 0 && (
            <div className="glass-card" style={{ gridColumn: '1 / -1' }}>
              <div className="glass-card-header">
                <span className="glass-card-title">Recent Query Latency History</span>
              </div>
              <div className="glass-card-body">
                <QueryHistory history={metrics.history} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StageBreakdown({ timing }: { timing: DashboardMetrics['lastTiming'] }) {
  if (!timing) return null

  const maxMs = Math.max(
    timing.sttMs,
    timing.retrievalMs,
    timing.llmTotalMs,
    timing.ttsMs,
    timing.guardrailsMs,
    1
  )

  const stages = [
    { label: 'STT Audio', value: timing.sttMs, cssClass: 'stt' },
    { label: 'RRF Retrieval', value: timing.retrievalMs, cssClass: 'retrieval' },
    { label: 'LLM Gen', value: timing.llmTotalMs, cssClass: 'llm' },
    { label: 'Guardrails', value: timing.guardrailsMs, cssClass: 'guardrails' },
    { label: 'TTS Playback', value: timing.ttsMs, cssClass: 'tts' },
  ]

  return (
    <div className="stage-breakdown">
      {stages.map(stage => (
        <div key={stage.label} className="stage-row">
          <span className="stage-label">{stage.label}</span>
          <div className="stage-bar-container">
            <div
              className={`stage-bar ${stage.cssClass}`}
              style={{ width: `${Math.max((stage.value / maxMs) * 100, stage.value > 0 ? 3 : 0)}%` }}
            />
          </div>
          <span className="stage-value">{formatMs(stage.value)}</span>
        </div>
      ))}
    </div>
  )
}

function PercentileTable({ metrics }: { metrics: DashboardMetrics }) {
  const rows: { label: string; data: PercentileMetrics }[] = [
    { label: 'End-to-End First Audio', data: metrics.endToEndFirstAudio },
    { label: 'STT First Partial', data: metrics.sttFirstPartial },
    { label: 'STT Final Transcript', data: metrics.sttFinal },
    { label: 'Embedding', data: metrics.embedding },
    { label: 'RRF Retrieval', data: metrics.retrieval },
    { label: 'LLM TTFT', data: metrics.llmTtft },
    { label: 'LLM Total', data: metrics.llmTotal },
    { label: 'TTS First Audio', data: metrics.ttsFirstAudio },
    { label: 'TTS Total', data: metrics.ttsTotal },
  ]

  return (
    <table className="percentile-table">
      <thead>
        <tr>
          <th>Pipeline Stage</th>
          <th>Mean</th>
          <th>P50</th>
          <th>P70</th>
          <th>P90</th>
          <th>P95</th>
          <th>P100</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.label}>
            <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{row.label}</td>
            <td className={latencyClass(row.data.mean)}>{formatMs(row.data.mean)}</td>
            <td className={latencyClass(row.data.p50)}>{formatMs(row.data.p50)}</td>
            <td className={latencyClass(row.data.p70)}>{formatMs(row.data.p70)}</td>
            <td className={latencyClass(row.data.p90)}>{formatMs(row.data.p90)}</td>
            <td className={latencyClass(row.data.p95)}>{formatMs(row.data.p95)}</td>
            <td className={latencyClass(row.data.p100)}>{formatMs(row.data.p100)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function QueryHistory({ history }: { history: DashboardMetrics['history'] }) {
  return (
    <div className="query-history">
      {history.map(record => (
        <div key={record.id} className="query-history-item">
          <span className="query-history-text" title={record.query}>
            {record.query}
          </span>
          <span className={`query-history-time ${latencyClass(record.timing.totalMs)}`}>
            {formatMs(record.timing.totalMs)}
          </span>
        </div>
      ))}
    </div>
  )
}
