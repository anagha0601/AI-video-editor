import { db } from "@/lib/db";
import { getSessionUserId } from "@/lib/auth";

// Serves a user's own photo. Same-origin, so the canvas renderer can export it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return new Response("Not signed in", { status: 401 });
  const asset = await db.asset.findFirst({
    where: { id: (await params).id, userId },
    select: { mime: true, data: true },
  });
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: { "Content-Type": asset.mime, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
