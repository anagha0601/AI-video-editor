"""QA a rendered reel: specs, loudness, and frame sheets at every cut/overlay with IG safe-zone guides.
usage: review.py VIDEO EDL.json [--out DIR]
 - red lines: y=250 (top UI) and y=H-400 (bottom UI/caption). Text must sit between them.
"""
import argparse, json, os, subprocess
from ff import FFMPEG, FFPROBE, run, probe, ffpath, FONT_DIR

ap = argparse.ArgumentParser(); ap.add_argument("video"); ap.add_argument("edl"); ap.add_argument("--out")
a = ap.parse_args()
edl = json.load(open(a.edl, encoding="utf-8"))
H = edl.get("h", 1920)
out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.edl)), "work", "review"); os.makedirs(out, exist_ok=True)
# specs
j = json.loads(subprocess.run([FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", a.video], capture_output=True, text=True).stdout)
v = next(s for s in j["streams"] if s["codec_type"] == "video"); au = [s for s in j["streams"] if s["codec_type"] == "audio"]
print(f"video: {v['codec_name']} {v.get('profile')} {v['width']}x{v['height']} {v['r_frame_rate']} {v['pix_fmt']}  frames={v.get('nb_frames')}  dur={float(j['format']['duration']):.3f}")
for s in au: print(f"audio: {s['codec_name']} {s['sample_rate']}Hz ch={s['channels']}")
if au:
    p = subprocess.run([FFMPEG, "-hide_banner", "-i", a.video, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    summ = p[p.rfind("Summary:"):]
    print("loudness:", " ".join(l.strip() for l in summ.splitlines() if any(k in l for k in ("I:", "LRA:", "Peak:"))))
# frame times: shot start+2f, middle, end-2f
times = []
for i, s in enumerate(edl["shots"]):
    d = s["end"] - s["start"]
    times += [(s["start"] + 0.07, f"{i}a"), (s["start"] + d / 2, f"{i}m"), (s["end"] - 0.07, f"{i}z")]
font = ffpath(os.path.join(FONT_DIR, "arialbd.ttf"))
guides = (f"drawbox=y=250:w=iw:h=4:color=red@0.9:t=fill,drawbox=y={H-400}:w=iw:h=4:color=red@0.9:t=fill")
paths = []
for t, tag in times:
    p = os.path.join(out, f"f_{tag}.png")
    run(["-ss", f"{t:.3f}", "-i", a.video, "-frames:v", "1", "-vf",
         f"{guides},drawtext=fontfile='{font}':text='{tag} {t:.2f}s':x=20:y=20:fontsize=56:fontcolor=yellow:box=1:boxcolor=black@0.7,scale=360:-2", p])
    paths.append(p)
# tile in rows of 6
lst = os.path.join(out, "list.txt")
for k in range(0, len(paths), 12):
    chunk = paths[k:k + 12]
    inputs = sum((["-i", p] for p in chunk), [])
    n = len(chunk)
    run([*inputs, "-filter_complex", "".join(f"[{i}:v]" for i in range(n)) + f"xstack=inputs={n}:layout=" +
         "|".join(f"{(i%6)*360}_{(i//6)*640}" for i in range(n)) + ":fill=white", os.path.join(out, f"sheet_{k//12}.png")])
print("sheets in", out)
