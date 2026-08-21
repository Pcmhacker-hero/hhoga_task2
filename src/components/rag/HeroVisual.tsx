import { useEffect, useRef, useState } from "react";
import { AudioLines, Boxes, Database, Sparkles } from "lucide-react";

const LAYERS = [
  { label: "capture · ASR", icon: AudioLines, depth: 90, delay: "0s", meta: "16 kHz stream" },
  { label: "chunk · embed", icon: Boxes, depth: 40, delay: "-2.4s", meta: "4 strategies" },
  { label: "retrieve · rerank", icon: Database, depth: -10, delay: "-4.8s", meta: "HNSW · 8.8M" },
  { label: "generate · guard", icon: Sparkles, depth: -60, delay: "-7.2s", meta: "cited only" },
];

export function HeroVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      setTilt({ x: -py * 12, y: px * 16 });
    };
    const onLeave = () => setTilt({ x: 0, y: 0 });
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="stage-3d relative mx-auto h-[380px] w-full max-w-md select-none sm:h-[420px] lg:-mt-14 lg:ml-auto lg:mr-[-2rem] lg:translate-x-6"
    >
      <div className="halo pointer-events-none absolute inset-0 -z-10 blur-2xl opacity-70" />

      <div
        className="absolute inset-0 [transform-style:preserve-3d]"
        style={{
          transform: `rotateX(${10 + tilt.x * 0.6}deg) rotateY(${-14 + tilt.y * 0.5}deg) rotateZ(${-3 + tilt.y * 0.1}deg)`,
          transition: "transform 500ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {LAYERS.map(({ label, icon: Icon, depth, delay, meta }, i) => (
          <div
            key={label}
            className="absolute left-1/2 top-1/2 w-[300px] [transform-style:preserve-3d]"
            style={{ transform: `translate3d(-50%, ${i * 78 - 146}px, ${depth}px)` }}
          >

            <div
              className="float-3d tile-3d flex items-center gap-3 rounded-xl px-4 py-3 backdrop-blur-sm"
              style={{ animationDelay: delay }}
            >
              <span className="glow-ring grid size-8 shrink-0 place-items-center rounded-lg bg-[image:var(--gradient-primary)] text-primary-foreground">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-foreground">
                  {label}
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">{meta}</p>
              </div>
              <span className="relative h-1 w-12 overflow-hidden rounded-full bg-border">
                <span
                  className="absolute inset-y-0 w-1/2 rounded-full bg-primary"
                  style={{ animation: "sweep 2.6s linear infinite", animationDelay: delay }}
                />
              </span>
            </div>
          </div>
        ))}

        <div className="ring-orbit absolute left-1/2 top-1/2 size-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong/60" />
      </div>
    </div>
  );
}
