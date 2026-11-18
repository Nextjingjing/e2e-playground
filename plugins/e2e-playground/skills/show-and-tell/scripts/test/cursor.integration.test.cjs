// Real browser: the drawn cursor must not sit on what the viewer is meant to look at.
// Skipped when no Playwright Chromium is installed; point DEMO_TEST_PLAYWRIGHT_DIR at any
// project whose Playwright has its browser to run it.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const candidates = [path.resolve(__dirname, "../terminal"), process.env.DEMO_TEST_PLAYWRIGHT_DIR].filter(Boolean);
let projectDir = null;
for (const dir of candidates) {
  try {
    const { chromium } = require(require.resolve("playwright", { paths: [dir] }));
    const shell = chromium.executablePath().replace(/chromium-(\d+)[\\/]chrome-win64[\\/]chrome\.exe$/, "chromium_headless_shell-$1/chrome-headless-shell-win64/chrome-headless-shell.exe");
    if (fs.existsSync(chromium.executablePath()) || fs.existsSync(shell)) { projectDir = dir; break; }
  } catch {}
}

const first = `<!doctype html><meta charset=utf-8>
<style>body{font:16px sans-serif;margin:40px} button{font:16px sans-serif;padding:10px 24px;margin:20px}</style>
<button id=save onclick="st.textContent='Saved OK'">Save</button>
<button id=other>Other</button>
<p id=st>Status idle</p>
<a id=next href="/next">Next page</a>`;
const second = `<!doctype html><meta charset=utf-8><p id=hello>Second page</p>`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("the cursor points with its tip, fades after a click, and hides under a highlight", {
  skip: projectDir ? false : "no Playwright Chromium found (set DEMO_TEST_PLAYWRIGHT_DIR)",
  timeout: 120000,
}, async t => {
  const kit = require("../demo-kit.cjs");
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(req.url.startsWith("/next") ? second : first);
  }).listen(0);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo cursor "));
  const s = await kit.startSession({ projectDir, outDir, name: "cursor",
    baseURL: `http://127.0.0.1:${server.address().port}`, startUrl: "/" });
  t.after(async () => {
    await s.finish().catch(() => {});
    await s.browser.close().catch(() => {});
    server.close();
    fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const { page: p, demo } = s;
  const cursor = () => p.evaluate(() => {
    const c = document.getElementById("__demo_cursor");
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, cls: [...c.classList].sort().join(" "), opacity: Number(getComputedStyle(c).opacity), arrow: !!c.querySelector("svg path") };
  });

  // The tip is the click point (an arrow), so the label next to it stays readable;
  // once the click is done the cursor fades so the result under it shows.
  const save = await p.locator("#save").boundingBox();
  await demo.click(p.locator("#save"));
  await sleep(400);
  let c = await cursor();
  assert.ok(c.arrow, "cursor is drawn as an arrow");
  assert.ok(Math.abs(c.x - (save.x + save.width / 2)) < 2 && Math.abs(c.y - (save.y + save.height / 2)) < 2,
    `tip at (${c.x},${c.y}) must be the click point`);
  assert.match(c.cls, /\brest\b/);
  assert.ok(c.opacity < 0.5, `faded after the click, opacity ${c.opacity}`);

  // Moving again brings it back.
  await demo.hover(p.locator("#other"), 400);
  c = await cursor();
  assert.doesNotMatch(c.cls, /\b(rest|away)\b/);
  assert.equal(c.opacity, 1);

  // highlightText points at the end of the text, then the cursor gets out of the frame.
  const hl = demo.highlightText("Saved OK", "done", 1500);
  await p.locator(".__demo_hl_label", { hasText: "done" }).waitFor();
  await sleep(400);
  const text = await p.evaluate(() => { const r = document.createRange(); r.selectNodeContents(st); const b = r.getBoundingClientRect(); return { right: b.right, mid: b.top + b.height / 2 }; });
  c = await cursor();
  assert.ok(Math.abs(c.x - text.right) < 6 && Math.abs(c.y - text.mid) < 4, `pointer at (${c.x},${c.y}), text ends at (${text.right},${text.mid})`);
  assert.match(c.cls, /\baway\b/);
  assert.equal(c.opacity, 0);
  await hl;

  // The click's own highlight keeps the cursor: the viewer must see what is about to be pressed.
  const click = demo.click(p.locator("#other"), { highlight: "next" });
  await p.locator(".__demo_hl_label", { hasText: "next" }).waitFor();
  await sleep(400);
  c = await cursor();
  assert.doesNotMatch(c.cls, /\b(rest|away)\b/);
  assert.equal(c.opacity, 1);
  await click;

  // A click that loads a new page: the cursor stays faint there too.
  await demo.click(p.locator("#next"));
  await p.locator("#hello").waitFor();
  await sleep(700);
  c = await cursor();
  assert.match(c.cls, /\brest\b/);
});
