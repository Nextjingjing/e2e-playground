---
name: show-and-tell
description: Record a narrated-looking demo video (mp4 with music) that proves a feature really works, by driving the REAL running app with Playwright exactly like a person: a visible cursor that moves and clicks, real keyboard typing or scanner input, orange highlights on what matters, Thai/English captions on every step, a short title card before each case, slow at the important moments and fast-forwarded through spinners and loading, one video per case plus one combined video. Cases can be recorded in parallel by one subagent each. Use whenever the user asks for a video, screen recording, demo clip, "อัดวิดีโอ", "ทำวิดีโอให้ดู", "ใช้ playwright ทำวิดีโอ", a walkthrough to show the team/boss that something works, proof a bug fix works on the real system, or "show it working end to end" — even if they don't say "video" explicitly but want something to watch rather than read. The same run can also save annotated screenshots of each key moment. Strongest on web apps; also Electron, terminal/CLI, Windows desktop and mobile apps. For a written click-by-click guide use hold-my-hand, for screenshots/Markdown manual only use paparazzi, for an automated test use brat-e2e.
---

# Demo video

A demo video exists to make someone **believe** the feature works the way staff will use it.
So everything on screen must be real: the real app, the real backend and database, real
mouse and keyboard events. A viewer who spots a shortcut stops trusting the whole video —
that is why the rules below are strict about faking, and relaxed about everything else.

Bundled:

- `scripts/demo-kit.cjs` — recorder: login once (not filmed), visible cursor + click ripple,
  `click / type / scanText / pasteAndEnter / highlight / caption / card / waitApp`,
  opening title card recorded as its own clip.
- `scripts/post.py` — trims, fast-forwards dead time, puts the card first, adds music,
  joins cases into the combined video.
- `scripts/gen_music.py` — synthesizes an original lo-fi bed (no samples, no copyright),
  different per seed. Needs numpy.
- `references/agent-brief.md` — template brief for one-subagent-per-case recording.
- `references/surfaces.md` — Electron (kit `electron` option), terminal (VHS), Windows
  desktop (ffmpeg gdigrab + pywinauto real input), mobile (scrcpy + Maestro). Web is the
  default path below; read this first for anything else — the rules stay the same.

Needs: Node + Playwright in the app's project (`projectDir`), ffmpeg/ffprobe on PATH,
Python with numpy. Timing and size defaults come from the **human-yardstick** skill
(reading speed, hold times, caption size); the kit's `readMs()` already applies them to
cards.

## 0. Workflow — follow in this order

Measured on the first real job (7 parallel recording agents, 2026-10-23): ~150k tokens of
context re-read **every turn** (154 M cache-read tokens over 1,038 turns). The context
filled up with exploration, not recording: 1.3 M characters of grep/cat/file reads (the
same 18 k-char fixture file read by 4 agents), 130 image reads (42 of them repeats). Only
the agent that already knew its screens finished (15 min); the others ran 60+ min until the
quota stopped them. So: **explore once, write it down, let recorders only record.**

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

```js
const kit = require("<skill>/scripts/demo-kit.cjs");
const projectDir = "<app project with playwright>";
await kit.recordCard({ outDir, name: "01-card", projectDir,
  tag: "Case 1 · DOM", title: "Damaged pallet during dispatch",
  lines: ["One-pallet order · forklift sends it to Sorting", "The system must leave a slot to refill"] });
const s = await kit.startSession({ projectDir, outDir, name: "01-case",
  baseURL: "http://localhost:3000", startUrl: "/forklift#dev", login: async p => { /* fill form */ } });
const { page, demo } = s;
await demo.caption("Forklift page · the job is waiting");
await demo.click(page.getByRole("button", { name: "Sorting Area" }), { slow: true, highlight: "Damaged → Sorting" });
await demo.waitApp(page.getByText("Done"), "save");          // spinner time -> fast-forwarded
await demo.highlight(page.getByRole("row", { name: /any source/ }), "New slot appeared", 3500);
await demo.card({ tag: "Case 1", title: "Fill the slot", lines: ["Scan any pallet of the same product"] });
await s.finish();
```

Pacing — what makes the video short but still convincing:

- Wrap **every wait for the app** in `demo.waitApp(...)` (page loads, spinners, polling,
  "wait until the row appears"). `post.py` squeezes those spans to ~0.6 s, so the viewer
  sees that it loaded without watching it load. Waiting with plain `sleep` or a bare
  `waitFor` leaves the spinner in at full length — the most common reason a video drags.
- Spend the time on the moments that prove the point: `{ slow: true }` on the key buttons
  and confirms, a 3–5 s `highlight` on the result. Elsewhere keep clicks quick.
- One caption per step, short, in the user's language, saying what is happening and why
  it matters ("ระบบไม่จองไม้ใหม่ให้ รายการกลับไปเป็นยอดที่ขาด"), not what the mouse does.
