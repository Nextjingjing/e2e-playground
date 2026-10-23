// demo-kit — record a demo video of a REAL running web app with Playwright.
//
// Every action is a real input event (page.mouse / page.keyboard): no element.click()
// through JS, no dispatchEvent, no API calls from the script. Overlays (cursor, ripple,
// highlight, caption, mid-video card) are pointer-events:none decorations only.
//
// Two things keep the result watchable:
//   * waits for the app go through demo.waitApp(), which marks them as "idle" so
//     post.py can fast-forward spinners and loading screens;
//   * all overlay text uses ONE fixed font (opts.font, a system font by default) and the
//     opening title card is recorded as its own clip on a blank page, so its look never
//     depends on whether the app's web font has loaded yet.
//
//   const kit = require("<skill>/scripts/demo-kit.cjs");
//   await kit.recordCard({ outDir, name: "01-card", tag: "Case 1", title: "...", lines: ["..."] });
//   const s = await kit.startSession({ baseURL, login, outDir, name: "01-case", startUrl: "/page" });
//   ... s.demo.click(locator, { slow: true, highlight: "label" }) ...
//   await s.finish();   // writes <outDir>/<name>.webm + <name>.marks.json
//   python post.py one <outDir>/01-case.webm out/01-case.mp4 --card <outDir>/01-card.webm --seed 21
const fs = require("fs");
const path = require("path");
const { redactInit, redactConfig } = require("./redact.cjs");

const DEFAULT_FONT = "'Leelawadee UI','Noto Sans Thai','Sarabun','Segoe UI','Noto Sans',sans-serif";
const DEFAULT_VIEW = { width: 1440, height: 900 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// How long text must stay on screen to be read (see the human-yardstick skill):
// 1 s to notice + characters / reading speed. Thai counts base letters only (tone marks and
// upper/lower vowels are not extra reading load, as in Netflix's Thai line count).
// 15 chars/s is a cautious default (Netflix adult limits run 12-22 cps by language; Thai is
// not published). Clamped to 2.5-9 s so cards never flash by or drag.
function readMs(texts, { cps = 15, min = 2500, max = 9000 } = {}) {
  const chars = [].concat(texts).join(" ").replace(/[ัิ-ฺ็-๎]/g, "").replace(/\s+/g, " ").trim().length;
  const need = 1000 + (chars / cps) * 1000;
  if (need > max) console.warn(`card text needs ${(need / 1000).toFixed(1)} s to read (${chars} chars) - shorten it to keep it under ${max / 1000} s`);
  return Math.round(Math.min(max, Math.max(min, need)));
}

function loadPlaywright(projectDir) {
  const paths = [projectDir, process.cwd()].filter(Boolean);
  for (const name of ["playwright", "@playwright/test"]) {
    try {
      return require(require.resolve(name, { paths }));
    } catch {}
  }
  throw new Error("Playwright not found. Pass opts.projectDir (a folder with node_modules/playwright or @playwright/test).");
}

// ---------- the opening title card: its own clip, fixed font, no app behind it ----------
async function recordCard({ outDir, name, tag = "", title, lines = [], ms, view = DEFAULT_VIEW, font = DEFAULT_FONT, projectDir, theme }) {
  ms = ms ?? readMs([tag, title, ...lines]);
  const { chromium } = loadPlaywright(projectDir);
  fs.mkdirSync(outDir, { recursive: true });
  const rawDir = path.join(outDir, "_raw", name);
  const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });
  const context = await browser.newContext({ viewport: view, recordVideo: { dir: rawDir, size: view } });
  const page = await context.newPage();
  const t0 = Date.now();
  const marks = [];
  await page.setContent(cardHtml({ tag, title, lines, font, theme }));
  await page.evaluate(() => document.fonts.ready);
  marks.push({ t: (Date.now() - t0) / 1000, label: "start", kind: "start" });
  await page.evaluate(() => document.getElementById("card").classList.add("on"));
  await sleep(ms + 700);
  await page.evaluate(() => document.getElementById("card").classList.remove("on"));
  await sleep(800);
  const video = page.video();
  await context.close();
  const dest = path.join(outDir, `${name}.webm`);
  fs.copyFileSync(await video.path(), dest);
  fs.writeFileSync(path.join(outDir, `${name}.marks.json`), JSON.stringify(marks, null, 2));
  await browser.close();
  return dest;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function cardCss(font, theme = {}) {
  const bg = theme.background || "linear-gradient(135deg,#1e1b4b 0%,#312e81 45%,#7c2d12 100%)";
  const accent = theme.accent || "#fdba74";
  return `.demo-card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
    background:${bg};color:#fff;text-align:center;font-family:${font};opacity:0;transition:opacity .6s}
  .demo-card.on{opacity:1}
  .demo-card .tag{font-family:${font};font-weight:700;font-size:22px;letter-spacing:.2em;color:${accent};margin-bottom:22px}
  .demo-card h1{font-family:${font};font-size:64px;font-weight:800;margin:0 0 18px}
  .demo-card p{font-family:${font};font-size:30px;margin:6px 0;max-width:1100px;color:#e0e7ff}`;
}

