"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Expand, Loader2, ScanSearch, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useAgentJob, type AgentJobDTO } from "@/lib/client/agent";
import { findClip } from "@/lib/timeline/derive";
import { updateClip } from "@/lib/timeline/ops";
import type { Enhance, EnhanceFix, Timeline, VisualClip } from "@/lib/timeline/types";
import { AgentLog } from "@/components/agent/AgentLog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useEditor } from "../store";
import { Section, SliderField, useClipEdit } from "./fields";

type Settings = Omit<Enhance, "upscale">;
interface ClipResult {
  clipId: string;
  settings: Settings;
  review: { ok: boolean; notes: string };
  flags: string[];
  metrics: { srcWidth?: number; jitter?: number; noise?: number; acutance?: number } | null;
  check: (Record<string, unknown> & { ok: boolean; failures: string[]; adjusted: string[] }) | null;
  upscaleCandidate: boolean;
}
interface EnhanceResult {
  jobId: string;
  finishedAt: string | null;
  summary: string;
  clips: ClipResult[];
}
interface Estimate {
  frames: number;
  secondsPerFrame: number;
  estimateSeconds: number;
  srcWidth: number;
  outWidth: number;
  outHeight: number;
}

const FIXES: { key: Exclude<EnhanceFix, "upscale">; label: string; hint: string }[] = [
  { key: "stabilize", label: "Stabilise", hint: "vidstab, two-pass, minimal crop" },
  { key: "denoise", label: "Denoise", hint: "only noisy clips; hqdn3d or nlmeans in low light" },
  { key: "sharpen", label: "Sharpen", hint: "light unsharp after scaling" },
  { key: "color", label: "Exposure & white balance", hint: "levels, exposure, neutral balance" },
  { key: "match", label: "Match clips", hint: "same brightness and colour as the other clips" },
];

