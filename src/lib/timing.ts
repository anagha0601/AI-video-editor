// Roughly 2.6 spoken words per second, clamped to keep scenes readable.
export function estimateDuration(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12, Math.max(2.5, Math.round((words / 2.6) * 10) / 10));
}
