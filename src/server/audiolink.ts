import "server-only";
// Audio from a link: Instagram /reel/ and YouTube (incl. Shorts) links are fetched with yt-dlp, direct audio file
// links with a guarded download. Everything is converted once to a 48 kHz stereo WAV (the editing master), then
// analysed: beat grid + drop (edit-reel's beats.py, numpy only) and loudness / true peak (ffmpeg ebur128).
// The asset is marked "timing only / personal use" until the user says they have the rights.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { pythonBin, studioDir } from "@/agent/config";
import { prisma } from "./db";
import { HttpError } from "./http";
import { safeDownload } from "./safefetch";
import { localPath, publicUrl } from "./storage";

export type LinkKind = "instagram" | "youtube" | "direct";

export const IG_AUDIO_PAGE_MESSAGE =
  "That's an Instagram audio page, which can't be downloaded. Open a reel that uses this sound and copy its /reel/ link.";

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba|webm|aif|aiff)$/i;
const MAX_DIRECT = 80 * 1024 * 1024;
const MAX_SECONDS = 15 * 60;

/** Which downloader a pasted link needs. Throws a readable 400 for links we can't use. */
export function classifyLink(raw: string): { kind: LinkKind; url: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "That doesn't look like a link");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError(400, "Only http(s) links work");
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const p = u.pathname.toLowerCase();
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    if (/^\/(reels?\/)?audio\//.test(p) || p.startsWith("/explore/audio")) throw new HttpError(400, IG_AUDIO_PAGE_MESSAGE);
    if (/^\/(reels?|p|tv)\/[\w-]+/.test(p)) return { kind: "instagram", url: `https://www.instagram.com${u.pathname}` };
    throw new HttpError(400, "Use an Instagram /reel/ link (open the reel and copy its link)");
  }
  if (host === "youtu.be" || host === "youtube.com" || host === "music.youtube.com" || host.endsWith(".youtube.com")) {
    if (host === "youtu.be" || p.startsWith("/watch") || p.startsWith("/shorts/") || p.startsWith("/live/")) return { kind: "youtube", url: u.toString() };
    throw new HttpError(400, "Use a YouTube video or Shorts link");
  }
  return { kind: "direct", url: u.toString() };
}

