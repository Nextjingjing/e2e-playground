// Copy next to your app; replace only the facts/actions. Paths are relative to THIS file.
// node <skill>/scripts/run-case.cjs ./case.cjs --storyboard   # preview scenes + length, no browser/data
// node <skill>/scripts/run-case.cjs ./case.cjs --setup-only   # rehearse setup, no take used
// node <skill>/scripts/run-case.cjs ./case.cjs                # background, then:
// node <skill>/scripts/watch-case.cjs <output .mp4>            # watcher: STEP lines, exits on DONE/FAIL/DEAD
// Takes on one machine run one at a time (QUEUE lines while waiting). A take with no progress
// line or kit call for stallSeconds (default 300) stops itself, e.g. when stuck on a DB lock.
module.exports = {
  projectDir: ".", // folder containing node_modules/playwright or @playwright/test
  baseURL: "http://127.0.0.1:3000",
  startUrl: "/forklift",
  output: "demo-out/send-to-sorting.mp4",
  title: { tag: "Demo", title: "Send to Sorting", lines: ["One order moves out of the waiting queue"] },
  // music: "cozy" by default (warm lo-fi); "calm" = no drums, false = none. Ask only if the user wants other music.
  // clickSound: false drops the soft click at every real click (on by default). Both need numpy.
  // theme: { accent: "#AF52DE" }, // only if the user asks; by default the colour is picked to stand out from the app
  redact: { selectors: [".user-badge"] }, // add names/identifiers from environment, never literals

  // Optional setup({ log }): prepare fresh test data off camera through supported app facilities.
  // Call log("queue X ready") after each step and check each UI value really stuck (polling pages reset forms).
  // Close any browser it opens (the runner exits anyway, but leaks hide the real error).
  // Shared data: record the backup path in a comment, without credentials. Never restore automatically.
  // Optional login(page): use process.env.DEMO_USER and process.env.DEMO_PASSWORD off camera.

  async run({ page, demo }) {
    // Use labels/locators already verified during a small scout. Never call the app API here.
    const order = page.getByRole("row").filter({ hasText: "A-001" }); // synthetic test identifier
    await demo.caption("The order is waiting to move");
    await demo.highlight(order, "Waiting order", 3000);
    await demo.click(order.getByRole("button", { name: "Send to Sorting" }), { slow: true });
    await demo.waitApp(() => order.waitFor({ state: "hidden" }), "save order");
    await demo.caption("The order has left the waiting queue");
    await demo.highlight(page.getByRole("status"), "Order moved", 3500);
  },

  // For a DB-backed claim, add async verify(): query the real DB read-only and return true
  // only for the expected status AND movement. Throw/return false to stop before editing.
  // Without verify(), the runner reports not-configured: check the real outcome manually.
};
