"use client";

import { useMemo, useState } from "react";
import { Music, Scissors } from "lucide-react";
import { toast } from "sonner";
import { cutSilences, silenceRanges } from "@/lib/timeline/ops";
import type { AssetDTO } from "@/lib/client/upload";
import { Button } from "@/components/ui/button";
import { useEditor } from "../store";
import { addPayload } from "../dnd";
import { DuckLevel } from "./Inspector";
import { Section, SliderField } from "./fields";

export function AudioPanel() {
  const timeline = useEditor((s) => s.timeline);
  const [minGap, setMinGap] = useState(0.7);
  const ranges = useMemo(() => silenceRanges(timeline, minGap), [timeline, minGap]);
  const saved = ranges.reduce((a, [s, e]) => a + (e - s), 0);
  const assets = useEditor((s) => s.assets);
  const music = useMemo(() => Object.values(assets).filter((a) => a.type === "music") as AssetDTO[], [assets]);

  const trim = () => {
    const s = useEditor.getState();
    const r = cutSilences(s.timeline, minGap);
    if (!r.count) return toast.info("No pauses that long");
    s.commit(r.timeline, "Trim silences");
    toast.success(`Removed ${r.count} pauses (${r.saved.toFixed(1)}s). Undo with ⌘/Ctrl+Z.`);
  };

  return (
    <div>
      <Section title="Trim silences">
        <p className="text-xs text-muted-foreground">Cuts pauses between spoken words from the whole video. Visuals, text and captions stay in sync.</p>
        <SliderField label="Pauses longer than" value={minGap} min={0.3} max={2} step={0.05} format={(v) => `${v.toFixed(2)}s`} onLive={setMinGap} onDone={() => {}} />
        <Button className="w-full" onClick={trim} disabled={!ranges.length}>
          <Scissors /> {ranges.length ? `Cut ${ranges.length} pauses · save ${saved.toFixed(1)}s` : "No pauses to cut"}
        </Button>
      </Section>
      <Section title="Background music">
        <DuckLevel />
        {music.length === 0 ? (
          <p className="text-xs text-muted-foreground">Upload a track in Media → Music, then add it here. Music is ducked under your voice automatically.</p>
        ) : (
          <div className="space-y-1">
            {music.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                <Music className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <Button size="sm" variant="secondary" className="h-6 text-[11px]" onClick={() => addPayload({ kind: "asset", asset: m }, null, 0)}>
                  Add at 0:00
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
