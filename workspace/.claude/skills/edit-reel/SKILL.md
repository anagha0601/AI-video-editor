---
name: edit-reel
description: Edit raw phone clips in the current folder into a finished, scroll-stopping 1080x1920 Instagram Reel (gym/fitness style) - learns style from a `style/` folder, sorts and trims clips, cleans speech, beat-syncs to a track, burns styled text/captions with ffmpeg, self-reviews frames, and hands off with hooks + caption. Use when the user types /edit-reel or asks to cut clips into a reel. Handles a single talking-head video AND multiple silent workout clips (hook -> grind -> reveal).
---

# /edit-reel: raw clips → finished Instagram Reel

You are the user's reel editor. Windows machine; work in Git-Bash/PowerShell. **Never modify or move the original clips.**
All output goes in `<clip folder>/edit/`. Scripts live next to this file in `scripts/` (copy them into `edit/scripts/` at the start
so the project is self-contained). Reference material is in `reference/`.

## 0. Setup (explain each command before running it)
- `ffmpeg`: if missing, run `winget install ffmpeg` (Gyan.FFmpeg). winget's PATH change doesn't reach the running shell and
  the Links shim may not be created, so **`scripts/ff.py` finds ffmpeg under
  `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin`**. Every script imports it. In bash, prepend that bin dir to PATH.
- Python 3 + `pip install faster-whisper`. For music, `pip install yt-dlp` (run as `python -m yt_dlp`).
- Known Windows gotchas:
  - A stale cached **Hugging Face token** makes public model downloads 401. Prefix with `HF_HUB_DISABLE_IMPLICIT_TOKEN=1`.
  - faster-whisper's own decoder can crash with some PyAV builds (`metadata_errors`). `transcribe.py` decodes via ffmpeg instead.
  - ffmpeg `drawtext` without `fontfile=` segfaults (no fontconfig). Always pass `fontfile=C\:/Windows/Fonts/...`.
    libass (`subtitles=`) works with `fontsdir=C\:/Windows/Fonts`.
  - Bash heredocs containing Python with `'` or `\n` break easily. Write scripts with the Write tool instead.

## 1. Learn the style → `edit/STYLE.md`
If `style/` has reference reels:
- `contact_sheet.py REF.mp4 out.png --every 0.5` and **look at the frames**. Also look at single full-size frames to read the font.
- Cuts: `ffmpeg -i REF -vf "select='gt(scene,0.3)',showinfo" -f null -`, then rerun at 0.12. **Dissolves are missed by scene
  detection.** Sheet the suspicious region at 0.1s steps.
- Loudness: `-af ebur128`. References are often IG *screen recordings*, so ignore the IG UI and the first/last ~1s.
- Record: story shape, avg seconds between cuts, text font/size/position/colour/words-at-once/highlight, zooms, transitions,
  overlays, grade, first-2s pace, music vs voice.
- If there's no style folder, or something is unclear, start from `reference/STYLE-gym-reels.md` (learned from two
  reference reels), which is the **house style**:
  - lowercase phrase, whole phrase on screen at once, static
  - Times New Roman at `ScaleX=80` (condensed serif)
  - white, dark outline 4–5px plus soft shadow, one accent `#FFD60A` on the key word
  - text in the upper third *above* the head, or on the legs when the head fills the top
  - no emojis or graphics
  - ~3s per shot with long reveal holds, music-led, -14 LUFS

## 2. Sort the clips → `edit/clips.md`
- `ff.probe()` for duration and rotation-aware orientation. `contact_sheet.py CLIP out.png --n 20` per clip, then dense sheets
  (`--start --end --every 0.25–1`) on the action parts. **Look at every sheet.** Note the exercise, rep timings (bottom/lockout
  seconds), setup/walk-in/rest/walk-off time, and posing/flex moments.
- Speech: `transcribe.py --detect <all clips>` (VAD). For very short clips also try `--no-vad --model medium`.
  Count a clip as speech only if the words are the creator's and make sense. Background chatter and hallucinations
  ("Thanks for watching!", "you") are not speech. Then `transcribe.py --out edit <speech clips only>` → `transcript.json/.txt`.
- **Horizontal clips: ask the user** whether to crop to vertical or use a blurred background (`fit: crop|blur` in the EDL).
  Show crop-position tests (`crop=ih*9/16:ih:(iw-ow)*cx`) and pick the `cx` that shows the movement best.

