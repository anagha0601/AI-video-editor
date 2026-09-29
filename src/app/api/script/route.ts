import { z } from "zod";
import { writeScript } from "@/server/generate";
import { hasGemini } from "@/server/gemini";
import { HttpError, requireUserId, route } from "@/server/http";

export const maxDuration = 60;

const body = z.object({
  idea: z.string().trim().min(3, "Describe your idea").max(4000),
  seconds: z.number().int().min(10).max(180).default(30),
  tone: z.string().trim().max(40).default("engaging"),
});

/** Idea -> voiceover script (the user can edit it before narration). */
export const POST = route(async (req: Request) => {
  const userId = await requireUserId();
  if (!hasGemini()) throw new HttpError(400, "Writing scripts needs GEMINI_API_KEY");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid idea");
  const usage = { userId, ids: [] as string[] };
  const res = await writeScript(parsed.data.idea, parsed.data.seconds, parsed.data.tone, usage);
  // The project doesn't exist yet; the client passes these ids on create so the cost is attributed to it.
  return { ...res, usageIds: usage.ids };
});
