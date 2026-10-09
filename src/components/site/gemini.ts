"use client";

import { toast } from "sonner";

// "Gemini" in the navigation: just a link to gemini.google.com in a new tab (no API), plus a ready-made prompt for
// trending Instagram audio that matches the current project. Niche and mood are remembered in this browser.

export const GEMINI_URL = "https://gemini.google.com/app";

export const MOODS = ["motivational", "energetic", "aggressive / hype", "emotional", "dark / moody", "chill", "cinematic", "funny / sassy"] as const;

export interface GeminiPrefs {
  niche: string;
  mood: string;
}

const KEY = "reelsmith-gemini-prefs";
const DEFAULTS: GeminiPrefs = { niche: "fitness/gym", mood: "motivational" };

export function loadPrefs(): GeminiPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return { ...DEFAULTS, ...(v ?? {}) };
  } catch {
    return DEFAULTS;
  }
}

export function savePrefs(p: GeminiPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private window: not remembered */
  }
}

export function musicPrompt(p: GeminiPrefs & { title?: string | null; seconds?: number | null }) {
  const len = p.seconds && p.seconds > 1 ? `about ${Math.round(p.seconds)} seconds long` : "15–30 seconds long";
  return [
    `Suggest 5 trending Instagram audios for a ${p.niche} reel with a ${p.mood} vibe${p.title ? ` (the reel: "${p.title}")` : ""}. The reel is ${len}, vertical, cut on the beat with a hook in the first 2 seconds.`,
    "For each one give:",
    "1. song name and artist",
    "2. why it fits this reel and vibe",
    "3. the best part to use (start second of the hook or drop)",
    "4. if you know one, a link to a public Instagram reel (instagram.com/reel/…) that uses this sound",
    "Prefer sounds that are trending right now on Instagram Reels.",
  ].join("\n");
}

export async function copyMusicPrompt(p: GeminiPrefs & { title?: string | null; seconds?: number | null }) {
  const text = musicPrompt(p);
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Prompt copied: paste it into Gemini", { description: text.split("\n")[0] });
  } catch {
    window.prompt("Copy this prompt:", text);
  }
  return text;
}
