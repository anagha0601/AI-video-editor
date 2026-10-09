import crypto from "node:crypto";
import { z } from "zod";
import { createJob, jobDTO, localMediaPath } from "@/server/agent";
import { runEnhanceTool } from "@/server/enhance";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { driver, keyFromUrl, localPath, publicUrl } from "@/server/storage";
import { enhanceScript, pythonBin } from "@/agent/config";

const body = z.object({
  src: z.string().min(1),
  in: z.number().min(0),
  len: z.number().positive().max(600),
  width: z.number().int().min(720).max(2160).default(1080),
  run: z.boolean().default(false), // false = estimate only
});

/**
 * AI upscale (Real-ESRGAN via ncnn, on the CPU) of one clip's source window, for sources below 1080 wide.
 * {run:false} -> time estimate (benchmarks part of one frame). {run:true} -> a local command job on the agent
 * runner; when it is done the client sets clip.enhance.upscale = {on, url, srcIn, srcLen, width, height}.
 */
export const POST = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Invalid upscale request");
  const d = parsed.data;
  const key = keyFromUrl(d.src);
  if (key && !key.startsWith(`u/${userId}/`)) throw new HttpError(403, "Not your file");
  const file = localMediaPath(d.src);
  if (!file) throw new HttpError(404, "Only local media can be upscaled");
  if (driver() !== "local") throw new HttpError(400, "Upscaling needs local storage");
  const common = ["--src", file, "--in", String(d.in), "--len", String(d.len), "--width", String(d.width)];

  if (!d.run) {
    const out = await runEnhanceTool(["upscale-estimate", ...common], 15 * 60_000);
    return { estimate: JSON.parse(out.trim().split(/\r?\n/).pop()!) };
  }
  const outKey = `u/${userId}/enhance/${id}/${crypto.randomBytes(6).toString("hex")}-esrgan.mp4`;
  const job = await createJob({
    userId,
    projectId: id,
    kind: "upscale",
    title: `AI upscale: ${d.len.toFixed(1)}s to ${d.width}px wide`,
    prompt: "(local command)",
    exec: [pythonBin(), enhanceScript(), "upscale", ...common, "--out", localPath(outKey)],
    timeoutSec: 12 * 60 * 60,
  });
  return { job: jobDTO(job), url: publicUrl(outKey), srcIn: d.in, srcLen: d.len };
});
