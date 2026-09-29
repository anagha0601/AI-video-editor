"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileAudio, ImagePlus, Lightbulb, Loader2, Mic, PenLine, Sparkles, Upload, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { uploadAsset, uploadFile, type AssetDTO } from "@/lib/client/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { Recorder } from "./Recorder";

const ASPECTS = [
  { id: "9:16", label: "Vertical", hint: "TikTok · Reels · Shorts", w: 9, h: 16 },
  { id: "16:9", label: "Landscape", hint: "YouTube", w: 16, h: 9 },
  { id: "1:1", label: "Square", hint: "Feed posts", w: 1, h: 1 },
] as const;

const VOICES = [
  { id: "Kore", label: "Kore — warm, clear (female)" },
  { id: "Puck", label: "Puck — upbeat (male)" },
  { id: "Charon", label: "Charon — deep, calm (male)" },
  { id: "Aoede", label: "Aoede — breezy (female)" },
  { id: "Fenrir", label: "Fenrir — energetic (male)" },
  { id: "Leda", label: "Leda — youthful (female)" },
];
const TONES = ["engaging", "educational", "inspiring", "funny", "calm", "dramatic"];
const LENGTHS = [15, 30, 45, 60, 90];
const EXAMPLES = [
  "3 habits of calm, focused people",
  "Why you should drink water before coffee",
  "A 30-second tour of Kyoto in autumn",
  "How compound interest quietly makes you rich",
];

type Source = "idea" | "script" | "voice";
type Attached = { key: number; name: string; progress: number; asset?: AssetDTO; preview?: string };

