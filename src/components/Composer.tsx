"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ASPECTS, STYLES, type Aspect, type VideoStyle } from "@/lib/types";

const SAMPLES = [
  "3 money habits that quietly make you rich in your 20s",
  "Why octopuses are basically aliens",
  "How to fall asleep in 2 minutes (military method)",
  "Launch video for a habit-tracking app called Streakly",
];

const STEPS = ["Writing the script…", "Splitting into scenes…", "Finding visuals…", "Timing captions…"];

export function Composer({ pro, aiEnabled, stockEnabled }: { pro: boolean; aiEnabled: boolean; stockEnabled: boolean }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"idea" | "script">("idea");
  const [style, setStyle] = useState<VideoStyle>("educational");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [targetSeconds, setTargetSeconds] = useState(30);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<{ message: string; upgrade?: boolean } | null>(null);

  useEffect(() => {
    if (!loading) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 2500);
    return () => clearInterval(id);
  }, [loading]);

  async function generate() {
    setError(null);
    setLoading(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode, style, aspect, targetSeconds }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      return setError({ message: data.error ?? "Generation failed", upgrade: data.upgrade });
    }
    router.push(`/projects/${data.project.id}`);
    router.refresh();
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex border-b border-white/10">
        {(["idea", "script"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              mode === m ? "bg-white/5 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {m === "idea" ? "💡 From an idea" : "📝 From my script"}
          </button>
        ))}
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={mode === "script" ? 9 : 4}
            maxLength={5000}
            className="input resize-y text-base leading-relaxed"
            placeholder={
              mode === "idea"
                ? "What's your video about? e.g. “5 psychology tricks that make people like you instantly”"
                : "Paste your script. We'll split it into scenes, find visuals, and time the captions."
            }
          />
          {mode === "idea" && !prompt && (
            <div className="mt-3 flex flex-wrap gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  onClick={() => setPrompt(s)}
                  className="chip border-white/10 text-zinc-400 hover:border-brand-500 hover:text-white"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Style</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {STYLES.map((s) => (
              <button
                key={s.id}
                onClick={() => setStyle(s.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  style === s.id ? "border-brand-500 bg-brand-500/10" : "border-white/10 hover:border-white/25"
                }`}
              >
                <div className="text-sm font-semibold">{s.label}</div>
                <div className="text-xs text-zinc-500">{s.blurb}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Format</p>
            <div className="flex gap-2">
              {ASPECTS.map((a) => {
                const locked = a.id !== "9:16" && !pro;
                return (
                  <button
                    key={a.id}
                    onClick={() => !locked && setAspect(a.id)}
                    title={locked ? "Pro feature" : a.hint}
                    className={`flex-1 rounded-xl border px-2 py-2 text-center transition ${
                      aspect === a.id ? "border-brand-500 bg-brand-500/10" : "border-white/10 hover:border-white/25"
                    } ${locked ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <div className="text-sm font-semibold">
                      {a.label} {locked && "🔒"}
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">{a.hint}</div>
                  </button>
                );
              })}
            </div>
          </div>
          {mode === "idea" && (
            <div>
              <p className="mb-2 flex justify-between text-xs font-semibold uppercase tracking-wider text-zinc-500">
                <span>Length</span>
                <span className="text-zinc-300">~{targetSeconds}s</span>
              </p>
              <input
                type="range"
                min={15}
                max={90}
                step={5}
                value={targetSeconds}
                onChange={(e) => setTargetSeconds(Number(e.target.value))}
                className="mt-3 w-full accent-brand-500"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <span>{error.message}</span>
            {error.upgrade && (
              <Link href="/billing" className="btn-primary shrink-0 py-1.5">
                Upgrade
              </Link>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse items-center justify-between gap-3 sm:flex-row">
          <p className="text-xs text-zinc-500">
            {aiEnabled ? "AI script by Claude" : "Demo mode: add ANTHROPIC_API_KEY for AI scripts"} ·{" "}
            {stockEnabled ? "Stock visuals by Pexels" : "Generated visuals"}
          </p>
          <button onClick={generate} disabled={loading || prompt.trim().length < 3} className="btn-primary w-full px-6 py-3 sm:w-auto">
            {loading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                {STEPS[step]}
              </>
            ) : (
              <>✨ Generate video</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
