# Terminal paintext Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** show-and-tell terminal cases run real shell commands through a pty, save what the terminal printed, and film a replay of it in a page that looks like the chosen shell, using the normal demo-kit tools.

**Architecture:** `capture.cjs` drives PowerShell / cmd / bash in a pseudo-terminal (`@lydell/node-pty`, ConPTY on Windows), typing each step at human speed and waiting for expected text. It writes an asciicast v2 file (`.cast`). `term.html` replays the `.cast` in xterm.js with the DOM renderer, inside a Windows Terminal style frame. `film.cjs` opens that page through `demo-kit.startSession`, so captions, `highlightText`, redaction, idle marks and `post.py` work unchanged. The agent-log prototype (`scripts/log-replay/`) moves into the same folder and shares the frame.

**Tech Stack:** Node 24, `@lydell/node-pty` (prebuilt, no build tools), `@xterm/xterm` + `@xterm/headless`, Playwright (Chromium), `node:test`, Python 3 (test fixture only), ffmpeg/post.py (existing).

**Spec:** `docs/superpowers/specs/2026-10-24-terminal-paintext-design.md`

## Global Constraints

- Output is replayed byte for byte from the capture. Nothing is written into the output by hand. The only display change allowed is the Thai cell fix (Task 1), which changes how glyphs are drawn, not the text.
- No secret is ever written to disk. Inputs taken from env vars are stored as `‹env:NAME›`. If a capture contains a secret value or matches `redact.cjs` `DEFAULT_PATTERNS`, the capture fails and no `.cast` is written.
- Captures go in the work folder (`<work>/cases/<case>/`), never in the output folder.
- Hidden steps are setup done off camera. The last hidden step is followed by a screen clear (`Clear-Host` / `cls` / `clear`). The replay starts on that clean screen. If a hidden step fails, the capture fails.
- Thai output must render correctly (no lost นิคหิต, no broken cell grid).
- Windows first (PowerShell 5.1, cmd, Git Bash). Code paths for bash on Linux/macOS stay in place even where this machine can't test them.
- Plain Node/Python/ffmpeg that runs from any shell. Logins come from env vars only. `redact.cjs` stays on.
- xterm.js uses the DOM renderer only. Never load the WebGL or canvas addon.
- The agent-log replay must keep working after the move.

## Review Focus

1. **`ำ` split across two output chunks** (tone mark at the end of chunk N, `ำ` at the start of chunk N+1). It must still render as `ํ + tone + า`. Test: Task 1 `ThaiStream carries a trailing tone mark`.
2. **A step whose expected text never appears** (wrong command, a hanging program). The capture must fail within `timeoutMs`, name the step, print the last 10 screen lines, kill the pty and exit. It must not hang: the spike's first run hung. Test: Task 2 `fails fast when expect never matches`.
3. **A visible step echoes a secret** (`echo $env:TOKEN`). The capture fails and no `.cast` file exists. Test: Task 2 `refuses to write a cast containing a secret`.
4. **Programs that redraw**: PSReadLine echo redraws, `\r` progress bars, colours. The text the replay page shows at the end must equal the final screen of a headless emulator fed the same bytes. Test: Task 3 `replay screen equals headless screen`.
5. **cmd / PowerShell on a non-UTF-8 code page** print Thai as `???`. Capture adds a UTF-8 prelude to the hidden setup automatically, so a Thai `echo` in cmd works without the author adding `chcp`. Test: Task 2 `cmd prints Thai without author chcp`.

---

## File Structure

All under `plugins/e2e-playground/skills/show-and-tell/scripts/terminal/` (call it `T/` below):

