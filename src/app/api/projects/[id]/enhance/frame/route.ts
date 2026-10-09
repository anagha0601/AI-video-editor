import { readFile } from "node:fs/promises";
import { localMediaPath } from "@/server/agent";
import { previewFrame } from "@/server/enhance";
import { HttpError, ownedProject, requireUserId, route, type Ctx } from "@/server/http";
import { keyFromUrl } from "@/server/storage";
import { enhanceSettingsSchema } from "@/agent/schemas";

export const dynamic = "force-dynamic";

/**
 * Before/after preview frame for the Enhance panel (JPEG, cached per settings):
 * ?src=&in=&len=&t=&w=[&image=1] plus s=<base64url settings JSON> for "after" (omit it for "before").
 */
export const GET = route(async (req: Request, ctx: Ctx<{ id: string }>) => {
  const userId = await requireUserId();
  const { id } = await ctx.params;
  await ownedProject(id, userId);
  const q = new URL(req.url).searchParams;
  const src = q.get("src") ?? "";
  const key = keyFromUrl(src);
  if (key && !key.startsWith(`u/${userId}/`)) throw new HttpError(403, "Not your file");
  const file = localMediaPath(src);
  if (!file) throw new HttpError(404, "Only local media can be previewed");
  let settings: object | null = null;
  const s = q.get("s");
  if (s) {
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    } catch {
      throw new HttpError(400, "Invalid settings");
    }
    const parsed = enhanceSettingsSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "Invalid settings");
    settings = parsed.data;
  }
  const num = (k: string, d: number) => {
    const v = q.get(k);
    return v !== null && Number.isFinite(Number(v)) ? Number(v) : d;
  };
  const jpg = await previewFrame({
    projectId: id,
    src: file,
    isImage: q.get("image") === "1",
    tIn: Math.max(0, num("in", 0)),
    tLen: Math.max(0.2, num("len", 3)),
    t: Math.max(0, num("t", 0)),
    width: Math.min(2160, Math.max(240, Math.round(num("w", 1080)))),
    settings,
  });
  return new Response(new Uint8Array(await readFile(jpg)), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
});
