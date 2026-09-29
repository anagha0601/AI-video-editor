"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { clipEnd, findClip } from "@/lib/timeline/derive";
import { scenePrompt } from "@/lib/timeline/prompts";
import type { VideoTrack, VisualClip } from "@/lib/timeline/types";
import { api } from "@/lib/client/api";
import { uploadAsset, type AssetDTO } from "@/lib/client/upload";
import { useEditor } from "./store";
import { addPayload, replaceClipMedia } from "./dnd";

// Gemini quick-import: use a personal Gemini account in another window (no API),
// then paste (Ctrl+V) or drag the image back onto a scene.

export function openGemini() {
  const w = Math.round(window.screen.availWidth * 0.4);
  const h = window.screen.availHeight;
  const left = window.screen.availWidth - w;
  const win = window.open("https://gemini.google.com/app", "reelsmith-gemini", `popup=yes,width=${w},height=${h},left=${left},top=0`);
  if (!win) toast.error("Your browser blocked the popup — allow popups for this site.");
  else toast.info("Gemini opened beside the editor. Copy a scene prompt, generate, then paste the image here with Ctrl+V.");
}

export async function copyScenePrompt(clip: VisualClip) {
  const text = scenePrompt(useEditor.getState().timeline, clip);
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Prompt for ${sceneLabel(clip)} copied`, { description: text.length > 140 ? text.slice(0, 140) + "…" : text });
  } catch {
    window.prompt("Copy this prompt:", text);
  }
}

export function sceneLabel(clip: VisualClip) {
  if (clip.scene) return `scene ${clip.scene}`;
  const tl = useEditor.getState().timeline;
  for (const t of tl.tracks) {
    if (t.kind !== "video") continue;
    const i = t.clips.findIndex((c) => c.id === clip.id);
    if (i >= 0) return `scene ${i + 1}`;
  }
  return "the scene";
}

/** The scene an image should land on: the selected visual clip, else the one under the playhead (main track first). */
export function targetScene(): VisualClip | null {
  const s = useEditor.getState();
  for (const id of s.selection) {
    const c = findClip(s.timeline, id)?.clip;
    if (c && (c.type === "video" || c.type === "image" || c.type === "color")) return c;
  }
  const videoTracks = s.timeline.tracks.filter((t): t is VideoTrack => t.kind === "video" && !t.hidden);
  for (const t of [...videoTracks].reverse()) {
    const c = t.clips.find((c) => s.playhead >= c.start && s.playhead < clipEnd(c));
    if (c) return c;
  }
  return null;
}

/** Put an image on a scene (replacing its visual; images keep/get Ken Burns) or, with no scene, at the playhead. */
export async function placeImage(asset: AssetDTO, clipId?: string | null) {
  const s = useEditor.getState();
  const clip = clipId ? (findClip(s.timeline, clipId)?.clip as VisualClip | undefined) : targetScene();
  if (clip) {
    if (replaceClipMedia(clip.id, asset)) {
      s.select([clip.id]);
      toast.success(`Image added to ${sceneLabel(clip)}`);
    }
    return;
  }
  await addPayload({ kind: "asset", asset }, null, s.playhead);
  toast.success(`Image added at ${s.playhead.toFixed(1)}s`);
}

function dataUrlToFile(url: string) {
  const [head, b64] = url.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], `gemini.${mime.split("/")[1] ?? "png"}`, { type: mime });
}

/** Images carried by a drop: real files, or image URLs from a web page (uri-list / <img src> in HTML). */
export function droppedImages(dt: DataTransfer) {
  const files = [...dt.files].filter((f) => f.type.startsWith("image/"));
  const fromBrowser = dt.types.includes("text/uri-list") || dt.types.includes("text/html");
  if (files.length) return { files, urls: [] as string[], fromBrowser };
  const urls: string[] = [];
  const html = dt.getData("text/html");
  const m = html && /<img[^>]+src=["']([^"']+)["']/i.exec(html);
  if (m) urls.push(m[1].replace(/&amp;/g, "&"));
  for (const line of dt.getData("text/uri-list").split(/\r?\n/)) if (line && !line.startsWith("#") && !urls.includes(line)) urls.push(line.trim());
  const dataFiles = urls.filter((u) => u.startsWith("data:image/")).map(dataUrlToFile);
  return { files: dataFiles, urls: urls.filter((u) => /^https?:\/\//.test(u)).slice(0, 1), fromBrowser };
}

export const hasDroppableImage = (dt: DataTransfer) =>
  dt.types.includes("Files") || dt.types.includes("text/uri-list") || dt.types.includes("text/html");

/** Upload/import the first dropped image and return it as a library asset. */
export async function importDropped(dt: DataTransfer): Promise<AssetDTO | null> {
  const { files, urls, fromBrowser } = droppedImages(dt);
  const source = fromBrowser ? "gemini_manual" : "upload";
  if (files.length) return uploadAsset(files[0], "auto", undefined, source);
  if (urls.length) return (await api<{ asset: AssetDTO }>("/api/media/import", { method: "POST", json: { url: urls[0], source: "gemini_manual" } })).asset;
  return null;
}

function remember(asset: AssetDTO) {
  const s = useEditor.getState();
  s.setAssets([asset, ...Object.values(s.assets)]);
}

/** Drop an image onto a specific scene (clip) or, with clipId null, the scene at the playhead. */
export async function dropImageOnScene(dt: DataTransfer, clipId: string | null) {
  const id = toast.loading("Adding image…");
  try {
    const asset = await importDropped(dt);
    if (!asset) return toast.error("No image found in what you dropped", { id });
    remember(asset);
    toast.dismiss(id);
    await placeImage(asset, clipId);
  } catch (e) {
    toast.error((e as Error).message, { id });
  }
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "range", "button"].includes((el as HTMLInputElement).type)));

/** Ctrl+V anywhere in the editor: an image on the clipboard goes onto the selected scene. */
export function usePasteImages() {
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const items = [...(e.clipboardData?.items ?? [])];
      const item = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return; // plain text pastes behave normally
      if (isTyping(e.target) && !items.every((i) => i.kind === "file")) return;
      e.preventDefault();
      const target = targetScene();
      const id = toast.loading("Adding pasted image…");
      try {
        const named = new File([file], file.name && file.name !== "image.png" ? file.name : `gemini-${Date.now()}.${file.type.split("/")[1] ?? "png"}`, { type: file.type });
        const asset = await uploadAsset(named, "auto", undefined, "gemini_manual");
        remember(asset);
        toast.dismiss(id);
        await placeImage(asset, target?.id ?? null);
      } catch (err) {
        toast.error((err as Error).message, { id });
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
}

/** Drop onto an empty spot of a lane: desktop files keep their normal upload path; browser images are imported. */
export async function dropImageAt(dt: DataTransfer, trackId: string, time: number) {
  const id = toast.loading("Adding image…");
  try {
    const asset = await importDropped(dt);
    if (!asset) return toast.error("No image found in what you dropped", { id });
    remember(asset);
    await addPayload({ kind: "asset", asset }, trackId, time);
    toast.success(`Image added at ${time.toFixed(1)}s`, { id });
  } catch (e) {
    toast.error((e as Error).message, { id });
  }
}
