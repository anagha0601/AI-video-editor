import "server-only";
import { nanoid } from "nanoid";
import type { Aspect } from "@/lib/timeline/types";
import { prisma } from "./db";
import { geminiClient, geminiJson } from "./gemini";
import { putObject } from "./storage";

// Generative pieces for idea -> video: script writing (Gemini Flash), voiceover
// (Gemini TTS) and scene images (Gemini image model).

const TTS_MODELS = [process.env.GEMINI_TTS_MODEL, "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"].filter(Boolean) as string[];
const IMAGE_MODELS = [process.env.GEMINI_IMAGE_MODEL, "gemini-3.1-flash-image", "gemini-2.5-flash-image"].filter(Boolean) as string[];

export const VOICES = [
  { id: "Kore", label: "Kore — warm, clear (female)" },
  { id: "Puck", label: "Puck — upbeat (male)" },
  { id: "Charon", label: "Charon — deep, calm (male)" },
  { id: "Aoede", label: "Aoede — breezy (female)" },
  { id: "Fenrir", label: "Fenrir — energetic (male)" },
  { id: "Leda", label: "Leda — youthful (female)" },
] as const;

export const TONES = ["engaging", "educational", "inspiring", "funny", "calm", "dramatic"] as const;

async function tryModels<T>(models: string[], fn: (model: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const m of [...new Set(models)]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fn(m);
      } catch (err) {
        last = err;
        const msg = String((err as Error)?.message ?? err);
        if (/404|not found|NOT_FOUND|no longer available|not supported/i.test(msg)) break;
        if (/429|500|503|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|no (image|audio)/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Idea -> short-form voiceover script (hook first) sized to the requested length. */
export async function writeScript(idea: string, seconds: number, tone: string) {
  const words = Math.round(seconds * 2.4);
  return geminiJson<{ title: string; script: string }>({
    system:
      "You write voiceover scripts for short vertical videos (TikTok, Reels, Shorts). Open with a scroll-stopping hook in the first sentence, " +
      "keep sentences short and spoken (no stage directions, no emojis, no hashtags, no scene labels), and end with a clear payoff or call to action. " +
      "Return only the words to be spoken in `script`, and a punchy 2-6 word `title`.",
    parts: [{ text: `Idea: ${idea}\nTone: ${tone}\nLength: about ${words} words (~${seconds} seconds spoken).` }],
    schema: { type: "object", properties: { title: { type: "string" }, script: { type: "string" } }, required: ["title", "script"] },
    temperature: 0.8,
  });
}

function wavFromPcm(pcm: Buffer, rate: number) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Script -> spoken WAV via Gemini TTS. */
export async function synthesizeSpeech(script: string, voice: string, tone: string): Promise<Buffer> {
  return tryModels(TTS_MODELS, async (model) => {
    const res = await geminiClient().models.generateContent({
      model,
      // A bracketed style tag steers delivery without being spoken; a "Say it like…:" preamble gets read aloud.
      contents: [{ role: "user", parts: [{ text: `[${tone}, natural pace] ${script}` }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("no audio returned");
    const buf = Buffer.from(part.inlineData.data, "base64");
    const mime = part.inlineData.mimeType ?? "";
    if (/wav/i.test(mime) || buf.subarray(0, 4).toString() === "RIFF") return buf;
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000); // raw L16 PCM
    return wavFromPcm(buf, rate);
  });
}

const RATIO: Record<Aspect, string> = { "9:16": "9:16", "16:9": "16:9", "1:1": "1:1" };

/** Prompt -> image stored in the user's library (source "ai"). */
export async function generateImageAsset(userId: string, prompt: string, aspect: Aspect, tags: string[] = []) {
  const { data, mime } = await tryModels(IMAGE_MODELS, async (model) => {
    const res = await geminiClient().models.generateContent({
      model,
      contents: `${prompt}\n\nPhotorealistic, cinematic lighting, high detail. No text, captions, logos or watermarks in the image.`,
      config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: RATIO[aspect] } },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error("no image returned");
    return { data: Buffer.from(part.inlineData.data, "base64"), mime: part.inlineData.mimeType ?? "image/png" };
  });
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  const key = `u/${userId}/ai/${nanoid(12)}.${ext}`;
  const url = await putObject(key, data, mime);
  const dims = imageSize(data);
  return prisma.mediaAsset.create({
    data: {
      userId,
      type: "image",
      source: "ai",
      key,
      url,
      thumbUrl: url,
      name: prompt.slice(0, 60),
      mime,
      width: dims?.w ?? null,
      height: dims?.h ?? null,
      tags: [...new Set(["ai", ...tags.map((t) => t.toLowerCase())])].slice(0, 15),
      meta: { prompt, hasAudio: false },
    },
  });
}

/** PNG/JPEG dimensions from the header bytes. */
function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.subarray(1, 4).toString() === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

/** Run async jobs with a concurrency limit. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
