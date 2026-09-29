// Client-side helpers: downscale a photo to ~1280px JPEG, or read a clip's size,
// length and a poster frame, then upload it.
export type UploadedPhoto = { id: string; url: string; width: number; height: number; kind: "image" | "video"; duration: number };

export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const MEDIA_ACCEPT = `image/jpeg,image/png,image/webp,${VIDEO_TYPES.join(",")}`;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

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

async function send(form: FormData): Promise<UploadedPhoto> {
  const res = await fetch("/api/assets", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  return data;
}

// Loads the clip in a hidden <video>, then grabs a frame near the start as a JPEG.
async function probeVideo(file: File): Promise<{ poster: Blob; width: number; height: number; duration: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("unreadable"));
      video.src = url;
    });
    if (!Number.isFinite(video.duration)) {
      // Browser-recorded WebM often has no duration header; seeking far ahead makes the browser work it out.
      await new Promise<void>((resolve) => {
        video.ondurationchange = () => Number.isFinite(video.duration) && resolve();
        setTimeout(resolve, 3000);
        video.currentTime = 1e7;
      });
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 3000); // fall back to the first frame if seeking stalls
      video.currentTime = Math.max(0.05, Math.min(0.5, duration / 2));
    });
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!poster || !video.videoWidth) throw new Error("no frame");
    return { poster, width: video.videoWidth, height: video.videoHeight, duration };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function uploadVideo(file: File): Promise<UploadedPhoto> {
  if (!VIDEO_TYPES.includes(file.type)) throw new Error(`${file.name}: use an MP4, WebM or MOV video`);
  if (file.size > MAX_VIDEO_BYTES) throw new Error(`${file.name} is over 50 MB. Trim or compress it first.`);
  let meta;
  try {
    meta = await probeVideo(file);
  } catch {
    throw new Error(`Couldn't play ${file.name} in this browser. Try an H.264 MP4.`);
  }
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("poster", meta.poster, "poster.jpg");
  form.append("width", String(meta.width));
  form.append("height", String(meta.height));
  form.append("duration", String(meta.duration));
  return send(form);
}

// Photo or clip, whichever the file is.
export function uploadMedia(file: File): Promise<UploadedPhoto> {
  return file.type.startsWith("video/") ? uploadVideo(file) : uploadPhoto(file);
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
  return send(form);
}