function cardInner({ tag, title, lines }) {
  return `<div class="tag">${esc(tag)}</div><h1>${esc(title)}</h1>` + lines.map(l => `<p>${esc(l)}</p>`).join("");
}

function cardHtml({ tag, title, lines, font, theme }) {
  const bodyBg = (theme && theme.solid) || "#1e1b4b";
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${bodyBg}}${cardCss(font, theme)}</style></head>
  <body><div id="card" class="demo-card">${cardInner({ tag, title, lines })}</div></body></html>`;
}

// ---------- overlay installed into every app document ----------
function overlayInit(font) {
  const install = () => {
    if (document.getElementById("__demo_root")) return;
    const root = document.createElement("div");
    root.id = "__demo_root";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const style = document.createElement("style");
    style.textContent = `
      #__demo_root, #__demo_root *{font-family:${font} !important}
      #__demo_cursor{position:fixed;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;
        background:rgba(255,120,0,.35);border:3px solid #ff7a00;box-shadow:0 0 0 2px #fff;
        transition:transform .12s;left:-100px;top:-100px}
      #__demo_cursor.down{transform:scale(.6);background:rgba(255,120,0,.75)}
      .__demo_ripple{position:fixed;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;
        border:3px solid #ff7a00;animation:__rip .6s ease-out forwards}
      @keyframes __rip{to{transform:scale(4);opacity:0}}
      #__demo_caption{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;max-width:86%;
        background:rgba(17,24,39,.88);color:#fff;font-weight:600;font-size:24px;line-height:1.35;
        padding:10px 22px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.3);text-align:center;
        border-left:6px solid #ff7a00;opacity:0;transition:opacity .3s}
      #__demo_caption.top{bottom:auto;top:84px}
      .__demo_hl{position:fixed;border:4px solid #ff7a00;border-radius:10px;
        box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 18px 4px rgba(255,122,0,.8);animation:__pulse 1s ease-in-out infinite alternate}
      @keyframes __pulse{from{box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 8px 2px rgba(255,122,0,.6)}to{box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 26px 8px rgba(255,122,0,.95)}}
      .__demo_hl_label{position:fixed;background:#ff7a00;color:#fff;font-weight:700;font-size:20px;line-height:1.3;
        padding:6px 14px;border-radius:8px;white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.3)}
    `;
    root.appendChild(style);
    const cur = document.createElement("div");
    cur.id = "__demo_cursor";
    root.appendChild(cur);
    const cap = document.createElement("div");
    cap.id = "__demo_caption";
    root.appendChild(cap);
    (document.body || document.documentElement).appendChild(root);
    const last = sessionStorage.getItem("__demo_mouse");
    if (last) { const [x, y] = JSON.parse(last); cur.style.left = x + "px"; cur.style.top = y + "px"; }
    const c = sessionStorage.getItem("__demo_caption");
    if (c) { const { text, top } = JSON.parse(c); cap.textContent = text || ""; cap.classList.toggle("top", !!top); cap.style.opacity = text ? 1 : 0; }
  };
  document.addEventListener("DOMContentLoaded", install);
  setInterval(install, 500); // SPAs can replace <body>
  window.addEventListener("mousemove", e => {
    const c = document.getElementById("__demo_cursor");
    if (c) { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }
    sessionStorage.setItem("__demo_mouse", JSON.stringify([e.clientX, e.clientY]));
  }, true);
  window.addEventListener("mousedown", e => {
    const c = document.getElementById("__demo_cursor");
    if (c) c.classList.add("down");
    const root = document.getElementById("__demo_root");
    if (!root) return;
    const r = document.createElement("div");
    r.className = "__demo_ripple"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px";
    root.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }, true);
  window.addEventListener("mouseup", () => {
    const c = document.getElementById("__demo_cursor");
    if (c) c.classList.remove("down");
  }, true);
}

// Bigger captions/labels for videos watched on phones (human-yardstick: >= 32 px at 1280x720).
function sizeInit(px) {
  const add = () => {
    if (document.getElementById("__demo_size")) return;
    const s = document.createElement("style");
    s.id = "__demo_size";
    s.textContent = `#__demo_caption{font-size:${px}px !important}.__demo_hl_label{font-size:${Math.round(px * 0.85)}px !important}`;
    (document.head || document.documentElement).appendChild(s);
  };
  document.addEventListener("DOMContentLoaded", add);
  setInterval(add, 500);
}

