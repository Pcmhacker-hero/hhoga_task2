import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, ExternalLink, Waypoints } from "lucide-react";
import { VoiceConsole } from "@/components/rag/VoiceConsole";
import { LatencyPanel } from "@/components/rag/LatencyPanel";
import { ArchitecturePanel } from "@/components/rag/ArchitecturePanel";
import { HeroVisual } from "@/components/rag/HeroVisual";
import { LATENCY_TOTALS } from "@/lib/rag-demo";

const TITLE = "VOX-RAG · Voice-Enabled Retrieval Console";
const DESCRIPTION =
  "A sub-200ms voice RAG pipeline over MSMARCO-XI: streaming speech-to-text, multi-strategy chunking, vector retrieval, harnessed generation and grounding guardrails.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [metricsTick, setMetricsTick] = useState(0);

  return (
    <div className="relative min-h-screen">
      <div className="grid-backdrop pointer-events-none absolute inset-x-0 top-0 h-[560px]" />

      <header className="relative mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-md bg-[image:var(--gradient-primary)] text-primary-foreground">
            <Waypoints className="size-4" />
          </span>
          <span className="font-display text-sm tracking-tight">
            VOX<span className="text-primary">·</span>RAG
          </span>
        </div>
        <nav className="flex items-center gap-5">
          <span className="hidden items-center gap-2 font-mono text-[11px] text-muted-foreground sm:flex">
            <span className="size-1.5 rounded-full bg-success animate-pulse" />
            MSMARCO-XI · 197 chunks indexed · sub-10ms retrieval
          </span>
          <a
            href="https://huggingface.co/datasets/ai4bharat/MSMARCO-XI"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            dataset
          </a>
        </nav>
      </header>

      <main className="relative mx-auto max-w-7xl px-6 pb-24">
        <section className="grid items-center gap-10 pt-10 pb-12 sm:pt-16 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3 py-1 font-mono text-[11px] text-muted-foreground">
              <Activity className="size-3.5 text-primary" />
              p50 {LATENCY_TOTALS.p50} ms · p70 {LATENCY_TOTALS.p70} ms · p100 {LATENCY_TOTALS.p100} ms
            </span>
            <h1 className="mt-5 max-w-3xl text-balance text-5xl leading-[1.02] sm:text-6xl">
              Speak a question.
              <br />
              <span className="text-gradient">Get a grounded answer</span> before you blink.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
              A voice-first retrieval pipeline over MSMARCO-XI — streaming ASR, a five-strategy chunk
              portfolio, HNSW/Cosine retrieval with Reciprocal Rank Fusion, and a guardrailed harness that
              refuses anything it can't cite.
            </p>
          </div>
          <HeroVisual />
        </section>

        <div className="stage-3d space-y-4">
          <VoiceConsole onMetricsUpdate={() => setMetricsTick((t) => t + 1)} />
          <LatencyPanel metricsTick={metricsTick} />
          <ArchitecturePanel />
        </div>
      </main>

      <footer className="relative border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-6 font-mono text-[11px] text-muted-foreground">
          <span>VOX·RAG — voice retrieval console (HH Goa 2026)</span>
          <span>MSMARCO-XI · ElevenLabs / Web Speech ASR · RRF + Guardrails</span>
        </div>
      </footer>
    </div>
  );
}