## 3. Plan the cut (approval gate)
### A. Multiple silent workout clips → **hook → grind → reveal**
- **Hook (0–~2s):** the punchiest full rep (e.g. deadlift floor → lockout) plus the first half of the quote in the boldest text.
- **Grind:** warm-up first ("the boring part"), then lifts. Shots get shorter as the section goes (≈3s → 0.7s). Every shot is a full
  movement phase (bottom → lockout) and **never ends mid-rep**. Add a quick "mirror check / not yet" beat just before the reveal.
  Hold back any flexes for the reveal.
- **Reveal:** the flex. Second half of the quote, soft dissolve or hard cut on the drop, slow push-in, held long enough to land
  (≥4s). Slight slow-mo (0.6–0.8×) on a held pose is fine. Optional: end on the strongest physique shot (e.g. shirtless).
- Text pop-ups in the grind: max 2–3, short and sassy, only on shots with empty space (ceilings). Keep them off the fast-cut stretch.
### B. Single talking-head video
- `speech_cuts.py transcript.json CLIP --src-dir ... [--drop i-j,...] --out cuts.json`. Fillers, stutters and pauses over 0.3s are
  removed automatically, and cuts are snapped to the quietest 10ms near word boundaries. **You decide retakes and false starts:
  keep the LAST take** and pass the earlier ones with `--drop`. Show the word table and the CLEAN SCRIPT.
- EDL: one shot per segment (`in`=seg in, reel start/end cumulative). Alternate `zoom` 1.0 / 1.1 per cut to hide jump cuts.
  Use the hook text over the first 2s, and B-roll from other clips if available.
- Captions: `captions.py cuts.json edit/reel.ass [--extra hooktext.ass] [--y 1300]` gives 1–3 words on screen with the active
  word in the accent colour. Audio entry `{"voice": true}` (plus optional `"music"`, ducked by `music_gain_db`, default -18).
- If a speaking clip doesn't fit the story (e.g. a 1.6s fragment with no intelligible words), say so and suggest leaving it out.

**Before cutting**, show the user the clip order and a table (reel time, clip, source in→out, what's removed and why,
zoom), plus any cleaned script, and **wait for OK.** Use AskUserQuestion for horizontal handling, grade and music.

## 4. Music & beat sync
- If the style uses music, ask for the track. yt-dlp **can't** read `instagram.com/reels/audio/...` pages; ask for a reel
  link that uses the sound (yt-dlp works on `/reel/<id>/`): `python -m yt_dlp --ffmpeg-location <bin> -x --audio-format mp3 -o edit/music.%(ext)s URL`.
- `beats.py music.mp3 --json work/music.json --plot work/music.png` gives tempo, beat grid, strong onsets, drop candidates and the
  energy curve. **Put every cut on a beat or strong onset, and the reveal cut on the drop** (within 1 frame).
- Check the sound's length against the target. If the drop can't sit at the planned reveal time, ask the user (see the rules below).
- Always tell the user **which second of the song the edit starts from** (the IG start point).

## 5a. Enhance (every reel, after the plan is approved)
Defaults and limits: the "Enhance defaults" section of `{{REEL_STUDIO_DIR}}/rules.md`. CPU only.
- Write `edit/enhance/spec.json`: `{"clips": [{"id": "s0", "type": "video", "path": "<abs clip path>", "in": <shot in>,
  "len": <source seconds the shot uses>, "placedWidth": 1080, "name": "..."}]}`, with one entry per planned shot.
- `python {{REEL_STUDIO_DIR}}/tools/enhance.py analyze --spec edit/enhance/spec.json --out edit/enhance/analysis.json`
  measures exposure, white balance, noise, shake and sharpness, proposes fixes, matches the shots to each other and runs
  the self-check (halos, smear, skin hue, clipping, stabilisation gain/borders/crop). It steps down any fix that fails.
- **Look at every `edit/enhance/sheet_<id>.jpg`.** The top row is before | after; the bottom row is aligned 1:1 crops.
  If a fix looks wrong, write `overrides.json` (`{"s0": {"sharpen": {"amount": 0.2}}}`, or `null` to drop a fix) and
  run `enhance.py check --spec ... --analysis ... --overrides ...`.
- Copy each shot's final `settings` into its EDL shot as `"enhance": {...}`. `build.py` applies them before the grade.
- **AI upscale** (sources under 1080 wide, Real-ESRGAN on the CPU): run `enhance.py upscale-estimate --src CLIP --in S --len S`
  first, **tell the user the estimate and ask** (AskUserQuestion) before `enhance.py upscale ... --out edit/up_<id>.mp4`.
  Then add `"upscale": {"on": true, "url": "<that path>", "srcIn": S, "srcLen": S, "width": 1080, "height": ...}` to the
  shot's `enhance`.

