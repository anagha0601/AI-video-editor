import { prisma } from "@/server/db";
import { runnerState } from "@/server/agent";
import { requireUserId, route } from "@/server/http";
import { billingWarnings } from "@/agent/config";

/** Runner heartbeat, Claude login + subscription, billing warnings and queue size. */
export const GET = route(async () => {
  const userId = await requireUserId();
  const state = runnerState();
  const queued = await prisma.agentJob.count({ where: { userId, status: { in: ["queued", "running"] } } });
  const warnings = [...new Set([...billingWarnings(), ...(state.status?.warnings ?? [])])];
  return { ...state, queued, warnings };
});
