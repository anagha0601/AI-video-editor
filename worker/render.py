"""Timeline JSON -> ffmpeg filter graph -> MP4.

Video: every video track becomes one RGBA stream (clips normalized to the frame,
gaps transparent, transitions via xfade with the previous clip holding its last
frame), tracks are overlaid bottom-up on the background color, then text overlays
and captions are burned in from an ASS file. Audio: voice/music/video-clip audio
is trimmed, retimed, delayed into place, gain-automated (fades, keyframes, ducking)
and mixed. Frame counts are computed from timeline seconds exactly the way the
preview does (round(t * fps)).
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import color
import enhance
import grade
from ass import build_ass
from audio_master import master as master_audio
from quality import render_check as quality_check
from media import ffmpeg_bin, filter_script_args, probe
from timeline import (DUCK_RAMP, adjacent_prev, clip_end, color_ops, fx_exprs, fx_groups, ken_burns_exprs,
                      placement, source_out, speech_intervals, timeline_duration)

XFADE = {"crossfade": "fade", "slide": "slideleft", "zoom": "zoomin", "flash": "fadewhite"}
QUALITY = {"720p": 720, "1080p": 1080}


def output_size(tl, quality: str):
    short = QUALITY.get(quality, 1080)
    W, H = tl["width"], tl["height"]
    f = short / min(W, H)
    return int(round(W * f / 2) * 2), int(round(H * f / 2) * 2)


def _num(v: float) -> str:
    return f"{v:.4f}".rstrip("0").rstrip(".") if isinstance(v, float) else str(v)


def _ffcolor(hex_color: str) -> str:
    return "0x" + (hex_color or "#000000").lstrip("#")[:6]


def _escape_path(p: str) -> str:
    p = p.replace("\\", "/")
    return p.replace(":", "\\:").replace("'", "\\'")


class Graph:
    def __init__(self):
        self.inputs: list[list[str]] = []
        self.lines: list[str] = []
        self.n = 0

    def input(self, args: list[str]) -> int:
        self.inputs.append(args)
        return len(self.inputs) - 1

    def label(self, prefix="s") -> str:
        self.n += 1
        return f"{prefix}{self.n}"

    def add(self, line: str):
        self.lines.append(line)


def _color_filters(clip) -> list[str]:
    f = clip.get("filters")
    if not f:
        return []
    ops = color_ops(f)
    if ops["identity"]:
        return []
    out = []
    slope, icpt = ops["slope"], ops["intercept"] * 255
    if abs(slope - 1) > 1e-3 or abs(icpt) > 1e-3:
        e = f"clip(val*{slope:.5f}+{icpt:.4f},0,255)"
        out.append(f"lutrgb=r='{e}':g='{e}':b='{e}'")
    m = ops["matrix"]
    out.append("colorchannelmixer=" + ":".join(
        f"{k}={m[i]:.5f}" for i, k in enumerate(["rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"])))
    return out


def _rgb_section(filters: list[str], alpha=False) -> list[str]:
    """RGB-domain filters (lutrgb / colorchannelmixer / lut3d) with explicit bt709 conversions both ways."""
    if not filters:
        return []
    # Enhance's curve (lutrgb) may already sit in post_fps; the conversion is explicit here either way
    return ([f"scale=in_color_matrix=bt709:in_range=tv,format={'gbrap' if alpha else 'gbrp'}"] + filters
            + [f"scale=out_color_matrix=bt709:out_range=tv,format={'yuva420p' if alpha else 'yuv420p'}", color.TAG_709])


def _place(w: int, h: int, cw: int, ch: int, tr) -> list[str]:
    """Put a w x h clip on the cw x ch frame at the transform's offset, staying in YUV (transparent padding)."""
    X = int((cw - w) / 2 + tr["x"] * cw)
    Y = int((ch - h) / 2 + tr["y"] * ch)
    px, py, cx, cy = max(0, X), max(0, Y), max(0, -X), max(0, -Y)
    PW, PH = max(px + w, cx + cw), max(py + h, cy + ch)
    out = ["format=yuva420p"]
    if (PW, PH) != (w, h):
        out.append(f"pad={PW}:{PH}:{px}:{py}:color=black@0")
    if (PW, PH) != (cw, ch):
        out.append(f"crop={cw}:{ch}:{cx}:{cy}")
    return out