| file | responsibility |
|---|---|
| `T/package.json` | deps: `@lydell/node-pty`, `@xterm/xterm`, `@xterm/headless`, `playwright`; `"test": "node --test test/"` |
| `T/thai.cjs` | `thaiCells(s)` and `ThaiStream`: Thai sara-am fix for xterm cells. UMD-style so `term.html` can load it too |
| `T/themes.cjs` | shell → { prompt regex, clear command, UTF-8 prelude, xterm theme, tab icon, title } |
| `T/capture.cjs` | `capture(opts, steps)`: pty run → `.cast` |
| `T/term.html` + `T/frame.css` | replay page (xterm.js DOM renderer, frame); `frame.css` shared with the agent-log page |
| `T/film.cjs` | `film(opts)`: demo-kit session on `term.html`, `play(label)` |
| `T/agent-log/` | moved from `scripts/log-replay/`: `log-run.py`, `timeline.cjs`, `record.cjs`, `replay.html` (uses `../frame.css`) |
| `T/test/fixtures/orders.py` | demo CLI with a `[y/N]` prompt, Thai output, a `\r` progress bar, SQLite write + `list` query |
| `T/test/*.test.cjs` | node:test files per task |
| `scripts/demo-kit.cjs` | `highlightText`: retry the needle through `thaiCells` |
| `SKILL.md`, `references/surfaces.md`, `references/agent-brief.md`, `references/flows-template.md` | docs (Task 5) |

`.gitignore` already ignores `node_modules/`, `*.webm`, `*.marks.json`. Add `*.cast` under `test/` output only (`T/test/out/`).

---

### Task 1: Package, Thai cell fix, shell themes

**Files:**
- Create: `T/package.json`, `T/thai.cjs`, `T/themes.cjs`, `T/test/thai.test.cjs`, `T/test/themes.test.cjs`

**Interfaces:**
- Produces:
  - `thaiCells(s: string) => string`: rewrites `([\u0E48-\u0E4B]?)\u0E33` → `\u0E4D$1\u0E32`. Spike result: xterm.js drops the นิคหิต of `น้ำ` / `ค่ำ`; the order นิคหิต, tone, า renders right.
  - `class ThaiStream { push(chunk: string): string; flush(): string }`: same rewrite over a stream; holds back a trailing tone mark (U+0E48–U+0E4B) until the next chunk or `flush()`.
  - `themes[shell]` for `shell ∈ {"powershell","cmd","bash"}`: `{ file, args, prompt: RegExp, clear: string, prelude: string[], title, icon, theme }`.
  - `thai.cjs` works both as `require()` and as a `<script>` that sets `window.thai`.

- [ ] **Step 1: Write failing tests** `T/test/thai.test.cjs`:
  - `thaiCells("น้ำ ทำ ค่ำ") === "น\u0E4D\u0E49\u0E32 ท\u0E4D\u0E32 ค\u0E4D\u0E48\u0E32"`
  - `thaiCells("abc สวัสดี") === "abc สวัสดี"` (unchanged)
  - `ThaiStream carries a trailing tone mark`: `s.push("น\u0E49") + s.push("\u0E33x") + s.flush() === thaiCells("น้ำx")`, and the first `push` returns `"น"`
  - `flush` with nothing held returns `""`

  `T/test/themes.test.cjs`: `themes.powershell.prompt.test("PS C:\\work> ")`, `themes.cmd.prompt.test("C:\\work>")`, `themes.bash.prompt.test("user@host:~/w$ ")`. `themes.powershell.theme.background === "#012456"`. `themes.cmd.theme.background === "#0C0C0C"`.
- [ ] **Step 2: Run** `cd T && npm install && npm test`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `thai.cjs` and `themes.cjs`. Exact values:
  - powershell: `file: "powershell.exe"`, `args: ["-NoLogo"]`, `prompt: /PS [^\r\n]*> ?$/`, `clear: "Clear-Host"`, `prelude: ["[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8"]`, title `Windows PowerShell`, theme "Campbell Powershell": background `#012456`, foreground `#CCCCCC`.
  - cmd: `file: "cmd.exe"`, `args: []`, `prompt: /[A-Za-z]:\\[^\r\n>]*>$/`, `clear: "cls"`, `prelude: ["chcp 65001 >nul"]`, title `Command Prompt`, theme "Campbell": background `#0C0C0C`, foreground `#CCCCCC`.
  - bash: `file: process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash"`, `args: ["--login", "-i"]`, `prompt: /\$ ?$/`, `clear: "clear"`, `prelude: ["export LANG=C.UTF-8"]`, title `bash`, theme "One Half Dark": background `#282C34`, foreground `#DCDFE4`.
  - Campbell ANSI palette for powershell and cmd: black `#0C0C0C`, red `#C50F1F`, green `#13A10E`, yellow `#C19C00`, blue `#0037DA`, magenta `#881798`, cyan `#3A96DD`, white `#CCCCCC`, brightBlack `#767676`, brightRed `#E74856`, brightGreen `#16C60C`, brightYellow `#F9F1A5`, brightBlue `#3B78FF`, brightMagenta `#B4009E`, brightCyan `#61D6D6`, brightWhite `#F2F2F2`.
  - Icons: powershell `❯_` on `#3B78FF`, cmd `C:\` on `#767676`, bash `$` on `#16C60C`.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(show-and-tell): terminal package, Thai cell fix, shell themes`.

