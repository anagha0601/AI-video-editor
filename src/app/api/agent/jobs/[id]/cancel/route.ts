import { prisma } from "@/server/db";
import { jobDTO } from "@/server/agent";
import { HttpError, requireUserId, route, type Ctx } from "@/server/http";

/** Queued jobs are cancelled here; running ones are killed (whole process tree) by the runner within ~1s. */
export const POST = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const job = await prisma.agentJob.findFirst({ where: { id, userId } });
  if (!job) throw new HttpError(404, "Job not found");
  await prisma.agentJob.updateMany({ where: { id, status: "queued" }, data: { status: "cancelled", cancelRequested: true, error: "Cancelled", finishedAt: new Date() } });
  await prisma.agentJob.updateMany({ where: { id, status: "running" }, data: { cancelRequested: true } });
  return { job: jobDTO((await prisma.agentJob.findUnique({ where: { id } }))!) };
});
