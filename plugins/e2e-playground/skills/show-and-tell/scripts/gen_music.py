"""Original lo-fi background loop, synthesized from scratch (no samples -> no copyright).

usage: python gen_music.py out.wav seconds [seed]
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 84
BEAT = 60 / BPM
BAR = BEAT * 4

# I - vi - IV - V in C (maj7 / m7 colours), MIDI notes
CHORDS = [
    [48, 55, 59, 64, 67],   # Cmaj7
    [45, 52, 57, 60, 64],   # Am7
    [41, 48, 53, 57, 64],   # Fmaj7
    [43, 50, 55, 59, 62],   # G6-ish
]
MELODY = [76, 74, 72, 71, 72, 74, 67, 69, 72, 71, 69, 67, 64, 67, 69, 71]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def epiano(freq, dur, vel=0.2):
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 2.2) * (1 - np.exp(-t * 200))
    tone = (np.sin(2 * np.pi * freq * t)
            + 0.35 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 4)
            + 0.12 * np.sin(2 * np.pi * 3 * freq * t) * np.exp(-t * 7))
    trem = 1 + 0.08 * np.sin(2 * np.pi * 4.5 * t)
    return vel * tone * env * trem


def bass(freq, dur, vel=0.28):
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 1.6) * (1 - np.exp(-t * 120))
    return vel * (np.sin(2 * np.pi * freq * t) + 0.2 * np.sin(2 * np.pi * 2 * freq * t)) * env


def kick(vel=0.45):
    t = np.arange(int(0.35 * SR)) / SR
    f = 110 * np.exp(-t * 18) + 42
    return vel * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def hat(rng, vel=0.05):
    t = np.arange(int(0.06 * SR)) / SR
    n = rng.standard_normal(len(t))
    n = np.diff(n, prepend=0)  # crude high-pass
    return vel * n * np.exp(-t * 70)


def place(buf, sig, at):
    i = int(at * SR)
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i]


def main():
    out = sys.argv[1]
    seconds = float(sys.argv[2])
    rng = np.random.default_rng(int(sys.argv[3]) if len(sys.argv) > 3 else 7)
    total = seconds + 2
    L = np.zeros(int(total * SR))
    R = np.zeros(int(total * SR))
    bar = 0
    t = 0.0
    while t < total:
        chord = CHORDS[bar % 4]
        for k, n in enumerate(chord[1:]):
            s = epiano(hz(n), BAR * 1.1, 0.075)
            place(L, s * (0.6 + 0.1 * k), t + 0.012 * k)
            place(R, s * (0.9 - 0.1 * k), t + 0.012 * k)
        place(L, bass(hz(chord[0] - 12), BEAT * 2.2), t)
        place(R, bass(hz(chord[0] - 12), BEAT * 2.2), t)
        place(L, bass(hz(chord[0] - 12 + 7), BEAT * 1.6, 0.18), t + BEAT * 2.5)
        place(R, bass(hz(chord[0] - 12 + 7), BEAT * 1.6, 0.18), t + BEAT * 2.5)
        for b in range(4):
            if b in (0, 2) and bar >= 1:
                k = kick()
                place(L, k, t + b * BEAT)
                place(R, k, t + b * BEAT)
            for half in (0, 0.5):
                swing = 0.06 if half else 0
                h = hat(rng, 0.035 if half else 0.05)
                place(L, h * 0.7, t + (b + half + swing) * BEAT)
                place(R, h, t + (b + half + swing) * BEAT)
        if bar >= 2 and bar % 8 not in (6, 7):
            for i in range(4):
                if rng.random() < 0.75:
                    m = MELODY[(bar * 4 + i) % len(MELODY)]
                    s = epiano(hz(m), BEAT * 1.5, 0.06)
                    place(L, s * 0.8, t + i * BEAT + 0.02)
                    place(R, s, t + i * BEAT)
        bar += 1
        t += BAR
    # vinyl-ish noise bed + gentle low-pass via moving average
    noise = rng.standard_normal(len(L)) * 0.004
    L += noise
    R += noise[::-1]
    k = np.ones(4) / 4
    L = np.convolve(L, k, mode="same")
    R = np.convolve(R, k, mode="same")
    n = int(seconds * SR)
    L, R = L[:n], R[:n]
    peak = max(np.abs(L).max(), np.abs(R).max()) or 1
    L, R = L / peak * 0.8, R / peak * 0.8
    fade = int(2.5 * SR)
    ramp = np.linspace(1, 0, fade)
    L[-fade:] *= ramp
    R[-fade:] *= ramp
    inn = int(1.0 * SR)
    L[:inn] *= np.linspace(0, 1, inn)
    R[:inn] *= np.linspace(0, 1, inn)
    data = (np.stack([L, R], axis=1) * 32767).astype(np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


if __name__ == "__main__":
    main()
