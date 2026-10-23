---
name: paparazzi
description: >
  Write a user manual as Markdown while capturing screenshots of the REAL
  running app with Playwright (not mockups) — including outline/spotlight
  highlights, callout tooltips, and numbered circle badges (①②③) overlaid on
  a screenshot to key it to a step list. Use whenever the user asks to
  write/update a how-to-use doc, user manual, or onboarding guide for their
  own app, wants "real screenshots" of the UI, or wants numbered
  annotations/markers pointing at specific elements in a screenshot
  ("ถ่ายรูปหน้าจอ", "แคปหน้าจอใส่คู่มือ", "ทำคู่มือ .md"). Strongest on
  web apps; also Electron, terminal/CLI, Windows desktop and mobile apps.
  Not for a
  click-by-click HTML test/how-to page reviewed round by round (use
  hold-my-hand), a video (use show-and-tell) or an automated test (use
  brat-e2e).
---

> Web apps are the default path below. For Electron, a terminal/CLI tool, a Windows desktop
> app or a mobile app, read `references/surfaces.md` for the capture and annotation tool;
> the method stays the same.

Manuals lie the moment a screenshot is hand-mocked or stale. Drive the actual
app with Playwright, log in as a real (seeded/demo) user, and screenshot what
is really on screen. Pair that with a `.md` file that is the single source of
truth — no separate hand-authored "print" copy of the content (convert the `.md`
to PDF afterwards if print is needed).

## Before writing any capture code

1. Find how this project's app actually starts (dev server command, port,
   whether it needs a backend/API running alongside it). Check for a seed
   script, demo/fixture account, or mock API — screenshots need **stable,
   deterministic** data, not whatever is in a shared dev database today. If
   the project has no demo data, ask before inventing fixtures — don't
   silently seed the real database.
2. Confirm the target `.md` file and where images should live (usually an
   `assets/` or `images/` folder beside it, referenced with a relative path).
3. One capture script per document, not one-off throwaway scripts per image.
   The doc will be edited again — the next edit should mean "re-run the
   script," not "figure out how these screenshots were taken."
4. **No credentials or personal data in any picture, script or doc.** Manuals get shared
   and committed. Use demo accounts and fake data first; then keep `redact.cjs` (next to
   the template) on as the safety net — it covers emails, tokens/API keys, password fields,
   `password=…` text, URL credentials, ID/phone/card numbers and long ids with solid bars
   before anything is painted. Add the demo user's display name and any real names you
   expect (`redactConfig({ text: [...] })`). Read the login from environment variables
   (`DEMO_USER` / `DEMO_PASS` in the template), never hard-code it. When you look at each
   PNG, check headers, tables and URL bars for anything that slipped through.

## Browser: Playwright + open-source Chromium by default

Unless the user names another tool or browser, capture with **Playwright** driving its own
**Chromium** build (the open-source browser Playwright downloads with
`npx playwright install chromium`) — not the user's installed Google Chrome, Edge or a
browser extension. Reasons: it's free and open source, identical on every machine and in CI,
needs no signed-in profile, and screenshots don't change when the user's browser updates.
If the user asks for Firefox/WebKit (`firefox`/`webkit` from Playwright) or a branded
channel (`chromium.launch({ channel: "chrome" })`), use that instead and say so in the
manual.

