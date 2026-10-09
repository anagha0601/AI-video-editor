// Canvas compositor for the preview. Mirrors worker/render.py + worker/ass.py:
// same placement math, color matrix, Ken Burns window, transitions (xfade
// fade/slideleft/zoomin/fadewhite), beat effects, text layout (line height = (asc+desc)*px) and captions.
import {
  activeWordIndex,
  adjacentPrev,
  CAPTION_PRESETS,
  captionLines,
  clamp,
  clipEnd,
  colorOps,
  enhanceCurve,
  enhanceTable,
  fadeGain,
  fadeWhiteWeights,
  fxAt,
  gradeSaturation,
  gradeTable,
  gradeVignetteAt,
  GRADE_VIGNETTE,
  hasGrade,
  kenBurnsAt,
  placement,
  smoothstep,
  textAnimState,
  type CaptionLine,
  type WordState,
} from "@/lib/timeline/derive";
import { FONTS, cssFont } from "@/lib/timeline/fonts";
import type { Enhance, Filters, Grade, TextClip, Timeline, VideoTrack, VisualClip } from "@/lib/timeline/types";

export interface FrameSource {
  /** Drawable for a visual clip, or null while loading. */
  source(clip: VisualClip): { el: CanvasImageSource; w: number; h: number } | null;
  /** The clip's person matte (white = keep), synced with source(); null when off or loading. */
  matte?(clip: VisualClip): { el: CanvasImageSource; w: number; h: number } | null;
}

// Background swap: the clip is drawn on its own layer, then masked by the matte's luminance (render: alphamerge).
let layer: HTMLCanvasElement | null = null;
function matteLayer(W: number, H: number) {
  if (!layer) layer = document.createElement("canvas");
  if (layer.width !== W || layer.height !== H) [layer.width, layer.height] = [W, H];
  const c = layer.getContext("2d")!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, W, H);
  return { canvas: layer, c };
}
function lumaToAlpha() {
  if (!document.getElementById("rs-luma-alpha")) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    svg.innerHTML = `<filter id="rs-luma-alpha" color-interpolation-filters="sRGB"><feColorMatrix type="luminanceToAlpha"/></filter>`;
    document.body.appendChild(svg);
  }
  return "url(#rs-luma-alpha)";
}

// ---------------------------------------------------------------- color filters

const filterIds = new Map<string, string>();

/**
 * An SVG filter matching the render: the Enhance color/match curve (lutrgb, as a table) first, then the
 * clip's filters (feComponentTransfer + feColorMatrix = lutrgb + colorchannelmixer). Stabilise, denoise,
 * sharpen and upscale are only shown in the Enhance panel's before/after preview.
 */
