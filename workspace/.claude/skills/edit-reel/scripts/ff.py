"""Locate ffmpeg/ffprobe (works even when winget's PATH change hasn't reached this shell)."""
import glob, os, shutil, subprocess, json

def _find(name):
    p = shutil.which(name)
    if p:
        return p
    pats = [os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin\\" + name + ".exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links\\" + name + ".exe"),
            r"C:\ffmpeg\bin\\" + name + ".exe"]
    for pat in pats:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    raise SystemExit(f"{name} not found - run: winget install ffmpeg")

FFMPEG, FFPROBE = _find("ffmpeg"), _find("ffprobe")
FONT_DIR = r"C:\Windows\Fonts"

def run(args, **kw):
    return subprocess.run([FFMPEG, "-hide_banner", "-v", "error", "-y", *args], check=True, **kw)

def probe(path):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    v = next(s for s in j["streams"] if s["codec_type"] == "video")
    rot = 0
    for sd in v.get("side_data_list", []):
        if "rotation" in sd:
            rot = int(sd["rotation"])
    w, h = v["width"], v["height"]
    if abs(rot) % 180 == 90:
        w, h = h, w
    return {"duration": float(j["format"]["duration"]), "width": w, "height": h, "rotation": rot,
            "fps": v.get("r_frame_rate"), "has_audio": any(s["codec_type"] == "audio" for s in j["streams"]),
            "orientation": "vertical" if h > w else "horizontal"}

def ffpath(p):
    """Escape a Windows path for use inside an ffmpeg filter argument."""
    return p.replace("\\", "/").replace(":", r"\:")
