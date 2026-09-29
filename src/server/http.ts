import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUserId() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new HttpError(401, "Please sign in");
  return id;
}

export async function ownedProject(id: string, userId: string) {
  const p = await prisma.project.findFirst({ where: { id, userId } });
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

/** Wrap a route handler: JSON errors, HttpError status codes. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A) => {
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error(err);
      return NextResponse.json({ error: (err as Error).message || "Something went wrong" }, { status: 500 });
    }
  };
}

export type Ctx<P> = { params: Promise<P> };