def _visual_clip(g: Graph, clip, ctx) -> str:
    """Normalized RGBA stream for one visual clip: exactly n frames of Wo x Ho."""
    Wo, Ho, fps = ctx["Wo"], ctx["Ho"], ctx["fps"]
    n = ctx["frames"](clip)
    dur = n / fps
    out = g.label("v")
    chain: list[str] = []
    ctype = clip["type"]
    kb = clip.get("kenBurns") if ctype == "image" else None
    # Ken Burns works on a 2x canvas so the per-frame integer crop doesn't jitter.
    cw, ch = (Wo * 2, Ho * 2) if kb else (Wo, Ho)

    if ctype == "color":
        c0, c1 = (clip.get("colors") or ["#111827", "#6d28d9"])[:2]
        src = g.label("c")
        g.add(f"gradients=s={cw}x{ch}:c0={_ffcolor(c0)}:c1={_ffcolor(c1)}:x0=0:y0=0:x1={cw}:y1={ch}"
              f":nb_colors=2:speed=0:r={fps}:d={_num(dur + 1 / fps)}," + "".join(x + "," for x in _color_filters(clip))
              + f"scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,{color.TAG_709}[{src}]")
        stream = f"[{src}]"
    else:
        enh = clip.get("enhance") or {}
        path = ctx["resolve"](clip["src"])
        tr = clip["transform"]
        image = ctype == "image"
        mt = clip.get("matte") if ctype == "video" else None
        mt = mt if mt and mt.get("on") and mt.get("url") else None
        if mt and (enh.get("stabilize") or {}).get("on"):
            enh = {**enh, "stabilize": None}  # the matte is cut from the unstabilised frames
        if not image:
            # Enhance: read the Real-ESRGAN intermediate instead when upscale is on
            path, t_in = enhance.upscaled_source(enh, path, float(clip["in"]), ctx["resolve"])
            t_len = dur * clip["speed"] + 0.5
            k = g.input(["-ss", _num(t_in), "-t", _num(t_len), "-i", path])
            info = ctx["probe"](path)
            if info["has_audio"] and not clip.get("muted") and clip.get("volume", 1) > 0 and not ctx["track_muted"]:
                ctx["video_audio"].append((k, clip))
        else:
            t_in = t_len = 0.0
            k = g.input(["-loop", "1", "-framerate", str(fps), "-t", _num(dur + 0.5), "-i", path])
        col = color.probe_color(path)
        info = ctx["probe"](path)  # real pixels win over stored metadata (e.g. resized stock photos)
        sw = col.get("width") or info.get("width") or clip.get("srcWidth") or 0
        sh = col.get("height") or info.get("height") or clip.get("srcHeight") or 0
        if not (sw and sh):
            raise RuntimeError(f"can't read the size of {clip.get('name') or path}")
        p = placement(sw, sh, cw, ch, tr)
        w = max(2, int(round(p["w"] / 2) * 2))
        h = max(2, int(round(p["h"] / 2) * 2))
        ctx["sources"].append({"clip": clip.get("name") or clip["id"], "start": clip["start"], "type": ctype,
                               "color": color.describe(col), "hdr": bool(col.get("hdr")),
                               "fps": round(col.get("fps") or 0, 3), "avg_fps": round(col.get("avg_fps") or 0, 3), "upscale": round(w / sw / (2 if kb else 1), 3),
                               "speed": float(clip.get("speed", 1))})
        pre, post_fps, post_scale = enhance.clip_filters(enh, path=path, t_in=t_in, t_len=t_len, src_w=sw,
                                                         workdir=ctx["workdir"], image=image)
        if color.has_alpha(col):
            # overlays with transparency (PNG logos, ProRes 4444 / VP9-alpha graphics): keep alpha end to end
            chain += [f"scale={w}:{h}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv",
                      "format=yuva420p", color.TAG_709]
        elif pre:
            # stabilise at the source size (the transforms are in source pixels), then the one scale
            chain += color.source_chain(col) + pre + [f"zscale=w={w}:h={h}:f=lanczos", color.TAG_709]
        else:
            chain += color.source_chain(col, w, h)  # HDR/P3/601 -> bt709 SDR and the one scale, in one zscale
        if not image:
            chain.append(f"setpts=(PTS-STARTPTS)/{_num(float(clip['speed']))}")
        chain.append(f"fps={fps}")  # the one frame-rate conform
        chain += [x for x in post_fps if not x.startswith("lutrgb")]  # denoise at the placed size (as Enhance measures)
        rgb = [x for x in post_fps if x.startswith("lutrgb")] + _color_filters(clip)  # exposure/WB + match, then filters
        lut = grade.lut_filter(clip.get("grade"), ctx["workdir"])
        if lut:
            rgb.append(lut)
        chain += _rgb_section(rgb, alpha=color.has_alpha(col))
        chain += post_scale  # light unsharp at the final scale
        src = g.label("c")
        if mt:
            # background swap: the person matte (white = keep) through the same timing and scale, as the clip's alpha
            rel = max(0.0, float(clip["in"]) - float(mt.get("srcIn", 0)))
            mk = g.input(["-ss", _num(rel), "-t", _num(dur * clip["speed"] + 0.5), "-i", ctx["resolve"](mt["url"])])
            pic, mat = g.label("mp"), g.label("mm")
            g.add(f"[{k}:v]" + ",".join(chain) + f"[{pic}]")
            g.add(f"[{mk}:v]scale={w}:{h}:flags=bicubic,setpts=(PTS-STARTPTS)/{_num(float(clip['speed']))},fps={fps},"
                  f"scale=in_range=tv:out_range=pc,format=gray[{mat}]")
            g.add(f"[{pic}][{mat}]alphamerge," + ",".join(["setsar=1"] + _place(w, h, cw, ch, tr)) + f"[{src}]")
        else:
            chain.append("setsar=1")
            chain += _place(w, h, cw, ch, tr)
            g.add(f"[{k}:v]" + ",".join(chain) + f"[{src}]")
        stream = f"[{src}]"

    post: list[str] = []
    if kb:
        denom = max(1, n - 1)
        z, fx, fy = ken_burns_exprs(kb, f"(on/{denom})")
        post.append(f"zoompan=z='{z}':x='(iw-iw/zoom)*{fx}':y='(ih-ih/zoom)*{fy}':d=1:s={Wo}x{Ho}:fps={fps}")
    vig = grade.vignette_mask(clip.get("grade"), Wo, Ho, ctx["workdir"]) if ctype != "color" else None
    if vig:
        # multiply the look's vignette onto the frame (alpha untouched), fixed to the frame like the preview
        mk = g.input(["-loop", "1", "-framerate", str(fps), "-i", vig])
        pre_v, mask = g.label("vg"), g.label("vm")
        # planar RGB for both inputs: in YUV the multiply would also scale the chroma planes (green cast)
        g.add(stream + ",".join(post + ["scale=in_color_matrix=bt709:in_range=tv,format=gbrap", "setsar=1"]) + f"[{pre_v}]")
        g.add(f"[{mk}:v]format=gbrap,setsar=1[{mask}]")
        stream = g.label("vv")
        g.add(f"[{pre_v}][{mask}]blend=all_mode=multiply:shortest=1,"
              f"scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,{color.TAG_709}[{stream}]")
        stream = f"[{stream}]"
        post = []
    post.append(f"tpad=stop_mode=clone:stop={n}")
    post.append(f"trim=end_frame={n}")
    post.append("setpts=PTS-STARTPTS")
    post.append("format=yuva420p")
    fi, fo = float(clip.get("fadeIn") or 0), float(clip.get("fadeOut") or 0)
    if fi > 0:
        post.append(f"fade=t=in:s=0:n={max(1, round(fi * fps))}:alpha=1")
    if fo > 0:
        nf = max(1, round(fo * fps))
        post.append(f"fade=t=out:s={max(0, n - nf)}:n={nf}:alpha=1")
    post.append(f"settb=1/{fps},fps={fps}")
    g.add(stream + ",".join(post) + f"[{out}]")
    return out


