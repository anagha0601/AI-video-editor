import "server-only";
import type { MediaAsset } from "@prisma/client";
import type { VisualClip } from "@/lib/timeline/types";
import { newVisualClip, GRADIENTS } from "@/lib/timeline/factory";

// Visual matching: the user's own library (by tags + file name), then a gradient
// card so a first cut always exists.

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ies)$/, "y").replace(/s$/, "");

function tokens(a: MediaAsset) {
  return new Set([...a.tags, ...a.name.split(/[^a-zA-Z0-9]+/)].map(norm).filter((t) => t.length > 2));
}

export function scoreAsset(a: MediaAsset, keywords: string[]) {
  const t = tokens(a);
  let score = 0;
  for (const k of keywords.flatMap((k) => k.split(/\s+/)).map(norm)) if (k.length > 2 && t.has(k)) score++;
  return score;
}

export function clipFromAsset(a: MediaAsset, start: number, duration: number, extra: Partial<VisualClip> = {}): VisualClip {
  const meta = (a.meta ?? {}) as { hasAudio?: boolean };
  return newVisualClip({
    type: a.type === "video" ? "video" : "image",
    start,
    duration: a.type === "video" && a.duration ? Math.min(duration, a.duration) : duration,
    assetId: a.id,
    src: a.url,
    thumb: a.thumbUrl ?? (a.type === "image" ? a.url : null),
    name: a.name,
    srcDuration: a.duration,
    srcWidth: a.width,
    srcHeight: a.height,
    hasAudio: meta.hasAudio ?? a.type === "video",
    // Legacy stock footage's own sound is rarely wanted under a voiceover.
    muted: a.source === "pexels",
    keywords: a.tags,
    ...extra,
  });
}

export function pickVisual(opts: {
  library: MediaAsset[];
  keywords: string[];
  used: Set<string>;
  index: number;
}): { asset: MediaAsset | null; colors?: [string, string] } {
  const { keywords, used } = opts;
  // 1) user's own media (legacy stock/AI assets are skipped)
  const ranked = opts.library
    .filter((a) => (a.type === "video" || a.type === "image") && a.source !== "pexels" && a.source !== "ai")
    .map((a) => ({ a, s: scoreAsset(a, keywords) - (used.has(a.id) ? 0.5 : 0) }))
    .filter((x) => x.s > 0.4)
    .sort((x, y) => y.s - x.s);
  if (ranked.length) {
    used.add(ranked[0].a.id);
    return { asset: ranked[0].a };
  }
  // 2) gradient card
  return { asset: null, colors: GRADIENTS[opts.index % GRADIENTS.length] };
}
