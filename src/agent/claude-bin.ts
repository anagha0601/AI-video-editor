// Find the real Claude Code executable. On Windows `claude` on PATH is usually an
// npm shim (claude.cmd / claude.ps1) that forwards to claude.exe; spawning a .cmd
// needs a shell, which mangles prompts and paths with spaces, so we resolve the
// target and spawn it directly with an argument array.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ClaudeCommand {
  command: string; // executable to spawn
  prefixArgs: string[]; // e.g. [cli.js] when the shim runs node
}

const isWin = process.platform === "win32";

function onPath(name: string): string[] {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return dirs.map((d) => path.join(d, name)).filter((p) => existsSync(p));
}

/** Follow an npm .cmd shim to the binary or JS entry it launches. */
function fromCmdShim(cmdPath: string): ClaudeCommand | null {
  const dir = path.dirname(cmdPath);
  const text = readFileSync(cmdPath, "utf8");
  // "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
  const exe = /"%~?dp0%?\\?([^"]+?\.exe)"/i.exec(text);
  if (exe) {
    const p = path.join(dir, exe[1]);
    if (existsSync(p) && !/node\.exe$/i.test(p)) return { command: p, prefixArgs: [] };
  }
  // older shims: node "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
  const js = /"%~?dp0%?\\?([^"]+?\.(?:c?js|mjs))"/i.exec(text);
  if (js) {
    const p = path.join(dir, js[1]);
    if (existsSync(p)) return { command: process.execPath, prefixArgs: [p] };
  }
  return null;
}

export function resolveClaude(): ClaudeCommand {
  const override = process.env.CLAUDE_BIN;
  if (override) {
    if (/\.cmd$/i.test(override)) {
      const r = fromCmdShim(override);
      if (r) return r;
    }
    return { command: override, prefixArgs: [] };
  }
  if (!isWin) return { command: "claude", prefixArgs: [] };

  const native = [...onPath("claude.exe"), path.join(process.env.USERPROFILE || "", ".local", "bin", "claude.exe")].find((p) => existsSync(p));
  if (native) return { command: native, prefixArgs: [] };

  const appData = process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "claude.cmd") : "";
  for (const shim of [...onPath("claude.cmd"), appData].filter((p) => p && existsSync(p))) {
    const r = fromCmdShim(shim);
    if (r) return r;
  }
  throw new Error(
    "Claude Code not found. Install it (npm install -g @anthropic-ai/claude-code, or the native installer) and log in with `claude`, or set CLAUDE_BIN to the claude.exe path.",
  );
}
