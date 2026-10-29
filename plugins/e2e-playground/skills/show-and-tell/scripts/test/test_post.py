"""Editing cache tests plus a real ffmpeg CLI round trip (no app or account needed)."""
import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "post.py"
spec = importlib.util.spec_from_file_location("post", SCRIPT)
post = importlib.util.module_from_spec(spec)
spec.loader.exec_module(post)


class FinishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="demo edit ")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.video = self.root / "raw.webm"
        self.video.write_bytes(b"recorded video")
        self.out = self.root / "final clip.mp4"
        self.args = argparse.Namespace(video=str(self.video), out=str(self.out), card=None,
            seed=7, idle_keep=0.6, freeze=2.5, freeze_keep=1.2, no_music=True,
            times=[], width=1280, force=False)

        def render(args):
            Path(args.out).write_bytes(b"rendered:" + self.video.read_bytes())

        def sheet(args):
            Path(args.out).write_bytes(b"contact sheet")

        self.render = self.enterContext(patch.object(post, "one", side_effect=render))
        self.sheet = self.enterContext(patch.object(post, "sheet", side_effect=sheet))
        self.enterContext(patch.object(post, "duration", return_value=5.0))

    def finish(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            post.finish(self.args)
        return json.loads(output.getvalue())

    def job(self):
        return json.loads(self.out.with_suffix(".job.json").read_text(encoding="utf-8"))

    def test_resume_skips_render_and_sheet_but_does_not_invent_review(self):
        self.assertEqual(self.finish()["status"], "needs-review")
        summary = self.finish()
        self.assertTrue(summary["cached"])
        self.assertEqual(summary["status"], "needs-review")
        self.assertEqual(self.render.call_count, 1)
        self.assertEqual(self.sheet.call_count, 1)

    def test_changed_marks_card_or_options_invalidate_render(self):
        self.finish()
        self.video.with_suffix(".marks.json").write_text("[]", encoding="utf-8")
        self.finish()
        card = self.root / "card.webm"
        card.write_bytes(b"title")
        self.args.card = str(card)
        self.finish()
        card.with_suffix(".marks.json").write_text("[]", encoding="utf-8")
        self.finish()
        self.args.idle_keep = 0.8
        self.finish()
        self.assertEqual(self.render.call_count, 5)

    def test_changed_output_is_rendered_again(self):
        self.finish()
        self.out.write_bytes(b"different output")
        self.assertFalse(self.finish()["cached"])
        self.assertEqual(self.render.call_count, 2)

    def test_sheet_settings_and_missing_sheet_do_not_rerender_video(self):
        self.finish()
        self.args.times = [1.0, 2.0]
        self.finish()
        Path(self.job()["edit"]["sheet"]).unlink()
        self.finish()
        self.assertEqual(self.render.call_count, 1)
        self.assertEqual(self.sheet.call_count, 3)

    def test_real_review_is_reused_only_for_the_same_video(self):
        self.finish()
        with contextlib.redirect_stdout(io.StringIO()):
            post.seen(argparse.Namespace(video=str(self.out), save="proof and redaction checked", by="test"))
        self.assertEqual(self.finish()["status"], "reviewed")
        self.assertEqual(self.sheet.call_count, 1)
        self.video.write_bytes(b"new take")
        self.assertEqual(self.finish()["status"], "needs-review")
        self.assertEqual(self.sheet.call_count, 2)

    def test_record_checkpoint_survives_editing(self):
        self.out.with_suffix(".job.json").write_text(json.dumps({"record": {"attempts": 1}}))
        self.finish()
        self.assertEqual(self.job()["record"], {"attempts": 1})

    def test_render_failure_preserves_existing_output_and_checkpoint(self):
        self.finish()
        before = self.out.read_bytes()
        before_job = self.job()
        self.video.write_bytes(b"new take")
        self.render.side_effect = RuntimeError("encoder failed")
        with self.assertRaises(RuntimeError):
            self.finish()
        self.assertEqual(self.out.read_bytes(), before)
        self.assertEqual(self.job(), before_job)

    def test_sheet_failure_resumes_after_successful_render(self):
        self.sheet.side_effect = RuntimeError("image encoder failed")
        with self.assertRaises(RuntimeError):
            self.finish()
        self.sheet.side_effect = lambda args: Path(args.out).write_bytes(b"sheet")
        self.assertTrue(self.finish()["cached"])
        self.assertEqual(self.render.call_count, 1)

    def test_refuses_overwriting_source_and_invalid_sheet_times(self):
        self.args.out = str(self.video)
        with self.assertRaises(ValueError):
            self.finish()
        self.args.out = str(self.out)
        self.args.times = [float("nan")]
        with self.assertRaises(ValueError):
            self.finish()
        self.render.assert_not_called()

    def test_fingerprint_detects_middle_of_large_file_changes(self):
        self.video.write_bytes(b"x" * (4 << 20))
        before = post.fingerprint(self.video)
        with self.video.open("r+b") as handle:
            handle.seek(2 << 20)
            handle.write(b"y")
        self.assertNotEqual(post.fingerprint(self.video), before)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg required")
class FinishCliTests(unittest.TestCase):
    def test_real_render_and_resume_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix="demo CLI ") as folder:
            root = Path(folder)
            video = root / "raw clip.webm"
            out = root / "nested output" / "final clip.mp4"
            subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=2",
                "-c:v", "libvpx-vp9", "-threads", "1", str(video)], check=True)
            command = [sys.executable, str(SCRIPT), "finish", str(video), str(out)]
            first = subprocess.run(command, check=True, capture_output=True, text=True)
            self.assertEqual(json.loads(first.stdout)["status"], "needs-review")
            self.assertGreater(post.duration(str(out)), 1)
            self.assertTrue(out.with_suffix(".sheet.png").is_file())
            modified = out.stat().st_mtime_ns
            again = subprocess.run(command, check=True, capture_output=True, text=True)
            self.assertTrue(json.loads(again.stdout)["cached"])
            self.assertEqual(out.stat().st_mtime_ns, modified)


if __name__ == "__main__":
    unittest.main()
