// The default look: highlight colour picked away from the app's own colours, and cards that
// reveal long text a line at a time. Real Chromium; skipped when none is installed (point
// DEMO_TEST_PLAYWRIGHT_DIR at any project whose Playwright has its browser to run it).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const kit = require("../demo-kit.cjs");

const candidates = [path.resolve(__dirname, "../terminal"), process.env.DEMO_TEST_PLAYWRIGHT_DIR].filter(Boolean);
let projectDir = null;
for (const dir of candidates) {
  try {
    const { chromium } = require(require.resolve("playwright", { paths: [dir] }));
    const shell = chromium.executablePath().replace(/chromium-(\d+)[\\/]chrome-win64[\\/]chrome\.exe$/, "chromium_headless_shell-$1/chrome-headless-shell-win64/chrome-headless-shell.exe");
    if (fs.existsSync(chromium.executablePath()) || fs.existsSync(shell)) { projectDir = dir; break; }
  } catch {}
}
const skip = projectDir ? false : "no Playwright Chromium found (set DEMO_TEST_PLAYWRIGHT_DIR)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = brand => `<!doctype html><meta charset=utf-8><style>body{margin:0;font:16px sans-serif;background:#fff}
  header{background:${brand};color:#fff;padding:20px;font-size:22px} button{background:${brand};color:#fff;border:0;padding:12px 24px;margin:20px}
  main{padding:20px}</style><header>App</header><main><button id=go>Go</button><p id=t>Total 3/8</p></main>`;

async function session(t, html, theme) {
  const server = http.createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(html); }).listen(0);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo look "));
  const s = await kit.startSession({ projectDir, outDir, name: "look", baseURL: `http://127.0.0.1:${server.address().port}`, startUrl: "/", theme });
  t.after(async () => {
    await s.finish().catch(() => {});
    await s.browser.close().catch(() => {});
    server.close();
    fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  return s;
}

test("the highlight colour stays clear of the app's own colours, unless the case sets one", { skip, timeout: 120000 }, async t => {
  const orange = await session(t, app("#ea580c"));
  assert.equal(orange.accent, "#007AFF", "an orange app gets Apple blue");
  const blue = await session(t, app("#0a66c2"));
  assert.notEqual(blue.accent, "#007AFF", "a blue app must not get a blue highlight");
  assert.notEqual(blue.accent, "#5856D6", "indigo is too close to blue as well");
  const ring = blue.page.locator("#go");
  const h = blue.demo.highlight(ring, "Go", 600);
  await blue.page.locator(".__demo_hl").waitFor();
  const border = await blue.page.locator(".__demo_hl").evaluate(el => getComputedStyle(el).borderTopColor);
  const n = parseInt(blue.accent.slice(1), 16);
  assert.equal(border, `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`, "the ring is drawn in the picked colour");
  await h;
  const set = await session(t, app("#ea580c"), { accent: "#34C759" });
  assert.equal(set.accent, "#34C759");
  // a light accent gets dark label text, so the label stays readable
  const lab = set.demo.highlight(set.page.locator("#go"), "Go", 600);
  await set.page.locator(".__demo_hl_label").waitFor();
  assert.equal(await set.page.locator(".__demo_hl_label").evaluate(el => getComputedStyle(el).color), "rgb(17, 17, 17)");
  await lab;
});

test("a card reveals long text a line at a time, a page of three at a time", { skip, timeout: 120000 }, async t => {
  const s = await session(t, app("#ea580c"));
  const lines = ["one", "two", "three", "four"];
  const card = s.demo.card({ tag: "Case", title: "Long card", lines }, 4000);
  await s.page.locator("#__demo_card").waitFor();
  const shown = () => s.page.evaluate(() => [...document.querySelectorAll("#__demo_card p.in")].map(p => p.textContent));
  await sleep(300);
  assert.deepEqual(await shown(), [], "the title comes first, the lines later");
  const seen = new Set();
  for (let i = 0; i < 40; i++) { (await shown()).forEach(x => seen.add(x)); if (seen.has("four")) break; await sleep(100); }
  assert.deepEqual([...seen], lines, "every line is shown, in order");
  assert.deepEqual(await shown(), ["four"], "the first page has left when the fourth line arrives");
  await card;
});
