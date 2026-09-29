# ReelSmith

Voice-first AI video editor. Upload or record a voiceover → **faster-whisper** transcribes it with word timings → **Gemini Flash** splits it into scenes with visual keywords → visuals are matched (your library first, **Pexels** second) → you get a first cut in a **multi-track timeline editor** with captions, transitions, text, music ducking, AI edit commands, versions — and export an MP4 from a **Python/ffmpeg worker** that matches the in-browser preview.

No payments, no watermark, no usage caps.

```
browser ──presigned PUT──► R2 (or ./storage)                         ┌──────────── worker (Python) ───────────┐
   │                                                                  │ polls Postgres (FOR UPDATE SKIP LOCKED)│
   ├─ POST /api/projects/:id/voice ─► VoiceTrack(status=queued) ─────►│ faster-whisper → words + timings       │
   │                                                                  │ normalize audio, waveform peaks        │
   ├─ GET /api/projects/:id (poll) ◄─ status=transcribed ◄────────────│                                        │
   │     └─► first cut: Gemini scenes + visual matching → Timeline    │                                        │
   │                                                                  │                                        │
   ├─ editor: timeline JSON ⇄ autosave (PUT /timeline), versions      │                                        │
   └─ POST /renders ─► TimelineVersion + RenderJob(queued) ──────────►│ timeline JSON → ffmpeg filter graph    │
                         ◄──────── progress / output URL ─────────────│ + ASS captions (libass) → MP4 → R2     │
                                                                      └────────────────────────────────────────┘
```

## Stack

| Piece | What |
|---|---|
| Web | Next.js 15 (App Router), Tailwind v4, shadcn/ui (Radix), zustand |
| DB | Postgres via Prisma (docker-compose locally, Neon in prod) |
| Auth | Auth.js v5, email + password (bcrypt), JWT sessions |
| LLM | Gemini Flash (`@google/genai`) — scene split, media auto-tags, AI edit commands |
| Transcription | faster-whisper in the worker (word-level timestamps) |
| Visuals | your uploads (matched by tags) → Pexels video → Pexels photo → gradient card |
| Preview | `<canvas>` compositor driven by the timeline JSON (`src/components/editor/preview`) |
| Render | Python worker builds an ffmpeg filter graph from the same JSON (`worker/render.py`), captions/text via ASS + libass |
| Storage | Cloudflare R2 with presigned uploads; falls back to a local `./storage` folder |

## Run it locally

Requirements: Node 20+, Docker (for Postgres, optionally the worker), Python 3.11+ if you run the worker natively.

```bash
npm install
cp .env.example .env              # fill in AUTH_SECRET, GEMINI_API_KEY, PEXELS_API_KEY
docker compose up -d db           # Postgres on localhost:5433
npx prisma db push                # create tables
npm run dev                       # http://localhost:3000
```

Then start the worker — either natively:

```bash
python -m venv worker/.venv
worker/.venv/bin/pip install -r worker/requirements.txt      # Windows: worker\.venv\Scripts\pip
worker/.venv/bin/python worker/main.py                        # reads ../.env
```

…or in Docker (ffmpeg + Python included): `docker compose up -d --build worker`.
Everything in containers: `docker compose up --build` (web on :3000).

With no R2 variables set, uploads and renders go to `./storage` (served by `/api/files/...`), which the native web app, the native worker and the compose containers all share.

**Try it without a recording:** Dashboard → *Try a sample project*. It uses a bundled narration with a precomputed transcript, so it opens in the editor even before the worker is running (you still need the worker to export).

The first transcription downloads the Whisper model (~140 MB for `base`) into the Hugging Face cache.

## Environment variables

