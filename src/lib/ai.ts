import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError, GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { z } from "zod/v4";
import type { Scene, VideoStyle } from "./types";
import { estimateDuration } from "./timing";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

const StoryboardSchema = z.object({
  title: z.string().describe("Short internal title for the project, max 60 chars"),
  hook: z.string().describe("The first spoken line - a scroll-stopping hook"),
  caption: z.string().describe("Social media post caption, 1-2 sentences, no hashtags"),
  hashtags: z.array(z.string()).describe("5-8 relevant hashtags without the # symbol"),
  scenes: z
    .array(
      z.object({
        narration: z.string().describe("Voiceover line for this scene, 8-25 words, conversational"),
        onScreen: z.string().describe("Bold on-screen headline, 2-6 words"),
        visualQuery: z.string().describe("2-4 word stock-footage search query, concrete and visual"),
        emoji: z.string().describe("A single emoji that fits the scene"),
        photoIndex: z
          .number()
          .int()
          .describe("1-based number of the user photo to show in this scene, or 0 if the user attached no photos"),
      }),
    )
    .describe("4-8 scenes; the first scene narration IS the hook"),
});

export type StoryboardScene = Scene & { photoIndex?: number };

export type Storyboard = {
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  scenes: StoryboardScene[];
};

export type Photo = { mime: string; base64: string; video?: boolean }; // video = a clip's poster frame

export type GenerateInput = {
  prompt: string;
  mode: "idea" | "script";
  style: VideoStyle;
  targetSeconds: number;
  photos?: Photo[]; // user photos, in upload order
};

const PALETTES: [string, string][] = [
  ["#7c3aed", "#db2777"],
  ["#0ea5e9", "#6366f1"],
  ["#f97316", "#e11d48"],
  ["#10b981", "#0ea5e9"],
  ["#f59e0b", "#ef4444"],
  ["#8b5cf6", "#06b6d4"],
  ["#ec4899", "#f97316"],
  ["#14b8a6", "#6366f1"],
];

function toScenes(
  raw: { narration: string; onScreen: string; visualQuery: string; emoji?: string; photoIndex?: number }[],
): StoryboardScene[] {
  return raw.map((s, i) => ({
    id: crypto.randomUUID(),
    narration: s.narration.trim(),
    onScreen: s.onScreen.trim(),
    visualQuery: s.visualQuery.trim(),
    emoji: s.emoji,
    durationSec: estimateDuration(s.narration),
    palette: PALETTES[i % PALETTES.length],
    mediaUrl: null,
    credit: null,
    photoIndex: s.photoIndex,
  }));
}

// Makes sure every scene points at a real photo when photos exist, and that every
// photo is used at least once (models occasionally skip or repeat one).
function assignPhotos(scenes: StoryboardScene[], count: number): StoryboardScene[] {
  if (!count) return scenes.map((s) => ({ ...s, photoIndex: 0 }));
  const valid = (n?: number): n is number => typeof n === "number" && n >= 1 && n <= count;
  const used = new Set<number>();
  const firstPass = scenes.map((s) => {
    if (valid(s.photoIndex) && !used.has(s.photoIndex)) {
      used.add(s.photoIndex);
      return s;
    }
    return { ...s, photoIndex: undefined };
  });
  const unused = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !used.has(n));
  let cycle = 0;
  return firstPass.map((s, i) => {
    if (valid(s.photoIndex)) return s;
    const fromAi = scenes[i].photoIndex;
    const next = unused.shift() ?? (valid(fromAi) ? fromAi : (cycle++ % count) + 1);
    return { ...s, photoIndex: next };
  });
}

type Provider = "groq" | "gemini" | "claude" | "demo";

function provider(): Provider {
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "claude";
  return "demo";
}

export function aiEnabled() {
  return provider() !== "demo";
}

export function aiProviderLabel() {
  return { groq: "Groq", gemini: "Gemini", claude: "Claude", demo: "demo" }[provider()];
}

