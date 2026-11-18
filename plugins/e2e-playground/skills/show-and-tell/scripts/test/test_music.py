"""gen_music.py: the styles exist, the seed decides the piece, and the output is clean."""
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

SCRIPT = Path(__file__).resolve().parents[1] / "gen_music.py"


def make(folder, name, seconds, seed, style=None):
    out = Path(folder) / f"{name}.wav"
    args = [sys.executable, str(SCRIPT), str(out), str(seconds), str(seed)] + ([style] if style else [])
    subprocess.run(args, check=True, capture_output=True)
    with wave.open(str(out)) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, 2) / 32768
        return data, w.getframerate()


class MusicTests(unittest.TestCase):
    def test_styles_seeds_and_levels(self):
        with tempfile.TemporaryDirectory(prefix="demo music ") as folder:
            cozy, rate = make(folder, "cozy", 8, 1)
            again, _ = make(folder, "again", 8, 1, "cozy")
            other, _ = make(folder, "other", 8, 2, "cozy")
            calm, _ = make(folder, "calm", 8, 1, "calm")
            self.assertEqual(rate, 44100)
            self.assertEqual(len(cozy), 8 * 44100)
            self.assertTrue(np.array_equal(cozy, again), "cozy is the default and the seed fixes the piece")
            self.assertFalse(np.array_equal(cozy, other), "another seed, another piece")
            self.assertFalse(np.array_equal(cozy[:len(calm)], calm), "calm is a different style")
            for x in (cozy, calm):
                self.assertLess(np.abs(x).max(), 0.9, "headroom, no clipping")
                self.assertGreater(np.sqrt((x[44100:-3 * 44100] ** 2).mean()), 0.05, "audible, not silence")

    def test_unknown_style_is_refused(self):
        with tempfile.TemporaryDirectory(prefix="demo music ") as folder:
            result = subprocess.run([sys.executable, str(SCRIPT), str(Path(folder) / "x.wav"), "4", "1", "jazz"],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unknown style", result.stderr)


if __name__ == "__main__":
    unittest.main()
