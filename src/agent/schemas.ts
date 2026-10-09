// Schemas for the JSON files Claude writes into the project folder. The app only
// ever reads these files (never chat text); the runner validates them after each
// run and resumes the session with the errors when one doesn't match.
import { z } from "zod";

const num = z.number().finite();

// ---------------------------------------------------------------- selftest
export const mediaCheckSchema = z.object({
  files: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      kind: z.enum(["video", "audio", "image"]),
      durationSec: num.nonnegative().nullable(),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
      fps: num.positive().nullable(),
      hasAudio: z.boolean(),
      orientation: z.enum(["vertical", "horizontal", "square"]).nullable(),
    }),
  ),
  summary: z.string().min(1),
});
export type MediaCheck = z.infer<typeof mediaCheckSchema>;

// ---------------------------------------------------------------- ai_edit
// Mirrors AiOp in src/lib/timeline/ai.ts; replace_visual is resolved to library media server-side.
const OP_REQUIRED = {
  cut_pauses: [],
  set_filters: ["clipIds"],
  set_clip: ["clipIds"],
  replace_visual: ["clipIds", "query"],
  add_text: ["text", "start"],
  update_text: ["clipIds"],
  delete_clips: ["clipIds"],
  set_captions: [],
  set_music: [],
  move_clip: ["clipIds", "start"],
  trim_clip: ["clipIds"],
  split: ["time"],
  remove_range: ["start", "end"],
} as const;
export const AI_OP_NAMES = Object.keys(OP_REQUIRED) as (keyof typeof OP_REQUIRED)[];

const aiOp = z
  .object({
    op: z.enum(AI_OP_NAMES as [keyof typeof OP_REQUIRED, ...(keyof typeof OP_REQUIRED)[]]),
    why: z.string().optional(),
    clipIds: z.array(z.string()).optional(),
    brightness: num.min(0.3).max(2).optional(),
    contrast: num.min(0.3).max(2).optional(),
    saturation: num.min(0).max(2).optional(),
    preset: z.enum(["none", "warm", "cool", "bw"]).optional(),
    speed: num.min(0.25).max(4).optional(),
    volume: num.min(0).max(2).optional(),
    muted: z.boolean().optional(),
    fadeIn: num.min(0).optional(),
    fadeOut: num.min(0).optional(),
    kenBurns: z.enum(["in", "out", "left", "right", "up", "down", "none"]).optional(),
    transition: z.enum(["cut", "crossfade", "slide", "zoom", "flash"]).optional(),
    transitionDuration: num.min(0).max(3).optional(),
    query: z.string().optional(),
    text: z.string().optional(),
    textPreset: z.enum(["title", "lower-third", "headline"]).optional(),
    color: z.string().optional(),
    size: num.positive().optional(),
    font: z.enum(["inter", "montserrat", "bebas", "playfair", "marker"]).optional(),
    x: num.optional(),
    y: num.optional(),
    animIn: z.enum(["none", "fade", "slide-up", "pop"]).optional(),
    animOut: z.enum(["none", "fade", "slide-down", "pop"]).optional(),
    enabled: z.boolean().optional(),
    captionStyle: z.enum(["bold", "karaoke", "minimal", "boxed"]).optional(),
    duck: z.boolean().optional(),
    duckLevel: num.min(0).max(1).optional(),
    start: num.min(0).optional(),
    end: num.min(0).optional(),
    duration: num.positive().optional(),
    time: num.min(0).optional(),
    minGap: num.positive().optional(),
  })
  .superRefine((o, ctx) => {
    for (const f of OP_REQUIRED[o.op]) {
      const v = (o as Record<string, unknown>)[f];
      if (v === undefined || (Array.isArray(v) && !v.length)) ctx.addIssue({ code: "custom", path: [f], message: `${o.op} needs ${f}` });
    }
  });

export const aiEditSchema = z.object({ summary: z.string().min(1), ops: z.array(aiOp) });
export type AiEditResult = z.infer<typeof aiEditSchema>;

