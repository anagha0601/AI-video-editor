import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withUser } from "@/lib/api";

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

// Upload one photo (the browser resizes it first). Multipart: file, width, height.
export async function POST(req: Request) {
  return withUser(async (user) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return jsonError("No file uploaded");
    if (!TYPES.includes(file.type)) return jsonError("Only JPEG, PNG or WebP images are supported");
    if (file.size > MAX_BYTES) return jsonError("Image is too large (max 4 MB after resizing)");

    const width = Number(form!.get("width")) || 0;
    const height = Number(form!.get("height")) || 0;
    const asset = await db.asset.create({
      data: { userId: user.id, mime: file.type, width, height, data: Buffer.from(await file.arrayBuffer()) },
      select: { id: true, width: true, height: true },
    });
    return NextResponse.json({ ...asset, url: `/api/assets/${asset.id}` }, { status: 201 });
  });
}
