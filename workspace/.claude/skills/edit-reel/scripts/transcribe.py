"""Speech detection + word-level transcription with faster-whisper.
usage: transcribe.py --detect CLIP [CLIP...]          -> prints speech stats per clip
       transcribe.py --out DIR CLIP [CLIP...]         -> writes DIR/transcript.json + transcript.txt
"""
import argparse, json, os, sys
from faster_whisper import WhisperModel
import subprocess, numpy as np
from ff import FFMPEG

def load_audio(path, sr=16000):
    # decode via ffmpeg (avoids PyAV version mismatches in faster-whisper's own decoder)
    raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0

ap = argparse.ArgumentParser()
ap.add_argument("clips", nargs="+"); ap.add_argument("--detect", action="store_true")
ap.add_argument("--out"); ap.add_argument("--model", default="small")
ap.add_argument("--no-vad", action="store_true", help="for very short clips the VAD can swallow speech")
a = ap.parse_args()
model = WhisperModel(a.model, device="cpu", compute_type="int8")

def words_of(path):
    segs, info = model.transcribe(load_audio(path), word_timestamps=True, vad_filter=not a.no_vad,
                                  vad_parameters={"min_silence_duration_ms": 200}, condition_on_previous_text=False)
    segs = list(segs)
    return segs, info

if a.detect:
    for c in a.clips:
        segs, info = words_of(c)
        speech = sum(s.end - s.start for s in segs)
        conf = [w.probability for s in segs for w in (s.words or [])]
        txt = " ".join(s.text.strip() for s in segs)
        nsp = max((s.no_speech_prob for s in segs), default=1.0)
        print(json.dumps({"clip": os.path.basename(c), "lang": info.language, "lang_p": round(info.language_probability, 2),
                          "speech_s": round(speech, 2), "word_conf": round(sum(conf)/len(conf), 2) if conf else 0,
                          "no_speech_p": round(nsp, 2), "text": txt[:120]}, ensure_ascii=False), flush=True)
    sys.exit()

os.makedirs(a.out, exist_ok=True)
result, lines = [], []
for c in a.clips:
    segs, info = words_of(c)
    words = [{"word": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3), "prob": round(w.probability, 3)}
             for s in segs for w in (s.words or [])]
    result.append({"clip": os.path.basename(c), "language": info.language, "words": words,
                   "segments": [{"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()} for s in segs]})
    lines.append(f"## {os.path.basename(c)} ({info.language})")
    lines += [f"[{s.start:6.2f}-{s.end:6.2f}] {s.text.strip()}" for s in segs]
json.dump(result, open(os.path.join(a.out, "transcript.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
open(os.path.join(a.out, "transcript.txt"), "w", encoding="utf-8").write("\n".join(lines) + "\n")
print("\n".join(lines))