def _beat_fx(tl, fps: int) -> list[str]:
    """Beat effects on the composited picture (derive.ts fxAt): one perspective (zoom/shake, sub-pixel, cubic) and/or
    eq (flash) per group of overlapping effects, each enabled only inside its window. perspective's `in` is the
    1-based frame number whether or not the filter is enabled, so its time is (in-1)/fps."""
    out = []
    for grp in fx_groups(tl.get("fx"), fps):
        en = f"enable='between(t,{grp['start']:.5f},{grp['end']:.5f})'"
        if any(e["type"] != "flash" for e in grp["fx"]):
            z, dx, dy, _ = fx_exprs(grp, f"((in-1)/{fps})")
            room = f"((1-1/{z})/2)"
            x0 = f"({room}+clip({dx},-{room},{room}))*W"
            y0 = f"({room}+clip({dy},-{room},{room}))*H"
            x1 = f"{x0}+W/{z}"
            y2 = f"{y0}+H/{z}"
            out.append(f"perspective=x0='{x0}':y0='{y0}':x1='{x1}':y1='{y0}':x2='{x0}':y2='{y2}':x3='{x1}':y3='{y2}'"
                       f":interpolation=cubic:eval=frame:{en}")
        _, _, _, br = fx_exprs(grp, "t")
        if br:
            out.append(f"eq=brightness='{br}':eval=frame:{en}")
    return out


