import "server-only";
import { db } from "./db";
import { findStockImage } from "./media";
import type { Photo, StoryboardScene } from "./ai";
import type { AssetRef, Scene } from "./types";
import { assetUrl } from "./types";

export const MAX_PHOTOS = 12;

// Kind + length of the caller's uploads, in the order given (unknown ids dropped).
export async function loadAssetRefs(userId: string, assetIds: string[]): Promise<AssetRef[]> {
  if (!assetIds.length) return [];
  const rows = await db.asset.findMany({
    where: { userId, id: { in: assetIds } },
    select: { id: true, kind: true, duration: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return assetIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ id: r.id, kind: r.kind === "video" ? "video" : "image", duration: r.duration }));
}

// Loads the caller's own photos and clips, in the order given, for the AI to look at.
// Clips are shown to the AI as their poster frame.
export async function loadPhotos(userId: string, assetIds: string[]) {
  if (!assetIds.length) return { refs: [] as AssetRef[], photos: [] as Photo[] };
  const ids = assetIds.slice(0, MAX_PHOTOS);
  const rows = await db.asset.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, kind: true, duration: true, mime: true, poster: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  // Photo bytes are fetched separately so a clip's (large) video data is never loaded here.
  const imageIds = ordered.filter((r) => r.kind !== "video").map((r) => r.id);
  const images = imageIds.length
    ? await db.asset.findMany({ where: { id: { in: imageIds } }, select: { id: true, data: true } })
    : [];
  const imageData = new Map(images.map((r) => [r.id, r.data]));
  const usable = ordered.filter((r) => (r.kind === "video" ? r.poster : imageData.get(r.id)));
  return {
    refs: usable.map((r): AssetRef => ({ id: r.id, kind: r.kind === "video" ? "video" : "image", duration: r.duration })),
    photos: usable.map((r) =>
      r.kind === "video"
        ? { mime: "image/jpeg", base64: Buffer.from(r.poster!).toString("base64"), video: true }
        : { mime: r.mime, base64: Buffer.from(imageData.get(r.id)!).toString("base64") },
    ),
  };
}

// Resolves each scene's visual: the user's photo/clip if assigned, otherwise a stock image.
export async function attachVisuals(scenes: StoryboardScene[], refs: AssetRef[], aspect: string): Promise<Scene[]> {
  return Promise.all(
    scenes.map(async ({ photoIndex, ...s }) => {
      const ref = photoIndex ? refs[photoIndex - 1] : undefined;
      if (ref?.kind === "video") {
        return {
          ...s,
          mediaUrl: assetUrl(ref.id),
          mediaType: "video" as const,
          credit: null,
          clipStart: 0,
          clipDuration: ref.duration,
          clipAudio: false,
          clipVolume: 1,
        };
      }
      if (ref) return { ...s, mediaUrl: assetUrl(ref.id), credit: null };
      const img = await findStockImage(s.visualQuery, aspect);
      return { ...s, mediaUrl: img?.url ?? null, credit: img?.credit ?? null };
    }),
  );
}
