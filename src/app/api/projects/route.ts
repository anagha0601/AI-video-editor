import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, serializeProject, withUser } from "@/lib/api";
import { generateStoryboard } from "@/lib/ai";
import { findStockImage } from "@/lib/media";
import { canCreate } from "@/lib/usage";
import { isPro } from "@/lib/plans";
import type { Scene } from "@/lib/types";

export const maxDuration = 60;

export async function GET(req: Request) {
  return withUser(async (user) => {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    const status = url.searchParams.get("status");
    const style = url.searchParams.get("style");
    const sort = url.searchParams.get("sort") === "oldest" ? "asc" : "desc";

    const projects = await db.project.findMany({
      where: {
        userId: user.id,
        ...(status && status !== "all" ? { status } : {}),
        ...(style && style !== "all" ? { style } : {}),
        ...(q
          ? { OR: [{ title: { contains: q } }, { prompt: { contains: q } }, { caption: { contains: q } }] }
          : {}),
      },
      orderBy: { createdAt: sort },
      take: 100,
    });
    return NextResponse.json({ projects: projects.map(serializeProject) });
  });
}

const CreateBody = z.object({
  prompt: z.string().trim().min(3, "Tell us what the video is about").max(5000),
  mode: z.enum(["idea", "script"]).default("idea"),
  style: z.enum(["educational", "storytelling", "promo", "motivational", "listicle"]).default("educational"),
  aspect: z.enum(["9:16", "1:1", "16:9"]).default("9:16"),
  targetSeconds: z.number().int().min(15).max(90).default(30),
});

export async function POST(req: Request) {
  return withUser(async (user) => {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid input");
    const input = parsed.data;

    if (input.aspect !== "9:16" && !isPro(user.plan)) {
      return jsonError("Square and landscape formats are a Pro feature", 402, { upgrade: true });
    }
    const quota = await canCreate(user);
    if (!quota.ok) {
      return jsonError(`You've used all ${quota.limit} free videos this month. Upgrade to Pro for unlimited videos.`, 402, {
        upgrade: true,
      });
    }

    const board = await generateStoryboard(input);
    const scenes: Scene[] = await Promise.all(
      board.scenes.map(async (s) => {
        const img = await findStockImage(s.visualQuery, input.aspect);
        return { ...s, mediaUrl: img?.url ?? null, credit: img?.credit ?? null };
      }),
    );

    const project = await db.project.create({
      data: {
        userId: user.id,
        title: board.title || input.prompt.slice(0, 60),
        prompt: input.prompt,
        mode: input.mode,
        style: input.style,
        aspect: input.aspect,
        status: "ready",
        hook: board.hook,
        caption: board.caption,
        hashtags: board.hashtags.join(" "),
        scenes: JSON.stringify(scenes),
        durationSec: Math.round(scenes.reduce((a, s) => a + s.durationSec, 0)),
      },
    });
    return NextResponse.json({ project: serializeProject(project) }, { status: 201 });
  });
}
