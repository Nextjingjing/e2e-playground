---
name: brat-e2e
description: Write reliable automated end-to-end tests with open-source tools by default (Playwright for web and Electron, bats-core for CLIs, pywinauto for Windows desktop, Maestro CLI for mobile, Playwright request / pytest for HTTP APIs), following Playwright's official best practices — user-facing locators, web-first assertions, isolated tests, the real backend on a throwaway test database where it can run (stubs only for what you can't control), controlled clock — so they don't flake. Use whenever the user asks to test a feature or flow automatically, "write e2e", "add a Playwright test", "test this CLI", "how do we make sure this keeps working", "ทำ e2e", "เขียนเทสต์ให้หน้านี้", or after building a feature that needs an automated check — even if they don't say which test tool to use.
---

# E2E tests that don't flake

## 1. Is E2E the right level?

End-to-end tests give the most confidence but are slow, flaky-prone and costly to maintain,
so a suite should keep only a few of them, aimed at high-value user journeys (the flow that
has broken before, the one money or stock depends on), and push detailed edge cases down to
unit/integration tests (Fowler, *The Practical Test Pyramid*). If most of what the user wants
checked is logic with no UI, say so in one line and suggest the unit/integration test next to
it; write the E2E test for the journey itself.

## 2. Pick the tool — open source by default

Use the open-source default for the surface unless the user or the project already uses
something else:

| surface | default |
|---|---|
| Web app, Electron | Playwright Test (Apache-2.0) |
| Terminal / CLI | bats-core (MIT), or pytest + subprocess in Python projects |
| Windows desktop (native) | pytest + pywinauto `uia` backend (BSD-3) |
| Mobile | Maestro CLI flows (Apache-2.0); not Maestro Cloud (paid) |
| HTTP API | Playwright `request` fixture or pytest + requests |

Examples for each are in `references/surfaces.md`. Login reuse, fixtures, page objects,
waiting on background work, contract drift of stubs, accessibility, tags, sharding and flaky
tests on CI: look the situation up in `references/patterns.md`. The rules in sections 4–5
were written for Playwright but carry over: find things the way a user would (visible text,
control titles), wait for conditions instead of sleeping, isolate each test, run the real
stack on a test database you own (never production or a shared one), stub only what you don't
control, and fix the clock. The rest of this file uses web examples.

## 3. Learn the project before writing

- Find the existing E2E setup: `playwright.config.*`, test folder, naming (e.g.
  `*.mocked.spec.js` vs `*.live.spec.js`), how other specs fake login. Copy their patterns.
- If there is no Playwright yet, propose `npm init playwright@latest` (or adding
  `@playwright/test`) and wait for a yes before changing dependencies.
- Find how the feature really works in code: which API calls it makes, what fields the UI
  reads, and what it writes (tables, rows, files, messages).
- Find how the backend and its database start locally: a `docker-compose.yml` DB service,
  a `test`/`e2e` env or script, migrations and seed commands, Testcontainers in other tests.
  This decides section 4.

## 4. Real or stubbed? Decide per test

E2E means "as little mocking as possible": the user's click goes through the real frontend,
the real API and a real database. Stub the parts you don't control or can't make happen on
purpose. Pick for each test:

| the test checks… | run it | file |
|---|---|---|
| the journey works: happy path, rules the backend or DB enforces (status changes, stock rows, permissions, duplicates) | **real**: UI + API + test DB | `*.e2e.spec.*` |
| an error state: API 500, timeout, offline (`route.abort()`) | stub that one call | `*.mocked.spec.*` |
| data that is slow or hard to create (10 000 rows, a state reached after many steps) | stub the read | `*.mocked.spec.*` |
| a third-party service: payment, email, SMS, OAuth, someone else's API | stub it (or its sandbox) | either |
| UI-only logic: formatting, sorting, timers | stub, or real if it is free | either |

- **Real first; add a stub only for what the real run can't reach.** Don't write the same
  happy path both ways. A mocked copy of a passing real test adds upkeep and no proof.
