"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/agent/events";
import type { AgentJobDTO } from "@/server/agent";
import { api } from "./api";

export type { AgentEvent, AgentJobDTO };
export const TERMINAL = ["done", "failed", "cancelled"];

/** Live view of one agent job over SSE: status + condensed events. */
export function useAgentJob(jobId: string | null) {
  const [job, setJob] = useState<AgentJobDTO | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setEvents([]);
    setJob(null);
    if (!jobId) return;
    const es = new EventSource(`/api/agent/jobs/${jobId}/stream`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.addEventListener("status", (e) => setJob(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("events", (e) => setEvents((list) => [...list, ...(JSON.parse((e as MessageEvent).data) as AgentEvent[])]));
    es.addEventListener("end", (e) => {
      setJob(JSON.parse((e as MessageEvent).data));
      setConnected(false);
      es.close();
    });
    es.onerror = () => setConnected(false); // EventSource reconnects with Last-Event-ID by itself
    return () => es.close();
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    const r = await api<{ job: AgentJobDTO }>(`/api/agent/jobs/${jobId}/cancel`, { method: "POST" });
    setJob(r.job);
  }, [jobId]);

  return { job, events, connected, cancel, finished: Boolean(job && TERMINAL.includes(job.status)) };
}

export interface RunnerInfo {
  online: boolean;
  queued: number;
  warnings: string[];
  status: {
    claude: { command: string; version: string | null } | null;
    auth: { loggedIn: boolean; authMethod?: string; subscriptionType?: string } | null;
    currentJobId: string | null;
    heartbeatAt: string;
  } | null;
}

export function useRunnerStatus(intervalMs = 10_000) {
  const [info, setInfo] = useState<RunnerInfo | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = () =>
      api<RunnerInfo>("/api/agent/status")
        .then((r) => !stop && setInfo(r))
        .catch(() => {});
    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [intervalMs]);
  return info;
}
