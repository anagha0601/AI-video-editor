"use client";

// Waveform peaks: voice assets carry worker-computed peaks (asset.meta.peaks);
// anything else (music uploads) is decoded once in the browser and cached.

const cache = new Map<string, Promise<{ peaks: number[]; perSec: number } | null>>();

export function loadPeaks(src: string, known?: { peaks?: number[]; peaksPerSec?: number } | null) {
  if (known?.peaks?.length) return Promise.resolve({ peaks: known.peaks, perSec: known.peaksPerSec ?? 50 });
  let p = cache.get(src);
  if (!p) {
    p = (async () => {
      try {
        const buf = await (await fetch(src)).arrayBuffer();
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = new Ctx();
        const audio = await ac.decodeAudioData(buf);
        ac.close();
        const perSec = 50;
        const data = audio.getChannelData(0);
        const win = Math.max(1, Math.floor(audio.sampleRate / perSec));
        const n = Math.floor(data.length / win);
        const peaks = new Array<number>(n);
        let top = 0;
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let j = i * win; j < (i + 1) * win; j += 4) {
            const v = Math.abs(data[j]);
            if (v > m) m = v;
          }
          peaks[i] = m;
          if (m > top) top = m;
        }
        return { peaks: peaks.map((v) => v / (top || 1)), perSec };
      } catch {
        return null; // cross-origin without CORS, or undecodable
      }
    })();
    cache.set(src, p);
  }
  return p;
}
