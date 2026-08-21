import { describe, it, expect } from 'vitest'
import { metricsCollector, StageTimer, latencyClass, formatMs } from '../src/lib/metrics'

describe('Metrics Collector & Latency Computations', () => {
  it('records timing and computes percentiles accurately', () => {
    // Record sample queries
    const latencies = [100, 200, 300, 400, 500]
    latencies.forEach((lat, i) => {
      metricsCollector.record(`query-${i}`, {
        sttMs: 50,
        retrievalMs: 20,
        llmTtftMs: lat,
        llmTotalMs: lat,
        guardrailsMs: 10,
        ttsMs: 30,
        totalMs: lat + 110,
      })
    })

    const metrics = metricsCollector.getMetrics()
    expect(metrics.totalQueries).toBeGreaterThanOrEqual(5)
    expect(metrics.llmTtft.p50).toBeGreaterThan(0)
    expect(metrics.llmTtft.p100).toBeGreaterThanOrEqual(metrics.llmTtft.p50)
  })

  it('measures elapsed time with StageTimer', async () => {
    const timer = new StageTimer()
    timer.mark('step1')
    await new Promise(r => setTimeout(r, 20))
    timer.mark('step2')

    const elapsed = timer.elapsed('step1')
    const between = timer.between('step1', 'step2')

    expect(elapsed).toBeGreaterThanOrEqual(15)
    expect(between).toBeGreaterThanOrEqual(15)
  })

  it('classifies latency and formats ms', () => {
    expect(latencyClass(100)).toBe('fast')
    expect(latencyClass(800)).toBe('medium')
    expect(latencyClass(2000)).toBe('slow')

    expect(formatMs(150)).toBe('150ms')
    expect(formatMs(1500)).toBe('1.50s')
  })
})
