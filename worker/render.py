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

from ass import build_ass
from media import ffmpeg_bin, probe
from timeline import (DUCK_RAMP, adjacent_prev, clip_end, color_ops, ken_burns_exprs,
                      placement, source_out, speech_intervals, timeline_duration)

XFADE = {"crossfade": "fade", "slide": "slideleft", "zoom": "zoomin"}
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


def _visual_clip(g: Graph, clip, ctx) -> str:
    """Normalized RGBA stream for one visual clip: exactly n frames of Wo x Ho."""
    Wo, Ho, fps, f = ctx["Wo"], ctx["Ho"], ctx["fps"], ctx["f"]
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
              + f"format=rgba[{src}]")
        stream = f"[{src}]"
    else:
        path = ctx["resolve"](clip["src"])
        if ctype == "video":
            k = g.input(["-ss", _num(float(clip["in"])), "-t", _num(dur * clip["speed"] + 0.5), "-i", path])
            chain.append(f"setpts=(PTS-STARTPTS)/{_num(float(clip['speed']))}")
            info = ctx["probe"](path)
            if info["has_audio"] and not clip.get("muted") and clip.get("volume", 1) > 0 and not ctx["track_muted"]:
                ctx["video_audio"].append((k, clip))
        else:
            k = g.input(["-loop", "1", "-framerate", str(fps), "-t", _num(dur + 0.5), "-i", path])
        chain.append(f"fps={fps}")
        chain += _color_filters(clip)
        tr = clip["transform"]
        info = ctx["probe"](path)  # real pixels win over stored metadata (e.g. resized stock photos)
        sw = info.get("width") or clip.get("srcWidth") or 0
        sh = info.get("height") or clip.get("srcHeight") or 0
        if sw and sh:
            p = placement(sw, sh, cw, ch, tr)
            w = max(2, int(round(p["w"] / 2) * 2))
            h = max(2, int(round(p["h"] / 2) * 2))
            chain.append(f"scale={w}:{h}:flags=bicubic")
        else:
            # Unknown source size: let ffmpeg compute the fit, then apply the extra scale.
            mode = "increase" if tr["fit"] == "cover" else "decrease"
            chain.append(f"scale={cw}:{ch}:force_original_aspect_ratio={mode}:force_divisible_by=2")
            if abs(tr["scale"] - 1) > 1e-3:
                chain.append(f"scale='trunc(iw*{tr['scale']}/2)*2':'trunc(ih*{tr['scale']}/2)*2'")
        chain.append("format=rgba,setsar=1")
        src = g.label("c")
        g.add(f"[{k}:v]" + ",".join(chain) + f"[{src}]")
        canvas = g.label("k")
        g.add(f"color=c=black@0:s={cw}x{ch}:r={fps}:d={_num(dur + 1 / fps)},format=rgba[{canvas}]")
        placed = g.label("p")
        ox, oy = tr["x"] * cw, tr["y"] * ch
        g.add(f"[{canvas}][{src}]overlay=x='(W-w)/2+{ox:.2f}':y='(H-h)/2+{oy:.2f}'"
              f":eof_action=repeat:format=auto,format=rgba[{placed}]")
        stream = f"[{placed}]"

    post: list[str] = []
    if kb:
        denom = max(1, n - 1)
        z, fx, fy = ken_burns_exprs(kb, f"(on/{denom})")
        post.append(f"zoompan=z='{z}':x='(iw-iw/zoom)*{fx}':y='(ih-ih/zoom)*{fy}':d=1:s={Wo}x{Ho}:fps={fps}")
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
        "video_audio": [], "track_muted": False,
    }
    total_frames = round(T * fps)
    g.add(f"color=c={_ffcolor(tl.get('background', '#000000'))}:s={Wo}x{Ho}:r={fps},"
          f"trim=end_frame={total_frames},format=yuv420p,setsar=1[base0]")
    base = "base0"
    video_tracks = [t for t in tl["tracks"] if t["kind"] == "video" and not t.get("hidden")]
    for track in reversed(video_tracks):  # bottom track first
        stream = _video_track(g, track, ctx)
        if not stream:
            continue
        nb = g.label("base")
        g.add(f"[{base}][{stream}]overlay=eof_action=pass:format=auto[{nb}]")
        base = nb

    ass_text = build_ass(tl)
    if "Dialogue:" in ass_text:
        (workdir / "overlay.ass").write_text(ass_text, encoding="utf-8")
        fonts = _escape_path(str(ctx_fonts_dir()))
        nb = g.label("base")
        g.add(f"[{base}]subtitles=filename=overlay.ass:fontsdir='{fonts}'[{nb}]")
        base = nb
    g.add(f"[{base}]scale=out_range=tv,format=yuv420p[vout]")

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
        out = g.label("au")
        g.add(_audio_chain(clip, f"{k}:a", tl, intervals, T, src_is_trimmed=True) + f"[{out}]")
        audio_labels.append(out)
    if audio_labels:
        g.add("".join(f"[{a}]" for a in audio_labels)
              + f"amix=inputs={len(audio_labels)}:normalize=0:duration=longest,"
              + f"apad=whole_dur={_num(T)},atrim=end={_num(T)},alimiter=limit=0.97:level=disabled[aout]")
    else:
        g.add(f"anullsrc=r=48000:cl=stereo,atrim=end={_num(T)}[aout]")

    script = workdir / "graph.txt"
    script.write_text(";\n".join(g.lines), encoding="utf-8")
    args = [ffmpeg_bin(), "-y", "-hide_banner", "-nostats", "-loglevel", "error"]
    for inp in g.inputs:
        args += inp
    args += ["-filter_complex_script", "graph.txt", "-map", "[vout]", "-map", "[aout]",
             "-c:v", "libx264", "-preset", os.environ.get("X264_PRESET", "veryfast"), "-crf", "20",
             "-pix_fmt", "yuv420p", "-r", str(fps), "-c:a", "aac", "-b:a", "192k",
             "-movflags", "+faststart", "-t", _num(T), "-progress", "pipe:1", "out.mp4"]
    return args, T


def ctx_fonts_dir() -> Path:
    env = os.environ.get("FONTS_DIR")
    if env:
        return Path(env).resolve()
    return (Path(__file__).resolve().parent.parent / "public" / "fonts").resolve()


def run(tl, quality, resolve, workdir: Path, on_progress):
    args, T = build(tl, quality, resolve, workdir)
    proc = subprocess.Popen(args, cwd=workdir, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    assert proc.stdout
    for line in proc.stdout:
        m = re.match(r"out_time_(?:us|ms)=(\d+)", line.strip())
        if m:
            on_progress(min(0.99, int(m.group(1)) / 1e6 / T))
    err = proc.stderr.read() if proc.stderr else ""
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg failed: " + err[-2000:])
    out = workdir / "out.mp4"
    thumb = workdir / "thumb.jpg"
    subprocess.run([ffmpeg_bin(), "-y", "-loglevel", "error", "-ss", _num(min(1.0, T / 2)), "-i", str(out),
                    "-frames:v", "1", "-vf", "scale=480:-2", str(thumb)], check=False)
    return out, (thumb if thumb.exists() else None), T
