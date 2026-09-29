"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Loader2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/site/Logo";
import { cn } from "@/lib/utils";

interface Status {
  project: { status: string; statusMessage: string | null; title: string };
  voice: { status: string; error: string | null; createdAt: string; queuedFor: number } | null;
}

const STEPS = [
  { id: "upload", label: "Voice uploaded" },
  { id: "transcribe", label: "Transcribing with word timings" },
  { id: "build", label: "Splitting scenes & matching visuals" },
  { id: "open", label: "Opening the editor" },
];

function stepIndex(status: string) {
  if (status === "draft") return 0;
  if (status === "transcribing") return 1;
  if (status === "transcribed" || status === "building") return 2;
  return 3;
}

/** Shown until the first cut exists. Polling the project endpoint also triggers the build. */
export function Processing({ projectId, title, initialStatus }: { projectId: string; title: string; initialStatus: string }) {
  const router = useRouter();
  const [data, setData] = useState<Status | null>(null);
  const status = data?.project.status ?? initialStatus;

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d = await api<Status>(`/api/projects/${projectId}`);
        if (!alive) return;
        setData(d);
        if (d.project.status === "ready" || d.project.status === "rendered") {
          router.refresh();
          return;
        }
      } catch {
        /* retry */
      }
      if (alive) setTimeout(poll, 2000);
    };
    poll();
    return () => {
      alive = false;
    };
  }, [projectId, router]);

  const idx = stepIndex(status);
  const failed = status === "failed";
  const stuck = status === "transcribing" && data?.voice?.status === "queued" && (data.voice.queuedFor ?? 0) > 20;

  return (
    <div className="bg-grid flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard" aria-label="Back">
            <ArrowLeft />
          </Link>
        </Button>
        <Logo href="/dashboard" />
      </header>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border bg-card/80 p-6 shadow-2xl backdrop-blur">
          <h1 className="truncate text-lg font-semibold">{data?.project.title ?? title}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{failed ? "Something went wrong." : "Building your first cut…"}</p>
          <ol className="space-y-3">
            {STEPS.map((s, i) => {
              const done = i < idx && !failed;
              const current = i === idx && !failed;
              return (
                <li key={s.id} className="flex items-center gap-3 text-sm">
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border",
                      done && "border-emerald-500 bg-emerald-500/20 text-emerald-300",
                      current && "border-primary text-primary",
                    )}
                  >
                    {done ? <Check className="size-3.5" /> : current ? <Loader2 className="size-3.5 animate-spin" /> : <span className="size-1.5 rounded-full bg-muted-foreground" />}
                  </span>
                  <span className={cn(!done && !current && "text-muted-foreground")}>{s.label}</span>
                </li>
              );
            })}
          </ol>
          {stuck && (
            <p className="mt-6 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">
              Still waiting for the worker to pick this up. Is it running? Locally: <code>python worker/main.py</code> or <code>docker compose up worker</code>.
            </p>
          )}
          {failed && (
            <div className="mt-6 space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <div className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{data?.project.statusMessage ?? data?.voice?.error ?? "Processing failed."}</span>
              </div>
              <Button size="sm" variant="secondary" asChild>
                <Link href="/projects/new">Try another recording</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
