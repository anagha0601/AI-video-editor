import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { assertTimeline } from "@/server/validate";

export const GET = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const renders = await prisma.renderJob.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    include: { version: { select: { id: true, name: true } } },
  });
  return { renders };
});

const body = z.object({
  quality: z.enum(["720p", "1080p"]).default("1080p"),
  versionId: z.string().optional(),
  json: z.any().optional(), // current editor state; snapshotted as the render's version
});

/**
 * Queue a render. Every render points at an immutable TimelineVersion: either the
 * one given, or a fresh "Render" snapshot of the timeline the editor sent.
 */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const project = await ownedProject(id, userId);
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Invalid render request");
  const { quality, versionId } = parsed.data;
  let vid = versionId;
  if (vid) {
    const v = await prisma.timelineVersion.findFirst({ where: { id: vid, projectId: id } });
    if (!v) throw new HttpError(404, "Version not found");
  } else {
    let json = parsed.data.json;
    if (json) {
      assertTimeline(json);
      await prisma.timeline.update({ where: { projectId: id }, data: { json: json as unknown as Prisma.InputJsonValue, revision: { increment: 1 } } });
    } else {
      json = (await prisma.timeline.findUnique({ where: { projectId: id } }))?.json;
    }
    if (!json) throw new HttpError(400, "Nothing to render yet");
    const n = (await prisma.renderJob.count({ where: { projectId: id } })) + 1;
    const stamp = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const v = await prisma.timelineVersion.create({
      data: { projectId: id, name: `Render #${n} · ${stamp}`, kind: "render", json: json as unknown as Prisma.InputJsonValue },
    });
    vid = v.id;
  }
  const job = await prisma.renderJob.create({
    data: { projectId: project.id, userId, versionId: vid, quality },
    include: { version: { select: { id: true, name: true } } },
  });
  return { render: job };
});
