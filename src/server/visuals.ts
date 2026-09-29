import "server-only";
import type { MediaAsset } from "@prisma/client";
import type { Aspect, VisualClip } from "@/lib/timeline/types";
import { newVisualClip, GRADIENTS } from "@/lib/timeline/factory";
import { prisma } from "./db";
import { hasPexels, searchPhotos, searchVideos, type StockItem } from "./pexels";

// Visual matching: the user's own library first (by tags + file name), then Pexels
// stock video, then Pexels photos, then a gradient card so a first cut always exists.

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
    // Stock footage's own sound is rarely wanted under a voiceover.
    muted: a.source === "pexels",
    keywords: a.tags,
    ...extra,
  });
}

export async function stockAsset(userId: string, item: StockItem, tags: string[]) {
  const existing = await prisma.mediaAsset.findFirst({ where: { userId, url: item.url } });
  if (existing) return existing;
  return prisma.mediaAsset.create({
    data: {
      userId,
      type: item.type,
      source: "pexels",
      url: item.url,
      thumbUrl: item.thumb,
      name: tags.slice(0, 3).join(" ") || item.id,
      duration: item.duration,
      width: item.width,
      height: item.height,
      tags: [...new Set(tags.map((t) => t.toLowerCase()))].slice(0, 12),
      meta: { pexelsId: item.id, author: item.author, pageUrl: item.pageUrl, hasAudio: false },
    },
  });
}

export async function pickVisual(opts: {
  userId: string;
  library: MediaAsset[];
  keywords: string[];
  query: string;
  duration: number;
  aspect: Aspect;
  used: Set<string>;
  index: number;
  useLibrary?: boolean;
  useStock?: boolean;
}): Promise<{ asset: MediaAsset | null; colors?: [string, string] }> {
  const { keywords, used } = opts;
  const library = opts.useLibrary === false ? [] : opts.library;
  // 1) user's own media
  const ranked = library
    .filter((a) => (a.type === "video" || a.type === "image") && a.source !== "pexels" && a.source !== "ai")
    .map((a) => ({ a, s: scoreAsset(a, keywords) - (used.has(a.id) ? 0.5 : 0) }))
    .filter((x) => x.s > 0.4)
    .sort((x, y) => y.s - x.s);
  if (ranked.length) {
    used.add(ranked[0].a.id);
    return { asset: ranked[0].a };
  }
  // 2) Pexels video, 3) Pexels photo
  if (hasPexels() && opts.useStock !== false) {
    const tags = [...keywords, ...opts.query.split(/\s+/)];
    for (const q of [opts.query, keywords.slice(0, 2).join(" ")].filter(Boolean)) {
      try {
        const vids = await searchVideos(q, opts.aspect, 8);
        const v = vids.find((x) => !used.has(x.url) && (x.duration ?? 0) >= opts.duration) ?? vids.find((x) => !used.has(x.url));
        if (v) {
          used.add(v.url);
          return { asset: await stockAsset(opts.userId, v, tags) };
        }
        const photos = await searchPhotos(q, opts.aspect, 8);
        const p = photos.find((x) => !used.has(x.url));
        if (p) {
          used.add(p.url);
          return { asset: await stockAsset(opts.userId, p, tags) };
        }
      } catch (err) {
        console.error("[visuals] Pexels search failed:", err);
      }
    }
  }
  // 4) gradient card
  return { asset: null, colors: GRADIENTS[opts.index % GRADIENTS.length] };
}
