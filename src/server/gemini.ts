import "server-only";
import { GoogleGenAI } from "@google/genai";

// Gemini Flash (paid tier) for scene splitting, media tagging and AI edit commands.
// Tries GEMINI_MODEL first, then stable Flash aliases, retrying transient errors.

let client: GoogleGenAI | null = null;

export const hasGemini = () => Boolean(process.env.GEMINI_API_KEY);

function models() {
  const list = [process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-3.8-flash"].filter(Boolean) as string[];
  return [...new Set(list)];
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export async function geminiJson<T>(opts: {
  system: string;
  parts: Part[];
  schema: unknown;
  temperature?: number;
}): Promise<T> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  let lastErr: unknown;
  for (const model of models()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await client.models.generateContent({
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
        if (/404|not found|NOT_FOUND|not supported/i.test(msg)) break; // try the next model
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