def _gap(g: Graph, n: int, ctx) -> str:
    out = g.label("gap")
    g.add(f"color=c=black@0:s={ctx['Wo']}x{ctx['Ho']}:r={ctx['fps']},format=yuva420p,"
          f"trim=end_frame={n},setpts=PTS-STARTPTS,setsar=1,settb=1/{ctx['fps']},fps={ctx['fps']}[{out}]")
    return out


def _video_track(g: Graph, track, ctx):
    clips = sorted((c for c in track["clips"] if c["duration"] > 0.01), key=lambda c: c["start"])
    fps = ctx["fps"]
    acc = None
    acc_frames = 0
    prev = None
    ctx["track_muted"] = bool(track.get("muted"))
    for clip in clips:
        sf = round(clip["start"] * fps)
        if sf < acc_frames:  # overlap on the same track: the later clip wins from its start
            sf = acc_frames
        label = _visual_clip(g, clip, ctx)
        n = ctx["frames"](clip)
        tr = clip.get("transition") or {}
        use_xfade = (acc is not None and prev is not None and tr.get("type") in XFADE
                     and adjacent_prev([prev], clip) is not None and sf == acc_frames)
        if acc is None:
            if sf > 0:
                acc = _gap(g, sf, ctx)
                acc_frames = sf
            else:
                acc, acc_frames = label, n
                prev = clip
                continue
        if sf > acc_frames:
            gap = _gap(g, sf - acc_frames, ctx)
            nxt = g.label("a")
            g.add(f"[{acc}][{gap}]concat=n=2:v=1:a=0,settb=1/{fps},fps={fps}[{nxt}]")
            acc, acc_frames = nxt, sf
        if use_xfade:
            dn = max(1, min(round(float(tr.get("duration", 0.5)) * fps), n - 1))
            held, nxt = g.label("h"), g.label("a")
            g.add(f"[{acc}]tpad=stop_mode=clone:stop={dn},settb=1/{fps},fps={fps}[{held}]")
            g.add(f"[{held}][{label}]xfade=transition={XFADE[tr['type']]}:duration={_num(dn / fps)}"
                  f":offset={_num(acc_frames / fps)},settb=1/{fps},fps={fps}[{nxt}]")
        else:
            nxt = g.label("a")
            g.add(f"[{acc}][{label}]concat=n=2:v=1:a=0,settb=1/{fps},fps={fps}[{nxt}]")
        acc, acc_frames = nxt, acc_frames + n
        prev = clip
    return acc