### Task 2: capture.cjs (real run → .cast)

**Files:**
- Create: `T/capture.cjs`, `T/test/fixtures/orders.py`, `T/test/capture.test.cjs`

**Interfaces:**
- Consumes: `themes`, `DEFAULT_PATTERNS` from `../redact.cjs`.
- Produces: `capture(opts, steps) => Promise<{ cast: string, events: Array }>`
  - `opts`: `{ shell: "powershell"|"cmd"|"bash", cwd, out /* .cast path */, cols = 110, rows = 30, env = {}, typeMs = 60, timeoutMs = 20000, settleMs = 300 }`
  - step: `{ type?: string, secret?: "ENV_NAME", enter = true, expect?: RegExp, hidden = false, mark?: string }`. `secret` types `process.env[NAME]`. Default `expect` is the theme's prompt.
  - `.cast` = asciicast v2. Header line: `{version:2,width:cols,height:rows,timestamp,env:{SHELL:shell},paintext:{shell,title}}`. Then events `[t,"o",data]` for output, `[t,"i",data]` for input (`‹env:NAME›` for secret steps), and `[t,"m",label]` markers. Marker `"start"` is written after the auto clear following the last hidden step (at t of the first visible step if there are none). Marker `"step:<n>"` (n = visible step index from 1) and the step's `mark` label are written when the step's expect matched.
  - CLI: `node capture.cjs <steps.cjs>`, where the file exports `{ opts, steps }`.
- Matching: strip ANSI/OSC (`/\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[=>]/g`) from the output received since the step's Enter. Match `expect` against it. Then wait for `settleMs` with no new output before the next step.
- Order: spawn → wait for prompt → theme `prelude` (hidden) → author hidden steps → `clear` (hidden) → prompt → `"start"` marker → visible steps → `exit`.

- [ ] **Step 1: Write fixture** `orders.py` (plain stdlib; UTF-8 stdout via `sys.stdout.reconfigure(encoding="utf-8")`; DB path from argv `--db`):
  - `add <code> <name>` prints `จะบันทึก <code> <name>`, asks `Continue? [y/N] `, on `y` prints a 5-step `\r` progress bar (`[####      ] 40%`, 0.3 s per step), inserts into SQLite, prints `บันทึกแล้ว ✔`. On other input it prints `ยกเลิก` and exits 1.
  - `list` prints a table of all rows (`code  name`).
- [ ] **Step 2: Write failing tests** `capture.test.cjs` (skip all unless `process.platform === "win32"`; temp dir per test):
  - `powershell session with prompt, Thai and DB`: steps `hidden "cd <tmp>"`, `type "python <fixture> --db o.db add A-042 น้ำดื่ม", expect /Continue\? \[y\/N\]/`, `type "y", expect /บันทึกแล้ว/`, `type "python <fixture> --db o.db list", mark "proof"`. Assert: `.cast` exists; header `paintext.shell === "powershell"`; markers include `start`, `step:1..3`, `proof` in that order; joined output after `start` contains `บันทึกแล้ว` and `A-042`; no `"o"` event before `start` is replayed visibly (checked in Task 3).
  - `cmd prints Thai without author chcp`: cmd, visible `echo สวัสดี น้ำ`. Output after `start` contains `สวัสดี น้ำ`.
  - `fails fast when expect never matches`: `type "echo hi", expect /never/`, `timeoutMs 3000`. Rejects within 6 s, message contains `step 1` and `echo hi`. No `.cast` written. pty killed (test process exits).
  - `refuses to write a cast containing a secret`: `env {PT_TOKEN: "s3cr3t-XYZ-123"}`, visible `echo $env:PT_TOKEN`. Rejects, message contains `secret`, no `.cast`.
  - `secret input stored as placeholder`: hidden step `{ secret: "PT_TOKEN", enter: false, expect: /./ }` after `type "$x = Read-Host -AsSecureString", expect: /:/`. Cast text contains `‹env:PT_TOKEN›` and not `s3cr3t-XYZ-123`.
  - `hidden step failure fails capture`: hidden `type "exit 3"` (shell dies). Rejects with `hidden step`.