| Variable | Needed by | Description |
|---|---|---|
| `DATABASE_URL` | web, worker | Postgres URL. Local: `postgresql://reelsmith:reelsmith@localhost:5433/reelsmith`. Neon: the pooled connection string |
| `AUTH_SECRET` | web | Auth.js secret (`npx auth secret`); also signs local upload URLs |
| `GEMINI_API_KEY` | web | Gemini API key (paid tier recommended). Without it: heuristic scene split, no auto-tags, AI commands disabled |
| `GEMINI_MODEL` | web | Default `gemini-flash-latest` (falls back to `gemini-3.8-flash`) |
| `PEXELS_API_KEY` | web | Free Pexels key. Without it, unmatched scenes get gradient cards and the Stock tab is disabled |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | web, worker | Cloudflare R2 credentials. Leave empty for local storage |
| `R2_PUBLIC_URL` | web, worker | Public base URL of the bucket (`https://pub-….r2.dev` or a custom domain) |
| `R2_ENDPOINT` | optional | Override the S3 endpoint (any S3-compatible store works) |
| `STORAGE_DRIVER` / `STORAGE_DIR` | optional | Force `local` or `r2`; folder for local storage (default `./storage`) |
| `MONTHLY_BUDGET_USD` | web | Monthly Gemini budget. `/usage` shows progress; a banner appears across the app at 80% and 100% |
| `WHISPER_MODEL` | worker | `tiny`, `base` (default), `small`, `medium`, `large-v3` |
| `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE` | worker | Default `auto` / `int8`. On a GPU box: `cuda` / `float16` |
| `WEB_URL` | worker | Where to fetch relative media URLs (e.g. `/sample/voice.m4a`) when not on local disk |
| `FFMPEG_BIN`, `FONTS_DIR`, `X264_PRESET`, `WORKER_POLL_SECONDS` | worker | Optional overrides |

## Using the editor

- **Timeline**: video/overlay tracks, voice, music, text and captions. Drag to move (across tracks too), drag edges to trim, snapping to clip edges, the playhead and word boundaries (magnet button), Ctrl/⌘ + wheel to zoom.
- **Shortcuts**: Space play/pause · S split (selected clips, or everything under the playhead) · Del delete · Shift+Del ripple delete · ⌘/Ctrl+Z undo · ⌘/Ctrl+Shift+Z (or Ctrl+Y) redo · ⌘/Ctrl+D duplicate · ←/→ step one frame (Shift: 1 s).
- **Ripple delete** closes the gap on that track. On the **voice** track it removes that time range from the whole video, so visuals and captions stay in sync.
- **Trim silences** (Audio tab) removes every pause longer than 0.7 s (adjustable) from the whole timeline.
- **Captions** are derived from the voice clips + transcript, so they follow every trim, split, speed change and silence cut. Word edits are stored per word id.
- **AI edits** (AI tab): Gemini returns high-level operations; the server resolves any new footage; the browser applies them to a copy, shows a summary + JSON-patch diff and previews it in the player. Apply = one undoable step.
- **Versions**: named snapshots, restore (as an undoable change, with an automatic "before restore" snapshot), duplicate as a new project. Every render snapshots its exact timeline as a version, so the render history always shows what was exported.

## API usage & cost

Every Gemini request goes through `callGemini()` in `src/server/gemini.ts`, the only module that holds the SDK client. It saves one `ApiUsage` row per response: timestamp, model, feature (`script`, `scene_split`, `ai_edit`, `tagging`, `tts`, `image`), project, input/output/thinking tokens and `cost_usd`.

- **Prices** are in `src/config/pricing.ts`, in USD per 1M tokens, per model; thinking tokens are billed at the output price. Edit that one file when Google changes rates. Rows already logged keep the cost they were saved with.
- **`/usage`** (Usage in the header) shows:
  - spend for today, this week, this month and all time (UTC days)
  - a daily bar chart for the last 30 days, with a table view
  - breakdowns by feature and by model
  - a sortable cost-per-video table
  - the monthly budget from `MONTHLY_BUDGET_USD`
- Scripts are written before their project exists; their usage rows are linked to the project when it's created.

## Gemini quick-import (manual, no API cost)

Generate images in your personal Gemini account and bring them into the editor:

1. **Open Gemini** (editor top bar) opens gemini.google.com in a window beside the editor.
2. **Copy prompt**, on a selected scene in the Inspector or the copy icon on a timeline clip, copies that scene's visual hint as an image prompt with the aspect ratio added (e.g. "vertical 9:16").
3. **Ctrl+V** anywhere in the editor: an image on the clipboard is uploaded (source `gemini_manual`) and replaces the selected scene's visual (or the scene under the playhead). You'll see "Image added to scene N".
4. **Drag and drop** images from a browser tab or the desktop:
   - onto a timeline clip: replaces that scene's visual
   - onto an empty spot on a track: adds a clip there
   - onto the preview: replaces the scene under the playhead

   Images dragged from a web page are downloaded by the server (`/api/media/import`: public http(s) addresses only, images only, 20 MB max).
