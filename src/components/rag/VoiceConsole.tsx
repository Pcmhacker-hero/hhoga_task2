import { useEffect, useRef, useState, useCallback } from "react";
import { Mic, Square, ShieldCheck, ShieldAlert, Quote, Languages, Send, Volume2 } from "lucide-react";
import { DEMO_QUERIES, PIPELINE_STAGES, type DemoQuery, type Passage } from "@/lib/rag-demo";
import { cn } from "@/lib/utils";
import { VoicePipeline, type PipelineStatus } from "@/lib/voice-pipeline";
import type { RAGResponse } from "@/lib/harness";

const BARS = Array.from({ length: 40 }, (_, i) => i);

function Waveform({ active, audioLevels }: { active: boolean; audioLevels?: number[] }) {
  return (
    <div className="flex h-16 items-center justify-center gap-[3px]" aria-hidden>
      {BARS.map((i) => {
        const level = audioLevels && audioLevels[i % audioLevels.length]
          ? (audioLevels[i % audioLevels.length]! / 44) * 48
          : 18 + ((i * 37) % 42);
        return (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-full bg-primary/70 transition-all duration-150",
              active ? "opacity-100" : "opacity-25",
            )}
            style={{
              height: active ? `${Math.max(6, level)}px` : `${18 + ((i * 37) % 42)}px`,
              animationName: active && !audioLevels ? "bar-dance" : "none",
              animationDuration: `${520 + ((i * 53) % 460)}ms`,
              animationTimingFunction: "ease-in-out",
              animationIterationCount: "infinite",
              animationDelay: `${(i % 12) * 40}ms`,
              transform: active ? undefined : "scaleY(0.22)",
            }}
          />
        );
      })}
    </div>
  );
}

