// Example capture script for a followable guide. The app is imaginary ("Orders" page with an
// edit form and a "Waiting" badge) — adapt routes, labels and payloads to yours.
// Shows the three habits that keep a guide honest:
//   1. every /api call is stubbed from a small `state` (no real database)
//   2. the clock is fixed, so times in the pictures match the text
//   3. the script clicks exactly what the guide tells the reader to click
//
//   node example-capture.mjs http://localhost:3000
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, annotate, clearMarks, around, shot, NO_MOTION } from "./capture-kit.mjs";

const BASE = process.argv[2] || "http://localhost:3000";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "img");

// The record moves through the flow between shots.
const state = { pickedAt: null, startedAt: null };
const order = () => ({
  id: 42, code: "A-042", customer: "Demo Co.",
  picked_at: state.pickedAt, started_at: state.startedAt,
});

const { browser, page } = await launch({
  appPackageJson: "/path/to/your-app/package.json",
  time: "2026-01-15T10:00:00Z",
});

// Catch-all first, specific routes after (later routes win).
await page.route("**/api/**", (r) => r.fulfill({ json: { success: true, data: [] } }));
await page.route("**/api/session", (r) => r.fulfill({ json: { user: "demo", role: "admin" } }));
await page.route("**/api/orders?**", (r) => r.fulfill({ json: { success: true, data: [order()] } }));
await page.route("**/api/orders/42", async (r) => {
  if (r.request().method() === "PATCH") Object.assign(state, mapPatch(r.request().postDataJSON()));
  await r.fulfill({ json: { success: true, data: order() } });
});
const mapPatch = (body) => ({ pickedAt: body.picked_at ?? state.pickedAt, startedAt: body.started_at ?? state.startedAt });

const openOrders = async () => {
  await page.goto(`${BASE}/orders`);
  await page.addStyleTag({ content: NO_MOTION });
  await page.getByRole("row", { name: /A-042/ }).waitFor();
};
const row = () => page.getByRole("row", { name: /A-042/ });

// Step 1 — open the edit form (same label the guide uses).
await openOrders();
const edit = row().getByRole("button", { name: "Edit", exact: true });
await annotate(page, [{ el: edit, n: 1 }]);
await shot(page, OUT, "01-open-edit", await around(page, [page.locator("thead"), row()], 4));
await clearMarks(page);

// Step 2 — type the pick time and save. If the guide says "Update" but the button says
// "Save", this line times out: fix the guide, not the script.
await edit.click();
const picked = page.getByLabel("Picked at");
await picked.fill("08:45");
const save = page.getByRole("button", { name: "Update", exact: true });
await annotate(page, [{ el: picked, n: 1 }, { el: save, n: 2 }]);
await shot(page, OUT, "02-pick-time"); // full viewport for a modal
await clearMarks(page);
await save.click();

// Step 2's result picture — same crop as step 1 so before/after line up. Outline only:
// there is nothing to click, so no number. (State was changed by the stubbed PATCH.)
await openOrders();
const waiting = row().getByText(/^Waiting /);
await annotate(page, [{ el: waiting }]);
await shot(page, OUT, "02-pick-time-after", await around(page, [page.locator("thead"), row()], 4));
// When a badge would cover small text, use { el, n, pos: "left" }.

await browser.close();
// Next: open every PNG and check each badge sits on the element the text names.
