"use client";

import { useRef, useState } from "react";
import { MEDIA_ACCEPT, uploadMedia, type UploadedPhoto } from "@/lib/upload";
import { posterUrl } from "@/lib/types";

type Props = {
  photos: UploadedPhoto[];
  onChange: (photos: UploadedPhoto[]) => void;
  max: number;
};

// Upload + order the user's own photos and video clips for a new video.
export function PhotoPicker({ photos, onChange, max }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  async function addFiles(list: FileList | File[]) {
    setError("");
    const files = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const room = max - photos.length;
    if (!files.length) return setError("Those files aren't photos or videos.");
    if (room <= 0) return setError(`You can add up to ${max} photos or clips.`);
    const batch = files.slice(0, room);
    if (files.length > room) setError(`Only the first ${room} were added (max ${max}).`);
    setUploading(batch.length);
    let next = [...photos];
    for (const file of batch) {
      try {
        next = [...next, await uploadMedia(file)];
        onChange(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      }
      setUploading((n) => n - 1);
    }
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= photos.length) return;
    const next = [...photos];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
      }}
      className={`rounded-xl border border-dashed p-3 transition ${dragOver ? "border-brand-500 bg-brand-500/10" : "border-white/15"}`}
    >
      <input
        ref={input}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {photos.length === 0 && !uploading ? (
        <button onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 py-5 text-center">
          <span className="text-2xl">🖼️</span>
          <span className="text-sm font-medium text-zinc-200">Add your own photos or video clips (optional)</span>
          <span className="text-xs text-zinc-500">
            Drop files here or click to browse · up to {max} · clips up to 50 MB · the AI writes the video around them
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {photos.map((p, i) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={posterUrl(p.id)} alt={`${p.kind === "video" ? "Clip" : "Photo"} ${i + 1}`} className="h-full w-full object-cover" />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[10px] font-bold">{i + 1}</span>
              {p.kind === "video" && (
                <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 text-[10px] font-semibold tabular-nums">
                  ▶ {p.duration.toFixed(0)}s
                </span>
              )}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/70 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="px-2 py-1 text-xs disabled:opacity-30" aria-label="Move earlier">
                  ←
                </button>
                <button
                  onClick={() => onChange(photos.filter((x) => x.id !== p.id))}
                  className="px-2 py-1 text-xs text-red-300"
                  aria-label="Remove"
                >
                  ✕
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === photos.length - 1}
                  className="px-2 py-1 text-xs disabled:opacity-30"
                  aria-label="Move later"
                >
                  →
                </button>
              </div>
            </div>
          ))}
          {Array.from({ length: uploading }).map((_, i) => (
            <div key={`u${i}`} className="grid aspect-square place-items-center rounded-lg bg-zinc-800">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            </div>
          ))}
          {photos.length + uploading < max && (
            <button
              onClick={() => input.current?.click()}
              className="grid aspect-square place-items-center rounded-lg border border-white/10 text-2xl text-zinc-500 hover:border-brand-500 hover:text-white"
              aria-label="Add more"
            >
              +
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
