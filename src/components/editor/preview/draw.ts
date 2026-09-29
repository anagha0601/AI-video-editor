// Canvas compositor for the preview. Mirrors worker/render.py + worker/ass.py:
// same placement math, color matrix, Ken Burns window, transitions (xfade
// fade/slideleft/zoomin), text layout (line height = (asc+desc)*px) and captions.
import {
  activeWordIndex,
  adjacentPrev,
  CAPTION_PRESETS,
  captionLines,
  clamp,
  clipEnd,
  colorOps,
  fadeGain,
  kenBurnsAt,
  placement,
  smoothstep,
  textAnimState,
  type CaptionLine,
  type WordState,
} from "@/lib/timeline/derive";
import { FONTS, cssFont } from "@/lib/timeline/fonts";
import type { Filters, TextClip, Timeline, VideoTrack, VisualClip } from "@/lib/timeline/types";

export interface FrameSource {
  /** Drawable for a visual clip, or null while loading. */
  source(clip: VisualClip): { el: CanvasImageSource; w: number; h: number } | null;
}

// ---------------------------------------------------------------- color filters

const filterIds = new Map<string, string>();

/** An SVG filter (feComponentTransfer + feColorMatrix) matching lutrgb + colorchannelmixer. */
function filterUrl(f: Filters): string | null {
  const ops = colorOps(f);
  if (ops.identity) return null;
  const key = `${ops.slope.toFixed(4)}|${ops.intercept.toFixed(4)}|${ops.matrix.map((v) => v.toFixed(4)).join(",")}`;
  let id = filterIds.get(key);
  if (!id) {
    id = `rsfx${filterIds.size}`;
    filterIds.set(key, id);
    let svg = document.getElementById("rs-filters") as unknown as SVGSVGElement | null;
    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.id = "rs-filters";
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      document.body.appendChild(svg);
    }
    const m = ops.matrix;
    const fn = (ch: string) => `<feFunc${ch} type="linear" slope="${ops.slope}" intercept="${ops.intercept}"/>`;
    svg.insertAdjacentHTML(
      "beforeend",
      `<filter id="${id}" color-interpolation-filters="sRGB"><feComponentTransfer>${fn("R")}${fn("G")}${fn("B")}</feComponentTransfer>` +
        `<feColorMatrix type="matrix" values="${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0"/></filter>`,
    );
  }
  return `url(#${id})`;
}

// ---------------------------------------------------------------- visuals

function drawVisual(ctx: CanvasRenderingContext2D, tl: Timeline, clip: VisualClip, t: number, src: FrameSource) {
  const W = tl.width;
  const H = tl.height;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.globalAlpha *= fadeGain(clip, clamp(t, clip.start, clipEnd(clip) - 1e-3));
  if (clip.type === "image" && clip.kenBurns) {
    const p = clamp((t - clip.start) / Math.max(clip.duration, 1e-3), 0, 1);
    const { z, fx, fy } = kenBurnsAt(clip.kenBurns, p);
    const x0 = (W - W / z) * fx;
    const y0 = (H - H / z) * fy;
    ctx.scale(z, z);
    ctx.translate(-x0, -y0);
  }
  if (clip.type === "color") {
    const [c0, c1] = clip.colors ?? ["#111827", "#6d28d9"];
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    const f = filterUrl(clip.filters);
    if (f) ctx.filter = f;
    ctx.fillRect(0, 0, W, H);
    ctx.filter = "none";
  } else {
    const s = src.source(clip);
    if (s && s.w && s.h) {
      const p = placement(s.w, s.h, W, H, clip.transform);
      const f = filterUrl(clip.filters);
      if (f) ctx.filter = f;
      ctx.drawImage(s.el, p.x, p.y, p.w, p.h);
      ctx.filter = "none";
    }
  }
  ctx.restore();
}

