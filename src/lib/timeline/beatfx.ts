// Beat effects: make a music-led edit move with the track. From the music's beat grid and drop (beats.py) this
// adds zoom punches on the beats, shake + flash on the drop, flash/zoom transitions on cuts, and (where the source
// resolution leaves room for a punch-in, rules.md) beat cuts that split long shots with alternating 100%/112% zoom.
// Pure: used by the Audio panel ("Beat effects") and by the music-edit plan builder (src/server/modes.ts).
import { clipEnd, FX_DEFAULTS } from "./derive";
import { splitAt } from "./ops";
import type { AudioClip, BeatFx, Timeline, VideoTrack, VisualClip } from "./types";

export type Energy = "subtle" | "punchy" | "hype";
export const ENERGY: Record<Energy, { label: string; hint: string }> = {
  subtle: { label: "Subtle", hint: "a punch every bar, flash on the drop" },
  punchy: { label: "Punchy", hint: "punch every 2 beats, cuts every 2 beats, shake + flash on the drop" },
  hype: { label: "Hype", hint: "punch on every beat, cuts every beat, shakes after the drop, zoom transitions" },
};

/** Source analysis of a music asset (meta.analysis), in SOURCE seconds of that asset. */
export interface TrackBeats {
  beats: number[];
  drops: { t: number; score: number }[];
  beatPeriod?: number | null;
}

/** The music track's beats and drops mapped to timeline seconds (through each music clip's trim, speed and position). */
export function timelineBeats(tl: Timeline, byAsset: Record<string, TrackBeats | undefined>) {
  const beats: number[] = [];
  const drops: { t: number; score: number }[] = [];
  let period = 0;
  for (const tr of tl.tracks) {
    if (tr.kind !== "music" || tr.muted) continue;
    for (const c of tr.clips as AudioClip[]) {
      const a = c.assetId ? byAsset[c.assetId] : undefined;
      if (!a || c.muted) continue;
      const map = (s: number) => c.start + (s - c.in) / c.speed;
      const inClip = (t: number) => t >= c.start - 1e-3 && t < clipEnd(c);
      beats.push(...a.beats.map(map).filter(inClip));
      drops.push(...a.drops.map((d) => ({ t: map(d.t), score: d.score })).filter((d) => inClip(d.t)));
      if (!period && a.beatPeriod) period = a.beatPeriod / c.speed;
    }
  }
  beats.sort((x, y) => x - y);
  if (!period && beats.length > 1) period = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
  return { beats, drops: drops.sort((x, y) => y.score - x.score), period };
}

/** The video track that carries the edit: the one with the most clip time. */
export function mainVideoTrack(tl: Timeline) {
  let best: VideoTrack | null = null;
  let most = -1;
  for (const tr of tl.tracks) {
    if (tr.kind !== "video" || tr.hidden) continue;
    const d = tr.clips.reduce((n, c) => n + c.duration, 0);
    if (d > most) [best, most] = [tr, d];
  }
  return best;
}

/** Extra zoom a clip can take without scaling its source past its own resolution (rules.md). */
export function zoomRoom(tl: Timeline, c: VisualClip) {
  if (c.type !== "video" && c.type !== "image") return 1;
  const sw = c.srcWidth ?? 0;
  const sh = c.srcHeight ?? 0;
  if (!sw || !sh) return 1;
  const base = (c.transform.fit === "cover" ? Math.max(tl.width / sw, tl.height / sh) : Math.min(tl.width / sw, tl.height / sh)) * c.transform.scale;
  return Math.max(1, 1 / base);
}

const near = (t: number, xs: number[], tol: number) => xs.some((x) => Math.abs(x - t) <= tol);

/**
 * Replace the timeline's beat effects (and the transitions it set before) with a fresh set for `level`.
 * Returns the new timeline and what changed, for the toast.
 */
