import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError, requireUserId, route } from "@/server/http";

export const GET = route(async () => {
  const userId = await requireUserId();
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, aspect: true, status: true, thumbnailUrl: true, duration: true, updatedAt: true, isSample: true },
  });
  return { projects };
});

const body = z.object({
  title: z.string().trim().max(100).optional(),
  aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  mode: z.enum(["voice", "idea", "script"]).default("voice"),
  prompt: z.string().trim().max(6000).optional(),
  visualMode: z.enum(["auto", "ai", "stock"]).default("auto"),
  assetIds: z.array(z.string()).max(100).default([]),
  usageIds: z.array(z.string()).max(50).default([]), // script-writing calls made before the project existed
});

export const POST = route(async (req: Request) => {
  const userId = await requireUserId();
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Invalid project");
  const project = await prisma.project.create({
    data: {
      userId,
      title: parsed.data.title || "Untitled video",
      aspect: parsed.data.aspect,
      mode: parsed.data.mode,
      prompt: parsed.data.prompt || null,
      visualMode: parsed.data.visualMode,
      // only the caller's own media
      assetIds: (await prisma.mediaAsset.findMany({ where: { id: { in: parsed.data.assetIds }, userId }, select: { id: true } })).map((a) => a.id),
    },
    select: { id: true },
  });
  if (parsed.data.usageIds.length) {
    await prisma.apiUsage.updateMany({ where: { id: { in: parsed.data.usageIds }, userId, projectId: null }, data: { projectId: project.id } });
  }
  return { project };
});
