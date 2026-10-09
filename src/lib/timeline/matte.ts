// Background swap helpers shared by the Background panel and the plan builder (src/server/matte.ts queues the jobs).
import { clipEnd } from "./derive";
import { newVisualClip, uid } from "./factory";
import type { Timeline, VideoTrack, VisualClip } from "./types";

export const BACKGROUND_TRACK = "Background";

/** Source windows the given clips use, one per source: [min in, max out] (+0.2 s margin either side). */
export function matteWindows(clips: VisualClip[]) {
  const by = new Map<string, { src: string; name: string; a: number; b: number; srcDuration: number | null }>();
  for (const c of clips) {
    if (c.type !== "video" || !c.src) continue;
    const a = c.in;
    const b = c.in + c.duration * c.speed;
    const w = by.get(c.src);
    if (w) [w.a, w.b] = [Math.min(w.a, a), Math.max(w.b, b)];
    else by.set(c.src, { src: c.src, name: c.name, a, b, srcDuration: c.srcDuration ?? null });
  }
  return [...by.values()].map((w) => {
    const srcIn = Math.max(0, w.a - 0.2);
    const end = w.srcDuration ? Math.min(w.srcDuration, w.b + 0.2) : w.b + 0.2;
    return { src: w.src, name: w.name, srcIn: Math.round(srcIn * 1000) / 1000, srcLen: Math.round((end - srcIn) * 1000) / 1000 };
  });
}

/** Does the clip's matte cover the source window it plays now (after trims)? */
export const matteCovers = (c: VisualClip) =>
  !!c.matte && c.in >= c.matte.srcIn - 0.05 && c.in + c.duration * c.speed <= c.matte.srcIn + c.matte.srcLen + 0.05;

export const backgroundTrack = (tl: Timeline) => tl.tracks.find((t): t is VideoTrack => t.kind === "video" && t.name === BACKGROUND_TRACK) ?? null;

/** A full-length background image on a bottom "Background" video track (replaces the one that is there). Mutates tl. */
export function setBackground(
  tl: Timeline,
  image: { url: string; id: string; name: string; thumbUrl?: string | null; width?: number | null; height?: number | null },
) {
  const T = tl.tracks.reduce((m, t) => (t.name === BACKGROUND_TRACK ? m : Math.max(m, ...(t.clips as { start: number; duration: number }[]).map(clipEnd), 0)), 0);
  let bg = backgroundTrack(tl);
  if (!bg) {
    bg = { id: uid("t"), kind: "video", name: BACKGROUND_TRACK, clips: [] };
    tl.tracks.splice(tl.tracks.map((t) => t.kind).lastIndexOf("video") + 1, 0, bg); // below every other video track
  }
  bg.clips = [
    newVisualClip({
      type: "image",
      start: 0,
      duration: Math.max(0.5, T),
      src: image.url,
      assetId: image.id,
      thumb: image.thumbUrl ?? image.url,
      name: `Background · ${image.name}`,
      srcWidth: image.width ?? null,
      srcHeight: image.height ?? null,
      kenBurns: null,
    }),
  ];
  return tl;
}
