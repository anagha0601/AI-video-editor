"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDTO } from "@/lib/api";
import { ASPECTS, assetUrl, posterUrl, type AssetRef, type Scene } from "@/lib/types";
import { sceneDuration } from "@/lib/timing";
import { exportVideo } from "@/lib/renderer";
import { MEDIA_ACCEPT, uploadMedia } from "@/lib/upload";
import { Player, type PlayerHandle } from "./Player";

type Props = { initial: ProjectDTO; assets: AssetRef[]; pro: boolean; stockEnabled: boolean; voiceEnabled: boolean };
type SaveState = "saved" | "saving" | "dirty" | "error";

// Scene fields for showing one of the user's uploads.
function mediaPatch(ref: AssetRef): Partial<Scene> {
  return ref.kind === "video"
    ? { mediaUrl: assetUrl(ref.id), mediaType: "video", credit: null, clipStart: 0, clipDuration: ref.duration, clipAudio: false, clipVolume: 1 }
    : { mediaUrl: assetUrl(ref.id), mediaType: "image", credit: null };
}

export function Editor({ initial, assets: initialAssets, pro, stockEnabled, voiceEnabled }: Props) {
  const router = useRouter();
  const player = useRef<PlayerHandle>(null);
  const [project, setProject] = useState(initial);
  const [scenes, setScenes] = useState<Scene[]>(initial.scenes);
  const [assets, setAssets] = useState<AssetRef[]>(initialAssets);
  const [tab, setTab] = useState<"scenes" | "post">("scenes");
  const [active, setActive] = useState(0);
  const [save, setSave] = useState<SaveState>("saved");
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ p: number; label: string } | null>(null);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState<{ message: string; upgrade?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const aspect = ASPECTS.find((a) => a.id === project.aspect) ?? ASPECTS[0];

  const flush = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    setSave("saving");
    const res = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSave(res.ok ? "saved" : "error");
  }, [project.id]);

  // Debounced autosave.
  const queue = useCallback(
    (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      setSave("dirty");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 700);
    },
    [flush],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  function updateScenes(next: Scene[]) {
    const timed = next.map((s) => ({ ...s, durationSec: sceneDuration(s) }));
    setScenes(timed);
    queue({ scenes: timed });
  }

  function updateScene(i: number, patch: Partial<Scene>) {
    updateScenes(scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  }

  function moveScene(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= scenes.length) return;
    const next = [...scenes];
    [next[i], next[j]] = [next[j], next[i]];
    updateScenes(next);
  }

  function addScene(after: number) {
    const base = scenes[after];
    const scene: Scene = {
      id: crypto.randomUUID(),
      narration: "New line of voiceover goes here.",
      onScreen: "New scene",
      visualQuery: base?.visualQuery ?? "abstract light",
      durationSec: 3,
      palette: base?.palette ?? ["#7c3aed", "#db2777"],
      emoji: "✨",
      mediaUrl: null,
      credit: null,
    };
    const next = [...scenes];
    next.splice(after + 1, 0, scene);
    updateScenes(next);
  }

  function removeScene(i: number) {
    if (scenes.length <= 1) return;
    updateScenes(scenes.filter((_, k) => k !== i));
  }

  async function swapVisual(i: number) {
    setBusy(`visual-${i}`);
    setError(null);
    const res = await fetch(`/api/projects/${project.id}/visuals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: scenes[i].visualQuery }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError({ message: data.error ?? "Couldn't find a visual" });
    updateScene(i, { mediaUrl: data.url, mediaType: "image", credit: data.credit });
  }

  async function uploadForScene(i: number, file: File | undefined) {
    if (!file) return;
    setBusy(`upload-${i}`);
    setError(null);
    try {
      const upload = await uploadMedia(file);
      const ref: AssetRef = { id: upload.id, kind: upload.kind, duration: upload.duration };
      const assetIds = [...project.assetIds, ref.id];
      setProject((p) => ({ ...p, assetIds }));
      setAssets((a) => [...a, ref]);
      queue({ assetIds });
      updateScene(i, mediaPatch(ref));
      player.current?.seekToScene(i);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    if (!confirm("Rewrite the whole video with AI? Your scene edits will be replaced.")) return;
    player.current?.pause();
    setBusy("regen");
    setError(null);
    const res = await fetch(`/api/projects/${project.id}/regenerate`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError({ message: data.error ?? "Regeneration failed" });
    setProject(data.project);
    setScenes(data.project.scenes);
    setActive(0);
    player.current?.seekToScene(0);
  }

  async function doExport(withVoice: boolean) {
    player.current?.pause();
    setError(null);
    setDownload(null);
    await flush();
    try {
      setExporting({ p: 0, label: "Preparing" });
      const { blob, ext } = await exportVideo({
        scenes,
        W: aspect.w,
        H: aspect.h,
        watermark: !pro,
        fetchVoice: withVoice
          ? async (text) => {
              const res = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
              });
              if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Voiceover failed");
              return res.arrayBuffer();
            }
          : undefined,
        onProgress: (p, label) => setExporting({ p, label }),
      });
      const url = URL.createObjectURL(blob);
      const name = `${project.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "video"}.${ext}`;
      setDownload({ url, name });
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "exported" }),
      });
      setProject((p) => ({ ...p, status: "exported" }));
      router.refresh();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Export failed" });
    } finally {
      setExporting(null);
    }
  }

  function copyPost() {
    const text = `${project.caption}\n\n${project.hashtags.map((h) => `#${h}`).join(" ")}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const onSceneChange = useCallback((i: number) => setActive(i), []);
  const total = scenes.reduce((a, s) => a + s.durationSec, 0);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Library
          </Link>
          <input
            value={project.title}
            onChange={(e) => {
              setProject({ ...project, title: e.target.value });
              if (e.target.value.trim()) queue({ title: e.target.value });
            }}
            className="mt-1 block w-full truncate bg-transparent text-2xl font-bold outline-none focus:underline decoration-white/20"
            aria-label="Project title"
          />
          <p className="mt-1 text-sm text-zinc-500">
            {aspect.label} · {Math.round(total)}s · {scenes.length} scenes ·{" "}
            <span className={save === "error" ? "text-red-400" : ""}>
              {save === "saved" ? "All changes saved" : save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved" : "Save failed"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={regenerate} disabled={!!busy || !!exporting} className="btn-ghost">
            {busy === "regen" ? "Rewriting…" : "↻ Regenerate with AI"}
          </button>
          {pro && voiceEnabled ? (
            <>
              <button onClick={() => doExport(false)} disabled={!!exporting} className="btn-ghost">
                Export silent
              </button>
              <button onClick={() => doExport(true)} disabled={!!exporting} className="btn-primary">
                ⬇ Export with AI voice
              </button>
            </>
          ) : (
            <button onClick={() => doExport(false)} disabled={!!exporting} className="btn-primary">
              ⬇ Export video
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span>{error.message}</span>
          <button onClick={() => setError(null)} className="text-red-300/70 hover:text-red-200">
            ✕
          </button>
        </div>
      )}
      {download && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <span>
            Video exported. Copy your caption from the <b>Post</b> tab and upload it.
          </span>
          <a href={download.url} download={download.name} className="font-semibold underline">
            Download again
          </a>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Player ref={player} scenes={scenes} W={aspect.w} H={aspect.h} watermark={!pro} onSceneChange={onSceneChange} />
          {!pro && (
            <p className="mt-4 text-center text-xs text-zinc-500">
              Free exports include a small watermark.{" "}
              <Link href="/billing" className="text-brand-400 hover:underline">
                Go Pro
              </Link>{" "}
              for clean exports{voiceEnabled ? " with AI voiceover" : ""}.
            </p>
          )}
          {pro && !voiceEnabled && (
            <p className="mt-4 text-center text-xs text-zinc-500">
              Add ELEVENLABS_API_KEY to bake an AI voiceover into exports.
            </p>
          )}
        </div>

        <div>
          <div className="mb-4 flex gap-1 rounded-xl bg-white/5 p-1">
            {(["scenes", "post"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium capitalize transition ${
                  tab === t ? "bg-zinc-800 text-white shadow" : "text-zinc-400 hover:text-white"
                }`}
              >
                {t === "scenes" ? `Scenes (${scenes.length})` : "Post copy"}
              </button>
            ))}
          </div>

          {tab === "scenes" ? (
            <ol className="space-y-3">
              {scenes.map((s, i) => (
                <li
                  key={s.id}
                  className={`card p-4 transition ${active === i ? "border-brand-500/60 ring-1 ring-brand-500/30" : ""}`}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <button
                      onClick={() => player.current?.seekToScene(i)}
                      className="flex items-center gap-2 text-sm font-semibold hover:text-brand-400"
                      title="Preview this scene"
                    >
                      <span
                        className="grid h-7 w-7 place-items-center rounded-lg text-xs"
                        style={{ background: `linear-gradient(135deg, ${s.palette[0]}, ${s.palette[1]})` }}
                      >
                        {i + 1}
                      </span>
                      Scene {i + 1}
                      <span className="font-normal text-zinc-500">· {s.durationSec.toFixed(1)}s</span>
                    </button>
                    <div className="ml-auto flex gap-1 text-zinc-500">
                      <IconBtn label="Move up" onClick={() => moveScene(i, -1)} disabled={i === 0}>
                        ↑
                      </IconBtn>
                      <IconBtn label="Move down" onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1}>
                        ↓
                      </IconBtn>
                      <IconBtn label="Add scene after" onClick={() => addScene(i)}>
                        +
                      </IconBtn>
                      <IconBtn label="Delete scene" onClick={() => removeScene(i)} disabled={scenes.length <= 1}>
                        ✕
                      </IconBtn>
                    </div>
                  </div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">On-screen text</label>
                  <input value={s.onScreen} onChange={(e) => updateScene(i, { onScreen: e.target.value })} className="input mb-3 font-semibold" maxLength={120} />
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Voiceover</label>
                  <textarea
                    value={s.narration}
                    onChange={(e) => updateScene(i, { narration: e.target.value })}
                    rows={2}
                    maxLength={600}
                    className="input mb-3 resize-y"
                  />
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Visual</label>
                  <div className="flex gap-2">
                    <input
                      value={s.visualQuery}
                      onChange={(e) => updateScene(i, { visualQuery: e.target.value })}
                      className="input"
                      placeholder="e.g. city skyline night"
                      maxLength={120}
                    />
                    {stockEnabled && (
                      <button onClick={() => swapVisual(i)} disabled={busy === `visual-${i}`} className="btn-ghost shrink-0">
                        {busy === `visual-${i}` ? "…" : "Find"}
                      </button>
                    )}
                    {s.mediaUrl && (
                      <button
                        onClick={() => updateScene(i, { mediaUrl: null, mediaType: undefined, credit: null })}
                        className="btn-ghost shrink-0"
                        title="Use gradient background"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {assets.map((ref, k) => {
                      const url = assetUrl(ref.id);
                      return (
                        <button
                          key={ref.id}
                          onClick={() => {
                            if (s.mediaUrl === url) return;
                            updateScene(i, mediaPatch(ref));
                            player.current?.seekToScene(i);
                          }}
                          className={`relative h-10 w-10 overflow-hidden rounded-md ring-2 transition ${
                            s.mediaUrl === url ? "ring-brand-500" : "ring-transparent opacity-70 hover:opacity-100"
                          }`}
                          title={ref.kind === "video" ? `Use clip ${k + 1} (${ref.duration.toFixed(1)}s)` : `Use photo ${k + 1}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={posterUrl(ref.id)} alt="" className="h-full w-full object-cover" />
                          {ref.kind === "video" && (
                            <span className="absolute inset-0 grid place-items-center bg-black/30 text-[10px] text-white">▶</span>
                          )}
                        </button>
                      );
                    })}
                    <label
                      className={`grid h-10 cursor-pointer place-items-center rounded-md border border-dashed border-white/15 px-2.5 text-xs text-zinc-400 hover:border-brand-500 hover:text-white ${
                        busy === `upload-${i}` ? "pointer-events-none opacity-50" : ""
                      }`}
                    >
                      {busy === `upload-${i}` ? "Uploading…" : "↑ Upload photo or clip"}
                      <input
                        type="file"
                        accept={MEDIA_ACCEPT}
                        hidden
                        onChange={(e) => {
                          uploadForScene(i, e.target.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {s.credit && <p className="mt-1.5 text-[11px] text-zinc-600">{s.credit}</p>}
                  {s.mediaType === "video" && s.mediaUrl && (
                    <ClipControls
                      scene={s}
                      onChange={(patch) => {
                        updateScene(i, patch);
                        if ("clipStart" in patch) player.current?.seekToScene(i);
                      }}
                    />
                  )}
                  <LengthControl scene={s} onChange={(customDuration) => updateScene(i, { customDuration })} />
                </li>
              ))}
            </ol>
          ) : (
            <div className="card space-y-4 p-5">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Caption</label>
                <textarea
                  value={project.caption}
                  onChange={(e) => {
                    setProject({ ...project, caption: e.target.value });
                    queue({ caption: e.target.value });
                  }}
                  rows={4}
                  className="input resize-y"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Hashtags</label>
                <input
                  value={project.hashtags.map((h) => `#${h}`).join(" ")}
                  onChange={(e) => {
                    const tags = e.target.value.split(/[\s,]+/).map((h) => h.replace(/^#+/, "")).filter(Boolean);
                    setProject({ ...project, hashtags: tags });
                    queue({ hashtags: tags });
                  }}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Original prompt</label>
                <p className="whitespace-pre-wrap rounded-xl bg-white/5 p-3 text-sm text-zinc-400">{project.prompt}</p>
              </div>
              <button onClick={copyPost} className="btn-ghost w-full">
                {copied ? "✓ Copied" : "Copy caption + hashtags"}
              </button>
            </div>
          )}
        </div>
      </div>

      {exporting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="card w-full max-w-sm p-6 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-brand-500" />
            <h3 className="font-semibold">{exporting.label}…</h3>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-gradient-to-r from-brand-600 to-accent-500 transition-all" style={{ width: `${Math.round(exporting.p * 100)}%` }} />
            </div>
            <p className="mt-3 text-xs text-zinc-500">Rendering happens in real time in your browser — keep this tab open and visible.</p>
          </div>
        </div>
      )}
    </div>
  );
}

