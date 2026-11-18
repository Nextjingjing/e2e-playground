"""The finished video's sound: the music bed plus a soft click at every real mouse click.

Clicks are synthesized (no samples): a short bright tick with a little body, like a trackpad,
the press and then a quieter release. Their times come from demo-kit's "click" marks, mapped
by post.py onto the edited timeline.

usage: python sfx.py out.wav seconds [--music music.wav] [--music-gain 0.55] [--clicks t1 t2 ...]
"""
import argparse
import wave

import numpy as np

SR = 44100
RELEASE_AFTER = 0.09  # demo-kit holds the button this long


def click(vel, rng, pitch=1.0):
    t = np.arange(int(0.045 * SR)) / SR
    tick = np.sin(2 * np.pi * 3300 * pitch * t) * np.exp(-t * 900)
    body = 0.55 * np.sin(2 * np.pi * 1400 * pitch * t) * np.exp(-t * 340)
    thump = 0.45 * np.sin(2 * np.pi * 170 * t) * np.exp(-t * 110)
    grit = 0.22 * rng.standard_normal(len(t)) * np.exp(-t * 1300)
    return vel * (tick + body + thump + grit)


def click_track(times, n, rng):
    track = np.zeros(n)
    for at in times:
        for when, vel, pitch in ((at, 0.34, 1.0), (at + RELEASE_AFTER, 0.18, 1.12)):
            i = int(when * SR)
            if 0 <= i < n:
                s = click(vel, rng, pitch)
                j = min(n, i + len(s))
                track[i:j] += s[: j - i]
    return track


def read_wav(path, n):
    with wave.open(path) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, w.getnchannels()) / 32768
    if data.shape[1] == 1:
        data = np.repeat(data, 2, axis=1)
    out = np.zeros((n, 2))
    out[: min(n, len(data))] = data[:n]
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("out")
    p.add_argument("seconds", type=float)
    p.add_argument("--music")
    p.add_argument("--music-gain", type=float, default=0.55)
    p.add_argument("--clicks", nargs="*", type=float, default=[])
    a = p.parse_args()
    n = int(a.seconds * SR)
    mix = read_wav(a.music, n) * a.music_gain if a.music else np.zeros((n, 2))
    clicks = click_track(a.clicks, n, np.random.default_rng(5))
    mix[:, 0] += clicks * 0.95  # nearly centred, as the pointer is in front of the viewer
    mix[:, 1] += clicks
    peak = np.abs(mix).max()
    if peak > 0.98:  # never clip: a click on a loud beat is softened with the bed
        mix *= 0.98 / peak
    with wave.open(a.out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())


if __name__ == "__main__":
    main()
