export type Scene = {
  id: string;
  narration: string; // spoken voiceover line
  onScreen: string; // short punchy caption headline
  visualQuery: string; // stock search keywords
  durationSec: number;
  mediaUrl?: string | null; // stock image (proxied through /api/media)
  credit?: string | null;
  palette: [string, string]; // gradient fallback colors
  emoji?: string;
};

export type VideoStyle = "educational" | "storytelling" | "promo" | "motivational" | "listicle";
export type Aspect = "9:16" | "1:1" | "16:9";

export const STYLES: { id: VideoStyle; label: string; blurb: string }[] = [
  { id: "educational", label: "Explainer", blurb: "Teach one idea clearly" },
  { id: "storytelling", label: "Story", blurb: "Narrative with a twist" },
  { id: "listicle", label: "Top list", blurb: "3–5 fast-paced points" },
  { id: "promo", label: "Product promo", blurb: "Hook, benefit, CTA" },
  { id: "motivational", label: "Motivational", blurb: "Punchy and uplifting" },
];

export const ASPECTS: { id: Aspect; label: string; w: number; h: number; hint: string }[] = [
  { id: "9:16", label: "9:16", w: 720, h: 1280, hint: "TikTok · Reels · Shorts" },
  { id: "1:1", label: "1:1", w: 1080, h: 1080, hint: "Feed posts" },
  { id: "16:9", label: "16:9", w: 1280, h: 720, hint: "YouTube" },
];