const SYSTEM = `You are a short-form video producer who writes viral TikTok / Reels / YouTube Shorts.
You turn an idea or a rough script into a tight storyboard: a voiceover split into scenes, each with an on-screen headline and a stock-footage search query.
Rules:
- The first scene must open with a hook that creates curiosity or tension within 2 seconds. No "Hey guys", no "In this video".
- One idea per scene. Short sentences. Spoken, natural rhythm. No stage directions in narration.
- End with a clear payoff or call to action.
- visualQuery must be something a stock library would actually have (e.g. "city night traffic", "woman running sunrise"), never abstract words.
- If the user provides a full script, keep their wording and meaning; only split it into scenes and tighten where needed.`;

function photoInstructions(photos: Photo[], canSee: boolean) {
  const count = photos.length;
  if (!count) return "";
  const clips = photos.flatMap((p, i) => (p.video ? [i + 1] : []));
  const clipNote = clips.length
    ? ` ${clips.length === 1 ? `Photo ${clips[0]} is` : `Photos ${clips.join(", ")} are`} the opening frame of a video clip the user filmed; treat ${clips.length === 1 ? "it" : "them"} as moving footage of that scene.`
    : "";
  const plural = count > 1 ? "s" : "";
  const see = canSee
    ? `The user attached ${count} photo${plural}, shown above in order as Photo 1..${count}. Build the video around them: write narration that matches what is actually in each photo, and never contradict what the photos show.`
    : `The user attached ${count} photo${plural} (you can't see them). Use them in upload order.`;
  return `\n\n${see}${clipNote}\nSet photoIndex on every scene to the photo it should show. Use every photo at least once. Make at least ${count} scenes (at most ${Math.max(8, count)}).`;
}

function userPrompt(input: GenerateInput, canSeePhotos = false) {
  const wordBudget = Math.round(input.targetSeconds * 2.6);
  const photos = photoInstructions(input.photos ?? [], canSeePhotos);
  return (input.mode === "script"
    ? `Here is my script. Split it into scenes for a ${input.style} short video.\n\n<script>\n${input.prompt}\n</script>`
    : `Create a ${input.style} short video (~${input.targetSeconds} seconds, about ${wordBudget} spoken words total) about:\n\n<idea>\n${input.prompt}\n</idea>`) + photos;
}

function toStoryboard(parsed: z.infer<typeof StoryboardSchema>): Storyboard {
  if (parsed.scenes.length === 0) throw new Error("The AI returned an empty storyboard. Please try again.");
  return {
    title: parsed.title.slice(0, 80),
    hook: parsed.hook,
    caption: parsed.caption,
    hashtags: parsed.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")),
    scenes: toScenes(parsed.scenes),
  };
}

export async function generateStoryboard(input: GenerateInput): Promise<Storyboard> {
  const board = await generateRaw(input);
  return { ...board, scenes: assignPhotos(board.scenes, input.photos?.length ?? 0) };
}

async function generateRaw(input: GenerateInput): Promise<Storyboard> {
  const p = provider();
  if (p === "demo") return demoStoryboard(input);
  if (p === "groq") return generateWithGroq(input);
  if (p === "gemini") return generateWithGemini(input);

  const client = new Anthropic();
  const user = userPrompt(input, true);
  const images = (input.photos ?? []).map((ph) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: ph.mime as "image/jpeg" | "image/png" | "image/webp",
      data: ph.base64,
    },
  }));

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: [...images, { type: "text", text: user }] }],
    output_config: { effort: "medium", format: betaZodOutputFormat(StoryboardSchema) },
    // Server-side refusal fallback: if the primary model declines, the API retries on a recommended model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to write this video. Try rephrasing your idea.");
  }
  if (!response.parsed_output) throw new Error("The AI returned an empty storyboard. Please try again.");
  return toStoryboard(response.parsed_output);
}

