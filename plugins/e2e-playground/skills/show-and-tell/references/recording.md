# Recording details (show-and-tell)

Read this for a custom case script or overlay/pacing details. Routine web cases use
`assets/case-template.cjs` + `run-case.cjs`; editing/review commands are in `automation.md`.
The rules in SKILL.md still apply.

## Why the workflow is strict about exploring once

Measured on the first real job (7 parallel recording agents, 2026-10-23): ~150k tokens of
context re-read **every turn** (154 M cache-read tokens over 1,038 turns). The context
filled up with exploration, not recording: 1.3 M characters of grep/cat/file reads (the
same 18 k-char fixture file read by 4 agents), 130 image reads (42 of them repeats). Only
the agent that already knew its screens finished (15 min); the others ran 60+ min until the
quota stopped them. So: **explore once, write it down, let recorders only record.**

## Case script example and overlays

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

Point at the part that matters, never at everything. `demo.highlight()` refuses a box over
half the screen — a frame round a whole terminal, log or page points at nothing. Inside big
elements use `demo.highlightText("42 passed", "label")` (or a RegExp, `{ line: true }` for the
whole row); it finds the words even when a terminal splits a line over many spans. Terminals:
paintext in `references/surfaces.md` (a live web terminal needs xterm.js's DOM renderer, or
the text — and any secret — is invisible to the kit).

Nothing explanatory may cover anything else. A label over the button it explains, or a
caption over the proof, makes the viewer miss exactly the moment you staged. The kit places
each highlight label at the free spot around the box (above, below, right, left, slid
sideways, …) that touches neither the box, the caption nor another label and covers the
least page text, and moves the caption to the
other edge while a highlight sits under it. Keep labels short (≤ ~40 characters) so a free
spot exists; when two things matter at once, highlight both in one `Promise.all` rather than
stacking text. The review (§6) checks for overlaps too.

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

## Post-process commands

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

## Saving tokens while you check

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

## Many cases: one subagent per case

Use one thread by default. Only substantial independent cases benefit from parallel
recording; keep 2–3 workers and give each a narrow brief. Fill `references/agent-brief.md` once (shared
rules + kit API) and give each agent only its case: data setup, story, card text, file
name, music seed, unique identifiers.

- An agent that has to discover the screens costs ~100–160k tokens. Scout first (phase 3)
  and hand recorders `FLOWS.md` (template: `references/flows-template.md`) plus a case
  block with routes, exact labels, data ids and the setup command — so they record instead
  of explore.
- The runner's `.job.json` checkpoints phases automatically. For custom recorders, keep one
  equivalent case checkpoint at phase boundaries, not after every click. Shared `FLOWS.md`
  is useful only when several workers need the same facts.
- Keep it to 2–3 workers at a time. Recording agents are long-running; seven at once
  exhausted the session quota mid-take in practice. Queue the rest, or hand the remaining
  cases to another coding agent/CLI the user has (with the same brief) if quota is tight.
- Each agent must be able to stop and report instead of improvising: "the real system does
  something else" is a valuable result. Verify any such claim yourself (one read-only
  query) before telling the user, then let the user choose: re-scope the case to what
  really happens, or treat it as a product question.
- When an agent finishes, run `post.py seen` on its mp4 and read its saved review; open its
  one sheet only if the review or the report leaves a doubt about a key moment.
- Build the combined video only after every case is accepted.