def _gain_expr(clip, tl, intervals) -> str:
    parts = [_num(float(clip.get("volume", 1)))]
    kfs = sorted(clip.get("keyframes") or [], key=lambda k: k["t"])
    if kfs:
        u = f"(t-{_num(float(clip['start']))})"
        expr = _num(float(kfs[-1]["gain"]))
        for i in range(len(kfs) - 1, 0, -1):
            a, b = kfs[i - 1], kfs[i]
            span = (b["t"] - a["t"]) or 1
            seg = f"{_num(float(a['gain']))}+{_num(float(b['gain'] - a['gain']))}*({u}-{_num(float(a['t']))})/{_num(float(span))}"
            expr = f"if(lt({u},{_num(float(b['t']))}),{seg},{expr})"
        expr = f"if(lt({u},{_num(float(kfs[0]['t']))}),{_num(float(kfs[0]['gain']))},{expr})"
        parts.append(f"({expr})")
    if clip.get("duck") and intervals:
        r = DUCK_RAMP
        terms = "+".join(
            f"clip(min((t-{_num(a - r)})/{r},({_num(b + r)}-t)/{r}),0,1)" for a, b in intervals)
        parts.append(f"(1-{_num(1 - float(tl.get('duckLevel', 0.2)))}*({terms}))")
    return "*".join(parts)


def _audio_chain(clip, label_in: str, tl, intervals, T, src_is_trimmed=False) -> str:
    chain = []
    if not src_is_trimmed:
        chain.append(f"atrim=start={_num(float(clip['in']))}:end={_num(source_out(clip))}")
    else:
        chain.append(f"atrim=end={_num(clip['duration'] * clip['speed'])}")
    chain.append("asetpts=PTS-STARTPTS")
    if abs(clip["speed"] - 1) > 1e-3:
        chain.append(f"atempo={_num(float(clip['speed']))}")
    chain.append("aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo")
    delay = int(round(clip["start"] * 1000))
    if delay > 0:
        chain.append(f"adelay={delay}:all=1")
    chain.append(f"volume='{_gain_expr(clip, tl, intervals)}':eval=frame")
    fi, fo = float(clip.get("fadeIn") or 0), float(clip.get("fadeOut") or 0)
    if fi > 0:
        chain.append(f"afade=t=in:st={_num(float(clip['start']))}:d={_num(fi)}")
    if fo > 0:
        chain.append(f"afade=t=out:st={_num(clip_end(clip) - fo)}:d={_num(fo)}")
    return f"[{label_in}]" + ",".join(chain)


