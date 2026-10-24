---
name: brat-e2e
description: Write reliable automated end-to-end tests (Playwright for web/Electron, bats-core for CLIs, pywinauto for Windows desktop, Maestro for mobile, Playwright request/pytest for APIs) that run the real backend on a throwaway test database and don't flake. Use whenever the user asks to test a feature or flow automatically, "write e2e", "add a Playwright test", "test this CLI", "how do we make sure this keeps working", "ทำ e2e", "เขียนเทสต์ให้หน้านี้", or after building a feature that needs an automated check — even if they don't say which test tool to use.
---

# E2E tests that don't flake

## 1. Is E2E the right level?

Keep few E2E tests, on high-value journeys (what broke before, what money or stock depends
on); push edge-case logic to unit/integration tests. If most of the request is logic with no
UI, say so in one line and suggest the lower-level test; write E2E for the journey.

## 2. Pick the tool — open source by default

Unless the project already uses something else:

| surface | default |
|---|---|
| Web app, Electron | Playwright Test |
| Terminal / CLI | bats-core, or pytest + subprocess in Python projects |
| Windows desktop | pytest + pywinauto `uia` backend |
| Mobile | Maestro CLI (not Maestro Cloud, paid) |
| HTTP API | Playwright `request` fixture, or pytest + requests |

The rules below carry over to every surface; examples per surface: `references/surfaces.md`.
**Before writing a web test, read `references/web-setup.md`** (compose file, DB guard,
config, a real and a mocked example to copy). For login reuse, fixtures, page objects,
background jobs, stub contract drift, accessibility, tags, sharding, flaky CI: look the
situation up in `references/patterns.md`.

## 3. Learn the project before writing

- Existing E2E setup: `playwright.config.*`, test folder, naming, how specs log in. Copy it.
- No Playwright yet: propose adding `@playwright/test` and wait for a yes.
- What the feature calls, what the UI reads, what it writes (tables, rows, files, messages).
- How the backend and its DB start locally (compose service, e2e script, migrations, seed,
  Testcontainers). This decides section 4.

## 4. Real or stubbed? Decide per test

E2E = as little mocking as possible: the click goes through the real UI, API and a real
database. Stub only what you don't control or can't make happen on purpose.

| the test checks… | run it | file |
|---|---|---|
| the journey: happy path, rules the backend/DB enforces (status, stock rows, permissions, duplicates) | **real**: UI + API + test DB | `*.e2e.spec.*` |
| an error state: API 500, timeout, offline | stub that call | `*.mocked.spec.*` |
| data slow or hard to create (10 000 rows, a state after many steps) | stub the read | `*.mocked.spec.*` |
| a third-party service (payment, email, SMS, OAuth, someone else's API) | stub it or use its sandbox | either |
| UI-only logic (formatting, sorting, timers) | stub, or real if free | either |

- **Real first; stub only what the real run can't reach.** Never write the same happy path both ways.
- **Ask with a choice box if any of these is true**, even when you could start a test DB
  yourself: no way found to start the backend or DB; something missing here (Docker, VPN,
  licence); the configured DB (`.env`, config) is not local; the user asked for a database
  you won't use. AskUserQuestion in Claude Code, a short numbered question elsewhere. Offer exactly:
  1. start a separate throwaway test DB (e.g. `docker compose -f compose.e2e.yml up -d`, not the dev `db`), then real tests;
  2. mocked only (say what it won't prove);
  3. stop and set the environment up first.
  Never offer a shared or production DB. If backend and a local DB start fine, don't ask.
- **Mocked only**: say in the report it proves the UI against the API contract, not the
  backend, and name what would make it real.

**Database rules for real tests**
- Only a DB the tests own and can wipe: a container started for the tests, a CI service
  container, Testcontainers, or a DB/schema made for this run. Same engine and major version
  as production (no SQLite stand-in for Postgres).
- **Never production, a shared dev/staging DB, or one with real customer data**, even when
  `.env` points there and the user says it is faster. Tell them in one line: the tests write
  rows, would corrupt others' data, and would flake on their activity.
- A local dev DB is not throwaway either (the team's seeded data). Use a separate container
  with a database name ending in `_e2e`.
- The suite refuses by itself: non-local host → refuse; name not ending in `_e2e` → refuse;
  check `current_database()` again before resetting. Code: `references/web-setup.md`.
- Playwright starts `webServer` before `globalSetup`: reset/migrate in the server command.
- After the first green run, prove it: the test DB has the test rows, the dev DB is unchanged.

**Data in real tests**: create each test's data first through the API or a factory fixture
(never by clicking through other screens); unique keys per test
(`E2E-${test.info().workerIndex}-${Date.now()}`); reset before the run, not after. Assert in
the UI first; read back what the UI doesn't show via the API or a read-only query. Never
write result rows by hand to make a step "happen".

## 5. Rules for tests that don't flake

- **Test what the user sees**: rendered text, roles, visible state; not internals or CSS
  classes (unless the class *is* the requirement — comment why).
- **Locate like a user**: `getByRole` → `getByText` → `getByLabel` → `getByPlaceholder` →
  `getByAltText` → `getByTitle` → `getByTestId`; no CSS/XPath; narrow by chaining
  (row first, then its button).
- **Web-first assertions**: `await expect(locator).toBeVisible()` retries; never
  `expect(await locator.isVisible())`; no `waitForTimeout`.
- **Isolated**: each test makes its own data and state; passes alone, in any order, in parallel.
- **Mocked tests** record every non-GET request with `page.on("request")` and assert on it
  (what the UI sent, nothing else written).
- **Secrets**: accounts from env vars, fake tokens in stubs, scrub HAR files, never publish
  traces from real-account runs (details in `web-setup.md`).
- **Time**: fix "now" with `page.clock`, set `timezoneId`.
- **No page errors**: collect `page.on("pageerror")`, expect it empty.
- **No screenshot assertions** unless the user asks for visual regression.
- Name tests by behaviour, one behaviour each, and cover the negative case.

## 6. Run, then report honestly

1. Run the new spec: `npx playwright test path/to/spec --reporter=list`.
2. Not flaky: `--repeat-each=5` passes every time.
3. Each real test can fail: break what it guards for a moment (skip the insert, wrong
   status), see it red, restore with `git checkout -- <file>`, see it green. Report the break you tried.
4. On failure open the trace before touching the test. Fix the test only if the test is
   wrong; if the app is wrong, report it.
5. Report pass/fail counts, run time, and which tests ran real (on which test DB) vs mocked.

Sources for every rule: end of `references/web-setup.md`.
