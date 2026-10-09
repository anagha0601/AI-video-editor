"""Final audio master: -14 LUFS integrated, true peak <= -1 dBTP, one AAC encode.

render.py writes the mix as a lossless WAV next to the video-only encode. Here:
1. measure the mix (loudnorm pass 1) and every source file (ebur128 true peak) -> clipping flags
2. two-pass loudnorm to -14 LUFS (linear when the peaks allow it, otherwise loudnorm's true-peak limiter),
   then a true-peak-aware limiter (alimiter with 4x oversampling) as a safety net
3. AAC 192k 48 kHz, muxed with the untouched video stream (+faststart)
4. measure the result; if the AAC encode pushed the true peak over -1 dBTP, redo step 2 with more headroom
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from media import ffmpeg_bin

TARGET_I = -14.0
TARGET_TP = -1.0       # what the export must meet
LIMIT_TP = -1.5        # what we aim for before AAC (AAC overshoots a few tenths of a dB)
SILENT = -70.0


def _run(args, cwd=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def ebur128(path: str | Path, stream: str = "a:0") -> dict:
    """Integrated loudness (LUFS) and true peak (dBTP) of a file's audio."""
    r = _run([ffmpeg_bin(), "-hide_banner", "-nostats", "-i", str(path), "-map", f"0:{stream}?", "-af", "ebur128=peak=true",
              "-f", "null", "-"])
    summary = r.stderr[r.stderr.rfind("Summary:"):]
    i = re.search(r"I:\s+(-?[\d.]+|-inf)\s+LUFS", summary)
    tp = re.search(r"True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS", summary)
    f = lambda m: (float(m.group(1)) if m and m.group(1) != "-inf" else None)  # noqa: E731
    return {"lufs": f(i), "truePeak": f(tp)}


def _loudnorm_measure(wav: Path, tp: float) -> dict | None:
    r = _run([ffmpeg_bin(), "-hide_banner", "-nostats", "-i", str(wav), "-af",
              f"loudnorm=I={TARGET_I}:TP={tp}:LRA=11:print_format=json", "-f", "null", "-"])
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
    return json.loads(m.group(0)) if m else None


def _master(wav: Path, video: Path, out: Path, tp: float, measured: dict | None) -> str:
    if measured and float(measured["input_i"]) > SILENT:
        ln = (f"loudnorm=I={TARGET_I}:TP={tp}:LRA=11:measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
              f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
              f":offset={measured['target_offset']}:linear=true")
        lim = 10 ** (tp / 20)
        af = f"{ln},aresample=192000,alimiter=limit={lim:.4f}:level=disabled:attack=1:release=50,aresample=48000"
    else:
        af = "anull"  # silence: nothing to normalise
    r = _run([ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(video), "-i", str(wav),
              "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
              "-movflags", "+faststart", str(out)])
    if r.returncode != 0:
        raise RuntimeError("audio master failed: " + r.stderr[-1500:])
    return af


def master(wav: Path, video: Path, out: Path, sources: dict[str, str]) -> dict:
    """sources: display name -> local path of every audio source in the mix (for the clipping report)."""
    before = ebur128(wav)
    flagged = []
    for name, path in sources.items():
        m = ebur128(path)
        if m["truePeak"] is not None and m["truePeak"] > TARGET_TP:
            flagged.append({"name": name, "truePeak": m["truePeak"]})
    tp = LIMIT_TP
    for _ in range(3):
        _master(wav, video, out, tp, _loudnorm_measure(wav, tp))
        after = ebur128(out)
        if after["truePeak"] is None or after["truePeak"] <= TARGET_TP:
            break
        tp -= 0.5 + (after["truePeak"] - TARGET_TP)  # more headroom for the AAC overshoot
    clipped = before["truePeak"] is not None and before["truePeak"] > TARGET_TP
    ok = after["truePeak"] is None or after["truePeak"] <= TARGET_TP
    return {
        "target": {"lufs": TARGET_I, "truePeak": TARGET_TP},
        "mix": before,                 # before mastering
        "output": after,               # what was exported
        "sourcesOverPeak": flagged,    # inputs that clip on their own (fixed by the limiter, but worth knowing)
        "clippingDetected": clipped or bool(flagged),
        "fixed": (clipped or bool(flagged)) and ok,
        "pass": ok and (after["lufs"] is None or abs(after["lufs"] - TARGET_I) <= 1.0),
    }
