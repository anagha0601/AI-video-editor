import { z } from "zod";
import { planAiEdit } from "@/server/aiedit";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { assertTimeline } from "@/server/validate";

export const maxDuration = 60;

const body = z.object({ command: z.string().trim().min(2).max(500), json: z.any() });

/** Natural-language command -> AI ops (with new media resolved). Applied client-side. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Type what you'd like to change");
  assertTimeline(parsed.data.json);
  return planAiEdit(userId, parsed.data.json, parsed.data.command);
});
