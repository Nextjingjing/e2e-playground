const { test, expect } = require("@playwright/test");
test("send to sorting works", async ({ page }) => {
  await page.goto("/forklift");
  await page.locator("table tr:first-child button").click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Sorting");
});
