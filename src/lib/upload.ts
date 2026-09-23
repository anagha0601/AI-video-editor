// Client-side helper: downscale a photo to ~1280px JPEG, then upload it.
export type UploadedPhoto = { id: string; url: string; width: number; height: number };

const MAX_SIDE = 1280;

async function resize(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't process that image");
  return { blob, width, height };
}

export async function uploadPhoto(file: File): Promise<UploadedPhoto> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} isn't an image`);
  let resized;
  try {
    resized = await resize(file);
  } catch {
    throw new Error(`Couldn't read ${file.name}. Try a JPEG or PNG.`);
  }
  const form = new FormData();
  form.append("file", resized.blob, "photo.jpg");
  form.append("width", String(resized.width));
  form.append("height", String(resized.height));
  const res = await fetch("/api/assets", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  return data;
}
