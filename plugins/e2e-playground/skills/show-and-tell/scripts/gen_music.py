"""Original background music, synthesized from scratch (no samples -> no copyright).

Styles (4th argument; in a case: music: true | "cozy" | "calm"):
  cozy  (default) warm lo-fi: an electric piano on jazzy 9th chords, round bass, soft swung
        drums with brushes, a sparse bell melody, vinyl crackle and a little tape wobble.
  calm  the same warm piano, pad and bass without drums, slower: for serious or quiet demos.
The seed picks the key, chord progression, tempo and melody, so each video can sound different.
Only numpy is needed.

usage: python gen_music.py out.wav seconds [seed] [style]
"""
import sys
import wave

import numpy as np

SR = 44100
SHAPES = {"maj7": [0, 4, 7, 11], "maj9": [0, 4, 7, 11, 14], "69": [0, 4, 9, 14],
          "m7": [0, 3, 7, 10], "m9": [0, 3, 7, 10, 14], "13": [0, 4, 10, 14, 21]}
PROGRESSIONS = [  # one chord per bar: (root above the key, shape)
    [(2, "m9"), (7, "13"), (0, "maj9"), (0, "69")],      # ii  V   I   I
    [(0, "maj9"), (9, "m9"), (2, "m9"), (7, "13")],      # I   vi  ii  V
    [(5, "maj9"), (4, "m7"), (9, "m9"), (0, "maj9")],    # IV  iii vi  I
    [(0, "maj7"), (5, "maj9"), (4, "m7"), (9, "m9")],    # I   IV  iii vi
]
KEYS = [53, 51, 50, 48, 55]  # F, Eb, D, C, G
PENTATONIC = [0, 2, 4, 7, 9]
STYLES = {
    "cozy": {"bpm": (70, 80), "drums": True, "melody": 0.6, "pad": 0.022, "duck": 0.3},
    "calm": {"bpm": (60, 68), "drums": False, "melody": 0.4, "pad": 0.034, "duck": 0.0},
}


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def times(dur):
    return np.arange(int(dur * SR)) / SR


def release(sig, secs=0.08):
    n = min(len(sig), int(secs * SR))
    if n:
        sig[-n:] *= np.linspace(1, 0, n)
    return sig


def epiano(f, dur, vel, detune=0.0):
    """Rhodes-like: a 1:1 FM body whose brightness fades, plus a short bell 'tine'."""
    t = times(dur)
    f *= 1 + detune
    index = 1.3 * np.exp(-t * 5) + 0.22
    body = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
    tine = 0.18 * np.sin(2 * np.pi * f * 7 * t) * np.exp(-t * 28)
    env = (1 - np.exp(-t * 250)) * (0.65 * np.exp(-t * 1.0) + 0.35 * np.exp(-t * 4))
    return release(vel * (body + tine) * env)


def pad(freqs, dur, vel, rng):
    t = times(dur)
    out = np.zeros(len(t))
    for f in freqs:
        for d in (-0.002, 0.0, 0.002):
            ph = rng.uniform(0, 2 * np.pi)
            out += np.sin(2 * np.pi * f * (1 + d) * t + ph) + 0.25 * np.sin(4 * np.pi * f * (1 + d) * t + ph)
    env = np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.0).clip(0)
    return vel * out * env


def bass(f, dur, vel):
    t = times(dur)
    tone = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t * 3) \
        + 0.08 * np.sin(6 * np.pi * f * t) * np.exp(-t * 6)
    return release(vel * tone * (1 - np.exp(-t * 90)) * np.exp(-t * 1.3), 0.06)


def bell(f, dur, vel):
    t = times(dur)
    tone = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) * np.exp(-t * 6) \
        + 0.1 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t * 9)
    return release(vel * tone * (1 - np.exp(-t * 400)) * np.exp(-t * 3.0))


def kick(vel):
    t = times(0.42)
    f = 50 + 70 * np.exp(-t * 28)
    return vel * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)


def snare(rng, vel, brush=False):
    t = times(0.4 if brush else 0.25)
    n = rng.standard_normal(len(t))
    n = np.convolve(np.diff(n, prepend=0), np.ones(3) / 3, mode="same")  # mid band
    noise = n * np.exp(-t * (9 if brush else 20))
    tone = 0.0 if brush else 0.35 * np.sin(2 * np.pi * 185 * t) * np.exp(-t * 28)
    return vel * (0.55 * noise + tone)


