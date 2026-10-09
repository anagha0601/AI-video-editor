"""Word-timed captions (ASS) with the active word highlighted.
usage: captions.py CUTS.json OUT.ass [--offset 0] [--max-words 3] [--y 1300] [--size 92] [--accent FFD60A] [--extra other.ass]
CUTS.json: output of speech_cuts.py (its "words" are in reel time of the talking segment; --offset if it starts later).
Style per STYLE.md: Times New Roman squeezed (ScaleX 80), white, dark outline, active word in the accent colour,
1-3 words on screen, kept between y=250 and y=H-400.  --extra merges Dialogue lines from another ASS (hook/reveal/pop-ups).
"""
import argparse, json

ap = argparse.ArgumentParser()
ap.add_argument("cuts"); ap.add_argument("out"); ap.add_argument("--offset", type=float, default=0)
ap.add_argument("--max-words", type=int, default=3); ap.add_argument("--y", type=int, default=1300)
ap.add_argument("--size", type=int, default=92); ap.add_argument("--accent", default="FFD60A")
ap.add_argument("--font", default="Times New Roman"); ap.add_argument("--scalex", type=int, default=80)
ap.add_argument("--extra"); ap.add_argument("--keep-case", action="store_true")
a = ap.parse_args()
W, H = 1080, 1920
assert 250 + a.size < a.y < H - 400 - a.size // 2, "caption must sit inside the IG safe zone (250 .. H-400)"
bgr = f"&H00{a.accent[4:6]}{a.accent[2:4]}{a.accent[0:2]}&"
words = json.load(open(a.cuts, encoding="utf-8"))["words"]

def ts(t):
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"

groups, cur = [], []
for w in words:
    cur.append(w)
    if len(cur) >= a.max_words or w["word"].strip().endswith((".", ",", "?", "!")):
        groups.append(cur); cur = []
if cur:
    groups.append(cur)

lines = []
for gi, g in enumerate(groups):
    gend = groups[gi + 1][0]["start"] if gi + 1 < len(groups) else g[-1]["end"] + 0.4
    for k, w in enumerate(g):
        st, en = w["start"], (g[k + 1]["start"] if k + 1 < len(g) else gend)
        parts = []
        for j, x in enumerate(g):
            t = x["word"].strip() if a.keep_case else x["word"].strip().lower()
            parts.append(f"{{\\c{bgr}}}{t}{{\\c&H00FFFFFF&}}" if j == k else t)
        lines.append(f"Dialogue: 1,{ts(st + a.offset)},{ts(en + a.offset)},Cap,,0,0,0,,{{\\pos({W // 2},{a.y})}}" + " ".join(parts))

style = "&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,{sx},100,0,0,1".format(sx=a.scalex)
head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{a.font},{a.size},{style},5,3,5,60,60,0,1
Style: Hook,{a.font},124,{style},5,3,8,60,60,330,1
Style: Pop,{a.font},96,{style},4,3,8,60,60,330,1
Style: Reveal,{a.font},108,{style},5,3,2,60,60,410,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
extra = ""
if a.extra:
    extra = "\n".join(l for l in open(a.extra, encoding="utf-8").read().splitlines() if l.startswith("Dialogue:")) + "\n"
open(a.out, "w", encoding="utf-8").write(head + extra + "\n".join(lines) + "\n")
print(f"{len(lines)} caption events -> {a.out}")
