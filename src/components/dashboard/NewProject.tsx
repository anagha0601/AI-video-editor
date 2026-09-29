"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileAudio, Loader2, Mic, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { uploadFile } from "@/lib/client/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Recorder } from "./Recorder";

const ASPECTS = [
  { id: "9:16", label: "Vertical", hint: "TikTok · Reels · Shorts", w: 9, h: 16 },
  { id: "16:9", label: "Landscape", hint: "YouTube", w: 16, h: 9 },
  { id: "1:1", label: "Square", hint: "Feed posts", w: 1, h: 1 },
] as const;

export function NewProject() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]["id"]>("9:16");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [tab, setTab] = useState("upload");
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const voice = tab === "upload" ? file : recording;

  const create = async () => {
    if (!voice) return;
    setProgress(0);
    try {
      const { project } = await api<{ project: { id: string } }>("/api/projects", { method: "POST", json: { title: title.trim() || undefined, aspect } });
      const ext = voice.type.includes("mp4") ? "m4a" : voice.type.includes("webm") ? "webm" : "audio";
      const name = file && tab === "upload" ? file.name : `recording.${ext}`;
      const url = await uploadFile(voice, name, "voice", setProgress);
      await api(`/api/projects/${project.id}/voice`, {
        method: "POST",
        json: { url, name, mime: voice.type, source: tab === "record" ? "recording" : "upload" },
      });
      router.push(`/projects/${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setProgress(null);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New video</h1>
        <p className="text-sm text-muted-foreground">Your voice drives everything: timing, captions, scene cuts.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Title (optional — we can suggest one)</Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 3 habits of calm people" maxLength={100} />
      </div>

      <div className="space-y-2">
        <Label>Format</Label>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAspect(a.id)}
              className={cn("flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition sm:p-4", aspect === a.id ? "border-primary bg-primary/10" : "hover:border-white/25")}
            >
              <span className="flex h-14 items-center">
                <span className={cn("block rounded-sm border-2", aspect === a.id ? "border-primary" : "border-muted-foreground")} style={{ width: a.w >= a.h ? 48 : (48 * a.w) / a.h, height: a.h >= a.w ? 48 : (48 * a.h) / a.w }} />
              </span>
              <span className="text-sm font-medium">
                {a.label} <span className="text-muted-foreground">{a.id}</span>
              </span>
              <span className="hidden text-[11px] text-muted-foreground sm:block">{a.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Voiceover</Label>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="upload">
              <Upload /> Upload
            </TabsTrigger>
            <TabsTrigger value="record">
              <Mic /> Record
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) setFile(f);
              }}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center hover:border-white/30"
            >
              <FileAudio className="size-8 text-muted-foreground" />
              {file ? (
                <>
                  <span className="text-sm font-medium">{file.name}</span>
                  <span className="text-xs text-muted-foreground">{(file.size / 1e6).toFixed(1)} MB · click to change</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium">Drop an audio or video file</span>
                  <span className="text-xs text-muted-foreground">MP3, M4A, WAV, WebM, MP4, MOV… we only use the sound</span>
                </>
              )}
            </button>
            <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </TabsContent>
          <TabsContent value="record">
            <Recorder onRecorded={setRecording} />
          </TabsContent>
        </Tabs>
      </div>

      <div className="space-y-2">
        <Button size="lg" className="brand-gradient w-full text-white" disabled={!voice || progress !== null} onClick={create}>
          {progress !== null ? <Loader2 className="animate-spin" /> : null}
          {progress !== null ? `Uploading ${Math.round(progress * 100)}%` : "Create first cut"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Next: transcription with word timings, AI scene split, visuals, captions — usually under a minute.</p>
      </div>
    </div>
  );
}
