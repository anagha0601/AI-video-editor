import "server-only";
import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { costUsd } from "@/config/pricing";
import { prisma } from "./db";

// Every Gemini request goes through callGemini(), which logs token usage and cost
// to ApiUsage. The SDK client is private to this module so no call can skip it.

let client: GoogleGenAI | null = null;

function sdk() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

export type GeminiFeature = "script" | "scene_split" | "ai_edit" | "tagging" | "tts" | "image";

export interface UsageCtx {
  feature: GeminiFeature;
  projectId?: string | null;
  userId?: string | null;
  /** Filled with the ApiUsage row ids this context produced (e.g. to link a script to its project later). */
  ids?: string[];
}

async function recordUsage(ctx: UsageCtx, requestedModel: string, res: GenerateContentResponse) {
  const u = res.usageMetadata;
  const model = res.modelVersion || requestedModel;
  const input = u?.promptTokenCount ?? 0;
  const output = u?.candidatesTokenCount ?? 0;
  const thinking = u?.thoughtsTokenCount ?? 0;
  const row = await prisma.apiUsage.create({
    data: {
      model,
      feature: ctx.feature,
      projectId: ctx.projectId ?? null,
      userId: ctx.userId ?? null,
      inputTokens: input,
      outputTokens: output,
      thinkingTokens: thinking,
      costUsd: costUsd(model, input, output, thinking),
    },
    select: { id: true },
  });
  ctx.ids?.push(row.id);
}

/** The one entry point for Gemini: sends the request, logs usage + cost, returns the response. */
export async function callGemini(ctx: UsageCtx, params: GenerateContentParameters): Promise<GenerateContentResponse> {
  const res = await sdk().models.generateContent(params);
  try {
    await recordUsage(ctx, params.model, res);
  } catch (err) {
    console.error("[usage] failed to log Gemini usage", err); // never fail the user's request over logging
  }
  return res;
}

function models() {
  const list = [process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-3.8-flash"].filter(Boolean) as string[];
  return [...new Set(list)];
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Structured JSON output from Gemini Flash, with model fallback and retries (each attempt is logged). */
export async function geminiJson<T>(opts: {
  usage: UsageCtx;
  system: string;
  parts: Part[];
  schema: unknown;
  temperature?: number;
}): Promise<T> {
  let lastErr: unknown;
  for (const model of models()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await callGemini(opts.usage, {
          model,
          contents: [{ role: "user", parts: opts.parts }],
          config: {
            systemInstruction: opts.system,
            responseMimeType: "application/json",
            responseJsonSchema: opts.schema,
            temperature: opts.temperature ?? 0.4,
          },
        });
        const text = res.text;
        if (!text) throw new Error("empty response");
        return JSON.parse(text) as T;
      } catch (err) {
        lastErr = err;
        const msg = String((err as Error)?.message ?? err);
        if (/404|not found|NOT_FOUND|not supported|no longer available/i.test(msg)) break; // try the next model
        if (/429|503|500|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|empty response|JSON/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1) ** 2));
          continue;
        }
        throw err;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
