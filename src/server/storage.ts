import "server-only";
import crypto from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 (S3 API) when R2_* vars are set, otherwise a local folder served by
// /api/files/[...key]. worker/storage.py mirrors the URL scheme.

export type Driver = "local" | "r2";

export function driver(): Driver {
  const explicit = process.env.STORAGE_DRIVER as Driver | undefined;
  if (explicit) return explicit;
  return process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID ? "r2" : "local";
}

export function storageDir() {
  return path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));
}

let s3: S3Client | null = null;
function client() {
  if (!s3) {
    s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
    });
  }
  return s3;
}

export function publicUrl(key: string) {
  if (driver() === "local") return `/api/files/${key}`;
  return `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
}

export function keyFromUrl(url: string): string | null {
  if (url.startsWith("/api/files/")) return decodeURIComponent(url.slice("/api/files/".length));
  const base = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
  if (base && url.startsWith(base + "/")) return decodeURIComponent(url.slice(base.length + 1));
  return null;
}

function sign(payload: string) {
  return crypto.createHmac("sha256", process.env.AUTH_SECRET || "dev").update(payload).digest("base64url");
}

export function verifyLocalUpload(key: string, exp: string, sig: string) {
  if (Number(exp) < Date.now() / 1000) return false;
  const want = sign(`${key}:${exp}`);
  return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}

/** A URL the browser PUTs the file to directly (R2 presigned, or our local upload route). */
export async function presignUpload(key: string, contentType: string) {
  if (driver() === "local") {
    const exp = String(Math.floor(Date.now() / 1000) + 3600);
    return { uploadUrl: `/api/files/${key}?exp=${exp}&sig=${sign(`${key}:${exp}`)}`, url: publicUrl(key), key };
  }
  const uploadUrl = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, ContentType: contentType }),
    { expiresIn: 3600 },
  );
  return { uploadUrl, url: publicUrl(key), key };
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  if (driver() === "local") {
    const p = localPath(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  } else {
    await client().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, Body: body, ContentType: contentType }));
  }
  return publicUrl(key);
}

export async function deleteObject(key: string) {
  try {
    if (driver() === "local") await fs.unlink(localPath(key));
    else await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
  } catch {
    // already gone
  }
}

export function localPath(key: string) {
  const root = storageDir();
  const p = path.resolve(root, key);
  if (!p.startsWith(root + path.sep)) throw new Error("bad key");
  return p;
}

export function safeName(name: string) {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 6);
  const base = path.basename(name, path.extname(name)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `${base || "file"}${ext}`;
}
