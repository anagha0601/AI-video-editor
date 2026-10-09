"""Render a reel from an edit decision list (EDL json).

usage: build.py EDL.json [--only-shots] [--out-dir DIR]

EDL format (all times in seconds):
{
  "src_dir": "C:/path/to/clips",              # where the raw clips live
  "fps": 30, "w": 1080, "h": 1920,
  "shots": [
    {"clip": "clip01.mp4",             "in": 21.10, "start": 0.0, "end": 2.46,   # reel time start/end
     "speed": 1.0,                       # optional; default = derived from "out" if given, else 1
     "out": 23.56,                       # optional source out-point; speed = (out-in)/(end-start)
     "fit": "fill" | "crop" | "blur",    # vertical source -> fill; horizontal -> crop (cx) or blur background
     "cx": 0.5, "cy": 0.5,               # anchor for crop / zoom (fraction of frame)
     "zoom": 1.10,                       # static punch-in, or
     "push": [1.0, 1.12],                # slow zoom from->to over the shot
     "grade": "grey" | null,
     "enhance": {...}}                   # optional per-shot fixes from tools/enhance.py analyze (settings of that clip):
                                         # stabilize / denoise / sharpen / color / match / upscale, applied before the grade
  ],
  "text_ass": "reel.ass",                 # optional ASS subtitle/overlay file burned in at the end
  "audio": [{"name": "final_preview", "music": "music.mp3", "music_start": 0.0},
            {"name": "final_nomusic", "bed": "<clip>", "bed_start": 20.0}],
  "lufs": -14
}
"""
import argparse, json, math, os, shutil, subprocess, sys
from pathlib import Path
from ff import FFMPEG, run, probe, ffpath, FONT_DIR

# ReelSmith's worker modules: colour handling (HDR tone-map, P3/601/full range -> bt709 SDR) on every shot,
# and the Enhance engine (same filters, same order) when a shot uses "enhance".
sys.path.insert(0, os.path.join(os.environ.get("REELSMITH_DIR") or "{{REELSMITH_DIR}}", "worker"))
import color  # noqa: E402

def _engine():
    import enhance
    return enhance

GRADES = {
    None: "",
    "grey": "eq=saturation=0.12:contrast=1.06:brightness=-0.01",   # near-B&W, "the boring grind"
    "bw": "hue=s=0,eq=contrast=1.12",
    "warm": "colorbalance=rs=0.04:bs=-0.04:rm=0.02:bm=-0.02,eq=saturation=0.9:brightness=-0.03",
}

def shot_filter(s, info, W, H, fps, nframes, enh=([], [], []), src_color=None):
    pre, post_fps, post_scale = enh
    f = color.source_chain(src_color) if src_color else []   # HDR/P3/601 -> bt709 SDR, before anything else
    f += list(pre)                       # vidstabtransform reads frames in source order
    speed = s["speed"]
    f.append(f"setpts=(PTS-STARTPTS)/{speed:.6f}")
    f.append(f"fps={fps}")
    f += post_fps                        # denoise, exposure/WB + match
    horizontal = info["orientation"] == "horizontal"
    fit = s.get("fit", "crop" if horizontal else "fill")
    cx, cy = s.get("cx", 0.5), s.get("cy", 0.5)
    if fit == "blur":
        f.append(f"split[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=40:2,eq=brightness=-0.08[bg];"
                 f"[b]scale={W}:-2:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2")
    else:
        # crop source to 9:16 around cx (no-op for 9:16 vertical sources)
        f.append(f"crop='min(iw,ih*{W}/{H})':'min(ih,iw*{H}/{W})':'(iw-ow)*{cx}':'(ih-oh)*{cy}'")
    push = s.get("push")
    if push:
        z0, z1 = push
        n = max(nframes - 1, 1)
        # zoompan on a 2x canvas for sub-pixel-smooth motion; anchor (cx,cy) stays put on screen
        f.append(f"scale={2*W}:{2*H}:flags=lanczos")
        f.append(f"zoompan=z='{z0}+({z1}-{z0})*on/{n}':x='{cx}*(iw-iw/zoom)':y='{cy}*(ih-ih/zoom)':d=1:s={W}x{H}:fps={fps}")
    else:
        z = s.get("zoom", 1.0)
        sw, sh = int(round(W * z / 2) * 2), int(round(H * z / 2) * 2)
        f.append(f"scale={sw}:{sh}:flags=lanczos")
        f.append(f"crop={W}:{H}:'min(max(0,{cx}*iw-{W}/2),iw-{W})':'min(max(0,{cy}*ih-{H}/2),ih-{H})'")
    f += post_scale                      # light unsharp at output size
    g = GRADES[s.get("grade")]
    if g:
        f.append(g)
    f.append("setsar=1,format=yuv420p")
    return ",".join(f)