// ---------- session ----------
// opts: baseURL, outDir, name, startUrl, login(page) [run once, not recorded],
//       storageStatePath, view, font, captionPx, projectDir, contextOptions, origin permissions,
//       redact: { text: ["Real Name", "emp id"], selectors: [".avatar-name"], patterns: [{src, flags}] }
//               (on by default with built-in credential/PII patterns; false = off)
async function startSession(opts) {
  const { baseURL, outDir, name, startUrl, login } = opts;
  const view = opts.view || DEFAULT_VIEW;
  const font = opts.font || DEFAULT_FONT;
  const pw = loadPlaywright(opts.projectDir);
  fs.mkdirSync(outDir, { recursive: true });
  if (opts.electron) return startElectron(pw, opts, view, font);
  const { chromium } = pw;
  const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });

  let storageState;
  if (login) {
    storageState = opts.storageStatePath || path.join(outDir, "_auth-state.json");
    const fresh = fs.existsSync(storageState) && Date.now() - fs.statSync(storageState).mtimeMs < 4 * 3600e3;
    if (!fresh) {
      const ctx = await browser.newContext({ viewport: view, baseURL });
      const p = await ctx.newPage();
      await login(p);
      await ctx.storageState({ path: storageState });
      await ctx.close();
    }
  }

  const rawDir = path.join(outDir, "_raw", name);
  const context = await browser.newContext({
    viewport: view,
    baseURL,
    storageState,
    permissions: ["clipboard-read", "clipboard-write"],
    recordVideo: { dir: rawDir, size: view },
    ...(opts.contextOptions || {}),
  });
  await context.addInitScript(overlayInit, font);
  if (opts.captionPx) await context.addInitScript(sizeInit, opts.captionPx);
  // credentials / personal data blurred before the first frame (opts.redact: false to turn off)
  const redact = redactConfig(opts.redact ?? {});
  if (redact) await context.addInitScript(redactInit, redact);
  const page = await context.newPage();
  const t0 = Date.now();
  const marks = [];
  const shots = [];
  const demo = makeDemo(page, marks, t0, { view, font, theme: opts.theme, shots, shotDir: path.join(outDir, "shots", name) });

  if (startUrl) {
    await demo.waitApp(async () => {
      await page.goto(startUrl);
      await page.waitForLoadState("networkidle").catch(() => {});
    }, "open start page");
  }
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  demo.mark("start", "start"); // post.py trims everything before this

  async function finish() {
    await sleep(1200);
    const video = page.video();
    await context.close();
    const dest = path.join(outDir, `${name}.webm`);
    fs.copyFileSync(await video.path(), dest);
    fs.writeFileSync(path.join(outDir, `${name}.marks.json`), JSON.stringify(marks, null, 2));
    if (shots.length) {
      const md = [`# ${name}`, ""];
      for (const s of shots) md.push(`## ${s.n}. ${s.title}`, "", s.caption ? `${s.caption}\n` : "", `![${s.title}](${s.file})`, "");
      fs.writeFileSync(path.join(outDir, "shots", name, "shots.md"), md.join("\n"));
    }
    await browser.close();
    return dest;
  }
  return { browser, context, page, demo, finish, shots };
}