- [ ] **Step 3: Run** `npm test -- --test-name-pattern capture`. Expected: FAIL.
- [ ] **Step 4: Implement `capture(opts, steps)`.** Type each character with `typeMs` plus 0–40 ms random jitter, so the echo is recorded at human speed. Before writing, scan the whole cast text: fail if it contains the value of any env var used by a `secret` step or any value from `opts.env`, or if it matches `DEFAULT_PATTERNS`. Hard-kill the pty on every exit path (success, reject, `process.on("exit")`).
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat(show-and-tell): capture real shell sessions to asciicast`.

### Task 3: term.html + film.cjs (replay and film)

**Files:**
- Create: `T/term.html`, `T/frame.css`, `T/film.cjs`, `T/test/film.test.cjs`
- Modify: `scripts/demo-kit.cjs` `highlightText` (the `find` retry)

**Interfaces:**
- Consumes: `.cast` from Task 2, `thai.cjs`, `themes`, `demo-kit.startSession`.
- Produces:
  - Page API on `window.paintext`: `load(castText)`, which applies the theme/title from the header and feeds everything before `"start"` instantly. `next(stopLabel?) => Promise<{ gap?: number, marker?: string, done: boolean }>` plays events at recorded timing until the next gap > 0.8 s (returns `gap`, not slept), the marker `stopLabel`, or the end. Output goes through `ThaiStream`. Each OSC title change updates the tab title.
  - `film({ cast, outDir, name, view?, redact?, projectDir = __dirname, font? }) => Promise<{ page, demo, play(label?), finish() }>`. `play(label)` loops `next(label)`. Each gap becomes `demo.waitApp(() => sleep(gap * 1000), "waiting for output")`, so post.py squeezes it. `finish()` = session finish.
  - `demo.highlightText(needle)`: when the plain needle is not found and contains `ำ`, retry with `thaiCells(needle)`.
- Frame: a Windows Terminal style tab bar like `agent-log/replay.html` (`.bar`, `.tab`, `.win`, moved into `frame.css`), with the theme icon and title. The terminal fills the rest of `view` (default 1440×900). Choose `fontSize` so `cols × rows` fit. Font: `'Cascadia Mono','Consolas','Leelawadee UI','Noto Sans Mono','Noto Sans Thai',monospace`.

- [ ] **Step 1: Write failing tests** `film.test.cjs` (win32; reuse Task 2's PowerShell capture, built once in `before`):
  - `replay screen equals headless screen`: load the cast in `term.html`, call `next()` until done. The `.xterm-rows` row texts (trimmed, empty rows dropped) equal the rows of an `@xterm/headless` Terminal fed all `"o"` data through `thaiCells` (same trim). The PowerShell prompt from before `start` (the `cd` line) is not on screen.
  - `film produces webm and marks`: `film()` → `play("proof")` → `demo.highlightText("A-042", "แถวที่บันทึก")` → `demo.highlightText("น้ำดื่ม", "ชื่อสินค้า")` → `play()` → `finish()`. `<outDir>/<name>.webm` exists, size > 0. `marks.json` has kind `start`, at least one `idle` labelled `waiting for output`, and two `highlight` marks.
  - `prompt and Thai visible`: after `play("step:1")`, the page text matches `/Continue\? \[y\/N\]/`.
- [ ] **Step 2: Run** `npm test -- --test-name-pattern "replay|film|prompt"`. Expected: FAIL.
- [ ] **Step 3: Implement** `term.html`, `frame.css`, `film.cjs` and the `highlightText` retry. Load `@xterm/xterm` from `T/node_modules` by relative path. No CDN, so it works offline. `film` opens `term.html` as a `file://` URL with `startUrl`, and passes the cast text via `page.evaluate`.
- [ ] **Step 4: Run** the tests. Then look at one frame: `python ../post.py sheet <webm>`. Check by eye: Thai `น้ำดื่ม` shows its นิคหิต, the highlight box sits on the words, and the frame/tab looks like Windows Terminal.
- [ ] **Step 5: Commit** `feat(show-and-tell): replay captured terminals and film them with demo-kit`.

### Task 4: Move agent-log replay under terminal/ and share the frame