function filterUrl(f: Filters, enh?: Enhance | null, grade?: Grade | null): string | null {
  const ops = colorOps(f);
  const cv = enhanceCurve(enh);
  const gr = hasGrade(grade) ? grade : null;
  if (ops.identity && !cv && !gr) return null;
  const tables = cv ? ([0, 1, 2] as const).map((c) => enhanceTable(cv, c).join(" ")) : null;
  const gTables = gr ? ([0, 1, 2] as const).map((c) => gradeTable(gr, c).join(" ")) : null;
  const key = `${ops.slope.toFixed(4)}|${ops.intercept.toFixed(4)}|${ops.matrix.map((v) => v.toFixed(4)).join(",")}|${tables?.join("/") ?? ""}|${gTables?.join("/") ?? ""}`;
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
    const enhanceStage = tables
      ? `<feComponentTransfer>${(["R", "G", "B"] as const).map((ch, i) => `<feFunc${ch} type="table" tableValues="${tables[i]}"/>`).join("")}</feComponentTransfer>`
      : "";
    // the look (worker/grade.py) comes last, after Enhance and the clip's filters, like the render
    const gradeStage =
      gr && gTables
        ? `<feComponentTransfer>${(["R", "G", "B"] as const).map((ch, i) => `<feFunc${ch} type="table" tableValues="${gTables[i]}"/>`).join("")}</feComponentTransfer>` +
          `<feColorMatrix type="saturate" values="${gradeSaturation(gr).toFixed(4)}"/>`
        : "";
    svg.insertAdjacentHTML(
      "beforeend",
      `<filter id="${id}" color-interpolation-filters="sRGB">${enhanceStage}<feComponentTransfer>${fn("R")}${fn("G")}${fn("B")}</feComponentTransfer>` +
        `<feColorMatrix type="matrix" values="${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0"/>${gradeStage}</filter>`,
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
  const frame = ctx.getTransform(); // the vignette stays fixed to the frame (render: after zoompan)
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
      const f = filterUrl(clip.filters, clip.enhance, clip.grade);
      const m = clip.type === "video" ? (src.matte?.(clip) ?? null) : null;
      if (m && m.w && m.h) {
        // the look's vignette darkens the clip only (render: on the clip's colour, alpha untouched)
        const { canvas, c } = matteLayer(W, H);
        if (f) c.filter = f;
        c.drawImage(s.el, p.x, p.y, p.w, p.h);
        c.filter = "none";
        if (hasGrade(clip.grade)) drawVignette(c, new DOMMatrix(), W, H, clip.grade);
        c.globalCompositeOperation = "destination-in";
        c.filter = lumaToAlpha();
        c.drawImage(m.el, p.x, p.y, p.w, p.h);
        c.filter = "none";
        ctx.drawImage(canvas, 0, 0);
      } else {
        if (f) ctx.filter = f;
        ctx.drawImage(s.el, p.x, p.y, p.w, p.h);
        ctx.filter = "none";
        if (hasGrade(clip.grade)) drawVignette(ctx, frame, W, H, clip.grade);
      }
    }
  }
  ctx.restore();
}

/** The look's vignette: elliptical like worker/grade.py (r = hypot(dx/(W/2), dy/(H/2)) / sqrt 2). */
function drawVignette(ctx: CanvasRenderingContext2D, frame: DOMMatrix, W: number, H: number, g: Grade) {
  ctx.save();
  ctx.setTransform(frame);
  ctx.translate(W / 2, H / 2);
  ctx.scale(W / 2, H / 2);
  const R = Math.SQRT2 * GRADE_VIGNETTE.r1;
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  for (let i = 0; i <= 12; i++) {
    const r = (i / 12) * GRADE_VIGNETTE.r1;
    grad.addColorStop(i / 12, `rgba(0,0,0,${gradeVignetteAt(g, r).toFixed(4)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(-1, -1, 2, 2);
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
  } else if (tr.type === "flash") {
    // xfade fadewhite: wA * prev + wB * clip + wW * white
    const { wA, wB, wW } = fadeWhiteWeights(p);
    drawVisual(ctx, tl, clip, t, src);
    if (wA + wB > 1e-4) {
      ctx.save();
      ctx.globalAlpha *= wA / (wA + wB);
      drawVisual(ctx, tl, prev, held, src);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha *= wW;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
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
  // Beat effects move the composited picture (render: perspective after the overlays), text stays put.
  const fx = fxAt(tl.fx, t);
  ctx.save();
  if (fx.z > 1 + 1e-4) {
    const W = tl.width;
    const H = tl.height;
    ctx.scale(fx.z, fx.z);
    ctx.translate(-((1 - 1 / fx.z) / 2 + fx.dx) * W, -((1 - 1 / fx.z) / 2 + fx.dy) * H);
  }
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i];
    if (tr.kind === "video") drawVideoTrack(ctx, tl, tr, t, src);
  }
  ctx.restore();
  if (fx.flash > 1e-3) {
    // render: eq brightness (adds to luma)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255,255,255,${fx.flash.toFixed(4)})`;
    ctx.fillRect(0, 0, tl.width, tl.height);
    ctx.restore();
  }
  for (let i = tracks.length - 1; i >= 0; i--) {
    const tr = tracks[i];
    if (tr.kind === "text") for (const c of tr.clips) if (t >= c.start && t < clipEnd(c)) drawTextClip(ctx, tl, c, t);
    if (tr.kind === "captions") drawCaptions(ctx, tl, t);
  }
}
