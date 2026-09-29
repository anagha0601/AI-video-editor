"""faster-whisper transcription with word-level timestamps."""
from __future__ import annotations

import os
from functools import lru_cache

# Whisper models are public; don't send a (possibly expired) cached HF token.
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")


@lru_cache(maxsize=1)
def _model():
    from faster_whisper import WhisperModel

    name = os.environ.get("WHISPER_MODEL", "base")
    device = os.environ.get("WHISPER_DEVICE", "auto")
    compute = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
    print(f"[whisper] loading model={name} device={device} compute={compute}", flush=True)
    return WhisperModel(name, device=device, compute_type=compute)


def _decode(path: str):
    """16 kHz mono float32 via ffmpeg (sidesteps PyAV version quirks)."""
    import subprocess

    import numpy as np

    from media import ffmpeg_bin

    pcm = subprocess.run([ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000",
                          "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(path: str, id_prefix: str) -> dict:
    segments, info = _model().transcribe(_decode(path), word_timestamps=True, beam_size=5, vad_filter=False)
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if not text:
                continue
            start, end = float(w.start), float(w.end)
            if words and start < words[-1]["end"]:
                start = words[-1]["end"]
            words.append({"id": f"{id_prefix}_{len(words)}", "text": text,
                          "start": round(start, 3), "end": round(max(end, start + 0.05), 3)})
    return {"language": info.language, "duration": round(float(info.duration), 3), "words": words}
