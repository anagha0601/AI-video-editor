import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "./auth";
import { db } from "./db";
import type { Scene } from "./types";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function withUser(
  handler: (user: CurrentUser) => Promise<Response>,
): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return jsonError("Not signed in", 401);
  try {
    return await handler(user);
  } catch (err) {
    console.error(err);
    return jsonError(err instanceof Error ? err.message : "Something went wrong", 500);
  }
}

export async function getOwnedProject(userId: string, id: string) {
  return db.project.findFirst({ where: { id, userId } });
}

export function serializeProject(p: NonNullable<Awaited<ReturnType<typeof getOwnedProject>>>) {
  return {
    ...p,
    scenes: JSON.parse(p.scenes) as Scene[],
    hashtags: p.hashtags ? p.hashtags.split(" ") : [],
    assetIds: JSON.parse(p.assetIds) as string[],
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export type ProjectDTO = ReturnType<typeof serializeProject>;
