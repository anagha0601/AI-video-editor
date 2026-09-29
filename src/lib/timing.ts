// Roughly 2.6 spoken words per second, clamped to keep scenes readable.
export function estimateDuration(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12, Math.max(2.5, Math.round((words / 2.6) * 10) / 10));
}

// A scene lasts as long as its narration, unless the user set a length by hand.
export function sceneDuration(s: { narration: string; customDuration?: number | null }) {
  return s.customDuration ? Math.min(20, Math.max(1, s.customDuration)) : estimateDuration(s.narration);
}