const dur = (s: number) => (s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
const b64url = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function frameUrl(projectId: string, clip: VisualClip, settings: Settings | null, width: number) {
  const image = clip.type === "image";
  const len = image ? 0.2 : clip.duration * clip.speed;
  const up = clip.enhance?.upscale;
  const useUp = settings && up?.on && up.url && !image;
  const src = useUp ? up!.url : clip.src!;
  const tIn = useUp ? Math.max(0, clip.in - up!.srcIn) : image ? 0 : clip.in;
  const q = new URLSearchParams({ src, in: String(tIn), len: String(len), t: String(tIn + len / 2), w: String(width) });
  if (image) q.set("image", "1");
  if (settings) q.set("s", b64url(settings));
  return `/api/projects/${projectId}/enhance/frame?${q}`;
}

/** Two aligned frames with a draggable split: left of the line = before, right = after. */
function BeforeAfter({ before, after, className, onExpand }: { before: string; after: string; className?: string; onExpand?: () => void }) {
  const [split, setSplit] = useState(50);
  const [loaded, setLoaded] = useState({ before: "", after: "" });
  const box = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };
  const loading = loaded.before !== before || loaded.after !== after;
  return (
    <div
      ref={box}
      className={cn("relative cursor-ew-resize touch-none overflow-hidden rounded-md bg-black select-none", className)}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag(e);
      }}
      onPointerMove={(e) => e.buttons && drag(e)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={before} alt="Before" className="block w-full" draggable={false} onLoad={() => setLoaded((l) => ({ ...l, before }))} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={after}
        alt="After"
        className="absolute inset-0 block w-full"
        style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        draggable={false}
        onLoad={() => setLoaded((l) => ({ ...l, after }))}
        onError={() => toast.error("Preview failed. Is Python with numpy installed (PYTHON_BIN)?")}
      />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${split}%` }} />
      <span className="pointer-events-none absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 text-[10px]">Before</span>
      <span className="pointer-events-none absolute top-1.5 right-1.5 rounded bg-black/60 px-1.5 text-[10px]">After</span>
      {loading && (
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 text-[10px]">
          <Loader2 className="size-3 animate-spin" /> rendering
        </span>
      )}
      {onExpand && (
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={onExpand} className="absolute bottom-1.5 left-1.5 rounded bg-black/60 p-1" aria-label="Enlarge">
          <Expand className="size-3" />
        </button>
      )}
    </div>
  );
}

function fixSummary(key: string, s: Record<string, unknown> | null | undefined) {
  if (!s) return "";
  switch (key) {
    case "stabilize":
      return `smoothing ${s.smoothing}, max crop ≈${Math.round((2 * Number(s.maxShift) + (16 / 9) * Math.sin(Number(s.maxAngle))) * 100)}%`;
    case "denoise":
      return `${s.method} ${Math.round(Number(s.strength) * 100)}%`;
    case "sharpen":
      return `amount ${Number(s.amount).toFixed(2)}`;
    case "color": {
      const g = s.gains as number[];
      return `levels ${Number(s.lo).toFixed(2)}–${Number(s.hi).toFixed(2)}, γ ${Number(s.gamma).toFixed(2)}, R ${g[0].toFixed(2)} B ${g[2].toFixed(2)}`;
    }
    case "match": {
      const g = s.gains as number[];
      return `γ ${Number(s.gamma).toFixed(2)}, R ${g[0].toFixed(2)} B ${g[2].toFixed(2)}`;
    }
  }
  return "";
}

const CHECK_LABELS: Record<string, (v: number) => string> = {
  halo: (v) => `halo pixels ${(v * 100).toFixed(1)}% (max 6%)`,
  detail: (v) => `texture detail kept ${(v * 100).toFixed(0)}% (min 80%)`,
  skinDetail: (v) => `skin detail kept ${(v * 100).toFixed(0)}% (min 85%)`,
  skinHueShift: (v) => `skin hue shift ${v.toFixed(1)}° (max 3°)`,
  clipHi: (v) => `new clipped highlights ${(v * 100).toFixed(2)}%`,
  stabGain: (v) => `shake reduced ${(v * 100).toFixed(0)}%`,
  border: (v) => `black border pixels ${(v * 100).toFixed(1)}%`,
  cropMax: (v) => `max stabilisation crop ${(v * 100).toFixed(1)}%`,
};

export function EnhancePanel() {
  const projectId = useEditor((s) => s.projectId);
  const tl = useEditor((s) => s.timeline);
  const selection = useEditor((s) => s.selection);
  const [result, setResult] = useState<EnhanceResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const live = useAgentJob(jobId);

  const clips = useMemo(
    () =>
      tl.tracks
        .filter((t) => t.kind === "video")
        .flatMap((t) => t.clips as VisualClip[])
        .filter((c) => (c.type === "video" || c.type === "image") && c.src)
        .sort((a, b) => a.start - b.start),
    [tl],
  );
  const selectedVisual = selection.find((id) => clips.some((c) => c.id === id));
  const clipId = selectedVisual ?? picked ?? clips[0]?.id ?? null;
  const clip = clips.find((c) => c.id === clipId) ?? null;
  const proposal = result?.clips.find((c) => c.clipId === clipId) ?? null;

  const load = useCallback(
    (id?: string) =>
      api<{ result: EnhanceResult | null }>(`/api/projects/${projectId}/enhance${id ? `?jobId=${id}` : ""}`)
        .then((r) => setResult(r.result))
        .catch((e) => id && toast.error((e as Error).message)),
    [projectId],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!jobId || !live.finished || live.job?.id !== jobId) return;
    if (live.job.status === "done") load(jobId).then(() => toast.success("Enhance proposals ready. Review each clip, then apply."));
    else if (live.job.status === "failed") toast.error(live.job.error ?? "Enhance failed");
    setJobId(null);
  }, [jobId, live.finished, live.job, load]);

  const analyse = async () => {
    setStarting(true);
    try {
      const { job } = await api<{ job: AgentJobDTO }>(`/api/projects/${projectId}/enhance`, { method: "POST", json: { json: useEditor.getState().timeline } });
      setJobId(job.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const applyProposals = (only?: string) => {
    if (!result) return;
    let next = useEditor.getState().timeline;
    let n = 0;
    for (const p of result.clips) {
      if (only && p.clipId !== only) continue;
      const hit = findClip(next, p.clipId);
      if (!hit || (hit.clip.type !== "video" && hit.clip.type !== "image")) continue;
      next = updateClip(next, p.clipId, { enhance: { ...p.settings, upscale: (hit.clip as VisualClip).enhance?.upscale ?? null } });
      n++;
    }
    if (!n) return toast.info("Those clips are no longer on the timeline. Run the analysis again.");
    useEditor.getState().commit(next, only ? "Enhance: apply proposal" : "Enhance: apply all proposals");
    toast.success(only ? "Applied" : `Applied to ${n} clip${n > 1 ? "s" : ""}. Undo anytime.`);
  };

  const busy = starting || Boolean(jobId);
  return (
    <div>
      <Section title="Enhance">
        <p className="text-xs text-muted-foreground">
          Claude measures every clip (exposure, white balance, noise, shake, sharpness), proposes fixes, matches the clips to each other and self-checks the result. Fixes are applied
          per clip in the final render.
        </p>
        <Button className="w-full" onClick={analyse} disabled={busy || !clips.length}>
          {busy ? <Loader2 className="animate-spin" /> : <ScanSearch />} {busy ? "Analysing…" : result ? "Analyse again" : "Analyse clips"}
        </Button>
        {jobId && <AgentLog job={live.job} events={live.events} onCancel={() => live.cancel().catch((e) => toast.error(e.message))} compact />}
        {result && (
          <div className="space-y-2 rounded-md border border-white/10 p-2 text-xs">
            <p className="whitespace-pre-wrap">{result.summary}</p>
            <Button size="sm" variant="secondary" className="w-full" onClick={() => applyProposals()}>
              <Wand2 /> Apply all proposals
            </Button>
          </div>
        )}
      </Section>

      <Section title="Clips">
        {clips.length === 0 && <p className="text-xs text-muted-foreground">No video or photo clips yet.</p>}
        <div className="space-y-1">
          {clips.map((c) => {
            const p = result?.clips.find((r) => r.clipId === c.id);
            const applied = Object.entries(c.enhance ?? {}).filter(([, v]) => v && (v as { on?: boolean }).on).length;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setPicked(c.id);
                  useEditor.getState().select([c.id]);
                }}
                className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left", c.id === clipId ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.thumb ? <img src={c.thumb} alt="" className="h-9 w-6 shrink-0 rounded object-cover" /> : <span className="h-9 w-6 shrink-0 rounded bg-muted" />}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-xs">{c.name}</span>
                  <span className="line-clamp-1 text-[10px] text-muted-foreground">
                    {p ? p.flags.join(" · ") || "looks clean" : "not analysed"}
                    {applied ? ` · ${applied} fix${applied > 1 ? "es" : ""} on` : ""}
                  </span>
                </span>
                {p?.check && (p.check.ok && p.review.ok ? <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" /> : <AlertTriangle className="size-3.5 shrink-0 text-amber-300" />)}
              </button>
            );
          })}
        </div>
      </Section>

      {clip && (
        <ClipEnhance key={clip.id} projectId={projectId} tl={tl} clip={clip} proposal={proposal} onApplyProposal={() => applyProposals(clip.id)} big={big} setBig={setBig} />
      )}
    </div>
  );
}

function ClipEnhance({
  projectId,
  tl,
  clip,
  proposal,
  onApplyProposal,
  big,
  setBig,
}: {
  projectId: string;
  tl: Timeline;
  clip: VisualClip;
  proposal: ClipResult | null;
  onApplyProposal: () => void;
  big: boolean;
  setBig: (v: boolean) => void;
}) {
  const edit = useClipEdit(clip.id);
  const enh: Enhance = clip.enhance ?? {};
  const image = clip.type === "image";
  // What the "after" frame shows: the clip's applied settings, or the proposal when nothing is applied yet.
  const hasApplied = Object.values(enh).some(Boolean);
  const { upscale: _up, ...applied } = enh; // eslint-disable-line @typescript-eslint/no-unused-vars
  const shown: Settings = hasApplied ? applied : (proposal?.settings ?? {});
  const anyOn = Object.values(shown).some((v) => v && (v as { on?: boolean }).on) || Boolean(enh.upscale?.on);
  const width = Math.min(1080, tl.width);
  const before = frameUrl(projectId, clip, null, width);
  const after = frameUrl(projectId, clip, anyOn ? shown : null, width);

  const setFix = (key: EnhanceFix, value: Enhance[EnhanceFix] | null, label: string) => edit.set({ enhance: { ...enh, [key]: value } }, label);
  const liveFix = (key: EnhanceFix, patch: Record<string, unknown>) => {
    const cur = (edit.current() as VisualClip | undefined)?.enhance ?? enh;
    edit.live({ enhance: { ...cur, [key]: { ...(cur[key] as object), ...patch } } });
  };

  return (
    <>
      <Section title="Before / after">
        <BeforeAfter before={before} after={after} onExpand={() => setBig(true)} />
        {!hasApplied && proposal && (
          <div className="flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 p-2 text-xs">
            <span className="flex-1">Showing the proposal (not applied yet).</span>
            <Button size="sm" onClick={onApplyProposal}>
              Apply
            </Button>
          </div>
        )}
        {!hasApplied && !proposal && <p className="text-xs text-muted-foreground">Run “Analyse clips” for proposals, or switch fixes on below.</p>}
      </Section>

      <Section title="Fixes">
        {FIXES.filter((f) => !(image && f.key === "stabilize")).map((f) => {
          const cur = (enh[f.key] ?? null) as Record<string, unknown> | null;
          const prop = (proposal?.settings[f.key] ?? null) as Record<string, unknown> | null;
          const value = cur ?? prop;
          const isOn = Boolean(cur?.on);
          return (
            <div key={f.key} className="space-y-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{f.label}</div>
                  <div className="text-[11px] text-muted-foreground">{value ? fixSummary(f.key, value) : f.hint}</div>
                </div>
                <Switch
                  checked={isOn}
                  disabled={!value && f.key !== "sharpen" && f.key !== "denoise"}
                  onCheckedChange={(v) =>
                    setFix(f.key, { ...(value ?? (f.key === "sharpen" ? { amount: 0.3 } : { method: "hqdn3d", strength: 0.4 })), on: v } as Enhance[EnhanceFix], `Enhance: ${f.label} ${v ? "on" : "off"}`)
                  }
                />
              </div>
              {isOn && f.key === "denoise" && (
                <SliderField
                  label="Strength"
                  value={Number(cur!.strength)}
                  min={0.05}
                  max={1}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onLive={(v) => liveFix("denoise", { strength: v })}
                  onDone={() => edit.done("Enhance: denoise strength")}
                />
              )}
              {isOn && f.key === "sharpen" && (
                <SliderField
                  label="Amount"
                  value={Number(cur!.amount)}
                  min={0.05}
                  max={0.8}
                  onLive={(v) => liveFix("sharpen", { amount: v })}
                  onDone={() => edit.done("Enhance: sharpen amount")}
                />
              )}
            </div>
          );
        })}
      </Section>

      {!image && <UpscaleSection projectId={projectId} clip={clip} srcWidth={proposal?.metrics?.srcWidth ?? clip.srcWidth ?? null} />}

      {proposal && (
        <Section title="Self-check">
          <ul className="space-y-1 text-xs">
            {Object.entries(proposal.check ?? {})
              .filter(([k, v]) => typeof v === "number" && CHECK_LABELS[k])
              .map(([k, v]) => (
                <li key={k} className="text-muted-foreground">
                  {CHECK_LABELS[k](v as number)}
                </li>
              ))}
            {(proposal.check?.failures ?? []).map((f) => (
              <li key={f} className="text-amber-300">
                ✗ {f}
              </li>
            ))}
            {(proposal.check?.adjusted ?? []).map((a) => (
              <li key={a} className="text-sky-300">
                ↳ {a}
              </li>
            ))}
          </ul>
          <p className={cn("text-xs", proposal.review.ok ? "text-emerald-300" : "text-amber-300")}>Claude: {proposal.review.notes || (proposal.review.ok ? "Looks good." : "Needs a look.")}</p>
        </Section>
      )}

      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="max-h-[95dvh] max-w-3xl overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">{clip.name}: before / after (drag the line)</DialogTitle>
          </DialogHeader>
          <BeforeAfter before={before} after={after} className="mx-auto max-h-[80dvh] w-auto max-w-full" />
        </DialogContent>
      </Dialog>
    </>
  );
}

function UpscaleSection({ projectId, clip, srcWidth }: { projectId: string; clip: VisualClip; srcWidth: number | null }) {
  const edit = useClipEdit(clip.id);
  const up = clip.enhance?.upscale ?? null;
  const [estimating, setEstimating] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const live = useAgentJob(up?.jobId ?? null);
  const len = clip.duration * clip.speed;
  const srcIn = Math.max(0, clip.in - 0.25);
  const srcLen = len + 0.5;

  // finished upscale job -> switch the intermediate on
  useEffect(() => {
    if (!up?.jobId || !live.finished || live.job?.id !== up.jobId) return;
    const cur = (edit.current() as VisualClip | undefined)?.enhance ?? {};
    if (live.job.status === "done") {
      edit.set({ enhance: { ...cur, upscale: { ...up, on: true, jobId: null } } }, "Enhance: AI upscale ready");
      toast.success("AI upscale finished and switched on.");
    } else {
      edit.set({ enhance: { ...cur, upscale: null } }, "Enhance: AI upscale failed");
      toast.error(live.job.error ?? "AI upscale failed");
    }
  }, [up, live.finished, live.job, edit]);

  if (!srcWidth || (srcWidth >= 1080 && !up)) return null;

  const getEstimate = async () => {
    setEstimating(true);
    try {
      const r = await api<{ estimate: Estimate }>(`/api/projects/${projectId}/enhance/upscale`, { method: "POST", json: { src: clip.src, in: srcIn, len: srcLen, run: false } });
      setEstimate(r.estimate);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEstimating(false);
    }
  };
  const run = async () => {
    if (!estimate) return;
    try {
      const r = await api<{ job: AgentJobDTO; url: string; srcIn: number; srcLen: number }>(`/api/projects/${projectId}/enhance/upscale`, {
        method: "POST",
        json: { src: clip.src, in: srcIn, len: srcLen, run: true },
      });
      const cur = (edit.current() as VisualClip | undefined)?.enhance ?? {};
      edit.set(
        { enhance: { ...cur, upscale: { on: false, url: r.url, srcIn: r.srcIn, srcLen: r.srcLen, width: estimate.outWidth, height: estimate.outHeight, jobId: r.job.id } } },
        "Enhance: start AI upscale",
      );
      setEstimate(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const stale = up && !up.jobId && (clip.in < up.srcIn - 0.05 || clip.in + len > up.srcIn + up.srcLen + 0.05);

  return (
    <Section title="AI upscale">
      <p className="text-xs text-muted-foreground">
        Source is {srcWidth}px wide. Real-ESRGAN (x4, CPU) rebuilds detail, then scales to 1080. Slow: you get a time estimate first.
      </p>
      {up?.jobId ? (
        <AgentLog job={live.job} events={live.events.slice(-30)} onCancel={() => live.cancel().catch((e) => toast.error(e.message))} compact />
      ) : up ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm">Use the upscaled clip</span>
            <Switch checked={up.on} onCheckedChange={(v) => edit.set({ enhance: { ...(clip.enhance ?? {}), upscale: { ...up, on: v } } }, `Enhance: AI upscale ${v ? "on" : "off"}`)} />
          </div>
          {stale && <p className="text-[11px] text-amber-300">The clip was trimmed outside the upscaled part. Upscale again to cover the new range.</p>}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => edit.set({ enhance: { ...(clip.enhance ?? {}), upscale: null } }, "Enhance: remove AI upscale")}>
            Remove upscale
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="w-full" onClick={getEstimate} disabled={estimating}>
          {estimating ? <Loader2 className="animate-spin" /> : null} {estimating ? "Timing one frame…" : "Estimate upscale time"}
        </Button>
      )}
      <AlertDialog open={Boolean(estimate)} onOpenChange={(o) => !o && setEstimate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run AI upscale?</AlertDialogTitle>
            <AlertDialogDescription>
              {estimate &&
                `${estimate.frames} frames at about ${estimate.secondsPerFrame.toFixed(1)} s each on the CPU: roughly ${dur(estimate.estimateSeconds)}. ` +
                  `${estimate.srcWidth}px → ${estimate.outWidth}×${estimate.outHeight}. It runs in the background on the agent runner (one job at a time), and you can cancel it from the Jobs page.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Run upscale</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
