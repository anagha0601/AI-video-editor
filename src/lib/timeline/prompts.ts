import { clipEnd, mappedWords } from "./derive";
import type { Aspect, Timeline, VisualClip } from "./types";

const ASPECT_WORDS: Record<Aspect, string> = { "9:16": "vertical 9:16", "16:9": "horizontal 16:9", "1:1": "square 1:1" };

/** Ready-to-paste image prompt for a scene (for use in the Gemini app or any image tool). */
export function scenePrompt(tl: Timeline, clip: VisualClip) {
  let hint = clip.visualHint?.trim();
  if (!hint) {
    const said = mappedWords(tl)
      .filter((w) => w.start < clipEnd(clip) && w.end > clip.start)
      .map((w) => w.text)
      .join(" ");
    hint = [clip.keywords?.length ? clip.keywords.join(", ") : clip.name, said && `illustrating: "${said}"`].filter(Boolean).join(". ");
  }
  hint = hint.replace(/\.{2,}/g, ".").replace(/[.\s]+$/, "");
  return `Create an image: ${hint}. Photorealistic, cinematic lighting, no text, captions or watermarks. ${ASPECT_WORDS[tl.aspect]} aspect ratio.`;
}
