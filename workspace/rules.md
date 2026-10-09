# Reel rules

Applied on every run. ReelSmith's Rules panel edits this file and "Give feedback" appends to it.

## Edit rules
- Cut on the beat. Never cut mid-rep or mid-word.
- Punch-ins only where the source resolution allows it (no upscaling past the source).
- Text stays outside the safe zones (top 250px, bottom 400px of 1080x1920) and never over a face or body.
- Speech gets word-timed captions with the active word highlighted.
- Natural skin tones. Loudness -14 LUFS, true peak at most -1 dBTP: two-pass loudnorm, then a 4x-oversampled limiter (ReelSmith exports do this in worker/audio_master.py and flag any clipping source).
- Looks: Cinematic Warm (warm highlights, teal/neutral shadows, soft blacks, calmer background colours, subtle vignette, skin protected) is for talking head / best take when the user picks it; default intensity 70%. Skin hue may move at most 3°.
- Sound from a link: link-sourced audio is timing only / personal use unless the user says they have the rights. Always give the second of the sound the edit starts from.
- Default niche: fitness/gym. Default tone: sassy, emotional, motivational.

## Render defaults (video quality)
ReelSmith: worker/render.py + worker/color.py; edit-reel: build.py imports the same color.py.
- **Colour:** every source goes to SDR bt709 (tv range) first. HDR (HLG/PQ, bt2020, iPhone Dolby Vision 8.4) is
  linearised, gamut-mapped and tone-mapped with **mobius (transition 0.15)** at nominal peak 100. Display P3, bt601/
  smpte170m and full-range ("yuvj") sources are converted with zimg. Never let a bt2020/HLG frame reach the encoder untouched.
- **Scale once:** the colour conversion and the one scale to the placed size are one zscale call (lanczos, in linear
  light for HDR). Stabilised clips: convert at the source size, stabilise, then the one scale. No upscaling past the
  source except when the frame size forces it (e.g. a horizontal 1080p clip cropped to vertical): the quality check warns.
  Punch-ins/zooms are capped at what the source resolution allows.
- **Frame rate:** the timeline keeps the sources' own rate (duration-weighted, snapped to 24/25/30/48/50/60, max 60;
  iPhone variable-rate slow-mo counts as 30). Mixed rates are conformed once (fps filter). No dropped or duplicated
  frames at normal speed.
- **One lossy encode:** the filter graph writes a lossless master (x264 -qp 0) + a float WAV; the export is ONE x264
  encode from that master. Intermediates are lossless (edit-reel shot files too) or don't exist.
- **Export:** 1080x1920, H.264 High, yuv420p, bt709 primaries/transfer/matrix, tv range, CRF 17 preset slow,
  keyframe every 2 s, AAC 192k 48 kHz, +faststart.
- **Quality check (every render, pass/fail in the app):** VMAF ≥ 93 (min frame ≥ 80) and SSIM ≥ 0.985 of the export
  against the lossless render of the same edit, bt709 tags, H.264 High yuv420p at the frame size, HDR handled, exact
  frame count, no duplicated frames at normal speed, upscale warnings, 1 lossy encode, bitrate, AAC 48 kHz, faststart.

## Enhance defaults
Applied per clip before the single final encode, CPU only. Engine: `python {{REEL_STUDIO_DIR}}/tools/enhance.py`
(the same code ReelSmith renders with: {{REELSMITH_DIR}}/worker/enhance.py, where the numbers live in `D`).
- **Order:** stabilise → denoise → exposure/contrast/white balance → match across clips → scale → sharpen.
- **Stabilise** only when camera jitter is over 0.3% of the frame width (measured on the frame corners, so a moving
  body is not "shake"). Two-pass vidstab with optzoom=1. Use the gentlest setting that cuts the jitter by at least 35%:
  smoothing 10/16/24 with max shift 2/3/4% and max angle 0.5–0.7°, so the crop stays at or under about 10%.
  Turn it off if it doesn't cut the jitter by at least 25% (usually subject motion), or if it warps or shows borders.
- **Denoise** only when luma noise sigma is over 2.0. Use hqdn3d (spatial luma 1–3, kept low so skin keeps its texture).
  Use nlmeans (s 1–3) only in low light (median luma under 0.22) with sigma over 4. Phone/WhatsApp clips are usually
  already clean, so leave them alone.
- **Sharpen:** light unsharp, luma only, 5×5, amount at most 0.6, after scaling. At most 0.35 when the source is smaller
  than the frame, because unsharp can't invent detail.
- **Exposure/WB:** levels only when the blacks are lifted (p0.5 over 0.04) or the whites are dull (p99.5 under 0.94).
  Gamma toward a median of 0.42 at 60% strength. White balance moves 60% toward neutral, at most ±8% per channel
  (±5% with skin in frame).
- **Match:** pull every clip 80% toward the group's median brightness and neutral balance (gamma ±14%, gains ±4%).
- **Skin tones stay natural:** a correction that moves the skin hue by more than 2° is scaled back before it is proposed.
- **Self-check (must pass):** halo pixels ≤ 6% of edges, texture detail kept ≥ 80%, skin detail kept ≥ 85%,
  skin hue shift ≤ 3°, new clipped highlights ≤ 0.6%, stabilisation shake reduction ≥ 25% with no black borders
  and a crop ≤ 10.5%. A failing fix is stepped down automatically. Then **look at the before/after sheets**: no crunchy
  edges, no plastic skin, no wobble.
- **AI upscale (Real-ESRGAN x4, ncnn, CPU)** only for clips under 1080 wide. Never start it without showing the time
  estimate and getting a yes. Headless runs never upscale; they list the candidates.

## Rules from feedback
1. (2026-10-01) **Horizontal clips:** crop to vertical rather than a blurred background. Still ask each time, but preselect crop and pick the most readable crop centre from a crop test.
2. (2026-10-01) **Grade:** grey grind → colour reveal (grind `grey`, reveal untouched natural colour) is the recommended default.
3. (2026-10-01) **Music deliverables:** the sound is added in Instagram. Export `final_nomusic.mp4` (to post; ambience bed) and `final_preview.mp4` (with the track, to check sync), and state which second of the song the edit starts from. Sync cuts to the beat and land the reveal on the drop.
4. (2026-10-01) **Sound shorter than the target length:** fit the reel to the sound (song from 0:00, reveal on the drop, extend the payoff over the loud section until the sound ends) rather than keep the 30s target. Ask when it happens.
5. (2026-10-01) Instagram `/reels/audio/` links don't work with yt-dlp. Ask for a `/reel/` link that uses the sound.
6. (2026-10-02) **Pacing / energy:** ~3 s shots and a long held reveal felt monotonous (watch time). Music edits cut every 1-2 beats in the build (max 4 beats per shot), cut ON the drop and keep changing every 2-4 beats after it (no shot over ~3 s), 12-25 shots in 15-20 s. ReelSmith adds beat effects on top (zoom punches on beats, shake + white flash on the drop, flash/zoom transitions, beat cuts where the resolution allows a punch-in): `energy` subtle | punchy (default) | hype. Text and captions stay still.
