import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

const CACHE = "private, max-age=31536000, immutable";

// Serves a user's own photo or clip. Same-origin, so the canvas renderer can export it.
// `?poster=1` returns a still image for either kind (the photo itself, or a clip's frame).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new Response("Not signed in", { status: 401 });
  const where = { id: (await params).id, userId };

  const meta = await db.asset.findFirst({ where, select: { kind: true, mime: true } });
  if (!meta) return new Response("Not found", { status: 404 });

  if (meta.kind === "video" && new URL(req.url).searchParams.has("poster")) {
    const { poster } = await db.asset.findFirstOrThrow({ where, select: { poster: true } });
    if (!poster) return new Response("No poster", { status: 404 });
    return new Response(new Uint8Array(poster), { headers: { "Content-Type": "image/jpeg", "Cache-Control": CACHE } });
  }

  const { data } = await db.asset.findFirstOrThrow({ where, select: { data: true } });
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": meta.mime, "Cache-Control": CACHE, "Content-Length": String(data.length) },
  });
}