export function NewProject({ gemini, pexels }: { gemini: boolean; pexels: boolean }) {
  const router = useRouter();
  const [source, setSource] = useState<Source>(gemini ? "idea" : "voice");
  const [title, setTitle] = useState("");
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]["id"]>("9:16");
  // idea / script
  const [idea, setIdea] = useState("");
  const [script, setScript] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [tone, setTone] = useState("engaging");
  const [voiceName, setVoiceName] = useState("Kore");
  const [writing, setWriting] = useState(false);
  const [usageIds, setUsageIds] = useState<string[]>([]);
  // voice
  const [voiceTab, setVoiceTab] = useState("upload");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState<Blob | null>(null);
  // visuals
  const [attached, setAttached] = useState<Attached[]>([]);
  const [visualMode, setVisualMode] = useState<"auto" | "ai" | "stock">(gemini ? "auto" : "stock");
  // submit
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);

  const voiceBlob = voiceTab === "upload" ? file : recording;
  const uploading = attached.some((a) => !a.asset);
  const ready =
    !busy &&
    !uploading &&
    (source === "voice" ? Boolean(voiceBlob) : source === "script" ? script.trim().length > 10 : idea.trim().length > 2 || script.trim().length > 10);

  const writeScript = async () => {
    if (!idea.trim()) return;
    setWriting(true);
    try {
      const r = await api<{ title: string; script: string; usageIds: string[] }>("/api/script", { method: "POST", json: { idea, seconds, tone } });
      setUsageIds((u) => [...u, ...r.usageIds]);
      setScript(r.script);
      if (!title.trim()) setTitle(r.title);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWriting(false);
    }
  };

  const addMedia = (files: FileList | null) => {
    if (!files) return;
    for (const f of [...files]) {
      if (!/^(image|video)\//.test(f.type)) {
        toast.error(`${f.name}: only photos and videos here`);
        continue;
      }
      const key = Math.random();
      const preview = f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined;
      setAttached((list) => [...list, { key, name: f.name, progress: 0, preview }]);
      uploadAsset(f, "auto", (p) => setAttached((list) => list.map((x) => (x.key === key ? { ...x, progress: p } : x))))
        .then((asset) => setAttached((list) => list.map((x) => (x.key === key ? { ...x, asset, progress: 1 } : x))))
        .catch((e) => {
          toast.error(`${f.name}: ${(e as Error).message}`);
          setAttached((list) => list.filter((x) => x.key !== key));
        });
    }
  };

  const create = async () => {
    try {
      let finalScript = script.trim();
      const ids = [...usageIds];
      if (source === "idea" && !finalScript) {
        setBusy("Writing your script…");
        const r = await api<{ title: string; script: string; usageIds: string[] }>("/api/script", { method: "POST", json: { idea, seconds, tone } });
        ids.push(...r.usageIds);
        finalScript = r.script;
        if (!title.trim()) setTitle(r.title);
      }
      setBusy("Creating project…");
      const { project } = await api<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        json: {
          title: title.trim() || undefined,
          aspect,
          mode: source,
          prompt: source === "idea" ? idea : source === "script" ? finalScript : undefined,
          visualMode,
          assetIds: attached.map((a) => a.asset?.id).filter(Boolean),
          usageIds: ids,
        },
      });
      if (source === "voice") {
        const blob = voiceBlob!;
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("webm") ? "webm" : "audio";
        const name = file && voiceTab === "upload" ? file.name : `recording.${ext}`;
        const url = await uploadFile(blob, name, "voice", (p) => setBusy(`Uploading ${Math.round(p * 100)}%`));
        await api(`/api/projects/${project.id}/voice`, { method: "POST", json: { url, name, mime: blob.type, source: voiceTab === "record" ? "recording" : "upload" } });
      } else {
        setBusy("Recording the AI voiceover…");
        await api(`/api/projects/${project.id}/narrate`, { method: "POST", json: { script: finalScript, voice: voiceName, tone } });
      }
      router.push(`/projects/${project.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };

  const words = script.trim() ? script.trim().split(/\s+/).length : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New video</h1>
        <p className="text-sm text-muted-foreground">Start from an idea, a script, or your own voice. You can edit everything afterwards.</p>
      </div>

      {/* ------------------------------------------------ source */}
      <Tabs value={source} onValueChange={(v) => setSource(v as Source)}>
        <TabsList className="grid h-auto w-full grid-cols-3">
          <TabsTrigger value="idea" className="py-2" disabled={!gemini}>
            <Lightbulb /> Idea
          </TabsTrigger>
          <TabsTrigger value="script" className="py-2" disabled={!gemini}>
            <PenLine /> Script
          </TabsTrigger>
          <TabsTrigger value="voice" className="py-2">
            <Mic /> My voice
          </TabsTrigger>
        </TabsList>

        <TabsContent value="idea" className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="idea">What&apos;s your video about?</Label>
            <Textarea
              id="idea"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Describe your idea, audience, key points, call to action… The more detail, the better the script."
              className="min-h-44 resize-y text-base leading-relaxed"
              maxLength={4000}
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => setIdea(ex)} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground">
                  {ex}
                </button>
              ))}
            </div>
          </div>
          <NarrationOptions {...{ seconds, setSeconds, tone, setTone, voiceName, setVoiceName }} showLength />
          <div className="space-y-2 rounded-xl border bg-card/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <Label>Script</Label>
              <Button size="sm" variant="secondary" onClick={writeScript} disabled={writing || !idea.trim()}>
                {writing ? <Loader2 className="animate-spin" /> : <Wand2 />} {script ? "Rewrite" : "Write script"}
              </Button>
            </div>
            {script ? (
              <>
                <Textarea value={script} onChange={(e) => setScript(e.target.value)} className="min-h-48 resize-y text-base leading-relaxed" />
                <p className="text-xs text-muted-foreground">
                  {words} words · about {Math.round(words / 2.4)}s spoken. Edit freely; this is exactly what the AI voice will say.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Preview and edit the script before creating, or skip this and we&apos;ll write it for you.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="script" className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="script">Your script</Label>
            <Textarea
              id="script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="Paste or write the exact words for the voiceover."
              className="min-h-64 resize-y text-base leading-relaxed"
              maxLength={6000}
            />
            <p className="text-xs text-muted-foreground">{words ? `${words} words · about ${Math.round(words / 2.4)}s spoken` : "Tip: short sentences read best."}</p>
          </div>
          <NarrationOptions {...{ seconds, setSeconds, tone, setTone, voiceName, setVoiceName }} />
        </TabsContent>

        <TabsContent value="voice" className="pt-4">
          <Tabs value={voiceTab} onValueChange={setVoiceTab}>
            <TabsList className="w-full">
              <TabsTrigger value="upload">
                <Upload /> Upload recording
              </TabsTrigger>
              <TabsTrigger value="record">
                <Mic /> Record now
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
        </TabsContent>
      </Tabs>

      {/* ------------------------------------------------ visuals */}
      <div className="space-y-3">
        <Label>Your photos & videos (optional)</Label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addMedia(e.dataTransfer.files);
          }}
          className="rounded-xl border border-dashed p-3"
        >
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {attached.map((a) => (
              <div key={a.key} className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                {a.preview || a.asset?.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.preview ?? a.asset!.thumbUrl!} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center p-1 text-center text-[10px] text-muted-foreground">{a.name}</div>
                )}
                {!a.asset && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white">
                    <Loader2 className="mr-1 size-3 animate-spin" /> {Math.round(a.progress * 100)}%
                  </div>
                )}
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => setAttached((list) => list.filter((x) => x.key !== a.key))}
                  className="absolute top-1 right-1 rounded-full bg-black/70 p-0.5 text-white"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => mediaRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs text-muted-foreground hover:border-primary hover:text-foreground"
            >
              <ImagePlus className="size-5" /> Add
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">These are used first and matched to the scenes they fit. Drop files here or click Add.</p>
          <input ref={mediaRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={(e) => (addMedia(e.target.files), (e.target.value = ""))} />
        </div>

        <Label className="pt-2">For scenes without your media</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { id: "auto", title: "Best available", body: pexels ? "Your library, then stock video, then AI images" : "Your library, then AI images", disabled: !gemini && !pexels },
              { id: "ai", title: "AI-generated images", body: "A custom image for every scene, in one consistent style", disabled: !gemini },
              { id: "stock", title: "Stock footage", body: pexels ? "Real video clips from Pexels" : "Needs PEXELS_API_KEY", disabled: !pexels },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={o.disabled}
              onClick={() => setVisualMode(o.id)}
              className={cn("rounded-xl border p-3 text-left transition disabled:opacity-40", visualMode === o.id ? "border-primary bg-primary/10" : "hover:border-white/25")}
            >
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {o.id === "ai" && <Sparkles className="size-3.5 text-violet-400" />}
                {o.title}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{o.body}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------ format + title */}
      <div className="grid gap-6 sm:grid-cols-[1fr_1.3fr]">
        <div className="space-y-2">
          <Label htmlFor="title">Title (optional)</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="We'll suggest one" maxLength={100} />
        </div>
        <div className="space-y-2">
          <Label>Format</Label>
          <div className="grid grid-cols-3 gap-2">
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAspect(a.id)}
                title={a.hint}
                className={cn("flex items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm transition", aspect === a.id ? "border-primary bg-primary/10" : "hover:border-white/25")}
              >
                <span className={cn("block rounded-[3px] border-2", aspect === a.id ? "border-primary" : "border-muted-foreground")} style={{ width: a.w >= a.h ? 20 : (20 * a.w) / a.h, height: a.h >= a.w ? 20 : (20 * a.h) / a.w }} />
                {a.id}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 pb-10">
        <Button size="lg" className="brand-gradient w-full text-white" disabled={!ready} onClick={create}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {busy ?? (uploading ? "Waiting for uploads…" : "Create video")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {source === "voice" ? "Next: transcription with word timings" : "Next: AI voiceover, word timings"}, scene split, visuals and captions, then the editor.
        </p>
      </div>
    </div>
  );
}

function NarrationOptions({
  seconds,
  setSeconds,
  tone,
  setTone,
  voiceName,
  setVoiceName,
  showLength,
}: {
  seconds: number;
  setSeconds: (n: number) => void;
  tone: string;
  setTone: (s: string) => void;
  voiceName: string;
  setVoiceName: (s: string) => void;
  showLength?: boolean;
}) {
  return (
    <div className={cn("grid gap-3", showLength ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {showLength && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Length</Label>
          <Select value={String(seconds)} onValueChange={(v) => setSeconds(Number(v))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LENGTHS.map((l) => (
                <SelectItem key={l} value={String(l)}>
                  ~{l} seconds
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Tone</Label>
        <Select value={tone} onValueChange={setTone}>
          <SelectTrigger className="w-full capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">AI voice</Label>
        <Select value={voiceName} onValueChange={setVoiceName}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VOICES.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