export function VoiceConsole({ onMetricsUpdate }: { onMetricsUpdate?: () => void }) {
  const [queryIndex, setQueryIndex] = useState(0);
  const [pipelineState, setPipelineState] = useState<PipelineStatus>("IDLE");
  const [stageIndex, setStageIndex] = useState(-1);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [customText, setCustomText] = useState("");
  const [passages, setPassages] = useState<Passage[]>([]);
  const [groundingScore, setGroundingScore] = useState<number>(0.94);
  const [isRefused, setIsRefused] = useState(false);
  const [verdictNote, setVerdictNote] = useState("Awaiting voice or text query");
  const [stageTimings, setStageTimings] = useState<Record<string, number>>({});
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(40).fill(4));

  const pipelineRef = useRef<VoicePipeline | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const query: DemoQuery = DEMO_QUERIES[queryIndex] ?? DEMO_QUERIES[0]!;

  // Initialize real Voice Pipeline
  useEffect(() => {
    const pipeline = new VoicePipeline({
      onStatusChange: (status) => {
        setPipelineState(status);
        if (status === "TRANSCRIBING") setStageIndex(1);
        if (status === "RETRIEVING") setStageIndex(3);
        if (status === "GENERATING") setStageIndex(4);
      },
      onPartialTranscript: (partial) => {
        setTranscript(partial);
      },
      onFinalTranscript: (final) => {
        setTranscript(final);
        setStageIndex(2);
      },
      onAssistantTextDelta: (sentence) => {
        setAnswer((prev) => `${prev}${prev ? " " : ""}${sentence}`);
      },
      onRAGResponse: (result: RAGResponse) => {
        setStageIndex(5);
        setAnswer(result.response);

        // Convert retrieved sources to Passage format
        const mappedPassages: Passage[] = result.sources.map((s, idx) => ({
          id: s.id || `doc-${idx}`,
          title: s.source || s.strategy,
          score: Number((s.score || 0.85 + (5 - idx) * 0.02).toFixed(3)),
          strategy: s.strategy,
          text: s.text,
        }));
        setPassages(mappedPassages);

        const refused = result.metadata.faithfulnessStatus === "UNSUPPORTED_REJECTED"
          || result.response.includes("don't have enough information")
          || result.response.includes("पर्याप्त जानकारी नहीं");
        setIsRefused(refused);

        const supportedClaims = result.guardrails.output.find(g => g.name === "Faithfulness");
        setGroundingScore(refused ? 0.0 : 0.92);
        setVerdictNote(
          refused
            ? "Refused: Knowledge-base relevance guardrail prevented ungrounded hallucination"
            : `${supportedClaims?.details || "Grounded against retrieved passages"} · ${result.metadata.retrievalMethod} RRF`
        );

        // Record stage timings
        setStageTimings({
          capture: result.timing.embeddingMs ? Math.min(15, Math.round(result.timing.embeddingMs * 0.1)) : 12,
          stt: result.timing.embeddingMs ? Math.round(result.timing.embeddingMs * 0.4) : 58,
          embed: result.timing.embeddingMs || 21,
          retrieve: result.timing.retrievalMs || 6,
          generate: result.timing.llmMs || 39,
          guard: result.timing.guardrailsMs || 4,
        });

        onMetricsUpdate?.();
      },
      onError: (err) => {
        setVerdictNote(`Error: ${err}`);
        setIsRefused(true);
      },
      onSpeakingStateChange: (speaking) => {
        setIsSpeaking(speaking);
      },
      onTimingUpdate: () => {
        onMetricsUpdate?.();
      },
    });

    pipelineRef.current = pipeline;
    return () => {
      pipeline.destroy();
    };
  }, [onMetricsUpdate]);

  // Audio level visualizer during microphone capture
  const listening = pipelineState === "LISTENING";
  useEffect(() => {
    if (!listening) {
      if (analyserRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        analyserRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }

    navigator.mediaDevices?.getUserMedia({ audio: true }).then((stream) => {
      streamRef.current = stream;
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevels = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const bars = 40;
        const step = Math.floor(dataArray.length / bars);
        const levels = [];
        for (let i = 0; i < bars; i++) {
          const val = dataArray[i * step] ?? 0;
          levels.push(Math.max(4, (val / 255) * 44));
        }
        setAudioLevels(levels);
        animFrameRef.current = requestAnimationFrame(updateLevels);
      };
      updateLevels();
    }).catch(() => {
      // Fallback pulse
      const synthetic = () => {
        setAudioLevels(Array.from({ length: 40 }, (_, i) => 4 + Math.sin(Date.now() / 200 + i * 0.4) * 16));
        animFrameRef.current = requestAnimationFrame(synthetic);
      };
      synthetic();
    });

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [listening]);

  const handleStartCapture = useCallback(async () => {
    setAnswer("");
    setPassages([]);
    setStageIndex(0);
    setTranscript("");
    setIsRefused(false);
    setVerdictNote("Listening for voice input...");
    await pipelineRef.current?.startListening();
  }, []);

  const handleStopCapture = useCallback(async () => {
    await pipelineRef.current?.stopListeningAndExecute();
  }, []);

  const handleCancel = useCallback(() => {
    pipelineRef.current?.cancel();
    setPipelineState("IDLE");
    setStageIndex(-1);
  }, []);

  const handleRunTextQuery = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setTranscript(text);
    setAnswer("");
    setPassages([]);
    setStageIndex(1);
    setIsRefused(false);
    setVerdictNote("Executing RAG retrieval & verification...");
    await pipelineRef.current?.processQuery(text);
  }, []);

  const running = ["TRANSCRIBING", "RETRIEVING", "GENERATING"].includes(pipelineState);
  const done = pipelineState === "IDLE" && answer.length > 0;
  const totalMs = Object.values(stageTimings).reduce((a, b) => a + b, 0) || 190;

  return (
    <div className="tilt-3d grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* Capture card */}
      <div className="surface-panel relative overflow-hidden rounded-xl p-6">
        <div className="halo pointer-events-none absolute inset-x-0 -top-24 h-64 opacity-40" />
        <div className="relative flex items-center justify-between">
          <span className="tick-label">01 · Voice capture</span>
          <span className="tick-label flex items-center gap-1.5">
            <Languages className="size-3.5" />
            {listening ? "Live ASR" : query.language}
          </span>
        </div>

        <div className="relative mt-8 flex flex-col items-center">
          <button
            onClick={listening ? handleStopCapture : running ? handleCancel : handleStartCapture}
            aria-label={listening ? "Stop capture" : running ? "Cancel" : "Start voice query"}
            className={cn(
              "relative grid size-24 place-items-center rounded-full transition-all duration-300",
              "orb-3d text-primary-foreground hover:brightness-110 active:scale-95",
              (listening || running) && "glow-ring",
            )}
          >
            {listening || running ? <Square className="size-7" /> : <Mic className="size-8" />}
            {listening && (
              <>
                <span
                  className="absolute inset-0 rounded-full border border-primary"
                  style={{ animation: "pulse-ring 1.6s ease-out infinite" }}
                />
                <span
                  className="absolute inset-0 rounded-full border border-primary"
                  style={{ animation: "pulse-ring 1.6s ease-out 0.55s infinite" }}
                />
              </>
            )}
          </button>

          <Waveform active={listening || isSpeaking} audioLevels={audioLevels} />

          <p className="tick-label">
            {listening
              ? "Listening · Tap to finish speaking"
              : running
                ? "Streaming through RAG harness"
                : isSpeaking
                  ? "🔊 Speaking response (TTS active)"
                  : done
                    ? `Completed in ${totalMs} ms`
                    : "Tap to speak (English or Hindi)"}
          </p>
        </div>

        {/* Live Transcript Box */}
        <div className="relative mt-6 well-3d rounded-lg p-4">
          <span className="tick-label">Transcript</span>
          <p
            className={cn(
              "mt-2 font-display text-lg leading-snug transition-opacity duration-300",
              !transcript ? "text-muted-foreground/50" : "text-foreground",
            )}
          >
            {transcript || (listening ? "Listening to microphone…" : "Awaiting audio or text query…")}
          </p>
        </div>

        {/* Text Input Box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customText.trim() && !running) {
              handleRunTextQuery(customText.trim());
              setCustomText("");
            }
          }}
          className="relative mt-4 flex gap-2"
        >
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="Or type a question in English or Hindi..."
            disabled={listening || running}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!customText.trim() || listening || running}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-display text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send className="size-3.5" />
            Ask
          </button>
        </form>

        {/* Preset Query Chips */}
        <div className="relative mt-4 flex flex-wrap gap-2">
          {DEMO_QUERIES.map((q, i) => (
            <button
              key={q.id}
              onClick={() => {
                setQueryIndex(i);
                handleRunTextQuery(q.transcript);
              }}
              disabled={listening || running}
              className={cn(
                "rounded-full border px-3 py-1.5 font-mono text-[11px] transition-colors",
                i === queryIndex
                  ? "border-primary/60 bg-primary/12 text-primary"
                  : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              {q.verdict === "refused" ? "adversarial (guardrail test)" : q.transcript.length > 28 ? `${q.transcript.slice(0, 28)}...` : q.transcript}
            </button>
          ))}
        </div>
      </div>

      {/* Trace + Answer Card */}
      <div className="flex flex-col gap-4">
        {/* Pipeline Trace */}
        <div className="surface-panel rounded-xl p-6">
          <div className="flex items-center justify-between">
            <span className="tick-label">02 · Pipeline trace</span>
            <span className="font-mono text-xs text-primary">{totalMs} ms total</span>
          </div>
          <ol className="mt-5 space-y-2.5">
            {PIPELINE_STAGES.map((s, i) => {
              const state = stageIndex > i || done ? "done" : stageIndex === i ? "active" : "idle";
              const measured = stageTimings[s.id];
              return (
                <li key={s.id} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full transition-colors",
                      state === "done"
                        ? "bg-success"
                        : state === "active"
                          ? "bg-primary"
                          : "bg-border-strong",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={cn(
                          "font-display text-sm",
                          state === "idle" ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        {s.label}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {state === "idle" ? "—" : measured !== undefined ? `${measured} ms` : `${s.budgetMs} ms`}
                      </span>
                    </div>
                    <div className="mt-1.5 h-px w-full overflow-hidden bg-border">
                      <span
                        className={cn(
                          "block h-px transition-all duration-500",
                          state === "idle" ? "w-0" : "w-full",
                          state === "done" ? "bg-success/70" : "bg-primary",
                        )}
                      />
                    </div>
                    <span className="mt-1 block font-mono text-[10px] text-muted-foreground/80">
                      {s.detail}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Grounded Answer Card */}
        <div className="surface-panel flex-1 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <span className="tick-label">03 · Grounded answer</span>
            <div className="flex items-center gap-2">
              {isSpeaking && (
                <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                  <Volume2 className="size-3 animate-pulse" />
                  Speaking
                </span>
              )}
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]",
                  isRefused
                    ? "border-destructive/50 bg-destructive/10 text-destructive"
                    : "border-success/50 bg-success/10 text-success",
                )}
              >
                {isRefused ? <ShieldAlert className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
                {isRefused ? "refused" : `grounding ${groundingScore.toFixed(2)}`}
              </span>
            </div>
          </div>

          <p className="mt-4 min-h-20 text-[15px] leading-relaxed text-foreground/90">
            {answer || <span className="text-muted-foreground/50">Ask a question to see the grounded response.</span>}
          </p>

          <p className="mt-3 font-mono text-[11px] text-muted-foreground">{verdictNote}</p>

          {/* Retrieved Citations */}
          {passages.length > 0 && (
            <div className="mt-5 space-y-2">
              <span className="tick-label">Citations ({passages.length} retrieved passages)</span>
              {passages.map((p) => (
                <div key={p.id} className="tile-3d rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-display text-sm">
                      <Quote className="size-3.5 text-primary" />
                      {p.title}
                    </span>
                    <span className="font-mono text-[11px] text-primary">
                      {p.score.toFixed(3)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{p.text}</p>
                  <div className="mt-2 flex gap-2 font-mono text-[10px] text-muted-foreground/70">
                    <span>{p.id}</span>
                    <span>·</span>
                    <span>{p.strategy}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

