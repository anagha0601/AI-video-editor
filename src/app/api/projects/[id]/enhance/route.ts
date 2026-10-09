import path from "node:path";
import { z } from "zod";
import { prisma } from "@/server/db";
import { createJob, jobDTO, readResult } from "@/server/agent";
import { enhancePrompt, writeSpec } from "@/server/enhance";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { assertTimeline } from "@/server/validate";
import { enhanceResultSchema, type EnhanceResult } from "@/agent/schemas";
import type { Timeline } from "@/lib/timeline/types";

const body = z.object({ json: z.any() });

/** Queue the Enhance analysis: a Claude job that runs worker/enhance.py and reviews the before/after sheets. */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Missing timeline");
  assertTimeline(parsed.data.json);
  const { dir, clips } = writeSpec(id, parsed.data.json as Timeline);
  if (!clips.length) throw new HttpError(400, "No video or image clips with local files to enhance");
  const job = await createJob({
    userId,
    projectId: id,
    kind: "enhance",
    title: `Enhance: analyse ${clips.length} clip${clips.length > 1 ? "s" : ""}`,
    prompt: enhancePrompt(path.resolve(dir, "..", "..")),
    outputFile: "enhance.json",
    schema: "enhance",
    freshOutput: true,
    timeoutSec: 60 * 60,
  });
  return { job: jobDTO(job) };
});

type Analysis = {
  clips: {
    id: string;
    flags: string[];
    metrics: Record<string, unknown> | null;
    check: (Record<string, unknown> & { ok: boolean; failures: string[]; adjusted: string[] }) | null;
    upscaleCandidate?: boolean;
  }[];
};

/** The latest finished Enhance result (or ?jobId=): Claude's settings + review, with the tool's metrics and checks. */
export const GET = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const jobId = new URL(req.url).searchParams.get("jobId");
  const job = await prisma.agentJob.findFirst({
    where: { projectId: id, userId, kind: "enhance", ...(jobId ? { id: jobId } : { status: "done" }) },
    orderBy: { createdAt: "desc" },
  });
  if (!job) return { result: null };
  if (job.status !== "done") throw new HttpError(409, job.error ?? `The job is ${job.status}`);
  const res = enhanceResultSchema.safeParse(readResult<EnhanceResult>(id, "enhance.json"));
  if (!res.success) throw new HttpError(500, "enhance.json is missing or invalid");
  const analysis = readResult<Analysis>(id, "edit/enhance/analysis.json");
  const byId = new Map((analysis?.clips ?? []).map((c) => [c.id, c]));
  return {
    result: {
      jobId: job.id,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      summary: res.data.summary,
      clips: res.data.clips.map((c) => {
        const a = byId.get(c.clipId);
        return { ...c, flags: a?.flags ?? [], metrics: a?.metrics ?? null, check: a?.check ?? null, upscaleCandidate: Boolean(a?.upscaleCandidate) };
      }),
    },
  };
});
