"""Person matte for a background swap: Robust Video Matting (ONNX, CPU) over one source window.

  python worker/matte.py estimate --src CLIP --in S --len S
  python worker/matte.py run      --src CLIP --in S --len S --out MATTE.webm

The matte is a separate video, white = person, black = background, at the source's display size and a constant frame
rate (the source's rate rounded up, max 60), lossless VP9 (yuv420p, tv range) so both the browser preview and ffmpeg
read it. ReelSmith keeps the original footage and applies the matte on top (clip.matte; render.py alphamerge,
draw.ts mask), so colour, Enhance and the one final encode are unchanged. RVM's recurrent state keeps the edges stable
from frame to frame; it is reset only at the start of the window.

Model: rvm_mobilenetv3_fp32.onnx (github.com/PeterL1n/RobustVideoMatting, GPL-3.0) in worker/models/, or MATTE_MODEL.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import color  # noqa: E402
from media import ffmpeg_bin  # noqa: E402

MODEL = Path(os.environ.get("MATTE_MODEL") or Path(__file__).resolve().parent / "models" / "rvm_mobilenetv3_fp32.onnx")
MODEL_URL = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx"


def _session():
    import onnxruntime as ort

    if not MODEL.exists():
        raise SystemExit(f"matte model missing: download {MODEL_URL} to {MODEL}")
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
    return ort.InferenceSession(str(MODEL), opts, providers=["CPUExecutionProvider"])


def _geometry(src: str):
    col = color.probe_color(src)
    w, h = int(col.get("width") or 0), int(col.get("height") or 0)
    if not (w and h):
        raise SystemExit("can't read the source size")
    fps = min(60, max(24, math.ceil((col.get("fps") or 30) - 0.01)))
    return col, w - w % 2, h - h % 2, fps


def _frames(src: str, t_in: float, t_len: float, w: int, h: int, fps: int, col, quiet=False):
    """RGB float frames (1, 3, h, w) of the window, SDR bt709 at a constant fps (the matte's timeline)."""
    vf = ",".join(color.source_chain(col, w, h) + [f"fps={fps}", "scale=in_color_matrix=bt709:in_range=tv", "format=rgb24"])
    cmd = [ffmpeg_bin(), "-v", "quiet" if quiet else "error", "-ss", f"{t_in:.4f}", "-t", f"{t_len:.4f}", "-i", src, "-vf", vf,
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    n = w * h * 3
    try:
        while True:
            buf = p.stdout.read(n)
            if len(buf) < n:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3).transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    finally:
        p.stdout.close()
        p.wait()


def _ratio(w: int, h: int) -> float:
    # RVM's guidance: ~0.25 for HD, ~0.4 for 720p, i.e. the model sees ~512 px on the long side
    return float(min(1.0, max(0.125, 512 / max(w, h))))


class Matter:
    def __init__(self, w: int, h: int):
        self.s = _session()
        self.rec = [np.zeros((1, 1, 1, 1), np.float32) for _ in range(4)]
        self.ratio = np.array([_ratio(w, h)], np.float32)

    def __call__(self, frame):
        out = self.s.run(None, {"src": frame, "r1i": self.rec[0], "r2i": self.rec[1], "r3i": self.rec[2],
                                "r4i": self.rec[3], "downsample_ratio": self.ratio})
        self.rec = out[2:6]
        return out[1][0, 0]  # pha, h x w, 0..1


def estimate(src: str, t_in: float, t_len: float) -> dict:
    col, w, h, fps = _geometry(src)
    m = Matter(w, h)
    n, t0 = 0, 0.0
    for i, f in enumerate(_frames(src, t_in, min(t_len, 1.5), w, h, fps, col, quiet=True)):  # stops early
        if i == 2:
            t0 = time.time()  # skip warm-up frames
        m(f)
        n += 1
        if n >= 10:
            break
    per = (time.time() - t0) / max(1, n - 2)
    total = math.ceil(t_len * fps)
    return {"frames": total, "fps": fps, "width": w, "height": h, "secPerFrame": round(per, 3),
            "seconds": round(per * total * 1.15 + 5)}  # +15% for decode/encode


def run(src: str, t_in: float, t_len: float, out: str):
    col, w, h, fps = _geometry(src)
    m = Matter(w, h)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    tmp = out + ".part.webm"
    enc = subprocess.Popen(
        [ffmpeg_bin(), "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
         "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-c:v", "libvpx-vp9", "-lossless", "1", "-row-mt", "1",
         "-deadline", "good", "-cpu-used", "4", *color.output_tags(), "-an", tmp],
        stdin=subprocess.PIPE)
    total = max(1, math.ceil(t_len * fps))
    n, t0 = 0, time.time()
    try:
        for f in _frames(src, t_in, t_len, w, h, fps, col):
            pha = m(f)
            enc.stdin.write((np.clip(pha, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())
            n += 1
            if n % 15 == 0 or n == total:
                left = (time.time() - t0) / n * max(0, total - n)
                print(f"matte {n}/{total} frames, ~{left:.0f}s left", flush=True)
    finally:
        enc.stdin.close()
        code = enc.wait()
    if code != 0 or not n:
        raise SystemExit(f"matte encode failed (code {code}, {n} frames)")
    os.replace(tmp, out)
    print(json.dumps({"out": out, "frames": n, "fps": fps, "width": w, "height": h, "seconds": round(time.time() - t0, 1)}), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["estimate", "run"])
    ap.add_argument("--src", required=True)
    ap.add_argument("--in", dest="t_in", type=float, default=0.0)
    ap.add_argument("--len", dest="t_len", type=float, required=True)
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.cmd == "estimate":
        print(json.dumps(estimate(a.src, a.t_in, a.t_len)))
    else:
        if not a.out:
            raise SystemExit("--out is required")
        run(a.src, a.t_in, a.t_len, a.out)


if __name__ == "__main__":
    main()
