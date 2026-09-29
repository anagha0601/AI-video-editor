import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { keyFromUrl } from "@/server/storage";

const body = z.object({
  url: z.string().min(1).max(2000),
  name: z.string().max(200).default("Voiceover"),
  mime: z.string().max(120).optional(),
  source: z.enum(["upload", "recording"]).default("upload"),
});

/** Attach an uploaded/recorded voice file and queue transcription in the worker. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const project = await ownedProject(id, userId);
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, "Invalid voice upload");
  const { url, name, mime, source } = parsed.data;
  const key = keyFromUrl(url);
  if (!key || !key.startsWith(`u/${userId}/`)) throw new HttpError(400, "Upload the file first");

  const asset = await prisma.mediaAsset.create({
    data: { userId, type: "audio", source, key, url, name, mime, tags: ["voiceover"] },
  });
  await prisma.$transaction([
    prisma.voiceTrack.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, assetId: asset.id, url, status: "queued" },
      update: { assetId: asset.id, url, status: "queued", attempts: 0, error: null, transcriptJson: undefined, lockedAt: null },
    }),
    prisma.project.update({ where: { id: project.id }, data: { status: "transcribing", statusMessage: null } }),
  ]);
  return { ok: true };
});
