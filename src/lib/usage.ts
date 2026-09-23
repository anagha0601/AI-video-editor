import "server-only";
import { db } from "./db";
import { FREE_MONTHLY_VIDEOS, isPro } from "./plans";

export async function monthlyUsage(userId: string) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return db.project.count({ where: { userId, createdAt: { gte: start } } });
}

export async function canCreate(user: { id: string; plan: string }) {
  if (isPro(user.plan)) return { ok: true as const, used: 0, limit: Infinity };
  const used = await monthlyUsage(user.id);
  return { ok: used < FREE_MONTHLY_VIDEOS, used, limit: FREE_MONTHLY_VIDEOS };
}
