---
name: hold-my-hand
description: Write a step-by-step "how to test / how to use" guide that someone can follow alone and get the same result on the first try — every step says where to go, exactly what to click (labels copied from the screen), what they should see, and shows a real annotated screenshot (outline + numbered badges matching the text). Screenshots come from the real app with the API stubbed and the clock fixed, captured by a script doing the very clicks the guide describes, so a wrong step fails the script, not the reader. Use whenever the user asks for test steps, a QA walkthrough, a user manual with pictures, onboarding steps, "show how to click through this", "write how to test this feature", or a click-by-click HTML page for a colleague — for web apps, terminal/CLI tools, Electron or Windows desktop apps, mobile apps or HTTP APIs, in any language (e.g. วิธีทดสอบ, คู่มือ, สอนกดยังไง). Not for screenshots alone or a Markdown manual (use paparazzi), a video (use show-and-tell) or an automated test (use brat-e2e).
---

> Web apps are the default path below. For a terminal/CLI tool, Electron, Windows desktop,
> mobile app or HTTP API, read `references/surfaces.md` for the open-source capture and test
> tool to use; the method stays the same.

# Followable guide

Write for the least experienced person who might pick this up: never seen the screen, not
technical, nobody to ask, easily lost. The guide is done when that person, following only
the page, reaches the same result on the first try. Everything below serves that: real
screens, exact words, one visible check per step, a capture script that proves each step is
clickable, and an HTML page the user reviews with you until it reads right.

## Writing so anyone can follow

- One action per line. "Click X, then Y" becomes two numbered actions.
- Say where on the screen before what to press: "top right", "in the row for order A-042",
  "the blue button under the table".
- Use the words printed on the screen, never internal names (no component, API or table
  names in the steps; those go in the troubleshooting table at most).
- No assumed knowledge: say how to open the page (full URL), which account to use, and
  what to do if a popup appears.
- After every step, a check the reader can see. If they don't see it, tell them what to try
  before moving on.
- Short sentences in the reader's language. Prefer pictures over paragraphs.

## 1. Find the real route before writing anything

Trace how the thing happens in production — which page, which button, which form field, which
API it calls. Read the code; don't guess from names.

- Prefer the pages real users use. Dev panels, seed buttons and "fake it" shortcuts are useful,
  but a guide built on them proves nothing about real use — readers rightly call that
  cheating. Use a dev tool only to stand in for something outside the system (an external
  booking service, a hardware scanner), and say that's why.
- Keep shortcuts, but in their own section, each mapped to the real step it replaces
  ("replaces step 2").
- Verify every claim in code before writing it as a warning. A "known bug" note that turns out
  false costs the reader's trust in every other step — open the component and confirm where
  its data really comes from.
- Point out where the system's real trigger differs from what people assume (e.g. "the start
  time is recorded when the first job *closes*, not on the first scan").

## 2. Plan the steps

One step = one place + one goal. Each step has:

| part | content |
|---|---|
| page tag | the page/URL; mark dev-only steps differently |
| **Do** | actions in order, each with its badge number ①②③ |
| **You should see** | a visible result on screen that proves the step worked — not "it saved" |
| picture | real screenshot with matching badges |
| result picture | when the result is visual, a screenshot of it too (see below) |
| shortcut (optional) | the dev shortcut that replaces this step |

**Show the result, not only the action.** When "you should see" is something on screen — a
badge appears, a row changes, a line disappears — add an "after" picture. Readers compare
pictures faster than they parse sentences, and "it disappeared" is hard to trust without
seeing what *should* be left. Use the same crop as the "do" picture so before/after line up,
outline the changed spot (no number — nothing to click), and put it in the result frame
(`figure.result` in the template). Skip it when the result is just a toast or a value already
visible in the next step's picture.

What makes steps followable:
- **Copy button and field labels exactly as rendered** — from the screenshot or the JSX text,
  including mixed-language UIs ("Update" when the button says Update, even in a Thai guide).
