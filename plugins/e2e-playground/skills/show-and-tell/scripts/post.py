"""Finish demo-kit recordings: cut dead time, put the title card first, add music.

usage:
  python post.py finish <case.webm> <out.mp4> [--card card.webm] [--music] [--seed N]
                     [--times t1 t2 ...] [--width 1280] [--force]
                     # edit + one review sheet + resumable OUT.job.json; silent by default
  python post.py one <case.webm> <out.mp4> [--card card.webm] [--seed N]
                     [--idle-keep 0.6] [--freeze 2.5] [--freeze-keep 1.2] [--no-music]
  python post.py card <card.webm> <out.mp4> [--seed N]            # a title card on its own
  python post.py concat <out.mp4> <a.mp4> <b.mp4> ... [--seed N]
  python post.py sheet <video> <out.png> [t1 t2 ...] [--width 1280]  # frames tiled in ONE image
                                                                     # (no times = 6 evenly spread)
  python post.py seen <video> [--save "what each moment shows, verdict" --by who]  # review cache
  python post.py cover <in.mp4> <out.mp4> --box x,y,w,h[@t0-t1] ...  # solid bars on a finished video
Prints one summary line per step; set POST_VERBOSE=1 to also print every ffmpeg command.

Dead time, two sources:
  * "idle" marks written by demo.waitApp() (spinners, page loads, polling) -> each squeezed
    to --idle-keep seconds (sped up, not cut, so the viewer still sees it happen);
  * stretches where the picture does not change for --freeze seconds (ffmpeg freezedetect)
    -> squeezed to --freeze-keep seconds. Highlights pulse, so they are never "frozen".
Needs ffmpeg/ffprobe on PATH and numpy (for the music).
"""
import argparse
import contextlib
import hashlib
import io
import json
import math
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30


VERBOSE = os.environ.get("POST_VERBOSE") == "1"


def run(cmd, **kw):
    # quiet by default: whoever reads this output (often an agent) pays for every line
    if VERBOSE:
        print(" ".join(str(c) for c in cmd)[:400])
    return subprocess.run(cmd, check=True, **kw)


def cover(a):
    """Solid bars over fixed areas of an already-recorded video (e.g. a header with the user's
    name that was filmed before redaction existed). --box x,y,w,h[@t0-t1], pixels of the video."""
    parts = []
    for b in a.box:
        rect, _, when = b.partition("@")
        x, y, w, h = (int(v) for v in rect.split(","))
        enable = ""
        if when:
            t0, _, t1 = when.partition("-")
            enable = f":enable='between(t,{float(t0)},{float(t1) if t1 else 1e9})'"
        parts.append(f"drawbox=x={x}:y={y}:w={w}:h={h}:color=0x4b5563@1:t=fill{enable}")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", a.video, "-vf", ",".join(parts),
         "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", a.out])
    print(f"wrote {a.out}: {len(parts)} bar(s)")


def fingerprint(path):
    """Hash the entire file, including middle frames, for render and review invalidation."""
    h = hashlib.sha256()
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return f"{size}-{h.hexdigest()}"


def read_review(video):
    try:
        with open(os.path.splitext(video)[0] + ".review.json", encoding="utf-8") as f:
            review = json.load(f)
        if review.get("fingerprint") == fingerprint(video) and review.get("review"):
            return review
    except (OSError, ValueError, AttributeError):
        pass
    return None


def save_job(path, data):
    """Replace the checkpoint atomically; interrupted writes cannot erase a previous phase."""
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=os.path.dirname(path),
                                         suffix=".json", delete=False) as f:
            tmp = f.name
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        if tmp and os.path.exists(tmp):
            os.remove(tmp)


