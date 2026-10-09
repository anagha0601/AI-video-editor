import { prisma } from "@/server/db";
import { jobDTO } from "@/server/agent";
import { HttpError, requireUserId, route, type Ctx } from "@/server/http";

export const GET = route(async (_req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  const job = await prisma.agentJob.findFirst({ where: { id, userId } });
  if (!job) throw new HttpError(404, "Job not found");
  return { job: jobDTO(job) };
});