5. Images placed on scenes get Ken Burns motion. The media library can filter by source: uploads, Pexels, Gemini (manual), AI generated.

## Timeline JSON schema

One JSON document per project (`Timeline.json`) is the source of truth for both the preview and the render. Types: `src/lib/timeline/types.ts`; derived math: `src/lib/timeline/derive.ts`, mirrored in `worker/timeline.py`.

```jsonc
{
  "version": 1,
  "aspect": "9:16",               // "9:16" | "16:9" | "1:1"
  "width": 1080, "height": 1920,  // design resolution; all px values use it. 720p renders scale uniformly
  "fps": 30,
  "background": "#000000",
  "duckLevel": 0.2,               // music gain while the voice speaks
  "captions": {
    "enabled": true,
    "style": "bold",              // bold | karaoke | minimal | boxed
    "y": 0.72,                    // center, fraction of frame height
    "size": 76,                   // px
    "maxWords": 4,
    "edits": { "ab12cd_7": "PRODUCTIVITY" }   // word id -> replacement ("" hides the word)
  },
  "transcripts": {                // voice asset id -> whisper words, in SOURCE seconds
    "ab12cd…": { "words": [{ "id": "ab12cd_0", "text": "Most", "start": 0.12, "end": 0.38 }] }
  },
  "tracks": [                     // listed top -> bottom; upper video tracks draw on top
    { "id": "t_…", "kind": "captions", "name": "Captions", "clips": [] },
    { "id": "t_…", "kind": "text", "name": "Text", "clips": [
      { "id": "c_…", "type": "text", "start": 0, "duration": 3, "text": "Do less,\non purpose",
        "preset": "title", "animIn": "pop", "animOut": "fade",        // none|fade|slide-up|pop / none|fade|slide-down|pop
        "style": { "font": "montserrat", "size": 120, "color": "#FFFFFF", "background": null,
                   "outline": 8, "outlineColor": "#000000", "shadow": 0, "uppercase": true, "x": 0.5, "y": 0.2 } }
    ]},
    { "id": "t_…", "kind": "video", "name": "Video", "clips": [
      { "id": "c_…", "type": "video",            // video | image | color
        "start": 0, "duration": 3.2,              // timeline seconds
        "in": 1.5, "speed": 1,                    // source in-point; source out = in + duration*speed
        "src": "https://…mp4", "assetId": "…", "thumb": "…", "name": "Scene 1 · city night",
        "srcDuration": 12.4, "srcWidth": 1080, "srcHeight": 1920, "hasAudio": true,
        "volume": 1, "muted": true, "fadeIn": 0, "fadeOut": 0,
        "transition": { "type": "crossfade", "duration": 0.5 },  // cut|crossfade|slide|zoom; enters from the adjacent previous clip
        "transform": { "fit": "cover", "scale": 1, "x": 0, "y": 0 }, // cover|contain, extra zoom, center offset (fraction of frame)
        "filters": { "brightness": 1, "contrast": 1, "saturation": 1, "preset": "none" }, // none|warm|cool|bw
        "kenBurns": null,                          // images: { "direction": "in|out|left|right|up|down", "amount": 0.15 }
        "colors": null,                            // color clips: ["#from", "#to"] diagonal gradient
        "keywords": ["city", "night"], "scene": 1 }
    ]},
    { "id": "t_…", "kind": "voice", "name": "Voice", "clips": [
      { "id": "c_…", "type": "audio", "src": "…/voice.m4a", "assetId": "ab12cd…", "name": "Voiceover",
        "start": 0, "duration": 48.1, "in": 0, "speed": 1, "volume": 1, "muted": false, "fadeIn": 0, "fadeOut": 0 }
    ]},
    { "id": "t_…", "kind": "music", "name": "Music", "clips": [
      { "id": "c_…", "type": "audio", "src": "…/track.mp3", "start": 0, "duration": 48, "in": 0, "speed": 1,
        "volume": 0.5, "muted": false, "fadeIn": 0, "fadeOut": 1.5,
        "duck": true, "keyframes": [{ "t": 40, "gain": 1 }, { "t": 46, "gain": 0.2 }] }   // t relative to clip start
    ]}
  ]
}
```

