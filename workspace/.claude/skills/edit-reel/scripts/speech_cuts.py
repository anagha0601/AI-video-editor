"""Turn a word-level transcript into clean keep-segments for a talking-head clip.
Removes filler words, stutters, user-listed retakes/false starts, and pauses > --max-gap; snaps every cut to the
quietest 10ms window near the word boundary (never mid-word).

usage: speech_cuts.py TRANSCRIPT.json CLIP [--src-dir DIR] [--drop 3-9,15-15] [--max-gap 0.3] [--out cuts.json]
  --drop  word index ranges to remove (retakes: keep the LAST take; false starts). Indices = "i" in the printed table.
Output: {"clip", "segments":[{"in","out"}], "words":[{"word","start","end"} in REEL time], "script"}
"""
import argparse, json, os, re, subprocess
import numpy as np
from ff import FFMPEG

FILLERS = {"um", "uh", "erm", "er", "ah", "hmm", "mm", "uhm", "umm"}
FILLER_PHRASES = {("you", "know"), ("i", "mean")}

ap = argparse.ArgumentParser()
ap.add_argument("transcript"); ap.add_argument("clip"); ap.add_argument("--src-dir", default=".")
ap.add_argument("--drop", default=""); ap.add_argument("--max-gap", type=float, default=0.3)
ap.add_argument("--keep-like", action="store_true", help="keep filler 'like,' (removed by default when comma-delimited)")
ap.add_argument("--phrases", action="store_true", help="also remove filler 'you know' / 'i mean'")
ap.add_argument("--out")
a = ap.parse_args()

data = json.load(open(a.transcript, encoding="utf-8"))
clips = data if isinstance(data, list) else data["clips"]
entry = next(c for c in clips if c["clip"] == os.path.basename(a.clip))
words = entry["words"]
norm = lambda w: re.sub(r"[^a-z']", "", w.lower())

drop = set()
for r in filter(None, a.drop.split(",")):
    i, j = (int(x) for x in r.split("-"))
    drop.update(range(i, j + 1))
for i, w in enumerate(words):
    n = norm(w["word"])
    if n in FILLERS:
        drop.add(i)
    if n == "like" and not a.keep_like and w["word"].strip().endswith(","):
        drop.add(i)
    if a.phrases and i + 1 < len(words) and (n, norm(words[i + 1]["word"])) in FILLER_PHRASES:
        drop.update({i, i + 1})
    if i + 1 < len(words) and n and n == norm(words[i + 1]["word"]):   # stutter "I I" -> drop the first
        drop.add(i)

print(" i  start    end    word   (x = removed)")
for i, w in enumerate(words):
    print(f"{i:2d} {w['start']:6.2f} {w['end']:6.2f}  {'x ' if i in drop else '  '}{w['word']}")

# 10ms RMS envelope for snapping cuts to silence
SR = 16000
raw = subprocess.run([FFMPEG, "-v", "error", "-i", os.path.join(a.src_dir, a.clip), "-ac", "1", "-ar", str(SR),
                      "-f", "s16le", "-"], capture_output=True, check=True).stdout
y = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
hop = SR // 100
env = np.sqrt(np.convolve(y ** 2, np.ones(hop) / hop, "same"))[::hop]

def quietest(t0, t1):
    i0, i1 = max(0, int(t0 * 100)), min(len(env) - 1, int(t1 * 100))
    if i1 <= i0:
        return (t0 + t1) / 2
    return (i0 + int(np.argmin(env[i0:i1 + 1]))) / 100

# group kept words into continuous segments (break on removed words or gaps > max-gap)
segs, cur = [], None
for i in (i for i in range(len(words)) if i not in drop):
    if cur and i == cur["last"] + 1 and words[i]["start"] - words[cur["last"]]["end"] <= a.max_gap:
        cur["last"] = i
        continue
    if cur:
        segs.append(cur)
    cur = {"first": i, "last": i}
if cur:
    segs.append(cur)

out_segs = []
for s in segs:
    w0, w1 = words[s["first"]], words[s["last"]]
    prev_end = words[s["first"] - 1]["end"] if s["first"] > 0 else max(0.0, w0["start"] - 0.3)
    next_start = words[s["last"] + 1]["start"] if s["last"] + 1 < len(words) else w1["end"] + 0.3
    cin = quietest(max(prev_end, w0["start"] - 0.15), w0["start"])
    cout = quietest(w1["end"], min(next_start, w1["end"] + 0.15))
    out_segs.append({"in": round(cin, 3), "out": round(cout, 3), "words": [s["first"], s["last"]]})

reel_words, t = [], 0.0
for s in out_segs:
    for i in range(s["words"][0], s["words"][1] + 1):
        w = words[i]
        reel_words.append({"word": w["word"], "start": round(t + w["start"] - s["in"], 3),
                           "end": round(t + w["end"] - s["in"], 3)})
    t += s["out"] - s["in"]
res = {"clip": os.path.basename(a.clip), "segments": out_segs, "words": reel_words, "duration": round(t, 3),
       "script": " ".join(w["word"] for w in reel_words)}
print(f"\n{len(out_segs)} segments, {t:.2f}s kept\nCLEAN SCRIPT: {res['script']}")
for s in out_segs:
    print(f"  keep {s['in']:7.3f} -> {s['out']:7.3f}")
if a.out:
    json.dump(res, open(a.out, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
