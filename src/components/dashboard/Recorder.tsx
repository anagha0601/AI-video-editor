"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

/** In-browser voice recording (MediaRecorder) with a live level meter. */
export function Recorder({ onRecorded }: { onRecorded: (blob: Blob | null) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; t0: number } | null>(null);

  useEffect(
    () => () => {
      stopAll();
      if (url) URL.revokeObjectURL(url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const stopAll = () => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
    rec.current = null;
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
        const u = URL.createObjectURL(blob);
        setUrl(u);
        setState("done");
        onRecorded(blob);
      };
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const t0 = performance.now();
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        setElapsed((performance.now() - t0) / 1000);
        if (rec.current) rec.current.raf = requestAnimationFrame(tick);
      };
      rec.current = { mr, stream, ctx, raf: 0, t0 };
      mr.start(1000);
      setState("recording");
      rec.current.raf = requestAnimationFrame(tick);
    } catch {
      setError("Microphone access was blocked. Allow it in your browser, or upload a file instead.");
    }
  };

  const stop = () => {
    rec.current?.mr.stop();
    stopAll();
    setLevel(0);
  };

  const reset = () => {
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    setElapsed(0);
    setState("idle");
    onRecorded(null);
  };

  const mm = `${Math.floor(elapsed / 60)}:${Math.floor(elapsed % 60).toString().padStart(2, "0")}`;
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-6">
      {state === "idle" && (
        <>
          <Button size="lg" className="size-16 rounded-full" onClick={start} aria-label="Start recording">
            <Mic className="size-6" />
          </Button>
          <p className="text-sm text-muted-foreground">Tap to record. Speak naturally — pauses can be trimmed later.</p>
        </>
      )}
      {state === "recording" && (
        <>
          <div className="flex h-10 items-end gap-0.5">
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className="w-1.5 rounded-full bg-red-400 transition-all" style={{ height: `${Math.max(8, Math.min(100, level * 140 * (0.6 + 0.4 * Math.sin(i + elapsed * 8))))}%` }} />
            ))}
          </div>
          <div className="font-mono text-2xl tabular-nums">{mm}</div>
          <Button size="lg" variant="destructive" className="rounded-full" onClick={stop}>
            <Square /> Stop
          </Button>
        </>
      )}
      {state === "done" && url && (
        <>
          <audio src={url} controls className="w-full" />
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw /> Record again
          </Button>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