def loudnorm_2pass(src, ss, pre, lufs):
    """Measure pass -> linear loudnorm filter string that hits `lufs` integrated."""
    p = subprocess.run([FFMPEG, "-hide_banner", "-ss", f"{ss:.3f}", "-i", src, "-af",
                        f"{pre},loudnorm=I={lufs}:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    txt = p.stderr[p.stderr.rfind("{"):p.stderr.rfind("}") + 1]
    m = json.loads(txt)
    return (f"loudnorm=I={lufs}:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
            f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("edl"); ap.add_argument("--out-dir")
    ap.add_argument("--only-shots", action="store_true")
    a = ap.parse_args()
    edl = json.load(open(a.edl, encoding="utf-8"))
    base = os.path.dirname(os.path.abspath(a.edl))
    out_dir = a.out_dir or base
    work = os.path.join(base, "work", "shots"); os.makedirs(work, exist_ok=True)
    W, H, fps = edl.get("w", 1080), edl.get("h", 1920), edl.get("fps", 30)
    src_dir = edl["src_dir"]
    parts, aparts = [], []
    want_voice = any(au.get("voice") for au in edl.get("audio", []))
    for i, s in enumerate(edl["shots"]):
        path = os.path.join(src_dir, s["clip"])
        info = probe(path)
        f0, f1 = round(s["start"] * fps), round(s["end"] * fps)
        nframes = f1 - f0
        dur = nframes / fps
        if "out" in s:
            s["speed"] = (s["out"] - s["in"]) / dur
        s.setdefault("speed", 1.0)
        src_len = dur * s["speed"]
        if s["in"] + src_len > info["duration"] + 0.05:
            sys.exit(f"shot {i}: source window {s['in']}+{src_len:.2f} exceeds clip length {info['duration']:.2f}")
        enh, t_in, vpath = ([], [], []), s["in"], path
        if s.get("enhance"):
            E = _engine()
            vpath, t_in = E.upscaled_source(s["enhance"], path, s["in"], lambda u: u)
            enh = E.clip_filters(s["enhance"], path=vpath, t_in=t_in, t_len=src_len + 0.5,
                                 src_w=probe(vpath)["width"], workdir=Path(work))
        vf = shot_filter(s, info, W, H, fps, nframes, enh, color.probe_color(vpath))
        out = os.path.join(work, f"shot_{i:02d}.mkv")
        # lossless shot intermediates: the only lossy video encode is the final one
        run(["-ss", f"{t_in:.3f}", "-t", f"{src_len + 0.5:.3f}", "-i", vpath, "-filter_complex", f"[0:v]{vf}[v]",
             "-map", "[v]", "-frames:v", str(nframes), "-r", str(fps), "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0",
             "-pix_fmt", "yuv420p", *color.output_tags(), "-an", out], cwd=work)
        if want_voice:   # shot's own sound (talking heads): exact length, 5ms micro-fades so cuts never click
            wav = os.path.join(work, f"shot_{i:02d}.wav")
            tempo = f"atempo={s['speed']:.5f}," if abs(s["speed"] - 1) > 1e-3 else ""
            run(["-ss", f"{s['in']:.3f}", "-t", f"{src_len + 0.2:.3f}", "-i", path, "-af",
                 f"{tempo}aresample=48000,apad,atrim=0:{dur:.5f},afade=t=in:d=0.005,afade=t=out:st={dur - 0.005:.5f}:d=0.005",
                 "-ac", "2", "-c:a", "pcm_s16le", wav])
            aparts.append(wav)
        print(f"shot {i:2d}  {s['start']:6.2f}-{s['end']:6.2f}  {nframes:3d}f  speed {s['speed']:.3f}  {s['clip'][28:]}")
        parts.append(out)
    if a.only_shots:
        return
    lst = os.path.join(work, "concat.txt")
    open(lst, "w").write("".join(f"file '{p.replace(os.sep, '/')}'\n" for p in parts))
    joined = os.path.join(work, "joined.mkv")
    run(["-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", joined])
    total = sum(round(s["end"] * fps) - round(s["start"] * fps) for s in edl["shots"]) / fps

    # burn text
    vf = "null"
    if edl.get("text_ass"):
        ass = os.path.join(base, edl["text_ass"])
        vf = f"subtitles='{ffpath(ass)}':fontsdir='{ffpath(FONT_DIR)}'"
    video = os.path.join(work, "video.mp4")
    run(["-i", joined, "-vf", vf + f",format=yuv420p,{color.TAG_709}", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
         "-profile:v", "high", *color.output_tags(), "-r", str(fps), "-an", video])

    voice = None
    if aparts:
        alst = os.path.join(work, "aconcat.txt")
        open(alst, "w").write("".join(f"file '{p.replace(os.sep, '/')}'\n" for p in aparts))
        voice = os.path.join(work, "voice.wav")
        run(["-f", "concat", "-safe", "0", "-i", alst, "-c", "copy", voice])

    lufs = edl.get("lufs", -14)
    for au in edl.get("audio", []):
        out = os.path.join(out_dir, au["name"] + ".mp4")
        if au.get("voice") and au.get("music"):
            # voice on top, music ducked underneath (music_gain_db, default -18 dB)
            mix = os.path.join(work, au["name"] + "_mix.wav")
            run(["-i", voice, "-ss", f"{au.get('music_start', 0.0):.3f}", "-i", os.path.join(base, au["music"]), "-filter_complex",
                 f"[1:a]aresample=48000,volume={au.get('music_gain_db', -18)}dB[m];[0:a][m]amix=inputs=2:duration=first:normalize=0",
                 "-c:a", "pcm_s16le", mix])
            src, ss = mix, 0.0
        elif au.get("voice"):
            src, ss = voice, 0.0
        elif au.get("music"):
            src, ss = os.path.join(base, au["music"]), au.get("music_start", 0.0)
        else:
            src, ss = os.path.join(src_dir, au["bed"]), au.get("bed_start", 0.0)
        pre = (f"atrim=0:{total:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,"
               f"afade=t=out:st={total - au.get('fade_out', 0.4):.3f}:d={au.get('fade_out', 0.4)}")
        af = f"{pre},{loudnorm_2pass(src, ss, pre, lufs)},aresample=48000"
        run(["-i", video, "-ss", f"{ss:.3f}", "-i", src, "-filter_complex", f"[1:a]{af}[a]", "-map", "0:v", "-map", "[a]",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{total:.3f}", "-movflags", "+faststart", out])
        print("wrote", out)

if __name__ == "__main__":
    main()
