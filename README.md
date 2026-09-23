# ReelSmith

Turn any idea or script into a ready-to-post short video. The AI writes a hook-first script, splits it into scenes, picks visuals, adds animated captions and an optional AI voiceover, and exports an MP4 for TikTok, Reels, and Shorts.

**Stack:** Next.js 15 (App Router) · Tailwind CSS v4 · Prisma (SQLite locally, Postgres in production) · Groq, Gemini, or Claude API · Stripe (test mode) · Pexels (optional) · ElevenLabs (optional)

## How it works

```
idea / script ──► POST /api/projects ──► Groq, Gemini, or Claude (structured storyboard JSON)
                                     └─► Pexels image search per scene
                          saved to DB as a Project with Scenes
editor (browser) ──► <canvas> renderer: Ken Burns visuals, headline, karaoke captions
export ──► MediaRecorder records the canvas (+ ElevenLabs voice track on Pro) ──► .mp4 / .webm
```

Video rendering runs **in the user's browser** (`src/lib/renderer.ts`), so you don't need a render farm, FFmpeg, or a job queue. Exports render in real time: a 30-second video takes about 30 seconds.

## Features

- **Core loop:** idea or script → AI storyboard → live preview → edit → export MP4
- **Editor:** edit on-screen text and voiceover lines, reorder, add, or delete scenes, swap visuals, autosave
- **Library:** search (title, prompt, caption), filter by status and style, sort, delete
- **Post copy:** an AI-written caption and hashtags you can copy in one click
- **Auth:** email and password (bcrypt), with a signed JWT in an httpOnly cookie
- **Billing:** the Free plan gives 3 videos a month, 9:16 only, with a watermark. Pro ($19/mo) gives unlimited videos, every format, no watermark, and AI voiceover. Payments go through Stripe Checkout and the Customer Portal, with webhooks.
- **Graceful degradation:** every external service is optional, so the app works with zero API keys:

| Missing key | What happens |
|---|---|
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | A template-based "demo" storyboard is used instead of the AI |
| `PEXELS_API_KEY` | Scenes get animated gradient backgrounds and an emoji |
| `ELEVENLABS_API_KEY` | Preview uses the browser's built-in voice; exports have captions and no voice |
| `STRIPE_SECRET_KEY` | The upgrade button shows a "not configured" message |

## Local setup

Requirements: Node 20 or newer.

```bash
npm install
cp .env.example .env          # then fill in the values below
npx prisma db push            # creates prisma/dev.db
npm run dev                   # http://localhost:3000
```

Run `npm run check:ai` to confirm your AI key works before using the app.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | `file:./dev.db` locally; a Postgres URL in production |
| `AUTH_SECRET` | yes | Long random string used to sign session cookies (`openssl rand -base64 32`) |
| `APP_URL` | yes | Public base URL, e.g. `http://localhost:3000`. Used for Stripe redirects |
| `GROQ_API_KEY` | recommended | Free key from console.groq.com/keys. Enables AI scripts. Takes priority over Gemini and Claude |
| `GROQ_MODEL` | no | Default `llama-3.3-70b-versatile` |
| `GEMINI_API_KEY` | no | Use Gemini instead (only when `GROQ_API_KEY` is empty) |
| `GEMINI_MODEL` | no | Default `gemini-flash-lite-latest` |
| `ANTHROPIC_API_KEY` | no | Use Claude instead (only when both keys above are empty) |
| `ANTHROPIC_MODEL` | no | Overrides the Claude model (default `claude-opus-5`) |
| `PEXELS_API_KEY` | recommended | Free key from pexels.com/api for stock visuals |
| `ELEVENLABS_API_KEY` | no | Enables AI voiceover baked into Pro exports |
| `ELEVENLABS_VOICE_ID` | no | Voice to use (default "Rachel") |
| `STRIPE_SECRET_KEY` | for billing | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | for billing | `whsec_...` from the Stripe CLI or Dashboard |
| `STRIPE_PRICE_ID` | no | A recurring price ID. If omitted, an inline $19/mo price is used |

### Stripe test mode

1. Copy your test secret key into `STRIPE_SECRET_KEY`.
2. Forward webhooks locally:
   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Put the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`.
3. Upgrade from `/billing` using card `4242 4242 4242 4242`, any future date, and any CVC.

Upgrades also activate right away without the webhook, because the billing page confirms the Checkout session when Stripe redirects back. The webhook handles renewals, cancellations, and failed payments.

To let users cancel or update their card, enable the **Customer Portal** in the Stripe Dashboard under Settings → Billing → Customer portal.

## Deploying

SQLite files don't persist on serverless hosts, so production uses Postgres.

### Option A: Vercel + Neon (recommended)

1. Create a free Postgres database on [Neon](https://neon.tech) and copy the connection string.
2. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`.
3. Push the repo to GitHub and import it in Vercel.
4. Set every environment variable from the table above. Set `APP_URL` to your Vercel URL.
5. Create the tables once from your machine:
   ```bash
   DATABASE_URL="postgres://..." npx prisma db push
   ```
6. In Stripe, go to Developers → Webhooks and add an endpoint at `https://YOUR_DOMAIN/api/stripe/webhook` for these events:
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
   Put its signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.

The `build` script runs `prisma generate` automatically.

### Option B: Railway / Render / Fly

Add a Postgres plugin, make the same schema change, set the env vars, and use `npm run build` and `npm start`.

## Project structure

```
src/
  app/
    page.tsx                  landing page
    (auth)/login, signup      auth pages
    (app)/dashboard           library (history, search, filter)
    (app)/create              idea/script composer
    (app)/projects/[id]       editor + preview + export
    (app)/billing             plans, checkout, portal
    api/                      auth, projects, media proxy, tts, stripe
  components/                 UI (Editor, Player, Composer, ProjectLibrary…)
  lib/
    ai.ts                     Groq/Gemini/Claude storyboard generation (+ demo fallback)
    renderer.ts               canvas video engine + MediaRecorder export
    auth.ts, stripe.ts, media.ts, usage.ts, plans.ts
prisma/schema.prisma
```

## Notes and limits

- **Export format:** Chrome and Edge record MP4 (H.264). Firefox records WebM, which TikTok and YouTube accept but Instagram may not.
- **Keep the tab visible while exporting.** Browsers throttle rendering in background tabs.
- **Search on Postgres is case-sensitive.** To change that, add `mode: "insensitive"` to the `contains` filters in `src/app/api/projects/route.ts`.
- **Usage quota:** counts projects created this calendar month. "Regenerate" doesn't count.
