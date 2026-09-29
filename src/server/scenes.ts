import "server-only";
import type { Word } from "@/lib/timeline/types";
import { geminiJson, hasGemini } from "./gemini";

export interface Scene {
  start: number; // timeline seconds (taken from whisper, never from the LLM)
  end: number;
  text: string;
  visual_keywords: string[];
  query: string; // stock-footage search phrase
  mood: string;
  image_prompt: string; // prompt for an AI-generated still when no footage fits
}

export interface SceneSplit {
  title: string;
  style: string; // shared visual style for AI images, keeps scenes consistent
  scenes: Scene[];
}

const STOP = new Set(
  "a an the and or but if then so to of in on at by for with from as is are was were be been being it its it's this that these those i you he she we they me my your our their them his her not no do does did done have has had just very really can could would should will about into over after before than more most less what when where which who how why all any each every one some such only own same too up out off again further once here there".split(
    " ",
  ),
);

export function keywordsOf(text: string, n = 4) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words.sort((a, b) => b.length - a.length)) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
    if (out.length >= n) break;
  }
  return out;
}

/** Turn word-index boundaries into timed scenes; cuts land midway through pauses. */
type SceneMeta = { keywords: string[]; query: string; mood: string; image_prompt?: string };

function toScenes(words: Word[], startIdx: number[], duration: number, meta: SceneMeta[]): Scene[] {
  const scenes: Scene[] = [];
  for (let i = 0; i < startIdx.length; i++) {
    const s = startIdx[i];
    const e = (startIdx[i + 1] ?? words.length) - 1;
    const cut = (idx: number) => (idx === 0 ? 0 : (words[idx - 1].end + words[idx].start) / 2);
    const start = cut(s);
    const end = i + 1 < startIdx.length ? cut(startIdx[i + 1]) : Math.max(duration, words[words.length - 1].end + 0.3);
    const text = words.slice(s, e + 1).map((w) => w.text).join(" ");
    const m = meta[i] ?? { keywords: keywordsOf(text), query: keywordsOf(text, 2).join(" "), mood: "neutral" };
    const query = m.query || m.keywords.slice(0, 2).join(" ");
    scenes.push({
      start,
      end,
      text,
      visual_keywords: m.keywords,
      query,
      mood: m.mood,
      image_prompt: m.image_prompt || `${query}, ${m.keywords.join(", ")}, ${m.mood} mood`,
    });
  }
  return scenes;
}

function heuristicStarts(words: Word[]) {
  const starts = [0];
  let sceneStart = words[0]?.start ?? 0;
  for (let i = 1; i < words.length; i++) {
    const len = words[i].start - sceneStart;
    const prev = words[i - 1];
    const sentenceEnd = /[.!?]["')\]]?$/.test(prev.text);
    const pause = words[i].start - prev.end;
    if ((sentenceEnd && len >= 2) || (pause > 0.5 && len >= 3) || len >= 6) {
      starts.push(i);
      sceneStart = words[i].start;
    }
  }
  return starts;
}

/** Merge scenes shorter than `min` seconds into their neighbour. */
function enforceMin(words: Word[], starts: number[], min = 1.2) {
  const out = [...starts];
  for (let i = 1; i < out.length; i++) {
    const len = (out[i + 1] !== undefined ? words[out[i + 1]].start : words[words.length - 1].end) - words[out[i]].start;
    if (len < min) {
      out.splice(i, 1);
      i--;
    }
  }
  return out;
}

export async function splitScenes(words: Word[], duration: number, aspect: string): Promise<SceneSplit & { ai: boolean }> {
  if (!words.length) {
    return {
      title: "Untitled",
      style: "",
      ai: false,
      scenes: [{ start: 0, end: Math.max(duration, 1), text: "", visual_keywords: ["abstract"], query: "abstract background", mood: "neutral", image_prompt: "soft abstract gradient background" }],
    };
  }
  if (hasGemini()) {
    try {
      const listing = words.map((w, i) => `${i}:${w.text}`).join(" ");
      const res = await geminiJson<{
        title: string;
        style: string;
        scenes: { startWord: number; keywords: string[]; query: string; mood: string; image_prompt: string }[];
      }>({
        system:
          "You are a short-form video editor. Split a voiceover transcript into visual scenes (one B-roll shot each). " +
          "Scenes should be 2-6 seconds of speech and follow the meaning (new idea = new shot). For each scene give " +
          "3-5 concrete visual keywords (things a camera can film: objects, places, actions, people) and a 2-4 word stock-footage search query. " +
          "Avoid abstract words like 'productivity' in queries; translate them into filmable scenes (e.g. 'person writing notebook'). " +
          "For each scene also write image_prompt: a vivid one-sentence description of a single photographic shot for that line (subject, setting, action, lighting, camera angle), " +
          "used to generate an image if no footage exists. Keep people/settings consistent across scenes. Also give a punchy 2-6 word title/hook and a short shared " +
          "visual `style` (e.g. 'warm natural light, 35mm film look') for all images.",
        parts: [{ text: `Aspect ratio: ${aspect}. Transcript words as index:word —\n${listing}\n\nReturn scenes in order; startWord is the index of the first word of each scene; the first scene starts at 0.` }],
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            style: { type: "string" },
            scenes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  startWord: { type: "integer" },
                  keywords: { type: "array", items: { type: "string" } },
                  query: { type: "string" },
                  mood: { type: "string" },
                  image_prompt: { type: "string" },
                },
                required: ["startWord", "keywords", "query", "mood", "image_prompt"],
              },
            },
          },
          required: ["title", "style", "scenes"],
        },
        temperature: 0.3,
      });
      const raw = res.scenes
        .filter((s) => Number.isInteger(s.startWord) && s.startWord >= 0 && s.startWord < words.length)
        .sort((a, b) => a.startWord - b.startWord)
        .filter((s, i, arr) => i === 0 || s.startWord !== arr[i - 1].startWord);
      if (raw.length) {
        raw[0].startWord = 0;
        const starts = raw.map((s) => s.startWord);
        const kept = enforceMin(words, starts);
        const meta = kept.map((st) => {
          const s = raw.find((r) => r.startWord === st)!;
          return { keywords: s.keywords.slice(0, 5).map((k) => k.toLowerCase()), query: s.query, mood: s.mood, image_prompt: s.image_prompt };
        });
        return { title: res.title?.trim() || "Untitled", style: res.style ?? "", ai: true, scenes: toScenes(words, kept, duration, meta) };
      }
    } catch (err) {
      console.error("[scenes] Gemini failed, using heuristic split:", err);
    }
  }
  const starts = enforceMin(words, heuristicStarts(words));
  const scenes = toScenes(words, starts, duration, []);
  return { title: words.slice(0, 6).map((w) => w.text).join(" ").replace(/[.,!?]$/, ""), style: "", ai: false, scenes };
}