// Free tiers often return transient 5xx "overloaded" errors; retry those twice with backoff.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0;
      if (status < 500 || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

function parseStoryboardJson(text: string | null | undefined, name: string): Storyboard {
  if (!text) throw new Error(`${name} returned an empty response. Please try again.`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${name} returned malformed JSON. Please try again.`);
  }
  const parsed = StoryboardSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${name}'s storyboard didn't match the expected format. Please try again.`);
  return toStoryboard(parsed.data);
}

// Groq (fast, generous free tier). JSON mode with the schema in the prompt, validated with zod.
async function generateWithGroq(input: GenerateInput): Promise<Storyboard> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const schema = JSON.stringify(z.toJSONSchema(StoryboardSchema));
  try {
    const res = await withRetry(() => groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `${SYSTEM}\n\nRespond with only a JSON object that matches this JSON Schema:\n${schema}`,
        },
        { role: "user", content: userPrompt(input) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
    }));
    return parseStoryboardJson(res.choices[0]?.message?.content, "Groq");
  } catch (err) {
    if (err instanceof Groq.APIError) {
      if (err.status === 429) throw new Error("Groq free-tier rate limit hit. Wait a minute and try again.");
      if ((err.status ?? 0) >= 500) throw new Error("Groq is overloaded right now. Please try again in a moment.");
      if (err.status === 401) throw new Error("Groq rejected the API key. Check GROQ_API_KEY in .env.");
      if (err.status === 404) throw new Error("Groq model not found. Run `npm run check:ai` to see available models.");
      if (err.status === 400) throw new Error(`Groq rejected the request: ${err.message}`);
    }
    throw err;
  }
}

// Google Gemini (works on the free tier). JSON mode + schema, validated with zod.
async function generateWithGemini(input: GenerateInput): Promise<Storyboard> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const schema = z.toJSONSchema(StoryboardSchema) as Record<string, unknown>;
  delete schema.$schema; // Gemini rejects the meta-schema key
  let text: string | undefined;
  try {
    const res = await withRetry(() => ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
      contents: [
        {
          role: "user",
          parts: [
            ...(input.photos ?? []).map((ph) => ({ inlineData: { mimeType: ph.mime, data: ph.base64 } })),
            { text: userPrompt(input, true) },
          ],
        },
      ],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
      },
    }));
    text = res.text;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 429) throw new Error("Gemini free-tier rate limit hit. Wait a minute and try again.");
      if (err.status >= 500) throw new Error("Gemini is overloaded right now. Please try again in a moment.");
      if (err.status === 400 || err.status === 403) throw new Error(`Gemini rejected the request: ${err.message}`);
      if (err.status === 404) throw new Error("Gemini model not found. Set GEMINI_MODEL to a model your key can use.");
    }
    throw err;
  }
  return parseStoryboardJson(text, "Gemini");
}

// Offline fallback so the whole product loop works without an API key.
function demoStoryboard(input: GenerateInput): Storyboard {
  const text = input.prompt.trim();
  let lines: string[];
  if (input.mode === "script") {
    lines = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((l) => l.trim())
      .filter(Boolean);
  } else {
    const topic = text.replace(/[.!?]+$/, "");
    lines = [
      `Most people get ${topic} completely wrong. Here's what actually works.`,
      `First, forget everything you've heard. Start with the simplest version of it.`,
      `Second, do it every day for just five minutes. Consistency beats intensity.`,
      `Third, track one number. What gets measured gets better.`,
      `Try this for one week and watch what happens. Follow for more.`,
    ];
  }
  // Merge very short lines so each scene has enough narration.
  const merged: string[] = [];
  for (const l of lines) {
    const last = merged[merged.length - 1];
    if (last && last.split(/\s+/).length < 7) merged[merged.length - 1] = `${last} ${l}`;
    else merged.push(l);
  }
  const words = (s: string) =>
    s
      .replace(/[^\w\s']/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 3);
  const emojis = ["🔥", "💡", "🚀", "✅", "🎯", "⚡", "📈", "✨"];
  const photoCount = input.photos?.length ?? 0;
  while (merged.length < Math.min(photoCount, 12)) merged.push("And here is another moment worth seeing.");
  const scenes = merged.slice(0, Math.max(8, photoCount)).map((narration, i) => {
    const w = words(narration);
    return {
      narration,
      onScreen: w.slice(0, 4).join(" ") || "Watch this",
      visualQuery: w.slice(-2).join(" ") || "abstract light",
      emoji: emojis[i % emojis.length],
      photoIndex: 0,
    };
  });
  const title = text.split(/\s+/).slice(0, 8).join(" ");
  return {
    title: title.length > 60 ? title.slice(0, 57) + "..." : title,
    hook: scenes[0]?.narration ?? "",
    caption: `${title} — save this for later.`,
    hashtags: ["shorts", "tips", "learnontiktok", "viral", "howto"],
    scenes: toScenes(scenes),
  };
}
