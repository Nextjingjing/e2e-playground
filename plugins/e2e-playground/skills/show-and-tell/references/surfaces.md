# Demo videos beyond the web

The rules in `SKILL.md` don't change on any surface: real app, real backend, real input
events, no faked results, setup off camera, a title card per case, slow on the proof,
fast-forward the waiting. `post.py` works on any `.webm`/`.mp4` — it reads
`<video>.marks.json` if one sits next to the file (same format the kit writes: `start`,
`idle` spans with `end`, `card` / `highlight` spans, `caption`), and without marks it still
trims nothing but squeezes still stretches and adds the card and music.

| surface | record | drive like a person | overlays |
|---|---|---|---|
| Web app | demo-kit (SKILL.md) | `page.mouse` / `page.keyboard` | cursor, highlight, caption in page |
| Electron | demo-kit with `electron` option | same as web | same as web |
| Terminal / CLI | VHS `.tape` → mp4 | `Type` / `Enter` at typing speed | caption burned in by ffmpeg |
| Windows desktop | ffmpeg `gdigrab` | pywinauto `click_input()` / `type_keys()` (real OS input) | ffmpeg `drawbox` / `drawtext` |
| Android | `scrcpy --record` (or `adb shell screenrecord`) | Maestro flow (`tapOn`, `inputText`) | ffmpeg `drawbox` / `drawtext` |
| iOS | `xcrun simctl io booted recordVideo` | Maestro flow | ffmpeg |
| HTTP API | record the terminal running `curl` (VHS) | `Type` the request | caption |

Write the marks file yourself for non-web surfaces: note `time.monotonic()` at the start of
recording, then append `{ "t": …, "end": …, "kind": "idle" }` around every wait for the app,
`{ "t": …, "kind": "caption", "label": "caption: …" }` when a caption should appear, and
`{ "t": …, "kind": "start" }` where the story begins.

## Electron

```js
const s = await kit.startSession({
  projectDir, outDir, name: "01-case",
  electron: { args: ["main.js"], cwd: "<app dir>" },   // instead of baseURL/startUrl
});
// s.page is the first window: demo.click / caption / highlight / shot work unchanged
```

## Terminal / CLI

A terminal is one big element, so `demo.highlight(terminalLocator)` would frame the whole
screen — the kit refuses that. Point at the text instead.

### A terminal in the browser (ttyd, xterm.js, a web IDE) — preferred, full kit

```js
await demo.scanText("npm test");                                 // typing = real keystrokes
await demo.waitApp(page.getByText(/Tests:\s+\d+ passed/), "tests");
await demo.highlightText("42 passed", "All 42 tests pass");      // just the words
await demo.highlightText(/FAIL\s+src\/cart/, "this suite fails", 2500, { line: true }); // the whole line
```

Requires the terminal to render **DOM text** (xterm.js DOM renderer): do not load the WebGL /
canvas addon; with ttyd pass its option that turns WebGL off (see `ttyd --help`; older builds:
`-t rendererType=dom`). Check: `document.querySelector(".xterm-rows").textContent` shows the
screen's text. With a canvas renderer, `highlightText` cannot find the text **and redaction
cannot see secrets** — the kit prints a `[redact]` warning; switch renderer before recording.

### VHS (no browser): highlight and cover in post

VHS draws the terminal itself, so no overlay runs. Keep secrets out of the screen entirely:
put them in environment variables inside a `Hide` … `Show` block, never `Type` a token or
password, and never `cat` a config file that holds one. Highlight a row afterwards with
ffmpeg, using the known geometry (`Set Padding`, `Set FontSize`, `Set LineHeight`):

```
row_y = padding + row_index * font_size * line_height        # row_index from 0, top of the terminal
drawbox=x=<padding>:y=<row_y>:w=iw-2*<padding>:h=<font_size*line_height>:color=orange@0.9:t=4:enable='between(t,12,15)'
```

`post.py cover` puts solid bars over rows that must not be seen.

### VHS tape

```
Output out/01-case.mp4
Set Width 1440
Set Height 900
Set FontSize 22
Set TypingSpeed 60ms
Env TZ "UTC"
Hide
Type "cd /tmp/demo && export API=http://localhost:8000" Enter
Show
Type "mytool orders send-to-sorting A-042" Sleep 800ms Enter
Wait /done/
Sleep 3s
```

`Wait /regex/` waits on real output; mark it idle in the marks file. Captions: ffmpeg
`drawtext=fontfile=…:text='…':enable='between(t,4,9)':x=(w-tw)/2:y=h-80:box=1:boxcolor=black@0.7`
after `post.py` (or before, on the raw file — keep times consistent).

## Windows desktop

```python
import subprocess, time
from pywinauto.application import Application

rec = subprocess.Popen(["ffmpeg", "-y", "-f", "gdigrab", "-framerate", "30",
                        "-i", "title=Orders", "out/01-case.mkv"], stdin=subprocess.PIPE)
t0 = time.monotonic()
app = Application(backend="uia").connect(title="Orders")
dlg = app.window(title="Orders")
dlg.child_window(title="Send to Sorting", control_type="Button").click_input()  # real mouse
...
rec.communicate(b"q")   # stop ffmpeg cleanly
```

`click_input()` / `type_keys()` move the real OS cursor and keyboard — the desktop
equivalent of `page.mouse`; `click()` (no `_input`) sends a UIA message and is not what a
person does. `title=<window>` records one window; `desktop` records the screen. Highlights:
`drawbox=x=…:y=…:w=…:h=…:color=orange@0.9:t=5:enable='between(t,12,16)'` using the control's
`rectangle()` relative to the window.

## Mobile (Android)

```
scrcpy --no-playback --record out/01-case.mp4 &   # or: adb shell screenrecord /sdcard/c.mp4
maestro test case.yaml                            # tapOn / inputText = real touch input
```

Stop scrcpy with Ctrl+C (screenrecord stops by itself after 3 minutes; pull the file with
`adb pull`). Enable "Show taps" in developer options so touches are visible — the mobile
version of the visible cursor.
