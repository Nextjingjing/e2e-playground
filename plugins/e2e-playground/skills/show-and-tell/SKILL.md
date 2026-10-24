---
name: show-and-tell
description: Use when the user wants a video, screen recording, demo clip, GIF or anything someone can watch that proves a feature or fix works on the real system — "อัดวิดีโอ", "ทำวิดีโอให้ดู", "show the PM/team it works", "capture the bug so QA can see it", a clip for a README, PR or review — even without the word video. Records the real app (web, Electron, terminal, Windows, mobile) with real input, captions, title cards and fast-forwarded waits. Not for written guides (hold-my-hand), screenshots only (paparazzi) or automated tests (brat-e2e).
---

# Demo video

A demo video exists to make someone **believe** the feature works the way staff will use it.
So everything on screen must be real: the real app, the real backend and database, real
mouse and keyboard events. A viewer who spots a shortcut stops trusting the whole video —
that is why the rules below are strict about faking, and relaxed about everything else.

Bundled:

- `scripts/demo-kit.cjs` — recorder: login once (not filmed), visible cursor + click ripple,
  `click / type / scanText / pasteAndEnter / highlight / highlightText / caption / card / waitApp`,
  opening title card recorded as its own clip.
- `scripts/post.py` — trims, fast-forwards dead time, puts the card first, adds music,
  joins cases into the combined video.
- `scripts/gen_music.py` — synthesizes an original lo-fi bed (no samples, no copyright),
  different per seed. Needs numpy.
- `references/agent-brief.md` — template brief for one-subagent-per-case recording.
- `references/recording.md` — case-script example, overlay and pacing rules, fonts, stills, post-process
  commands, token-saving review, many cases in parallel. **Read it before writing the first case script.**
- `scripts/terminal/` — **paintext** for terminal / CLI cases: `capture.cjs` runs the real
  shell in a pty and saves what it printed, `film.cjs` replays it as a kit session (needs
  `npm install` there once). `agent-log/` films an AI agent's run from its log.
- `references/surfaces.md` — Electron (kit `electron` option), terminal (paintext; VHS fallback), Windows
  desktop (ffmpeg gdigrab + pywinauto real input), mobile (scrcpy + Maestro). Web is the
  default path below; read this first for anything else — the rules stay the same.

Needs: Node + Playwright in the app's project (`projectDir`), ffmpeg/ffprobe on PATH,
Python with numpy. Timing and size defaults come from the **human-yardstick** skill
(reading speed, hold times, caption size); the kit's `readMs()` already applies them to
cards.

## 0. Workflow — follow in this order

Explore once, write it down, let recorders only record (why: `references/recording.md`).

Everything below lives in one work folder `<work>/` (scratchpad or next to the output) and
survives the session:

| phase | who | does | leaves behind (next session reads this, not the app/code) |
|---|---|---|---|
| 1 Plan | main | cases, stories, rules, output paths (§1–2) | `HANDOFF.md`: case table, rules, paths |
| 2 Protect | main | DB backup, claims, identifiers (§3) | backup path + claims in `HANDOFF.md` |
| 3 Scout | main or ONE agent | walk every screen of every story once without recording: routes, exact labels, working locators, #dev helpers, which code goes where; write ONE data-setup script and run it once per case | `FLOWS.md` (per screen: route, labels, locator that worked, gotchas) + `setup.<ext>` tested |
| 4 Record | 1 agent per case, ≤ 3–4 at once | read `FLOWS.md` + its case block, run setup, write the case script, record; no code exploration unless `FLOWS.md` is wrong (then fix `FLOWS.md`) | `cases/<case>/STATUS.md`, script, webm |
| 5 Post | recorder | `post.py one` → mp4 | mp4 |
| 6 Review | recorder, then main | **one** `post.py sheet` per video, look once, then `post.py seen <mp4> --save "..."` | `<mp4>.review.json` |
| 7 Combine | main | after every case is accepted: intro card + `concat` | combined mp4 |

Rules that keep it cheap without losing quality:

- **Never look at the same frame twice.** Before looking at any video run
  `post.py seen <mp4>`: `SEEN …` = trust the saved review, don't open frames; `STALE/NONE`
  = make one sheet, look, then `--save` what each moment shows and the verdict.
- **Never rediscover a screen.** `FLOWS.md` is the memory of the app for this job. A new
  session, a retake, or another tool starts from it. When a locator breaks, fix the line
  in `FLOWS.md` and carry on.
- **Recorders get facts, not tasks to research**: route, labels, ids, setup command,
  card text, seed. Give each one only its own case block.
- **Read narrowly**: `Grep -n` the symbol with a few lines of context, or `sed -n 'a,bp'`
  a range — never a whole large file "to understand it".
- **Main thread verifies by sheet + saved review**, not by re-watching.

## 1. Agree the cases and the rules (ask only what you cannot find)

Get from the user or the code: the list of cases (one video each), the story of each case
(start screen → steps → the result that proves it), login for a test account, and where to
save. Defaults when not stated:

- Output: `<root>/<separate>/NN-<case>.mp4` and `<root>/<combined>/<name>.mp4`, folder
  names in the user's language (e.g. `แยก` / `รวม`). Ask for the root once.
- Each case uses the smallest data possible (one item, one pallet, one order) so the video
  is short and easy to follow.
- Setup (creating the order, queue, job...) happens **off camera**. The video starts on the
  screen where the user's story begins.
