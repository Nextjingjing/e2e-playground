# Screenshots beyond the web

The rules in `SKILL.md` stay the same everywhere: the real app (not mockups), stable demo
data, fixed time, one capture script per document that you re-run, annotations keyed to the
step list. Only the capture tool changes, and annotation moves from in-page DOM overlays to
drawing on the saved image. **Default to the open-source tool in each row.**

| surface | capture | annotate | license |
|---|---|---|---|
| Web app | Playwright + its Chromium (SKILL.md) | in-page overlay | Apache-2.0 |
| Electron | Playwright `_electron` | in-page overlay (same as web) | Apache-2.0 |
| Terminal / CLI | text blocks, or VHS `Screenshot` | CSS outline in the doc, or Pillow | MIT |
| Windows desktop | pywinauto `capture_as_image()` | Pillow on control rectangles | BSD-3 / MIT-like |
| Mobile | Maestro `takeScreenshot` / `adb exec-out screencap -p` | Pillow on `maestro hierarchy` bounds | Apache-2.0 |
| HTTP API | no picture: request + response as text | — | — |

## Electron

`win` from `electron.launch()` is a Playwright `Page`, so everything in SKILL.md works:

```js
const { _electron: electron } = require("playwright");
const app = await electron.launch({ args: ["main.js"] });
const win = await app.firstWindow();
await annotate(win, [/* same overlay helpers as for the web */]);
await win.screenshot({ path: "img/01-home.png" });
await app.close();
```

## Terminal / CLI

Prefer text: a code block of the command and the trimmed output can be copied and searched.
Use a picture only when colour, layout or a TUI is the point — VHS (`charmbracelet/vhs`,
needs `ttyd` + `ffmpeg`):

```
Output img/cli.gif
Set Width 1200
Set Height 500
Env TZ "UTC"
Type "mytool orders list --status waiting"
Enter
Wait /A-042/
Screenshot img/01-list.png
```

`Wait /regex/` instead of `Sleep`; `Hide`/`Show` around setup.

## Drawing annotations on a saved image (desktop, mobile, terminal)

```python
from PIL import Image, ImageDraw, ImageFont

def annotate(path, boxes, out):
    """boxes: [(x, y, w, h, n)] in image pixels; draws an orange outline + numbered badge."""
    img = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype("seguisb.ttf" if __import__("os").name == "nt" else "DejaVuSans-Bold.ttf", 22)
    for x, y, w, h, n in boxes:
        d.rounded_rectangle([x - 6, y - 6, x + w + 6, y + h + 6], radius=8, outline="#ff7a00", width=4)
        cx, cy = x - 6, y - 6
        d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill="#ff7a00", outline="white", width=2)
        d.text((cx, cy), str(n), fill="white", font=font, anchor="mm")
    img.save(out)
```

Where the boxes come from:
- **Windows desktop:** `ctrl.rectangle()` minus the window's `rectangle()` origin
  (pywinauto, `uia` backend; `dlg.print_control_identifiers()` lists controls).
- **Mobile:** element bounds from `maestro hierarchy` (or `adb shell uiautomator dump`),
  scaled if the screenshot resolution differs.
- **Terminal:** character cell × cell size, or skip boxes and number the lines in text.

Put the badge left of the box when it would cover text, same as on the web.
