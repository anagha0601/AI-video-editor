"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, ChevronRight, Loader2, Terminal, Wrench, XCircle } from "lucide-react";
import type { AgentEvent, AgentJobDTO } from "@/lib/client/agent";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "text-muted-foreground" },
  running: { label: "Running", cls: "text-sky-400" },
  done: { label: "Done", cls: "text-emerald-400" },
  failed: { label: "Failed", cls: "text-red-400" },
  cancelled: { label: "Cancelled", cls: "text-amber-400" },
};

export function JobStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.queued;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", s.cls)}>
      {status === "running" && <Loader2 className="size-3 animate-spin" />}
      {status === "done" && <CheckCircle2 className="size-3" />}
      {status === "failed" && <XCircle className="size-3" />}
      {status === "cancelled" && <Ban className="size-3" />}
      {s.label}
    </span>
  );
}

function useElapsed(job: AgentJobDTO | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.status]);
  if (!job?.startedAt) return null;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  const s = Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Header (status, elapsed, cancel) + the streamed event log of one job. */
export function AgentLog({
  job,
  events,
  onCancel,
  className,
  compact,
}: {
  job: AgentJobDTO | null;
  events: AgentEvent[];
  onCancel?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const elapsed = useElapsed(job);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) bottom.current?.scrollIntoView({ block: "end" });
  }, [events.length]);
  const active = job && (job.status === "queued" || job.status === "running");

  return (
    <div className={cn("flex min-h-0 flex-col rounded-lg border bg-black/30", className)}>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Terminal className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{job?.title ?? "Connecting…"}</span>
        {job && <JobStatus status={job.status} />}
        {elapsed && <span className="text-[11px] text-muted-foreground tabular-nums">{elapsed}</span>}
        {active && onCancel && (
          <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <div ref={box} className={cn("min-h-0 flex-1 space-y-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed", compact ? "max-h-56" : "")}>
        {job?.status === "queued" && <p className="text-muted-foreground">Waiting for the agent runner…</p>}
        {events.map((e, i) => (
          <EventRow key={i} e={e} />
        ))}
        {job?.status === "failed" && job.error && <p className="whitespace-pre-wrap text-red-400">{job.error}</p>}
        <div ref={bottom} />
      </div>
    </div>
  );
}

function EventRow({ e }: { e: AgentEvent }) {
  switch (e.k) {
    case "init":
      return <p className="text-muted-foreground">Session started · {e.model}</p>;
    case "text":
      return <p className="whitespace-pre-wrap font-sans text-xs text-foreground">{e.text}</p>;
    case "tool":
      return (
        <p className="flex gap-1 text-sky-300">
          <Wrench className="mt-0.5 size-3 shrink-0" />
          <span className="font-semibold">{e.name}</span>
          <span className="min-w-0 break-all text-sky-200/70">{e.detail}</span>
        </p>
      );
    case "tool_result":
      return (
        <p className={cn("flex gap-1 pl-4", e.error ? "text-red-400" : "text-muted-foreground")}>
          <ChevronRight className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-3 min-w-0 break-all whitespace-pre-wrap">{e.text || "(no output)"}</span>
        </p>
      );
    case "note":
      return (
        <p className={cn("flex gap-1", e.level === "error" ? "text-red-400" : e.level === "warn" ? "text-amber-300" : "text-violet-300")}>
          {e.level !== "info" && <AlertTriangle className="mt-0.5 size-3 shrink-0" />}
          <span className="whitespace-pre-wrap">{e.text}</span>
        </p>
      );
    case "result":
      return (
        <div className={cn("rounded border p-2 font-sans text-xs", e.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5")}>
          <p className="mb-1 text-[11px] text-muted-foreground">
            {e.ok ? "Finished" : "Ended with an error"}
            {e.turns !== undefined && ` · ${e.turns} turns`}
            {e.durationMs !== undefined && ` · ${Math.round(e.durationMs / 1000)}s`}
            {e.costUsd !== undefined && ` · usage estimate $${e.costUsd.toFixed(2)} (covered by your subscription)`}
          </p>
          <p className="line-clamp-6 whitespace-pre-wrap">{e.text}</p>
          {e.denials.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-300">
              Blocked by the tool allowlist: {e.denials.slice(0, 5).join(" · ")}
              {e.denials.length > 5 && ` (+${e.denials.length - 5})`}
            </p>
          )}
        </div>
      );
  }
}