const fieldLabel = "text-[11px] font-semibold uppercase tracking-wider text-zinc-500";

// Trim point + original sound for a scene that shows one of the user's clips.
function ClipControls({ scene, onChange }: { scene: Scene; onChange: (patch: Partial<Scene>) => void }) {
  const full = scene.clipDuration ?? 0;
  const start = Math.min(scene.clipStart ?? 0, Math.max(0, full - 0.5));
  const loops = full > 0 && full - start < scene.durationSec - 0.05;
  return (
    <div className="mt-3 space-y-2 rounded-xl bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <span className={`${fieldLabel} w-16 shrink-0`}>Trim</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, full - 0.5)}
          step={0.1}
          value={start}
          disabled={full <= 0.5}
          onChange={(e) => onChange({ clipStart: Number(e.target.value) })}
          className="flex-1 accent-brand-500"
          aria-label="Clip start"
        />
        <span className="w-28 shrink-0 text-right text-xs tabular-nums text-zinc-400">
          from {start.toFixed(1)}s of {full.toFixed(1)}s
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className={`${fieldLabel} w-16 shrink-0`}>Sound</span>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={!!scene.clipAudio}
            onChange={(e) => onChange({ clipAudio: e.target.checked })}
            className="accent-brand-500"
          />
          Keep clip audio
        </label>
        {scene.clipAudio && (
          <>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={scene.clipVolume ?? 1}
              onChange={(e) => onChange({ clipVolume: Number(e.target.value) })}
              className="flex-1 accent-brand-500"
              aria-label="Clip volume"
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-400">
              {Math.round((scene.clipVolume ?? 1) * 100)}%
            </span>
          </>
        )}
      </div>
      {loops && <p className="text-[11px] text-zinc-500">The clip is shorter than this scene from the trim point, so it loops.</p>}
    </div>
  );
}

