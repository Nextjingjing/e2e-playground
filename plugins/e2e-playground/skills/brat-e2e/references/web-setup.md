# Web setup to copy (Playwright)

Read this before writing a real (`*.e2e.spec.*`) or mocked (`*.mocked.spec.*`) web test.
Adapt names and ports to the project; keep the safety checks.

## Throwaway database for the suite

A separate compose file, apart from the dev DB: own project name, own port on 127.0.0.1, a
database name ending in `_e2e`, data in tmpfs. Docker and Podman both run it
(`docker compose -f compose.e2e.yml up -d` / `podman compose -f …`): use whichever the
machine has and write that into the npm script.

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

## Guard: the suite refuses any other database

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

The reset script connects, checks `select current_database()` ends in `_e2e`, drops and
recreates the schema, then runs the app's own migrations (and seeds only what every test
needs, such as login users).

## Config: the app runs on the test DB

Playwright starts `webServer` **before** `globalSetup`, so reset in the server command (or
point `webServer.url` at a page that needs no tables). dotenv does not override a variable
that is already set, so the `env` below beats `.env`.

```js
// playwright.config.js
const { defineConfig } = require("@playwright/test");
const { testDatabaseUrl } = require("./e2e/test-db");
const DATABASE_URL = testDatabaseUrl();   // throws before anything starts on a wrong DB

module.exports = defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://localhost:3100", trace: "on-first-retry", timezoneId: "UTC" },
  webServer: {
    command: "node e2e/reset-db.js && node server.js",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    env: { DATABASE_URL, PORT: "3100" },
  },
});
```

After the first green run, prove the right DB was used: the test DB holds the rows the tests
created, and the dev DB is unchanged.

## A real test

```js
// Send to Sorting moves a waiting order to SORTING and books one stock movement. Real UI, API and test DB.
const { test, expect } = require("@playwright/test");

test("sends a waiting order to Sorting", async ({ page, request }) => {
  const code = `E2E-${test.info().workerIndex}-${Date.now()}`;           // unique: parallel-safe
  const order = await (await request.post("/api/orders", { data: { code, status: "WAITING" } })).json();

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

If the API can't create the starting state, use a factory/SQL helper in a fixture against the
test DB. Never insert the *result* rows by hand.

## A mocked test

For what the real run can't reach (here: a clock-driven counter). Catch-all route first,
specific routes after (later routes win). Record writes with `page.on("request")`, not inside
a route handler: a later, more specific route takes the request and the catch-all never sees it.

```js
// What the feature does, in one or two lines. Every API call is stubbed: this checks the UI only.
const { test, expect } = require("@playwright/test");
test.use({ timezoneId: "UTC" });

async function setup(page, rows) {
  const writes = [];
  page.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET") writes.push(`${r.method()} ${r.url()}`); });
  await page.clock.install({ time: new Date("2026-01-15T10:00:00Z") });
  await page.route("**/api/**", (route) => route.fulfill({ json: { success: true, data: [] } }));
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

Realistic stub payloads: record once with `routeFromHAR(..., { update: true })` against the
test backend and replay.

## Locators, naming, debugging

- `npx playwright codegen <url>` suggests resilient locators. Narrow with chaining and
  `.filter({ hasText })`: find the row first, then the button inside it.
- Copy the project's spec naming if it has one (e.g. `*.mocked.spec.js` vs `*.live.spec.js`);
  otherwise use `*.e2e.spec.*` for real and `*.mocked.spec.*` for stubbed.
- No Playwright yet: `npm init playwright@latest` (or add `@playwright/test`), after a yes.
- On a failure: `npx playwright show-trace test-results/<test>/trace.zip` before changing the
  test. Keep traces for debugging; screenshots as assertions are brittle across OS/browser
  versions, so use them only when the user asks for visual regression.
- Licences of the defaults: Playwright Apache-2.0, bats-core MIT, pywinauto BSD-3,
  Maestro CLI Apache-2.0.
- Testing Library's principle behind "test what the user sees": "The more your tests resemble
  the way your software is used, the more confidence they can give you."

## Clock

- Only need a fixed "now": `page.clock.setFixedTime(...)` (Playwright's first choice).
- Need timers to run: `page.clock.install({ time })`, then `fastForward("30:00")` (due timers
  fire once) or `runFor(...)` (fires every timer; slow over long spans).
- The fake clock is the browser's only; it does not speed up the backend.

## Secrets in tests and artifacts

Specs, fixtures and HAR files get committed; traces, videos and screenshots get uploaded by CI.
- Accounts from env vars / CI secrets (`process.env.E2E_USER`); `test.skip(!process.env.E2E_USER, ...)`.
- Fake tokens in stubs (`"test-token"`), never a real JWT or cookie.
- A HAR recorded against a server holds cookies and tokens: scrub `Authorization`, `Cookie`,
  `Set-Cookie` and tokens in URLs/bodies before committing.
- Gitignore `test-results/`, `playwright-report/`, `playwright/.auth/`; don't publish traces
  from runs with real accounts (a trace replays every typed password).

## CI

`npx playwright install chromium --with-deps`; the DB as a service container (or
Testcontainers) with the URL in CI secrets; run on every PR; lint with
`@typescript-eslint/no-floating-promises` to catch a missing `await`. Login reuse, tags,
sharding and flaky handling: `patterns.md`.

## Sources

- Playwright — Best Practices: https://playwright.dev/docs/best-practices
- Playwright — Locators (priority order): https://playwright.dev/docs/locators
- Playwright — Mock APIs (`route`, `fulfill`, HAR): https://playwright.dev/docs/mock
- Playwright — API testing (prepare server state, check postconditions): https://playwright.dev/docs/api-testing
- Playwright — Web server: https://playwright.dev/docs/test-webserver
- Playwright — Clock: https://playwright.dev/docs/clock
- Cypress — Best Practices (seed per test, no state through the UI, clean up before): https://docs.cypress.io/app/core-concepts/best-practices
- Kent C. Dodds — The Testing Trophy (E2E = as little mocking as possible): https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications
- Testing Library — Guiding Principles: https://testing-library.com/docs/guiding-principles
- Martin Fowler / Ham Vocke — The Practical Test Pyramid: https://martinfowler.com/articles/practical-test-pyramid.html
- bats-core: https://bats-core.readthedocs.io/en/stable/writing-tests.html
- pywinauto (UIA backend): https://pywinauto.readthedocs.io/en/latest/getting_started.html
- Maestro (Apache-2.0 CLI): https://github.com/mobile-dev-inc/maestro
- Playwright — Electron: https://playwright.dev/docs/api/class-electron
