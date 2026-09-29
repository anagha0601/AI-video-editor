"""Python mirror of src/lib/timeline/derive.ts + fonts.ts.

The browser preview and this worker must agree on every derived value (caption
lines, ducking, color math, Ken Burns, text animation), so keep the two in sync.
"""
from __future__ import annotations

import re

FONTS = {
    "inter": {"ass": "Inter ExtraBold", "bold": False, "asc": 1.1079, "desc": 0.3223},
    "montserrat": {"ass": "Montserrat Thin ExtraBold", "bold": False, "asc": 1.109, "desc": 0.453},
    "bebas": {"ass": "Bebas Neue", "bold": False, "asc": 0.95, "desc": 0.35},
    "playfair": {"ass": "Playfair Display", "bold": True, "asc": 1.159, "desc": 0.251},
    "marker": {"ass": "Permanent Marker", "bold": False, "asc": 1.1094, "desc": 0.3174},
}

CAPTION_MAX_CHARS = {"9:16": 20, "1:1": 24, "16:9": 36}
DUCK_RAMP = 0.25
TEXT_ANIM = 0.4
TEXT_SLIDE_PX = 60
TEXT_POP_FROM = 0.6


def clamp(v, lo, hi):
    return min(hi, max(lo, v))


def clip_end(c) -> float:
    return c["start"] + c["duration"]


def source_out(c) -> float:
    return c["in"] + c["duration"] * c["speed"]


def timeline_duration(tl) -> float:
    end = 0.0
    for t in tl["tracks"]:
        for c in t["clips"]:
            end = max(end, clip_end(c))
    return end


# ------------------------------------------------------------------ captions

def mapped_words(tl, apply_edits=True, tracks=None):
    out = []
    edits = tl["captions"].get("edits", {})
    for track in tracks if tracks is not None else tl["tracks"]:
        if track["kind"] != "voice" or track.get("hidden"):
            continue
        for clip in track["clips"]:
            tr = tl["transcripts"].get(clip.get("assetId") or "")
            if not tr:
                continue
            src_end = source_out(clip)
            for w in tr["words"]:
                mid = (w["start"] + w["end"]) / 2
                if mid < clip["in"] or mid >= src_end:
                    continue
                text = edits.get(w["id"], w["text"]) if apply_edits else w["text"]
                out.append({
                    "id": w["id"],
                    "text": text.strip(),
                    "start": clip["start"] + (max(w["start"], clip["in"]) - clip["in"]) / clip["speed"],
                    "end": clip["start"] + (min(w["end"], src_end) - clip["in"]) / clip["speed"],
                })
    out.sort(key=lambda w: w["start"])
    return out


_SENTENCE_END = re.compile(r"[.!?][\"')\]]?$")


def caption_lines(tl):
    words = [w for w in mapped_words(tl) if w["text"]]
    max_chars = CAPTION_MAX_CHARS[tl["aspect"]]
    max_words = tl["captions"]["maxWords"]
    lines, cur = [], []

    def push():
        nonlocal cur
        if cur:
            lines.append({"start": cur[0]["start"], "end": cur[-1]["end"], "words": cur})
        cur = []

    for w in words:
        if cur:
            last = cur[-1]
            chars = sum(len(x["text"]) + 1 for x in cur) + len(w["text"])
            if (w["start"] - last["end"] > 0.6 or len(cur) >= max_words or chars > max_chars
                    or _SENTENCE_END.search(last["text"])):
                push()
        cur.append(w)
    push()
    for i, line in enumerate(lines):
        nxt = lines[i + 1] if i + 1 < len(lines) else None
        if nxt and nxt["start"] - line["end"] < 0.35:
            line["end"] = nxt["start"]
        else:
            line["end"] = min(line["end"] + 0.2, nxt["start"]) if nxt else line["end"] + 0.2
    return lines


