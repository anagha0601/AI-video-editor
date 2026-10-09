"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { useAgentJob, useRunnerStatus, type AgentJobDTO } from "@/lib/client/agent";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LatestExportQuality } from "@/components/editor/QualityReport";
import { AgentLog, JobStatus } from "./AgentLog";

/** Runner state line: online, Claude version, login, queue. */
export function RunnerLine() {
  const info = useRunnerStatus();
  if (!info) return <p className="text-xs text-muted-foreground">Checking the agent runner…</p>;
  const a = info.status?.auth;
  return (
    <div className="space-y-1 text-xs">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn("inline-flex items-center gap-1.5 font-medium", info.online ? "text-emerald-400" : "text-red-400")}>
          <span className={cn("size-2 rounded-full", info.online ? "bg-emerald-400" : "bg-red-400")} />
          Runner {info.online ? "online" : "offline"}
        </span>
        {info.status?.claude?.version && <span className="text-muted-foreground">{info.status.claude.version}</span>}
        {a && (
          <span className={a.loggedIn && a.authMethod === "claude.ai" ? "text-muted-foreground" : "text-amber-300"}>
            {a.loggedIn ? `${a.authMethod === "claude.ai" ? "Claude subscription" : a.authMethod}${a.subscriptionType ? ` (${a.subscriptionType})` : ""}` : "not logged in"}
          </span>
        )}
        <span className="text-muted-foreground">{info.queued} in queue</span>
      </p>
      {!info.online && (
        <p className="text-muted-foreground">
          Start it in a terminal: <code className="rounded bg-muted px-1">npm run agent</code>
        </p>
      )}
      {info.warnings.map((w) => (
        <p key={w} className="text-amber-300">
          {w}
        </p>
      ))}
    </div>
  );
}

/** Editor top-bar button: this project's Claude jobs, a live log, cancel, and the runner self-check. */
export function AgentPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<AgentJobDTO[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const live = useAgentJob(open ? selected : null);

  const load = useCallback(async () => {
    const r = await api<{ jobs: AgentJobDTO[] }>(`/api/agent/jobs?projectId=${projectId}`);
    setJobs(r.jobs);
    setSelected((s) => s ?? r.jobs[0]?.id ?? null);
  }, [projectId]);

  useEffect(() => {
    if (open) load().catch(() => {});
  }, [open, load, live.job?.status]);

  const selftest = async () => {
    setStarting(true);
    try {
      const { job } = await api<{ job: AgentJobDTO }>("/api/agent/selftest", { method: "POST", json: { projectId } });
      setJobs((j) => [job, ...j]);
      setSelected(job.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Bot /> <span className="hidden lg:inline">Claude</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80dvh] max-w-4xl flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Claude jobs</DialogTitle>
          <DialogDescription>Headless Claude Code runs for this project, on your Claude subscription. One job runs at a time.</DialogDescription>
        </DialogHeader>
        <RunnerLine />
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[240px_1fr]">
          <div className="flex min-h-0 flex-col gap-2">
            <Button size="sm" variant="secondary" onClick={selftest} disabled={starting}>
              {starting ? <Loader2 className="animate-spin" /> : <PlayCircle />} Run self-check
            </Button>
            <LatestExportQuality projectId={projectId} />
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {jobs.length === 0 && <p className="p-2 text-xs text-muted-foreground">No jobs yet.</p>}
              {jobs.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => setSelected(j.id)}
                  className={cn("w-full rounded-md border px-2 py-1.5 text-left", selected === j.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted")}
                >
                  <span className="line-clamp-1 text-xs">{j.title}</span>
                  <span className="flex items-center justify-between gap-2">
                    <JobStatus status={selected === j.id && live.job ? live.job.status : j.status} />
                    <span className="text-[10px] text-muted-foreground">{new Date(j.createdAt).toLocaleTimeString()}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
          {selected ? (
            <AgentLog job={live.job} events={live.events} onCancel={() => live.cancel().catch((e) => toast.error(e.message))} className="min-h-0" />
          ) : (
            <div className="flex items-center justify-center rounded-lg border text-sm text-muted-foreground">Run the self-check to test the runner.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
