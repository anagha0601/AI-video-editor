"use client";

import { useMemo, useState } from "react";
import { compare, type Operation } from "fast-json-patch";
import { Check, Eye, EyeOff, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { applyAiOps, type AiOp } from "@/lib/timeline/ai";
import type { AnyClip, TextClip, Timeline } from "@/lib/timeline/types";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useEditor } from "../store";

const EXAMPLES = ["Cut all pauses", "Make scene 3 moodier", "Add a title card at start", "Replace city clips with nature", "Crossfade between every scene", "Switch captions to karaoke"];

interface Proposal {
  command: string;
  summary: string;
  ops: (AiOp & { why?: string })[];
  base: Timeline;
  next: Timeline;
  patch: Operation[];
}

/** Human-readable lines for a JSON patch (track/clip indices -> names). */
function describePatch(base: Timeline, patch: Operation[]) {
  const label = (path: string) => {
    const m = /^\/tracks\/(\d+)(?:\/clips\/(\d+))?(.*)$/.exec(path);
    if (!m) return path.slice(1).replace(/\//g, " › ");
    const track = base.tracks[Number(m[1])];
    const clip = m[2] !== undefined ? (track?.clips[Number(m[2])] as AnyClip | undefined) : undefined;
    const clipName = clip ? ("name" in clip ? clip.name : `“${(clip as TextClip).text.slice(0, 20)}”`) : m[2] !== undefined ? "new clip" : "";
    return [track?.name ?? `track ${m[1]}`, clipName, m[3].slice(1).replace(/\//g, " › ")].filter(Boolean).join(" › ");
  };
  const fmt = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 100) / 100) : typeof v === "object" ? "{…}" : JSON.stringify(v));
  return patch.map((p) => {
    if (p.op === "replace") return { kind: "~", text: `${label(p.path)} → ${fmt(p.value)}` };
    if (p.op === "add") return { kind: "+", text: `${label(p.path)}${typeof p.value === "object" ? "" : ` = ${fmt(p.value)}`}` };
    if (p.op === "remove") return { kind: "−", text: label(p.path) };
    return { kind: "~", text: `${p.op} ${label(p.path)}` };
  });
}

export function AiPanel() {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [history, setHistory] = useState<{ command: string; summary: string; applied: boolean }[]>([]);
  const previewing = useEditor((s) => Boolean(s.preview));
  const lines = useMemo(() => (proposal ? describePatch(proposal.base, proposal.patch) : []), [proposal]);

  const run = async (cmd = command) => {
    if (!cmd.trim() || busy) return;
    setBusy(true);
    setProposal(null);
    useEditor.getState().setPreview(null);
    try {
      const base = useEditor.getState().timeline;
      const { projectId } = useEditor.getState();
      const res = await api<{ summary: string; ops: (AiOp & { why?: string })[] }>(`/api/projects/${projectId}/ai-edit`, {
        method: "POST",
        json: { command: cmd, json: base },
      });
      const next = applyAiOps(base, res.ops);
      const patch = compare(base, next);
      if (!res.ops.length || !patch.length) {
        toast.info(res.summary || "No changes needed");
        setHistory((h) => [{ command: cmd, summary: res.summary || "No changes", applied: false }, ...h]);
        return;
      }
      setProposal({ command: cmd, summary: res.summary, ops: res.ops, base, next, patch });
      useEditor.getState().setPreview(next);
      setCommand("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!proposal) return;
    const s = useEditor.getState();
    // If the timeline changed while reviewing, replay the ops on the latest state.
    const next = s.timeline === proposal.base ? proposal.next : applyAiOps(s.timeline, proposal.ops);
    s.setPreview(null);
    s.commit(next, `AI: ${proposal.command}`);
    setHistory((h) => [{ command: proposal.command, summary: proposal.summary, applied: true }, ...h]);
    setProposal(null);
    toast.success("Applied — undo anytime with ⌘/Ctrl+Z");
  };

  const reject = () => {
    useEditor.getState().setPreview(null);
    if (proposal) setHistory((h) => [{ command: proposal.command, summary: proposal.summary, applied: false }, ...h]);
    setProposal(null);
  };

  return (
    <div className="space-y-4 p-3">
      <div className="space-y-2">
        <Textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              run();
            }
          }}
          placeholder="Tell the editor what to change…"
          rows={3}
          className="text-sm"
          disabled={busy}
        />
        <Button className="w-full" onClick={() => run()} disabled={busy || !command.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? "Thinking…" : "Propose edit"}
        </Button>
        <div className="flex flex-wrap gap-1">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground" onClick={() => run(ex)} disabled={busy}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      {proposal && (
        <div className="space-y-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
          <div className="text-sm font-medium">{proposal.summary}</div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {proposal.ops.map((o, i) => (
              <li key={i}>
                <span className="font-mono text-foreground">{o.op}</span> {o.why ? `— ${o.why}` : ""}
              </li>
            ))}
          </ul>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{proposal.patch.length} JSON changes</summary>
            <div className="mt-2 max-h-48 space-y-0.5 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px]">
              {lines.slice(0, 200).map((l, i) => (
                <div key={i} className={cn(l.kind === "+" ? "text-emerald-300" : l.kind === "−" ? "text-red-300" : "text-amber-200")}>
                  {l.kind} {l.text}
                </div>
              ))}
              {lines.length > 200 && <div className="text-muted-foreground">…and {lines.length - 200} more</div>}
            </div>
          </details>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={apply}>
              <Check /> Apply
            </Button>
            <Button size="sm" variant="secondary" onClick={() => useEditor.getState().setPreview(previewing ? null : proposal.next)}>
              {previewing ? <EyeOff /> : <Eye />} {previewing ? "Show current" : "Preview"}
            </Button>
            <Button size="sm" variant="ghost" onClick={reject} aria-label="Reject">
              <X />
            </Button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">This session</h3>
          {history.map((h, i) => (
            <div key={i} className="rounded-md px-2 py-1 text-xs">
              <span className={h.applied ? "text-emerald-300" : "text-muted-foreground line-through"}>{h.command}</span>
              <div className="text-[11px] text-muted-foreground">{h.summary}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
