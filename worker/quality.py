"""Video quality measurements (ffmpeg libvmaf, CPU): VMAF, SSIM and per-plane PSNR, duplicate frames,
stream facts. Used by the render's quality check (render.py -> RenderJob.report.quality) and by
scripts/audit_quality.py (stage-by-stage audit against a reference made from the source).
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from media import ffmpeg_bin

THREADS = max(1, (os.cpu_count() or 4))


def _run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", **kw)


def compare(dist: str, ref: str, *, dist_trim: tuple[int, int] | None = None, subsample: int = 1,
            width: int | None = None, height: int | None = None) -> dict:
    """VMAF (vmaf_v0.6.1), SSIM and PSNR (Y, Cb, Cr) of dist against ref, frame-aligned from the start.
    dist_trim = (first_frame, n_frames) of dist to use. Both are scaled to ref's size only if they differ."""
    with tempfile.TemporaryDirectory(prefix="rs-vmaf-") as d:
        log = Path(d) / "vmaf.json"
        trim = f"trim=start_frame={dist_trim[0]}:end_frame={dist_trim[0] + dist_trim[1]}," if dist_trim else ""
        size = f"scale={width}:{height}:flags=lanczos," if width and height else ""
        # pair frames by index, not by timestamp: MKV stores ms-rounded timestamps and libvmaf's frame sync would
        # otherwise pair some frames one apart
        graph = (f"[0:v]{trim}{size}format=yuv420p,settb=1/1000,setpts=N*40[d];"
                 f"[1:v]format=yuv420p,settb=1/1000,setpts=N*40[r];"
                 f"[d][r]libvmaf=model=version=vmaf_v0.6.1:feature=name=float_ssim|name=psnr"
                 f":n_threads={THREADS}:n_subsample={subsample}:shortest=1:log_fmt=json:log_path=vmaf.json")
        r = _run([ffmpeg_bin(), "-hide_banner", "-nostats", "-loglevel", "error", "-i", str(Path(dist).resolve()), "-i", str(Path(ref).resolve()),
                  "-lavfi", graph, "-f", "null", "-"], cwd=d)
        if r.returncode != 0 or not log.exists():
            raise RuntimeError("libvmaf failed: " + r.stderr[-800:])
        j = json.loads(log.read_text(encoding="utf-8"))
    frames = j.get("frames", [])
    v = np.array([f["metrics"]["vmaf"] for f in frames]) if frames else np.array([0.0])
    pooled = j.get("pooled_metrics", {})
    get = lambda k: round(pooled.get(k, {}).get("mean", float("nan")), 4)  # noqa: E731
    return {
        "vmaf": round(float(v.mean()), 2), "vmaf_min": round(float(v.min()), 2),
        "vmaf_p5": round(float(np.percentile(v, 5)), 2),
        "ssim": get("float_ssim"), "psnr_y": get("psnr_y"), "psnr_cb": get("psnr_cb"), "psnr_cr": get("psnr_cr"),
        "frames": len(frames),
    }


def duplicate_frames(path: str, width: int = 270) -> dict:
    """Consecutive identical frames (dropped-then-duplicated timing) in a video: count and positions."""
    r = subprocess.run([ffmpeg_bin(), "-v", "error", "-i", path, "-fps_mode", "passthrough", "-vf", f"scale={width}:-2:flags=area,format=gray",
                        "-f", "rawvideo", "-"], capture_output=True)
    probe = _run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                  "-of", "csv=p=0", path]).stdout.strip().split(",")
    w0, h0 = int(probe[0]), int(probe[1])
    h = int(round(h0 * width / w0 / 2) * 2)
    buf = np.frombuffer(r.stdout, np.uint8)
    n = len(buf) // (width * h)
    fr = buf[: n * width * h].reshape(n, h, width).astype(np.int16)
    diffs = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2)) if n > 1 else np.array([])
    dup = np.where(diffs < 0.05)[0] + 1
    return {"frames": int(n), "duplicates": int(len(dup)), "at": [int(x) for x in dup[:20]]}


