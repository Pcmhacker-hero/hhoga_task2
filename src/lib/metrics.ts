// Latency metrics tracking with high-resolution percentile computation
// Ring buffer of recent query timings for P50 / P70 / P90 / P99 / P100 analysis

export interface StageTiming {
  sttMs: number                 // backwards-compatible STT final alias
  sttFirstPartialMs?: number
  sttFinalMs?: number
  embeddingMs?: number
  bm25Ms?: number
  vectorSearchMs?: number
  hybridRankingMs?: number
  retrievalMs: number
  llmTtftMs: number
  llmTotalMs: number
  guardrailsMs: number
  ttsRequestStartMs?: number
  ttsMs: number                 // backwards-compatible TTS first-audio alias
  ttsFirstAudioMs?: number
  ttsTotalMs?: number
  endToEndFirstAudioMs?: number
  totalMs: number
}

export interface QueryRecord {
  id: string
  query: string
  timestamp: number
  timing: StageTiming
}

export interface PercentileMetrics {
  mean: number
  p50: number
  p70: number
  p90: number
  p95: number
  p99: number
  p100: number
}

export interface DashboardMetrics {
  totalQueries: number
  total: PercentileMetrics
  stt: PercentileMetrics
  retrieval: PercentileMetrics
  llmTtft: PercentileMetrics
  llmTotal: PercentileMetrics
  guardrails: PercentileMetrics
  tts: PercentileMetrics
  sttFirstPartial: PercentileMetrics
  sttFinal: PercentileMetrics
  embedding: PercentileMetrics
  bm25: PercentileMetrics
  vectorSearch: PercentileMetrics
  hybridRanking: PercentileMetrics
  ttsFirstAudio: PercentileMetrics
  ttsTotal: PercentileMetrics
  endToEndFirstAudio: PercentileMetrics
  lastTiming: StageTiming | null
  history: QueryRecord[]
}

const BUFFER_SIZE = 100
const HISTORY_DISPLAY = 10

class MetricsCollector {
  private records: QueryRecord[] = []

  record(query: string, timing: StageTiming): QueryRecord {
    const record: QueryRecord = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      query,
      timestamp: Date.now(),
      timing,
    }

    this.records.push(record)

    // Keep ring buffer at max BUFFER_SIZE
    if (this.records.length > BUFFER_SIZE) {
      this.records = this.records.slice(-BUFFER_SIZE)
    }

    return record
  }

  getMetrics(): DashboardMetrics {
    if (this.records.length === 0) {
      const emptyPercentile: PercentileMetrics = { mean: 0, p50: 0, p70: 0, p90: 0, p95: 0, p99: 0, p100: 0 }
      return {
        totalQueries: 0,
        total: emptyPercentile,
        stt: emptyPercentile,
        retrieval: emptyPercentile,
        llmTtft: emptyPercentile,
        llmTotal: emptyPercentile,
        guardrails: emptyPercentile,
        tts: emptyPercentile,
        sttFirstPartial: emptyPercentile,
        sttFinal: emptyPercentile,
        embedding: emptyPercentile,
        bm25: emptyPercentile,
        vectorSearch: emptyPercentile,
        hybridRanking: emptyPercentile,
        ttsFirstAudio: emptyPercentile,
        ttsTotal: emptyPercentile,
        endToEndFirstAudio: emptyPercentile,
        lastTiming: null,
        history: [],
      }
    }

    return {
      totalQueries: this.records.length,
      total: this.computePercentiles(this.records.map(r => r.timing.totalMs)),
      stt: this.computePercentiles(this.records.map(r => r.timing.sttMs)),
      sttFirstPartial: this.computePercentiles(this.records.map(r => r.timing.sttFirstPartialMs ?? 0)),
      sttFinal: this.computePercentiles(this.records.map(r => r.timing.sttFinalMs ?? r.timing.sttMs)),
      embedding: this.computePercentiles(this.records.map(r => r.timing.embeddingMs ?? 0)),
      bm25: this.computePercentiles(this.records.map(r => r.timing.bm25Ms ?? 0)),
      vectorSearch: this.computePercentiles(this.records.map(r => r.timing.vectorSearchMs ?? 0)),
      hybridRanking: this.computePercentiles(this.records.map(r => r.timing.hybridRankingMs ?? 0)),
      retrieval: this.computePercentiles(this.records.map(r => r.timing.retrievalMs)),
      llmTtft: this.computePercentiles(this.records.map(r => r.timing.llmTtftMs)),
      llmTotal: this.computePercentiles(this.records.map(r => r.timing.llmTotalMs)),
      guardrails: this.computePercentiles(this.records.map(r => r.timing.guardrailsMs)),
      tts: this.computePercentiles(this.records.map(r => r.timing.ttsMs)),
      ttsFirstAudio: this.computePercentiles(this.records.map(r => r.timing.ttsFirstAudioMs ?? r.timing.ttsMs)),
      ttsTotal: this.computePercentiles(this.records.map(r => r.timing.ttsTotalMs ?? 0)),
      endToEndFirstAudio: this.computePercentiles(this.records.map(r => r.timing.endToEndFirstAudioMs ?? 0)),
      lastTiming: this.records[this.records.length - 1]?.timing ?? null,
      history: this.records.slice(-HISTORY_DISPLAY).reverse(),
    }
  }

  private computePercentiles(values: number[]): PercentileMetrics {
    if (values.length === 0) {
      return { mean: 0, p50: 0, p70: 0, p90: 0, p95: 0, p99: 0, p100: 0 }
    }

    const sorted = [...values].sort((a, b) => a - b)
    return {
      mean: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      p50: this.percentile(sorted, 50),
      p70: this.percentile(sorted, 70),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      p100: sorted[sorted.length - 1] ?? 0,
    }
  }

  private percentile(sorted: number[], p: number): number {
    const index = (p / 100) * (sorted.length - 1)
    const lower = Math.floor(index)
    const upper = Math.ceil(index)

    if (lower === upper) {
      return Math.round(sorted[lower] ?? 0)
    }

    const lowerVal = sorted[lower] ?? 0
    const upperVal = sorted[upper] ?? 0
    return Math.round(lowerVal + (upperVal - lowerVal) * (index - lower))
  }
}

// Singleton collector instance
export const metricsCollector = new MetricsCollector()

// High-resolution stage duration helper
export class StageTimer {
  private marks: Map<string, number> = new Map()

  mark(name: string): void {
    this.marks.set(name, performance.now())
  }

  elapsed(name: string): number {
    const start = this.marks.get(name)
    if (!start) return 0
    return Math.round(performance.now() - start)
  }

  between(startMark: string, endMark: string): number {
    const start = this.marks.get(startMark)
    const end = this.marks.get(endMark)
    if (!start || !end) return 0
    return Math.round(end - start)
  }
}

export function latencyClass(ms: number): 'fast' | 'medium' | 'slow' {
  if (ms <= 0) return 'fast'
  if (ms < 400) return 'fast'
  if (ms < 1200) return 'medium'
  return 'slow'
}

export function formatMs(ms: number): string {
  if (ms <= 0) return '0ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}
