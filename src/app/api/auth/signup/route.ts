import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { jsonError } from "@/lib/api";

const Body = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");
  const { email, password, name } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return jsonError("An account with that email already exists", 409);

  const user = await db.user.create({
    data: { email, name: name || null, passwordHash: await hashPassword(password) },
  });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