function run(cmd: string, args: string[], timeoutMs: number, cwd?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
    let out = "";
    let err = "";
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(t);
      reject(new Error(`Could not run ${cmd}: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out, err });
    });
  });
}

const ffmpeg = () => process.env.FFMPEG_BIN || "ffmpeg";

/** yt-dlp's error lines, minus the noise, for the toast. */
function ytdlpError(err: string, kind: LinkKind) {
  const line = err.split(/\r?\n/).filter((l) => l.includes("ERROR")).pop() ?? err.trim().split(/\r?\n/).pop() ?? "";
  if (/login|rate-limit|private|not available|requested content is not available/i.test(line) && kind === "instagram")
    return "Instagram didn't return this reel (private, removed or rate-limited). Try another public reel that uses the sound.";
  if (/No module named yt_dlp/i.test(err)) return `yt-dlp isn't installed for ${pythonBin()} (pip install -U yt-dlp)`;
  return `Couldn't download the audio: ${line.replace(/^.*ERROR:\s*/, "").slice(0, 300)}`;
}

async function fetchWithYtDlp(url: string, kind: LinkKind, dir: string) {
  const r = await run(
    pythonBin(),
    ["-m", "yt_dlp", "--no-playlist", "--no-progress", "--restrict-filenames", "-f", "bestaudio/best",
      // "<?" also passes when the site doesn't report a duration (Instagram); --print hides the skip message
      "--match-filter", `!is_live & duration <? ${MAX_SECONDS}`, "--print", "after_move:%(title)s", "-o", path.join(dir, "src.%(ext)s"), url],
    5 * 60_000,
  );
  const file = readdirSync(dir).find((f) => f.startsWith("src."));
  if (r.code !== 0 || !file) {
    if (/does not pass filter/i.test(r.out + r.err) || (r.code === 0 && !r.err.trim())) throw new HttpError(400, "That video is a live stream or longer than 15 minutes");
    throw new HttpError(502, ytdlpError(r.err, kind));
  }
  const title = r.out.trim().split(/\r?\n/).pop() || "Linked audio";
  return { file: path.join(dir, file), title };
}

async function fetchDirect(url: string, dir: string) {
  const { buf, url: final } = await safeDownload(url, {
    maxBytes: MAX_DIRECT,
    what: "audio file",
    timeoutMs: 60_000,
    accept: (type, u) =>
      type.startsWith("audio/") ||
      type === "application/ogg" ||
      (["application/octet-stream", "binary/octet-stream", "video/webm", "video/ogg", "application/x-flac", ""].includes(type) && AUDIO_EXT.test(u.pathname)),
  });
  const ext = (path.extname(final.pathname) || ".bin").slice(0, 8);
  const file = path.join(dir, `src${ext}`);
  writeFileSync(file, buf);
  const title = decodeURIComponent(path.basename(final.pathname, ext)).replace(/[_-]+/g, " ").trim() || "Linked audio";
  return { file, title };
}

export interface LinkAnalysis {
  duration: number;
  tempo: number | null;
  beatPeriod: number | null;
  beats: number[];
  strongOnsets: number[];
  drops: { t: number; score: number }[];
  lufs: number | null;
  truePeak: number | null; // dBTP
}

/** Integrated loudness (LUFS) and true peak (dBTP) of a file, from ffmpeg's ebur128 summary. */
export async function loudness(file: string): Promise<{ lufs: number | null; truePeak: number | null }> {
  const r = await run(ffmpeg(), ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], 3 * 60_000);
  const summary = r.err.slice(r.err.lastIndexOf("Summary:"));
  const i = summary.match(/I:\s+(-?[\d.]+|-inf)\s+LUFS/);
  const tp = summary.match(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS/);
  const num = (m: RegExpMatchArray | null) => (m && m[1] !== "-inf" ? Number(m[1]) : null);
  return { lufs: num(i), truePeak: num(tp) };
}

async function analyse(wav: string, dir: string, duration: number): Promise<LinkAnalysis> {
  const beatsPy = path.join(studioDir(), ".claude", "skills", "edit-reel", "scripts", "beats.py");
  const json = path.join(dir, "beats.json");
  let beat: { tempo_bpm?: number; beat_period?: number; beats?: number[]; strong_onsets?: number[]; drop_candidates?: { t: number; score: number }[] } = {};
  if (existsSync(beatsPy)) {
    const r = await run(pythonBin(), [beatsPy, wav, "--json", json], 3 * 60_000, path.dirname(beatsPy));
    if (r.code === 0 && existsSync(json)) beat = JSON.parse(readFileSync(json, "utf8"));
    else console.warn("[audio-link] beats.py failed:", r.err.slice(-400));
  }
  const ld = await loudness(wav);
  return {
    duration,
    tempo: beat.tempo_bpm ?? null,
    beatPeriod: beat.beat_period ?? null,
    beats: (beat.beats ?? []).filter((b) => b >= 0 && b <= duration),
    strongOnsets: beat.strong_onsets ?? [],
    drops: [...(beat.drop_candidates ?? [])].sort((a, b) => b.score - a.score),
    ...ld,
  };
}

/** Download + convert + analyse. Returns the stored WAV (storage key/url) and its analysis. */
export async function importAudioLink(userId: string, raw: string) {
  const link = classifyLink(raw);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "rs-link-"));
  try {
    const src = link.kind === "direct" ? await fetchDirect(link.url, tmp) : await fetchWithYtDlp(link.url, link.kind, tmp);
    const key = `u/${userId}/music/${nanoid(10)}-link.wav`;
    const dst = localPath(key);
    mkdirSync(path.dirname(dst), { recursive: true });
    // the editing master: 48 kHz stereo 24-bit PCM, first audio stream only
    const conv = await run(ffmpeg(), ["-y", "-hide_banner", "-loglevel", "error", "-i", src.file, "-map", "0:a:0", "-vn", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", dst], 3 * 60_000);
    if (conv.code !== 0 || !existsSync(dst)) throw new HttpError(400, "The link has no usable audio track");
    const pr = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", dst], 30_000);
    const duration = Number(pr.out.trim()) || 0;
    if (duration < 0.5) throw new HttpError(400, "The audio is too short");
    const analysis = await analyse(dst, tmp, duration);
    return { kind: link.kind, sourceUrl: link.url, title: src.title.slice(0, 120), key, url: publicUrl(key), size: statSync(dst).size, analysis };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Beat grid, drop and loudness of a stored audio asset (uploaded or linked), saved in meta.analysis. */
export async function analyseAsset(asset: { id: string; key: string | null; duration: number | null; meta: unknown }) {
  const meta = (asset.meta ?? {}) as Record<string, unknown>;
  if ((meta.analysis as LinkAnalysis | undefined)?.beats?.length) return meta.analysis as LinkAnalysis;
  const file = asset.key ? localPath(asset.key) : null;
  if (!file || !existsSync(file)) throw new HttpError(400, "This track isn't stored locally");
  const tmp = mkdtempSync(path.join(os.tmpdir(), "rs-beats-"));
  try {
    let duration = asset.duration ?? 0;
    if (!duration) {
      const pr = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file], 30_000);
      duration = Number(pr.out.trim()) || 0;
    }
    const analysis = await analyse(file, tmp, duration);
    if (!analysis.beats.length) throw new HttpError(422, "Couldn't find a beat in this track");
    await prisma.mediaAsset.update({ where: { id: asset.id }, data: { meta: { ...meta, analysis: { ...analysis } } } });
    return analysis;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** importAudioLink + the library asset ("timing only / personal use" until the user confirms the rights). */
export async function createLinkAsset(userId: string, raw: string) {
  const r = await importAudioLink(userId, raw);
  return prisma.mediaAsset.create({
    data: {
      userId,
      type: "music",
      source: "link",
      key: r.key,
      url: r.url,
      name: r.title,
      mime: "audio/wav",
      duration: r.analysis.duration,
      tags: ["music", "link"],
      meta: {
        hasAudio: true,
        link: { url: r.sourceUrl, kind: r.kind, fetchedAt: new Date().toISOString() },
        rights: false,
        analysis: { ...r.analysis },
      },
    },
  });
}