export function energize(tl: Timeline, beatsIn: ReturnType<typeof timelineBeats>, level: Energy) {
  let out: Timeline = structuredClone(tl);
  const T = out.tracks.reduce((m, tr) => Math.max(m, ...(tr.clips as { start: number; duration: number }[]).map(clipEnd), 0), 0);
  const beats = beatsIn.beats.filter((b) => b >= 0.05 && b < T - 0.1);
  const period = beatsIn.period || 0.5;
  const drop = beatsIn.drops.find((d) => d.t > 0.3 && d.t < T - 0.3)?.t ?? null;
  const tol = Math.min(0.08, period / 4);
  let splits = 0;

  // 1) beat cuts: long shots split on beats with alternating zoom, only where the source has the resolution
  const every = level === "hype" ? 1 : level === "punchy" ? 2 : 0;
  const main = mainVideoTrack(out);
  if (every && main) {
    for (const c of [...main.clips]) {
      const room = zoomRoom(out, c);
      if (room < 1.06 || c.type === "color") continue;
      const zoom = Math.min(1.12, room);
      const inside = beats.filter((b) => b > c.start + period * 0.9 && b < clipEnd(c) - period * 0.9);
      const at = inside.filter((_, i) => (i + 1) % every === 0);
      let zoomed = false;
      for (const b of at) {
        const cur = (out.tracks.find((x) => x.id === main.id) as VideoTrack).clips.find((x) => x.start <= b && clipEnd(x) > b);
        if (!cur) continue;
        out = splitAt(out, b, [cur.id]);
        const tr = out.tracks.find((x) => x.id === main.id) as VideoTrack;
        const right = tr.clips.find((x) => Math.abs(x.start - b) < 1e-6);
        if (!right) continue;
        zoomed = !zoomed;
        const s = c.transform.scale * (zoomed ? zoom : 1);
        right.transform = { ...right.transform, scale: Math.round(s * 10000) / 10000 };
        right.transition = null;
        splits++;
      }
    }
  }

  // 2) transitions on the cuts: flash on the drop cut, quick zoom on every other bar cut (hype)
  const track = mainVideoTrack(out);
  // a cut under a clip on an upper video track can't be seen: its flash goes on the whole picture instead
  const above = track ? out.tracks.slice(0, out.tracks.findIndex((x) => x.id === track.id)).filter((x): x is VideoTrack => x.kind === "video" && !x.hidden) : [];
  const covered = (t: number) => above.some((x) => x.clips.some((c) => c.start <= t + 0.05 && clipEnd(c) > t + 0.05));
  const cuts: number[] = [];
  let transitions = 0;
  let dropCut = false;
  if (track) {
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    clips.forEach((c, i) => {
      if (i === 0 || Math.abs(clipEnd(clips[i - 1]) - c.start) > 0.05) return;
      cuts.push(c.start);
      const auto = !c.transition || c.transition.type === "cut" || ((c.transition.type === "flash" || c.transition.type === "zoom") && c.transition.duration <= 0.35);
      if (!auto) return;
      if (drop !== null && Math.abs(c.start - drop) <= Math.max(tol, 0.12) && level !== "subtle" && !covered(c.start)) {
        c.transition = { type: "flash", duration: Math.min(0.3, c.duration * 0.5) };
        dropCut = true;
        transitions++;
      } else if (level === "hype" && cuts.length % 2 === 0 && c.duration > 0.45 && near(c.start, beats, tol) && !covered(c.start)) {
        c.transition = { type: "zoom", duration: 0.2 };
        transitions++;
      } else c.transition = null;
    });
  }

  // 3) beat effects
  const fx: BeatFx[] = [];
  const add = (type: BeatFx["type"], t: number, strength: number, duration = FX_DEFAULTS[type].duration) =>
    fx.push({ type, t: Math.round(t * 1000) / 1000, strength: Math.round(strength * 10000) / 10000, duration });
  const step = level === "hype" ? 1 : level === "punchy" ? 2 : 4;
  const base = level === "hype" ? 0.075 : level === "punchy" ? 0.09 : 0.06;
  beats.forEach((b, i) => {
    if (drop !== null && Math.abs(b - drop) <= tol) return; // the drop gets its own hit
    const bar = i % 4 === 0;
    if (i % step !== 0 && !(level !== "subtle" && near(b, cuts, tol))) return;
    add("punch", b, base + (bar && level === "hype" ? 0.04 : 0) + (near(b, cuts, tol) ? 0.03 : 0));
    if (level === "hype" && bar && drop !== null && b > drop + period) add("shake", b, 0.008, 0.25);
  });
  if (drop !== null) {
    const k = level === "hype" ? 1 : level === "punchy" ? 0.8 : 0.55;
    add("punch", drop, 0.16 * k, 0.4);
    add("shake", drop, 0.022 * k, 0.45);
    if (!dropCut) add("flash", drop, 0.7 * k, 0.28);
  }
  fx.sort((a, b) => a.t - b.t);
  out.fx = fx;
  return { timeline: out, stats: { fx: fx.length, splits, transitions, drop, beats: beats.length } };
}
