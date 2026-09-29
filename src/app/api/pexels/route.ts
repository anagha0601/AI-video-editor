import type { Aspect } from "@/lib/timeline/types";
import { requireUserId, route } from "@/server/http";
import { hasPexels, searchPhotos, searchVideos } from "@/server/pexels";

export const GET = route(async (req: Request) => {
  await requireUserId();
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const type = url.searchParams.get("type") === "image" ? "image" : "video";
  const aspect = (url.searchParams.get("aspect") as Aspect | null) || null;
  if (!hasPexels()) return { configured: false, items: [] };
  if (!q) return { configured: true, items: [] };
  const items = type === "video" ? await searchVideos(q, aspect, 24) : await searchPhotos(q, aspect, 24);
  return { configured: true, items };
});