// ---------------------------------------------------------------- enhance
// Mirrors Enhance in src/lib/timeline/types.ts (minus upscale, which only the user starts). Ranges are the
// safe envelope from worker/enhance.py; the analysis tool proposes well inside them.
const rgb = (lo: number, hi: number) => z.tuple([num.min(lo).max(hi), num.min(lo).max(hi), num.min(lo).max(hi)]);
export const enhanceSettingsSchema = z
  .object({
    stabilize: z.object({ on: z.boolean(), smoothing: z.number().int().min(1).max(60), maxShift: num.min(0).max(0.1), maxAngle: num.min(0).max(0.05) }).nullish(),
    denoise: z.object({ on: z.boolean(), method: z.enum(["hqdn3d", "nlmeans"]), strength: num.min(0).max(1) }).nullish(),
    sharpen: z.object({ on: z.boolean(), amount: num.min(0).max(0.8) }).nullish(),
    color: z.object({ on: z.boolean(), lo: num.min(0).max(0.2), hi: num.min(0.7).max(1), gamma: num.min(0.6).max(1.6), gains: rgb(0.85, 1.15) }).nullish(),
    match: z.object({ on: z.boolean(), gamma: num.min(0.8).max(1.25), gains: rgb(0.9, 1.1) }).nullish(),
  })
  .strict();
export const enhanceResultSchema = z.object({
  summary: z.string().min(1),
  clips: z.array(
    z.object({
      clipId: z.string(),
      settings: enhanceSettingsSchema,
      review: z.object({ ok: z.boolean(), notes: z.string() }),
    }),
  ),
});
export type EnhanceResult = z.infer<typeof enhanceResultSchema>;

// ---------------------------------------------------------------- edit modes (plan.json)
// Claude writes plan.json; the user reviews/edits it; src/server/modes.ts builds the timeline from it.
// All times are SOURCE seconds of the referenced input (sourceId = MediaAsset id), on word boundaries.
const t = num.min(0);
const captionsPlan = z.object({
  y: num.min(0.14).max(0.79), // caption centre as a fraction of the frame height: inside the safe zone, off the face
  style: z.enum(["bold", "karaoke", "minimal", "boxed"]),
  why: z.string().optional(),
});
const face = { faceX: num.min(0).max(1), faceY: num.min(0).max(1) }; // face centre, fraction of the source frame
const enhanceBySource = z.record(z.string(), enhanceSettingsSchema).optional(); // from tools/enhance.py analyze
const span = { in: t, out: t };
const checkSpan = (o: { in: number; out: number }, ctx: z.RefinementCtx) => {
  if (o.out <= o.in) ctx.addIssue({ code: "custom", path: ["out"], message: "out must be after in" });
};

export const talkingHeadPlan = z.object({
  summary: z.string().min(1),
  script: z.string(), // the cleaned script, exactly the words that stay
  sources: z.array(z.object({ id: z.string(), ...face })).min(1),
  segments: z.array(z.object({ sourceId: z.string(), ...span, text: z.string(), include: z.boolean().default(true) }).superRefine(checkSpan)).min(1),
  removed: z.array(z.object({ sourceId: z.string(), start: t, end: t, text: z.string(), reason: z.string() })),
  captions: captionsPlan,
  hook: z.object({ text: z.string().min(1), duration: num.min(1).max(6) }).nullish(),
  enhance: enhanceBySource,
});

const take = z.object({
  sourceId: z.string(),
  ...span,
  score: num.min(0).max(10),
  scores: z.object({ delivery: num, audio: num, framing: num, focus: num, lighting: num }).partial().optional(),
  note: z.string().optional(),
});
export const bestTakePlan = z.object({
  summary: z.string().min(1),
  script: z.string(),
  sources: z.array(z.object({ id: z.string(), ...face, gainDb: num.min(-12).max(12), notes: z.string().optional() })).min(1),
  lines: z.array(z.object({ text: z.string(), chosen: take, alternatives: z.array(take), why: z.string() })).min(1),
  captions: captionsPlan,
  enhance: enhanceBySource,
});

