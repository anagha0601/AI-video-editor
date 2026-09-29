"""Text overlays + word-highlight captions -> one ASS subtitle file burned in by libass.

PlayRes equals the timeline design size, so every px value in the timeline maps 1:1
and libass scales the result to the render size. Layout mirrors the canvas preview
(src/components/editor/preview/draw.ts): line height = (asc+desc)*px, centered on (x,y).
"""
from __future__ import annotations

from timeline import (FONTS, TEXT_ANIM, TEXT_POP_FROM, TEXT_SLIDE_PX, caption_lines,
                      caption_look, clip_end)


def _ts(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _color(hex_color: str) -> str:
    h = (hex_color or "#FFFFFF").lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{b}{g}{r}&".upper()


def _alpha(opacity: float) -> str:
    return f"&H{int(round((1 - max(0.0, min(1.0, opacity))) * 255)):02X}&"


def _escape(text: str) -> str:
    return (text.replace("\\", "⧵").replace("{", "(").replace("}", ")")
            .replace("\r", "").replace("\n", "\\N"))


def _font_tags(font_id: str, px: float) -> str:
    f = FONTS[font_id]
    size = px * (f["asc"] + f["desc"])
    return f"\\fn{f['ass']}\\fs{size:.1f}\\b{1 if f['bold'] else 0}"


HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Text,Inter ExtraBold,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: Box,Inter ExtraBold,60,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _text_events(clip, W, H, layer):
    st = clip["style"]
    text = clip["text"].upper() if st.get("uppercase") else clip["text"]
    if not text.strip():
        return []
    x, y = st["x"] * W, st["y"] * H
    boxed = bool(st.get("background"))
    base = _font_tags(st["font"], st["size"]) + f"\\1c{_color(st['color'])}"
    if boxed:
        base += f"\\bord{max(4, round(st['size'] * 0.25))}\\3c{_color(st['background'])}\\3a{_alpha(0.85)}\\shad0"
    else:
        base += (f"\\bord{st.get('outline', 0)}\\3c{_color(st.get('outlineColor', '#000000'))}"
                 f"\\shad{st.get('shadow', 0)}\\4c&H000000&\\4a&H80&")
    style = "Box" if boxed else "Text"
    body = _escape(text)
    start, end = clip["start"], clip_end(clip)
    d = min(TEXT_ANIM, clip["duration"] / 3)
    a_in, a_out = clip.get("animIn", "none"), clip.get("animOut", "none")
    in_end = start + d if a_in != "none" else start
    out_start = end - d if a_out != "none" else end
    ms = int(round(d * 1000))
    events = []

    def ev(s, e, tags):
        if e - s > 0.005:
            events.append(f"Dialogue: {layer},{_ts(s)},{_ts(e)},{style},,0,0,0,,{{\\an5{base}{tags}}}{body}")

    if a_in != "none":
        tags = f"\\fad({ms},0)"
        if a_in == "slide-up":
            tags += f"\\move({x:.1f},{y + TEXT_SLIDE_PX:.1f},{x:.1f},{y:.1f},0,{ms})"
        else:
            tags += f"\\pos({x:.1f},{y:.1f})"
        if a_in == "pop":
            p = int(TEXT_POP_FROM * 100)
            tags += f"\\fscx{p}\\fscy{p}\\t(0,{ms},\\fscx100\\fscy100)"
        ev(start, in_end, tags)
    ev(in_end, out_start, f"\\pos({x:.1f},{y:.1f})")
    if a_out != "none":
        tags = f"\\fad(0,{ms})"
        if a_out == "slide-down":
            tags += f"\\move({x:.1f},{y:.1f},{x:.1f},{y + TEXT_SLIDE_PX:.1f},0,{ms})"
        else:
            tags += f"\\pos({x:.1f},{y:.1f})"
        if a_out == "pop":
            p = int(TEXT_POP_FROM * 100)
            tags += f"\\t(0,{ms},\\fscx{p}\\fscy{p})"
        ev(out_start, end, tags)
    return events


def _caption_events(tl, W, H, layer):
    cap = tl["captions"]
    if not cap.get("enabled"):
        return []
    look = caption_look(cap["style"], cap["size"])
    x, y = W / 2, cap["y"] * H
    base = _font_tags(look["font"], look["size"])
    if look["box"]:
        style = "Box"
        base += (f"\\bord{look['box']['pad']}\\3c{_color(look['box']['color'])}"
                 f"\\3a{_alpha(look['box']['opacity'])}\\shad0")
    else:
        style = "Text"
        base += (f"\\bord{look['outline']}\\3c{_color(look['outlineColor'])}"
                 f"\\shad{look['shadow']}\\4c&H000000&\\4a&H80&")
    events = []
    for line in caption_lines(tl):
        words = line["words"]
        for i, w in enumerate(words):
            s = w["start"] if i > 0 else line["start"]
            e = words[i + 1]["start"] if i + 1 < len(words) else line["end"]
            if e - s <= 0.005:
                continue
            parts = []
            for j, ww in enumerate(words):
                state = "past" if j < i else "active" if j == i else "future"
                color, opacity = look["word"][state]
                txt = ww["text"].upper() if look["uppercase"] else ww["text"]
                parts.append(f"{{\\1c{_color(color)}\\1a{_alpha(opacity)}}}{_escape(txt)}")
            events.append(f"Dialogue: {layer},{_ts(s)},{_ts(e)},{style},,0,0,0,,"
                          f"{{\\an5\\pos({x:.1f},{y:.1f}){base}}}" + " ".join(parts))
    return events


def build_ass(tl) -> str:
    W, H = tl["width"], tl["height"]
    events = []
    n = len(tl["tracks"])
    for idx, track in enumerate(tl["tracks"]):
        if track.get("hidden"):
            continue
        layer = n - idx  # tracks listed higher in the editor draw on top
        if track["kind"] == "text":
            for clip in sorted(track["clips"], key=lambda c: c["start"]):
                events += _text_events(clip, W, H, layer)
        elif track["kind"] == "captions":
            events += _caption_events(tl, W, H, layer)
    return HEADER.format(W=W, H=H) + "\n".join(events) + "\n"
