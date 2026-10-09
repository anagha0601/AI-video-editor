import { z } from "zod";
import { jobDTO } from "@/server/agent";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { estimateMatte, queueMatte } from "@/server/matte";

export const maxDuration = 300;

const body = z.object({
  windows: z.array(z.object({ src: z.string().min(1), srcIn: z.number().min(0), srcLen: z.number().positive().max(900), name: z.string().max(200) })).min(1).max(20),
  run: z.boolean().default(false), // false = time estimate only
});

/**
 * Background panel: cut the person out of each source window (worker/matte.py on the CPU).
 * {run:false} -> estimate per window; {run:true} -> one local command job per window. When a job is done the
 * client (or settleMattes on the next load) sets clip.matte = {on: true, url, srcIn, srcLen}.
 */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Invalid request");
  const { windows, run } = parsed.data;
  if (!run) {
    const est = [];
    for (const w of windows) est.push({ src: w.src, ...(await estimateMatte(userId, w.src, w.srcIn, w.srcLen)) });
    return { estimates: est, seconds: est.reduce((n, e) => n + e.seconds, 0) };
  }
  const queued = [];
  for (const w of windows) {
    const q = await queueMatte(userId, id, w.src, w.srcIn, w.srcLen, w.name);
    queued.push({ src: w.src, job: jobDTO(q.job), url: q.url, srcIn: q.srcIn, srcLen: q.srcLen });
  }
  return { queued };
});
