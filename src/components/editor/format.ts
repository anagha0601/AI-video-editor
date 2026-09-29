export function formatTime(sec: number, frames = false) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  if (frames) return `${m}:${r.toFixed(2).padStart(5, "0")}`;
  return `${m}:${Math.floor(r).toString().padStart(2, "0")}`;
}

export const fmtSec = (s: number) => `${s.toFixed(1)}s`;
