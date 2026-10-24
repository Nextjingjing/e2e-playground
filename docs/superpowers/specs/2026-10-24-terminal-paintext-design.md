# Terminal paintext — design

Date: 2026-10-24 · Skill: `plugins/e2e-playground/skills/show-and-tell`

## Why

Recording a real terminal window (PowerShell, cmd, bash) for a show-and-tell video is hard:
VHS is awkward on Windows, screen capture of a console flickers and its timing can't be
controlled, and nothing can draw highlights or captions over it, so they get burned in
afterwards with ffmpeg at guessed pixel positions.

The user's idea: don't film the screen. Let the AI **run the real commands**, keep **exactly
what the terminal printed** and when, then **play it back** in a page that looks like that
terminal and film the page. The viewer should feel they are watching someone use PowerShell /
cmd / a shell. Because the page shows real DOM text, the whole demo-kit works on it:
`highlightText`, captions, title cards, `waitApp` fast-forward, redaction, screenshots.

"paintext" is the user's name for this mode; keep it.

## Goals

- **Default for every terminal / CLI case** in show-and-tell. VHS stays as a fallback for
  when a real screen capture is explicitly wanted.
- **Full E2E flow, like a person.** show-and-tell teaches a flow end to end, so a case runs
  from the first command to the proof, including interactive moments: `[y/N]` prompts,
  menus, password-style prompts, progress bars, colours, spinners.
- **Feels like the real terminal.** The look matches the shell the commands really ran in
  (see "Look"). Commands appear typed at human speed; output appears with its real rhythm,
  long waits fast-forwarded with the usual idle marks.
- **Honest.** Everything the terminal printed is replayed byte for byte from the capture.
  Nothing is written by hand into the output. The only allowed change is shortening long
  output, and every cut says how much was cut (same contract as `log-replay/timeline.cjs`).
- **Same tooling as web cases**: title card, captions, highlights, `post.py` (music, squeeze
  idle spans, sheet/review), combined video, screenshots of key moments.

## Non-goals

- Not a general terminal recorder product (asciinema replacement). It serves show-and-tell.
- No editing of output, no "make the error disappear", no typed output that never ran.
- Not for full-screen TUIs as a first target (vim, htop). If xterm.js replays them correctly
  they work, but nothing extra is built for them.

## Anti-goals (would be a failure even if it technically works)

- A replay that shows output the command did not print, or hides a failure.
- A secret (token, password, connection string) visible in any frame or in a saved capture
  that ends up in the output folder.
- A highlight framing the whole terminal instead of the words that matter.
- A video that drags because waits are replayed at real length.

## How it works

Two stages, so the AI can run and check the flow before anything is filmed, and retakes don't
re-run side effects (stock moves, DB writes) on the real system.

### 1. Capture (real run)

- Spawn the real shell in a **pseudo-terminal** (ConPTY on Windows, pty on Linux/macOS) at a
  fixed size (cols × rows matching the video layout), so programs behave as if a person sits
  in front of them: colours, cursor moves, prompts, progress bars.
- A **case script** drives it step by step, like VHS `Type` / `Wait`, e.g. "type
  `mytool orders send A-042`, Enter, wait for `/Continue\? \[y\/N\]/`, type `y`, Enter, wait
  for `/done/`". If an expected text never appears within the timeout, the capture fails;
  a wrong step must fail the script, not produce a misleading video.
- **Hidden setup steps** (like VHS `Hide`…`Show`): `cd`, exporting env vars, logging in from
  environment variables. They run in the same shell but are marked hidden and are not shown
  in the replay. Secrets are only ever read from environment variables.
- Saved: every chunk of output with its timestamp, every input the script sent (with
  timestamp and whether it is hidden), shell kind, size, cwd shown in the prompt. Store it as
  **asciicast v2** (`.cast`, the asciinema format) plus input events — my call: it's a
  standard, documented format, and tools exist to inspect it.

**Decisions on capture (my calls, from the review):**

- **Typed input is captured at human speed.** The capture stage sends each visible input
  character by character at the replay's typing speed, so the shell's own echo (PSReadLine
  redraws, colours, cursor moves) is recorded for real. The replay feeds the recorded bytes
  only; it never draws input itself. So a command can't show twice, and prompts with no
  echo (password prompts) replay exactly as they looked.
- **No secret is ever written to disk.** Hidden inputs and any input taken from an
  environment variable are stored as a placeholder (`‹env:NAME›`), never the value. Before a
  capture file is written, it is scanned for the values of the env vars the script used and for
  `redact.cjs` secret patterns; any hit fails the capture (fix the step, e.g. don't `echo` the
  token). Captures live in the work folder (`<work>/cases/<case>/`), not the output folder.
- **Hidden steps = setup off camera** (existing show-and-tell rule), not a second kind of
  edit. They run first; the last hidden step clears the screen (`cls` / `Clear-Host` /
  `clear`), and the replay starts on that clean screen with the real prompt. No disclosure
  marker. A hidden step that exits non-zero or times out fails the capture.

### 2. Replay + film

- A local page renders the capture with **xterm.js using the DOM renderer** (never WebGL /
  canvas — the kit's `highlightText` and redaction need DOM text; see
  `references/surfaces.md`).
- The page plays the capture: visible inputs are typed character by character at human
  typing speed, then the recorded output bytes are fed in with their recorded gaps. Gaps over
  a threshold (and all time waiting for a command to finish) are wrapped as idle spans so
  `post.py` squeezes them.
