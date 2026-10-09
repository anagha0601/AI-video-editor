"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useRunnerStatus } from "@/lib/client/agent";

/** App-wide strip when the agent runner is down, Claude isn't on a subscription login, or an API key is set. */
export function AgentBanner() {
  const info = useRunnerStatus(15_000);
  if (!info || (info.online && !info.warnings.length)) return null;
  return (
    <div className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-xs text-amber-200">
      <div className="mx-auto flex max-w-7xl items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-0.5">
          {!info.online && (
            <p>
              The Claude agent runner is offline, so AI features are paused. Start it with <code className="rounded bg-black/30 px-1">npm run agent</code>.
            </p>
          )}
          {info.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
        <Link href="/jobs" className="shrink-0 underline underline-offset-2">
          Jobs
        </Link>
      </div>
    </div>
  );
}
