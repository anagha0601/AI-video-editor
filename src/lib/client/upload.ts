"use client";

import { api } from "./api";

export type UploadKind = "voice" | "video" | "image" | "music" | "audio" | "thumb";

/** Presign + direct PUT (R2 or the local dev route), with progress. Returns the public URL. */
export async function uploadFile(file: Blob, name: string, kind: UploadKind, onProgress?: (p: number) => void) {
  const contentType = file.type || "application/octet-stream";
  const { uploadUrl, url } = await api<{ uploadUrl: string; url: string; key: string }>("/api/uploads", {
    method: "POST",
    json: { name, contentType, kind },
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection (and R2 CORS if using R2)"));
    xhr.send(file);
  });
  onProgress?.(1);
  return url;
}

export interface MediaInfo {
  type: "video" | "image" | "audio";
  duration: number | null;
  width: number | null;
  height: number | null;
  thumb: Blob | null;
  hasAudio: boolean;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
}

function thumbFrom(source: CanvasImageSource, w: number, h: number) {
  const scale = Math.min(1, 480 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w * scale));
  c.height = Math.max(2, Math.round(h * scale));
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  return canvasToBlob(c);
}

/** Read duration/size and grab a thumbnail in the browser (no server-side probing needed). */
export async function inspectFile(file: File): Promise<MediaInfo> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { type: "image", duration: null, width: img.naturalWidth, height: img.naturalHeight, thumb: await thumbFrom(img, img.naturalWidth, img.naturalHeight), hasAudio: false };
    }
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      v.playsInline = true;
      v.src = url;
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error("This video format can't be read by your browser"));
      });
      const duration = Number.isFinite(v.duration) ? v.duration : null;
      v.currentTime = Math.min(1, (duration ?? 2) / 3);
      await new Promise((r) => (v.onseeked = r));
      const anyV = v as HTMLVideoElement & { mozHasAudio?: boolean; webkitAudioDecodedByteCount?: number; audioTracks?: { length: number } };
      const hasAudio = anyV.mozHasAudio ?? (anyV.audioTracks ? anyV.audioTracks.length > 0 : true);
      return { type: "video", duration, width: v.videoWidth, height: v.videoHeight, thumb: await thumbFrom(v, v.videoWidth, v.videoHeight), hasAudio };
    }
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.src = url;
    await new Promise<void>((res) => {
      a.onloadedmetadata = () => res();
      a.onerror = () => res();
    });
    return { type: "audio", duration: Number.isFinite(a.duration) ? a.duration : null, width: null, height: null, thumb: null, hasAudio: true };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface AssetDTO {
  id: string;
  type: "video" | "image" | "audio" | "music";
  source: string;
  url: string;
  thumbUrl: string | null;
  name: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  tags: string[];
  meta: { peaks?: number[]; peaksPerSec?: number; hasAudio?: boolean; author?: string } | null;
  createdAt: string;
}

/** Full library upload: inspect, upload file + thumbnail, register (server auto-tags). */
export async function uploadAsset(
  file: File,
  as: "auto" | "music",
  onProgress?: (p: number) => void,
  source: "upload" | "gemini_manual" = "upload",
): Promise<AssetDTO> {
  const info = await inspectFile(file);
  const type = as === "music" || (info.type === "audio" && as === "auto") ? "music" : info.type;
  const url = await uploadFile(file, file.name, type === "music" ? "music" : info.type, (p) => onProgress?.(p * 0.95));
  const thumbUrl = info.thumb ? await uploadFile(info.thumb, "thumb.jpg", "thumb") : null;
  const { asset } = await api<{ asset: AssetDTO }>("/api/media", {
    method: "POST",
    json: {
      source,
      type,
      url,
      thumbUrl,
      name: file.name,
      mime: file.type,
      duration: info.duration,
      width: info.width,
      height: info.height,
      hasAudio: info.hasAudio,
    },
  });
  onProgress?.(1);
  return asset;
}
