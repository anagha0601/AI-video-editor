"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

// The render's quality check (worker/quality.py render_check), saved on RenderJob.report.quality.

export interface QualityCheckRow {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
  level: "ok" | "warn" | "fail";
}
export interface QualityReportData {
  pass: boolean;
  checks: QualityCheckRow[];
  metrics?: { vmaf?: number; vmaf_min?: number; ssim?: number };
}

const ICON = { ok: CheckCircle2, warn: AlertTriangle, fail: XCircle } as const;
const TONE = { ok: "text-emerald-400", warn: "text-amber-300", fail: "text-destructive" } as const;

export function QualityReport({ q, defaultOpen = false }: { q?: QualityReportData | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!q) return null;
  const warns = q.checks.filter((c) => c.level === "warn").length;
  const fails = q.checks.filter((c) => c.level === "fail").length;
  return (
    <div className="text-[11px]">
      <button type="button" onClick={() => setOpen((v) => !v)} className={cn("flex items-center gap-1", q.pass ? "text-emerald-400" : "text-destructive")}>
        {q.pass ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
        Quality {q.pass ? "pass" : "fail"}
        {q.metrics?.vmaf != null ? ` · VMAF ${q.metrics.vmaf.toFixed(1)}` : ""}
        {fails ? ` · ${fails} failed` : ""}
        {warns ? <span className="text-amber-300"> · {warns} warning{warns > 1 ? "s" : ""}</span> : null}
        <ChevronDown className={cn("size-3 transition", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5">
          {q.checks.map((c) => {
            const I = ICON[c.level];
            return (
              <li key={c.key} className="flex items-start gap-1.5">
                <I className={cn("mt-0.5 size-3 shrink-0", TONE[c.level])} />
                <span>
                  {c.label}
                  {c.detail ? <span className="text-muted-foreground"> · {c.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Self-check panel: the quality of this project's latest export. */
export function LatestExportQuality({ projectId }: { projectId: string }) {
  const [q, setQ] = useState<QualityReportData | null | undefined>(undefined);
  useEffect(() => {
    api<{ renders: { status: string; report?: { quality?: QualityReportData } | null }[] }>(`/api/projects/${projectId}/renders`)
      .then((r) => setQ(r.renders.find((x) => x.status === "done" && x.report?.quality)?.report?.quality ?? null))
      .catch(() => setQ(null));
  }, [projectId]);
  return (
    <div className="rounded-lg border p-2">
      <div className="mb-1 text-xs font-medium">Quality check (latest export)</div>
      {q === undefined ? null : q ? <QualityReport q={q} defaultOpen /> : <p className="text-[11px] text-muted-foreground">Export once to see VMAF/SSIM, HDR handling, encode count, bitrate and colour tags.</p>}
    </div>
  );
}
