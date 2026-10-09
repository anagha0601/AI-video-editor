"use client";

import { ClipboardCopy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyMusicPrompt, GEMINI_URL, loadPrefs } from "./gemini";

/** Main navigation: "Gemini" opens gemini.google.com in a new tab; "Copy prompt" copies the trending-audio prompt. */
export function GeminiNav() {
  return (
    <div className="flex items-center">
      <a href={GEMINI_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:px-2.5">
        <Sparkles className="size-3.5" /> Gemini
      </a>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground"
        title="Copy a prompt for trending Instagram audio (niche and mood from the Music panel)"
        aria-label="Copy Gemini prompt"
        onClick={() => copyMusicPrompt(loadPrefs())}
      >
        <ClipboardCopy className="size-3.5" />
      </Button>
    </div>
  );
}
