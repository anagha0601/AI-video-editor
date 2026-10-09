import "server-only";
// ffprobe facts the planner needs (worker/color.py has the full colour probe used by the render).
import { spawn } from "node:child_process";
import type { Timeline, VisualClip } from "@/lib/timeline/types";
import { localMediaPath } from "./agent";

const STANDARD = [24, 25, 30, 48, 50, 60];

function ffprobe(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", args, { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve(""));
    p.on("close", () => resolve(out));
  });
}

const ratio = (v?: string) => {
  const [a, b] = (v ?? "0/1").split("/").map(Number);
  return b ? a / b : 0;
};

/** Frame rate of a video file: the nominal rate, or the average for variable-rate slow-mo (iPhone 120 fps -> ~27). */
export async function videoFps(file: string): Promise<number | null> {
  const out = await ffprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,avg_frame_rate", "-of", "json", file]);
  try {
    const s = JSON.parse(out).streams?.[0];
    const r = ratio(s?.r_frame_rate);
    const avg = ratio(s?.avg_frame_rate);
    // variable-rate slow-mo (iPhone: nominal 120, average ~27): plays back at the next standard rate up (30)
    if (avg > 0 && r > avg * 1.5) return STANDARD.find((s) => s >= avg * 0.95) ?? 60;
    const f = r || avg;
    return f > 0 ? f : null;
  } catch {
    return null;
  }
}

const snap = (f: number) => STANDARD.reduce((best, s) => (Math.abs(s - f) < Math.abs(best - f) ? s : best), 30);

/** Timeline frame rate = the sources' own rate (duration-weighted, snapped to a standard rate, max 60), so footage
 * plays without dropped or duplicated frames; mixed rates are conformed once, in the render's fps filter. */
export async function sourceFps(tl: Timeline): Promise<number> {
  const weight = new Map<number, number>();
  const seen = new Map<string, number | null>();
  for (const t of tl.tracks) {
    if (t.kind !== "video") continue;
    for (const c of t.clips as VisualClip[]) {
      if (c.type !== "video" || !c.src) continue;
      const p = localMediaPath(c.src);
      if (!p) continue;
      if (!seen.has(p)) seen.set(p, await videoFps(p));
      const f = seen.get(p);
      if (!f) continue;
      const s = Math.min(60, snap(f));
      weight.set(s, (weight.get(s) ?? 0) + c.duration);
    }
  }
  if (!weight.size) return tl.fps || 30;
  return [...weight.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}