// Electron: same demo API on the app's first window. opts.electron = electron.launch options
// (args, cwd, executablePath, env). The window keeps the app's own size; video is scaled to view.
async function startElectron(pw, opts, view, font) {
  const { outDir, name } = opts;
  const rawDir = path.join(outDir, "_raw", name);
  const app = await pw._electron.launch({ ...opts.electron, recordVideo: { dir: rawDir, size: view } });
  await app.context().addInitScript(overlayInit, font);
  if (opts.captionPx) await app.context().addInitScript(sizeInit, opts.captionPx);
  const redact = redactConfig(opts.redact ?? {});
  if (redact) await app.context().addInitScript(redactInit, redact);
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(overlayInit, font); // the first window loaded before the init script existed
  if (opts.captionPx) await page.evaluate(sizeInit, opts.captionPx);
  if (redact) await page.evaluate(redactInit, redact);
  const t0 = Date.now();
  const marks = [];
  const shots = [];
  const demo = makeDemo(page, marks, t0, { view, font, theme: opts.theme, shots, shotDir: path.join(outDir, "shots", name) });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  demo.mark("start", "start");
  async function finish() {
    await sleep(1200);
    const video = page.video();
    await app.close();
    const dest = path.join(outDir, `${name}.webm`);
    fs.copyFileSync(await video.path(), dest);
    fs.writeFileSync(path.join(outDir, `${name}.marks.json`), JSON.stringify(marks, null, 2));
    return dest;
  }
  return { app, context: app.context(), page, demo, finish, shots };
}

