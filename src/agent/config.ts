// Shared by the Next.js server and the agent runner (agent/runner.ts), so no
// "server-only" import here: the runner is a plain Node process.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Per-user data root (setup.ps1 writes the real paths to .env; these are only fallbacks). */
const homeDir = () => path.join(os.homedir(), "ReelSmith");
/** Claude Code workspace with the video-use + edit-reel skills and rules.md. */
export const studioDir = () => path.resolve(process.env.REEL_STUDIO_DIR || path.join(homeDir(), "studio"));
export const rulesPath = () => path.join(studioDir(), "rules.md");
/** Reference reels for style profiles. */
export const styleDir = () => path.resolve(process.env.STYLE_DIR || path.join(homeDir(), "style"));

export const storageDir = () => path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));
/** Per-project working folder Claude reads and writes: raw/, edit/, jobs/, *.json results. */
export const projectDir = (projectId: string) => path.join(storageDir(), "studio", projectId);
export const runnerDir = () => path.join(storageDir(), "studio", "_runner");
export const runnerStatusPath = () => path.join(runnerDir(), "status.json");

/** The ReelSmith checkout (worker/ holds the Python engine) and the Python that runs it. */
export const appDir = () => path.resolve(process.env.REELSMITH_DIR || process.cwd());
export const pythonBin = () => process.env.PYTHON_BIN || "python";
export const enhanceScript = () => path.join(appDir(), "worker", "enhance.py");
export const matteScript = () => path.join(appDir(), "worker", "matte.py");
/** The render worker's own venv (same onnxruntime/numpy as the render), else PYTHON_BIN. */
export const workerPython = () => {
  const venv = path.join(appDir(), "worker", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return existsSync(venv) ? venv : pythonBin();
};

export const PROJECT_SUBDIRS = ["raw", "edit", "edit/scripts", "edit/transcripts", "edit/frames", "edit/verify", "jobs", "render"];

/** Forward slashes: the permission rules only match this form (Bash and file paths). */
export const fwd = (p: string) => p.replace(/\\/g, "/");

/**
 * Variables that would make `claude` bill an API account instead of the logged-in
 * subscription. The runner deletes them from the child environment; both servers
 * warn at startup when they are set.
 */
export const API_KEY_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;
const PROVIDER_VARS = ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "ANTHROPIC_BASE_URL"] as const;

export function billingWarnings(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const k of API_KEY_VARS) {
    if (env[k]) out.push(`${k} is set. ReelSmith removes it before starting claude, but unset it to be safe (it would bill the API instead of your subscription).`);
  }
  for (const k of PROVIDER_VARS) {
    if (env[k]) out.push(`${k} is set. ReelSmith removes it before starting claude so runs use your Claude subscription.`);
  }
  return out;
}

/** Child-process environment for claude: no API credentials, no app secrets. */
export function claudeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const k of [...API_KEY_VARS, ...PROVIDER_VARS, "DATABASE_URL", "AUTH_SECRET"]) delete out[k];
  for (const k of Object.keys(out)) if (k.startsWith("R2_")) delete out[k];
  out.PYTHONIOENCODING = "utf-8"; // the Windows console codepage crashes video-use's helpers on "→"
  out.PYTHONUTF8 = "1";
  out.HF_HUB_DISABLE_IMPLICIT_TOKEN = "1"; // a stale cached Hugging Face token would make public model downloads 401
  // media analysis (vidstab, whisper) easily outlasts Claude Code's 2-minute Bash default on a laptop CPU
  out.BASH_DEFAULT_TIMEOUT_MS = "600000";
  out.BASH_MAX_TIMEOUT_MS = "1800000";
  out.REELSMITH_DIR = appDir();
  out.REEL_STUDIO_DIR = studioDir();
  // `python` in Claude's Bash calls should be the worker venv (faster-whisper, numpy, yt-dlp, video-use deps)
  const venvBin = path.join(appDir(), "worker", ".venv", process.platform === "win32" ? "Scripts" : "bin");
  if (existsSync(venvBin)) {
    const key = Object.keys(out).find((k) => k.toUpperCase() === "PATH") || "PATH";
    out[key] = [venvBin, out[key]].filter(Boolean).join(path.delimiter);
  }
  return out;
}

export interface RunnerStatus {
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  claude: { command: string; version: string | null } | null;
  auth: { loggedIn: boolean; authMethod?: string; subscriptionType?: string } | null;
  warnings: string[];
  currentJobId: string | null;
}

/** The runner rewrites its status file every few seconds; older than this = offline. */
export const RUNNER_STALE_MS = 15_000;