Rendering rules both sides follow:

- **Frames**: a clip covers frames `round(start*fps)` to `round(end*fps)`. Videos shorter than their clip hold the last frame.
- **Placement**: `cover` or `contain` fit × `scale`, centered, offset by `x*W`, `y*H`.
- **Color**: per channel `v*brightness*contrast + 0.5*(1-contrast)`, then a 3×3 matrix (CSS saturate × preset). Preview: SVG `feComponentTransfer` + `feColorMatrix`. Render: `lutrgb` + `colorchannelmixer`.
- **Ken Burns**: zoom window `z` at position `(fx, fy)` of the free space, from `kenBurnsAt()`. Render: `zoompan` on a 2× canvas.
- **Transitions**: the previous clip holds its last frame while the next one enters, matching ffmpeg `xfade` (`fade`, `slideleft`, `zoomin`).
- **Text**: line height = `(asc + desc) × px` from each font's OS/2 win metrics, block centered on `(x, y)`. The fonts in `public/fonts` are used by both the browser and libass.
- **Captions**: words mapped through voice clips → lines (≤ `maxWords`, ≤ N chars, break on pauses > 0.6 s and at sentence ends) → the active word is highlighted from its start until the next word starts.
- **Audio**: gain = volume × keyframes × linear fades × ducking. Ducking is the speech intervals (words, merged when gaps are < 0.6 s) with 0.25 s ramps.

## Deploy

**Database — Neon.** Create a project and copy the pooled connection string into `DATABASE_URL`. Run `npx prisma db push` once from your machine against it.

**Storage — Cloudflare R2.**
1. Create a bucket, then enable public access (the r2.dev subdomain or a custom domain) → `R2_PUBLIC_URL`.
2. Create an R2 API token with Object Read & Write → `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, plus your `R2_ACCOUNT_ID` and `R2_BUCKET`.
3. Add a bucket **CORS** policy so browsers can upload directly and read audio for waveforms:
   ```json
   [{ "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
      "AllowedMethods": ["GET", "PUT", "HEAD"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```

**Web — Vercel.** Import the repo. Set `DATABASE_URL`, `AUTH_SECRET`, `GEMINI_API_KEY`, `PEXELS_API_KEY` and the `R2_*` vars. The build runs `prisma generate && next build`. The first-cut build and AI edits run inside route handlers (`maxDuration` 60 s). Rendering never runs on Vercel.

**Worker — Railway or Fly.io**, from `worker/Dockerfile` (build context = repo root):
- Railway: New service → from repo → set *Dockerfile path* to `worker/Dockerfile`, add the env vars (`DATABASE_URL` should be Neon's direct, non-pooled URL; the `R2_*` vars; `WHISPER_MODEL`; `WEB_URL=https://your-app.vercel.app`).
- Fly.io: `fly launch --dockerfile worker/Dockerfile --no-deploy`, then `fly secrets set DATABASE_URL=… R2_…=… WEB_URL=…` and `fly deploy`. Give it ≥ 2 GB RAM (`fly scale memory 2048`) for Whisper + ffmpeg.
- Scale by running more workers: jobs are claimed with `FOR UPDATE SKIP LOCKED`, and stale jobs (worker died) are retried after 20 minutes, up to 3 attempts.

## Project layout

```
src/lib/timeline/     types, derive (shared math), ops (edit operations), ai (AI ops), factory
src/components/editor/ Player (canvas preview), Timeline, panels (Media, Text, Captions, Audio, AI, Inspector), store
src/server/           prisma, storage (R2/local), gemini, pexels, scenes, visuals, first cut, AI edit planner
src/app/api/          projects, voice, timeline, versions, renders, media, uploads, pexels, files (local storage)
worker/               main loop, transcribe (faster-whisper), render (ffmpeg graph), ass (captions/text), timeline (mirror)
```