def finish(a):
    """Run deterministic editing work once; a successful render is never a visual review."""
    a.video, a.out = os.path.abspath(a.video), os.path.abspath(a.out)
    if a.card:
        a.card = os.path.abspath(a.card)
    stem = os.path.splitext(a.out)[0]
    job_path, sheet_path = stem + ".job.json", stem + ".sheet.png"
    sources = [a.video] + ([a.card] if a.card else [])
    sources += [os.path.splitext(p)[0] + ".marks.json" for p in sources]
    outputs = [a.out, job_path, sheet_path, stem + ".review.json"]
    if any(os.path.normcase(os.path.realpath(src)) == os.path.normcase(os.path.realpath(out))
           for src in sources for out in outputs):
        raise ValueError("output paths must differ from recording inputs")
    if not a.out.lower().endswith(".mp4"):
        raise ValueError("output must end in .mp4")
    if a.width < 64 or a.width % 2:
        raise ValueError("sheet width must be an even number of at least 64")
    if any(not math.isfinite(t) or t < 0 for t in a.times):
        raise ValueError("sheet times must be finite and nonnegative")
    if any(not math.isfinite(v) or v <= 0 for v in (a.idle_keep, a.freeze, a.freeze_keep)):
        raise ValueError("editing durations must be finite and positive")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    job = {}
    if os.path.exists(job_path):
        with open(job_path, encoding="utf-8") as f:
            job = json.load(f)
        if not isinstance(job, dict):
            raise ValueError("job checkpoint must be an object")
    engine = [__file__] + ([os.path.join(HERE, "gen_music.py")] if not a.no_music else [])
    key = {"sources": {p: fingerprint(p) if os.path.exists(p) else None for p in sources},
           "engine": [fingerprint(p) for p in engine],
           "options": [a.seed, a.idle_keep, a.freeze, a.freeze_keep, a.no_music]}
    previous = job.get("edit", {})
    cached = (not a.force and key == previous.get("key") and os.path.isfile(a.out)
              and fingerprint(a.out) == previous.get("outputFingerprint"))
    if not cached:
        # Render beside the destination, then replace it only after encoding succeeds.
        with tempfile.TemporaryDirectory(prefix=".edit-", dir=os.path.dirname(a.out)) as tmp:
            edit_args = argparse.Namespace(**vars(a))
            edit_args.out = os.path.join(tmp, "render.mp4")
            with contextlib.redirect_stdout(io.StringIO()):
                one(edit_args)
            os.replace(edit_args.out, a.out)
    output_fp = fingerprint(a.out)
    seconds = duration(a.out)
    # Commit the completed render before sheet extraction, which may fail independently.
    job["edit"] = {"key": key, "outputFingerprint": output_fp, "video": a.out,
                   "seconds": seconds, "sheet": sheet_path,
                   "sheetKey": previous.get("sheetKey"), "sheetFingerprint": previous.get("sheetFingerprint")}
    job.update({"schema": 1, "status": "needs-review"})
    save_job(job_path, job)
    if any(t >= seconds for t in a.times):
        raise ValueError("sheet times must be earlier than the end of the edited video")
    review = read_review(a.out)
    sheet_key = [output_fp, a.times, a.width]
    sheet_cached = (sheet_key == previous.get("sheetKey") and os.path.isfile(sheet_path)
                    and fingerprint(sheet_path) == previous.get("sheetFingerprint"))
    if not review and (a.force or not sheet_cached):
        with contextlib.redirect_stdout(io.StringIO()):
            sheet(argparse.Namespace(video=a.out, out=sheet_path, times=a.times, width=a.width))
    job.update({"schema": 1, "status": "reviewed" if review else "needs-review"})
    job["edit"] = {"key": key, "outputFingerprint": output_fp, "video": a.out,
                   "seconds": seconds, "sheet": sheet_path, "sheetKey": sheet_key,
                   "sheetFingerprint": fingerprint(sheet_path) if os.path.isfile(sheet_path) else None}
    save_job(job_path, job)
    print(json.dumps({"video": a.out, "seconds": round(seconds, 2), "cached": cached,
                      "sheet": sheet_path if os.path.isfile(sheet_path) else None,
                      "status": job["status"], "job": job_path}, ensure_ascii=False))