- The case is filmed with the existing demo-kit session pointed at this page, so a case
  script can say, between replay steps: `caption(...)`, `highlightText("42 passed", "...")`,
  `card(...)`, `shot(...)`. The replay advances step by step under the case script's
  control (e.g. "play until step 3 finished, then highlight").
- `redact.cjs` stays on: it covers anything matching a secret pattern in the DOM text before
  the frame is drawn.
- Output: the same `.webm` + `.marks.json` a web case produces, so `post.py one/sheet/seen`
  and the combine step work unchanged.

### Look

**Ask the user which shell first** (the user's decision). In the Plan phase, before any
capture, the skill asks the person which terminal they want the video in, as a choice box
(AskUserQuestion in Claude Code; a plain question in other tools): PowerShell, cmd,
Git Bash / bash, or other. Default suggestion is the shell the CLI's real users use; on
Windows, PowerShell. The capture then **runs in that shell** (the look always matches the
shell the commands really ran in, never a costume over another shell). Record the answer in
`HANDOFF.md` / `FLOWS.md` so recorders don't ask again.

Each shell has its own look, Windows Terminal style by default:

| shell | prompt | default colours |
|---|---|---|
| PowerShell | `PS C:\path>` | Windows Terminal "Campbell Powershell" (dark blue background) |
| cmd | `C:\path>` | "Campbell" (black background) |
| bash / zsh | `user@host:~/path$` | dark theme |

A window frame with title bar (shell name / path) around the terminal; monospace font
(Cascadia Mono, falling back to Consolas / a bundled monospace). The prompt text comes from
the real capture, not drawn separately. Theme overridable per job.

### Mixed cases

A case that uses both a terminal and a web app (run a CLI, then check the result in the
browser) plays segments one after another in the same video, or side by side.
`log-replay/record.cjs` already places a browser video beside a terminal replay; reuse that.

My call for v1: **in sequence**. The terminal segment and the web segment are separate case
videos, each with its own marks, joined by the existing combine step. Side by side must not be
ruled out by the design, but it doesn't have to work in v1.

## Constraints

- **Spike result (2026-10-24):** ConPTY carries Thai input and output intact through
  PowerShell 5.1 and cmd once UTF-8 is set (`[Console]::OutputEncoding` / `chcp 65001`;
  capture sends these itself, hidden). xterm.js's DOM renderer draws Thai correctly except
  sara am after a tone mark (`น้ำ`, `ค่ำ`): the นิคหิต disappears. Drawing it as
  นิคหิต + tone + า fixes it. This is a display-only rewrite in the replay; the capture keeps
  the original bytes.
- **DB proof** (user asked): paintext needs no DB connection of its own. A case proves a DB
  write by typing the query in the same terminal after the action (`sqlcmd`, `psql`,
  `sqlite3`, or the app's own `list`), marked as the proof step. Back up first, as in
  show-and-tell's Protect phase. The E2E test does this with a SQLite fixture.
- **Thai output must work** (user's decision). CLIs may print Thai; combining vowels and tone
  marks must render correctly in the replay (no broken cell grid, no floating marks). Start
  the build with a spike: capture Thai output through ConPTY on PowerShell 5.1 and cmd
  (code page / UTF-8 settings), replay it in xterm.js, look at the frames, and pick a
  monospace font with Thai glyphs that keeps alignment. Include Thai output in the
  end-to-end test.
- Windows first (the user's machine): PowerShell 5.1, cmd, Git Bash. Also Linux/macOS.
- Plain Node.js / Python / ffmpeg, runnable from any shell, as `AGENTS.md` requires for the
  skill's scripts. Playwright is already a dependency of the kit.
- No credentials or personal data in captures, pictures, videos, notes or commits; logins from
  environment variables only.
- Pacing numbers (typing speed, hold times) come from `human-yardstick`, not guesses.
- Follow show-and-tell's existing work-folder phases (Plan → Scout → Record → Post → Review →
  Combine) and `STATUS.md` / `HANDOFF.md` resumability.

## Relation to existing code

- `scripts/log-replay/` (uncommitted prototype) replays a **Claude Code / opencode agent log**
  as a terminal-looking page and films it. paintext replays **any shell session**.
  **It may be changed and is the base** (user's decision): pull the terminal page and filming
  into one shared player used by both agent-log replay and paintext. Agent-log replay must
  keep working after the refactor.
- `references/surfaces.md` Terminal / CLI section and the surface table: paintext becomes the
  first/default path; VHS moves below as the fallback. `SKILL.md` text that points terminals
  to VHS / "terminal in the browser" is updated to point to paintext.
- `references/agent-brief.md` / `flows-template.md`: add what a recorder needs for a terminal
  case (shell, size, hidden setup, step list) if they lack it.

## Left to the builder

- pty library (e.g. `node-pty` / a prebuilt fork, or Python `pywinpty` / `pexpect`) — pick
  one that installs on Windows without build tools.
- Exact case-script format for capture steps, and the API the filming script uses to advance
  the replay.
- File layout under `scripts/` (new folder or grow `log-replay/`).
- Typing-speed jitter, idle threshold, default size (cols × rows) for the video frame.
- How cuts of long output are shown in the replay (marker line style).
- Tests: at least one end-to-end check that captures a small scripted PowerShell session with
  a `[y/N]` prompt, replays it, finds the output text with `highlightText`, and produces a
  `.webm` + marks.
