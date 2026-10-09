"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy, Link2, Loader2, Music, Scissors, ShieldAlert, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { energize, ENERGY, timelineBeats, type Energy, type TrackBeats } from "@/lib/timeline/beatfx";
import { toast } from "sonner";
import { cutSilences, silenceRanges } from "@/lib/timeline/ops";
import { timelineDuration } from "@/lib/timeline/derive";
import { api } from "@/lib/client/api";
import type { AssetDTO } from "@/lib/client/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { copyMusicPrompt, GEMINI_URL, loadPrefs, MOODS, savePrefs, type GeminiPrefs } from "@/components/site/gemini";
import { useEditor } from "../store";
import { addPayload } from "../dnd";
import { DuckLevel } from "./Inspector";
import { Section, SliderField } from "./fields";
import { AudioClipper, fmtTime, linkInfo } from "./AudioClipper";

const IG_AUDIO = /instagram\.com\/(reels?\/)?audio\//i;

export function AudioPanel() {
  const timeline = useEditor((s) => s.timeline);
  const [minGap, setMinGap] = useState(0.7);
  const ranges = useMemo(() => silenceRanges(timeline, minGap), [timeline, minGap]);
  const saved = ranges.reduce((a, [s, e]) => a + (e - s), 0);
  const assets = useEditor((s) => s.assets);
  const music = useMemo(() => (Object.values(assets).filter((a) => a.type === "music") as AssetDTO[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [assets]);
  const linked = music.filter((m) => linkInfo(m));
  const uploaded = music.filter((m) => !linkInfo(m));
  const [clipping, setClipping] = useState<AssetDTO | null>(null);

  const trim = () => {
    const s = useEditor.getState();
    const r = cutSilences(s.timeline, minGap);
    if (!r.count) return toast.info("No pauses that long");
    s.commit(r.timeline, "Trim silences");
    toast.success(`Removed ${r.count} pauses (${r.saved.toFixed(1)}s). Undo with ⌘/Ctrl+Z.`);
  };

  const updateAsset = (a: AssetDTO) => {
    const s = useEditor.getState();
    s.setAssets(Object.values({ ...s.assets, [a.id]: a }) as AssetDTO[]);
    setClipping((c) => (c && c.id === a.id ? a : c));
  };

  return (
    <div>
      <Section title="Music from a link">
        <PasteLink
          onImported={(a) => {
            updateAsset(a);
            setClipping(a);
          }}
        />
        {linked.length > 0 && (
          <div className="space-y-1">
            {linked.map((m) => {
              const li = linkInfo(m)!;
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                  {li.rights ? <ShieldCheck className="size-3.5 shrink-0 text-emerald-400" /> : <ShieldAlert className="size-3.5 shrink-0 text-amber-400" />}
                  <span className="min-w-0 flex-1 truncate" title={`${m.name}\n${li.link.url}${li.rights ? "" : "\nTiming only / personal use"}`}>
                    {m.name}
                    <span className="block text-[10px] text-muted-foreground">
                      {fmtTime(m.duration ?? 0)}
                      {li.analysis?.tempo ? ` · ${li.analysis.tempo.toFixed(0)} BPM` : ""}
                      {li.analysis?.drops[0] ? ` · drop ${fmtTime(li.analysis.drops[0].t)}` : ""}
                      {li.rights ? "" : " · timing only"}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" className="h-6 text-[11px]" onClick={() => setClipping(m)}>
                    <Scissors className="size-3" /> Clip
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <GeminiRow />
      </Section>
      <BeatEffects />
      <Section title="Background music">
        <DuckLevel />
        {uploaded.length === 0 ? (
          <p className="text-xs text-muted-foreground">Upload a track in Media → Music, or paste a link above. Music is ducked under your voice automatically.</p>
        ) : (
          <div className="space-y-1">
            {uploaded.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                <Music className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => setClipping(m)} title="Pick a section on the waveform">
                  <Scissors className="size-3" />
                </Button>
                <Button size="sm" variant="secondary" className="h-6 text-[11px]" onClick={() => addPayload({ kind: "asset", asset: m }, null, 0)}>
                  Add at 0:00
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Trim silences">
        <p className="text-xs text-muted-foreground">Cuts pauses between spoken words from the whole video. Visuals, text and captions stay in sync.</p>
        <SliderField label="Pauses longer than" value={minGap} min={0.3} max={2} step={0.05} format={(v) => `${v.toFixed(2)}s`} onLive={setMinGap} onDone={() => {}} />
        <Button className="w-full" onClick={trim} disabled={!ranges.length}>
          <Scissors /> {ranges.length ? `Cut ${ranges.length} pauses · save ${saved.toFixed(1)}s` : "No pauses to cut"}
        </Button>
      </Section>
      {clipping && <AudioClipper key={clipping.id} asset={clipping} open={!!clipping} onOpenChange={(v) => !v && setClipping(null)} onAssetChange={updateAsset} />}
    </div>
  );
}

/** Zoom punches, shakes, flashes, beat cuts and transitions from the music track's beats (src/lib/timeline/beatfx.ts). */
function BeatEffects() {
  const timeline = useEditor((s) => s.timeline);
  const [level, setLevel] = useState<Energy>("punchy");
  const [busy, setBusy] = useState(false);
  const musicIds = useMemo(
    () => [...new Set(timeline.tracks.flatMap((t) => (t.kind === "music" && !t.muted ? t.clips.filter((c) => !c.muted && c.assetId).map((c) => c.assetId!) : [])))],
    [timeline],
  );
  const count = timeline.fx?.length ?? 0;

  const apply = async () => {
    setBusy(true);
    const t = toast.loading("Finding the beats…");
    try {
      const byAsset: Record<string, TrackBeats> = {};
      for (const id of musicIds) {
        const cached = (useEditor.getState().assets[id] as AssetDTO | undefined)?.meta?.analysis;
        if (cached?.beats?.length) byAsset[id] = cached;
        else {
          const r = await api<{ asset: AssetDTO; analysis: TrackBeats }>(`/api/media/${id}/beats`, { method: "POST" });
          byAsset[id] = r.analysis;
          const s = useEditor.getState();
          s.setAssets(Object.values({ ...s.assets, [id]: r.asset }) as AssetDTO[]);
        }
      }
      const s = useEditor.getState();
      const beats = timelineBeats(s.timeline, byAsset);
      if (!beats.beats.length) throw new Error("No beats under the music clips");
      const r = energize(s.timeline, beats, level);
      s.commit(r.timeline, `Beat effects: ${ENERGY[level].label}`);
      const st = r.stats;
      toast.success(`${ENERGY[level].label}: ${st.fx} beat effects${st.splits ? `, ${st.splits} beat cuts` : ""}${st.transitions ? `, ${st.transitions} transitions` : ""}`, {
        id: t,
        description: `${st.drop != null ? `Drop at ${st.drop.toFixed(2)}s. ` : ""}${level !== "subtle" && !st.splits ? "No beat cuts: the clips have no resolution left for a punch-in. " : ""}Undo with ⌘/Ctrl+Z.`,
      });
    } catch (e) {
      toast.error((e as Error).message, { id: t });
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    const s = useEditor.getState();
    s.commit({ ...s.timeline, fx: [] }, "Clear beat effects");
  };

  return (
    <Section title="Beat effects">
      <p className="text-xs text-muted-foreground">Zoom punches on the beat, shake + flash on the drop, flash/zoom transitions on cuts, and beat cuts where the footage has the resolution. Text and captions stay still.</p>
      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(ENERGY) as Energy[]).map((k) => (
          <Button key={k} size="sm" variant={level === k ? "secondary" : "ghost"} className="h-7 text-[11px]" onClick={() => setLevel(k)} title={ENERGY[k].hint} aria-pressed={level === k}>
            {ENERGY[k].label}
          </Button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{ENERGY[level].hint}</p>
      <div className="flex gap-1.5">
        <Button className="flex-1" onClick={apply} disabled={busy || !musicIds.length}>
          {busy ? <Loader2 className="animate-spin" /> : <Zap />} {musicIds.length ? (count ? "Redo on the beat" : "Add on the beat") : "Add a music clip first"}
        </Button>
        {count > 0 && (
          <Button variant="ghost" onClick={clear} title="Remove the beat effects (cuts and transitions stay)">
            Clear {count}
          </Button>
        )}
      </div>
    </Section>
  );
}

function PasteLink({ onImported }: { onImported: (a: AssetDTO) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const igAudio = IG_AUDIO.test(url);
  const go = async () => {
    const v = url.trim();
    if (!v) return;
    if (IG_AUDIO.test(v)) return toast.error("That's an Instagram audio page, which can't be downloaded. Open a reel that uses this sound and copy its /reel/ link.");
    setBusy(true);
    const t = toast.loading("Downloading the audio and finding the beats…");
    try {
      const { asset } = await api<{ asset: AssetDTO }>("/api/media/audio-link", { method: "POST", json: { url: v } });
      toast.success(`Got “${asset.name}”`, { id: t, description: "Pick the section to use on the waveform." });
      setUrl("");
      onImported(asset);
    } catch (e) {
      toast.error((e as Error).message, { id: t, duration: 8000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && go()}
          placeholder="Paste link: Instagram /reel/, YouTube, Shorts, .mp3…"
          className="h-8 text-xs"
          aria-label="Audio link"
          disabled={busy}
        />
        <Button size="sm" className="h-8" onClick={go} disabled={busy || !url.trim() || igAudio}>
          {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
        </Button>
      </div>
      {igAudio ? (
        <p className="text-[11px] text-amber-300">Instagram audio pages can&apos;t be downloaded: open a reel that uses this sound and copy its /reel/ link.</p>
      ) : (
        <p className="text-[11px] text-muted-foreground">Downloaded with yt-dlp as a 48 kHz WAV, for timing. Mark it “I have the rights” only if you do.</p>
      )}
    </div>
  );
}

function GeminiRow() {
  const title = useEditor((s) => s.title);
  const timeline = useEditor((s) => s.timeline);
  const [prefs, setPrefs] = useState<GeminiPrefs>({ niche: "fitness/gym", mood: "motivational" });
  useEffect(() => setPrefs(loadPrefs()), []);
  const set = (p: Partial<GeminiPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    savePrefs(next);
  };
  return (
    <div className="space-y-1.5 rounded-lg border border-dashed p-2">
      <div className="text-[11px] font-medium text-muted-foreground">Find a trending sound with Gemini</div>
      <div className="grid grid-cols-2 gap-1.5">
        <Input value={prefs.niche} onChange={(e) => set({ niche: e.target.value })} className="h-7 text-xs" aria-label="Niche" placeholder="Niche" />
        <Select value={prefs.mood} onValueChange={(v) => set({ mood: v })}>
          <SelectTrigger className="h-7 w-full text-xs" aria-label="Mood">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MOODS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="secondary" className="h-7 text-[11px]" asChild>
          <a href={GEMINI_URL} target="_blank" rel="noopener noreferrer">
            <Sparkles className="size-3" /> Gemini
          </a>
        </Button>
        <Button size="sm" variant="secondary" className="h-7 text-[11px]" onClick={() => copyMusicPrompt({ ...prefs, title, seconds: timelineDuration(timeline) })}>
          <ClipboardCopy className="size-3" /> Copy prompt
        </Button>
      </div>
    </div>
  );
}
