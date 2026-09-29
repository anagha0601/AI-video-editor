import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/server/db";
import { synthesizeSpeech } from "@/server/generate";
import { hasGemini } from "@/server/gemini";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { putObject } from "@/server/storage";

export const maxDuration = 120;

const body = z.object({
  script: z.string().trim().min(3, "The script is empty").max(6000),
  voice: z.string().trim().max(30).default("Kore"),
  tone: z.string().trim().max(40).default("engaging"),
});

/** Script -> AI voiceover (Gemini TTS) -> same pipeline as an uploaded recording. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const project = await ownedProject(id, userId);
  if (!hasGemini()) throw new HttpError(400, "AI voiceovers need GEMINI_API_KEY");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid script");
  const { script, voice, tone } = parsed.data;

  const wav = await synthesizeSpeech(script, voice, tone);
  const key = `u/${userId}/voice/${nanoid(12)}-ai-voice.wav`;
  const url = await putObject(key, wav, "audio/wav");
  const asset = await prisma.mediaAsset.create({
    data: { userId, type: "audio", source: "tts", key, url, name: `AI voice (${voice})`, mime: "audio/wav", tags: ["voiceover", "ai"], meta: { voice, tone } },
  });
  await prisma.$transaction([
    prisma.voiceTrack.upsert({
      where: { projectId: project.id },
      create: { projectId: project.id, assetId: asset.id, url, status: "queued" },
      update: { assetId: asset.id, url, status: "queued", attempts: 0, error: null, lockedAt: null },
    }),
    prisma.project.update({ where: { id: project.id }, data: { status: "transcribing", statusMessage: null, prompt: project.prompt ?? script } }),
  ]);
  return { ok: true };
});
