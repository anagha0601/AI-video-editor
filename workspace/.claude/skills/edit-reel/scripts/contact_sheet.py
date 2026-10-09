"""Contact sheet with timestamps. usage: contact_sheet.py VIDEO OUT.png [--every SEC | --n N] [--cols 5]"""
import argparse, os
from ff import run, probe, ffpath, FONT_DIR

ap = argparse.ArgumentParser()
ap.add_argument("video"); ap.add_argument("out")
ap.add_argument("--every", type=float); ap.add_argument("--n", type=int, default=20)
ap.add_argument("--cols", type=int, default=5); ap.add_argument("--start", type=float, default=0)
ap.add_argument("--end", type=float)
a = ap.parse_args()
info = probe(a.video)
end = a.end or info["duration"]
span = end - a.start
every = a.every or span / a.n
n = int(span / every) + 1
rows = -(-n // a.cols)
font = ffpath(os.path.join(FONT_DIR, "arialbd.ttf"))
vf = (f"fps=1/{every},scale=216:-2,"
      rf"drawtext=fontfile='{font}':text='%{{pts\:hms}}':x=4:y=4:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.7,"
      f"tile={a.cols}x{rows}:padding=4:color=white")
run(["-ss", str(a.start), "-t", str(span), "-i", a.video, "-vf", vf, "-frames:v", "1", "-copyts", a.out])
print(a.out, f"{n} frames every {every:.2f}s")
