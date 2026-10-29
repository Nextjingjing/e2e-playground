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

1. **Get the facts once.** Find the app URL, start screen, smallest test item, steps and
   expected result. Reuse an existing case script before scouting. Choose `<app>/demo-out/`
   when the user supplied no output path. Ask only for facts you cannot find safely.
2. **Protect data.** Back up a shared database and record the backup path. Skip backup only
   for a confirmed disposable test database. Never restore automatically. Set up fresh
   data off camera through supported app facilities; a dry run can consume data too.
3. **Scout narrowly.** Only inspect unknown screens in this story. Start with text/roles
   (`innerText`, `ariaSnapshot`), then a small screenshot if layout needs checking. Read
   symbols/ranges, not entire source files. Start with a budget of six focused scout calls;
   if the flow is still unclear, identify the missing dependency before widening the search.
4. **Fill the reusable case.** Copy `assets/case-template.cjs` next to the app. Put verified
   routes, locators, setup and proof in that file, then run:

   ```sh
   node <skill>/scripts/run-case.cjs <work>/case.cjs
   ```

   The runner records the title and real actions, calls optional read-only `verify()`,
   edits and makes one contact sheet. It checkpoints phases in `<output>.job.json`.
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
Stop and report a product mismatch instead of faking it or spending more takes on polish.
Update the case only when a fact changes; the job file handles phase status automatically.

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
