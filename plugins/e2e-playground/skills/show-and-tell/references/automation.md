# Reusable recording and editing

## Record a routine web case

Copy `assets/case-template.cjs` next to the app and fill only the facts/actions. Paths in
the case are relative to the case file, so the command works from any directory:

```sh
node <skill>/scripts/run-case.cjs <work>/case.cjs
```

The runner uses the existing kit for title, cursor, real input, captions, redaction and
wait marks. It then runs cached editing and sheet extraction. Default is silent; add
`music: true` to request the synthesized bed. `DEMO_PYTHON` selects a Python executable.

Case fields:

| field | purpose |
|---|---|
| `projectDir`, `baseURL`, `startUrl` | app dependency folder, URL without credentials, first screen |
| `output` | final `.mp4`; all other generated paths derive from it |
| `title` | `{tag, title, lines}` for the fixed title-card template |
| `run({page, demo})` | recorded actions; use kit mouse/keyboard, no app API calls |
| `setup({log})` | optional off-camera setup of fresh test data, including retakes; `log("queue PM9 ready")` adds a progress line |
| `login(page)` | optional off-camera login; read credentials from environment |
| `verify()` | optional read-only outcome check; returns exactly `true` to proceed |
| `redact` | extra sensitive text/selectors; stays enabled |
| `music`, `seed`, `reviewTimes` | optional music and sheet timestamps in the edited timeline |
| `view`, `font` | optional existing kit settings; normally keep defaults |

Do not put secrets or personal identifiers in the case file, title or notes. Load extra
redaction text and credentials from env. The runner persists selected phase metadata,
never the config object, login storage or app error text.
The kit keeps new login state in memory; it no longer writes `_auth-state.json` beside
recordings. Custom callers can still read an explicitly supplied existing state path.

## Storyboard before recording

```sh
node <skill>/scripts/run-case.cjs <work>/case.cjs --storyboard   # same as: node <skill>/scripts/storyboard.cjs <work>/case.cjs
```

This runs the case's own `run()` with a fake `page` and a fake `demo`. It never runs
`setup()`, `login()` or `verify()`, opens no browser and uses no data. It prints a Markdown
table: each caption starts a scene; clicks, scans, highlights, cards and waits are listed
under it with estimated seconds (kit pacing; `waitApp` = 0.6 s as after editing; pauses
≤ 2.5 s). It saves `<stem>.storyboard.md` and `<stem>.storyboard.json`; the runner then
numbers progress lines `STEP n/N` if the case file is unchanged.

Limits:
- Values read from the page (`innerText()`, `count()`) show as `‹live: …›`.
- Branches on live state take the "nothing found" path: `count()` is 0, `isVisible()`,
  `isChecked()`, `isEnabled()` and similar are `false`, and `isHidden()` is `true`. The
  storyboard says how many such checks it answered.
- A loop that waits on page state stops after 5000 page calls or 20 s, whichever comes
  first, and is marked "incomplete". `--storyboard` then exits 3.
- Non-page code inside `run()`, such as DB queries or file writes, still runs, so keep side
  effects out of `run()`.
- The length is an estimate; trust it to ±30 %.

## Progress, watching and failures

Every run rewrites `<stem>.progress.log` with timestamped lines: `RUN pid=… at=…`, `TAKE`,
`SETUP …`, `REC`, `STEP <caption>` for each caption, `VERIFY`, `EDIT`, `SHOT <fail.png>`, and finally
`DONE …` or `FAIL <phase>: <reason>`. While editing, `EDIT still encoding (Ns)` is added every
60 s, for up to 20 min. The reason is the error's first two lines, without colour codes.
The text is redacted the way the video is: `redact.text` and `redact.patterns` (any letter
case), the built-in patterns (emails, tokens, phone and ID numbers, …), and values of env vars
named like `*PASS*|*TOKEN*|*SECRET*|*KEY*|*AUTH*|*COOKIE*|*CRED*|*USER*|*LOGIN*|*EMAIL*`. The
runner's stderr line and `setup()`'s own `log()` lines are redacted the same way. The reason
stays in this local log and stderr, never in `.job.json`. Keep the log out of commits and
shared folders anyway.

```sh
node <skill>/scripts/watch-case.cjs demo-out/example.mp4 --stall 180 [--grace 15] [--since 120]
```

The watcher prints the new lines and exits 0 on `DONE`, 1 on `FAIL`, 2 on `DEAD` (the runner
pid is gone without either). It prints `STALL` every `--stall` seconds of silence and keeps
watching. It can be started before, with or after the runner, and restarted at any time:
- A run whose runner is still alive is watched, however long ago it started.
- A run that had already ended when the watcher started is reported only if no newer run
  appears within `--grace` seconds and it ended at most `--since` seconds earlier. This way
  the last rehearsal's `DONE` is not taken for the take that is just starting, and a take
  that failed in its first seconds is still reported.

The runner always exits itself, even when case code leaves a browser or socket open. Before
this fix, a `setup()` that opened its own browser and then threw kept Node alive for hours. On a
failure during recording it saves `take-N/fail.png` from the filmed page.

