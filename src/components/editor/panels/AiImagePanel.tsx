"use client";

import { useState } from "react";
import { Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import type { AssetDTO } from "@/lib/client/upload";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEditor } from "../store";
import { dragProps } from "../dnd";

export async function generateImage(prompt: string, tags: string[] = []) {
  const aspect = useEditor.getState().timeline.aspect;
  const { asset } = await api<{ asset: AssetDTO }>("/api/media/generate", { method: "POST", json: { prompt, aspect, tags } });
  const s = useEditor.getState();
  s.setAssets([asset, ...Object.values(s.assets)]);
  return asset;
}

/** Text prompt -> AI image (Gemini) in the library; click or drag to use it. */
export function AiImagePanel({ onPick, replacing }: { onPick: (a: AssetDTO) => void; replacing: boolean }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<AssetDTO[]>([]);

  const run = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const a = await generateImage(prompt.trim());
      setMade((m) => [a, ...m]);
      if (replacing) onPick(a);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            run();
          }
        }}
        rows={4}
        placeholder="Describe the shot, e.g. a runner on a misty mountain trail at sunrise, wide angle"
        className="text-sm"
      />
      <Button className="w-full" onClick={run} disabled={busy || !prompt.trim()}>
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy ? "Generating… (~10s)" : replacing ? "Generate & replace" : "Generate image"}
      </Button>
      <p className="text-[11px] text-muted-foreground">Images match the project&apos;s aspect ratio and are saved to your library. Tip: select a clip and use “Generate with AI” to make one from what&apos;s being said.</p>
      <div className="grid grid-cols-2 gap-2">
        {made.map((a) => (
          <div key={a.id} {...dragProps({ kind: "asset", asset: a })} className="group relative overflow-hidden rounded-md border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt="" className="aspect-[9/16] w-full object-cover" draggable={false} />
            <div className="absolute inset-x-1 bottom-1 flex gap-1 opacity-0 group-hover:opacity-100">
              <Button size="sm" className="h-6 flex-1 text-[11px]" onClick={() => onPick(a)}>
                {replacing ? <RefreshCw /> : <Plus />} {replacing ? "Use" : "Add"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
