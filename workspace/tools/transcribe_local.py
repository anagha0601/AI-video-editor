"""Local, free drop-in for video-use's helpers/transcribe.py (which calls the paid ElevenLabs Scribe API).

Runs faster-whisper on CPU (int8) and writes Scribe-shaped JSON to <edit_dir>/transcripts/<stem>.json,
so video-use's pack_transcripts.py and render.py --build-subtitles work unchanged.

usage: python {{REEL_STUDIO_DIR}}/tools/transcribe_local.py <video> [<video> ...] [--edit-dir DIR] [--model small]
                                                          [--language en] [--no-vad]
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")  # a stale cached HF token would make public downloads 401

import numpy as np
from faster_whisper import WhisperModel


def load_audio(path: Path, sr: int = 16000) -> np.ndarray:
    # decode via ffmpeg: faster-whisper's own PyAV decoder crashes with some PyAV builds
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", str(sr),
                          "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


def has_audio(path: Path) -> bool:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                          "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout
    return bool(out.strip())


def to_scribe(segments, language: str) -> dict:
    words, prev_end = [], None
    for seg in segments:
        for w in seg.words or []:
            if prev_end is not None and w.start > prev_end:
                words.append({"text": " ", "start": round(prev_end, 3), "end": round(w.start, 3),
                              "type": "spacing", "speaker_id": "speaker_0"})
            words.append({"text": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3),
                          "type": "word", "speaker_id": "speaker_0", "logprob": round(w.probability, 3)})
            prev_end = w.end
    text = " ".join(w["text"] for w in words if w["type"] == "word")
    return {"language_code": language, "text": text, "words": words, "engine": "faster-whisper"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--edit-dir")
    ap.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"))
    ap.add_argument("--language")
    ap.add_argument("--no-vad", action="store_true", help="very short clips: VAD can swallow speech")
    a = ap.parse_args()

    model = None
    for v in map(Path, a.videos):
        edit_dir = Path(a.edit_dir) if a.edit_dir else v.parent / "edit"
        out = edit_dir / "transcripts" / f"{v.stem}.json"
        if out.exists() and out.stat().st_mtime >= v.stat().st_mtime:
            print(f"cached: {out}")
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        if not has_audio(v):
            out.write_text(json.dumps({"language_code": None, "text": "", "words": [], "engine": "faster-whisper"}))
            print(f"no audio: {v.name}")
            continue
        if model is None:
            model = WhisperModel(a.model, device="cpu", compute_type="int8")
        t0 = time.time()
        segs, info = model.transcribe(load_audio(v), language=a.language, word_timestamps=True,
                                      vad_filter=not a.no_vad, vad_parameters={"min_silence_duration_ms": 200},
                                      condition_on_previous_text=False)
        payload = to_scribe(list(segs), info.language)
        out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        n = sum(1 for w in payload["words"] if w["type"] == "word")
        print(f"saved: {out} ({n} words, {time.time() - t0:.1f}s)", flush=True)


if __name__ == "__main__":
    sys.exit(main())
