"use client";

import { useEffect, useRef } from "react";
import type { Scene } from "@/lib/types";
import { buildTimeline, drawFrame } from "@/lib/renderer";

const DEMO: Scene[] = [
  {
    id: "1",
    narration: "Your brain forgets 70% of what you learn within 24 hours.",
    onScreen: "You forget 70%",
    visualQuery: "",
    durationSec: 3.6,
    palette: ["#7c3aed", "#db2777"],
    emoji: "🧠",
  },
  {
    id: "2",
    narration: "But one simple trick flips that. It's called spaced repetition.",
    onScreen: "Spaced repetition",
    visualQuery: "",
    durationSec: 3.6,
    palette: ["#0ea5e9", "#6366f1"],
    emoji: "🔁",
  },
  {
    id: "3",
    narration: "Review after one day, then three days, then a week.",
    onScreen: "1 · 3 · 7 days",
    visualQuery: "",
    durationSec: 3.4,
    palette: ["#f97316", "#e11d48"],
    emoji: "📅",
  },
  {
    id: "4",
    narration: "Follow for more study hacks that actually work.",
    onScreen: "Save this",
    visualQuery: "",
    durationSec: 3,
    palette: ["#10b981", "#0ea5e9"],
    emoji: "🚀",
  },
];

// The landing-page phone runs the real renderer on a canned storyboard.
export function HeroDemo() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const W = 360;
    const H = 640;
    const { timeline, total } = buildTimeline(DEMO);
    const images = new Map();
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = ((now - start) / 1000) % total;
      drawFrame(ctx, W, H, DEMO, images, timeline, total, t, { watermark: false });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative mx-auto w-[260px] sm:w-[300px]">
      <div className="absolute -inset-10 rounded-full bg-gradient-to-br from-brand-600/40 to-accent-500/30 blur-3xl" />
      <div className="relative rounded-[2.5rem] border border-white/15 bg-zinc-950 p-2.5 shadow-2xl">
        <div className="absolute left-1/2 top-4 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-black" />
        <canvas ref={ref} width={360} height={640} className="aspect-[9/16] w-full rounded-[2rem]" />
      </div>
    </div>
  );
}