- **Ask with a choice box when the real run is in doubt.** Ask when any of these hold: you
  found no way to start the backend or its database, starting it needs something missing
  here (Docker not installed, a VPN, a licence), or the configured database is not local
  (`.env` / config points at another host). Use AskUserQuestion in Claude Code; in other tools,
  a short numbered question. Offer exactly:
  1. start a throwaway test DB (name the command, e.g. `docker compose -f compose.e2e.yml up -d`), then real tests;
  2. mocked only (say what it won't prove);
  3. stop and set the environment up first.
  Never offer the shared or production database as a choice. When the backend and a local DB
  start without trouble, don't ask: write the real tests.
- **Mocked only** (the user picked it, or nothing can run here): write `*.mocked.spec.*` and
  state in the report that it proves the UI against the recorded API contract, not that the
  backend works. Name what would make it real.

**Which database a real test may use.** Only a database the tests own and can wipe: a
container started for the tests, a CI service container, Testcontainers, or a database or
schema created for this run. Use the same engine and major version as production (not SQLite
or an in-memory stand-in for Postgres). A local dev database is **not** throwaway: the
team's seeded data lives there, even on localhost.

Give the tests their own container, apart from the dev one: a separate compose file with its
own project name, its own port bound to 127.0.0.1, a database name ending in `_e2e`, and data
in tmpfs so it vanishes on stop. Docker and Podman both run it (`docker compose -f …` /
`podman compose -f …`): use whichever the machine has, and say which in the npm script.

```yaml
# compose.e2e.yml: throwaway DB for the e2e suite only
name: app-e2e
services:
  db:
    image: postgres:16            # same major as production
    environment: { POSTGRES_PASSWORD: e2e, POSTGRES_DB: app_e2e }
    ports: ["127.0.0.1:55432:5432"]
    tmpfs: [/var/lib/postgresql/data]
```

**Never production, a shared dev or staging database, or one with real customer data.** This
holds even when `.env` already points there and the user says it is faster. Tell them why in
one line: the tests write rows, would corrupt other people's data, and would flake on their
activity. Then start the throwaway one. Make the suite refuse by itself:

```js
// e2e/test-db.js: called from playwright.config.js, so a wrong URL stops the run before anything starts
function testDatabaseUrl() {
  const raw = process.env.E2E_DATABASE_URL || "postgres://postgres:e2e@127.0.0.1:55432/app_e2e";
  const url = new URL(raw), db = url.pathname.slice(1);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname))
    throw new Error(`E2E refuses database host "${url.hostname}": only a local throwaway DB`);
  if (!/_e2e$/.test(db))   // a local dev DB passes the host check, so the name must mark it as a test DB
    throw new Error(`E2E refuses database "${db}": the name must end in _e2e`);
  return raw;
}
module.exports = { testDatabaseUrl };
```

Before resetting (in global setup or the reset script), connect and check
`select current_database()` ends in `_e2e` too, then reset and run the app's own migrations.

Start the backend with `webServer` in `playwright.config` and pass it
`env: { DATABASE_URL: testDatabaseUrl() }` (dotenv does not override a variable that is
already set, so `.env` loses). **Playwright starts `webServer` before `globalSetup`**: if the
reset runs in global setup, point `webServer.url` at a page that needs no tables, or reset
and migrate in the `webServer.command` itself (`node e2e/reset-db.js && node server.js`).

After the first green run, prove the right database was used: the test DB holds the rows the
tests created, and the dev DB is unchanged.

**Data in a real test.**
- Create what each test needs before it runs, through the API (`request` fixture) or a
  factory/SQL helper in a fixture. Never build state by clicking through other screens.
- Give every row a unique key (`E2E-${test.info().workerIndex}-${Date.now()}`), so tests
  run in parallel and can't see each other's data.
- Reset the database before the run (migrate/reset in global setup), not after it: a failed
  run then leaves its data to look at.
- Assert through the UI first. For results the UI doesn't show (a stock movement row, an
  audit entry), read them back through the API or a read-only query. Never write rows by hand
  to make a step "happen": the test must drive the app.

