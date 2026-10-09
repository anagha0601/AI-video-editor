# STYLE.md: learned from `style/` (2 reference reels)

Both references are **screen recordings of Instagram** (IG UI, likes and the song name are visible), so ignore the first ~1s and last ~1s
of each (the post page loading and leaving). The measurements below are for the content only.

| | Ref 1: `11.10.49 AM` (9.9s) | Ref 2: `11.10.56 AM` (10.1s) |
|---|---|---|
| Story | Question → answer. Push-ups: "how would you like to be remembered?" → cable rows: "I'D LIKE TO BE FORGOTTEN" | Setup → **reveal**. Face-mask close-up: "pov: suddenly physique starts speaking for itself" → shirtless mirror selfie |
| Shots (content) | 0–2.9s push-ups · 2.9–8.5s cable row · 8.5s back to push-ups | 0–2.3s face mask · 2.3–8.7s mirror reveal (≈6s hold) |
| Cut detection (ffmpeg `scene>0.3`, then 0.12) | hard cuts at 2.90s and 8.51s | hard cut 8.69s; the face→mirror change at 2.2–2.5s is a **~0.3s cross-dissolve** (scene detection misses it) |
| Avg seconds between cuts | **~3.0s** | **~3.3s**, with the reveal held for ~6s |
| Text | Two separate lines, one per shot. Q: small white sans, lowercase, word-spaced, upper third. A: white hand-drawn **caps**, 2 lines, centre of frame | **Yellow condensed serif** (Times-like, squeezed), lowercase "pov:" voice, 2 lines, **dark outline/shadow**, upper third, above the head |
| Words on screen | Whole phrase at once (5–6 words), static for the whole shot, no word-by-word highlight, no pop animation | Whole phrase at once (7 words), static. The reveal shot swaps to song lyrics in the same yellow serif |
| Motion | Slow handheld drift / gentle push-in on push-ups. No zoom punches | Slow **push-in** on the mirror over the reveal (wide → tighter). Handheld drift |
| Transitions | Hard cuts | Hard cut, plus a **soft dissolve into the reveal** |
| Overlays | None (no emojis, stickers or graphics) | None |
| Grade | **Black & white**, contrasty, moody | Warm, slightly dark and muted. Skin kept natural |
| First 2 seconds | Slow: one shot, text already on screen at frame 1 | Slow: one moody close-up, text already on screen at frame 1 |
| Audio | **Music only** (IG track "Tum Ho X Dooriyan (Ending)"), no voice, -14.1 LUFS | **Music only** (A.R. Rahman track), no voice, -14.5 LUFS |

## Rules for edits in this style
- **Text:** lowercase, whole phrase on screen at once, 1–2 lines, static (no word bouncing).
  Font = Times New Roman squeezed to ~80% width (`ScaleX=80` in ASS) to match ref 2's condensed serif.
  **White text with a dark outline (≈4px) and soft shadow, plus one accent colour: yellow/gold `#FFD60A`** on the key word.
  (Ref 2 is all yellow and ref 1 all white. White + yellow accent combines both.)
- **Position:** upper third, *above* the head/body, never over the face or the body mid-rep. Keep it out of the top 250px and bottom 400px
  (IG UI). In 1080×1920 the text block sits between y≈300 and y≈640.
  (The default "lower third" is overridden because both references put text up top. In gym footage the lower third
  is legs, bar and plates.)
- **Overlays:** no emojis or graphics. Pop-ups, if any: max 1–3, same font, smaller, short, never stacked with another text.
- **Rhythm:** a new visual every 2–4s by default (refs ≈3s). Reveals get a long hold (refs: 5–6s).
- **Reveal:** soft ~0.3s dissolve in, then a slow push-in (100% → ~112%) across the hold.
- **Grade:** moody. Ref 1 is B&W and ref 2 warm and muted. *Always ask before grading.* Never change skin tone except as an agreed look.
- **Audio:** music-led, no voiceover. Loudness -14 LUFS.
- **Hook:** the refs open slowly. For our hook → grind → reveal reels we deliberately open faster (a punchy action clip) but keep
  the same text styling. Text is visible from frame 1.
