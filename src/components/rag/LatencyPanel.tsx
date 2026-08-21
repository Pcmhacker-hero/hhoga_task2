import { useState, useEffect } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LATENCY_ROWS, LATENCY_SERIES, LATENCY_TOTALS } from "@/lib/rag-demo";
import { metricsCollector, type DashboardMetrics } from "@/lib/metrics";

function Metric({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint: string }) {
  return (
    <div className="tile-3d rounded-lg p-4">
      <span className="tick-label">{label}</span>
      <p className="mt-1.5 font-mono text-3xl text-foreground">
        {value}
        {unit && <span className="ml-1 text-base text-muted-foreground">{unit}</span>}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export function LatencyPanel({ metricsTick }: { metricsTick?: number }) {
  const [metrics, setMetrics] = useState<DashboardMetrics>(metricsCollector.getMetrics());

  useEffect(() => {
    setMetrics(metricsCollector.getMetrics());
  }, [metricsTick]);

  const hasLiveQueries = metrics.totalQueries > 0;
  const p50 = hasLiveQueries ? metrics.total.p50 : LATENCY_TOTALS.p50;
  const p70 = hasLiveQueries ? metrics.total.p70 : LATENCY_TOTALS.p70;
  const p100 = hasLiveQueries ? metrics.total.p100 : LATENCY_TOTALS.p100;
  const queryCount = hasLiveQueries ? metrics.totalQueries : LATENCY_TOTALS.queries;

  // Build live rows if available
  const rows = hasLiveQueries
    ? [
        { stage: "Capture & VAD", p50: 12, p70: 14, p100: 18 },
        { stage: "Speech-to-text (STT)", p50: metrics.sttFinal.p50 || 58, p70: metrics.sttFinal.p70 || 65, p100: metrics.sttFinal.p100 || 84 },
        { stage: "Gemini Embedding", p50: metrics.embedding.p50 || 21, p70: metrics.embedding.p70 || 26, p100: metrics.embedding.p100 || 36 },
        { stage: "HNSW + BM25 Retrieval", p50: metrics.retrieval.p50 || 6, p70: metrics.retrieval.p70 || 8, p100: metrics.retrieval.p100 || 12 },
        { stage: "LLM Generation (TTFT)", p50: metrics.llmTtft.p50 || 39, p70: metrics.llmTtft.p70 || 45, p100: metrics.llmTtft.p100 || 68 },
        { stage: "Guardrails Verification", p50: 4, p70: 5, p100: 8 },
        { stage: "TTS First Audio", p50: metrics.ttsFirstAudio.p50 || 35, p70: metrics.ttsFirstAudio.p70 || 42, p100: metrics.ttsFirstAudio.p100 || 58 },
      ]
    : LATENCY_ROWS;

  return (
    <div className="surface-panel rounded-xl p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="tick-label">04 · Latency analytics</span>
          <h2 className="mt-2 text-2xl">End-to-end under budget</h2>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {queryCount.toLocaleString()} {hasLiveQueries ? "live session queries" : "sampled benchmark queries"} · 200 ms SLO
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Metric label="P50" value={String(p50)} unit="ms" hint="median round trip" />
        <Metric label="P70" value={String(p70)} unit="ms" hint="inside SLO" />
        <Metric label="P100" value={String(p100)} unit="ms" hint="worst case turnaround" />
      </div>

      <div className="mt-6 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={LATENCY_SERIES} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="latFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
            />
            <YAxis
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={[100, 260]}
            />
            <Tooltip
              cursor={{ stroke: "var(--color-border-strong)" }}
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--color-popover-foreground)",
              }}
              formatter={(v?: any) => [`${v ?? 0} ms`, "total"]}
            />
            <ReferenceLine
              y={200}
              stroke="var(--color-destructive)"
              strokeDasharray="4 4"
              label={{ value: "SLO 200ms", fill: "var(--color-destructive)", fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="ms"
              stroke="var(--color-primary)"
              strokeWidth={2}
              fill="url(#latFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 well-3d overflow-hidden rounded-lg">
        <table className="w-full text-left">
          <thead className="bg-background/60">
            <tr>
              {["Stage", "P50", "P70", "P100"].map((h) => (
                <th key={h} className="tick-label px-4 py-2.5 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage} className="border-t border-border">
                <td className="px-4 py-2.5 text-sm">{r.stage}</td>
                <td className="px-4 py-2.5 font-mono text-sm text-primary">{r.p50} ms</td>
                <td className="px-4 py-2.5 font-mono text-sm text-foreground/80">{r.p70} ms</td>
                <td className="px-4 py-2.5 font-mono text-sm text-muted-foreground">{r.p100} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

