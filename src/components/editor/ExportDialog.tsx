"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useEditor } from "./store";
import { saveNow } from "./hooks";

export interface RenderRow {
  id: string;
  status: "queued" | "processing" | "done" | "failed";
  progress: number;
  quality: string;
  outputUrl: string | null;
  thumbUrl: string | null;
  error: string | null;
  duration: number | null;
  createdAt: string;
  finishedAt: string | null;
  version: { id: string; name: string };
}

export function RenderList({ projectId, renders, onChange }: { projectId: string; renders: RenderRow[]; onChange: (r: RenderRow[]) => void }) {
  const latest = useRef(renders);
  latest.current = renders;
  const [ahead, setAhead] = useState<Record<string, number>>({});

  // Poll active renders.
  const active = renders.filter((r) => r.status === "queued" || r.status === "processing").map((r) => r.id).join(",");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      for (const id of active.split(",")) {
        try {
          const { render, ahead: a } = await api<{ render: RenderRow; ahead: number }>(`/api/renders/${id}`);
          setAhead((m) => ({ ...m, [id]: a }));
          onChange(latest.current.map((r) => (r.id === id ? render : r)));
          if (render.status === "done") toast.success("Your video is ready");
          if (render.status === "failed") toast.error("Render failed");
        } catch {
          /* keep polling */
        }
      }
    }, 1500);
    return () => clearInterval(t);
  }, [active, onChange]);

  const remove = async (id: string) => {
    try {
      await api(`/api/renders/${id}`, { method: "DELETE" });
      onChange(latest.current.filter((r) => r.id !== id));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!renders.length) return <p className="py-4 text-center text-sm text-muted-foreground">No renders yet.</p>;
  return (
    <div className="space-y-2">
      {renders.map((r) => (
        <div key={r.id} className="flex gap-3 rounded-lg border p-2">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
            {r.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.thumbUrl} alt="" className="h-full w-full object-cover" />
            ) : r.status === "failed" ? (
              <span className="text-xs text-destructive">!</span>
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm">{r.version.name}</span>
              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                {r.quality}
              </Badge>
            </div>
            {r.status === "done" ? (
              <div className="text-[11px] text-muted-foreground">
                {r.duration ? `${r.duration.toFixed(1)}s · ` : ""}
                {new Date(r.finishedAt ?? r.createdAt).toLocaleString()}
              </div>
            ) : r.status === "failed" ? (
              <div className="line-clamp-2 text-[11px] text-destructive" title={r.error ?? ""}>
                {r.error ?? "Failed"}
              </div>
            ) : (
              <>
                <div className="h-1.5 overflow-hidden rounded bg-muted">
                  <div className={cn("h-full bg-primary transition-all", r.status === "queued" && "animate-pulse")} style={{ width: `${Math.max(3, r.progress * 100)}%` }} />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {r.status === "queued" ? (ahead[r.id] ? `Queued · ${ahead[r.id]} ahead` : "Queued · waiting for the render worker") : `Rendering ${Math.round(r.progress * 100)}%`}
                </div>
              </>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {r.status === "done" && r.outputUrl && (
              <Button size="sm" asChild>
                <a href={r.outputUrl} download={`reelsmith-${projectId}-${r.id}.mp4`} target="_blank" rel="noreferrer">
                  <Download /> MP4
                </a>
              </Button>
            )}
            {r.status !== "processing" && (
              <Button size="sm" variant="ghost" onClick={() => remove(r.id)} aria-label="Delete render">
                <Trash2 />
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ExportDialog() {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<"720p" | "1080p">("1080p");
  const [renders, setRenders] = useState<RenderRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const projectId = useEditor((s) => s.projectId);

  useEffect(() => {
    if (!open) return;
    api<{ renders: RenderRow[] }>(`/api/projects/${projectId}/renders`)
      .then((r) => setRenders(r.renders))
      .catch((e) => toast.error(e.message));
  }, [open, projectId]);

  const render = async () => {
    setBusy(true);
    try {
      await saveNow().catch(() => {});
      const { render } = await api<{ render: RenderRow }>(`/api/projects/${projectId}/renders`, {
        method: "POST",
        json: { quality, json: useEditor.getState().timeline },
      });
      setRenders((r) => [render, ...(r ?? [])]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="brand-gradient text-white">
          <Upload /> Export
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export MP4</DialogTitle>
          <DialogDescription>Rendered by the worker from a snapshot of this exact timeline, with captions burned in. Re-render as often as you like.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {(["720p", "1080p"] as const).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuality(q)}
              className={cn("rounded-lg border p-3 text-left", quality === q ? "border-primary bg-primary/10" : "hover:border-white/30")}
            >
              <div className="text-sm font-medium">{q}</div>
              <div className="text-xs text-muted-foreground">{q === "720p" ? "Faster, smaller file" : "Best quality"}</div>
            </button>
          ))}
        </div>
        <Button onClick={render} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />} Render {quality}
        </Button>
        <div className="max-h-[45vh] overflow-y-auto">
          {renders === null ? (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <RenderList projectId={projectId} renders={renders} onChange={setRenders} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
