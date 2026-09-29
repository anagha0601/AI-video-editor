import { lookup } from "node:dns/promises";
import net from "node:net";
import { nanoid } from "nanoid";
import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError, requireUserId, route } from "@/server/http";
import { putObject } from "@/server/storage";

export const maxDuration = 30;

// Images dragged in from another browser tab (e.g. the Gemini app) arrive as URLs the
// browser can't fetch cross-origin, so the server downloads them. Guarded against
// SSRF: http(s) only, public addresses only (checked on every redirect), image/* only,
// 20 MB cap.

const MAX_BYTES = 20 * 1024 * 1024;

function isPrivate(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "Only http(s) image links can be imported");
  const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new HttpError(400, "That address can't be imported");
}

async function download(raw: string) {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "Mozilla/5.0 ReelSmith-import" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    if (!res.ok) throw new HttpError(400, `Couldn't download the image (${res.status})`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!type.startsWith("image/")) throw new HttpError(400, "That link isn't an image");
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new HttpError(413, "Image is too large (20 MB max)");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new HttpError(413, "Image is too large (20 MB max)");
    return { buf, type };
  }
  throw new HttpError(400, "Too many redirects");
}

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