**Files:**
- Move: `scripts/log-replay/{log-run.py,timeline.cjs,record.cjs,replay.html}` → `T/agent-log/`
- Modify: `T/agent-log/replay.html` (link `../frame.css`, drop its duplicated `.bar/.tab/.win` rules), `T/agent-log/record.cjs` (resolve Playwright from `T/` by default when `--project` is omitted)
- Create: `T/test/agent-log.test.cjs`, `T/test/fixtures/agent-run/{run.jsonl,prompt.txt}`

**Interfaces:**
- Consumes: `T/frame.css`.
- Produces: `node T/agent-log/record.cjs <workdir>` with the same flags as before. Writes `<workdir>/replay.json` and `<workdir>/replay/*.webm`.

- [ ] **Step 1: Write fixture**: a 5-line Claude Code stream-json run (`system` with model, `assistant` text, `assistant` tool_use Bash `echo ok`, `user` tool_result `ok`, `result`), each wrapped `{"ts":…, "ev":…}` with 1–2 s gaps. Plus a one-line `prompt.txt`.
- [ ] **Step 2: Write failing test** `agent-log.test.cjs`: run `record.cjs` on a temp copy of the fixture. Exit 0. `replay.json.items` contains kinds `text`, `tool` and `result`. One `.webm` in `replay/`.
- [ ] **Step 3: Run**. Expected: FAIL (path moved).
- [ ] **Step 4: Move the files and make the edits.** Delete `scripts/log-replay/`. Fix the usage line in `log-run.py` (it says `run_claude.py`).
- [ ] **Step 5: Run** `npm test`. Expected: all PASS.
- [ ] **Step 6: Commit** `refactor(show-and-tell): agent-log replay shares the terminal frame`.

### Task 5: Docs, skill flow, packaging

**Files:**
- Modify: `show-and-tell/SKILL.md` (terminal pointers, Plan phase), `references/surfaces.md` (Terminal / CLI section and the surface table), `references/agent-brief.md`, `references/flows-template.md`, `install.ps1` / `install.sh` (zip excludes `node_modules`), spec (DB proof + Thai spike result)

- [ ] **Step 1: surfaces.md.** Surface table row: Terminal / CLI → record `paintext (capture.cjs → film.cjs)`, drive `steps typed at human speed through a pty`, overlays `full kit`. HTTP API row → paintext running `curl`. New first subsection "paintext (default)" with:
  - one-time `npm install` in `scripts/terminal`;
  - a complete steps file + film script example (the orders flow, with a `list` query as the DB proof);
  - rules: secrets only via `secret: "ENV"`; hidden setup; `mark` the proof step; `highlightText` the words; pipe long output through `Select-Object -First N` / `head` on screen instead of cutting it;
  - "DB proof: after the action, type the query (`sqlcmd`, `psql`, `sqlite3`, or the app's own `list`) in the same terminal. Back up first (§3 Protect)."

  Move the existing VHS subsections below it under "Fallback: VHS (a real screen capture is required)". Keep the xterm-in-browser (ttyd) subsection, since it is still valid for live web terminals.
- [ ] **Step 2: SKILL.md.** Phase 1 Plan: "Terminal case → ask the person which shell the video shows (PowerShell / cmd / Git Bash / other; default PowerShell on Windows) with a choice box, and record the answer in `HANDOFF.md` and `FLOWS.md`". Make the terminal pointer near `highlightText` name paintext first.
- [ ] **Step 3: agent-brief.md / flows-template.md.** For terminal cases add the fields shell, cols×rows, hidden setup commands, step list with `expect`, and the env var names for secrets.
- [ ] **Step 4: Packaging.** Make `install.ps1 -Zip` and `install.sh` skip `node_modules` (and `test/out`) when zipping/copying. Verify: `.\install.ps1 -Zip`, then `tar -tf dist/show-and-tell.zip | grep -c node_modules` prints `0`.
- [ ] **Step 5: Spec.** Add the Thai spike result (นิคหิต fix) and the DB-proof line to the spec.
- [ ] **Step 6: Full check.** In `T/`, run `npm test`: all pass. Film the orders demo once end to end, run `post.py one` → mp4, and look at one `post.py sheet`.
- [ ] **Step 7: Commit** `docs(show-and-tell): paintext is the default for terminal cases`.