Never point captures at a real or shared database. Use seeded demo data or stub the API
with `page.route()` / `route.fulfill()` (Playwright's recommended way to control data the
test doesn't own).

## Setup a capture script needs

```js
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

// Log in as the seeded/demo account, wait for the real landing state —
// not a fixed sleep.
await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
// ...fill credentials, submit, wait for a heading/element unique to "loaded".

// Kill CSS animations/transitions globally so a screenshot never lands
// mid-fade and looks different between runs.
await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
```

Playwright is very likely **not installed** in the target project. Install it
scoped to wherever the capture script lives, use it, then remove it — don't
leave a stray `playwright` dependency in the app's real `package.json`:

```bash
cd <docs-folder>
npm init -y && npm install playwright --no-audit --no-fund
npx playwright install chromium
# ...capture...
rm -rf node_modules package.json package-lock.json
```

If the app's dev server uses Turbopack and its `node_modules` is a symlink
into another package (a docs-site clone sharing the real app's deps, a
monorepo workspace link), Turbopack can fail with `Symlink [...] is invalid,
it points out of the filesystem root`. Fall back to `next dev --webpack` (or
the equivalent non-Turbopack flag) rather than fighting the symlink.

## Annotation techniques

All of these are DOM elements injected with `page.evaluate`, styled inline,
right before the screenshot — then either left for that one screenshot or
removed before the next. None of them are real product UI; say so in the
manual's captions so a reader never mistakes an annotation for a feature.

**Outline** — draw attention to a region without obscuring it:
```js
await locator.evaluate((el) => {
  el.style.boxShadow = "inset 0 0 0 4px #b45309";
  el.style.borderRadius = "8px";
});
```

**Spotlight** — dim everything except one region, for "this is the part that
matters" screenshots:
```js
await page.evaluate(() => {
  const shade = document.createElement("div");
  shade.style.cssText = "position:fixed;inset:0;background:rgba(20,16,10,.55);z-index:9998;pointer-events:none";
  document.body.append(shade);
  target.style.cssText = "position:relative;z-index:9999;box-shadow:0 0 0 5px #f0a646";
});
```

**Callout** — a floating explanation box, for "start here" framing:
```js
const callout = document.createElement("aside");
callout.innerHTML = "<strong>Headline</strong><span>Body text</span>";
callout.style.cssText = "position:fixed;right:32px;top:105px;width:288px;padding:20px;border-radius:12px;background:#3a2a14;color:#fff;z-index:9999;font:15px system-ui";
document.body.append(callout);
```

**Numbered badges** — the pattern for keying a screenshot to a numbered step
list in the surrounding prose (see `capture-template.mjs` in this skill's
folder for the full working function). The core idea:

```js
const addBadge = (rect, number) => {
  if (!rect) return; // selector matched nothing — badge silently skipped, not misplaced
  const badge = document.createElement("div");
  badge.textContent = String(number);
  badge.style.cssText = `position:fixed;left:${rect.left - 13}px;top:${rect.top - 13}px;
    width:26px;height:26px;border-radius:50%;background:#b45309;color:#fff;
    display:flex;align-items:center;justify-content:center;font:700 14px system-ui;
    box-shadow:0 0 0 2px #fff,0 4px 10px rgba(0,0,0,.35);z-index:10000`;
  document.body.append(badge);
};
```

Rules for badges specifically:

- **`getBoundingClientRect()` is viewport-relative**, same coordinate space as
  a `position: fixed` badge — that's why this works without scroll-offset
  math. `scrollIntoViewIfNeeded()` the target *before* computing the rect, or
  the badge lands off-screen and the screenshot silently misses it.
- **Pick the specific instance that has the feature**, not just "the first
  row" — e.g. if you're numbering a `+N` counter that only shows on rows with
  more than one status, find the first row that actually has it:
  `rows.find(r => r.querySelector('[selector for the +N element]'))`. Numbering
  a row that doesn't have the thing produces a screenshot with a badge
  pointing at nothing.
- **Only number what's visible in this screenshot.** If step 5 of the prose
  happens on a different page, leave it text-only in the manual rather than
  forcing a badge onto an unrelated element here.
- Reuse the same `#b45309`-style circle look across every annotated
  screenshot in one manual — a document with three different badge styles
  reads as three different authors.

## Verification

`Read` every regenerated PNG before calling the work done — once each: note one
line per image in a `REVIEW.md` next to them (file, what it shows, ok / problem) so a later
pass re-opens only images whose capture changed. Badge/highlight
coordinates are computed blind against a live selector — a selector that
matches nothing just no-ops (see the `if (!rect) return`), so a wrong CSS
selector produces a screenshot that "succeeded" with a missing annotation,
not an error.

Also check that **no annotation covers another or hides the text it points at**: a
badge on top of the next badge, a callout over the button label, a spotlight dimming the
caption. Place each callout at a free side of its target (above, below, right, left —
first one that touches neither the target nor another callout) and keep callouts short;
when a row is too crowded, split it into two screenshots instead of stacking marks.

## See also

`hold-my-hand` (same plugin) builds a click-by-click HTML guide on top of these
captures; `brat-e2e` writes an automated test for a flow.
