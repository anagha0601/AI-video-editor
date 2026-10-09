import "server-only";
import type { Word } from "@/lib/timeline/types";

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

/** Transcript -> timed scenes (heuristic: sentence ends, pauses, max 6s). */
export function splitScenes(words: Word[], duration: number): SceneSplit {
  if (!words.length) {
    return {
      title: "Untitled",
      style: "",
      scenes: [{ start: 0, end: Math.max(duration, 1), text: "", visual_keywords: ["abstract"], query: "abstract background", mood: "neutral", image_prompt: "soft abstract gradient background" }],
    };
  }
  const starts = enforceMin(words, heuristicStarts(words));
  const scenes = toScenes(words, starts, duration, []);
  return { title: words.slice(0, 6).map((w) => w.text).join(" ").replace(/[.,!?]$/, ""), style: "", scenes };
}