def caption_look(style: str, size: float):
    if style == "bold":
        return {"font": "montserrat", "size": size, "uppercase": True, "outline": round(size * 0.09),
                "outlineColor": "#000000", "shadow": 0, "box": None,
                "word": {"past": ("#FFFFFF", 1), "active": ("#FFE600", 1), "future": ("#FFFFFF", 1)}}
    if style == "karaoke":
        return {"font": "inter", "size": size, "uppercase": False, "outline": round(size * 0.07),
                "outlineColor": "#000000", "shadow": 3, "box": None,
                "word": {"past": ("#4ADE80", 1), "active": ("#4ADE80", 1), "future": ("#FFFFFF", 1)}}
    if style == "minimal":
        return {"font": "inter", "size": round(size * 0.8), "uppercase": False, "outline": 0,
                "outlineColor": "#000000", "shadow": 4, "box": None,
                "word": {"past": ("#FFFFFF", 0.55), "active": ("#FFFFFF", 1), "future": ("#FFFFFF", 0.55)}}
    # boxed
    return {"font": "bebas", "size": round(size * 1.15), "uppercase": True, "outline": 0,
            "outlineColor": "#000000", "shadow": 0,
            "box": {"color": "#000000", "opacity": 0.7, "pad": round(size * 0.22)},
            "word": {"past": ("#FFFFFF", 1), "active": ("#F43F5E", 1), "future": ("#FFFFFF", 1)}}


# ------------------------------------------------------------------ audio

def speech_intervals(tl):
    tracks = []
    for t in tl["tracks"]:
        if t["kind"] != "voice" or t.get("muted"):
            continue
        tracks.append({**t, "hidden": False, "clips": [c for c in t["clips"] if not c.get("muted")]})
    out = []
    for w in mapped_words(tl, apply_edits=False, tracks=tracks):
        if out and w["start"] - out[-1][1] < 0.6:
            out[-1][1] = max(out[-1][1], w["end"])
        else:
            out.append([w["start"], w["end"]])
    return out


# ------------------------------------------------------------------ color

_PRESETS = {
    "none": [1, 0, 0, 0, 1, 0, 0, 0, 1],
    "warm": [1.06, 0.04, 0, 0.02, 1.0, 0, 0, 0, 0.84],
    "cool": [0.88, 0, 0.02, 0, 0.98, 0.04, 0, 0.04, 1.12],
    "bw": [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
}


def _mul(a, b):
    return [sum(a[i * 3 + k] * b[k * 3 + j] for k in range(3)) for i in range(3) for j in range(3)]


def color_ops(f):
    s = f["saturation"]
    sat = [
        0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
        0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
        0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
    ]
    identity = (abs(f["brightness"] - 1) < 1e-3 and abs(f["contrast"] - 1) < 1e-3
                and abs(s - 1) < 1e-3 and f["preset"] == "none")
    return {
        "slope": f["brightness"] * f["contrast"],
        "intercept": 0.5 * (1 - f["contrast"]),
        "matrix": _mul(_PRESETS[f["preset"]], sat),
        "identity": identity,
    }


# ------------------------------------------------------------------ motion

def ken_burns_exprs(kb, p: str):
    """zoompan expressions (z, fx, fy) with p = progress expression 0..1."""
    a = kb["amount"]
    d = kb["direction"]
    if d == "in":
        return f"1+{a}*{p}", "0.5", "0.5"
    if d == "out":
        return f"1+{a}*(1-{p})", "0.5", "0.5"
    if d == "left":
        return f"{1 + a}", f"(1-{p})", "0.5"
    if d == "right":
        return f"{1 + a}", p, "0.5"
    if d == "up":
        return f"{1 + a}", "0.5", f"(1-{p})"
    return f"{1 + a}", "0.5", p


def adjacent_prev(clips, clip):
    best = None
    for c in clips:
        if c["id"] != clip["id"] and abs(clip_end(c) - clip["start"]) < 0.05:
            best = c
    return best


def placement(sw, sh, W, H, tr):
    base = max(W / sw, H / sh) if tr["fit"] == "cover" else min(W / sw, H / sh)
    w = sw * base * tr["scale"]
    h = sh * base * tr["scale"]
    return {"w": w, "h": h, "x": W / 2 + tr["x"] * W - w / 2, "y": H / 2 + tr["y"] * H - h / 2}
