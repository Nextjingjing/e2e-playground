---
name: show-and-tell
description: Use when the user wants a video, screen recording, demo clip, GIF or anything someone can watch that proves a feature or fix works on the real system — "อัดวิดีโอ", "ทำวิดีโอให้ดู", "show the PM/team it works", "capture the bug so QA can see it", a clip for a README, PR or review — even without the word video. Records the real app (web, Electron, terminal, Windows, mobile) with real input, captions, title cards and fast-forwarded waits. Not for written guides (hold-my-hand), screenshots only (paparazzi) or automated tests (brat-e2e).
---

# Demo video

Make the feature believable: real app, real data, real mouse/keyboard input, a visible
result. Keep routine work in the bundled scripts so the agent spends its turns learning
the story and checking the proof.

## Default: one case, one thread, one command

Use this path for a short demo. Do not create subagents, a combined video or separate
HANDOFF/FLOWS/STATUS files for one case. Music is opt-in; captions, title and proof remain.

0. **Storyboard first: show what the video will be before any work (≈2 min, no tools).**
   The user must know what they will get and how long it takes before you scout or touch
   data. Reply with a short scene table and wait for an OK or a change:

   | | small version | full version |
   |---|---|---|
   | scenes | card "<claim>" → <screen> → <one action> → <proof visible> | card → … every step the user named … |
   | clip length | ~30 s | ~2–4 min |
   | work time (ETA) | ~20 min | 1–2 h+ (each extra role/page, UI-driven setup or real scan adds a lot) |
   | test data used | <1 record> | <n records> |

   Always offer the small version that proves the point. Skip the table only when the user
   already gave an exact shot list. When the user asks for more later, extend it then.
1. **Get the facts once.** Find the app URL, start screen, smallest test item, steps and
   expected result for the agreed version. Reuse an existing case script before scouting.
   Choose `<app>/demo-out/` when the user supplied no output path. Ask only for facts you
   cannot find safely.
2. **Protect data.** Back up a shared database and record the backup path. Skip backup only
   for a confirmed disposable test database. Never restore automatically. Set up fresh
   data off camera through supported app facilities; a dry run can consume data too.
3. **Scout narrowly.** Only inspect unknown screens in this story. Start with text/roles
   (`innerText`, `ariaSnapshot`), then a small screenshot if layout needs checking. Read
   symbols/ranges, not entire source files. Start with a budget of six focused scout calls;
   if the flow is still unclear, identify the missing dependency before widening the search.
4. **Fill the reusable case.** Copy `assets/case-template.cjs` next to the app. Put verified
   routes, locators, setup and proof in that file. Before recording:
   - `node <skill>/scripts/run-case.cjs <work>/case.cjs --storyboard` runs `run()` against
     a fake page. It needs no browser and uses no data. It prints the exact captions, clicks
     and highlights, plus an estimated length (`<output>.storyboard.md`). Show it to the
     user when it differs from step 0 or they asked to see it. Fix the case first, not
     after a 5-minute take.
   - `node <skill>/scripts/run-case.cjs <work>/case.cjs --setup-only` rehearses the
     off-camera setup alone (no take used).

   Then record. Always start it **in the background with a watcher at the same time** (see "Watch every run"):

   ```sh
   node <skill>/scripts/run-case.cjs <work>/case.cjs > <work>/run.log 2>&1   # background
   node <skill>/scripts/watch-case.cjs <output>.mp4 --stall 180               # streamed watcher
   ```

   The runner records the title and real actions, calls optional read-only `verify()`,
   edits and makes one contact sheet. It checkpoints phases in `<output>.job.json` and
   writes one line per phase/caption to `<output>.progress.log`.
   Re-running the command resumes editing without replaying the actions. Read
   `references/automation.md` for options or a failed phase; no need to read engine code.
   After changing only editing/verification settings, use `--edit-only` to reuse the take.
5. **Review once, then report.** Read the JSON summary. `verification: not-configured`
   means the real outcome still needs a read-only DB/API/manual check before claiming it.
   For `needs-review`, look at the one sheet: title, action, proof, end state, readability,
   overlap and redaction. Check extra frames only for a specific unresolved concern.
   Save actual observations with:

   ```sh
   python <skill>/scripts/post.py seen <out.mp4> --save "title/action/proof/end checked; redaction checked" --by main
   ```

   Check `post.py seen <out.mp4>` before opening frames later. `SEEN` means trust the saved
   review; changed video means review again. A script never grants visual approval.

No automatic retakes: each take can move real data. One initial take plus one explicit
`run-case.cjs <case.cjs> --retake` is the budget; prepare fresh data in `setup()` first.
A failed `setup()` films nothing, so it keeps the same take number. Re-run without
`--retake`; after 3 setup failures the runner stops. **Never delete or edit `.job.json`,
`.lock` or `.work/` to reset a counter.** When the budget blocks you, report and let the
user decide. Stop and report a product mismatch instead of faking it or spending more takes
on polish. Update the case only when a fact changes; the job file handles phase status.

## Watch every run

Never wait blind. A run that failed in its first minute once sat unnoticed for 2 h 16 min,
because its process never exited, so no "finished" notice came.

