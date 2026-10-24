# E2E patterns worth knowing (Playwright)

Look a row up when the situation in the left column comes up. Each row says what to use and
the trap that catches people. Sources are at the end.

| situation | use | trap |
|---|---|---|
| every test logs in through the form; suite is slow | **setup project** logs in once per role, saves `storageState` to `playwright/.auth/<role>.json`; specs set `test.use({ storageState })`; keep one spec that uses the real form | `.auth/` holds live cookies: gitignore it, never commit or upload it |
| tests change the logged-in user's own data (settings, cart) | **one account per worker**: worker-scoped fixture keyed by `test.info().parallelIndex` | one shared account + parallel workers = tests overwrite each other |
| login form is slow but the app has a login API | log in with the `request` fixture, then `request.storageState({ path })` | still keep one test of the real form |
| setup + cleanup repeated across files | **fixture** (`test.extend`): code before `use()` is setup, after it is teardown | `beforeEach`/`afterEach` pairs copied into every file drift apart |
| something expensive shared by all tests in a worker (an account, a seeded tenant) | worker-scoped fixture `{ scope: "worker" }` | it lives for the whole worker: never put per-test state in it |
| many specs drive the same screen | **page object**: locators + actions in one class, assertions stay in the test | don't start with page objects for 2–3 specs; add them when duplication shows up |
| result appears later (background job, polling, websocket) | web-first assertion with a longer timeout: `await expect(row).toBeVisible({ timeout: 15_000 })` | no `waitForTimeout`; the fake clock doesn't speed up the backend |
| the thing to wait on is not on the page (API status, DB row) | `await expect.poll(() => fetchStatus(), { timeout: 15_000 }).toBe("DONE")` | — |
| a block of several checks must pass together, retried | `await expect(async () => { … }).toPass({ timeout: 15_000 })` | `toPass` has **timeout 0 by default** and ignores the expect timeout: always pass one |
| several independent checks on one screen | `expect.soft(...)` so one run reports all failures | the test still fails at the end; don't use it to hide failures |
| assertion failures are hard to read | message argument: `expect(badge, "cart shows the added item").toHaveText("1")` | — |
| long test is hard to follow in the report | `await test.step("send to sorting", async () => { … })` | — |
| a component's whole structure matters (menu, table headers, form) | `await expect(locator).toMatchAriaSnapshot('- heading "Orders"')` checks roles/names, not pixels; partial templates are fine; update with `-u` | order-sensitive; keep it to the part you care about |
| user asks for visual regression | `await expect(page).toHaveScreenshot()` with `mask: [dynamicLocators]`, run in the same OS/browser image every time (Docker) | baselines from a dev laptop fail on CI |
| accessibility check on a page | `@axe-core/playwright`: `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa"]).analyze()` → `violations` empty | finds only some WCAG issues; `exclude()` turns off **all** rules for that element; for known issues `disableRules([...])` with a ticket |
| stub of another team's/company's API | build stub bodies from the OpenAPI examples/schema, validate stubbed responses and the requests the UI sends (ajv / an OpenAPI validator) | a stub only proves your side; add a **contract check** against their sandbox or latest spec on a schedule (nightly), and treat a failure as a task to update stubs |
| two teams own client and API | consumer-driven contracts (e.g. Pact): the client's expectations run in the API's pipeline | — |
| quick PR feedback, full suite still runs | tag key journeys `{ tag: "@smoke" }`; PR: `--grep @smoke` (or `--only-changed=origin/main`); merge + nightly: everything | in PowerShell escape `|` in `--grep "@a|@b"` |
| suite too slow on one CI machine | `fullyParallel: true` + `--shard=1/4 … 4/4` in a matrix; `reporter: "blob"` on CI; a final job runs `npx playwright merge-reports --reporter html ./all-blob-reports` | without `fullyParallel` shards split by file and come out uneven |
| CI red, then green on re-run | `retries: 2` on CI only, `trace: "on-first-retry"`; Playwright marks those tests **flaky** in the report; reproduce with `--repeat-each=10`, read the trace, fix the cause | raising timeouts or retries to make it green hides a real race (often a missing `await`, shared data, or an unfixed clock) |
| test known broken, fix pending | `test.fixme()` (not run) with an issue link; `test.fail()` when it must keep failing until a bug is fixed | `test.skip()` without a reason is forgotten forever |
| tests depend on each other's order | make them independent (each creates its data) | `test.describe.configure({ mode: "serial" })`: one failure skips the rest and retries rerun the whole group |
| CI forgets `.only` | `forbidOnly: !!process.env.CI` | — |

## Sources

- Authentication (setup project, storageState, per-worker accounts): https://playwright.dev/docs/auth
- Fixtures (test vs worker scope, teardown after `use`): https://playwright.dev/docs/test-fixtures
- Page object models: https://playwright.dev/docs/pom
- Assertions (`expect.poll`, `toPass`, soft, messages): https://playwright.dev/docs/test-assertions
- ARIA snapshots: https://playwright.dev/docs/aria-snapshots
- Visual comparisons: https://playwright.dev/docs/test-snapshots
- Accessibility testing (axe): https://playwright.dev/docs/accessibility-testing
- Retries, flaky, serial mode: https://playwright.dev/docs/test-retries
- Sharding, blob reports, merge-reports: https://playwright.dev/docs/test-sharding
- Annotations and tags: https://playwright.dev/docs/test-annotations
- Martin Fowler — Contract Test: https://martinfowler.com/bliki/ContractTest.html
- Pact (consumer-driven contracts): https://docs.pact.io/
