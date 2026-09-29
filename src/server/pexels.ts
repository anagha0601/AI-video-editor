import "server-only";
import type { Aspect } from "@/lib/timeline/types";

export const hasPexels = () => Boolean(process.env.PEXELS_API_KEY);

export interface StockItem {
  id: string; // "pexels-video-123" | "pexels-photo-123"
  type: "video" | "image";
  url: string;
  thumb: string;
  width: number;
  height: number;
  duration: number | null;
  author: string;
  pageUrl: string;
}

const ORIENT: Record<Aspect, string> = { "9:16": "portrait", "16:9": "landscape", "1:1": "square" };

async function get(url: string) {
  const res = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY! }, next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`Pexels ${res.status}`);
  return res.json();
}

type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  image: string;
  user: { name: string };
  video_files: { link: string; width: number | null; height: number | null; file_type: string; quality: string }[];
};

type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  src: { large2x: string; large: string; medium: string; original: string };
};

/** Pick an mp4 rendition whose short side is closest to 1080 (never tiny). */
function bestFile(v: PexelsVideo) {
  const files = v.video_files.filter((f) => f.file_type === "video/mp4" && f.width && f.height);
  const score = (f: (typeof files)[number]) => Math.abs(Math.min(f.width!, f.height!) - 1080) + (Math.min(f.width!, f.height!) < 700 ? 5000 : 0);
  return files.sort((a, b) => score(a) - score(b))[0];
}

export async function searchVideos(query: string, aspect: Aspect | null, perPage = 12): Promise<StockItem[]> {
  if (!hasPexels() || !query.trim()) return [];
  const orient = aspect ? `&orientation=${ORIENT[aspect]}` : "";
  const data = await get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}${orient}&size=medium`);
  return (data.videos as PexelsVideo[])
    .map((v) => {
      const f = bestFile(v);
      if (!f) return null;
      return {
        id: `pexels-video-${v.id}`,
        type: "video" as const,
        url: f.link,
        thumb: v.image,
        width: f.width!,
        height: f.height!,
        duration: v.duration,
        author: v.user?.name ?? "Pexels",
        pageUrl: v.url,
      };
    })
    .filter(Boolean) as StockItem[];
}

export async function searchPhotos(query: string, aspect: Aspect | null, perPage = 12): Promise<StockItem[]> {
  if (!hasPexels() || !query.trim()) return [];
  const orient = aspect ? `&orientation=${ORIENT[aspect]}` : "";
  const data = await get(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}${orient}`);
  return (data.photos as PexelsPhoto[]).map((p) => {
    // large2x is ~1880px on the long side: enough for 1080p Ken Burns.
    const scale = Math.min(1, 1880 / Math.max(p.width, p.height));
    return {
      id: `pexels-photo-${p.id}`,
      type: "image" as const,
      url: p.src.large2x,
      thumb: p.src.medium,
      width: Math.round(p.width * scale),
      height: Math.round(p.height * scale),
      duration: null,
      author: p.photographer,
      pageUrl: p.url,
    };
  });
}