`demo.click`, `demo.highlight` and `demo.highlightText` check what is really on top at the
target. A modal, backdrop, toast or sticky bar counts as a cover. The check sees inside
open shadow roots (web components). A target styled `pointer-events:none`, such as a
floating label, is not counted as covered. An overlay that appears only because the pointer
hovers the target's own card or row (an action bar, an image overlay) is part of what the
user clicks. A menu that was already open over the target still counts as a cover. Text
under a sticky header is scrolled to the centre once. Otherwise the kit waits up to 3 s
(fast-forwarded) for the cover to go, then throws:
- `click target is covered by <tag#id.class>`
- `highlight "<label>": the target is behind <tag#id.class>`
- `highlightText "<text>": the text is behind …`

`highlightText` prefers a visible copy of the text, e.g. the same number shown inside the
open modal. Kit overlays and xterm's own layers never count as covers.

`--setup-only` runs only `setup()` to rehearse data creation. It uses no take, but setup still
consumes data, so rehearsals are counted in `.job.json` and capped at 3. A failed `setup()`
during a take leaves `stage: "setup-failed"`. A runner killed or hung during setup leaves
`stage: "setup"`, which counts the same way. The next plain run repeats the same take number.
The 3rd setup failure stops the runner. After that, a passing `--setup-only` allows exactly
one more try.

## Resume safely

For `demo-out/example.mp4` the generated files are:

- `example.job.json`: recording attempt, verification and editing checkpoint.
- `example.work/take-1/`: raw title/case clips and marks; the kit also writes its raw files.
- `example.sheet.png`: one contact sheet, not automatic approval.
- `example.review.json`: only after an actual person/agent saves what they saw.

Re-run the original command after an editing failure: it checks the case hash/raw clips
and skips setup, title and app actions. A pending `verify()` is retried read-only before
editing. A failed or changed recording never silently retries. Prepare fresh data and
explicitly request the second take:

```sh
node <skill>/scripts/run-case.cjs <work>/case.cjs --retake
```

For edits to `music`, `reviewTimes` or a failed read-only `verify()` function, use:

```sh
node <skill>/scripts/run-case.cjs <work>/case.cjs --edit-only
```

This explicitly accepts the changed case file for verification/editing of the existing
take. It never calls `setup()`, records a title or runs `run()`, and refuses missing or
incomplete takes. It keeps the original recording identity, so new action code cannot
silently become the provenance of an old video. Choose `--retake` only for new actions.

There are at most two recording attempts. If they fail, stop and report the blocker.
Do not reset the attempt counter to bypass the budget. Each output has an exclusive
`.job.json.lock` while recording/editing. The lock holds the runner's pid. When that process
is gone (crash, kill), the next run clears the lock itself, so never delete it by hand. A lock
from an older runner with no pid inside is reported. Ask the user about it.

## Edit an existing recording

```sh
python <skill>/scripts/post.py finish raw.webm final.mp4 --card title.webm
python <skill>/scripts/post.py finish raw.webm final.mp4 --card title.webm --music --seed 21
python <skill>/scripts/post.py finish raw.webm final.mp4 --times 3 12 24
```

`finish` uses `one` internally: trim before the start mark, squeeze app waits and idle
pictures, preserve intentional captions/highlights, prepend the card and optionally add
music. It then makes the sheet and writes the same job checkpoint used by the runner.
Existing recordings without marks can be processed, but have no start/wait annotations.

Options: `--idle-keep 0.6`, `--freeze 2.5`, `--freeze-keep 1.2` retain existing engine
defaults; `--width 1280` sets sheet width; `--force` re-edits without replaying app actions.
`--times` must fall within the **edited** video's duration, not the raw timeline.

Render reuse compares full source/card/marks hashes, engine and settings, then checks the
output hash. Sheet settings are cached separately. A successful render checkpoints before
sheet extraction, so a sheet failure does not require another encode. Renders stage beside
the output and replace it only when encoding succeeds. Run one editor per output at a time.

Stdout is a single JSON object with `video`, `seconds`, `cached`, `sheet`, `status`, `job`;
the web runner adds `verification` and `attempts`. `needs-review` requires looking at the
sheet. `reviewed` means an existing saved review matches this exact video's full hash.
`verification: not-configured` requires manual read-only outcome verification before claiming
the product worked. Neither successful editing nor a saved review proves database state.

After looking, record concrete observations and the redaction check:

```sh
python <skill>/scripts/post.py seen final.mp4 --save "0:03 title ok | 0:12 action ok | 0:24 proof ok | redaction ok" --by main
```

Check `seen` before looking again. Hashes now cover the full video; older partial-hash
review files are conservatively treated as stale once. Re-run `finish` to refresh the job's
review status without another render. Never save a successful review of an unseen file.

## Advanced operations

Existing `post.py one/card/concat/sheet/seen/cover` commands remain compatible. Use `cover`
for a fixed opaque bar as a last resort, then review the changed file. Build a combined
video with `concat` only when requested and after all case reviews and real outcome checks.
For non-web surfaces or custom stories, retain the existing recorder and call `finish`
on its output; do not rebuild trimming, music or sheet code in the case script.
