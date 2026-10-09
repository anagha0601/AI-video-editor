import { prisma } from "@/server/db";
import { jobDTO } from "@/server/agent";
import { requireUserId, route } from "@/server/http";

export const GET = route(async (req: Request) => {
  const userId = await requireUserId();
  const projectId = new URL(req.url).searchParams.get("projectId");
  const jobs = await prisma.agentJob.findMany({
    where: { userId, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { project: { select: { title: true } } },
  });
  return { jobs: jobs.map((j) => ({ ...jobDTO(j), projectTitle: j.project?.title ?? null })) };
});