- Title card: tag (case number · area), a title of a few words, at most two short lines
  saying what the case tries. A mid-video `card` only where the story turns (e.g. "now
  fill the slot").
- Aim for 1–2 minutes per case after post-processing.

All overlay text (cards, captions, labels) uses one fixed font, `opts.font` (default
`'Leelawadee UI','Noto Sans Thai','Sarabun',…`), so every case looks the same regardless of
which web font the app has loaded. Pass `font` to both `recordCard` and `startSession` to
change it. Do not inject cards into the app page before it has loaded — that is what made
the font jump between cases.

### Screenshots from the same run

The run that films the case can also leave stills of the moments that matter, for a
report, a chat message, or a quick manual:

```js
await demo.highlight(row, "ไม้ผีเกิดแล้ว", 3500, { shot: "ไม้ผีเกิดแล้ว" }); // still taken while highlighted
await demo.shot("หน้าหลังปิดงาน");                                           // plain still, cursor hidden
```

`finish()` writes `shots/<name>/NN-<title>.png` plus `shots.md` (title, the caption that was
on screen, image). Copy that folder next to the videos. These pictures show real data from
that day; for a manual that must stay stable and be re-captured later, use
paparazzi (stubbed data, one capture script per document) instead.

## 5. Post-process

```
python scripts/post.py one out/01-case.webm "<root>/<separate>/01-DOM.mp4" --card out/01-card.webm --seed 21
python scripts/post.py concat "<root>/<combined>/all.mp4" intro.mp4 01.mp4 02.mp4 ... --seed 11
```

`one` trims before the first step, squeezes `waitApp` spans and any picture that stays
still for 2.5 s+ (cards, highlights and the first 2.5 s of each caption are protected),
prepends the title card, and lays a music bed (seed = a different tune per case). It
prints recorded vs final length — if a case is still long, find the unwrapped waits.
`concat` joins finished clips and re-lays one continuous music bed. An intro card for the
combined video is `recordCard` + `post.py card <card.webm> intro.mp4`.

## 6. Verify before showing anyone

Make one contact sheet of the key moments (`post.py sheet`, see below) and look at it:
title card, the key action, the proof, the end state. Check in the DB (read-only)
that what the video claims really happened. Retake if a key moment is missing, cut off by
a popup, or unreadable. Then save what you saw so nobody looks again:
`post.py seen <mp4> --save "0:04 card ok | 0:52 confirm popup ok | 1:31 proof row ok" --by <who>`.

### Saving tokens while you check

Pictures are the expensive part (a full 1440×900 frame is ~1.7k tokens to look at):

- Check a finished video with one contact sheet, not frame by frame:
  `python post.py sheet out.mp4 sheet.png 3 25 48 90` (times in that file; none = 6 evenly
  spread). Four moments in one 1280-wide image ≈ 1.4k tokens instead of ~7k.
- While exploring screens in a dry run, read text first (`await locator.innerText()`,
  `await page.locator("main").ariaSnapshot()`) to find labels and states; take a screenshot
  only to check layout, and save it small (`page.screenshot({ path, scale: "css" })` after
  `page.setViewportSize({ width: 960, height: 600 })`, or `ffmpeg -vf scale=960:-2`).
- Keep command output short: `post.py` prints one line per step (`POST_VERBOSE=1` for more);
  in scripts catch errors and print `e.message.split("\n")[0]` plus a screenshot path rather
  than Playwright's whole call log. Never read a `.webm`/`.mp4` or a long marks file into
  the conversation.
- Use the kit as it is. Every helper rewritten per case is tokens spent twice.

## 7. Many cases: one subagent per case

Cases are independent, so record them in parallel — one subagent each, a mid-tier model
is enough (the kit does the hard parts). Fill `references/agent-brief.md` once (shared
rules + kit API) and give each agent only its case: data setup, story, card text, file
name, music seed, unique identifiers.

- An agent that has to discover the screens costs ~100–160k tokens. Scout first (phase 3)
  and hand recorders `FLOWS.md` (template: `references/flows-template.md`) plus a case
  block with routes, exact labels, data ids and the setup command — so they record instead
  of explore.
- Recording runs long and can stop at any moment (quota, crash). Keep a `HANDOFF.md`
  in the work folder (case table: status, files, data ids, what each take consumed, next
  step) and have each agent keep `cases/<case>/STATUS.md` after every step, so the next
  session — or another coding CLI given the same brief — continues instead of redoing.
- Keep it to about 3–4 agents at a time. Recording agents are long-running; seven at once
  exhausted the session quota mid-take in practice. Queue the rest, or hand the remaining
  cases to another coding agent/CLI the user has (with the same brief) if quota is tight.
- Each agent must be able to stop and report instead of improvising: "the real system does
  something else" is a valuable result. Verify any such claim yourself (one read-only
  query) before telling the user, then let the user choose: re-scope the case to what
  really happens, or treat it as a product question.
- When an agent finishes, run `post.py seen` on its mp4 and read its saved review; open its
  one sheet only if the review or the report leaves a doubt about a key moment.
- Build the combined video only after every case is accepted.

## Report to the user

Paths and lengths of every video; for each case what it shows (with timestamps), the data
used and how it was set up, what was stood in for (scanner, external system), anything that
behaved differently from the design (possible bugs), the backup file, and test data left
in the DB that they may want to clean up.
