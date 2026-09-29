import "server-only";
import type { Prisma } from "@prisma/client";
import { emptyTimeline, newAudioClip, newTextClip, newVisualClip } from "@/lib/timeline/factory";
import type { Aspect, Timeline, VisualClip, VoiceTrack as VoiceTrackT, VideoTrack, TextTrack, Word } from "@/lib/timeline/types";
import { prisma } from "./db";
import { splitScenes } from "./scenes";
import { clipFromAsset, pickVisual } from "./visuals";

type Transcript = { words: Word[]; duration?: number; language?: string };

/** transcript -> Gemini scenes -> matched visuals -> timeline JSON (the "first cut"). */
export async function buildFirstCut(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { voice: true } });
  const voice = project.voice;
  if (!voice?.transcriptJson) throw new Error("No transcript yet");
  const transcript = voice.transcriptJson as unknown as Transcript;
  const words = transcript.words ?? [];
  const aspect = project.aspect as Aspect;
  const duration = voice.duration ?? transcript.duration ?? (words.length ? words[words.length - 1].end + 0.5 : 5);

  const split = await splitScenes(words, duration, aspect);
  const library = await prisma.mediaAsset.findMany({
    where: { userId: project.userId, type: { in: ["video", "image"] } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const used = new Set<string>();
  const visuals: VisualClip[] = [];
  // Sequential on purpose: keeps "used" consistent so scenes don't repeat a shot.
  for (let i = 0; i < split.scenes.length; i++) {
    const s = split.scenes[i];
    // A video shorter than its scene gets followed by another shot until the scene is filled.
    let cursor = s.start;
    for (let shot = 0; shot < 3 && s.end - cursor > 0.1; shot++) {
      const dur = s.end - cursor;
      const pick = await pickVisual({
        userId: project.userId,
        library,
        keywords: s.visual_keywords,
        query: s.query,
        duration: dur,
        aspect,
        used,
        index: i + shot,
      });
      const extra = { scene: i + 1, keywords: s.visual_keywords, name: `Scene ${i + 1}` };
      const clip = pick.asset
        ? clipFromAsset(pick.asset, cursor, dur, { ...extra, name: `Scene ${i + 1} · ${s.query || pick.asset.name}` })
        : newVisualClip({ type: "color", start: cursor, duration: dur, colors: pick.colors, ...extra });
      if (shot === 2) clip.duration = dur; // last resort: hold the final frame
      visuals.push(clip);
      cursor += clip.duration;
    }
  }
  const tl: Timeline = emptyTimeline(aspect);
  const assetId = voice.assetId ?? voice.id;
  tl.transcripts[assetId] = { words };
  (tl.tracks.find((t) => t.kind === "video") as VideoTrack).clips = visuals;
  (tl.tracks.find((t) => t.kind === "voice") as VoiceTrackT).clips = [
    newAudioClip({ src: voice.url, assetId, name: "Voiceover", start: 0, duration, srcDuration: duration }),
  ];
  if (split.title && split.title !== "Untitled") {
    const title = newTextClip("title", 0, aspect, split.title);
    title.duration = Math.min(3, Math.max(1.5, split.scenes[0]?.end ?? 3));
    (tl.tracks.find((t) => t.kind === "text") as TextTrack).clips = [title];
  }

  const firstThumb = visuals.find((v) => v.thumb)?.thumb ?? null;
  const json = tl as unknown as Prisma.InputJsonValue;
  await prisma.$transaction([
    prisma.timeline.upsert({
      where: { projectId },
      create: { projectId, json },
      update: { json, revision: { increment: 1 } },
    }),
    prisma.timelineVersion.create({ data: { projectId, name: "First cut", kind: "first-cut", json } }),
    prisma.project.update({
      where: { id: projectId },
      data: {
        status: "ready",
        statusMessage: split.ai ? null : "Built without Gemini (heuristic scenes)",
        duration,
        thumbnailUrl: project.thumbnailUrl ?? firstThumb,
        title: project.title === "Untitled video" && split.title ? split.title.slice(0, 80) : project.title,
      },
    }),
  ]);
  return tl;
}

/**
 * Called from status polling: whichever request first sees a finished transcript
 * claims the build (stale claims older than 2 minutes are retried).
 */
export async function maybeBuildFirstCut(projectId: string) {
  const claimed = await prisma.project.updateMany({
    where: {
      id: projectId,
      OR: [{ status: "transcribed" }, { status: "building", buildStartedAt: { lt: new Date(Date.now() - 120_000) } }],
    },
    data: { status: "building", buildStartedAt: new Date() },
  });
  if (!claimed.count) return false;
  try {
    await buildFirstCut(projectId);
  } catch (err) {
    console.error("[first-cut] failed", err);
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "failed", statusMessage: `Couldn't build the first cut: ${(err as Error).message}`.slice(0, 300) },
    });
  }
  return true;
}
