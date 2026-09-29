// Client-side video engine: draws a storyboard onto a <canvas> at any time `t`,
// and records it (plus optional voiceover audio) to a video file with MediaRecorder.
import type { Scene } from "./types";
import { sceneDuration } from "./timing";

export type Images = Map<string, HTMLImageElement | HTMLVideoElement | null>;
export type Timeline = { start: number; end: number }[];

const FADE = 0.35;
const FONT = `"Inter", "Segoe UI", system-ui, -apple-system, sans-serif`;

export function buildTimeline(scenes: Scene[], durations?: number[]): { timeline: Timeline; total: number } {
  let t = 0;
  const timeline = scenes.map((s, i) => {
    const d = durations?.[i] ?? s.durationSec;
    const seg = { start: t, end: t + d };
    t += d;
    return seg;
  });
  return { timeline, total: t };
}

export function sceneAt(timeline: Timeline, t: number) {
  const i = timeline.findIndex((seg) => t < seg.end);
  return i === -1 ? timeline.length - 1 : i;
}

// Loads each scene's visual. Clips are fetched whole into blob URLs so seeking is
// instant and exact (and the canvas stays exportable).
export async function loadImages(scenes: Scene[]): Promise<Images> {
  const map: Images = new Map();
  const blobs = new Map<string, Promise<string | null>>();
  const blobUrl = (url: string) => {
    if (!blobs.has(url)) {
      blobs.set(
        url,
        fetch(url)
          .then((r) => (r.ok ? r.blob() : null))
          .then((b) => (b ? URL.createObjectURL(b) : null))
          .catch(() => null),
      );
    }
    return blobs.get(url)!;
  };
  await Promise.all(
    scenes.map(async (s) => {
      if (!s.mediaUrl) return map.set(s.id, null);
      if (s.mediaType === "video") {
        const src = await blobUrl(s.mediaUrl);
        if (!src) return map.set(s.id, null);
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.loop = true;
        video.preload = "auto";
        const ok = await new Promise<boolean>((resolve) => {
          video.onloadeddata = () => resolve(true);
          video.onerror = () => resolve(false);
          video.src = src;
        });
        if (ok) video.currentTime = s.clipStart ?? 0;
        return map.set(s.id, ok ? video : null);
      }
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          map.set(s.id, img);
          resolve();
        };
        img.onerror = () => {
          map.set(s.id, null);
          resolve();
        };
        img.src = s.mediaUrl!;
      });
    }),
  );
  return map;
}

// Stops clips and frees their blob URLs.
export function disposeImages(images: Images) {
  const urls = new Set<string>();
  images.forEach((el) => {
    if (el instanceof HTMLVideoElement) {
      el.pause();
      urls.add(el.src);
      el.removeAttribute("src");
      el.load();
    }
  });
  urls.forEach((u) => u.startsWith("blob:") && URL.revokeObjectURL(u));
}

// Where in the clip a scene should be `local` seconds in (loops from the trim point).
function clipTime(scene: Scene, video: HTMLVideoElement, local: number) {
  const full = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : scene.clipDuration ?? 0;
  const start = Math.min(scene.clipStart ?? 0, Math.max(0, full - 0.1));
  const len = full - start;
  if (len <= 0.15) return start;
  return start + (local % len);
}

