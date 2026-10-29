// Mocked: the Atlas API can't run here. Stubs written by hand from what Orders.jsx reads.
const { test, expect } = require("@playwright/test");
test("shows how long an order has been waiting", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-01T10:40:00Z"));
  await page.route("**/orders", r => r.fulfill({ json: [{ id: 1, code: "ORD-1", pickedAt: "2026-10-01T10:00:00Z" }] }));
  await page.goto("/");
  await expect(page.getByRole("row", { name: /ORD-1/ })).toContainText("Waiting 40 min");
});