def hat(rng, vel, open_=False):
    t = times(0.22 if open_ else 0.05)
    n = np.diff(np.diff(rng.standard_normal(len(t) + 2)))  # high-pass
    return vel * n * np.exp(-t * (16 if open_ else 95))


def place(buf, sig, at):
    i = int(at * SR)
    if i < 0 or i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def fir(x, response, taps=1025, block=1 << 16):
    """Filter with an FIR made from a magnitude response (overlap-add, works on long clips)."""
    freqs = np.fft.rfftfreq(2048, 1 / SR)
    h = np.fft.irfft(response(freqs))
    h = np.roll(h, taps // 2)[:taps] * np.hanning(taps)
    n = len(x)
    size = 1 << int(np.ceil(np.log2(block + taps - 1)))
    H = np.fft.rfft(h, size)
    out = np.zeros(n + taps - 1)
    for s in range(0, n, block):
        seg = x[s:s + block]
        y = np.fft.irfft(np.fft.rfft(seg, size) * H, size)[: len(seg) + taps - 1]
        out[s:s + len(y)] += y
    return out[taps // 2: taps // 2 + n]


def warm(x):
    """Tape-ish warmth: soft high roll-off from ~8.5 kHz, no rumble under 30 Hz."""
    def response(f):
        low_cut = (f / 30) ** 2 / (1 + (f / 30) ** 2)
        return low_cut / np.sqrt(1 + (f / 8500) ** 4)
    return fir(x, response)


def wobble(x, t):
    """Slow tape wow (0.5 Hz) and a touch of flutter: the pitch drifts by ~0.15 %."""
    idx = np.arange(len(x)) + 21 * np.sin(2 * np.pi * 0.5 * t) + 0.7 * np.sin(2 * np.pi * 6 * t)
    return np.interp(idx, np.arange(len(x)), x)


def vinyl(n, rng):
    hiss = np.convolve(rng.standard_normal(n), np.ones(8) / 8, mode="same") * 0.006
    seconds = n / SR
    for _ in range(int(seconds * 7)):
        at = rng.integers(0, n)
        k = np.exp(-np.arange(int(rng.integers(40, 180))) / 25.0) * rng.choice([-1, 1])
        place_i(hiss, k * rng.uniform(0.01, 0.06), at)
    for _ in range(int(seconds * 0.4)):
        at = rng.integers(0, n)
        place_i(hiss, np.exp(-np.arange(300) / 60.0) * rng.uniform(0.06, 0.12), at)
    return hiss


def place_i(buf, sig, i):
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i]


def voicing(root, shape):
    """Rootless voicing kept in the piano's middle register (the bass plays the root)."""
    notes = []
    for s in SHAPES[shape][1:]:
        m = root + s
        while m < 57:
            m += 12
        while m > 76:
            m -= 12
        notes.append(m)
    return sorted(set(notes))


def compose(seconds, seed, style):
    cfg = STYLES[style]
    rng = np.random.default_rng(seed)
    bpm = rng.uniform(*cfg["bpm"])
    beat = 60 / bpm
    bar_len = beat * 4
    key = int(rng.choice(KEYS))
    prog = PROGRESSIONS[int(rng.integers(len(PROGRESSIONS)))]
    swing = 0.08 * beat  # the off-beat eighth comes a little late
    total = seconds + 3
    n = int(total * SR)
    keys_l, keys_r, low, drums_l, drums_r, mel = (np.zeros(n) for _ in range(6))
    kicks = []
    humanize = lambda: rng.normal(0, 0.006)
    bar, t = 0, 0.0
    comp = [[(0, 2.6), (2.5, 1.4)], [(0, 1.6), (1.5, 1.0), (3.0, 1.2)], [(0, 3.8)], [(0, 2.0), (3.5, 0.9)]]
    while t < total:
        root, shape = prog[bar % len(prog)]
        chord = voicing(key + root, shape)
        pattern = comp[int(rng.integers(len(comp)))] if style == "cozy" else [(0, 4.2)]
        for start, length in pattern:
            vel = 0.13 if start == 0 else 0.09
            for k, m in enumerate(chord):  # rolled upwards, like a relaxed hand
                at = t + start * beat + k * (0.018 if style == "cozy" else 0.06) + humanize()
                place(keys_l, epiano(hz(m), length * beat + 0.4, vel, +0.0012), at)
                place(keys_r, epiano(hz(m), length * beat + 0.4, vel, -0.0012), at)
        p = pad([hz(m + 12) for m in chord[:3]], bar_len + 1.0, cfg["pad"], rng)
        place(keys_l, p, t)
        place(keys_r, p, t)
        if bar >= 1:
            b = hz(key + root - 24 + (12 if key + root - 24 < 28 else 0))
            if style == "cozy":
                place(low, bass(b, beat * 1.4, 0.2), t + humanize())
                place(low, bass(b * 1.5, beat * 0.8, 0.13), t + 2.5 * beat + swing + humanize())
                nxt_root = prog[(bar + 1) % len(prog)][0]
                approach = hz(key + nxt_root - 24 - 1 + (12 if key + nxt_root - 24 < 28 else 0))
                if rng.random() < 0.5:
                    place(low, bass(approach, beat * 0.5, 0.1), t + 3.5 * beat + swing)
            else:
                place(low, bass(b, bar_len, 0.24), t)
        thin = bar % 8 in (6, 7)
        if cfg["drums"] and bar >= 2:
            for step in range(8):  # eighths
                at = t + step * beat / 2 + (swing if step % 2 else 0) + humanize()
                v = (0.11 if step % 2 == 0 else 0.07) * rng.uniform(0.8, 1.1)
                h = hat(rng, v, open_=(step == 7 and rng.random() < 0.25))
                place(drums_l, h * 0.6, at)
                place(drums_r, h, at)
            if not thin:
                for pos in [0, 2.5] + ([1.75] if rng.random() < 0.4 else []):
                    at = t + pos * beat + (swing if pos % 1 else 0) + humanize()
                    k = kick(0.34 * rng.uniform(0.9, 1.05))
                    place(drums_l, k, at)
                    place(drums_r, k, at)
                    kicks.append(at)
                for pos in (1, 3):
                    s = snare(rng, 0.26 * rng.uniform(0.85, 1.05), brush=rng.random() < 0.5)
                    place(drums_l, s * 0.9, t + pos * beat + humanize())
                    place(drums_r, s, t + pos * beat + humanize())
        if bar >= 4 and bar % 2 == 0 and rng.random() < cfg["melody"]:
            scale = [key + 24 + i for i in PENTATONIC] + [key + 36 + i for i in PENTATONIC[:3]]
            i = int(rng.integers(2, len(scale) - 2))
            for step in sorted(rng.choice(np.arange(12), size=int(rng.integers(3, 6)), replace=False)):
                i = int(np.clip(i + rng.integers(-2, 3), 0, len(scale) - 1))
                at = t + step * beat / 2 + (swing if step % 2 else 0) + humanize()
                place(mel, bell(hz(scale[i]), beat * 1.5, 0.1), at)
        bar += 1
        t += bar_len
    tt = np.arange(n) / SR
    if cfg["duck"] and kicks:  # the piano and pad breathe with the kick
        gain = np.ones(n)
        curve = 1 - cfg["duck"] * np.exp(-np.arange(int(0.5 * SR)) / (0.16 * SR))
        for at in kicks:
            i = int(at * SR)
            if 0 <= i < n:
                j = min(n, i + len(curve))
                gain[i:j] = np.minimum(gain[i:j], curve[: j - i])
        keys_l *= gain
        keys_r *= gain
    pan = 0.12 * np.sin(2 * np.pi * 0.11 * tt)  # slow drift across the stereo field
    L = keys_l * (1 + pan) + low + drums_l + mel * 1.1
    R = keys_r * (1 - pan) + low + drums_r + mel * 0.8
    L, R = wobble(L, tt), wobble(R, tt)
    noise = vinyl(n, rng)
    L, R = warm(L + noise), warm(R + noise[::-1])
    return L, R


def main():
    out = sys.argv[1]
    seconds = float(sys.argv[2])
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 7
    style = sys.argv[4] if len(sys.argv) > 4 else "cozy"
    if style not in STYLES:
        raise SystemExit(f"unknown style {style!r}; choose {', '.join(STYLES)}")
    L, R = compose(seconds, seed, style)
    n = int(seconds * SR)
    L, R = L[:n], R[:n]
    peak = max(np.abs(L).max(), np.abs(R).max()) or 1
    L, R = np.tanh(1.3 * L / peak) / np.tanh(1.3), np.tanh(1.3 * R / peak) / np.tanh(1.3)  # soft tape saturation
    L, R = L * 0.85, R * 0.85
    fade_in, fade_out = min(n, int(1.5 * SR)), min(n, int(3.0 * SR))
    for ch in (L, R):
        ch[:fade_in] *= np.linspace(0, 1, fade_in)
        ch[n - fade_out:] *= np.linspace(1, 0, fade_out)
    data = (np.stack([L, R], axis=1) * 32767).astype(np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


if __name__ == "__main__":
    main()
