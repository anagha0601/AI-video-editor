import { z } from "zod";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { approvePlan, isPlanMode } from "@/server/modes";

const body = z.object({ plan: z.any() });

/** Approve the (edited) plan: build editable timeline tracks. Auto-clip returns the new shorts' project ids. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const project = await ownedProject(id, userId);
  if (!isPlanMode(project.mode)) throw new HttpError(400, "This project has no plan");
  if (project.status !== "review") throw new HttpError(409, "The plan isn't ready for approval");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Missing plan");
  return approvePlan(project, parsed.data.plan);
});
