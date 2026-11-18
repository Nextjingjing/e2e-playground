"""Click sounds: synthesized at the click marks, moved onto the edited timeline, kept by concat."""
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("post", HERE / "post.py")
post = importlib.util.module_from_spec(spec)
spec.loader.exec_module(post)


def onsets(path, threshold=0.05):
    """Seconds where the sound jumps from quiet to a transient (one per click press)."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", "8000",
                          "-f", "s16le", "-"], check=True, capture_output=True).stdout
    x = np.abs(np.frombuffer(out, np.int16) / 32768)
    hits, last = [], -1.0
    for i in np.flatnonzero(x > threshold):
        t = i / 8000
        if t - last > 0.3:
            hits.append(round(t, 2))
        last = t
    return hits


class TimelineTests(unittest.TestCase):
    def test_raw_time_maps_through_squeezed_spans_and_the_card(self):
        segs = [(1.0, 5.0, 1.0), (5.0, 9.0, 4.0), (9.0, 12.0, 1.0)]  # 4 s idle squeezed to 1 s
        self.assertAlmostEqual(post.edited_time(2.0, segs), 1.0)
        self.assertAlmostEqual(post.edited_time(7.0, segs), 4.5)
        self.assertAlmostEqual(post.edited_time(10.0, segs, offset=3.3), 3.3 + 4 + 1 + 1)
        self.assertIsNone(post.edited_time(0.5, segs), "before the start mark: trimmed away")
        self.assertIsNone(post.edited_time(12.5, segs))


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg required")
class ClickSoundTests(unittest.TestCase):
    def clip(self, root, name, colour, seconds, marks):
        path = root / f"{name}.webm"
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
                        "-i", f"color=c={colour}:size=320x240:rate=30:duration={seconds}",
                        "-c:v", "libvpx-vp9", "-threads", "1", str(path)], check=True)
        path.with_suffix(".marks.json").write_text(json.dumps(marks), encoding="utf-8")
        return path

    def test_clicks_land_after_the_card_and_survive_concat(self):
        with tempfile.TemporaryDirectory(prefix="demo clicks ") as folder:
            root = Path(folder)
            card = self.clip(root, "card", "black", 2, [{"t": 0, "kind": "start"}, {"t": 1.8, "kind": "end"}])
            case = self.clip(root, "case", "white", 4, [{"t": 0.5, "kind": "start"}, {"t": 1.5, "kind": "click"},
                                                         {"t": 3.0, "kind": "click"}])
            out = root / "one.mp4"
            subprocess.run([sys.executable, str(HERE / "post.py"), "one", str(case), str(out), "--card", str(card),
                            "--no-music"], check=True, capture_output=True)
            # card 1.8 s, dissolve 0.7 s, case starts 0.1 s before its start mark
            expected = [1.8 - post.CARD_XFADE + 1.5 - 0.4, 1.8 - post.CARD_XFADE + 3.0 - 0.4]
            hits = onsets(out)
            self.assertEqual(len(hits), 2, hits)
            for got, want in zip(hits, expected):
                self.assertAlmostEqual(got, want, delta=0.06)
            self.assertEqual(json.loads((root / "one.clicks.json").read_text()), [round(t, 3) for t in expected])

            quiet = root / "quiet.mp4"
            subprocess.run([sys.executable, str(HERE / "post.py"), "one", str(case), str(quiet), "--no-music",
                            "--no-clicks"], check=True, capture_output=True)
            streams = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0",
                                      str(quiet)], check=True, capture_output=True, text=True).stdout.split()
            self.assertEqual(streams, ["video"], "no music and no clicks: a silent file")

            both = root / "both.mp4"
            subprocess.run([sys.executable, str(HERE / "post.py"), "concat", str(both), str(out), str(out), "--no-music"],
                           check=True, capture_output=True)
            length = post.duration(str(out))
            hits = onsets(both)
            self.assertEqual(len(hits), 4, hits)
            self.assertAlmostEqual(hits[2], length + expected[0], delta=0.08)

    def test_a_click_on_loud_music_never_clips(self):
        with tempfile.TemporaryDirectory(prefix="demo clicks ") as folder:
            root = Path(folder)
            loud = root / "loud.wav"
            with wave.open(str(loud), "wb") as w:
                w.setnchannels(2), w.setsampwidth(2), w.setframerate(44100)
                w.writeframes((np.full((44100 * 2, 2), 0.95) * 32767).astype(np.int16).tobytes())
            out = root / "mix.wav"
            subprocess.run([sys.executable, str(HERE / "sfx.py"), str(out), "2", "--music", str(loud), "--music-gain", "1",
                            "--clicks", "0.5"], check=True)
            with wave.open(str(out)) as w:
                x = np.frombuffer(w.readframes(w.getnframes()), np.int16)
            self.assertLess(np.abs(x).max(), 32767 * 0.99)


if __name__ == "__main__":
    unittest.main()
