import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { timelineDuration } from "@/lib/timeline/derive";
import { prisma } from "@/server/db";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { assertTimeline } from "@/server/validate";

export const GET = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const tl = await prisma.timeline.findUnique({ where: { projectId: id } });
  if (!tl) throw new HttpError(404, "No timeline yet");
  return { json: tl.json, revision: tl.revision, updatedAt: tl.updatedAt };
});

const body = z.object({ json: z.any(), revision: z.number().int().optional(), force: z.boolean().optional() });

/**
 * Autosave. `revision` is the revision the client last loaded/saved; if another tab
 * saved since, we return 409 with the server copy unless `force` is set.
 */
export const PUT = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Invalid body");
  const { json, revision, force } = parsed.data;
  assertTimeline(json);
  const current = await prisma.timeline.findUnique({ where: { projectId: id } });
  if (current && revision !== undefined && current.revision !== revision && !force) {
    return Response.json({ error: "conflict", revision: current.revision, json: current.json }, { status: 409 });
  }
  const saved = await prisma.timeline.upsert({
    where: { projectId: id },
    create: { projectId: id, json: json as unknown as Prisma.InputJsonValue },
    update: { json: json as unknown as Prisma.InputJsonValue, revision: { increment: 1 } },
  });
  await prisma.project.update({ where: { id }, data: { duration: timelineDuration(json) } });
  return { revision: saved.revision, updatedAt: saved.updatedAt };
});