def stream_info(path: str) -> dict:
    """What the export actually is: codec/profile/pix_fmt/colour tags/fps/bitrate/frames, audio."""
    j = json.loads(_run(["ffprobe", "-v", "error", "-show_entries",
                         "stream=codec_type,codec_name,profile,pix_fmt,width,height,color_range,color_space,color_transfer,"
                         "color_primaries,r_frame_rate,avg_frame_rate,nb_frames,bit_rate,sample_rate,channels"
                         ":format=duration,bit_rate:format_tags=major_brand",
                         "-of", "json", path]).stdout or "{}")
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in j.get("streams", []) if s.get("codec_type") == "audio"), {})
    fr = lambda s: (lambda x, y: round(x / y, 3) if y else 0)(*map(float, (s or "0/1").split("/")))  # noqa: E731
    return {
        "video": {"codec": v.get("codec_name"), "profile": v.get("profile"), "pix_fmt": v.get("pix_fmt"),
                  "width": v.get("width"), "height": v.get("height"), "range": v.get("color_range"),
                  "matrix": v.get("color_space"), "transfer": v.get("color_transfer"), "primaries": v.get("color_primaries"),
                  "fps": fr(v.get("r_frame_rate")), "avg_fps": fr(v.get("avg_frame_rate")),
                  "frames": int(v["nb_frames"]) if str(v.get("nb_frames", "")).isdigit() else None,
                  "kbps": round(int(v["bit_rate"]) / 1000) if str(v.get("bit_rate", "")).isdigit() else None},
        "audio": {"codec": a.get("codec_name"), "sample_rate": int(a["sample_rate"]) if a.get("sample_rate") else None,
                  "channels": a.get("channels"), "kbps": round(int(a["bit_rate"]) / 1000) if str(a.get("bit_rate", "")).isdigit() else None},
        "duration": float(j.get("format", {}).get("duration") or 0),
        "faststart": None,
    }


def faststart(path: str) -> bool:
    """moov atom before mdat (progressive playback / upload friendly)."""
    with open(path, "rb") as f:
        pos = 0
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                return False
            size = int.from_bytes(hdr[:4], "big")
            kind = hdr[4:8]
            if kind == b"moov":
                return True
            if kind == b"mdat":
                return False
            if size == 1:
                size = int.from_bytes(f.read(8), "big")
                f.seek(pos + size)
            elif size == 0:
                return False
            else:
                f.seek(pos + size)
            pos += size


# ------------------------------------------------------------------ the render's quality check

LIMITS = {"vmaf": 93.0, "vmaf_min": 80.0, "ssim": 0.985}