## 5. Rules for tests that don't flake

Each rule follows Playwright's official guidance (links in *Sources*).

**Test what the user sees.** Assert on rendered text, roles and visible state, not on
function names, internal arrays or CSS classes. A class check is acceptable only when the
class *is* the requirement (e.g. "the text must be red") — say so in a comment.

**Locate like a user.** Prefer, in order: `getByRole` → `getByText` → `getByLabel` →
`getByPlaceholder` → `getByAltText` → `getByTitle` → `getByTestId`. Avoid CSS/XPath; the DOM
changes. Narrow with chaining and `.filter({ hasText })`, e.g. find the row first, then the
button inside it. `npx playwright codegen <url>` suggests resilient locators.

**Use web-first assertions.** `await expect(locator).toBeVisible()` / `toHaveText()` retry
until the timeout. Never `expect(await locator.isVisible()).toBe(true)` — it checks once and
races the page. No fixed `waitForTimeout` sleeps.

**Keep every test isolated.** Each test sets up its own data and state (`beforeEach`, or a
setup function per test), so tests pass alone, in any order, and in parallel.

**Control data and the network.** Real tests own their data (section 4). In a mocked test,
stub with `page.route()` + `route.fulfill({ json })`; register a catch-all first and specific
routes after (later routes win). For realistic payloads, record once with
`routeFromHAR(..., { update: true })` against the test backend and replay. Record every
non-GET request in the stub and assert on it — that proves what the UI *sent*, and that
nothing else was written.

**Keep secrets out of tests and their artifacts.** Specs, fixtures and HAR files get
committed; traces, videos and failure screenshots get uploaded by CI.
- Test accounts come from environment variables / CI secrets (`process.env.E2E_USER`), never
  from the spec; `test.skip(!process.env.E2E_USER, ...)` for live suites.
- Stub auth with fake tokens (`"test-token"`); never paste a real JWT or cookie into a fixture.
- A HAR recorded against a real server holds real cookies and tokens: scrub it
  (`Authorization`, `Cookie`, `Set-Cookie`, tokens in URLs and bodies) before committing,
  or record it against a stub.
- Ignore `test-results/` and `playwright-report/` in git, and don't publish traces from runs
  that used real accounts — a trace replays every typed password.

**Control time.** If the screen shows times or counts down:
- only need a fixed "now" → `page.clock.setFixedTime(...)` (Playwright's recommended first
  choice);
- need timers to run → `page.clock.install({ time })`, then `fastForward("30:00")` to jump
  (due timers fire once) or `runFor(...)` for step-by-step ticking (fires every timer — slow
  over long spans);
- set `timezoneId` in `test.use` so dates render the same on every machine and CI.

**Assert there are no page errors.** Collect `page.on("pageerror")` and expect it empty at
the end.

**No screenshots as assertions** unless the user asks for visual regression; they're brittle
across OS/browser versions. Keep traces for debugging instead.

## 6. Shape of a test file

A real test (`*.e2e.spec.js`): the app runs against the test DB through `webServer`.

```js
// Send to Sorting moves a waiting order to SORTING and books one stock movement. Real UI, API and test DB.
const { test, expect } = require("@playwright/test");

test("sends a waiting order to Sorting", async ({ page, request }) => {
  const code = `E2E-${test.info().workerIndex}-${Date.now()}`;
  const res = await request.post("/api/orders", { data: { code, status: "WAITING" } }); // or a DB factory fixture
  const order = await res.json();

  await page.goto("/forklift");
  const row = page.getByRole("row", { name: new RegExp(code) });
  await row.getByRole("button", { name: "Send to Sorting" }).click();
  await expect(page.getByText("Done")).toBeVisible();
  await expect(row).toHaveCount(0);

  const after = await (await request.get(`/api/orders/${order.id}`)).json(); // what the screen doesn't show
  expect(after.status).toBe("SORTING");
  expect(after.stockMovements).toHaveLength(1);
});
```

