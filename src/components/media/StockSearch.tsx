"use client";

import { useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import type { StockItemDTO } from "@/components/editor/dnd";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function StockSearch({
  aspect,
  onAdd,
  itemProps,
  highlight,
}: {
  aspect?: string;
  onAdd?: (item: StockItemDTO, query: string) => void;
  itemProps?: (item: StockItemDTO, query: string) => Record<string, unknown>;
  highlight?: boolean;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"video" | "image">("video");
  const [state, setState] = useState<{ loading: boolean; items: StockItemDTO[]; configured: boolean; query: string }>({ loading: false, items: [], configured: true, query: "" });

  const search = async (query = q, t = type) => {
    if (!query.trim()) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const r = await api<{ configured: boolean; items: StockItemDTO[] }>(`/api/pexels?q=${encodeURIComponent(query)}&type=${t}${aspect ? `&aspect=${encodeURIComponent(aspect)}` : ""}`);
      setState({ loading: false, items: r.items, configured: r.configured, query });
    } catch (e) {
      toast.error((e as Error).message);
      setState((s) => ({ ...s, loading: false }));
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Pexels, e.g. city at night" className="h-8 pl-8 text-xs" />
      </form>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["video", "image"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={cn("rounded-md py-1 text-xs", type === t ? "bg-background shadow" : "text-muted-foreground")}
            onClick={() => {
              setType(t);
              search(q, t);
            }}
          >
            {t === "video" ? "Videos" : "Photos"}
          </button>
        ))}
      </div>
      {!state.configured && <p className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-200">Stock search needs PEXELS_API_KEY on the server (free at pexels.com/api).</p>}
      {state.loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {state.items.map((it) => (
            <div key={it.id} {...(itemProps?.(it, state.query) ?? {})} className={cn("group relative overflow-hidden rounded-md border", highlight && "cursor-pointer hover:ring-2 hover:ring-primary")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.thumb} alt="" className="aspect-video w-full object-cover" loading="lazy" draggable={false} />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] text-white">
                {it.duration ? `${it.duration}s · ` : ""}
                {it.author}
              </span>
              {onAdd && (
                <Button
                  size="icon"
                  className="absolute top-1 right-1 size-6 opacity-0 shadow group-hover:opacity-100"
                  aria-label="Add at playhead"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(it, state.query);
                  }}
                >
                  <Plus />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {state.items.length > 0 && <p className="text-[10px] text-muted-foreground">Videos and photos provided by Pexels.</p>}
    </div>
  );
}
