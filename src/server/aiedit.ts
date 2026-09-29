import "server-only";
import type { MediaAsset } from "@prisma/client";
import { describeForAi, type AiOp, type ResolvedVisual } from "@/lib/timeline/ai";
import { clipEnd, findClip } from "@/lib/timeline/derive";
import type { Timeline, VisualClip } from "@/lib/timeline/types";
import { prisma } from "./db";
import { geminiJson, hasGemini } from "./gemini";
import { pickVisual } from "./visuals";
import { generateImageAsset } from "./generate";

const OP_NAMES = [
  "cut_pauses",
  "set_filters",
  "set_clip",
  "replace_visual",
  "add_text",
  "update_text",
  "delete_clips",
  "set_captions",
  "set_music",
  "move_clip",
  "trim_clip",
  "split",
  "remove_range",
];

// One schema variant per op (anyOf) so each op's essential fields are required —
// with a single flat schema the model tends to drop optional fields like `text`.
const F = {
  clipIds: { type: "array", items: { type: "string" } },
  brightness: { type: "number" },
  contrast: { type: "number" },
  saturation: { type: "number" },
  preset: { type: "string", enum: ["none", "warm", "cool", "bw"] },
  speed: { type: "number" },
  volume: { type: "number" },
  muted: { type: "boolean" },
  fadeIn: { type: "number" },
  fadeOut: { type: "number" },
  kenBurns: { type: "string", enum: ["in", "out", "left", "right", "up", "down", "none"] },
  transition: { type: "string", enum: ["cut", "crossfade", "slide", "zoom"] },
  transitionDuration: { type: "number" },
  query: { type: "string" },
  text: { type: "string" },
  textPreset: { type: "string", enum: ["title", "lower-third", "headline"] },
  color: { type: "string" },
  size: { type: "number" },
  font: { type: "string", enum: ["inter", "montserrat", "bebas", "playfair", "marker"] },
  x: { type: "number" },
  y: { type: "number" },
  animIn: { type: "string", enum: ["none", "fade", "slide-up", "pop"] },
  animOut: { type: "string", enum: ["none", "fade", "slide-down", "pop"] },
  enabled: { type: "boolean" },
  captionStyle: { type: "string", enum: ["bold", "karaoke", "minimal", "boxed"] },
  duck: { type: "boolean" },
  duckLevel: { type: "number" },
  start: { type: "number" },
  end: { type: "number" },
  duration: { type: "number" },
  time: { type: "number" },
  minGap: { type: "number" },
} as const;
type Field = keyof typeof F;

function variant(op: string, required: Field[], optional: Field[] = []) {
  const props: Record<string, unknown> = { op: { type: "string", enum: [op] }, why: { type: "string" } };
  for (const f of [...required, ...optional]) props[f] = F[f];
  return { type: "object", properties: props, required: ["op", "why", ...required] };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    ops: {
      type: "array",
      items: {
        anyOf: [
          variant("cut_pauses", [], ["minGap"]),
          variant("set_filters", ["clipIds"], ["brightness", "contrast", "saturation", "preset"]),
          variant("set_clip", ["clipIds"], ["speed", "volume", "muted", "fadeIn", "fadeOut", "kenBurns", "transition", "transitionDuration"]),
          variant("replace_visual", ["clipIds", "query"]),
          variant("add_text", ["text", "textPreset", "start"], ["duration", "color", "size", "font", "x", "y", "animIn", "animOut"]),
          variant("update_text", ["clipIds"], ["text", "color", "size", "font", "x", "y", "animIn", "animOut"]),
          variant("delete_clips", ["clipIds"]),
          variant("set_captions", [], ["enabled", "captionStyle", "y", "size"]),
          variant("set_music", [], ["volume", "duck", "duckLevel"]),
          variant("move_clip", ["clipIds", "start"]),
          variant("trim_clip", ["clipIds"], ["start", "end"]),
          variant("split", ["time"], ["clipIds"]),
          variant("remove_range", ["start", "end"]),
        ],
      },
    },
  },
  required: ["summary", "ops"],
};

