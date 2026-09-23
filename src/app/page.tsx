import Link from "next/link";
import { getSessionUserId } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { HeroDemo } from "@/components/HeroDemo";
import { Pricing } from "@/components/Pricing";

const STEPS = [
  { n: "1", title: "Drop in an idea or script", body: "One line like “3 habits of calm people” or a full script you already wrote." },
  { n: "2", title: "AI builds the video", body: "Claude writes a hook-first script, splits it into scenes, and picks visuals for each beat." },
  { n: "3", title: "Tweak, export, post", body: "Edit any line, swap visuals, then export a captioned vertical video with a ready-made caption." },
];

const FEATURES = [
  { icon: "🪝", title: "Hook-first scripts", body: "Every video opens with a scroll-stopping line in the first two seconds." },
  { icon: "💬", title: "Animated captions", body: "Word-by-word karaoke captions — 85% of people watch on mute." },
  { icon: "🎞️", title: "Auto visuals", body: "Stock photos matched to each scene with smooth Ken Burns motion." },
  { icon: "🎙️", title: "AI voiceover", body: "Natural narration timed to every scene (Pro)." },
  { icon: "📐", title: "Every format", body: "9:16 for TikTok, Reels & Shorts, plus 1:1 and 16:9 on Pro." },
  { icon: "#️⃣", title: "Post copy included", body: "A caption and hashtags written for the video, one click to copy." },
];

const FAQ = [
  { q: "Do I need editing skills?", a: "No. You type an idea, we produce the full video. Editing is optional and as simple as changing text." },
  { q: "Who owns the videos?", a: "You do. Use them on any platform, including for commercial work." },
  { q: "Where are videos rendered?", a: "Right in your browser, so exports are instant to start and never sit in a queue." },
  { q: "Can I cancel anytime?", a: "Yes — manage or cancel your subscription from the billing page in one click." },
];

export default async function Landing() {
  const signedIn = Boolean(await getSessionUserId());
  const primary = signedIn ? { href: "/create", label: "Open the studio" } : { href: "/signup", label: "Make a video free" };

  return (
    <div className="overflow-x-hidden">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-zinc-950/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-2 text-sm sm:gap-4">
            <a href="#how" className="hidden text-zinc-400 hover:text-white sm:block">
              How it works
            </a>
            <a href="#pricing" className="hidden text-zinc-400 hover:text-white sm:block">
              Pricing
            </a>
            {signedIn ? (
              <Link href="/dashboard" className="btn-ghost py-2">
                Dashboard
              </Link>
            ) : (
              <>
                <Link href="/login" className="px-2 text-zinc-300 hover:text-white">
                  Sign in
                </Link>
                <Link href="/signup" className="btn-primary py-2">
                  Start free
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="bg-grid relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[500px] bg-gradient-to-b from-brand-600/15 via-accent-500/5 to-transparent" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.2fr_1fr]">
          <div className="text-center lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> AI video for TikTok, Reels & Shorts
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              Turn any idea into a <span className="text-gradient">ready-to-post video</span> in minutes.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400 lg:mx-0">
              ReelSmith writes the script, picks the visuals, times the captions and voiceover, and hands you a finished short. No
              editing skills, no timeline, no stock-footage rabbit holes.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <Link href={primary.href} className="btn-primary px-6 py-3 text-base">
                ✨ {primary.label}
              </Link>
              <a href="#how" className="btn-ghost px-6 py-3 text-base">
                See how it works
              </a>
            </div>
            <p className="mt-4 text-sm text-zinc-500">3 free videos every month · No credit card</p>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">From blank page to posted in 3 steps</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="card p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-accent-500 font-bold">{s.n}</span>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-zinc-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">Everything a faceless channel needs</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-zinc-400">
          Built for creators, marketers, and small businesses who need to post daily without hiring an editor.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-white/10 p-6 transition hover:border-white/20 hover:bg-white/[0.02]">
              <div className="text-2xl">{f.icon}</div>
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-bold sm:text-4xl">Simple pricing</h2>
        <p className="mb-12 mt-3 text-center text-zinc-400">Start free. Upgrade when you&apos;re posting every day.</p>
        <Pricing
          cta={(plan) => (
            <Link href={signedIn ? "/billing" : "/signup"} className={plan === "pro" ? "btn-primary w-full" : "btn-ghost w-full"}>
              {plan === "pro" ? "Go Pro" : "Start free"}
            </Link>
          )}
        />
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h2 className="mb-8 text-center text-3xl font-bold">Questions</h2>
        <div className="space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="card group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {f.q}
                <span className="text-zinc-500 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-zinc-400">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-accent-500 px-6 py-14 text-center">
          <div className="bg-grid absolute inset-0 opacity-40" />
          <div className="relative">
            <h2 className="text-3xl font-bold sm:text-4xl">Your next video is one sentence away.</h2>
            <Link href={primary.href} className="btn mt-8 bg-white px-6 py-3 text-base text-zinc-900 hover:bg-zinc-100">
              {primary.label} →
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-sm text-zinc-500">
        © {new Date().getFullYear()} ReelSmith · Made for creators
      </footer>
    </div>
  );
}