export const voiceoverPlan = z.object({
  summary: z.string().min(1),
  voiceId: z.string(),
  script: z.string(),
  broll: z.array(z.object({ id: z.string(), shows: z.string(), quality: z.string(), best: z.array(z.object({ ...span, why: z.string() })) })),
  // contiguous over the voice: start/end are VOICE seconds; sourceId = a b-roll id, or voiceId to cut back to the face
  segments: z.array(z.object({ start: t, end: t, text: z.string(), sourceId: z.string(), in: t, why: z.string() })).min(1),
  face: z.object(face).nullish(),
  captions: captionsPlan,
  music: z.object({ sourceId: z.string(), volume: num.min(0).max(1.5) }).nullish(),
  enhance: enhanceBySource,
});

export const musicPlan = z.object({
  summary: z.string().min(1),
  musicId: z.string().nullish(), // an input asset id, or
  musicFile: z.string().nullish(), // a file downloaded into the project folder (relative path, e.g. edit/music.mp3)
  musicStart: t, // second of the song the reel starts at (tell the user: it is the IG start point)
  shots: z
    .array(
      z.object({
        sourceId: z.string(),
        ...span,
        start: t, // reel time
        end: t,
        zoom: num.min(1).max(1.4).default(1),
        cx: num.min(0).max(1).default(0.5),
        cy: num.min(0).max(1).default(0.5),
        grade: z.enum(["grey", "bw", "warm"]).nullish(),
        transition: z.enum(["cut", "flash", "zoom", "slide", "crossfade"]).nullish(), // how this shot enters; null = automatic
        why: z.string(),
      }),
    )
    .min(1),
  texts: z.array(z.object({ text: z.string().min(1), start: t, end: t, y: num.min(0.14).max(0.79), accent: z.boolean().optional() })),
  // beat effects the builder adds on the music's beats (src/lib/timeline/beatfx.ts): zoom punches, drop shake/flash, transitions
  energy: z.enum(["subtle", "punchy", "hype"]).nullish(), // null/missing = punchy
  enhance: enhanceBySource,
});

export const autoClipPlan = z.object({
  summary: z.string().min(1),
  sourceId: z.string(),
  ...face,
  clips: z
    .array(z.object({ title: z.string().min(1), start: t, end: t, hook: z.string(), why: z.string(), score: num.min(0).max(10), include: z.boolean().default(true) }))
    .min(1),
  captions: captionsPlan,
});

export const PLAN_SCHEMAS = {
  talking_head: talkingHeadPlan,
  best_take: bestTakePlan,
  voiceover_broll: voiceoverPlan,
  music: musicPlan,
  auto_clip: autoClipPlan,
} as const;
export type PlanMode = keyof typeof PLAN_SCHEMAS;
export type TalkingHeadPlan = z.infer<typeof talkingHeadPlan>;
export type BestTakePlan = z.infer<typeof bestTakePlan>;
export type VoiceoverPlan = z.infer<typeof voiceoverPlan>;
export type MusicPlan = z.infer<typeof musicPlan>;
export type AutoClipPlan = z.infer<typeof autoClipPlan>;

// ---------------------------------------------------------------- registry
export const SCHEMAS = {
  "media-check": mediaCheckSchema,
  "ai-edit": aiEditSchema,
  enhance: enhanceResultSchema,
  "plan-talking_head": talkingHeadPlan,
  "plan-best_take": bestTakePlan,
  "plan-voiceover_broll": voiceoverPlan,
  "plan-music": musicPlan,
  "plan-auto_clip": autoClipPlan,
} as const;
export type SchemaName = keyof typeof SCHEMAS;

/** Validate a result file's parsed JSON; returns readable error lines on failure. */
export function validateResult(name: string, data: unknown): { ok: true } | { ok: false; errors: string[] } {
  const schema = SCHEMAS[name as SchemaName];
  if (!schema) return { ok: false, errors: [`Unknown schema "${name}"`] };
  const r = schema.safeParse(data);
  if (r.success) return { ok: true };
  return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}
