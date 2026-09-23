import "server-only";
import { db } from "./db";
import { findStockImage } from "./media";
import type { Photo, StoryboardScene } from "./ai";
import type { Scene } from "./types";

export const MAX_PHOTOS = 12;

// Loads the caller's own photos, in the order given, for the AI to look at.
export async function loadPhotos(userId: string, assetIds: string[]) {
  if (!assetIds.length) return { ids: [] as string[], photos: [] as Photo[] };
  const rows = await db.asset.findMany({
    where: { userId, id: { in: assetIds.slice(0, MAX_PHOTOS) } },
    select: { id: true, mime: true, data: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = assetIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  return {
    ids: ordered.map((r) => r.id),
    photos: ordered.map((r) => ({ mime: r.mime, base64: Buffer.from(r.data).toString("base64") })),
  };
}

// Resolves each scene's visual: the user's photo if assigned, otherwise a stock image.
export async function attachVisuals(scenes: StoryboardScene[], photoIds: string[], aspect: string): Promise<Scene[]> {
  return Promise.all(
    scenes.map(async ({ photoIndex, ...s }) => {
      const photoId = photoIndex ? photoIds[photoIndex - 1] : undefined;
      if (photoId) return { ...s, mediaUrl: `/api/assets/${photoId}`, credit: null };
      const img = await findStockImage(s.visualQuery, aspect);
      return { ...s, mediaUrl: img?.url ?? null, credit: img?.credit ?? null };
    }),
  );
}
