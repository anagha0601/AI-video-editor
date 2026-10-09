"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Loader2, Scissors, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useAgentJob, type AgentJobDTO } from "@/lib/client/agent";
import { uploadAsset, type AssetDTO } from "@/lib/client/upload";
import { backgroundTrack, matteCovers, matteWindows, setBackground } from "@/lib/timeline/matte";
import type { Timeline, VisualClip } from "@/lib/timeline/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditor } from "../store";
import { Section, SliderField, useTimelineEdit } from "./fields";

/** Video clips that can be cut out: every video clip except the background itself. */
const personClips = (tl: Timeline) =>
  tl.tracks.flatMap((t) => (t.kind === "video" && t.name !== "Background" ? t.clips.filter((c) => c.type === "video" && c.src) : []));

const mapClips = (tl: Timeline, fn: (c: VisualClip) => VisualClip | null) => ({
  ...tl,
  tracks: tl.tracks.map((t) => (t.kind === "video" ? { ...t, clips: t.clips.map((c) => fn(c) ?? c) } : t)),
}) as Timeline;

export function BackgroundPanel() {
  const timeline = useEditor((s) => s.timeline);
  const projectId = useEditor((s) => s.projectId);
  const assets = useEditor((s) => s.assets);
  const images = useMemo(() => (Object.values(assets) as AssetDTO[]).filter((a) => a.type === "image").sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [assets]);
  const bg = backgroundTrack(timeline)?.clips[0] ?? null;
  const clips = useMemo(() => personClips(timeline), [timeline]);
  const sources = useMemo(() => {
    const by = new Map<string, { src: string; name: string; clips: VisualClip[] }>();
    for (const c of clips) {
      const s = by.get(c.src!) ?? { src: c.src!, name: c.name, clips: [] };
      s.clips.push(c);
      by.set(c.src!, s);
    }
    return [...by.values()];
  }, [clips]);
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = every source
  const chosen = sources.filter((s) => !picked || picked.has(s.src));
  const [estimate, setEstimate] = useState<{ key: string; seconds: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingJobs = [...new Set(clips.map((c) => c.matte?.jobId).filter((x): x is string => !!x))];
  const key = chosen.map((s) => s.src).join("|") + JSON.stringify(matteWindows(chosen.flatMap((s) => s.clips)));

  const applyImage = (a: AssetDTO) => {
    const s = useEditor.getState();
    s.commit(setBackground(structuredClone(s.timeline), a), "Background image");
    if (!clips.some((c) => c.matte?.on || c.matte?.jobId)) toast.info("Background added below your video. Now cut out the person so it shows through.");
  };

  const upload = async (f: File) => {
    setBusy("upload");
    try {
      const a = await uploadAsset(f, "auto");
      if (a.type !== "image") throw new Error("Pick an image (JPG, PNG, WebP)");
      const s = useEditor.getState();
      s.setAssets([...(Object.values(s.assets) as AssetDTO[]), a]);
      applyImage(a);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const windowsFor = () => matteWindows(chosen.flatMap((s) => s.clips));

  const estimateTime = async () => {
    setBusy("estimate");
    try {
      const r = await api<{ seconds: number }>(`/api/projects/${projectId}/matte`, { method: "POST", json: { windows: windowsFor(), run: false } });
      setEstimate({ key, seconds: r.seconds });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cutOut = async () => {
    setBusy("run");
    try {
      const r = await api<{ queued: { src: string; job: AgentJobDTO; url: string; srcIn: number; srcLen: number }[] }>(`/api/projects/${projectId}/matte`, {
        method: "POST",
        json: { windows: windowsFor(), run: true },
      });
      const by = new Map(r.queued.map((q) => [q.src, q]));
      const s = useEditor.getState();
      s.commit(
        mapClips(s.timeline, (c) => {
          const q = c.src ? by.get(c.src) : undefined;
          return q && c.type === "video" ? { ...c, matte: { on: false, url: q.url, srcIn: q.srcIn, srcLen: q.srcLen, fps: 0, jobId: q.job.id } } : null;
        }),
        "Cut out the person",
      );
      toast.success(`Cutting out the person in ${r.queued.length} clip source${r.queued.length > 1 ? "s" : ""}`, { description: "Runs on the agent runner. The cut-out switches on by itself when it's done." });
      setEstimate(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setOn = (src: string, on: boolean) => {
    const s = useEditor.getState();
    s.commit(mapClips(s.timeline, (c) => (c.src === src && c.matte && !c.matte.jobId ? { ...c, matte: { ...c.matte, on } } : null)), on ? "Cut-out on" : "Cut-out off");
  };

  const removeBg = () => {
    const s = useEditor.getState();
    s.commit({ ...s.timeline, tracks: s.timeline.tracks.filter((t) => !(t.kind === "video" && t.name === "Background")) }, "Remove background");
  };

  const dim = useTimelineEdit();
  const setDim = (v: number) =>
    dim.live((tl) => ({ ...tl, tracks: tl.tracks.map((t) => (t.kind === "video" && t.name === "Background" ? { ...t, clips: t.clips.map((c) => ({ ...c, filters: { ...c.filters, brightness: v } })) } : t)) }) as Timeline);

  return (
    <div>
      {pendingJobs.map((id) => (
        <MatteWatcher key={id} jobId={id} />
      ))}
      <Section title="Background image">
        <p className="text-xs text-muted-foreground">Put your own image behind you. Your video is cut out on the CPU (no paid API) and the image shows where your old background was. B-roll stays full frame.</p>
        {bg ? (
          <div className="flex items-center gap-2 rounded-md border p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bg.thumb ?? bg.src ?? ""} alt="" className="h-14 w-8 rounded object-cover" />
            <span className="min-w-0 flex-1 truncate text-xs">{bg.name.replace(/^Background · /, "")}</span>
            <Button size="icon" variant="ghost" className="size-7" onClick={removeBg} title="Remove the background">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
        {bg && <SliderField label="Brightness" value={bg.filters.brightness} min={0.4} max={1.3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onLive={setDim} onDone={() => dim.done("Background brightness")} />}
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-[9/16] flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[10px] text-muted-foreground hover:bg-muted"
            disabled={busy === "upload"}
          >
            {busy === "upload" ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            Upload
          </button>
          {images.slice(0, 23).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => applyImage(a)}
              title={a.name}
              className={cn("aspect-[9/16] overflow-hidden rounded-md border hover:ring-2 hover:ring-primary", bg?.assetId === a.id && "ring-2 ring-primary")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.thumbUrl ?? a.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => (e.target.files?.[0] && upload(e.target.files[0]), (e.target.value = ""))} />
      </Section>

      <Section title="Cut out the person">
        {sources.length === 0 ? (
          <p className="text-xs text-muted-foreground">No video clips to cut out.</p>
        ) : (
          <div className="space-y-1">
            {sources.map((s) => {
              const m = s.clips.find((c) => c.matte)?.matte;
              const stale = s.clips.some((c) => c.matte && !c.matte.jobId && !matteCovers(c));
              const state = m?.jobId ? "running" : m?.on ? (stale ? "stale" : "on") : m ? "off" : "none";
              const checked = !picked || picked.has(s.src);
              return (
                <div key={s.src} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={`Cut out ${s.name}`}
                    onChange={(e) => {
                      const next = new Set(picked ?? sources.map((x) => x.src));
                      if (e.target.checked) next.add(s.src);
                      else next.delete(s.src);
                      setPicked(next);
                    }}
                  />
                  <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={s.name}>
                    {s.name}
                    <span className={cn("block text-[10px]", state === "stale" ? "text-amber-300" : "text-muted-foreground")}>
                      {s.clips.length} clip{s.clips.length > 1 ? "s" : ""} ·{" "}
                      {state === "running" ? "cutting out…" : state === "on" ? "cut out" : state === "stale" ? "trimmed past the cut-out: run again" : state === "off" ? "cut-out off" : "not cut out"}
                    </span>
                  </span>
                  {m && !m.jobId && (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setOn(s.src, !m.on)}>
                      {m.on ? "Off" : "On"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {chosen.length > 0 &&
          (estimate?.key === key ? (
            <Button className="w-full" onClick={cutOut} disabled={!!busy || pendingJobs.length > 0}>
              {busy === "run" ? <Loader2 className="animate-spin" /> : <Scissors />} Cut out ({fmt(estimate.seconds)})
            </Button>
          ) : (
            <Button className="w-full" variant="secondary" onClick={estimateTime} disabled={!!busy || pendingJobs.length > 0}>
              {busy === "estimate" ? <Loader2 className="animate-spin" /> : <Scissors />} {pendingJobs.length ? "Cutting out…" : `Estimate time for ${chosen.length} source${chosen.length > 1 ? "s" : ""}`}
            </Button>
          ))}
        <p className="text-[11px] text-muted-foreground">
          Best with you clearly in front of the camera. Hair and fast hands may show a soft edge. Stabilise is skipped on cut-out clips. Pick a background with similar light (direction and warmth) so it looks shot together.
        </p>
      </Section>
    </div>
  );
}

const fmt = (s: number) => (s < 90 ? `~${Math.max(5, Math.round(s / 5) * 5)} s` : `~${Math.round(s / 60)} min`);

/** Switches the cut-out on for every clip of a finished matte job (the server does the same on the next load). */
function MatteWatcher({ jobId }: { jobId: string }) {
  const live = useAgentJob(jobId);
  useEffect(() => {
    if (!live.finished || live.job?.id !== jobId) return;
    const s = useEditor.getState();
    const ok = live.job.status === "done";
    s.commit(mapClips(s.timeline, (c) => (c.matte?.jobId === jobId ? { ...c, matte: ok ? { ...c.matte, on: true, jobId: null } : null } : null)), ok ? "Cut-out ready" : "Cut-out failed");
    if (ok) toast.success("Cut-out ready: your background now shows through.");
    else toast.error(`Cutting out failed: ${live.job.error ?? live.job.status}`);
  }, [live.finished, live.job, jobId]);
  return null;
}
