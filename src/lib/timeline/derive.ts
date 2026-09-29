// Pure helpers derived from the timeline JSON. The worker (worker/timeline.py)
// implements the same math so the MP4 matches the preview. Change both together.
import type {
  AnyClip,
  AudioClip,
  CaptionSettings,
  Filters,
  KenBurns,
  TextAnimIn,
  TextAnimOut,
  Timeline,
  Track,
  VisualClip,
  FontId,
} from "./types";

export const clipEnd = (c: { start: number; duration: number }) => c.start + c.duration;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const EPS = 1e-3;

export function timelineDuration(tl: Timeline) {
  let end = 0;
  for (const t of tl.tracks) for (const c of t.clips as AnyClip[]) end = Math.max(end, clipEnd(c));
  return end;
}

export function findClip(tl: Timeline, id: string): { track: Track; clip: AnyClip; index: number } | null {
  for (const track of tl.tracks) {
    const index = (track.clips as AnyClip[]).findIndex((c) => c.id === id);
    if (index >= 0) return { track, clip: track.clips[index] as AnyClip, index };
  }
  return null;
}

/** Source seconds consumed by a video/audio clip. */
export const sourceOut = (c: { in: number; duration: number; speed: number }) => c.in + c.duration * c.speed;

// ---------------------------------------------------------------- captions

export interface TimedWord {
  id: string;
  text: string;
  start: number; // timeline seconds
  end: number;
}