def build(tl, quality: str, resolve, workdir: Path):
    fps = int(tl.get("fps", 30))
    Wo, Ho = output_size(tl, quality)
    T = max(0.5, timeline_duration(tl))
    g = Graph()
    probes: dict[str, dict] = {}

    def probe_cached(path):
        if path not in probes:
            probes[path] = probe(path)
        return probes[path]

    ctx = {
        "Wo": Wo, "Ho": Ho, "fps": fps, "f": Wo / tl["width"], "resolve": resolve, "probe": probe_cached,
        "frames": lambda c: max(1, round(clip_end(c) * fps) - round(c["start"] * fps)),
        "video_audio": [], "track_muted": False, "workdir": workdir, "audio_sources": {}, "sources": [],
    }
    total_frames = round(T * fps)
    g.add(f"color=c={_ffcolor(tl.get('background', '#000000'))}:s={Wo}x{Ho}:r={fps},"
          f"trim=end_frame={total_frames},format=yuv420p,setsar=1,{color.TAG_709}[base0]")
    base = "base0"
    video_tracks = [t for t in tl["tracks"] if t["kind"] == "video" and not t.get("hidden")]
    for track in reversed(video_tracks):  # bottom track first
        stream = _video_track(g, track, ctx)
        if not stream:
            continue
        nb = g.label("base")
        g.add(f"[{base}][{stream}]overlay=eof_action=pass:format=yuv420[{nb}]")  # YUV blend: no RGB round trip
        base = nb

    fx = _beat_fx(tl, fps)
    if fx:
        nb = g.label("base")
        g.add(f"[{base}]" + ",".join(fx) + f"[{nb}]")
        base = nb

    ass_text = build_ass(tl)
    if "Dialogue:" in ass_text:
        (workdir / "overlay.ass").write_text(ass_text, encoding="utf-8")
        fonts = _escape_path(str(ctx_fonts_dir()))
        nb = g.label("base")
        g.add(f"[{base}]subtitles=filename=overlay.ass:fontsdir='{fonts}'[{nb}]")
        base = nb
    g.add(f"[{base}]format=yuv420p,{color.TAG_709}[vout]")

    # ---- audio
    intervals = speech_intervals(tl)
    audio_labels: list[str] = []
    by_src: dict[str, list] = {}
    for track in tl["tracks"]:
        if track["kind"] not in ("voice", "music") or track.get("muted"):
            continue
        for clip in track["clips"]:
            if clip.get("muted") or clip["duration"] <= 0.01 or not clip.get("src"):
                continue
            by_src.setdefault(clip["src"], []).append(clip)
    for src, clips in by_src.items():
        k = g.input(["-i", resolve(src)])
        ctx["audio_sources"][clips[0].get("name") or src] = resolve(src)
        splits = [g.label("as") for _ in clips]
        if len(clips) > 1:
            g.add(f"[{k}:a]asplit={len(clips)}" + "".join(f"[{s}]" for s in splits))
        else:
            g.add(f"[{k}:a]anull[{splits[0]}]")
        for s, clip in zip(splits, clips):
            out = g.label("au")
            g.add(_audio_chain(clip, s, tl, intervals, T) + f"[{out}]")
            audio_labels.append(out)
    for k, clip in ctx["video_audio"]:
        ctx["audio_sources"][clip.get("name") or clip["src"]] = resolve(clip["src"])
        out = g.label("au")
        g.add(_audio_chain(clip, f"{k}:a", tl, intervals, T, src_is_trimmed=True) + f"[{out}]")
        audio_labels.append(out)
    if audio_labels:
        g.add("".join(f"[{a}]" for a in audio_labels)
              + f"amix=inputs={len(audio_labels)}:normalize=0:duration=longest,"
              + f"apad=whole_dur={_num(T)},atrim=end={_num(T)}[aout]")  # float WAV: no clipping before mastering
    else:
        g.add(f"anullsrc=r=48000:cl=stereo,atrim=end={_num(T)}[aout]")

    script = workdir / "graph.txt"
    script.write_text(";\n".join(g.lines), encoding="utf-8")
    args = [ffmpeg_bin(), "-y", "-hide_banner", "-nostats", "-loglevel", "error"]
    for inp in g.inputs:
        args += inp
    # The filter graph writes a LOSSLESS master (x264 -qp 0) and a float WAV. The one lossy video encode is
    # encode_final() from that master, the one audio encode is audio_master.py. Nothing else is re-encoded.
    args += [*filter_script_args("graph.txt"), "-progress", "pipe:1",
             "-map", "[vout]", "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
             *color.output_tags(), "-r", str(fps), "-an", "-t", _num(T), "master.mkv",
             "-map", "[aout]", "-c:a", "pcm_f32le", "-ar", "48000", "-t", _num(T), "mix.wav"]
    return args, T, ctx["audio_sources"], ctx


