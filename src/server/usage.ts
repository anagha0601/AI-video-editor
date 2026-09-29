import "server-only";
import { prisma } from "./db";

// Aggregations for the /usage dashboard and the budget banner. Days are UTC.

const DAY = 86_400_000;

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfUtcWeek(d = new Date()) {
  const day = startOfUtcDay(d);
  const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - dow * DAY);
}
function startOfUtcMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function monthlyBudget(): number | null {
  const v = Number(process.env.MONTHLY_BUDGET_USD);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Spend this calendar month across the whole app (the API key's bill) vs the budget. */
export async function budgetStatus() {
  const budget = monthlyBudget();
  const agg = await prisma.apiUsage.aggregate({ where: { createdAt: { gte: startOfUtcMonth() } }, _sum: { costUsd: true } });
  const spent = agg._sum.costUsd ?? 0;
  return { budget, spent, pct: budget ? spent / budget : 0 };
}

async function sumSince(userId: string, since?: Date) {
  const agg = await prisma.apiUsage.aggregate({
    where: { userId, ...(since ? { createdAt: { gte: since } } : {}) },
    _sum: { costUsd: true },
    _count: true,
  });
  return { cost: agg._sum.costUsd ?? 0, calls: agg._count };
}

export async function usageDashboard(userId: string) {
  const now = new Date();
  const since30 = new Date(startOfUtcDay(now).getTime() - 29 * DAY);
  const [today, week, month, all, rows30, byFeature, byModel, projects, perProject, budget] = await Promise.all([
    sumSince(userId, startOfUtcDay(now)),
    sumSince(userId, startOfUtcWeek(now)),
    sumSince(userId, startOfUtcMonth(now)),
    sumSince(userId),
    prisma.apiUsage.findMany({ where: { userId, createdAt: { gte: since30 } }, select: { createdAt: true, costUsd: true } }),
    prisma.apiUsage.groupBy({ by: ["feature"], where: { userId }, _sum: { costUsd: true, inputTokens: true, outputTokens: true, thinkingTokens: true }, _count: true }),
    prisma.apiUsage.groupBy({ by: ["model"], where: { userId }, _sum: { costUsd: true, inputTokens: true, outputTokens: true, thinkingTokens: true }, _count: true }),
    prisma.project.findMany({ where: { userId }, select: { id: true, title: true, createdAt: true, status: true } }),
    prisma.apiUsage.groupBy({ by: ["projectId"], where: { userId }, _sum: { costUsd: true }, _count: true }),
    budgetStatus(),
  ]);

  const daily: { date: string; cost: number; calls: number }[] = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(since30.getTime() + i * DAY);
    daily.push({ date: d.toISOString().slice(0, 10), cost: 0, calls: 0 });
  }
  const idx = new Map(daily.map((d, i) => [d.date, i]));
  for (const r of rows30) {
    const i = idx.get(r.createdAt.toISOString().slice(0, 10));
    if (i !== undefined) {
      daily[i].cost += r.costUsd;
      daily[i].calls += 1;
    }
  }

  const tokens = (s: { inputTokens: number | null; outputTokens: number | null; thinkingTokens: number | null }) => ({
    input: s.inputTokens ?? 0,
    output: s.outputTokens ?? 0,
    thinking: s.thinkingTokens ?? 0,
  });
  const cost = new Map(perProject.map((p) => [p.projectId, { cost: p._sum.costUsd ?? 0, calls: p._count }]));
  return {
    cards: { today, week, month, all },
    daily,
    byFeature: byFeature.map((f) => ({ key: f.feature, cost: f._sum.costUsd ?? 0, calls: f._count, tokens: tokens(f._sum) })).sort((a, b) => b.cost - a.cost),
    byModel: byModel.map((m) => ({ key: m.model, cost: m._sum.costUsd ?? 0, calls: m._count, tokens: tokens(m._sum) })).sort((a, b) => b.cost - a.cost),
    projects: projects.map((p) => ({ id: p.id, title: p.title, createdAt: p.createdAt.toISOString(), status: p.status, ...(cost.get(p.id) ?? { cost: 0, calls: 0 }) })),
    unattributed: cost.get(null) ?? { cost: 0, calls: 0 },
    budget,
  };
}

export type UsageDashboard = Awaited<ReturnType<typeof usageDashboard>>;