def seen(a):
    """Review cache: what a person/agent already saw in this exact file, so nobody re-reads frames.

    save:  post.py seen out.mp4 --save "0:03 card ok | 0:41 Sorting confirm ok | 1:20 ไม้ผี row ok" --by "<who>"
    check: post.py seen out.mp4   -> prints the saved review and exits 0 if the file is unchanged,
                                     prints STALE/NONE and exits 1 if it must be looked at again.
    """
    store = os.path.splitext(a.video)[0] + ".review.json"
    fp = fingerprint(a.video)
    if a.save:
        import datetime
        data = {"fingerprint": fp, "review": a.save, "by": a.by or "",
                "at": datetime.datetime.now().isoformat(timespec="seconds")}
        with open(store, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"saved review -> {store}")
        return
    if not os.path.exists(store):
        print("NONE: no review yet - make a sheet and look")
        sys.exit(1)
    with open(store, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("fingerprint") != fp:
        print(f"STALE: video changed since the review of {data.get('at')} - look again")
        sys.exit(1)
    print(f"SEEN {data.get('at')} by {data.get('by')}: {data.get('review')}")


def sheet(a):
    """Several frames tiled into one picture: one image to look at instead of one per moment."""
    # times are in THIS file's timeline; with none given, spread 6 frames over the video
    times = [float(t) for t in a.times] or [duration(a.video) * k / 7 for k in range(1, 7)]
    cols = 1 if len(times) == 1 else 2 if len(times) <= 4 else 3
    rows = -(-len(times) // cols)
    cell = a.width // cols
    # drawtext needs an explicit font file on Windows (no fontconfig); skip the label if none
    font = next((p for p in ("C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                             "/System/Library/Fonts/Supplemental/Arial.ttf") if os.path.exists(p)), None)
    tmp = []
    for i, t in enumerate(times):
        f = f"{a.out}.{i}.png"
        vf = f"scale={cell}:-2"
        if font:
            vf += (f",drawtext=fontfile='{font.replace(':', chr(92) + ':')}':text='{t:.1f}s':x=8:y=8:"
                   "fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6")
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", a.video,
             "-frames:v", "1", "-vf", vf, f])
        tmp.append(f)
    if len(tmp) == 1:
        os.replace(tmp[0], a.out)
    else:
        def pos(i):
            x = "+".join(["w0"] * (i % cols)) or "0"
            y = "+".join(["h0"] * (i // cols)) or "0"
            return f"{x}_{y}"
        inputs = sum((["-i", f] for f in tmp), [])
        graph = ("".join(f"[{i}:v]" for i in range(len(tmp)))
                 + f"xstack=inputs={len(tmp)}:layout={'|'.join(pos(i) for i in range(len(tmp)))}:fill=black")
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", graph, a.out])
        for f in tmp:
            os.remove(f)
    print(f"wrote {a.out}: {len(times)} frames at {', '.join(f'{t:.1f}s' for t in times)} ({cols}x{rows})")


def duration(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                   "-of", "default=nw=1:nk=1", path])
    return float(out.strip())


def load_marks(video):
    path = os.path.splitext(video)[0] + ".marks.json"  # x.webm / x.mp4 / x.mkv -> x.marks.json
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def start_of(marks):
    starts = [m["t"] for m in marks if m.get("kind") == "start"]
    return max(0.0, starts[0] - 0.1) if starts else 0.0


def freezes(video, start, min_secs):
    """Still stretches (seconds from the start of the file)."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-ss", f"{start:.2f}", "-i", video, "-vf",
         f"freezedetect=n=0.002:d={min_secs}", "-map", "0:v", "-f", "null", "-"],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    spans, cur = [], None
    for line in proc.stderr.splitlines():
        m = re.search(r"freeze_start: ([\d.]+)", line)
        if m:
            cur = float(m.group(1)) + start
        m = re.search(r"freeze_end: ([\d.]+)", line)
        if m and cur is not None:
            spans.append((cur, float(m.group(1)) + start))
            cur = None
    return spans


CAPTION_READ = 2.5  # seconds a new caption stays at normal speed so it can be read


def protected_spans(marks):
    """Cards, highlights and fresh captions: still on purpose, never squeezed."""
    spans = []
    for m in marks:
        if m.get("kind") in ("card", "highlight") and "end" in m:
            spans.append((m["t"], m["end"]))
        elif m.get("kind") == "caption":
            spans.append((m["t"], m["t"] + CAPTION_READ))
    return spans


def subtract(spans, holes):
    """spans minus holes, both [(a, b)]."""
    out = []
    for a, b in spans:
        pieces = [(a, b)]
        for ha, hb in holes:
            nxt = []
            for pa, pb in pieces:
                if hb <= pa or ha >= pb:
                    nxt.append((pa, pb))
                    continue
                if ha > pa:
                    nxt.append((pa, ha))
                if hb < pb:
                    nxt.append((hb, pb))
            pieces = nxt
        out += pieces
    return out


def plan(total, start, idle, frozen, idle_keep, freeze_keep):
    """[(a, b, speed)] covering [start, total]."""
    squeeze = [(a, b, idle_keep) for a, b in idle if b - a > idle_keep + 0.2]
    squeeze += [(a, b, freeze_keep) for a, b in frozen if b - a > freeze_keep + 0.2]
    squeeze = sorted((max(a, start), min(b, total), k) for a, b, k in squeeze if b > start)
    merged = []
    for a, b, k in squeeze:
        if merged and a <= merged[-1][1]:
            pa, pb, pk = merged[-1]
            merged[-1] = (pa, max(pb, b), min(pk, k))
        else:
            merged.append((a, b, k))
    segs, t = [], start
    for a, b, keep in merged:
        if a > t:
            segs.append((t, a, 1.0))
        segs.append((a, b, max(1.0, (b - a) / keep)))
        t = b
    if total > t:
        segs.append((t, total, 1.0))
    return [s for s in segs if s[1] - s[0] > 0.05]


def render(inputs, out):
    """inputs: [(file, [(a, b, speed), ...])] -> one silent h264 file, segments in order."""
    args, parts, n = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"], [], 0
    for i, (path, _) in enumerate(inputs):
        args += ["-i", path]
    for i, (_, segs) in enumerate(inputs):
        for a, b, speed in segs:
            parts.append(f"[{i}:v]trim=start={a:.3f}:end={b:.3f},setpts=(PTS-STARTPTS)/{speed:.4f},"
                         f"fps={FPS},format=yuv420p[v{n}]")
            n += 1
    graph = ";".join(parts) + ";" + "".join(f"[v{k}]" for k in range(n)) + f"concat=n={n}:v=1:a=0[out]"
    script = out + ".filter.txt"
    with open(script, "w", encoding="utf-8") as f:
        f.write(graph)
    run(args + ["-filter_complex_script", script, "-map", "[out]", "-c:v", "libx264",
                "-preset", "medium", "-crf", "20", out])
    os.remove(script)


def add_music(video, out, seed, music=True):
    if not music:
        os.replace(video, out)
        return
    wav = out + ".music.wav"
    run([sys.executable, os.path.join(HERE, "gen_music.py"), wav, f"{duration(video):.2f}", str(seed)])
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", video, "-i", wav,
         "-filter:a", "volume=0.55", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
         "-shortest", "-movflags", "+faststart", out])
    os.remove(wav)
    os.remove(video)


def one(a):
    inputs = []
    if a.card:
        cm = load_marks(a.card)
        inputs.append((a.card, [(start_of(cm), duration(a.card), 1.0)]))
    marks = load_marks(a.video)
    total = duration(a.video)
    start = start_of(marks)
    idle = [(m["t"], m["end"]) for m in marks if m.get("kind") == "idle"]
    frozen = subtract(freezes(a.video, start, a.freeze), protected_spans(marks))
    segs = plan(total, start, idle, frozen, a.idle_keep, a.freeze_keep)
    kept = sum((b - x) / s for x, b, s in segs)
    print(f"case: {total - start:.1f}s recorded -> {kept:.1f}s after squeezing "
          f"{len(idle)} idle + {len(frozen)} still spans")
    inputs.append((a.video, segs))
    silent = a.out + ".silent.mp4"
    render(inputs, silent)
    add_music(silent, a.out, a.seed, not a.no_music)
    print(f"wrote {a.out} ({duration(a.out):.1f}s)")


def card(a):
    """A title card on its own (intro/outro of the combined video)."""
    silent = a.out + ".silent.mp4"
    render([(a.card, [(start_of(load_marks(a.card)), duration(a.card), 1.0)])], silent)
    add_music(silent, a.out, a.seed, not a.no_music)
    print(f"wrote {a.out} ({duration(a.out):.1f}s)")


def concat(a):
    inputs = [(c, [(0.0, duration(c), 1.0)]) for c in a.clips]
    silent = a.out + ".silent.mp4"
    render(inputs, silent)
    add_music(silent, a.out, a.seed, not a.no_music)
    print(f"wrote {a.out} ({duration(a.out):.1f}s)")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="mode", required=True)
    f = sub.add_parser("finish", help="edit, cache and prepare one visual review")
    f.add_argument("video")
    f.add_argument("out")
    f.add_argument("--card")
    f.add_argument("--seed", type=int, default=7)
    f.add_argument("--idle-keep", type=float, default=0.6)
    f.add_argument("--freeze", type=float, default=2.5)
    f.add_argument("--freeze-keep", type=float, default=1.2)
    f.add_argument("--music", dest="no_music", action="store_false", default=True)
    f.add_argument("--times", nargs="*", type=float, default=[])
    f.add_argument("--width", type=int, default=1280)
    f.add_argument("--force", action="store_true")
    o = sub.add_parser("one")
    o.add_argument("video")
    o.add_argument("out")
    o.add_argument("--card")
    o.add_argument("--seed", type=int, default=7)
    o.add_argument("--idle-keep", type=float, default=0.6)
    o.add_argument("--freeze", type=float, default=2.5)
    o.add_argument("--freeze-keep", type=float, default=1.2)
    o.add_argument("--no-music", action="store_true")
    k = sub.add_parser("card")
    k.add_argument("card")
    k.add_argument("out")
    k.add_argument("--seed", type=int, default=3)
    k.add_argument("--no-music", action="store_true")
    c = sub.add_parser("concat")
    c.add_argument("out")
    c.add_argument("clips", nargs="+")
    c.add_argument("--seed", type=int, default=11)
    c.add_argument("--no-music", action="store_true")
    s = sub.add_parser("sheet")
    s.add_argument("video")
    s.add_argument("out")
    s.add_argument("times", nargs="*")
    s.add_argument("--width", type=int, default=1280)
    v = sub.add_parser("cover")
    v.add_argument("video")
    v.add_argument("out")
    v.add_argument("--box", action="append", required=True)
    r = sub.add_parser("seen")
    r.add_argument("video")
    r.add_argument("--save")
    r.add_argument("--by")
    a = p.parse_args()
    {"finish": finish, "one": one, "card": card, "concat": concat,
     "sheet": sheet, "seen": seen, "cover": cover}[a.mode](a)


if __name__ == "__main__":
    main()
