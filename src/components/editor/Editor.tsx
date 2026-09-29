"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Captions, Check, CloudOff, FolderOpen, Loader2, Redo2, SlidersHorizontal, Sparkles, Type, Undo2, Waves } from "lucide-react";
import { toast } from "sonner";
import type { Timeline as TL } from "@/lib/timeline/types";
import { api } from "@/lib/client/api";
import type { AssetDTO } from "@/lib/client/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditor } from "./store";
import { useAutosave, useShortcuts } from "./hooks";
import { uploadAndAdd } from "./dnd";
import { Player } from "./preview/Player";
import { Timeline } from "./timeline/Timeline";
import { Inspector } from "./panels/Inspector";
import { MediaPanel } from "./panels/MediaPanel";
import { TextPanel } from "./panels/TextPanel";
import { CaptionsPanel } from "./panels/CaptionsPanel";
import { AudioPanel } from "./panels/AudioPanel";
import { AiPanel } from "./panels/AiPanel";
import { VersionsDialog } from "./VersionsDialog";
import { ExportDialog } from "./ExportDialog";

const PANELS = [
  { id: "media", label: "Media", icon: FolderOpen },
  { id: "text", label: "Text", icon: Type },
  { id: "captions", label: "Captions", icon: Captions },
  { id: "audio", label: "Audio", icon: Waves },
  { id: "ai", label: "AI edit", icon: Sparkles },
  { id: "inspect", label: "Edit", icon: SlidersHorizontal, narrowOnly: true },
] as const;

export function Editor({ project, timeline, revision }: { project: { id: string; title: string }; timeline: TL; revision: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useEditor.getState().init({ projectId: project.id, title: project.title, timeline, revision });
    setReady(true);
    api<{ assets: AssetDTO[] }>("/api/media")
      .then((r) => useEditor.getState().setAssets(r.assets))
      .catch((e) => toast.error(e.message));
  }, [project.id, project.title, timeline, revision]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <EditorInner />;
}

function EditorInner() {
  useAutosave();
  useShortcuts();
  const panel = useEditor((s) => s.panel);
  const setPanel = useEditor((s) => s.setPanel);
  const selection = useEditor((s) => s.selection);
  const [fileOver, setFileOver] = useState(false);

  // On narrow screens the inspector lives in the left panel; jump to it on selection.
  useEffect(() => {
    if (selection.length && window.innerWidth < 1280 && useEditor.getState().panel !== "ai") setPanel("inspect");
  }, [selection, setPanel]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-2">
          {PANELS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPanel(p.id)}
              className={cn(
                "flex w-12 flex-col items-center gap-0.5 rounded-md py-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground",
                panel === p.id && "bg-muted text-foreground",
                "narrowOnly" in p && "xl:hidden",
              )}
            >
              <p.icon className="size-4" />
              {p.label}
            </button>
          ))}
        </nav>
        <aside className="w-72 shrink-0 overflow-y-auto border-r lg:w-80">
          {panel === "media" && <MediaPanel />}
          {panel === "text" && <TextPanel />}
          {panel === "captions" && <CaptionsPanel />}
          {panel === "audio" && <AudioPanel />}
          {panel === "ai" && <AiPanel />}
          {panel === "inspect" && <Inspector />}
        </aside>
        <main
          className={cn("relative min-w-0 flex-1 bg-[radial-gradient(ellipse_at_center,rgba(124,58,237,0.08),transparent_70%)] p-3", fileOver && "ring-2 ring-primary ring-inset")}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setFileOver(true);
          }}
          onDragLeave={() => setFileOver(false)}
          onDrop={(e) => {
            setFileOver(false);
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            uploadAndAdd(e.dataTransfer.files, null, useEditor.getState().playhead);
          }}
        >
          <Player />
          {fileOver && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-medium">Drop to add at the playhead</div>
          )}
        </main>
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l xl:block">
          <Inspector />
        </aside>
      </div>
      <div className="h-[36%] min-h-[210px] shrink-0 border-t">
        <Timeline />
      </div>
    </div>
  );
}

function TopBar() {
  const title = useEditor((s) => s.title);
  const projectId = useEditor((s) => s.projectId);
  const save = useEditor((s) => s.save);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useEditor((s) => s.future[0]?.label);
  const { undo, redo, setTitle } = useEditor.getState();

  const rename = async (t: string) => {
    const v = t.trim();
    if (!v || v === title) return;
    setTitle(v);
    try {
      await api(`/api/projects/${projectId}`, { method: "PATCH", json: { title: v } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
      <Button variant="ghost" size="icon" asChild>
        <Link href="/dashboard" aria-label="Back to projects">
          <ArrowLeft />
        </Link>
      </Button>
      <Input
        defaultValue={title}
        key={title}
        onBlur={(e) => rename(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-8 max-w-64 border-transparent bg-transparent text-sm font-medium shadow-none hover:border-input focus-visible:border-input"
        aria-label="Project title"
      />
      <SaveBadge state={save} />
      <div className="ml-auto flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!canUndo} onClick={undo} aria-label="Undo">
              <Undo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo {undoLabel ?? ""} (⌘/Ctrl Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" disabled={!canRedo} onClick={redo} aria-label="Redo">
              <Redo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo {redoLabel ?? ""} (⌘/Ctrl Shift Z)</TooltipContent>
        </Tooltip>
        <VersionsDialog />
        <ExportDialog />
      </div>
    </header>
  );
}

function SaveBadge({ state }: { state: string }) {
  const map: Record<string, { text: string; icon: React.ReactNode; cls?: string }> = {
    saved: { text: "Saved", icon: <Check className="size-3" /> },
    dirty: { text: "Unsaved", icon: <span className="size-1.5 rounded-full bg-amber-400" /> },
    saving: { text: "Saving…", icon: <Loader2 className="size-3 animate-spin" /> },
    error: { text: "Save failed", icon: <CloudOff className="size-3" />, cls: "text-destructive" },
    conflict: { text: "Changed elsewhere", icon: <CloudOff className="size-3" />, cls: "text-amber-400" },
  };
  const m = map[state] ?? map.saved;
  return <span className={cn("hidden items-center gap-1 text-xs text-muted-foreground sm:flex", m.cls)}>{m.icon}{m.text}</span>;
}
