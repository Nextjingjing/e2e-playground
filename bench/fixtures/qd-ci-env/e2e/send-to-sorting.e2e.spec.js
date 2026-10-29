// Real UI + API + wms_e2e DB. The only browser test for the forklift -> sorting stock journey.
const { test, expect } = require("@playwright/test");
const { createWaitingOrder, movementsFor, statusOf } = require("./db");
test("sending a waiting order to sorting moves it and records one stock movement", async ({ page }) => {
  const order = await createWaitingOrder();
  await page.goto("/forklift");
  await page.getByRole("row", { name: order.code }).getByRole("button", { name: "Send to Sorting" }).click();
  await expect(page.getByRole("status")).toHaveText(`Done: ${order.code} sent to Sorting`);
  expect(await statusOf(order.id)).toBe("SORTING");
  expect(await movementsFor(order.id)).toEqual([{ from: "FORKLIFT", to: "SORTING" }]);
});
