// Real Chromium mouse -> local HTTP server -> state file -> real ffmpeg, then safe resume.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { performance } = require("node:perf_hooks");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const runner = path.resolve(__dirname, "../run-case.cjs");

const projectDir = path.resolve(__dirname, "../terminal");
let browserAvailable = false;
try {
  const { chromium } = require(require.resolve("playwright", { paths: [projectDir] }));
  browserAvailable = fs.existsSync(chromium.executablePath());
} catch {}

test("real recording and editing resume without repeating a server-side action", {
  skip: browserAvailable ? false : "install existing terminal Playwright dependencies and Chromium",
  timeout: 120000,
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo recording "));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("demo recording "));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const state = path.join(root, "state.json");
  fs.writeFileSync(state, JSON.stringify({ moved: 0 }));
  const html = `<!doctype html><html><body><h1>Recorder fixture</h1>
    <button>Move order</button><p role="status">Waiting</p><script>
    document.querySelector('button').onclick = async () => {
      await fetch('/move', { method: 'POST' });
      document.querySelector('[role=status]').textContent = 'Moved';
    };</script></body></html>`;
  const server = http.createServer((request, response) => {
    if (request.url === "/move" && request.method === "POST") {
      const value = JSON.parse(fs.readFileSync(state));
      fs.writeFileSync(state, JSON.stringify({ moved: value.moved + 1 }));
      response.end("ok");
    } else { response.setHeader("Content-Type", "text/html"); response.end(html); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const output = path.join(root, "output with spaces", "clip.mp4");
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const caseFile = path.join(root, "case with spaces.cjs");
  const source = `const fs = require("node:fs"); module.exports = {
    projectDir: ${JSON.stringify(projectDir)}, output: ${JSON.stringify(output)},
    baseURL: ${JSON.stringify(baseURL)}, reviewTimes: [],
    title: { title: "Move order", lines: [] }, view: { width: 640, height: 480 },
    async login(page) { await page.goto(${JSON.stringify(baseURL)}); },
    async run({ page, demo }) {
      await demo.caption("Move the waiting order");
      await demo.click(page.getByRole("button", { name: "Move order" }));
      await demo.waitApp(page.getByRole("status").filter({ hasText: "Moved" }), "save");
      await demo.highlight(page.getByRole("status"), "Moved", 3000);
    },
    async verify() { return JSON.parse(fs.readFileSync(${JSON.stringify(state)})).moved === 1; },
  };`;
  fs.writeFileSync(caseFile, source);
  const invoke = async (...args) => {
    const { stdout } = await execFile(process.execPath, [runner, caseFile, ...args], { windowsHide: true });
    return JSON.parse(stdout);
  };
  const start = performance.now();
  const first = await invoke();
  const firstMs = performance.now() - start;
  assert.equal(first.status, "needs-review");
  assert.equal(first.verification, "passed");
  assert.ok(fs.statSync(first.video).size > 1000);
  assert.ok(fs.statSync(first.sheet).size > 1000);
  assert.ok(!fs.readdirSync(root, { recursive: true }).some(file => file.endsWith("_auth-state.json")),
    "login state must stay in memory instead of becoming an artifact");
  const modified = fs.statSync(first.video).mtimeMs;
  const resume = performance.now();
  const second = await invoke();
  t.diagnostic(`first=${Math.round(firstMs)}ms resume=${Math.round(performance.now() - resume)}ms`);
  assert.equal(second.cached, true);
  assert.equal(second.attempts, 1);
  assert.equal(JSON.parse(fs.readFileSync(state)).moved, 1);
  assert.equal(fs.statSync(second.video).mtimeMs, modified);
  fs.writeFileSync(caseFile, source.replace("reviewTimes: []", "reviewTimes: [0.5]"));
  await assert.rejects(invoke(), error => error.stderr.includes("--edit-only"));
  const changed = await invoke("--edit-only");
  assert.equal(changed.cached, true);
  assert.equal(changed.attempts, 1);
  assert.equal(JSON.parse(fs.readFileSync(state)).moved, 1);
  assert.equal(fs.statSync(changed.video).mtimeMs, modified);
});
