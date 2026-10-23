# Surfaces other than the web

The method in `SKILL.md` doesn't change: real route first, exact labels, a visible check per
step, simulated data, fixed time, and a script that performs the guide's steps. Only the
capture and test tools change. **Default to the open-source tool in each row** unless the user
names another; if a surface can't be fully open source, say so.

| surface | capture for the guide | automated test | license |
|---|---|---|---|
| Web app | Playwright + its Chromium | Playwright Test | Apache-2.0 |
| Terminal / CLI | VHS `.tape` → PNG/GIF, or text blocks | bats-core (shell) / pytest + subprocess | MIT / MIT |
| Electron app | Playwright `_electron` | Playwright Test | Apache-2.0 |
| Windows desktop (native) | pywinauto `uia` backend | pytest + pywinauto | BSD-3 / MIT |
| Mobile (Android/iOS) | Maestro CLI `takeScreenshot` | Maestro CLI flows | Apache-2.0 |
| HTTP API only | request + expected response as text | Playwright `request` / pytest + requests | Apache-2.0 / MIT |

Contents: [Terminal](#terminal--cli) · [Electron](#electron) · [Windows desktop](#windows-desktop-native) · [Mobile](#mobile) · [HTTP API](#http-api)

---

## Terminal / CLI

**Prefer text over pictures.** Terminal output is text; a code block can be copied and
searched. Show the command, then the expected output (trimmed to the lines that matter) under
"You should see". Use a picture only when colour, layout or an interactive TUI is the point.

**Pictures with VHS** (charmbracelet/vhs, MIT; needs `ttyd` and `ffmpeg` on PATH). A `.tape`
file is the capture script — it types the guide's commands, so a wrong command fails here
first:

```
Require mytool
Output guide/img/cli.gif
Set FontSize 18
Set Width 1200
Set Height 500
Env TZ "UTC"

Type "mytool orders list --status waiting"
Enter
Wait /A-042/
Screenshot guide/img/01-list.png
```

- `Wait /regex/` instead of `Sleep` so the shot is taken when the output is really there.
- `Hide` / `Show` around setup (creating temp data, `cd`) and cleanup.
- Fix inputs: point the tool at a temp directory / fixture file / stub server, set `TZ` and any
  "now" override the tool supports, and disable colour randomness or spinners if there's a flag.
- Annotate by outlining in the guide's HTML (CSS on the `<img>` wrapper) or by keeping the
  numbers in the text — the tape can't draw badges.

**Tests with bats-core** (MIT):

```bash
@test "lists only waiting orders" {
  run mytool orders list --status waiting --data "$BATS_TEST_DIRNAME/fixtures/orders.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"A-042"* ]]
  [[ "$output" != *"A-041"* ]]
}
```

`run` captures exit code in `$status` and stdout+stderr in `$output`
(`--separate-stderr` splits them). In Python projects, `pytest` + `subprocess.run(...,
capture_output=True, text=True)` does the same.

---

## Electron

Playwright drives Electron directly (support is marked experimental; Electron v21+):

```js
const { _electron: electron } = require("playwright");
const app = await electron.launch({ args: ["main.js"] });
const win = await app.firstWindow();
// same locators, page.route stubs, clock and annotate() helpers as for the web
await win.screenshot({ path: "img/01-home.png" });
await app.close();
```

Everything in the web workflow applies to `win` (it is a Playwright `Page`).

---

## Windows desktop (native)

Use **pywinauto** (BSD-3) with the `uia` backend. Locate controls by their visible title and
control type — the desktop equivalent of `getByRole`:

```python
from pywinauto.application import Application

app = Application(backend="uia").start(r"C:\path\to\app.exe")
dlg = app.window(title="Orders").wait("visible")
dlg.child_window(title="Edit", control_type="Button").click_input()
dlg.capture_as_image().save("img/01-edit.png")   # needs Pillow
```

- `dlg.print_control_identifiers()` lists titles/control types — use it to copy exact labels.
- Annotate by drawing on the saved image with Pillow (`ImageDraw.rectangle`, circle + number)
  using the control's `rectangle()` relative to the window.
- Point the app at a test config / local stub server, never production data.
- WinAppDriver exists but isn't the default here; prefer pywinauto unless the project already
  uses Appium/WinAppDriver.

---

## Mobile

Use the **Maestro CLI** (Apache-2.0, runs locally on an emulator/simulator or device). Flows
are YAML and read like the guide itself:

```yaml
appId: com.example.orders
---
- launchApp
- tapOn: "Orders"
- tapOn: "A-042"
- assertVisible: "Waiting"
- takeScreenshot: img/03-waiting
```

Run with `maestro test flow.yaml`. Maestro Cloud is a paid service — don't use it by default.
Android emulators come with the Android SDK; iOS simulators need Xcode, which isn't open
source — say so if the guide covers iOS. Annotate screenshots afterwards with Pillow, using
the element bounds from `maestro hierarchy`.

---

## HTTP API

No pictures needed. Each step: the request (copyable `curl`), then "You should see" with the
status code and the JSON fields that matter.

```bash
curl -s http://localhost:8000/api/orders/42 | jq '{code, picked_at, started_at}'
```

Tests: Playwright's `request` fixture (`await request.get("/api/orders/42")` +
`expect(response).toBeOK()`) or pytest + requests against a test server with a throwaway
database — never the real one.
