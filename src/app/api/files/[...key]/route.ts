import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { driver, localPath, verifyLocalUpload } from "@/server/storage";

// Local storage driver only (development / docker-compose). With R2 the browser
// talks to the bucket directly and this route is unused.

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

type Ctx = { params: Promise<{ key: string[] }> };

async function resolve(ctx: Ctx) {
  if (driver() !== "local") return null;
  const { key } = await ctx.params;
  const k = key.map(decodeURIComponent).join("/");
  try {
    return { key: k, file: localPath(k) };
  } catch {
    return null;
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if (!r) return new NextResponse("Not found", { status: 404 });
  let stat;
  try {
    stat = await fs.stat(r.file);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const type = TYPES[path.extname(r.file).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  // Range support so <video> can seek.
  const range = req.headers.get("range");
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    const stream = Readable.toWeb(createReadStream(r.file, { start, end })) as ReadableStream;
    return new NextResponse(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(r.file)) as ReadableStream;
  return new NextResponse(stream, { headers: { ...headers, "Content-Length": String(stat.size) } });
}

export async function PUT(req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if (!r) return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  if (!verifyLocalUpload(r.key, url.searchParams.get("exp") ?? "", url.searchParams.get("sig") ?? "")) {
    return new NextResponse("Bad signature", { status: 403 });
  }
  await fs.mkdir(path.dirname(r.file), { recursive: true });
  const buf = Buffer.from(await req.arrayBuffer());
  await fs.writeFile(r.file, buf);
  return NextResponse.json({ ok: true, size: buf.length });
}