function makeDemo(page, marks, t0, { view, font, theme, shots, shotDir }) {
  let mouse = { x: view.width / 2, y: view.height / 2 };
  let lastCaption = "";
  const now = () => (Date.now() - t0) / 1000;

  async function moveTo(x, y) {
    const dist = Math.hypot(x - mouse.x, y - mouse.y);
    const n = Math.max(12, Math.min(45, Math.round(dist / 18)));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
      await page.mouse.move(mouse.x + (x - mouse.x) * e, mouse.y + (y - mouse.y) * e);
      await sleep(12);
    }
    mouse = { x, y };
  }

  async function boxOf(locator) {
    await demo.waitApp(() => locator.waitFor({ state: "visible", timeout: 30000 }), "wait for element");
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(250);
    const b = await locator.boundingBox();
    if (!b) throw new Error("no bounding box for " + locator);
    return b;
  }

  const demo = {
    sleep,
    mark(label, kind = "note") { marks.push({ t: now(), label, kind }); },

    // Wait for the APP (spinner, network, a row to appear). Marked idle -> fast-forwarded
    // by post.py. Pass a function returning a promise, a promise, or a locator.
    // Never wrap deliberate human pauses in this: those are what the viewer should see.
    async waitApp(what, label = "wait") {
      const start = now();
      if (typeof what === "function") await what();
      else if (what && typeof what.waitFor === "function") await what.waitFor({ state: "visible", timeout: 30000 });
      else await what;
      const end = now();
      if (end - start > 0.4) marks.push({ t: start, end, label, kind: "idle" });
    },

    // Real mouse click with a visible approach. slow=true for the steps that matter.
    async click(locator, { slow = false, pauseBefore, pauseAfter, highlight } = {}) {
      const b = await boxOf(locator);
      await moveTo(b.x + b.width / 2, b.y + b.height / 2);
      if (highlight) await demo.highlight(locator, highlight, slow ? 2200 : 1400);
      await sleep(pauseBefore ?? (slow ? 1200 : 400));
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
      await sleep(pauseAfter ?? (slow ? 1300 : 500));
    },

    async hover(locator, ms = 800) {
      const b = await boxOf(locator);
      await moveTo(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(ms);
    },

    // Click a field, then type like a person.
    async type(locator, text, { delay = 85 } = {}) {
      await demo.click(locator, { pauseAfter: 250 });
      await page.keyboard.type(text, { delay });
      await sleep(400);
    },

    // A barcode scanner is a keyboard: fast typing + Enter.
    async scanText(text) {
      await page.keyboard.type(text, { delay: 18 });
      await sleep(250);
      await page.keyboard.press("Enter");
    },

    // Paste what an in-app "copy" button put on the clipboard, then Enter.
    async pasteAndEnter() {
      await page.keyboard.press("Control+V");
      await sleep(600);
      await page.keyboard.press("Enter");
    },

    // Still picture of this moment for a manual or report: what the video shows, overlays
    // included (cursor hidden). Saved as shots/<session>/NN-<name>.png + listed in shots.md.
    async shot(title, { cursor = false } = {}) {
      fs.mkdirSync(shotDir, { recursive: true });
      const n = shots.length + 1;
      const slug = String(title).replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "shot";
      const file = `${String(n).padStart(2, "0")}-${slug}.png`;
      if (!cursor) await page.evaluate(() => { const c = document.getElementById("__demo_cursor"); if (c) c.style.visibility = "hidden"; });
      await page.screenshot({ path: path.join(shotDir, file) });
      if (!cursor) await page.evaluate(() => { const c = document.getElementById("__demo_cursor"); if (c) c.style.visibility = ""; });
      shots.push({ n, title, caption: lastCaption, file });
      return path.join(shotDir, file);
    },

    // highlight(locator, label, ms, { shot: "title" }) also saves a still while it shows.
    async highlight(locator, label, ms = 2200, { shot } = {}) {
      const b = await boxOf(locator);
      marks.push({ t: now(), end: now() + ms / 1000, label: "highlight: " + (label || ""), kind: "highlight" });
      await page.evaluate(({ b, label, ms }) => {
        const root = document.getElementById("__demo_root");
        if (!root) return;
        const pad = 8;
        const hl = document.createElement("div");
        hl.className = "__demo_hl";
        Object.assign(hl.style, { left: b.x - pad + "px", top: b.y - pad + "px", width: b.width + pad * 2 + "px", height: b.height + pad * 2 + "px" });
        root.appendChild(hl);
        let lab;
        if (label) {
          lab = document.createElement("div");
          lab.className = "__demo_hl_label";
          lab.textContent = label;
          root.appendChild(lab);
          const lw = lab.offsetWidth, lh = lab.offsetHeight;
          let top = b.y - pad - lh - 10;
          if (top < 70) top = b.y + b.height + pad + 10;
          const left = Math.min(Math.max(8, b.x + b.width / 2 - lw / 2), window.innerWidth - lw - 8);
          Object.assign(lab.style, { left: left + "px", top: top + "px" });
        }
        setTimeout(() => { hl.remove(); lab && lab.remove(); }, ms);
      }, { b, label, ms });
      if (shot) {
        const t = Date.now();
        await sleep(400);
        await demo.shot(shot);
        await sleep(Math.max(0, ms - (Date.now() - t)));
      } else {
        await sleep(ms);
      }
    },

    // Lower-third caption that survives navigation. null hides it.
    async caption(text, { top = false } = {}) {
      demo.mark("caption: " + text, "caption");
      lastCaption = text || "";
      await page.evaluate(({ text, top }) => {
        sessionStorage.setItem("__demo_caption", JSON.stringify({ text, top }));
        const c = document.getElementById("__demo_caption");
        if (!c) return;
        c.textContent = text || "";
        c.classList.toggle("top", !!top);
        c.style.opacity = text ? 1 : 0;
      }, { text, top });
      await sleep(300);
    },

    // Mid-video title card over the app (same fixed font as the opening card).
    async card({ tag = "", title, lines = [] }, ms) {
      ms = ms ?? readMs([tag, title, ...lines]);
      marks.push({ t: now(), end: now() + (ms + 1400) / 1000, label: "card: " + title, kind: "card" });
      await page.evaluate(({ html, css }) => {
        const root = document.getElementById("__demo_root");
        if (!root) return;
        const s = document.createElement("style");
        s.textContent = css;
        const card = document.createElement("div");
        card.className = "demo-card";
        card.id = "__demo_card";
        card.innerHTML = html;
        root.appendChild(s);
        root.appendChild(card);
        requestAnimationFrame(() => card.classList.add("on"));
      }, { html: cardInner({ tag, title, lines }), css: cardCss(font, theme) });
      await sleep(ms + 600);
      await page.evaluate(() => {
        const c = document.getElementById("__demo_card");
        if (c) { c.classList.remove("on"); setTimeout(() => c.remove(), 700); }
      });
      await sleep(800);
    },
  };
  return demo;
}

module.exports = { startSession, recordCard, sleep, readMs, DEFAULT_FONT, DEFAULT_VIEW };