- **Terminal / CLI case**: ask which shell the video shows: PowerShell, cmd, Git Bash / bash,
  or other. Use a choice box if your tool has one. On Windows default to PowerShell. Record the
  answer in `HANDOFF.md`. It is recorded with paintext (`references/surfaces.md`).

## 2. Hard rules for what is filmed

- **Real app, real backend, real DB.** No `page.route` stubs, no mocked responses, no
  API calls from the script, no `element.click()` / `dispatchEvent` through JS. Only
  `page.mouse` / `page.keyboard` through the kit, so each step is something a person did.
- **Inputs from outside the browser** (barcode scanner, card reader, external system) are
  the only allowed stand-ins: a scanner is a keyboard, so `scanText(code)` (fast typing +
  Enter) or the app's own dev "copy code" button + `pasteAndEnter()` is honest. Say in
  the report which inputs were stood in for.
- **Never fake a result to make the story work.** If the real system cannot reach the
  outcome the story expects, stop and report it with evidence — that is a finding about
  the product (or about the story), and the user decides. Hand-written DB rows that pretend
  a step happened are exactly the faking the user is trying to rule out.
- Read-only DB queries to choose data and to verify the outcome are fine. Writing results
  directly to the DB is not.
- **No credential or personal data ever reaches a frame, a file or the repo.** Videos get
  shared and uploaded; one visible password, token or employee number cannot be taken back.
  - The kit covers matches with solid bars before the first frame (`scripts/redact.cjs`, on by
    default): emails, JWT/bearer/API/GitHub/AWS/Google/Slack tokens, password and token
    fields, `password=…`-style text, credentials in URLs, Thai national ID, phone and card
    numbers, 9+-digit ids. Opaque bars, not blur: blur is dropped from recorded frames and
    can sometimes be reversed.
  - Add what you know will show before recording: the test account's display name, username,
    employee id, customer names → `startSession({ redact: { text: [...], selectors: [".user-badge"] } })`.
    Turn it off (`redact: false`) only when every value on screen is known to be fake.
  - Log in off camera (the kit's `login()` is never filmed). Credentials come from environment
    variables or a file outside the repo and the output folder — never in scripts, card text,
    captions, `FLOWS.md`, `HANDOFF.md`, review notes or commit messages (write "credentials:
    `<path>`", not the values).
  - Part of the review (§6): look for anything that slipped through — a name in a header, an
    id in a table, a token in a URL bar. Fix the redaction and re-record; `post.py cover`
    (solid bars on a finished video) is the last resort.

## 3. Protect the data before filming

Each take consumes real data (a pallet moves, a job closes), and retakes need fresh data.

1. Back up the database first (e.g. SQL Server `BACKUP DATABASE … WITH COPY_ONLY,
   COMPRESSION`) and tell the user where the file is. Never restore without asking: other
   work may have happened since.
2. When cases run in parallel on one DB, give each case its own identifiers (queue/order
   numbers) and a claims file (`claims/<case>.json` listing the items it will touch) that
   every recorder reads before picking data, so two cases never grab the same record.
3. Explore the screens with a non-recorded dry run (screenshots) before the recorded run —
   but remember a dry run that performs the action also consumes data.


## 4. Write the case script

Copy the example in `references/recording.md` (kit: `recordCard`, `startSession`, `caption`, `click`
with `{ slow, highlight }`, `waitApp`, `highlight`, `highlightText`, `card`, `shot`, `finish`). The rules
it carries:

- Point at the part that matters, never at everything (`highlight` refuses a box over half the
  screen; inside terminals and long text use `highlightText`). Nothing explanatory may cover
  anything else; keep labels ≤ ~40 characters.
- Wrap **every wait for the app** in `demo.waitApp(...)` so `post.py` fast-forwards it; spend the
  time on the proof (`{ slow: true }` on key buttons, a 3–5 s highlight on the result).
- One short caption per step in the user's language saying what happens and why; a title card
  (tag, a few-word title, ≤ 2 lines); 1–2 minutes per case after post-processing.
- One fixed overlay font for every case; stills of key moments come from the same run (`shot`).

## 5. Post-process

`post.py one <case.webm> <out.mp4> --card <card.webm> --seed N` per case (trims, squeezes waits,
card first, music), `post.py concat` for the combined video. Commands: `references/recording.md`.

## 6. Verify before showing anyone

Make one contact sheet of the key moments (`post.py sheet`, see below) and look at it:
title card, the key action, the proof, the end state. Check in the DB (read-only)
that what the video claims really happened. Retake if a key moment is missing, cut off by
a popup, or unreadable — if a label, caption or card covers the thing it explains or
another label — or if any credential or personal data is readable in any frame (check
headers, tables, URL bars, toasts). Then save what you saw so nobody looks again,
including the redaction check:
`post.py seen <mp4> --save "0:04 card ok | 0:52 confirm popup ok | 1:31 proof row ok | redaction ok" --by <who>`.

Saving tokens while checking (one contact sheet, text before screenshots, short output): `references/recording.md`.

## 7. Many cases: one subagent per case

Record cases in parallel, one subagent (or one session per case) each, 3–4 at a time, a mid-tier
model is enough. Scout first and hand recorders `FLOWS.md` + their own case block; each keeps
`cases/<case>/STATUS.md` and may stop and report instead of improvising. Details:
`references/recording.md`; brief template: `references/agent-brief.md`.

## Report to the user

Paths and lengths of every video; for each case what it shows (with timestamps), the data
used and how it was set up, what was stood in for (scanner, external system), anything that
behaved differently from the design (possible bugs), the backup file, and test data left
in the DB that they may want to clean up.
