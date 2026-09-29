"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { findClip } from "@/lib/timeline/derive";
import type { AssetDTO } from "@/lib/client/upload";
import { MediaLibrary } from "@/components/media/MediaLibrary";
import { StockSearch } from "@/components/media/StockSearch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditor } from "../store";
import { addPayload, dragProps, replaceClipMedia, stockToAsset } from "../dnd";
import { AiImagePanel } from "./AiImagePanel";

function replaceWith(asset: AssetDTO) {
  const s = useEditor.getState();
  if (s.replaceTarget && replaceClipMedia(s.replaceTarget, asset)) {
    s.setReplaceTarget(null);
    toast.success("Media replaced");
  }
}

export function MediaPanel() {
  const assetsMap = useEditor((s) => s.assets);
  const aspect = useEditor((s) => s.timeline.aspect);
  const replaceTarget = useEditor((s) => s.replaceTarget);
  const targetName = useEditor((s) => (s.replaceTarget ? findClip(s.timeline, s.replaceTarget)?.clip : null));
  const [tab, setTab] = useState("library");
  const assets = Object.values(assetsMap).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const setAssets = (fn: (a: AssetDTO[] | null) => AssetDTO[] | null) => useEditor.getState().setAssets(fn(assets) ?? []);
  // Uploads made inside the editor go straight onto the timeline (or into the clip being replaced).
  const onUploaded = (a: AssetDTO) => {
    const s = useEditor.getState();
    if (s.replaceTarget) return replaceWith(a);
    if (a.type === "audio") return toast.success(`${a.name} saved to your library`);
    const at = a.type === "music" ? 0 : s.playhead;
    addPayload({ kind: "asset", asset: a }, null, at)
      .then(() => toast.success(`${a.name} added to the timeline at ${at.toFixed(1)}s`, { description: "Drag it to move, or undo with Ctrl+Z" }))
      .catch((e) => toast.error(e.message));
  };
  const add = (a: AssetDTO) => addPayload({ kind: "asset", asset: a }, null, useEditor.getState().playhead).catch((e) => toast.error(e.message));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {replaceTarget && (
        <div className="m-3 mb-0 flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 p-2 text-xs">
          <span className="min-w-0 flex-1 truncate">
            Pick new media for <b>{targetName && "name" in targetName ? targetName.name : "clip"}</b>
          </span>
          <Button variant="ghost" size="icon" className="size-6" onClick={() => useEditor.getState().setReplaceTarget(null)} aria-label="Cancel">
            <X />
          </Button>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0 p-3">
        <TabsList className="w-full">
          <TabsTrigger value="library">My media</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="ai">AI image</TabsTrigger>
        </TabsList>
        <TabsContent value="ai" className="min-h-0 flex-1 overflow-y-auto pt-3">
          <AiImagePanel onPick={(a) => (replaceTarget ? replaceWith(a) : add(a))} replacing={Boolean(replaceTarget)} />
        </TabsContent>
        <TabsContent value="library" className="min-h-0 flex-1 overflow-y-auto pt-3">
          <MediaLibrary
            compact
            assets={assets}
            setAssets={setAssets}
            onAdd={replaceTarget ? undefined : add}
            highlight={replaceTarget ?? undefined}
            onUploaded={onUploaded}
            itemProps={(a) =>
              replaceTarget ? { onClick: () => replaceWith(a) } : a.type === "audio" && a.source === "sample" ? {} : dragProps({ kind: "asset", asset: a })
            }
          />
        </TabsContent>
        <TabsContent value="stock" className="min-h-0 flex-1 overflow-y-auto pt-3">
          <StockSearch
            aspect={aspect}
            highlight={Boolean(replaceTarget)}
            onAdd={replaceTarget ? undefined : (item, query) => addPayload({ kind: "stock", item, query }, null, useEditor.getState().playhead).catch((e) => toast.error(e.message))}
            itemProps={(item, query) =>
              replaceTarget
                ? {
                    onClick: async () => {
                      try {
                        const asset = await stockToAsset(item, query);
                        useEditor.getState().setAssets([asset, ...assets]);
                        replaceWith(asset);
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    },
                  }
                : dragProps({ kind: "stock", item, query })
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
