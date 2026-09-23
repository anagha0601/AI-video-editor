import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOwnedProject, jsonError, serializeProject, withUser } from "@/lib/api";
import { estimateDuration } from "@/lib/timing";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return withUser(async (user) => {
    const project = await getOwnedProject(user.id, (await params).id);
    if (!project) return jsonError("Not found", 404);
    return NextResponse.json({ project: serializeProject(project) });
  });
}

const SceneSchema = z.object({
  id: z.string(),
  narration: z.string().max(600),
  onScreen: z.string().max(120),
  visualQuery: z.string().max(120),
  durationSec: z.number().min(1).max(20).optional(),
  mediaUrl: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  palette: z.tuple([z.string(), z.string()]),
  emoji: z.string().optional(),
});

const PatchBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  caption: z.string().max(2200).optional(),
  hashtags: z.array(z.string()).max(30).optional(),
  status: z.enum(["draft", "ready", "exported"]).optional(),
  scenes: z.array(SceneSchema).min(1).max(20).optional(),
  assetIds: z.array(z.string()).max(40).optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  return withUser(async (user) => {
    const id = (await params).id;
    const project = await getOwnedProject(user.id, id);
    if (!project) return jsonError("Not found", 404);
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");
    const { scenes, hashtags, assetIds, ...rest } = parsed.data;

    // Keep each scene's timing in sync with its narration after edits.
    const normalized = scenes?.map((s) => ({ ...s, durationSec: estimateDuration(s.narration) }));
    const updated = await db.project.update({
      where: { id },
      data: {
        ...rest,
        ...(assetIds ? { assetIds: JSON.stringify(assetIds) } : {}),
        ...(hashtags ? { hashtags: hashtags.map((h) => h.replace(/^#/, "")).join(" ") } : {}),
        ...(normalized
          ? {
              scenes: JSON.stringify(normalized),
              hook: normalized[0].narration,
              durationSec: Math.round(normalized.reduce((a, s) => a + s.durationSec, 0)),
            }
          : {}),
      },
    });
    return NextResponse.json({ project: serializeProject(updated) });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return withUser(async (user) => {
    const id = (await params).id;
    const project = await getOwnedProject(user.id, id);
    if (!project) return jsonError("Not found", 404);
    await db.project.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
