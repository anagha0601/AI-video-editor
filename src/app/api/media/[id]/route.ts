import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError, requireUserId, route, type Ctx } from "@/server/http";
import { deleteObject, keyFromUrl } from "@/server/storage";

const patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).optional(),
});

export const PATCH = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Invalid update");
  const res = await prisma.mediaAsset.updateMany({ where: { id, userId }, data: parsed.data });
  if (!res.count) throw new HttpError(404, "Not found");
  return { asset: await prisma.mediaAsset.findUnique({ where: { id } }) };
});

/** Removes the library entry (and our stored file). Timelines that use it keep their URL until then. */
export const DELETE = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, userId } });
  if (!asset) throw new HttpError(404, "Not found");
  const inUse = await prisma.voiceTrack.count({ where: { assetId: id } });
  if (inUse) throw new HttpError(409, "This recording is a project's voiceover");
  await prisma.mediaAsset.delete({ where: { id } });
  if (asset.key) await deleteObject(asset.key);
  const thumbKey = asset.thumbUrl ? keyFromUrl(asset.thumbUrl) : null;
  if (thumbKey?.startsWith(`u/${userId}/`)) await deleteObject(thumbKey);
  return { ok: true };
});
