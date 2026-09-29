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
});

export const POST = route(async (req: Request) => {
  const userId = await requireUserId();
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Invalid project");
  const project = await prisma.project.create({
    data: { userId, title: parsed.data.title || "Untitled video", aspect: parsed.data.aspect },
    select: { id: true },
  });
  return { project };
});
