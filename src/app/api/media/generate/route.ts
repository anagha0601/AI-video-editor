import { z } from "zod";
import { generateImageAsset } from "@/server/generate";
import { hasGemini } from "@/server/gemini";
import { HttpError, requireUserId, route } from "@/server/http";
import { prisma } from "@/server/db";

export const maxDuration = 90;

const body = z.object({
  prompt: z.string().trim().min(3, "Describe the image").max(1500),
  aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  tags: z.array(z.string().trim().toLowerCase().max(40)).max(10).optional(),
  projectId: z.string().optional(),
});

/** Text prompt -> AI image in the user's library. */
export const POST = route(async (req: Request) => {
  const userId = await requireUserId();
  if (!hasGemini()) throw new HttpError(400, "AI images need GEMINI_API_KEY");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid prompt");
  const projectId = parsed.data.projectId && (await prisma.project.count({ where: { id: parsed.data.projectId, userId } })) ? parsed.data.projectId : null;
  const asset = await generateImageAsset(userId, parsed.data.prompt, parsed.data.aspect, parsed.data.tags ?? [], projectId);
  return { asset };
});
