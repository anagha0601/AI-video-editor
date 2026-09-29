"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { timelineDuration } from "@/lib/timeline/derive";
import { newAudioClip, newTextClip, newVisualClip, TEXT_PRESETS } from "@/lib/timeline/factory";
import { addClip } from "@/lib/timeline/ops";
import type { AnyClip, TrackKind } from "@/lib/timeline/types";
import { api } from "@/lib/client/api";
import type { AssetDTO } from "@/lib/client/upload";
import { useEditor } from "./store";

export const DRAG_MIME = "application/x-reelsmith";

export interface StockItemDTO {
  id: string;
  type: "video" | "image";
  url: string;
  thumb: string;
  width: number;
  height: number;
  duration: number | null;
  author: string;
  pageUrl: string;
}

export type DragPayload =
  | { kind: "asset"; asset: AssetDTO }
  | { kind: "stock"; item: StockItemDTO; query: string }
  | { kind: "text"; preset: keyof typeof TEXT_PRESETS };

export function dragProps(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "copy";
    },
  };
}

/** Register a Pexels result in the user's library (so renders/AI can reference it). */
export async function stockToAsset(item: StockItemDTO, query: string) {
  const { asset } = await api<{ asset: AssetDTO }>("/api/media", {
    method: "POST",
    json: {
      source: "pexels",
      type: item.type,
      url: item.url,
      thumbUrl: item.thumb,
      name: query || item.id,
      duration: item.duration,
      width: item.width,
      height: item.height,
      hasAudio: false,
      tags: query.split(/\s+/).filter(Boolean),
      meta: { author: item.author, pageUrl: item.pageUrl, pexelsId: item.id },
    },
  });
  return asset;
}

export function clipForAsset(a: AssetDTO, start: number): { clip: AnyClip; kind: TrackKind } {
  const tl = useEditor.getState().timeline;
  if (a.type === "video" || a.type === "image") {
    return {
      kind: "video",
      clip: newVisualClip({
        type: a.type,
        start,
        duration: a.type === "video" ? Math.min(a.duration ?? 5, 8) : 4,
        assetId: a.id,
        src: a.url,
        thumb: a.thumbUrl ?? (a.type === "image" ? a.url : null),
        name: a.name,
        srcDuration: a.duration,
        srcWidth: a.width,
        srcHeight: a.height,
        hasAudio: a.meta?.hasAudio ?? a.type === "video",
        muted: a.source === "pexels",
        keywords: a.tags,
      }),
    };
  }
  const isMusic = a.type === "music";
  const remaining = Math.max(5, timelineDuration(tl) - start);
  return {
    kind: isMusic ? "music" : "voice",
    clip: newAudioClip({
      src: a.url,
      assetId: a.id,
      name: a.name,
      start,
      duration: Math.min(a.duration ?? remaining, isMusic ? remaining : Infinity),
      srcDuration: a.duration,
      volume: isMusic ? 0.5 : 1,
      duck: isMusic,
      fadeOut: isMusic ? 1.5 : 0,
    }),
  };
}

export async function addPayload(p: DragPayload, trackId: string | null, time: number) {
  const s = useEditor.getState();
  let clip: AnyClip;
  let kind: TrackKind;
  if (p.kind === "text") {
    clip = newTextClip(p.preset, time, s.timeline.aspect);
    kind = "text";
  } else {
    const asset = p.kind === "asset" ? p.asset : await stockToAsset(p.item, p.query);
    ({ clip, kind } = clipForAsset(asset, time));
  }
  // Drop onto an incompatible lane -> first track of the right kind.
  const target = trackId ? s.timeline.tracks.find((t) => t.id === trackId) : null;
  const st = useEditor.getState();
  st.commit(addClip(st.timeline, target && target.kind === kind ? target.id : null, clip, kind), "Add clip");
  st.select([clip.id]);
}

export function useDropHandler() {
  return useCallback((p: DragPayload, trackId: string | null, time: number) => {
    addPayload(p, trackId, time).catch((err) => toast.error((err as Error).message));
  }, []);
}