def render_check(out: Path, master: Path, tl, ctx, enc: dict, T: float) -> dict:
    """Pass/fail checks on an export. VMAF/SSIM compare the export with the lossless master of the same edit
    (source -> one colour conversion + one scale -> your edits), i.e. everything the export loses after your edits."""
    fps = int(tl.get("fps", 30))
    info = stream_info(str(out))
    v = info["video"]
    checks: list[dict] = []

    def check(key, ok, label, detail="", level="fail"):
        checks.append({"key": key, "ok": bool(ok), "label": label, "detail": detail, "level": "ok" if ok else level})

    sub = 1 if T <= 60 else 2
    try:
        m = compare(str(out), str(master), subsample=sub)
    except Exception as exc:  # noqa: BLE001
        m = {"error": str(exc)[:300]}
    if "vmaf" in m:
        check("vmaf", m["vmaf"] >= LIMITS["vmaf"] and m["vmaf_min"] >= LIMITS["vmaf_min"],
              f"VMAF {m['vmaf']} (min {m['vmaf_min']})", f"export vs lossless render of this edit, ≥ {LIMITS['vmaf']}")
        check("ssim", m["ssim"] >= LIMITS["ssim"], f"SSIM {m['ssim']:.4f}", f"≥ {LIMITS['ssim']}")
    else:
        check("vmaf", False, "VMAF not measured", m.get("error", ""), "warn")
    W, H = ctx["Wo"], ctx["Ho"]
    check("format", v["codec"] == "h264" and (v["profile"] or "").lower() == "high" and v["pix_fmt"] == "yuv420p"
          and (v["width"], v["height"]) == (W, H),
          f"{(v['codec'] or '?').upper()} {v['profile']} {v['pix_fmt']} {v['width']}x{v['height']}")
    tags_ok = (v["matrix"], v["transfer"], v["primaries"], v["range"]) == ("bt709", "bt709", "bt709", "tv")
    check("tags", tags_ok, "bt709 colour tags" if tags_ok else "colour tags wrong",
          f"primaries {v['primaries']}, transfer {v['transfer']}, matrix {v['matrix']}, range {v['range']}")
    hdr = [s for s in ctx["sources"] if s["hdr"]]
    check("hdr", True, f"HDR handled: {len(hdr)} HDR clip{'s' if len(hdr) != 1 else ''} tone-mapped to SDR bt709" if hdr else "No HDR sources",
          "; ".join(sorted({s["color"] for s in ctx["sources"] if s["type"] == "video"})))
    exp_frames = round(T * fps)
    frames_ok = v["fps"] == fps and (v["frames"] is None or abs(v["frames"] - exp_frames) <= 1)
    check("fps", frames_ok, f"{v['fps']:g} fps, {v['frames']} frames", f"expected {fps} fps, {exp_frames} frames")
    # duplicated frames inside video clips that play at normal speed or faster (slow-mo repeats frames by design)
    d = duplicate_frames(str(out))
    spans = [(round(s["start"] * fps), s) for s in ctx["sources"]]
    bad, vfr = [], []
    for f in d["at"]:
        owner = next((s for st, s in reversed(spans) if st <= f), None)
        if owner and owner["type"] == "video" and owner["speed"] >= 0.999:
            # a variable-frame-rate source with fewer frames than the timeline rate has gaps the conform must fill
            (vfr if 0 < owner.get("avg_fps", 0) < fps * 0.99 else bad).append(f)
    slow = [s for s in ctx["sources"] if s["type"] == "video" and s["speed"] < 0.999]
    notes = []
    if bad:
        notes.append(f"at frames {bad[:8]}")
    if vfr:
        names = sorted({s["clip"] for s in ctx["sources"] if 0 < s.get("avg_fps", 0) < fps * 0.99})
        notes.append(f"{len(vfr)} filled gaps in variable-frame-rate source(s): {', '.join(names[:3])}")
    if slow:
        notes.append(f"{len(slow)} slow-motion clip(s) repeat frames by design")
    check("frames", not bad, "No dropped/duplicated frames" if not bad else f"{len(bad)} duplicated frames", "; ".join(notes), "warn")
    ups = [s for s in ctx["sources"] if s["upscale"] > 1.02]
    check("upscale", not ups, "No upscaling" if not ups else f"{len(ups)} clip(s) upscaled",
          "; ".join(f"{s['clip']} ×{s['upscale']:.2f}" for s in ups[:6]), "warn")
    lossy = 1
    check("encodes", lossy == 1, "1 lossy video encode", f"lossless master → {enc['passes']}-pass x264 "
          + (f"CRF {enc['crf']}" if enc.get("crf") is not None else f"{enc['kbps']} kbps") + f" preset {enc['preset']}")
    check("bitrate", (v["kbps"] or 0) > 0, f"{v['kbps']} kbps video, {info['audio']['kbps']} kbps audio", "", "warn")
    a = info["audio"]
    check("audio_format", a["codec"] == "aac" and a["sample_rate"] == 48000, f"AAC {a['sample_rate']} Hz {a['kbps']} kbps")
    check("faststart", faststart(str(out)), "+faststart (moov first)")
    return {"pass": all(c["ok"] or c["level"] == "warn" for c in checks), "checks": checks, "metrics": m,
            "export": v, "sources": ctx["sources"], "encode": enc}
