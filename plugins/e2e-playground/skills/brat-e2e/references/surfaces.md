# E2E tests beyond the web

The rules in `SKILL.md` stay the same on every surface: find things the way a user would
(visible text, control titles), wait for a condition instead of sleeping, isolate each test,
run the real backend on a throwaway test database (never production or a shared one), stub only
what you don't control, fix the clock. Only the tool changes. **Default
to the open-source tool in each row** unless the project already uses another.

| surface | test tool | license |
|---|---|---|
| Web app | Playwright Test | Apache-2.0 |
| Terminal / CLI | bats-core (shell) / pytest + subprocess | MIT / MIT |
| Electron app | Playwright `_electron` | Apache-2.0 |
| Windows desktop (native) | pytest + pywinauto `uia` backend | MIT / BSD-3 |
| Mobile (Android/iOS) | Maestro CLI flows | Apache-2.0 |
| HTTP API only | Playwright `request` / pytest + requests | Apache-2.0 / MIT |

Contents: [Terminal](#terminal--cli) · [Electron](#electron) · [Windows desktop](#windows-desktop-native) · [Mobile](#mobile) · [HTTP API](#http-api)

---

## Terminal / CLI

**bats-core** (MIT):

```bash
@test "lists only waiting orders" {
  run mytool orders list --status waiting --data "$BATS_TEST_DIRNAME/fixtures/orders.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"A-042"* ]]
  [[ "$output" != *"A-041"* ]]
}
```

`run` captures the exit code in `$status` and stdout+stderr in `$output`
(`--separate-stderr` splits them). In Python projects, `pytest` +
`subprocess.run(..., capture_output=True, text=True)` does the same.

- Point the tool at a temp directory, fixture files, or the real backend on a throwaway test
  database; never production or shared data. Stub a server only for what can't run here.
- Fix time: set `TZ` and any "now" override the tool supports.
- Assert on the lines that matter, not on the whole output (spinners, colours and timing
  noise break exact matches).

---

## Electron

Playwright drives Electron directly (marked experimental; Electron v21+):

```js
const { test, expect, _electron: electron } = require("@playwright/test");

test("opens the orders window", async () => {
  const app = await electron.launch({ args: ["main.js"] });
  const win = await app.firstWindow();
  await expect(win.getByRole("heading", { name: "Orders" })).toBeVisible();
  await app.close();
});
```

`win` is a Playwright `Page`: the same locators, `page.route` stubs and clock apply.

---

## Windows desktop (native)

**pytest + pywinauto** with the `uia` backend. Locate controls by visible title and control
type — the desktop equivalent of `getByRole`:

```python
from pywinauto.application import Application

def test_edit_opens_form():
    app = Application(backend="uia").start(r"C:\path\to\app.exe")
    dlg = app.window(title="Orders").wait("visible")
    dlg.child_window(title="Edit", control_type="Button").click_input()
    assert app.window(title="Edit order").wait("visible", timeout=10)
    app.kill()
```

- `dlg.print_control_identifiers()` lists titles/control types to copy exact labels.
- Use `wait("visible", timeout=...)`, not `time.sleep`.
- Point the app at a test config: the real backend on a throwaway test database, or a local
  stub server for what can't run here; never production data.
- WinAppDriver exists but isn't the default; prefer pywinauto unless the project already
  uses Appium/WinAppDriver.

---

## Mobile

**Maestro CLI** (Apache-2.0, local emulator/simulator or device). Flows are YAML:

```yaml
appId: com.example.orders
---
- launchApp
- tapOn: "Orders"
- tapOn: "A-042"
- assertVisible: "Waiting"
- assertNotVisible: "Loading started"
```

Run with `maestro test flow.yaml`. Maestro Cloud is a paid service — not the default.
Android emulators come with the Android SDK; iOS simulators need Xcode, which isn't open
source — say so if the tests must cover iOS.

---

## HTTP API

Playwright's `request` fixture:

```js
test("order 42 reports its pick time", async ({ request }) => {
  const res = await request.get("/api/orders/42");
  await expect(res).toBeOK();
  expect(await res.json()).toMatchObject({ code: "A-042", picked_at: "2026-01-15T09:20:00Z" });
});
```

or pytest + requests against a test server with a throwaway database — never the real one.
Create the order the test reads first (`request.post`) with a unique code instead of relying
on id 42 existing; the example keeps it short.
