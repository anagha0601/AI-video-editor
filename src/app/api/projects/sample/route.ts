import { z } from "zod";
import sample from "@/data/sample-transcript.json";
import { prisma } from "@/server/db";
import { maybeBuildFirstCut } from "@/server/firstcut";
import { requireUserId, route } from "@/server/http";

export const maxDuration = 60;

const body = z.object({ aspect: z.enum(["9:16", "16:9", "1:1"]).default("9:16") });

/**
 * Sample project: a bundled narration with a precomputed whisper transcript, so it
 * goes straight to the first-cut builder (no worker needed to try the editor).
 */
export const POST = route(async (req: Request) => {
  const userId = await requireUserId();
  const { aspect } = body.parse(await req.json().catch(() => ({})));
  const asset = await prisma.mediaAsset.create({
    data: {
      userId,
      type: "audio",
      source: "sample",
      url: "/sample/voice.m4a",
      name: "Sample narration",
      mime: "audio/mp4",
      duration: sample.duration,
      tags: ["voiceover", "sample"],
      meta: { peaks: sample.peaks, peaksPerSec: sample.peaksPerSec },
    },
  });
  const project = await prisma.project.create({
    data: {
      userId,
      title: "Sample: Do less, on purpose",
      aspect,
      isSample: true,
      status: "transcribed",
      duration: sample.duration,
      voice: {
        create: {
          assetId: asset.id,
          url: asset.url,
          duration: sample.duration,
          language: sample.language,
          status: "done",
          transcriptJson: { language: sample.language, duration: sample.duration, words: sample.words },
        },
      },
    },
  });
  await maybeBuildFirstCut(project.id);
  return { projectId: project.id };
});
