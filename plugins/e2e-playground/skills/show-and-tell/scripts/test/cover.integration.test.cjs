// Real browser: highlights and clicks must never land on something hidden behind a modal,
// a backdrop or a toast. Skipped when no Playwright Chromium is installed; point
// DEMO_TEST_PLAYWRIGHT_DIR at any project whose Playwright has its browser to run it.
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

const page = `<!doctype html><meta charset=utf-8>
<style>
  body{font:16px sans-serif;margin:20px}
  #backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
  #dialog{background:#fff;padding:24px;width:320px}
  #toast{position:fixed;left:10px;top:10px;width:420px;height:120px;background:#333;color:#fff}
  .fade{transition:opacity .8s;opacity:0}
</style>
<p id=total>Total 0/7</p>
<button id=save onclick="log.textContent+='S;'">Save</button>
<div id=log></div>
<div id=backdrop><div id=dialog role=dialog>
  <p id=inner>Total 0/7 in dialog</p>
  <button id=close>Close</button>
</div></div>
<script>
  const params = new URLSearchParams(location.search);
  if (params.has("nomodal")) document.getElementById("backdrop").remove();
  if (params.has("closing")) setTimeout(() => {
    const b = document.getElementById("backdrop"); b.classList.add("fade"); setTimeout(() => b.remove(), 800);
  }, 300);
  if (params.has("toast")) {
    const t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t);
    setTimeout(() => t.remove(), 1200);
  }
</script>`;

test("highlight and click refuse targets hidden behind a modal, and wait for one that is closing", {
  skip: projectDir ? false : "no Playwright Chromium found (set DEMO_TEST_PLAYWRIGHT_DIR)",
  timeout: 120000,
}, async t => {
  const kit = require("../demo-kit.cjs");
  const server = http.createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(page); }).listen(0);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo cover "));
  const s = await kit.startSession({ projectDir, outDir, name: "cover",
    baseURL: `http://127.0.0.1:${server.address().port}`, startUrl: "/" });
  t.after(async () => {
    await s.finish().catch(() => {}); // closes the page so the video file is released
    await s.browser.close().catch(() => {});
    server.close();
    fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const { page: p, demo } = s;

  // Modal open: the page behind it must not be highlighted or clicked.
  await assert.rejects(demo.highlight(p.locator("#total"), "Bar", 300), /behind div#backdrop.*close/);
  await assert.rejects(demo.highlightText("Total 0/7", "Bar", 300, { within: p.locator("body > p") }), /behind div#backdrop/);
  await assert.rejects(demo.click(p.locator("#save")), /covered by div#backdrop/);
  // Things inside the modal are fine, and a text match picks the visible copy in the modal.
  await demo.highlight(p.locator("#close"), "Close it", 300);
  const box = await p.locator("#inner").boundingBox();
  const hl = demo.highlightText("Total 0/7", "In dialog", 600);
  await new Promise(r => setTimeout(r, 300));
  const drawn = await p.locator(".__demo_hl").last().boundingBox();
  await hl;
  assert.ok(Math.abs(drawn.y + 8 - box.y) < 6, `highlight drawn at y=${drawn.y}, dialog text at y=${box.y}`);

  // A modal that is fading out, or a toast that goes away: wait for it instead of failing.
  await p.goto(p.url().split("?")[0] + "?closing");
  await demo.highlight(p.locator("#total"), "Bar after close", 300);
  await p.goto(p.url().split("?")[0] + "?nomodal&toast");
  await demo.click(p.locator("#save"));
  assert.equal(await p.locator("#log").innerText(), "S;");
});
