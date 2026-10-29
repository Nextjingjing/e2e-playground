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
| `setup()` | optional off-camera setup of fresh test data, including retakes |
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
`.job.json.lock` while recording/editing. After a crash, verify the process has stopped
before removing that exact lock file; never delete another active worker's lock.

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
