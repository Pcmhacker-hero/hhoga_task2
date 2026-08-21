import { Layers, Repeat, ShieldHalf, Wrench } from "lucide-react";
import { CHUNK_STRATEGIES } from "@/lib/rag-demo";

const HARNESS = [
  {
    icon: Wrench,
    title: "Tool-call orchestration",
    body: "Retrieval, rerank and citation lookup are typed tools with schema-validated I/O — never a raw prompt round trip.",
  },
  {
    icon: Repeat,
    title: "Retries & fallback",
    body: "Bounded retries with jitter; a degraded lexical BM25 path takes over if the ANN shard misses its deadline.",
  },
  {
    icon: ShieldHalf,
    title: "Guardrail gate",
    body: "Injection screening, unsafe-intent classification and per-claim grounding checks decide answer vs. refusal.",
  },
  {
    icon: Layers,
    title: "Structured output",
    body: "Every response carries answer, citations, grounding score and stage timings in one validated envelope.",
  },
];

export function ArchitecturePanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="surface-panel rounded-xl p-6">
        <span className="tick-label">05 · Chunking portfolio</span>
        <h2 className="mt-2 text-2xl">Four indexes, one retriever</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          MSMARCO-XI is indexed under four complementary splitters; the router picks per query and
          fuses candidates with reciprocal rank fusion.
        </p>

        <div className="mt-6 space-y-4">
          {CHUNK_STRATEGIES.map((s) => (
            <div key={s.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display text-sm">{s.name}</span>
                <span className="font-mono text-[11px] text-primary">{s.share}%</span>
              </div>
              <div className="mt-2 well-3d h-2 w-full overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full bg-[image:var(--gradient-primary)]"
                  style={{ width: `${s.share * 2.4}%` }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
                <span className="rounded border border-border px-1.5 py-0.5">{s.config}</span>
                <span>{s.note}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="surface-panel rounded-xl p-6">
        <span className="tick-label">06 · Harness & guardrails</span>
        <h2 className="mt-2 text-2xl">It knows when not to answer</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {HARNESS.map((h) => (
            <div
              key={h.title}
              className="tile-3d rounded-lg p-4"
            >
              <h.icon className="size-4 text-primary" />
              <h3 className="mt-3 font-display text-sm">{h.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{h.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