## 5. Build → `edit/edl.json` (+ `edit/reel.ass`) → `build.py`
- EDL schema is in the docstring of `scripts/build.py`. A worked example is in `reference/example-edl.json` + `reference/example-text.ass`.
  - Shot fields: `clip, in, start, end, [out → auto speed], fit, cx, cy, zoom | push:[from,to], grade`.
  - Shot boundaries snap to frames (30fps). The output frame count is exact.
  - Zooms: alternate 1.00 / 1.10 punch-ins on cuts. Use the `cx/cy` anchor to keep the whole body in frame. For a push-in where the
    head or fists are near the top, anchor `cy≈0.02` so the top stays put.
  - Grades (`GRADES` in build.py): `grey` (near-B&W grind), `bw`, `warm`, none. **Ask before applying any grade.** Never shift
    skin tone beyond the agreed look.
- Text: an ASS file. Styles Hook / Pop / Reveal / Cap are defined in `example-text.ass` and `captions.py`. Accent colour in ASS is
  BGR (`#FFD60A` → `&H000AD6FF&`). Keep text between y=250 and y=1520.
- Audio outputs (`audio` list): `music` (preview), `bed` (continuous room-tone/ambience from one clip; never the per-shot gym
  audio, which jumps at every cut), `voice` (talking head). Two-pass loudnorm to **-14 LUFS**, TP -1.5.
- Output: see "Render defaults" in `{{REEL_STUDIO_DIR}}/rules.md`: 1080x1920 at the sources' own frame rate, every shot through
  ReelSmith's `color.py` (iPhone HLG/Dolby Vision tone-mapped to SDR bt709, P3/601/full range converted), one scale,
  lossless shot intermediates, ONE final x264 encode (High, yuv420p, bt709 tags, CRF 17 slow), AAC 192k 48 kHz, `+faststart`.

## 6. Review like a picky editor (mandatory, before showing anything)
`review.py VIDEO edl.json` prints specs and loudness, and writes sheets of the first, middle and last frame of every shot with red
safe-zone lines (y=250, y=1520). **Look at every sheet** and check:
- No text over the face, or over the body mid-rep. Text inside the red lines and not cut off at the edges.
- Every lift shot starts and ends at a movement boundary (lockout/bottom). No cut mid-rep or mid-word.
- The reveal frame on the drop actually shows the payoff (arms already going up, not still down).
- Push-ins don't crop the head, fists or feet. Horizontal clips look clean.
- Enhanced shots: no halos or crunchy edges, no plastic or smeared skin, no stabilisation wobble or borders, and the
  shots look like one shoot (colour and brightness match across cuts).
- Overlays are on screen ≥1.2s (3 words). The reveal holds long enough. Duration and frame count match the plan.
- Talking head: re-transcribe the output (`transcribe.py --out work/check final.mp4`). Words must be intact, with no fillers or retakes.
Fix, re-render, re-review. Only then show the result.

## 7. Hand off
Final video path(s), what the review caught and fixed, 3 alternative hooks in the same sassy motivational tone, and a short IG
caption with a few relevant hashtags. Include the song start second when music is involved.

## Rules from user feedback (append a new rule every time the user gives feedback on an edit)
1. (2026-10-01) **Horizontal clips:** the user chose *crop to vertical* over a blurred background. Still ask each time, but
   preselect crop and pick the most readable `cx` from a crop test.
2. (2026-10-01) **Grade:** the user approved *grey grind → colour reveal* (grind `grey`, reveal untouched natural colour).
   Offer it as the recommended default.
3. (2026-10-01) **Music deliverables:** the user adds the sound in Instagram. Export **`final_nomusic.mp4`** (to post; ambience
   bed) **and `final_preview.mp4`** (with the track, to check sync), also copy nomusic to `final.mp4`, and **state which second
   of the song the edit starts from.** Sync cuts to the beat and land the reveal on the drop.
4. (2026-10-01) **Sound shorter than the target length:** the user chose to *fit the reel to the sound* (song from 0:00, reveal on
   the drop, extend the payoff over the loud section until the sound ends) rather than keep the 30s target. Ask when it happens.
5. (2026-10-01) Instagram `/reels/audio/` links don't work with yt-dlp. Ask for a `/reel/` link that uses the sound.
6. (2026-10-02) **Pacing beats the house style's ~3 s shots:** the user found 3 s shots + an 8 s reveal hold monotonous. Grind
   shots 1-2 beats (max 4), cut ON the drop, keep the reveal moving (new angle / moment / slow-mo every 2-4 beats, no shot over
   ~3 s), 12-25 shots per 15-20 s. Add beat motion: zoom punch on beats, shake + white flash on the drop.
