import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOwnedProject, jsonError, serializeProject, withUser } from "@/lib/api";
import { generateStoryboard } from "@/lib/ai";
import { findStockImage } from "@/lib/media";
import type { Scene, VideoStyle } from "@/lib/types";

export const maxDuration = 60;

// Re-runs the AI on the original prompt. Doesn't count against the monthly quota.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (user) => {
    const id = (await params).id;
    const project = await getOwnedProject(user.id, id);
    if (!project) return jsonError("Not found", 404);

    const current = JSON.parse(project.scenes) as Scene[];
    const board = await generateStoryboard({
      prompt: project.prompt,
      mode: project.mode as "idea" | "script",
      style: project.style as VideoStyle,
      targetSeconds: Math.max(15, Math.min(90, project.durationSec || 30)),
    });
    const scenes = await Promise.all(
      board.scenes.map(async (s) => {
        const img = await findStockImage(s.visualQuery, project.aspect);
        return { ...s, mediaUrl: img?.url ?? null, credit: img?.credit ?? null };
      }),
    );

    const updated = await db.project.update({
      where: { id },
      data: {
        hook: board.hook,
        caption: board.caption,
        hashtags: board.hashtags.join(" "),
        scenes: JSON.stringify(scenes.length ? scenes : current),
        durationSec: Math.round(scenes.reduce((a, s) => a + s.durationSec, 0)),
        status: "ready",
      },
    });
    return NextResponse.json({ project: serializeProject(updated) });
  });
}
