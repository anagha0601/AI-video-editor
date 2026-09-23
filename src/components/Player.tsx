"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Scene } from "@/lib/types";
import { buildTimeline, drawFrame, loadImages, sceneAt, type Images } from "@/lib/renderer";

export type PlayerHandle = { seekToScene: (index: number) => void; pause: () => void };

type Props = {
  scenes: Scene[];
  W: number;
  H: number;
  watermark: boolean;
  onSceneChange?: (index: number) => void;
};

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// Live canvas preview. Uses the browser's speech engine for a voice preview;
// the exported file gets real AI voiceover (Pro) or burned-in captions only.
export const Player = forwardRef<PlayerHandle, Props>(function Player({ scenes, W, H, watermark, onSceneChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [images, setImages] = useState<Images>(new Map());
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voice, setVoice] = useState(true);
  const tRef = useRef(0);
  const lastScene = useRef(-1);

  const { timeline, total } = useMemo(() => buildTimeline(scenes), [scenes]);
  const mediaKey = scenes.map((s) => s.mediaUrl ?? "").join("|");

  useEffect(() => {
    let cancelled = false;
    loadImages(scenes).then((m) => !cancelled && setImages(m));
    return () => {
      cancelled = true;
    };
    // Only reload when the media set changes, not on every text edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey]);

  // Draw whenever time or content changes.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawFrame(ctx, W, H, scenes, images, timeline, total, Math.min(t, total - 0.001), { watermark });
  }, [t, scenes, images, timeline, total, W, H, watermark]);

  const current = sceneAt(timeline, t);
  useEffect(() => {
    onSceneChange?.(current);
  }, [current, onSceneChange]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const next = tRef.current + (now - prev) / 1000;
      prev = now;
      if (next >= total) {
        tRef.current = total;
        setT(total);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total]);

  // Speak each scene's narration as playback enters it.
  useEffect(() => {
    if (!playing || !voice || typeof speechSynthesis === "undefined") return;
    if (current === lastScene.current) return;
    lastScene.current = current;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(scenes[current]?.narration ?? "");
    const d = timeline[current].end - timeline[current].start;
    const words = (scenes[current]?.narration ?? "").split(/\s+/).length;
    u.rate = Math.min(1.6, Math.max(0.8, words / d / 2.6));
    speechSynthesis.speak(u);
  }, [current, playing, voice, scenes, timeline]);

  useEffect(() => {
    if (!playing && typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
      lastScene.current = -1;
    }
  }, [playing]);

  useEffect(() => () => speechSynthesis?.cancel(), []);

  function seek(time: number) {
    const v = Math.max(0, Math.min(total, time));
    tRef.current = v;
    setT(v);
    lastScene.current = -1;
  }

  function toggle() {
    if (!playing && tRef.current >= total - 0.05) seek(0);
    setPlaying((p) => !p);
  }

  useImperativeHandle(ref, () => ({
    seekToScene: (index: number) => seek(timeline[index]?.start ?? 0),
    pause: () => setPlaying(false),
  }));

  const portrait = H > W;
  return (
    <div className="flex flex-col items-center">
      <div
        className={`relative overflow-hidden rounded-2xl bg-black shadow-2xl shadow-brand-600/10 ring-1 ring-white/10 ${
          portrait ? "h-[min(70vh,640px)]" : "w-full"
        }`}
        style={{ aspectRatio: `${W} / ${H}` }}
      >
        <canvas ref={canvasRef} width={W} height={H} className="h-full w-full cursor-pointer" onClick={toggle} />
        {!playing && (
          <button
            onClick={toggle}
            className="absolute inset-0 m-auto grid h-16 w-16 place-items-center rounded-full bg-white/90 text-black shadow-xl transition hover:scale-105"
            aria-label="Play"
          >
            <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7 fill-current">
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
            </svg>
          </button>
        )}
      </div>
      <div className="mt-3 flex w-full max-w-md items-center gap-3">
        <button onClick={toggle} className="btn-ghost h-9 w-9 shrink-0 p-0" aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={total}
          step={0.01}
          value={t}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 accent-brand-500"
          aria-label="Seek"
        />
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-400">
          {fmt(t)} / {fmt(total)}
        </span>
        <button
          onClick={() => setVoice((v) => !v)}
          className={`btn-ghost h-9 shrink-0 px-2.5 text-xs ${voice ? "text-white" : "text-zinc-500"}`}
          title="Voice preview (browser speech)"
        >
          {voice ? "🔊" : "🔇"}
        </button>
      </div>
    </div>
  );
});
