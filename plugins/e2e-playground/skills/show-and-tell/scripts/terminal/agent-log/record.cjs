// Film a real agent run from its log: terminal-looking replay (+ optional real browser video beside it).
// usage: node record.cjs <workdir> [--project <dir with playwright>] [--app "Claude Code"] [--page 1280x720]
//        [--labels '{"think":"AI คิด","wait":"รอผลคำสั่ง","secs":"วินาที · เร่งให้ดู"}']
// reads  <workdir>/run.jsonl (log-run.py, or opencode `run --format json`), <workdir>/prompt.txt,
//        optional <workdir>/pwvideo/*.webm (Playwright recordVideo of the browser the agent drove)
// writes <workdir>/replay.json (exactly what was drawn) and <workdir>/replay/*.webm
const path = require("path");
const fs = require("fs");
const timeline = require("./timeline.cjs");

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const work = path.resolve(argv[0]);
// Playwright: --project, else the one installed in scripts/terminal (npm install there)
const { chromium } = require(require.resolve("playwright", { paths: [path.resolve(opt("project", path.join(__dirname, "..")))] }));

const tl = timeline(path.join(work, "run.jsonl"));
const R = {
  app: opt("app", "Claude Code"), model: tl.model, cwd: work, items: tl.items,
  prompt: fs.readFileSync(path.join(work, "prompt.txt"), "utf8").trim(),
  labels: Object.assign({ think: "thinking", wait: "waiting", secs: "s · sped up" }, JSON.parse(opt("labels", "{}"))),
};
const pw = path.join(work, "pwvideo");
const vid = fs.existsSync(pw) && fs.readdirSync(pw).find(n => n.endsWith(".webm"));
if (vid) {
  const full = path.join(pw, vid);
  R.video = "file:///" + full.replace(/\\/g, "/");
  R.videoOffset = (fs.statSync(full).birthtimeMs - tl.t0) / 1000;  // Playwright creates the file when recording starts
  if (opt("page")) [R.pageW, R.pageH] = opt("page").split("x").map(Number);
}
fs.writeFileSync(path.join(work, "replay.json"), JSON.stringify(R, null, 1));

(async () => {
  const dir = path.join(work, "replay");
  fs.rmSync(dir, { recursive: true, force: true });
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 },
                                         recordVideo: { dir, size: { width: 1920, height: 1080 } } });
  const page = await ctx.newPage();
  await page.goto("file:///" + path.join(__dirname, "replay.html").replace(/\\/g, "/"));
  await page.waitForTimeout(500);
  page.evaluate(r => window.__start(r), R);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 60 * 60 * 1000, polling: 500 });
  await ctx.close(); await browser.close();
  console.log(`replay: ${R.items.length} items -> ${dir}`);
})().catch(e => { console.error(e.message.split("\n")[0]); process.exit(1); });
