"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { TEXT_PRESETS } from "@/lib/timeline/factory";
import { FONTS } from "@/lib/timeline/fonts";
import type { TextClip } from "@/lib/timeline/types";
import { useEditor } from "../store";
import { addPayload, dragProps } from "../dnd";
import { formatTime } from "../format";

export function TextPanel() {
  const tracks = useEditor((s) => s.timeline.tracks);
  const texts = useMemo(() => tracks.flatMap((t) => (t.kind === "text" ? t.clips : [])) as TextClip[], [tracks]);
  const s = useEditor.getState;
  return (
    <div className="space-y-4 p-3">
      <p className="text-xs text-muted-foreground">Click to add at the playhead, or drag onto a text track.</p>
      <div className="grid gap-2">
        {(Object.keys(TEXT_PRESETS) as (keyof typeof TEXT_PRESETS)[]).map((k) => {
          const p = TEXT_PRESETS[k];
          const st = p.style("9:16");
          return (
            <button
              key={k}
              type="button"
              {...dragProps({ kind: "text", preset: k })}
              onClick={() => addPayload({ kind: "text", preset: k }, null, s().playhead)}
              className="group flex h-20 items-center justify-center rounded-lg border bg-gradient-to-br from-zinc-800 to-zinc-900 p-3 hover:border-primary"
            >
              <span
                style={{
                  fontFamily: `"${FONTS[st.font].css}"`,
                  color: st.color,
                  background: st.background ?? undefined,
                  padding: st.background ? "2px 8px" : undefined,
                  textTransform: st.uppercase ? "uppercase" : undefined,
                  WebkitTextStroke: st.outline ? `1px ${st.outlineColor}` : undefined,
                  fontSize: k === "lower-third" ? 13 : 20,
                  textShadow: st.shadow ? "2px 2px 0 rgba(0,0,0,.5)" : undefined,
                }}
              >
                {p.label}
              </span>
              <Plus className="ml-auto size-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
            </button>
          );
        })}
      </div>
      {texts.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">On the timeline</h3>
          {texts.map((t) => (
            <button
              key={t.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              onClick={() => {
                s().select([t.id]);
                s().setPlayhead(t.start + 0.01);
              }}
            >
              <span className="font-mono text-[10px] text-muted-foreground">{formatTime(t.start)}</span>
              <span className="truncate">{t.text.replace(/\n/g, " ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