/** Transcript words mapped through every visible voice clip (trim, speed, position). */
export function mappedWords(tl: Timeline, applyEdits = true): TimedWord[] {
  const out: TimedWord[] = [];
  for (const track of tl.tracks) {
    if (track.kind !== "voice" || track.hidden) continue;
    for (const clip of track.clips) {
      const words = clip.assetId ? tl.transcripts[clip.assetId]?.words : undefined;
      if (!words) continue;
      const srcEnd = sourceOut(clip);
      for (const w of words) {
        const mid = (w.start + w.end) / 2;
        if (mid < clip.in || mid >= srcEnd) continue;
        const text = applyEdits ? (tl.captions.edits[w.id] ?? w.text) : w.text;
        out.push({
          id: w.id,
          text: text.trim(),
          start: clip.start + (Math.max(w.start, clip.in) - clip.in) / clip.speed,
          end: clip.start + (Math.min(w.end, srcEnd) - clip.in) / clip.speed,
        });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface CaptionLine {
  start: number;
  end: number;
  words: TimedWord[];
}

export const CAPTION_MAX_CHARS: Record<Timeline["aspect"], number> = { "9:16": 20, "1:1": 24, "16:9": 36 };

export function captionLines(tl: Timeline): CaptionLine[] {
  const words = mappedWords(tl).filter((w) => w.text.length > 0);
  const maxChars = CAPTION_MAX_CHARS[tl.aspect];
  const lines: CaptionLine[] = [];
  let cur: TimedWord[] = [];
  const push = () => {
    if (cur.length) lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
      if (
        w.start - last.end > 0.6 ||
        cur.length >= tl.captions.maxWords ||
        chars > maxChars ||
        /[.!?]["')\]]?$/.test(last.text)
      )
        push();
    }
    cur.push(w);
  }
  push();
  // Hold each line until the next one when the gap is short, so captions don't flicker.
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    if (next && next.start - lines[i].end < 0.35) lines[i].end = next.start;
    else lines[i].end = next ? Math.min(lines[i].end + 0.2, next.start) : lines[i].end + 0.2;
  }
  return lines;
}

/** Index of the word being spoken in a line at time t (-1 before the first word). */
export function activeWordIndex(line: CaptionLine, t: number) {
  let idx = -1;
  for (let i = 0; i < line.words.length; i++) if (t >= line.words[i].start) idx = i;
  return idx;
}

export type WordState = "past" | "active" | "future";

export interface CaptionLook {
  font: FontId;
  size: number;
  uppercase: boolean;
  outline: number;
  outlineColor: string;
  shadow: number;
  box: { color: string; opacity: number; pad: number } | null;
  word: Record<WordState, { color: string; opacity: number }>;
}

export const CAPTION_PRESETS: Record<CaptionSettings["style"], { label: string; look: (size: number) => CaptionLook }> = {
  bold: {
    label: "Bold pop",
    look: (size) => ({
      font: "montserrat",
      size,
      uppercase: true,
      outline: Math.round(size * 0.09),
      outlineColor: "#000000",
      shadow: 0,
      box: null,
      word: {
        past: { color: "#FFFFFF", opacity: 1 },
        active: { color: "#FFE600", opacity: 1 },
        future: { color: "#FFFFFF", opacity: 1 },
      },
    }),
  },
  karaoke: {
    label: "Karaoke",
    look: (size) => ({
      font: "inter",
      size,
      uppercase: false,
      outline: Math.round(size * 0.07),
      outlineColor: "#000000",
      shadow: 3,
      box: null,
      word: {
        past: { color: "#4ADE80", opacity: 1 },
        active: { color: "#4ADE80", opacity: 1 },
        future: { color: "#FFFFFF", opacity: 1 },
      },
    }),
  },
  minimal: {
    label: "Minimal",
    look: (size) => ({
      font: "inter",
      size: Math.round(size * 0.8),
      uppercase: false,
      outline: 0,
      outlineColor: "#000000",
      shadow: 4,
      box: null,
      word: {
        past: { color: "#FFFFFF", opacity: 0.55 },
        active: { color: "#FFFFFF", opacity: 1 },
        future: { color: "#FFFFFF", opacity: 0.55 },
      },
    }),
  },
  boxed: {
    label: "Boxed",
    look: (size) => ({
      font: "bebas",
      size: Math.round(size * 1.15),
      uppercase: true,
      outline: 0,
      outlineColor: "#000000",
      shadow: 0,
      box: { color: "#000000", opacity: 0.7, pad: Math.round(size * 0.22) },
      word: {
        past: { color: "#FFFFFF", opacity: 1 },
        active: { color: "#F43F5E", opacity: 1 },
        future: { color: "#FFFFFF", opacity: 1 },
      },
    }),
  },
};

// ---------------------------------------------------------------- audio

/** Merged speech intervals (timeline seconds) of unmuted voice clips; used for ducking. */
export function speechIntervals(tl: Timeline): [number, number][] {
  const mutedTracks = new Set(tl.tracks.filter((t) => t.kind === "voice" && t.muted).map((t) => t.id));
  const mutedClips = new Set<string>();
  for (const t of tl.tracks) if (t.kind === "voice") for (const c of t.clips) if (c.muted || mutedTracks.has(t.id)) mutedClips.add(c.id);
  const tmp: Timeline = {
    ...tl,
    tracks: tl.tracks
      .filter((t) => t.kind === "voice" && !mutedTracks.has(t.id))
      .map((t) => ({ ...t, hidden: false, clips: (t.clips as AudioClip[]).filter((c) => !mutedClips.has(c.id)) })) as Track[],
  };
  const words = mappedWords(tmp, false);
  const out: [number, number][] = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && w.start - last[1] < 0.6) last[1] = Math.max(last[1], w.end);
    else out.push([w.start, w.end]);
  }
  return out;
}

export const DUCK_RAMP = 0.25;

/** Ducking multiplier at timeline time t: duckLevel inside speech, 1 far from it, linear ramps. */
export function duckGain(intervals: [number, number][], duckLevel: number, t: number) {
  let m = 0;
  for (const [a, b] of intervals) {
    const v = clamp(Math.min((t - (a - DUCK_RAMP)) / DUCK_RAMP, (b + DUCK_RAMP - t) / DUCK_RAMP), 0, 1);
    if (v > m) m = v;
  }
  return 1 - (1 - duckLevel) * m;
}

export function keyframeGain(clip: AudioClip, local: number) {
  const kfs = clip.keyframes;
  if (!kfs || kfs.length === 0) return 1;
  const k = [...kfs].sort((a, b) => a.t - b.t);
  if (local <= k[0].t) return k[0].gain;
  for (let i = 1; i < k.length; i++) {
    if (local <= k[i].t) {
      const span = k[i].t - k[i - 1].t || 1;
      return k[i - 1].gain + ((k[i].gain - k[i - 1].gain) * (local - k[i - 1].t)) / span;
    }
  }
  return k[k.length - 1].gain;
}

/** Linear fade multiplier for a clip at timeline time t. */
export function fadeGain(c: { start: number; duration: number; fadeIn: number; fadeOut: number }, t: number) {
  let g = 1;
  if (c.fadeIn > 0) g = Math.min(g, clamp((t - c.start) / c.fadeIn, 0, 1));
  if (c.fadeOut > 0) g = Math.min(g, clamp((clipEnd(c) - t) / c.fadeOut, 0, 1));
  return g;
}

// ---------------------------------------------------------------- color

type M3 = [number, number, number, number, number, number, number, number, number];

const PRESET_MATRIX: Record<Filters["preset"], M3> = {
  none: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  warm: [1.06, 0.04, 0, 0.02, 1.0, 0, 0, 0, 0.84],
  cool: [0.88, 0, 0.02, 0, 0.98, 0.04, 0, 0.04, 1.12],
  bw: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
};

function mul(a: M3, b: M3): M3 {
  const r = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}

/**
 * Color pipeline: v' = clip(v * slope + intercept) per channel (brightness, then contrast),
 * then a 3x3 matrix (saturation, then preset). Preview: SVG feComponentTransfer +
 * feColorMatrix; render: lutrgb + colorchannelmixer.
 */
export function colorOps(f: Filters) {
  const s = f.saturation;
  const sat: M3 = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  const matrix = mul(PRESET_MATRIX[f.preset], sat);
  return {
    slope: f.brightness * f.contrast,
    intercept: 0.5 * (1 - f.contrast),
    matrix,
    identity:
      Math.abs(f.brightness - 1) < 1e-3 && Math.abs(f.contrast - 1) < 1e-3 && Math.abs(s - 1) < 1e-3 && f.preset === "none",
  };
}

// ---------------------------------------------------------------- motion

/** Ken Burns window at progress p (0..1): zoom z, and window position fx/fy (0..1 of free space). */
export function kenBurnsAt(kb: KenBurns, p: number) {
  const a = kb.amount;
  switch (kb.direction) {
    case "in":
      return { z: 1 + a * p, fx: 0.5, fy: 0.5 };
    case "out":
      return { z: 1 + a * (1 - p), fx: 0.5, fy: 0.5 };
    case "left":
      return { z: 1 + a, fx: 1 - p, fy: 0.5 };
    case "right":
      return { z: 1 + a, fx: p, fy: 0.5 };
    case "up":
      return { z: 1 + a, fx: 0.5, fy: 1 - p };
    case "down":
      return { z: 1 + a, fx: 0.5, fy: p };
  }
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const TEXT_ANIM = 0.4;
export const TEXT_SLIDE_PX = 60;
export const TEXT_POP_FROM = 0.6;

/** Text animation state at timeline time t: opacity, vertical offset (px), scale. */
export function textAnimState(
  c: { start: number; duration: number; animIn: TextAnimIn; animOut: TextAnimOut },
  t: number,
) {
  const d = Math.min(TEXT_ANIM, c.duration / 3);
  let alpha = 1,
    dy = 0,
    scale = 1;
  const pin = clamp((t - c.start) / d, 0, 1);
  const pout = clamp((clipEnd(c) - t) / d, 0, 1);
  if (c.animIn !== "none" && pin < 1) {
    alpha = pin;
    if (c.animIn === "slide-up") dy = TEXT_SLIDE_PX * (1 - pin);
    if (c.animIn === "pop") scale = TEXT_POP_FROM + (1 - TEXT_POP_FROM) * pin;
  }
  if (c.animOut !== "none" && pout < 1) {
    alpha = Math.min(alpha, pout);
    if (c.animOut === "slide-down") dy = TEXT_SLIDE_PX * (1 - pout);
    if (c.animOut === "pop") scale = TEXT_POP_FROM + (1 - TEXT_POP_FROM) * pout;
  }
  return { alpha, dy, scale };
}

/** Previous clip on the same track that ends where `clip` starts (for transitions). */
export function adjacentPrev(clips: VisualClip[], clip: VisualClip) {
  let best: VisualClip | null = null;
  for (const c of clips) if (c.id !== clip.id && Math.abs(clipEnd(c) - clip.start) < 0.05) best = c;
  return best;
}

/** Placement of a source (sw x sh) into a W x H frame: drawn size and top-left. */
export function placement(sw: number, sh: number, W: number, H: number, tr: VisualClip["transform"]) {
  const base = tr.fit === "cover" ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const w = sw * base * tr.scale;
  const h = sh * base * tr.scale;
  return { w, h, x: W / 2 + tr.x * W - w / 2, y: H / 2 + tr.y * H - h / 2 };
}