// Scene length: follows the voiceover by default, or set by hand.
function LengthControl({ scene, onChange }: { scene: Scene; onChange: (customDuration: number | null) => void }) {
  const manual = !!scene.customDuration;
  const remaining = scene.mediaType === "video" && scene.clipDuration ? scene.clipDuration - (scene.clipStart ?? 0) : 0;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <span className={`${fieldLabel} w-16 shrink-0`}>Length</span>
      <div className="flex shrink-0 gap-1 rounded-lg bg-white/5 p-0.5 text-xs">
        <button
          onClick={() => onChange(null)}
          className={`rounded-md px-2 py-1 ${!manual ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`}
          title="Fit the voiceover"
        >
          Auto
        </button>
        <button
          onClick={() => !manual && onChange(scene.durationSec)}
          className={`rounded-md px-2 py-1 ${manual ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"}`}
        >
          Custom
        </button>
        {remaining >= 1 && (
          <button
            onClick={() => onChange(Math.min(20, Math.round(remaining * 10) / 10))}
            className="rounded-md px-2 py-1 text-zinc-400 hover:text-white"
          >
            Match clip
          </button>
        )}
      </div>
      {manual && (
        <input
          type="range"
          min={1}
          max={20}
          step={0.1}
          value={scene.customDuration!}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-24 flex-1 accent-brand-500"
          aria-label="Scene length"
        />
      )}
      <span className="shrink-0 text-xs tabular-nums text-zinc-400">{scene.durationSec.toFixed(1)}s</span>
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded-lg text-sm hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