- Start `watch-case.cjs` within a minute of the runner, as a streamed monitor if your tool
  has one; otherwise as a second background job. It prints `STEP`/`SETUP` progress lines.
  It exits on `DONE` (0), on `FAIL <phase>: <reason>` (1), or on `DEAD` (2), which means the
  runner vanished without a result. It prints `STALL` when nothing new arrives for
  `--stall` s.
- Do not end a turn with "I'll check when it finishes" unless the watcher is confirmed
  running. If starting it fails, fix that first, e.g. load the monitor tool's schema.
- On `FAIL` or `STALL`, act now. Read the reason, then `take-N/fail.png` if listed (`SHOT`),
  or the raw clip's last frame. Do not keep waiting.
- When the user asks "done yet?", answer from the last `STEP` line and elapsed time. With a
  storyboard of the same case file, steps read `STEP 4/9`. Monitors
  that expire (e.g. 30 min caps) only stop the watcher; re-arm it, the runner keeps going.
- Watch dry runs and custom scripts the same way: give them a progress line per step.

## Failures already paid for (2026-11-18, one clip took 4 h and was cancelled)

- **Blind waiting.** See above: hung process, no watcher, the user asked "done yet?" 5×.
- **Setup through a polling UI.** A table that auto-refreshes reset a react-select within
  0.3 s. After each setup UI action, check the value really stuck, and do "select, then
  confirm" inside one retry. Prefer API/fixture setup when the app has one.
- **Dry run without overlays.** The rehearsal passed, but the filmed take missed a button at
  the bottom of the screen. `demo.click` now refuses to press when something else is under
  the pointer and names the covering element. Rehearse `run()` with the same captions as
  the take.
- **Highlight behind a modal.** A highlight framed an element hidden behind an open modal,
  so the viewer saw an orange box around nothing. `highlight`, `highlightText` and `click`
  now check what is really on top. They wait ≤ 3 s for a closing modal or toast, then fail
  and name what covers the target. In `run()`, close the modal before pointing behind it.
- **Budget bypass.** Setup failures used up both takes. The agent then deleted the job file
  3× to reset the counter. Setup failures no longer cost a take; never reset a counter.
- **Story too big, and the user could not see it coming.** A multi-role story with real scans
  needed 5 helper scripts and many dry runs. The user later accepted "just show the number
  drop" and said they could not tell what video they would get. Step 0's storyboard and
  `--storyboard` fix this. If the first take is not done ~45 min after starting, stop and
  offer the small version.

## What is filmed

- **Real app/backend/DB.** No `page.route` stubs, fabricated responses, API calls from the
  recorded actions, `element.click()` or `dispatchEvent` through JavaScript. Actions use
  demo-kit's real mouse/keyboard helpers. Setup is off camera; read-only verification is fine.
- **External input may be stood in for.** A barcode scanner is a keyboard: `scanText()` or
  the app's dev copy-code button + `pasteAndEnter()` is honest. Disclose such substitutions.
- **Never write a result to the DB to manufacture the story.** If the real system cannot
  reach the expected result, report the difference with evidence and let the user decide.
- **No secrets or personal data in artifacts.** Keep bundled `redact.cjs` on. Add known
  names/identifiers with `redact: { text: [...], selectors: [...] }`, reading sensitive
  values from environment variables. Log in off camera; credentials come only from env,
  never scripts, notes, captions, job files or commits. The runner refuses `redact: false`.
  Review headers, tables, toasts and URL bars too. Fix redaction and retake if anything
  leaks; `post.py cover` is a last resort, followed by a new review.

## Reusable editing, including existing recordings

```sh
python <skill>/scripts/post.py finish <case.webm> <out.mp4> --card <card.webm>
```

This trims setup, squeezes waits/still spans, prepends the title, makes one sheet and
prints one JSON summary. Unchanged inputs/settings/output reuse the render and sheet.
`--music --seed 21` adds music; `--times 3 12 24` chooses moments in the **edited** timeline;
`--force` re-edits without recording actions. Full options: `references/automation.md`.
Existing `one`, `sheet`, `seen`, `card`, `cover` and `concat` commands still work.

Needs Node + Playwright in `projectDir`, Python and ffmpeg/ffprobe on PATH. Only music needs
numpy. The kit already applies human-yardstick pacing defaults; read that skill when
changing timing/size. Reuse `demo-kit.cjs` helpers instead of implementing overlays again.

## Expand only when needed

- **Custom recording:** `references/recording.md` has the kit example, overlays and pacing.
  Wrap app waits in `demo.waitApp()`; use one short caption per step and a 3–5 s proof
  highlight. Keep labels short and clear of the evidence.
- **Terminal, Electron, Windows desktop, mobile:** read `references/surfaces.md` for that
  surface. The generic runner is for web cases; existing surface recorders still feed
  `post.py finish`. Terminal shell defaults to PowerShell on Windows.
- **Several cases:** reuse one scout across them. Keep `FLOWS.md` only when facts are shared
  between workers. Prefer one thread; independent substantial cases may use 2–3 workers
  with separate data identifiers and claims. Give each only its case and known facts
  (`references/agent-brief.md`), never the full conversation. The job file replaces routine
  per-step status writing. Combine accepted clips only when the user wants a combined video.

Report video path/length, what proves the result, verification, substitutions, unexpected
behavior, backup path when applicable and consumed test data. Do not claim token savings
from fewer commands alone: compare measured turns, cache-read/output tokens and wall time.
