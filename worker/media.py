"""ffmpeg helpers: locate the binary, probe files, normalize audio, waveform peaks."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from functools import lru_cache

import numpy as np


@lru_cache(maxsize=1)
def ffmpeg_bin() -> str:
    env = os.environ.get("FFMPEG_BIN")
    if env:
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:  # pip install imageio-ffmpeg ships a static build (handy on Windows/macOS)
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("ffmpeg not found: install it or set FFMPEG_BIN") from exc


def probe(path: str) -> dict:
    """Duration, audio presence and video size, parsed from `ffmpeg -i` (no ffprobe needed)."""
    proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", path], capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    err = proc.stderr
    duration = None
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", err)
    if m:
        duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    width = height = None
    m = re.search(r"Stream #[^\n]*Video:[^\n]*?, (\d{2,5})x(\d{2,5})", err)
    if m:
        width, height = int(m.group(1)), int(m.group(2))
        if re.search(r"rotation of -?90", err) or re.search(r"rotate\s*:\s*-?(90|270)", err):
            width, height = height, width
    return {"duration": duration, "has_audio": bool(re.search(r"Stream #[^\n]*Audio:", err)),
            "width": width, "height": height}


def normalize_audio(src: str, dst: str) -> None:
    """Any recording (webm/opus from MediaRecorder, wav, mp3, m4a...) -> 48 kHz mono AAC."""
    subprocess.run([ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vn",
                    "-ac", "1", "-ar", "48000", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dst],
                   check=True)


def peaks(path: str, per_sec: int = 50) -> list[float]:
    """Max-abs amplitude per 1/per_sec window, normalized to 0..1, for the waveform view."""
    rate = 8000
    proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1",
                           "-ar", str(rate), "-f", "s16le", "-"], capture_output=True, check=True)
    pcm = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    win = rate // per_sec
    n = len(pcm) // win
    if n == 0:
        return []
    frames = np.abs(pcm[: n * win]).reshape(n, win).max(axis=1)
    top = float(np.percentile(frames, 99)) or 1.0
    return [round(float(v), 3) for v in np.clip(frames / top, 0, 1)]