const SYSTEM = `You edit short videos by emitting operations on a timeline. Times are seconds.
Operations (only use the fields each needs):
- cut_pauses {minGap?}: remove pauses between spoken words longer than minGap (default 0.7) from the whole video.
- set_filters {clipIds, brightness?, contrast?, saturation?, preset?}: multipliers where 1 = unchanged (brightness/contrast 0.5-1.5, saturation 0-2). preset: none|warm|cool|bw. "Moodier" = contrast up ~1.2, saturation down ~0.75, brightness ~0.9, often cool. "Warmer/cozier" = warm preset.
- set_clip {clipIds, speed?, volume?, muted?, fadeIn?, fadeOut?, kenBurns?, transition?, transitionDuration?}: transition is how a clip enters from the previous one (cut|crossfade|slide|zoom).
- replace_visual {clipIds, query}: swap the visuals of clips for the user's media, stock footage or a newly AI-generated image. query = a short visual description (e.g. "calm beach at sunset, golden light").
- add_text {text, start, duration?, textPreset?, color?, size?, font?, y?, animIn?, animOut?}: always set textPreset: title (big title card), lower-third (name/tip bar near the bottom) or headline (mid-screen statement). A "title card at start" = add_text with textPreset title at start 0. add_text always needs text: use the user's words, or write a short (2-6 word) line that fits what is said at that moment — never placeholder text.
- update_text {clipIds, text?, color?, size?, font?, y?, animIn?, animOut?}
- delete_clips {clipIds}
- set_captions {enabled?, captionStyle?, y?, size?}: captionStyle bold|karaoke|minimal|boxed.
- set_music {volume?, duck?, duckLevel?}
- move_clip {clipIds:[id], start}; trim_clip {clipIds:[id], start?, end?}; split {time, clipIds?}; remove_range {start, end}.
Rules: refer only to clip ids that exist. "Scene N" means visual clips whose scene == N. Use keywords/name/said to find clips
("city clips" = visual clips whose keywords or name mention city/urban/street/buildings). Prefer the fewest ops that do exactly what was asked, and only include the fields an op uses.
If the request is impossible, return no ops and explain in summary. summary is one short sentence describing the change.`;

export async function planAiEdit(userId: string, tl: Timeline, command: string) {
  if (!hasGemini()) throw new Error("AI edits need GEMINI_API_KEY in the server environment.");
  const res = await geminiJson<{ summary: string; ops: (AiOp & { why?: string })[] }>({
    system: SYSTEM,
    parts: [{ text: `Timeline:\n${JSON.stringify(describeForAi(tl))}\n\nRequest: ${command}` }],
    schema: SCHEMA,
    temperature: 0.2,
  });
  const ops = (res.ops ?? []).filter((o) => OP_NAMES.includes(o.op));

  // Resolve replace_visual to concrete media now, so the client can preview/apply offline.
  let library: MediaAsset[] | null = null;
  const used = new Set<string>();
  for (const o of ops) {
    if (o.op !== "replace_visual" || !o.clipIds?.length) continue;
    library ??= await prisma.mediaAsset.findMany({ where: { userId, type: { in: ["video", "image"] } }, take: 500 });
    o.resolved = {};
    const words = (o.query ?? "").split(/\s+/).filter(Boolean);
    for (const [i, id] of o.clipIds.entries()) {
      const hit = findClip(tl, id);
      if (!hit || hit.clip.type === "text" || hit.clip.type === "audio") continue;
      const clip = hit.clip as VisualClip;
      const pick = await pickVisual({
        userId,
        library,
        keywords: words,
        query: o.query ?? "",
        duration: clipEnd(clip) - clip.start,
        aspect: tl.aspect,
        used,
        index: i,
      });
      // Nothing in the library/stock: generate the shot instead.
      const a = pick.asset ?? (hasGemini() ? await generateImageAsset(userId, o.query ?? "", tl.aspect, words).catch(() => null) : null);
      if (!a) continue;
      const r: ResolvedVisual = {
        type: a.type === "video" ? "video" : "image",
        assetId: a.id,
        src: a.url,
        thumb: a.thumbUrl ?? a.url,
        name: `${clip.scene ? `Scene ${clip.scene} · ` : ""}${o.query}`,
        srcDuration: a.duration,
        srcWidth: a.width,
        srcHeight: a.height,
        hasAudio: ((a.meta ?? {}) as { hasAudio?: boolean }).hasAudio ?? a.type === "video",
        muted: a.source === "pexels" ? true : clip.muted,
        keywords: words,
      };
      o.resolved[id] = r;
    }
  }
  const unresolved = ops.some((o) => o.op === "replace_visual" && o.clipIds?.length && !Object.keys(o.resolved ?? {}).length);
  const summary = unresolved
    ? `${res.summary} (No matching footage found — upload tagged media or set PEXELS_API_KEY.)`
    : res.summary;
  return { summary, ops };
}