# Export: H.264 High, yuv420p, bt709, CRF 17 preset slow (EXPORT_RC=2pass: two-pass at EXPORT_KBPS).
EXPORT = {"rc": os.environ.get("EXPORT_RC", "crf"), "crf": int(os.environ.get("EXPORT_CRF", "17")),
          "preset": os.environ.get("X264_PRESET", "slow"), "kbps": int(os.environ.get("EXPORT_KBPS", "17000"))}


def encode_final(master: Path, out: Path, fps: int, on_progress=None, T: float = 1.0, settings=None) -> dict:
    e = {**EXPORT, **(settings or {})}
    base = [ffmpeg_bin(), "-y", "-hide_banner", "-nostats", "-loglevel", "error", "-i", str(master), "-map", "0:v:0",
            "-c:v", "libx264", "-profile:v", "high", "-preset", e["preset"], "-pix_fmt", "yuv420p", *color.output_tags(),
            "-g", str(fps * 2), "-an"]
    passes = ([["-crf", str(e["crf"])]] if e["rc"] == "crf" else
              [["-b:v", f"{e['kbps']}k", "-maxrate", f"{int(e['kbps'] * 1.5)}k", "-bufsize", f"{e['kbps'] * 2}k", "-pass", str(i),
                "-passlogfile", str(out.with_suffix(".x264"))] for i in (1, 2)])
    for i, extra in enumerate(passes):
        last = i == len(passes) - 1
        dst = str(out) if last else "NUL" if os.name == "nt" else "/dev/null"
        cmd = base + extra + (["-progress", "pipe:1", "-movflags", "+faststart", dst] if last else ["-f", "mp4", dst])
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=out.parent)
        assert proc.stdout
        for line in proc.stdout:
            m = re.match(r"out_time_(?:us|ms)=(\d+)", line.strip())
            if m and on_progress:
                on_progress((i + min(1.0, int(m.group(1)) / 1e6 / T)) / len(passes))
        err = proc.stderr.read() if proc.stderr else ""
        if proc.wait() != 0:
            raise RuntimeError("encode failed: " + err[-1500:])
    return {"rc": e["rc"], "crf": e["crf"] if e["rc"] == "crf" else None, "kbps": e["kbps"] if e["rc"] != "crf" else None,
            "preset": e["preset"], "passes": len(passes)}


def ctx_fonts_dir() -> Path:
    env = os.environ.get("FONTS_DIR")
    if env:
        return Path(env).resolve()
    return (Path(__file__).resolve().parent.parent / "public" / "fonts").resolve()


def run(tl, quality, resolve, workdir: Path, on_progress):
    args, T, audio_sources, ctx = build(tl, quality, resolve, workdir)
    proc = subprocess.Popen(args, cwd=workdir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert proc.stdout
    for line in proc.stdout:
        m = re.match(r"out_time_(?:us|ms)=(\d+)", line.strip())
        if m:
            on_progress(min(0.6, 0.6 * int(m.group(1)) / 1e6 / T))
    err = proc.stderr.read() if proc.stderr else ""
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg failed: " + err[-2000:])
    fps = int(tl.get("fps", 30))
    enc = encode_final(workdir / "master.mkv", workdir / "video.mp4", fps, lambda p: on_progress(0.6 + 0.25 * p), T)
    out = workdir / "out.mp4"
    report = {"audio": master_audio(workdir / "mix.wav", workdir / "video.mp4", out, audio_sources)}
    on_progress(0.9)
    report["quality"] = quality_check(out, workdir / "master.mkv", tl, ctx, enc, T)
    thumb = workdir / "thumb.jpg"
    subprocess.run([ffmpeg_bin(), "-y", "-loglevel", "error", "-ss", _num(min(1.0, T / 2)), "-i", str(out),
                    "-frames:v", "1", "-vf", "scale=480:-2", str(thumb)], check=False)
    return out, (thumb if thumb.exists() else None), T, report
