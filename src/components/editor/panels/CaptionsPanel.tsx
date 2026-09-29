"use client";

import { useEffect, useMemo, useRef } from "react";
import { CAPTION_PRESETS } from "@/lib/timeline/derive";
import { FONTS } from "@/lib/timeline/fonts";
import type { CaptionStyle, Timeline } from "@/lib/timeline/types";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEditor } from "../store";
import { cachedCaptionLines } from "../preview/draw";
import { mappedWords } from "@/lib/timeline/derive";
import { formatTime } from "../format";
import { Section, SliderField, useTimelineEdit } from "./fields";

const setCaptions = (patch: Partial<Timeline["captions"]>) => (tl: Timeline) => ({ ...tl, captions: { ...tl.captions, ...patch } });

export function CaptionsPanel() {
  const cap = useEditor((s) => s.timeline.captions);
  const t = useTimelineEdit();
  return (
    <div>
      <Section title="Captions">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Show auto captions</Label>
          <Switch checked={cap.enabled} onCheckedChange={(v) => t.set(setCaptions({ enabled: v }), v ? "Captions on" : "Captions off")} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CAPTION_PRESETS) as CaptionStyle[]).map((k) => (
            <StyleCard key={k} id={k} active={cap.style === k} onClick={() => t.set(setCaptions({ style: k, enabled: true }), "Caption style")} />
          ))}
        </div>
        <SliderField label="Position" value={cap.y} min={0.1} max={0.92} format={(v) => `${Math.round(v * 100)}%`} onLive={(v) => t.live(setCaptions({ y: v }))} onDone={() => t.done("Caption position")} />
        <SliderField label="Size" value={cap.size} min={32} max={140} step={1} format={(v) => `${Math.round(v)}px`} onLive={(v) => t.live(setCaptions({ size: v }))} onDone={() => t.done("Caption size")} />
        <SliderField label="Max words per line" value={cap.maxWords} min={1} max={8} step={1} format={(v) => String(v)} onLive={(v) => t.live(setCaptions({ maxWords: v }))} onDone={() => t.done("Caption words")} />
      </Section>
      <WordEditor />
    </div>
  );
}

function StyleCard({ id, active, onClick }: { id: CaptionStyle; active: boolean; onClick: () => void }) {
  const look = CAPTION_PRESETS[id].look(40);
  const word = (state: "past" | "active" | "future", text: string) => (
    <span
      style={{
        color: look.word[state].color,
        opacity: look.word[state].opacity,
        WebkitTextStroke: look.outline ? `1.5px ${look.outlineColor}` : undefined,
        paintOrder: "stroke fill",
        textShadow: look.shadow ? "2px 2px 0 rgba(0,0,0,.5)" : undefined,
      }}
    >
      {look.uppercase ? text.toUpperCase() : text}
    </span>
  );
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex h-16 flex-col items-center justify-center gap-1 rounded-lg border bg-[linear-gradient(135deg,#334155,#0f172a)] p-2", active ? "border-primary ring-2 ring-primary/40" : "hover:border-white/30")}
    >
      <span
        className="text-[15px]"
        style={{
          fontFamily: `"${FONTS[look.font].css}"`,
          background: look.box ? `rgba(0,0,0,${look.box.opacity})` : undefined,
          padding: look.box ? "0 6px" : undefined,
        }}
      >
        {word("past", "Say")} {word("active", "it")} {word("future", "loud")}
      </span>
      <span className="text-[10px] text-muted-foreground">{CAPTION_PRESETS[id].label}</span>
    </button>
  );
}

/** Every caption line with its words as inputs; edits are stored per word id so they survive trims. */
function WordEditor() {
  const timeline = useEditor((s) => s.timeline);
  const playhead = useEditor((s) => s.playhead);
  const lines = cachedCaptionLines(timeline);
  const all = useMemo(() => mappedWords(timeline, false), [timeline]);
  const original = useMemo(() => new Map(all.map((w) => [w.id, w.text])), [all]);
  const activeRef = useRef<HTMLDivElement>(null);
  const activeIdx = lines.findIndex((l) => playhead >= l.start && playhead < l.end);
  const t = useTimelineEdit();

  useEffect(() => {
    if (!useEditor.getState().playing) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const setWord = (id: string, text: string) =>
    t.set((tl) => {
      const edits = { ...tl.captions.edits };
      if (text === original.get(id)) delete edits[id];
      else edits[id] = text;
      return { ...tl, captions: { ...tl.captions, edits } };
    }, "Edit caption");

  if (!lines.length) return <Section title="Transcript">{<p className="text-xs text-muted-foreground">No spoken words on the voice track.</p>}</Section>;
  return (
    <Section title="Edit words">
      <p className="text-[11px] text-muted-foreground">Fix any word; clear a word to hide it. Edits follow the audio through trims and silence cuts.</p>
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div
            key={`${l.words[0].id}-${i}`}
            ref={i === activeIdx ? activeRef : undefined}
            className={cn("rounded-md border p-1.5", i === activeIdx ? "border-primary/60 bg-primary/10" : "border-transparent hover:bg-muted/50")}
          >
            <button type="button" className="mb-1 font-mono text-[10px] text-muted-foreground hover:text-foreground" onClick={() => useEditor.getState().setPlayhead(l.start)}>
              {formatTime(l.start, true)}
            </button>
            <div className="flex flex-wrap gap-1">
              {l.words.map((w) => (
                <input
                  key={w.id + w.text}
                  defaultValue={w.text}
                  onBlur={(e) => e.target.value.trim() !== w.text && setWord(w.id, e.target.value.trim())}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  size={Math.max(2, w.text.length)}
                  className="rounded bg-transparent px-1 py-0.5 text-xs outline-none hover:bg-muted focus:bg-muted focus:ring-1 focus:ring-primary"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