// Drives every clip to match timeline time `t`: the visible scene(s) play (or sit
// on the right frame while paused), the next one is cued at its trim point.
export function syncVideos(scenes: Scene[], images: Images, timeline: Timeline, t: number, playing: boolean) {
  if (!scenes.length) return;
  const i = sceneAt(timeline, t);
  scenes.forEach((scene, k) => {
    const el = images.get(scene.id);
    if (!(el instanceof HTMLVideoElement)) return;
    const seg = timeline[k];
    const local = t - seg.start;
    const visible = k === i || (k === i - 1 && t - timeline[i].start < FADE);
    el.muted = !scene.clipAudio;
    el.volume = el.dataset.routed ? 1 : Math.min(1, Math.max(0, scene.clipVolume ?? 1));
    if (!visible) {
      if (!el.paused) el.pause();
      const cue = clipTime(scene, el, 0);
      if (k === i + 1 && !el.seeking && Math.abs(el.currentTime - cue) > 0.1) el.currentTime = cue;
      return;
    }
    const target = clipTime(scene, el, Math.max(0, local));
    if (playing) {
      if (el.paused) el.play().catch(() => {});
      if (!el.seeking && Math.abs(el.currentTime - target) > 0.35) el.currentTime = target;
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - target) > 0.04) el.currentTime = target;
    }
  });
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  scene: Scene,
  img: HTMLImageElement | HTMLVideoElement | null | undefined,
  local: number,
  dur: number,
  index: number,
) {
  const p = Math.min(1, local / dur);
  if (img instanceof HTMLVideoElement && img.readyState >= 2) {
    // Real footage: cover-fit, no Ken Burns.
    const scale = Math.max(W / img.videoWidth, H / img.videoHeight);
    const w = img.videoWidth * scale;
    const h = img.videoHeight * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  } else if (img instanceof HTMLVideoElement) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
  } else if (img) {
    // Ken Burns: slow zoom with a gentle pan, direction alternating per scene.
    const zoom = 1.04 + 0.1 * p;
    const scale = Math.max(W / img.width, H / img.height) * zoom;
    const w = img.width * scale;
    const h = img.height * scale;
    const dir = index % 2 === 0 ? 1 : -1;
    const x = (W - w) / 2 + dir * (p - 0.5) * (w - W) * 0.6;
    const y = (H - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  } else {
    const [a, b] = scene.palette;
    const angle = (local * 0.25 + index) % (Math.PI * 2);
    const g = ctx.createLinearGradient(
      W / 2 + Math.cos(angle) * W,
      H / 2 + Math.sin(angle) * H,
      W / 2 - Math.cos(angle) * W,
      H / 2 - Math.sin(angle) * H,
    );
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Floating soft blobs for depth.
    for (let k = 0; k < 3; k++) {
      const r = Math.min(W, H) * (0.35 + 0.1 * k);
      const cx = W * (0.2 + 0.3 * k) + Math.sin(local * 0.6 + k * 2) * W * 0.08;
      const cy = H * (0.25 + 0.25 * k) + Math.cos(local * 0.5 + k) * H * 0.05;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, "rgba(255,255,255,0.18)");
      rg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
    if (scene.emoji) {
      const size = Math.min(W, H) * 0.28;
      ctx.save();
      ctx.font = `${size}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.95;
      ctx.fillText(scene.emoji, W / 2, H * 0.5 + Math.sin(local * 2) * size * 0.05);
      ctx.restore();
    }
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function drawHeadline(ctx: CanvasRenderingContext2D, W: number, H: number, text: string, local: number) {
  if (!text) return;
  const base = Math.min(W, H);
  const size = base * 0.075;
  const pop = Math.min(1, local / 0.25);
  const scale = 0.85 + 0.15 * (1 - Math.pow(1 - pop, 3));
  ctx.save();
  ctx.globalAlpha = pop;
  ctx.translate(W / 2, H * 0.2);
  ctx.scale(scale, scale);
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrap(ctx, text.toUpperCase(), W * 0.82);
  const lh = size * 1.15;
  lines.forEach((l, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    const w = ctx.measureText(l).width;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, -w / 2 - size * 0.3, y - lh / 2, w + size * 0.6, lh, size * 0.2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(l, 0, y + size * 0.04);
  });
  ctx.restore();
}

function drawCaptions(ctx: CanvasRenderingContext2D, W: number, H: number, narration: string, p: number) {
  const words = narration.split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const current = Math.min(words.length - 1, Math.floor(p * words.length));
  const chunkSize = 5;
  const chunkStart = Math.floor(current / chunkSize) * chunkSize;
  const chunk = words.slice(chunkStart, chunkStart + chunkSize);
  const base = Math.min(W, H);
  const size = base * 0.062;
  ctx.save();
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.18;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  // Lay out words manually so the active word can be highlighted.
  const space = ctx.measureText(" ").width;
  const rows: { word: string; idx: number; w: number }[][] = [[]];
  let rowW = 0;
  chunk.forEach((word, k) => {
    const w = ctx.measureText(word).width;
    if (rowW + w > W * 0.86 && rows[rows.length - 1].length) {
      rows.push([]);
      rowW = 0;
    }
    rows[rows.length - 1].push({ word, idx: chunkStart + k, w });
    rowW += w + space;
  });
  const lh = size * 1.25;
  const y0 = H * 0.78 - ((rows.length - 1) * lh) / 2;
  rows.forEach((row, r) => {
    const total = row.reduce((a, x) => a + x.w, 0) + space * (row.length - 1);
    let x = W / 2 - total / 2;
    for (const item of row) {
      const active = item.idx === current;
      ctx.fillStyle = active ? "#facc15" : "#ffffff";
      ctx.strokeText(item.word, x, y0 + r * lh);
      ctx.fillText(item.word, x, y0 + r * lh);
      x += item.w + space;
    }
  });
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export type DrawOpts = { watermark: boolean };

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  scenes: Scene[],
  images: Images,
  timeline: Timeline,
  total: number,
  t: number,
  opts: DrawOpts,
) {
  ctx.clearRect(0, 0, W, H);
  if (!scenes.length) return;
  const i = sceneAt(timeline, t);
  const seg = timeline[i];
  const scene = scenes[i];
  const local = t - seg.start;
  const dur = seg.end - seg.start;

  // Crossfade from the previous scene.
  if (i > 0 && local < FADE) {
    const prev = timeline[i - 1];
    drawBackground(ctx, W, H, scenes[i - 1], images.get(scenes[i - 1].id), t - prev.start, prev.end - prev.start, i - 1);
    ctx.globalAlpha = local / FADE;
  }
  drawBackground(ctx, W, H, scene, images.get(scene.id), local, dur, i);
  ctx.globalAlpha = 1;

  // Readability scrims.
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  top.addColorStop(0, "rgba(0,0,0,0.45)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.4);
  const bottom = ctx.createLinearGradient(0, H * 0.55, 0, H);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(1, "rgba(0,0,0,0.65)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  drawHeadline(ctx, W, H, scene.onScreen, local);
  drawCaptions(ctx, W, H, scene.narration, local / dur);

  // Progress bar.
  const barH = Math.max(4, H * 0.005);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(0, 0, W, barH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W * Math.min(1, t / total), barH);

  if (opts.watermark) {
    const size = Math.min(W, H) * 0.03;
    ctx.save();
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText("Made with ReelSmith", W - size, H - size);
    ctx.restore();
  }
}

export function pickMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) ?? "";
}

export type ExportOptions = {
  scenes: Scene[];
  W: number;
  H: number;
  watermark: boolean;
  // Fetches one MP3 per scene; omit for a silent, captioned export.
  fetchVoice?: (text: string) => Promise<ArrayBuffer>;
  onProgress?: (fraction: number, label: string) => void;
};

export async function exportVideo(opts: ExportOptions): Promise<{ blob: Blob; ext: string }> {
  const { scenes, W, H, watermark, fetchVoice, onProgress } = opts;
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error("Your browser can't record video. Please use a recent Chrome, Edge, or Firefox.");

  onProgress?.(0, "Loading visuals");
  const images = await loadImages(scenes);

  const clipsWithSound = scenes.filter((s) => s.clipAudio && images.get(s.id) instanceof HTMLVideoElement);
  const audioCtx: AudioContext | null = fetchVoice || clipsWithSound.length ? new AudioContext() : null;
  let buffers: (AudioBuffer | null)[] = [];
  let durations: number[] | undefined;
  if (fetchVoice && audioCtx) {
    buffers = [];
    for (let k = 0; k < scenes.length; k++) {
      onProgress?.(k / scenes.length / 4, `Generating voiceover ${k + 1}/${scenes.length}`);
      try {
        buffers.push(await audioCtx.decodeAudioData(await fetchVoice(scenes[k].narration)));
      } catch (e) {
        disposeImages(images);
        await audioCtx.close();
        throw e;
      }
    }
    // Let each scene last as long as its spoken line (plus a breath), unless its length was set by hand.
    durations = scenes.map((s, k) =>
      s.customDuration ? sceneDuration(s) : Math.max(2, (buffers[k]?.duration ?? s.durationSec) + 0.3),
    );
  }
  const { timeline, total } = buildTimeline(scenes, durations);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  drawFrame(ctx, W, H, scenes, images, timeline, total, 0, { watermark });

  const stream = canvas.captureStream(30);
  if (audioCtx) {
    const dest = audioCtx.createMediaStreamDestination();
    const t0 = audioCtx.currentTime + 0.15;
    buffers.forEach((buf, k) => {
      if (!buf) return;
      const src = audioCtx!.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      src.start(t0 + timeline[k].start);
    });
    // Clips that keep their own sound are mixed in through a gain (their volume).
    for (const s of clipsWithSound) {
      const el = images.get(s.id) as HTMLVideoElement;
      el.dataset.routed = "1";
      const gain = audioCtx.createGain();
      gain.gain.value = Math.min(1, Math.max(0, s.clipVolume ?? 1));
      audioCtx.createMediaElementSource(el).connect(gain).connect(dest);
    }
    dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  }

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));

  recorder.start(250);
  const startedAt = performance.now() + 150;
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = Math.max(0, (performance.now() - startedAt) / 1000);
      syncVideos(scenes, images, timeline, Math.min(t, total - 0.001), true);
      drawFrame(ctx, W, H, scenes, images, timeline, total, Math.min(t, total - 0.001), { watermark });
      onProgress?.((fetchVoice ? 0.25 : 0) + (fetchVoice ? 0.75 : 1) * Math.min(1, t / total), "Rendering video");
      if (t >= total + 0.2) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  await done;
  stream.getTracks().forEach((track) => track.stop());
  disposeImages(images);
  await audioCtx?.close();

  const type = mimeType.split(";")[0];
  return { blob: new Blob(chunks, { type }), ext: type === "video/mp4" ? "mp4" : "webm" };
}
