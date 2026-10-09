"""Beat / drop analysis with numpy only.
usage: beats.py AUDIO [--json OUT.json] [--plot OUT.png]
Prints tempo, beat grid, the energy curve (per 0.5s) and drop candidates (biggest sustained jumps in loudness/low-end)."""
import argparse, json, subprocess, sys
import numpy as np
from ff import FFMPEG

ap = argparse.ArgumentParser(); ap.add_argument("audio"); ap.add_argument("--json"); ap.add_argument("--plot")
a = ap.parse_args()
SR, HOP, NFFT = 22050, 512, 2048
raw = subprocess.run([FFMPEG, "-v", "error", "-i", a.audio, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
y = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
dur = len(y) / SR
# STFT
win = np.hanning(NFFT).astype(np.float32)
n = 1 + (len(y) - NFFT) // HOP
frames = np.lib.stride_tricks.as_strided(y, (n, NFFT), (y.strides[0] * HOP, y.strides[0]))
S = np.abs(np.fft.rfft(frames * win, axis=1))
freqs = np.fft.rfftfreq(NFFT, 1 / SR)
t = (np.arange(n) * HOP + NFFT / 2) / SR
logS = np.log1p(100 * S)
flux = np.maximum(0, np.diff(logS, axis=0)).sum(1); flux = np.r_[0, flux]
flux = (flux - flux.mean()) / (flux.std() + 1e-9)
# tempo via autocorrelation of onset envelope (60-180 bpm)
fps = SR / HOP
ac = np.correlate(flux, flux, "full")[len(flux) - 1:]
lags = np.arange(len(ac)); bpm = 60 * fps / np.maximum(lags, 1)
mask = (bpm > 60) & (bpm < 180)
best_lag = lags[mask][np.argmax(ac[mask] * np.exp(-0.5 * (np.log2(bpm[mask] / 110)) ** 2))]
tempo = 60 * fps / best_lag
period = best_lag
# beat phase: offset maximising onset sum on the grid
phases = [flux[p::period][: int(len(flux) / period) - 1].sum() if p < len(flux) else 0 for p in range(int(period))]
ph = int(np.argmax(phases)); beats = t[ph::int(round(period))] if False else (np.arange(ph, len(flux), period) * HOP + NFFT / 2) / SR
# energy curves
rms = np.sqrt((frames ** 2).mean(1)); rms_db = 20 * np.log10(rms + 1e-6)
low = S[:, freqs < 150].sum(1); low_db = 20 * np.log10(low + 1e-6)
def smooth(x, sec): k = max(1, int(sec * fps)); return np.convolve(x, np.ones(k) / k, "same")
r1, l1 = smooth(rms_db, 1.0), smooth(low_db, 1.0)
# drop score: future 2s mean minus past 2s mean (loudness + bass), only at onsets
k = int(2 * fps)
score = np.zeros(n)
for i in range(k, n - k):
    score[i] = (r1[i:i + k].mean() - r1[i - k:i].mean()) + 0.5 * (l1[i:i + k].mean() - l1[i - k:i].mean())
cands = []
order = np.argsort(-score)
for i in order:
    if score[i] <= 0 or len(cands) >= 5: break
    if all(abs(t[i] - c["t"]) > 3 for c in cands):
        # snap to the strongest onset within +-0.25s
        w = slice(max(0, i - int(0.25 * fps)), min(n, i + int(0.25 * fps)))
        j = w.start + int(np.argmax(flux[w]))
        cands.append({"t": round(float(t[j]), 3), "score": round(float(score[i]), 2)})
strong = [round(float(t[i]), 3) for i in range(1, n - 1) if flux[i] > 2.0 and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1]]
out = {"duration": round(dur, 2), "tempo_bpm": round(float(tempo), 1), "beat_period": round(float(period / fps), 3),
       "beats": [round(float(b), 3) for b in beats], "strong_onsets": strong, "drop_candidates": cands,
       "energy_db_per_0.5s": [round(float(r1[(t >= s) & (t < s + .5)].mean()), 1) for s in np.arange(0, dur - .5, .5)]}
print(json.dumps({k: v for k, v in out.items() if k != "beats"}, indent=1))
print("beats:", " ".join(f"{b:.2f}" for b in out["beats"]))
if a.json: json.dump(out, open(a.json, "w"), indent=1)
if a.plot:
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(3, 1, figsize=(16, 7), sharex=True)
    ax[0].plot(t, r1); ax[0].set_ylabel("loudness dB")
    ax[1].plot(t, l1, color="tab:orange"); ax[1].set_ylabel("bass dB")
    ax[2].plot(t, flux, lw=.6, color="k"); ax[2].set_ylabel("onsets")
    for b in out["beats"]: ax[2].axvline(b, color="tab:blue", alpha=.25)
    for c in cands: [x.axvline(c["t"], color="red", ls="--") for x in ax]
    ax[2].set_xticks(np.arange(0, dur, 1)); ax[2].grid(axis="x", alpha=.3); plt.tight_layout(); plt.savefig(a.plot, dpi=80)