A mocked test (`*.mocked.spec.js`) for what the real run can't reach, here a clock-driven
counter:

```js
// What the feature does, in one or two lines. Every API call is stubbed: this checks the UI only.
const { test, expect } = require("@playwright/test");

test.use({ timezoneId: "UTC" });

async function setup(page, rows) {
  const writes = [];
  await page.clock.install({ time: new Date("2026-01-15T10:00:00Z") });
  await page.route("**/api/**", (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().url());
    return route.fulfill({ json: { success: true, data: [] } });
  });
  await page.route("**/api/orders?**", (route) => route.fulfill({ json: { success: true, data: rows } }));
  return writes;
}

test("shows how long an order has waited and keeps counting", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const writes = await setup(page, [{ id: 1, code: "A-001", picked_at: "2026-01-15T09:20:00Z" }]);
  await page.goto("/orders");

  const row = page.getByRole("row", { name: /A-001/ });
  await expect(row.getByText(/^Waiting /)).toHaveText("Waiting 40 min");

  await page.clock.fastForward("30:00");
  await expect(row.getByText(/^Waiting /)).toHaveText("Waiting 1 h 10 min");

  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
```

Name tests by behaviour ("hides the wait once loading starts"), one behaviour per test, and
cover the negative cases (when the thing must *not* show) alongside the happy path.

## 7. Run, then report honestly

- Run only the new spec first: `npx playwright test path/to/spec --reporter=list`.
- Check it isn't flaky: `--repeat-each=5` on the new specs must pass every time.
- Prove each real test can fail: break the behaviour it guards for a moment (skip the row
  insert, return the wrong status), run it, see it go red, then restore the code with
  `git checkout -- <file>` and see it green again. A test that stays green against broken code
  proves nothing. Say in the report which break you tried.
- If something fails, open the trace (`npx playwright show-trace ...`) before changing the
  test. Fix the test only when the test is wrong; if the app is wrong, report it.
- Report pass/fail counts and run time, and which tests ran real (and on which test DB)
  vs mocked. If a long `runFor` makes a test slow, switch to `fastForward`.
- For CI with real tests: run the DB as a service container (or Testcontainers), migrate in
  global setup, and keep the database URL in CI secrets.
- For CI: `npx playwright install chromium --with-deps`, `trace: "on-first-retry"`, run on
  every PR. Lint with `@typescript-eslint/no-floating-promises` to catch missing `await`.

## Sources

- Playwright — Best Practices: https://playwright.dev/docs/best-practices
- Playwright — Locators (priority order): https://playwright.dev/docs/locators
- Playwright — Mock APIs (`route`, `fulfill`, HAR): https://playwright.dev/docs/mock
- Playwright — API testing (prepare server state, check postconditions via API):
  https://playwright.dev/docs/api-testing
- Playwright — Web server (start the backend for tests): https://playwright.dev/docs/test-webserver
- Cypress — Best Practices (seed the DB per test, don't build state through the UI, clean up
  before tests): https://docs.cypress.io/app/core-concepts/best-practices
- Kent C. Dodds — The Testing Trophy (E2E = "as little as possible" mocking):
  https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
- Playwright — Clock: https://playwright.dev/docs/clock
- Testing Library — Guiding Principles ("The more your tests resemble the way your software
  is used, the more confidence they can give you."): https://testing-library.com/docs/guiding-principles
- Martin Fowler / Ham Vocke — The Practical Test Pyramid:
  https://martinfowler.com/articles/practical-test-pyramid.html
- bats-core — Writing tests (`run`, `$status`, `$output`): https://bats-core.readthedocs.io/en/stable/writing-tests.html
- pywinauto — Getting started (UIA backend): https://pywinauto.readthedocs.io/en/latest/getting_started.html
- Maestro (Apache-2.0 CLI): https://github.com/mobile-dev-inc/maestro
- Playwright — Electron (experimental): https://playwright.dev/docs/api/class-electron