- **Say where the control is** when it isn't obvious ("in the Ticket column of the row").
- **Explain branches** the reader may hit ("if the ticket wasn't issued yet the button says
  … — pick a team first and the form opens by itself").
- **State the starting point**: role to log in as, URL including hashes like `#dev`, which
  servers must run.
- **End with cleanup** so test data doesn't pile up.
- Add a troubleshooting table: symptom → where to look (Network tab field names, timezone,
  refresh timing).
- Write in the reader's language, short sentences, no internal jargon they won't see on screen.

## 3. Capture screenshots that can't drift

Copy `scripts/capture-kit.mjs` next to your capture script and import its helpers:
`launch()`, `annotate(page, marks)` (outline + numbered badge; `pos: "left"` when the badge
would cover text), `clearMarks`, `around(page, locators, pad)` for a tight clip, and
`shot(page, outDir, name, clip)`. `assets/example-capture.mjs` shows a complete script.

- **Never point captures at a real database.** Stub every API call with Playwright
  `page.route`: catch-all first (`**/api/** → { success: true, data: [] }`), then specific
  endpoints. Keep a small `state` object and build responses from it, so the record moves
  through the flow between shots (not started → in progress → done). If the project already
  has mocked e2e tests, reuse their auth/localStorage setup.
- **Fix the clock** (`page.clock.install`, `timezoneId`) so times in the pictures are stable
  and match the text.
- **Perform the guide's clicks in the script** — open the form by clicking the button the guide
  names, with the same label (`getByRole("button", { name: "Update" })`). A label mistake in the
  guide then shows up as a script timeout before any reader sees it.
- Kill animations (the kit's `NO_MOTION` style) so shots never land mid-fade.
- Wide tables: use a wide viewport (~1680px) so the relevant column is in frame; clip to the
  header plus the row.
- **No credentials or personal data in pictures, steps or files.** Stub data uses made-up
  names and ids ("Demo User", "A-042"). The kit's `launch()` also covers emails, tokens/API
  keys, password fields, `password=…` text, URL credentials, ID/phone/card numbers and long
  ids with solid bars (`scripts/redact.cjs`, copy it next to `capture-kit.mjs`) in case real
  data slips in; add expected names with `launch({ redact: { text: [...] } })`. A step that
  says which account to use names it ("the QA account") and where its password lives, never
  the password itself.

**Open every PNG before publishing.** A selector that matches the wrong element still
"succeeds". Check the badge sits on the right element, nothing important is clipped, and the
numbers match the text. Look at each picture **once**: write one line per image in
`<guide>/REVIEW.md` (file, what it shows, ok / what is wrong). A later round or session
re-opens only the images whose capture changed since that line, never the whole set.
Sizes, text length and contrast for the page: see the human-yardstick skill.

## 4. Build the page

Start from `assets/guide-template.html` (color tokens with light/dark, step cards, badge
style `.n`, screenshot containers). Fill: title, lead (what's being tested, and that dev tools
only stand in for X), the rules under test, steps, shortcuts table, troubleshooting table,
automated test commands if any.

- Near the top, say the pictures are from the real app with simulated data and a fixed clock,
  and that outlines and numbers are guide marks, not UI.
- Give every `<img>` its file's real width/height.
- Wide screenshots go in `.shot` (scrolls sideways on phones); full-screen modal shots in
  `.shot.fit`.

The template uses **Sarabun** (a widely used, easy-to-read face whose Thai letters keep their
traditional loops) with **JetBrains Mono** for code. Keep plain, readable faces — fancy or
loopless display fonts slow readers down, especially in Thai.

Deliver as a single HTML page — published where the user can open it (an artifact if your
environment has one, otherwise an `.html` file you open in their browser). If Markdown/PDF
is wanted as well, keep the same structure in `.md`.

## 5. Review loop with the user

Treat the first page as a draft. Show it, then ask the user to go through it — ideally
clicking along in the real app — and tell you anything that was unclear, wrong, or missing.

1. Publish/open the page and name what to look at ("check step 3's picture matches what you
   see").
2. Take their comments (chat, or page comments if your environment supports them).
3. Fix the guide **and** the capture script together, re-run the script, re-check pictures.
4. Republish to the same place so the link stays the same.
5. Repeat until they say it's good. Note what changed each round in one line.

Feedback like "I couldn't find the button" means the step needs a location hint or a
picture, not just a reworded sentence.

## 6. Before saying it's done

- [ ] Every step's actions were executed by the capture script against the real app
- [ ] Every label in the text matches the screen character for character
- [ ] Every step has a visible "you should see", with a result picture where the change is visual
- [ ] Every picture opened and checked
- [ ] Shortcuts separated and mapped to real steps
- [ ] Warnings verified in code
- [ ] No real database touched; any temporary users/data cleaned up or reported

- [ ] The user reviewed the page and their comments are resolved

Related skills in this plugin: `paparazzi` (capture details, Playwright + open-source
Chromium by default), `show-and-tell` (a video of it working on the real system) and
`brat-e2e` (an automated test that keeps it working).

Tell the user what the guide could not show (e.g. a step that needs real stock or hardware)
instead of leaving a silent gap.
