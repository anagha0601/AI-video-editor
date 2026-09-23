import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError, GoogleGenAI } from "@google/genai";
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
      }),
    )
    .describe("4-8 scenes; the first scene narration IS the hook"),
});

export type Storyboard = {
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  scenes: Scene[];
};

export type GenerateInput = {
  prompt: string;
  mode: "idea" | "script";
  style: VideoStyle;
  targetSeconds: number;
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

function toScenes(raw: { narration: string; onScreen: string; visualQuery: string; emoji?: string }[]): Scene[] {
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
  }));
}

type Provider = "gemini" | "claude" | "demo";

function provider(): Provider {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) return "claude";
  return "demo";
}

export function aiEnabled() {
  return provider() !== "demo";
}

export function aiProviderLabel() {
  return { gemini: "Gemini", claude: "Claude", demo: "demo" }[provider()];
}

const SYSTEM = `You are a short-form video producer who writes viral TikTok / Reels / YouTube Shorts.
You turn an idea or a rough script into a tight storyboard: a voiceover split into scenes, each with an on-screen headline and a stock-footage search query.
Rules:
- The first scene must open with a hook that creates curiosity or tension within 2 seconds. No "Hey guys", no "In this video".
- One idea per scene. Short sentences. Spoken, natural rhythm. No stage directions in narration.
- End with a clear payoff or call to action.
- visualQuery must be something a stock library would actually have (e.g. "city night traffic", "woman running sunrise"), never abstract words.
- If the user provides a full script, keep their wording and meaning; only split it into scenes and tighten where needed.`;

function userPrompt(input: GenerateInput) {
  const wordBudget = Math.round(input.targetSeconds * 2.6);
  return input.mode === "script"
    ? `Here is my script. Split it into scenes for a ${input.style} short video.\n\n<script>\n${input.prompt}\n</script>`
    : `Create a ${input.style} short video (~${input.targetSeconds} seconds, about ${wordBudget} spoken words total) about:\n\n<idea>\n${input.prompt}\n</idea>`;
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
  const p = provider();
  if (p === "demo") return demoStoryboard(input);
  if (p === "gemini") return generateWithGemini(input);

  const client = new Anthropic();
  const user = userPrompt(input);

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
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

// Google Gemini (works on the free tier). JSON mode + schema, validated with zod.
async function generateWithGemini(input: GenerateInput): Promise<Storyboard> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const schema = z.toJSONSchema(StoryboardSchema) as Record<string, unknown>;
  delete schema.$schema; // Gemini rejects the meta-schema key
  let text: string | undefined;
  try {
    const res = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || "gemini-flash-latest",
      contents: userPrompt(input),
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
      },
    });
    text = res.text;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 429) throw new Error("Gemini free-tier rate limit hit. Wait a minute and try again.");
      if (err.status === 400 || err.status === 403) throw new Error(`Gemini rejected the request: ${err.message}`);
      if (err.status === 404) throw new Error("Gemini model not found. Set GEMINI_MODEL to a model your key can use.");
    }
    throw err;
  }
  if (!text) throw new Error("Gemini returned an empty response. Please try again.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned malformed JSON. Please try again.");
  }
  const parsed = StoryboardSchema.safeParse(json);
  if (!parsed.success) throw new Error("Gemini's storyboard didn't match the expected format. Please try again.");
  return toStoryboard(parsed.data);
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
  const scenes = merged.slice(0, 8).map((narration, i) => {
    const w = words(narration);
    return {
      narration,
      onScreen: w.slice(0, 4).join(" ") || "Watch this",
      visualQuery: w.slice(-2).join(" ") || "abstract light",
      emoji: emojis[i % emojis.length],
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
