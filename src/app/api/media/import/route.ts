import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError, requireUserId, route } from "@/server/http";
import { safeDownload } from "@/server/safefetch";
import { putObject } from "@/server/storage";

export const maxDuration = 30;

// Images dragged in from another browser tab (e.g. the Gemini app) arrive as URLs the
// browser can't fetch cross-origin, so the server downloads them. Guarded against
// SSRF: http(s) only, public addresses only (checked on every redirect), image/* only,
// 20 MB cap.

const MAX_BYTES = 20 * 1024 * 1024;

const download = (raw: string) => safeDownload(raw, { maxBytes: MAX_BYTES, what: "image", accept: (type) => type.startsWith("image/") });

const body = z.object({
  url: z.string().url().max(4000),
  source: z.enum(["gemini_manual", "upload"]).default("gemini_manual"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const POST = route(async (req: Request) => {
  const userId = await requireUserId();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, "Invalid image link");
  const { buf, type } = await download(parsed.data.url);
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("gif") ? "gif" : "jpg";
  const key = `u/${userId}/image/${nanoid(12)}-imported.${ext}`;
  const url = await putObject(key, buf, type);
  const asset = await prisma.mediaAsset.create({
    data: {
      userId,
      type: "image",
      source: parsed.data.source,
      key,
      url,
      thumbUrl: url,
      name: parsed.data.source === "gemini_manual" ? "Gemini image" : "Imported image",
      mime: type,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      tags: parsed.data.source === "gemini_manual" ? ["gemini"] : [],
      meta: { importedFrom: new URL(parsed.data.url).hostname, hasAudio: false },
    },
  });
  return { asset };
});
