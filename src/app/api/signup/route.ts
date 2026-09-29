import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/server/db";
import { HttpError, route } from "@/server/http";

const body = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export const POST = route(async (req: Request) => {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid details");
  const { email, password, name } = parsed.data;
  if (await prisma.user.findUnique({ where: { email } })) throw new HttpError(409, "An account with that email already exists");
  await prisma.user.create({ data: { email, name: name || null, passwordHash: await bcrypt.hash(password, 10) } });
  return { ok: true };
});
