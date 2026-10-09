import { prisma } from "@/server/db";
import { HttpError, requireUserId, route, type Ctx } from "@/server/http";
import { analyseAsset } from "@/server/audiolink";

export const maxDuration = 300;

// Audio panel → "Beat effects": the track's beat grid + drop (edit-reel beats.py), cached in meta.analysis.
export const POST = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const asset = await prisma.mediaAsset.findFirst({ where: { id, userId } });
  if (!asset) throw new HttpError(404, "Not found");
  const analysis = await analyseAsset(asset);
  return { asset: await prisma.mediaAsset.findUnique({ where: { id } }), analysis };
});
