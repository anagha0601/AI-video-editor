import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withUser } from "@/lib/api";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

// Upload one photo (the browser resizes it first) or one video clip.
// Multipart: file, width, height; clips also send duration + a JPEG poster frame.
export async function POST(req: Request) {
  return withUser(async (user) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return jsonError("No file uploaded");

    const isVideo = VIDEO_TYPES.includes(file.type);
    if (!isVideo && !IMAGE_TYPES.includes(file.type)) {
      return jsonError("Only JPEG, PNG, WebP images or MP4, WebM, MOV videos are supported");
    }
    if (isVideo && file.size > MAX_VIDEO_BYTES) return jsonError("Video is too large (max 50 MB)");
    if (!isVideo && file.size > MAX_IMAGE_BYTES) return jsonError("Image is too large (max 4 MB after resizing)");

    const poster = form!.get("poster");
    if (isVideo && !(poster instanceof File && poster.type === "image/jpeg" && poster.size <= MAX_IMAGE_BYTES)) {
      return jsonError("Missing preview frame for the video");
    }

    const width = Number(form!.get("width")) || 0;
    const height = Number(form!.get("height")) || 0;
    const duration = isVideo ? Math.max(0, Number(form!.get("duration")) || 0) : 0;
    const asset = await db.asset.create({
      data: {
        userId: user.id,
        kind: isVideo ? "video" : "image",
        mime: file.type,
        width,
        height,
        duration,
        data: Buffer.from(await file.arrayBuffer()),
        poster: isVideo ? Buffer.from(await (poster as File).arrayBuffer()) : null,
      },
      select: { id: true, kind: true, width: true, height: true, duration: true },
    });
    return NextResponse.json({ ...asset, url: `/api/assets/${asset.id}` }, { status: 201 });
  });
}