function drawVideoTrack(ctx: CanvasRenderingContext2D, tl: Timeline, track: VideoTrack, t: number, src: FrameSource) {
  const clip = track.clips.find((c) => t >= c.start && t < clipEnd(c));
  if (!clip) return;
  const tr = clip.transition;
  const prev = tr && tr.type !== "cut" ? adjacentPrev(track.clips, clip) : null;
  const d = tr ? Math.min(tr.duration, clip.duration * 0.95) : 0;
  if (!prev || !tr || t >= clip.start + d) return drawVisual(ctx, tl, clip, t, src);

  const p = clamp((t - clip.start) / d, 0, 1);
  const held = clipEnd(prev) - 1e-3; // previous clip holds its last frame
  const W = tl.width;
  const H = tl.height;
  if (tr.type === "crossfade") {
    drawVisual(ctx, tl, prev, held, src);
    ctx.save();
    ctx.globalAlpha *= p;
    drawVisual(ctx, tl, clip, t, src);
    ctx.restore();
  } else if (tr.type === "slide") {
    ctx.save();
    ctx.translate(-p * W, 0);
    drawVisual(ctx, tl, prev, held, src);
    ctx.restore();
    ctx.save();
    ctx.translate((1 - p) * W, 0);
    drawVisual(ctx, tl, clip, t, src);
    ctx.restore();
  } else {
    // xfade zoomin: A zooms toward the center (zf = smoothstep(.5,1,P)) while mixing into B.
    const P = 1 - p;
    const zf = smoothstep(0.5, 1, P);
    const wA = smoothstep(0, 0.5, P);
    drawVisual(ctx, tl, clip, t, src);
    ctx.save();
    ctx.globalAlpha *= wA;
    const s = 1 / Math.max(zf, 0.03);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    drawVisual(ctx, tl, prev, held, src);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- text

function drawTextClip(ctx: CanvasRenderingContext2D, tl: Timeline, clip: TextClip, t: number) {
  const st = clip.style;
  const F = FONTS[st.font];
  const px = st.size;
  const lines = (st.uppercase ? clip.text.toUpperCase() : clip.text).split("\n");
  if (!lines.join("").trim()) return;
  const anim = textAnimState(clip, t);
  const lineH = (F.asc + F.desc) * px;
  ctx.save();
  ctx.globalAlpha *= anim.alpha;
  ctx.translate(st.x * tl.width, st.y * tl.height + anim.dy);
  ctx.scale(anim.scale, anim.scale);
  ctx.font = cssFont(st.font, px);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const top0 = (-lines.length * lineH) / 2;
  if (st.background) {
    const pad = Math.max(4, Math.round(px * 0.25));
    ctx.save();
    ctx.globalAlpha *= 0.85;
    ctx.fillStyle = st.background;
    lines.forEach((line, i) => {
      if (!line) return;
      const w = ctx.measureText(line).width;
      ctx.fillRect(-w / 2 - pad, top0 + i * lineH - pad, w + pad * 2, lineH + pad * 2);
    });
    ctx.restore();
  }
  lines.forEach((line, i) => {
    const y = top0 + i * lineH + F.asc * px;
    if (!st.background && st.shadow > 0) {
      ctx.save();
      ctx.fillStyle = ctx.strokeStyle = "rgba(0,0,0,0.5)";
      if (st.outline > 0) {
        ctx.lineWidth = st.outline * 2;
        ctx.strokeText(line, st.shadow, y + st.shadow);
      }
      ctx.fillText(line, st.shadow, y + st.shadow);
      ctx.restore();
    }
    if (!st.background && st.outline > 0) {
      ctx.lineWidth = st.outline * 2;
      ctx.strokeStyle = st.outlineColor;
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = st.color;
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}

// ---------------------------------------------------------------- captions

const linesCache = new WeakMap<Timeline, CaptionLine[]>();
export function cachedCaptionLines(tl: Timeline) {
  let lines = linesCache.get(tl);
  if (!lines) {
    lines = captionLines(tl);
    linesCache.set(tl, lines);
  }
  return lines;
}

function drawCaptions(ctx: CanvasRenderingContext2D, tl: Timeline, t: number) {
  const cap = tl.captions;
  if (!cap.enabled) return;
  const line = cachedCaptionLines(tl).find((l) => t >= l.start && t < l.end);
  if (!line) return;
  const look = CAPTION_PRESETS[cap.style].look(cap.size);
  const F = FONTS[look.font];
  const px = look.size;
  const lineH = (F.asc + F.desc) * px;
  const active = Math.max(0, activeWordIndex(line, t));
  ctx.save();
  ctx.font = cssFont(look.font, px);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const words = line.words.map((w) => (look.uppercase ? w.text.toUpperCase() : w.text));
  const widths = words.map((w) => ctx.measureText(w).width);
  const space = ctx.measureText(" ").width;
  const total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  const x0 = tl.width / 2 - total / 2;
  const top = cap.y * tl.height - lineH / 2;
  const baseline = top + F.asc * px;
  if (look.box) {
    ctx.save();
    ctx.globalAlpha = look.box.opacity;
    ctx.fillStyle = look.box.color;
    ctx.fillRect(x0 - look.box.pad, top - look.box.pad, total + look.box.pad * 2, lineH + look.box.pad * 2);
    ctx.restore();
  }
  let x = x0;
  words.forEach((word, i) => {
    const state: WordState = i < active ? "past" : i === active ? "active" : "future";
    const { color, opacity } = look.word[state];
    if (look.shadow > 0) {
      ctx.fillStyle = ctx.strokeStyle = "rgba(0,0,0,0.5)";
      if (look.outline > 0) {
        ctx.lineWidth = look.outline * 2;
        ctx.strokeText(word, x + look.shadow, baseline + look.shadow);
      }
      ctx.fillText(word, x + look.shadow, baseline + look.shadow);
    }
    if (look.outline > 0) {
      ctx.lineWidth = look.outline * 2;
      ctx.strokeStyle = look.outlineColor;
      ctx.strokeText(word, x, baseline);
    }
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.fillText(word, x, baseline);
    ctx.globalAlpha = 1;
    x += widths[i] + space;
  });
  ctx.restore();
}

// ---------------------------------------------------------------- frame

/** Draw the frame at time t in design coordinates (caller scales the context). */
export function drawFrame(ctx: CanvasRenderingContext2D, tl: Timeline, t: number, src: FrameSource) {
  ctx.fillStyle = tl.background || "#000";
  ctx.fillRect(0, 0, tl.width, tl.height);
  const tracks = tl.tracks.filter((tr) => !tr.hidden);
  // Video tracks bottom-up, then text/captions bottom-up (text is burned in last in the render).
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i];
    if (tr.kind === "video") drawVideoTrack(ctx, tl, tr, t, src);
  }
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i];
    if (tr.kind === "text") for (const c of tr.clips) if (t >= c.start && t < clipEnd(c)) drawTextClip(ctx, tl, c, t);
    if (tr.kind === "captions") drawCaptions(ctx, tl, t);
  }
}
