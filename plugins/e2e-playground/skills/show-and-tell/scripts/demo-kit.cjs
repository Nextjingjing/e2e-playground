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
const { thaiCells } = require("./terminal/thai.cjs");

// Apple's system font where there is one (macOS/iOS), its closest look-alikes elsewhere
// (Segoe UI Variable on Windows 11, Inter), then Thai faces for Thai glyphs. opts.font overrides.
const DEFAULT_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue','Segoe UI Variable Display','Segoe UI','Inter'," +
  "'Sukhumvit Set','Leelawadee UI','Noto Sans Thai','Sarabun',sans-serif";
// Apple system colours (light-mode values: deep enough for white text). The kit picks the first
// one whose hue is far from the app's own colours, so a highlight never melts into an orange app.
const ACCENTS = ["#007AFF", "#AF52DE", "#FF2D55", "#5856D6", "#34C759", "#FF9500", "#30B0C7"];
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

// ---------- title cards: the opening one is its own clip, fixed font, no app behind it ----------
// Look (Apple keynote style by default): drifting soft colour light on near-black, a glass tag
// pill, the title arriving word by word out of a blur, then each line on its own. Long text is
// never dumped at once: lines come one by one, 3 per page, each staying long enough to read.
// theme: { dark: false } for a light card, { background, accent, colors: [4 blob colours] }.
const CARD_EXIT_MS = 800;
const letters = s => String(s || "").replace(/[ัิ-ฺ็-๎]/g, "").replace(/\s+/g, " ").trim().length;

// Timeline of a card in ms from its start (see human-yardstick: notice + characters / reading
// speed, Thai by base letters). ms forces the reading time (stretched or squeezed to fit).
function cardPlan({ tag = "", title = "", lines = [] }, { cps = 15, ms, max = 14000 } = {}) {
  const read = s => (letters(s) / cps) * 1000;
  const events = [];
  let t = 250; // the background settles for a moment first
  if (tag) { events.push({ at: t, kind: "tag" }); t += 300; }
  events.push({ at: t, kind: "title" });
  t += 900 + read(tag) / 2 + read(title); // words arriving (read as they come) + reading; a tag is glanced at
  for (let p = 0; p * 3 < lines.length; p++) {
    if (p) { events.push({ at: t, kind: "pageOut", page: p - 1 }); t += 450; }
    lines.slice(p * 3, p * 3 + 3).forEach((line, i) => {
      events.push({ at: t, kind: "line", page: p, i });
      t += 500 + read(line);
    });
  }
  t += 500; // one last look at everything
  const need = t;
  const total = Math.round(ms ?? Math.min(max, Math.max(2500, need)));
  if (ms === undefined && need > max) console.warn(`card text needs ${(need / 1000).toFixed(1)} s to read - shorten it to keep the card under ${max / 1000} s`);
  const k = total / need;
  return { events: events.map(e => ({ ...e, at: Math.round(e.at * k) })), total, exitMs: CARD_EXIT_MS };
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function cardCss(font, theme = {}) {
  const dark = theme.dark !== false;
  const fg = dark ? "#f5f5f7" : "#1d1d1f";
  const soft = dark ? "rgba(245,245,247,.74)" : "rgba(29,29,31,.68)";
  const bg = theme.background || (dark ? "#0a0a0f" : "#f5f5f7");
  const accent = theme.accent || "#0A84FF";
  const [c1, c2, c3, c4] = theme.colors || (dark ? ["#0A84FF", "#BF5AF2", "#FF375F", "#64D2FF"] : ["#7DB8FF", "#D9A8FF", "#FFB3C1", "#9FE3F5"]);
  // soft light from radial gradients (no blur filter: it would choke the software renderer)
  const blob = c => `radial-gradient(circle at 50% 50%,${c} 0%,transparent 68%)`;
  return `.demo-card{position:fixed;inset:0;overflow:hidden;display:flex;align-items:center;justify-content:center;
    background:${bg};color:${fg};text-align:center;font-family:${font};-webkit-font-smoothing:antialiased}
  .demo-card.mid{opacity:0;transition:opacity .5s ease}
  .demo-card.mid.on{opacity:1}
  .demo-card .bg{position:absolute;inset:0}
  .demo-card .bg i{position:absolute;width:75vmax;height:75vmax;border-radius:50%;opacity:${dark ? 0.55 : 0.7};will-change:transform}
  .demo-card .b1{left:-28vmax;top:-34vmax;background:${blob(c1)};animation:__cd1 14s ease-in-out infinite alternate}
  .demo-card .b2{right:-30vmax;top:-22vmax;background:${blob(c2)};animation:__cd2 16s ease-in-out infinite alternate}
  .demo-card .b3{left:-12vmax;bottom:-46vmax;background:${blob(c3)};opacity:${dark ? 0.42 : 0.6};animation:__cd3 18s ease-in-out infinite alternate}
  .demo-card .b4{right:-24vmax;bottom:-40vmax;background:${blob(c4)};opacity:${dark ? 0.38 : 0.6};animation:__cd1 20s ease-in-out infinite alternate-reverse}
  @keyframes __cd1{to{transform:translate(9vmax,6vmax) scale(1.12)}}
  @keyframes __cd2{to{transform:translate(-11vmax,8vmax) scale(.92)}}
  @keyframes __cd3{to{transform:translate(8vmax,-9vmax) scale(1.08)}}
  .demo-card .content{position:relative;max-width:1180px;padding:0 64px;
    transition:transform ${CARD_EXIT_MS}ms cubic-bezier(.4,0,.2,1),filter ${CARD_EXIT_MS}ms ease,opacity ${CARD_EXIT_MS}ms ease}
  .demo-card.exit .content{transform:scale(1.06);filter:blur(16px);opacity:0}
  .demo-card .tag{display:inline-flex;align-items:center;gap:10px;padding:9px 18px;border-radius:999px;
    background:${dark ? "rgba(255,255,255,.1)" : "rgba(255,255,255,.7)"};border:1px solid ${dark ? "rgba(255,255,255,.16)" : "rgba(0,0,0,.08)"};
    font-size:20px;font-weight:600;letter-spacing:.01em;color:${fg}}
  .demo-card .tag::before{content:"";width:8px;height:8px;border-radius:50%;background:${accent}}
  .demo-card h1{font-size:76px;font-weight:700;letter-spacing:-.03em;line-height:1.1;margin:28px 0 24px;color:${fg}}
  .demo-card .w{display:inline-block;white-space:pre}
  .demo-card .pages{display:grid}
  .demo-card .page{grid-area:1/1}
  .demo-card p{font-size:32px;font-weight:500;line-height:1.42;letter-spacing:-.01em;margin:6px 0;color:${soft}}
  .demo-card .rv{opacity:0;transform:translateY(22px);filter:blur(12px);
    transition:opacity .75s cubic-bezier(.16,1,.3,1),transform .75s cubic-bezier(.16,1,.3,1),filter .75s cubic-bezier(.16,1,.3,1)}
  .demo-card .rv.in{opacity:1;transform:none;filter:none}
  .demo-card .rv.out{opacity:0;transform:translateY(-16px);filter:blur(10px);transition-duration:.45s}`;
}

// Title split into words (Thai too: Intl.Segmenter), each arriving a beat after the last.
function cardInner({ tag, title, lines }) {
  let i = 0;
  const words = [...new Intl.Segmenter("th", { granularity: "word" }).segment(String(title || ""))]
    .map(s => (s.isWordLike ? `<span class="w rv" style="transition-delay:${Math.min(i++ * 70, 900)}ms">${esc(s.segment)}</span>` : esc(s.segment))).join("");
  const pages = [];
  for (let p = 0; p * 3 < lines.length; p++) {
    pages.push(`<div class="page">${lines.slice(p * 3, p * 3 + 3).map((l, n) => `<p class="rv" data-p="${p}" data-i="${n}">${esc(l)}</p>`).join("")}</div>`);
  }
  return `<div class="bg"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>` +
    `<div class="content">${tag ? `<div class="tag rv">${esc(tag)}</div>` : ""}<h1 class="title">${words}</h1>` +
    `<div class="pages">${pages.join("")}</div></div>`;
}

function cardHtml({ tag, title, lines, font, theme = {} }) {
  const bodyBg = theme.solid || (theme.dark === false ? "#f5f5f7" : "#0a0a0f");
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${bodyBg}}${cardCss(font, theme)}</style></head>
  <body><div id="card" class="demo-card">${cardInner({ tag, title, lines })}</div></body></html>`;
}

// Runs in the page: plays a card's timeline (cardPlan) on the element with this id.
function playCard({ id, events, exitAt }) {
  const card = document.getElementById(id);
  if (!card) return;
  const act = e => {
    if (e.kind === "tag") card.querySelector(".tag")?.classList.add("in");
    else if (e.kind === "title") card.querySelectorAll(".title .w").forEach(w => w.classList.add("in"));
    else if (e.kind === "line") card.querySelector(`p[data-p="${e.page}"][data-i="${e.i}"]`)?.classList.add("in");
    else if (e.kind === "pageOut") card.querySelectorAll(`p[data-p="${e.page}"]`).forEach(p => { p.classList.remove("in"); p.classList.add("out"); });
  };
  for (const e of events) setTimeout(() => act(e), e.at);
  setTimeout(() => card.classList.add("exit"), exitAt);
}

async function recordCard({ outDir, name, tag = "", title, lines = [], ms, view = DEFAULT_VIEW, font = DEFAULT_FONT, projectDir, theme }) {
  const plan = cardPlan({ tag, title, lines }, { ms });
  const { chromium } = loadPlaywright(projectDir);
  fs.mkdirSync(outDir, { recursive: true });
  const rawDir = path.join(outDir, "_raw", name);
  const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });
  try {
    const context = await browser.newContext({ viewport: view, recordVideo: { dir: rawDir, size: view } });
    const page = await context.newPage();
    const t0 = Date.now();
    const marks = [];
    await page.setContent(cardHtml({ tag, title, lines, font, theme }));
    await page.evaluate(() => document.fonts.ready);
    marks.push({ t: (Date.now() - t0) / 1000, label: "start", kind: "start" });
    await page.evaluate(playCard, { id: "card", events: plan.events, exitAt: plan.total });
    const played = Date.now();
    // post.py ends the card at "end": its dissolve into the app overlaps the text blurring away,
    // so no empty background is left in between
    marks.push({ t: (played - t0 + plan.total + plan.exitMs + 100) / 1000, label: "end", kind: "end" });
    await sleep(plan.total + plan.exitMs + 500);
    const video = page.video();
    await context.close();
    const dest = path.join(outDir, `${name}.webm`);
    fs.copyFileSync(await video.path(), dest);
    fs.writeFileSync(path.join(outDir, `${name}.marks.json`), JSON.stringify(marks, null, 2));
    return dest;
  } finally { await browser.close().catch(() => {}); }
}

// The accent as CSS values: the colour, its "r,g,b" for glows, and black or white text on it.
function accentVars(hex) {
  const n = parseInt(String(hex).replace("#", "").replace(/^(.)(.)(.)$/, "$1$1$2$2$3$3"), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return { a: `rgb(${r},${g},${b})`, rgb: `${r},${g},${b}`, on: lum > 0.36 ? "#111" : "#fff" };
}

// Runs in the page: the first of `palette` whose hue is far from the app's own saturated colours
// (backgrounds weighted by area, text and borders a little), so highlights stand out.
function pickAccentInPage(palette) {
  const hue = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s, l };
  };
  const rgba = c => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return v.length >= 3 ? [v[0], v[1], v[2], v[3] ?? 1] : null; };
  const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const W = innerWidth, H = innerHeight;
  const seen = [];
  let total = 0, n = 0;
  const add = (c, w) => {
    const v = rgba(c);
    if (!v || v[3] < 0.4 || w <= 0) return;
    const { h, s, l } = hue(v);
    if (s < 0.3 || l < 0.15 || l > 0.9) return; // greys, near-black and near-white do not clash
    seen.push([h, w]); total += w;
  };
  for (const el of document.querySelectorAll("body *")) {
    if (++n > 4000) break;
    if (el.closest("#__demo_root,#__demo_redact")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.3) continue;
    add(cs.backgroundColor, Math.sqrt(Math.min(r.width, W) * Math.min(r.height, H)));
    if ([...el.childNodes].some(t => t.nodeType === 3 && t.nodeValue.trim())) add(cs.color, 8);
    if (parseFloat(cs.borderTopWidth) > 0) add(cs.borderTopColor, 4);
  }
  const clash = hex => {
    const h = hue(hexRgb(hex)).h;
    return seen.reduce((sum, [x, w]) => { const d = Math.min(Math.abs(x - h), 360 - Math.abs(x - h)); return sum + (d < 40 ? w : 0); }, 0);
  };
  const fine = palette.find(c => clash(c) <= 0.08 * total);
  return fine || palette.reduce((best, c) => (clash(c) < clash(best) ? c : best));
}

// ---------- overlay installed into every app document ----------
// Look: Apple style by default. Glass caption, a ring in the session's accent colour (see
// pickAccentInPage), label pills in that colour, a macOS black-and-white arrow.
function overlayInit(font) {
  const install = () => {
    const v = window.__demoAccent || { a: "rgb(0,122,255)", rgb: "0,122,255", on: "#fff" };
    const old = document.getElementById("__demo_root");
    if (old) { if (old.dataset.accent !== v.a) { old.style.setProperty("--a", v.a); old.style.setProperty("--a-rgb", v.rgb); old.style.setProperty("--on-a", v.on); old.dataset.accent = v.a; } return; }
    const root = document.createElement("div");
    root.id = "__demo_root";
    root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:2147483647;--a:${v.a};--a-rgb:${v.rgb};--on-a:${v.on}`;
    root.dataset.accent = v.a;
    const style = document.createElement("style");
    style.textContent = `
      #__demo_root, #__demo_root *{font-family:${font} !important;-webkit-font-smoothing:antialiased}
      #__demo_cursor{position:fixed;width:22px;height:28px;left:-100px;top:-100px;transform-origin:0 0;
        filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));transition:transform .12s,opacity .3s}
      #__demo_cursor svg{display:block;width:100%;height:100%;overflow:visible}
      #__demo_cursor.down{transform:scale(.85)}
      #__demo_cursor.rest{opacity:.25}
      #__demo_cursor.away{opacity:0}
      .__demo_ripple{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
        background:rgba(var(--a-rgb),.22);border:2px solid var(--a);animation:__rip .55s cubic-bezier(.2,.8,.2,1) forwards}
      @keyframes __rip{to{transform:scale(3.2);opacity:0}}
      #__demo_caption{position:fixed;left:50%;transform:translateX(-50%);bottom:28px;max-width:min(86%,1120px);
        background:rgba(28,28,30,.78);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);
        color:#f5f5f7;font-weight:600;font-size:26px;line-height:1.35;letter-spacing:-.01em;
        padding:12px 26px;border-radius:20px;border:1px solid rgba(255,255,255,.14);
        box-shadow:0 12px 40px rgba(0,0,0,.28);text-align:center;opacity:0;transition:opacity .35s ease}
      #__demo_caption.top{bottom:auto;top:84px}
      .__demo_hl{position:fixed;border:3px solid var(--a);border-radius:14px;
        box-shadow:0 0 0 9999px rgba(0,0,0,.22),0 0 0 5px rgba(var(--a-rgb),.2),0 10px 30px rgba(var(--a-rgb),.4);
        animation:__hlin .35s cubic-bezier(.2,.8,.2,1),__breathe 1.4s .35s ease-in-out infinite alternate}
      @keyframes __hlin{from{opacity:0;transform:scale(1.04)}}
      @keyframes __breathe{to{box-shadow:0 0 0 9999px rgba(0,0,0,.22),0 0 0 9px rgba(var(--a-rgb),.26),0 12px 40px rgba(var(--a-rgb),.55)}}
      .__demo_hl_label{position:fixed;background:var(--a);color:var(--on-a);font-weight:600;font-size:20px;line-height:1.3;
        letter-spacing:-.005em;padding:7px 16px;border-radius:12px;white-space:nowrap;
        box-shadow:0 8px 24px rgba(0,0,0,.22),inset 0 0 0 1px rgba(255,255,255,.16);animation:__lblin .35s cubic-bezier(.2,.8,.2,1)}
      @keyframes __lblin{from{opacity:0;transform:translateY(6px)}}
    `;
    root.appendChild(style);
    // An arrow whose tip is the pointer, like a real one: what is pointed at stays readable,
    // where a ring centred on it hid it. Built node by node: some apps forbid innerHTML.
    const cur = document.createElement("div");
    cur.id = "__demo_cursor";
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 22 28");
    const arrow = document.createElementNS(NS, "path");
    arrow.setAttribute("d", "M0 0V21L5.5 15.8L9.3 24.6L13.2 23L9.5 14.4H16.5Z");
    for (const [k, val] of [["fill", "#111"], ["stroke", "#fff"], ["stroke-width", "1.7"], ["stroke-linejoin", "round"]]) arrow.setAttribute(k, val);
    svg.appendChild(arrow);
    cur.appendChild(svg);
    let state = null; try { state = sessionStorage.getItem("__demo_cursor_state"); } catch {}
    if (state === "rest" || state === "away") cur.classList.add(state);
    root.appendChild(cur);
    const cap = document.createElement("div");
    cap.id = "__demo_caption";
    root.appendChild(cap);
    (document.body || document.documentElement).appendChild(root);
    let last = null; try { last = sessionStorage.getItem("__demo_mouse"); } catch {}
    if (last) { const [x, y] = JSON.parse(last); cur.style.left = x + "px"; cur.style.top = y + "px"; }
    let c = null; try { c = sessionStorage.getItem("__demo_caption"); } catch {}
    if (c) { const { text, top } = JSON.parse(c); cap.textContent = text || ""; cap.classList.toggle("top", !!top); cap.style.opacity = text ? 1 : 0; }
  };
  document.addEventListener("DOMContentLoaded", install);
  setInterval(install, 500); // SPAs can replace <body>
  // A cursor left standing on what was just clicked or typed hides the result: it fades
  // ("rest") once the click is done and comes back on the next move. A highlight hides it
  // ("away") where it would sit on the frame. Kept in sessionStorage, so the page a click
  // opens does not show it at full strength over its content.
  let restTimer = 0, resting = false;
  const show = c => {
    clearTimeout(restTimer);
    if (!resting && !(c && (c.classList.contains("rest") || c.classList.contains("away")))) return;
    resting = false;
    if (c) c.classList.remove("rest", "away");
    try { sessionStorage.removeItem("__demo_cursor_state"); } catch {}
  };
  window.addEventListener("mousemove", e => {
    const c = document.getElementById("__demo_cursor");
    if (c) { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }
    show(c);
    try { sessionStorage.setItem("__demo_mouse", JSON.stringify([e.clientX, e.clientY])); } catch {}
  }, true);
  window.addEventListener("mousedown", e => {
    const c = document.getElementById("__demo_cursor");
    show(c);
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
    clearTimeout(restTimer);
    resting = true;
    try { sessionStorage.setItem("__demo_cursor_state", "rest"); } catch {} // now: the click may navigate
    restTimer = setTimeout(() => { const n = document.getElementById("__demo_cursor"); if (n) n.classList.add("rest"); }, 300);
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
//       beforeStart(page) [runs after the start page loads, before the "start" mark],
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
  try {
    // a step that throws must not leave Chromium running: Node would never exit
    const guard = async fn => { try { return await fn(); } catch (e) { await browser.close().catch(() => {}); throw e; } };

    let storageState;
    if (login) await guard(async () => {
      // Auth cookies/tokens must not become artifacts next to the video. An explicitly
      // supplied existing state can still be read; new logins stay entirely in memory.
      const existing = opts.storageStatePath;
      const fresh = existing && fs.existsSync(existing) && Date.now() - fs.statSync(existing).mtimeMs < 4 * 3600e3;
      if (fresh) storageState = existing;
      else {
        const ctx = await browser.newContext({ viewport: view, baseURL });
        try {
          const p = await ctx.newPage();
          await login(p);
          storageState = await ctx.storageState();
        } finally { await ctx.close().catch(() => {}); }
      }
    });

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
    page.on("console", m => { if (m.text().startsWith("[redact]")) console.warn(m.text()); });
    const t0 = Date.now();
    const marks = [];
    const shots = [];
    const demo = makeDemo(page, marks, t0, { view, font, theme: opts.theme, shots, shotDir: path.join(outDir, "shots", name) });
    let accent;

    await guard(async () => {
      if (startUrl) {
        await demo.waitApp(async () => {
          await page.goto(startUrl);
          await page.waitForLoadState("networkidle").catch(() => {});
        }, "open start page");
      }
      await page.evaluate(() => document.fonts.ready).catch(() => {});
      if (opts.beforeStart) await opts.beforeStart(page); // e.g. load a terminal replay; trimmed off with the page load
      accent = await useAccent(context, page, opts.theme);
    });
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
    return { browser, context, page, demo, finish, shots, accent };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
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
  const accent = await useAccent(app.context(), page, opts.theme);
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
  return { app, context: app.context(), page, demo, finish, shots, accent };
}

// One accent for the whole video: theme.accent, else picked from the start page's colours.
// New documents get it from an init script; the page already open gets it directly.
async function useAccent(context, page, theme) {
  const accent = (theme && theme.accent) || await page.evaluate(pickAccentInPage, ACCENTS).catch(() => ACCENTS[0]);
  const vars = accentVars(accent);
  await context.addInitScript(v => { window.__demoAccent = v; }, vars);
  await page.evaluate(v => {
    window.__demoAccent = v;
    const r = document.getElementById("__demo_root");
    if (r) { r.style.setProperty("--a", v.a); r.style.setProperty("--a-rgb", v.rgb); r.style.setProperty("--on-a", v.on); r.dataset.accent = v.a; }
  }, vars).catch(() => {});
  return accent;
}

// Runs in the page. What a person sees at (x, y) (default: el's centre) over el: null when
// it is el itself or its child/parent, light or shadow DOM, else "tag#id.class" of the cover
// (tag/id/class only: its text may hold names or other personal data). Kit overlays and
// redaction bars are pointer-events:none, so they are looked through. A pointer-events:none
// target (a floating label) is made hittable for this one probe. hoverOk accepts a part of
// the same widget that hovering it revealed (row action bar, image overlay): it shares a
// hovered ancestor below <body> with el, and nothing between is fixed or sticky (a modal,
// backdrop, toast or sticky header never qualifies). allow: CSS selector of a widget whose
// own layers never count as covers (".xterm").
function coverInPage(el, { x, y, hoverOk = false, allow = null } = {}) {
  const doc = el.ownerDocument;
  const parentOf = n => n.assignedSlot || (n.parentNode && n.parentNode.nodeType === 11 && n.parentNode.host) || n.parentNode;
  const within = (outer, inner) => { for (let n = inner; n; n = parentOf(n)) if (n === outer) return true; return false; };
  if (x === undefined || y === undefined) {
    const r = el.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const pick = () => {
    let hit = doc.elementFromPoint(x, y);
    while (hit && hit.shadowRoot) { // look inside open shadow roots (web components)
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  };
  let hit;
  if (el.nodeType === 1 && getComputedStyle(el).pointerEvents === "none") {
    const style = el.getAttribute("style");
    el.style.setProperty("pointer-events", "auto", "important");
    try { hit = pick(); } finally {
      el.getAttribute("style"); // Chrome writes the attribute lazily: sync it now, or it comes back as style=""
      if (style === null) el.removeAttribute("style"); else el.setAttribute("style", style);
    }
  } else hit = pick();
  if (!hit || within(el, hit) || within(hit, el)) return null;
  const label = hit.closest && hit.closest("label");
  if (label && label.control === el) return null;
  const widget = allow && el.closest && el.closest(allow);
  if (widget && within(widget, hit)) return null;
  if (hoverOk) {
    let common = parentOf(el);
    while (common && !within(common, hit)) common = parentOf(common);
    if (common && common.nodeType === 1 && common !== doc.body && common !== doc.documentElement && common.matches(":hover")) {
      let pinned = false;
      for (let n = hit; n && n !== common; n = parentOf(n))
        if (n.nodeType === 1 && /^(fixed|sticky)$/.test(getComputedStyle(n).position)) pinned = true;
      if (!pinned) return null;
    }
  }
  const cls = typeof hit.className === "string" ? hit.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
  return hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + cls.map(c => "." + c).join("");
}
// Installed on demand as a string: DevTools evaluation is not blocked by the app's CSP.
const COVER_SCRIPT = `void (window.__demoCoverAt || Object.defineProperty(window, "__demoCoverAt", { value: (${coverInPage}), configurable: true }))`;

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

  // Current box of the target plus what a person would see at its centre (see coverInPage):
  // .blocked is null or "tag#id.class" of a modal, backdrop, toast or sticky bar on top.
  async function aimAt(locator, hoverOk = false) {
    const b = await locator.boundingBox();
    if (!b) throw new Error("target disappeared: " + locator);
    const probe = (el, o) => (window.__demoCoverAt ? window.__demoCoverAt(el, o) : "__missing");
    let blocked = await locator.evaluate(probe, { hoverOk }).catch(() => null);
    if (blocked === "__missing") { // a fresh document (or an iframe): install the helper there
      const frame = await locator.elementHandle().then(h => h.ownerFrame()).catch(() => null);
      if (frame) await frame.evaluate(COVER_SCRIPT).catch(() => {});
      blocked = await locator.evaluate(probe, { hoverOk }).catch(() => null);
      if (blocked === "__missing") blocked = null;
    }
    return { box: b, x: b.x + b.width / 2, y: b.y + b.height / 2, blocked };
  }

  const pointerIn = b => mouse.x >= b.x && mouse.x <= b.x + b.width && mouse.y >= b.y && mouse.y <= b.y + b.height;

  // A modal that is fading out or a toast that is leaving gets a short (fast-forwarded) wait;
  // a cover that stays is returned in .blocked for the caller to refuse.
  async function waitUncovered(locator, what, hoverOk = false, ms = 3000) {
    let aim = await aimAt(locator, hoverOk);
    if (!aim.blocked) return aim;
    await locator.evaluate(el => el.scrollIntoView({ block: "center", inline: "center" })).catch(() => {});
    const until = Date.now() + ms;
    await demo.waitApp(async () => {
      while ((aim = await aimAt(locator, hoverOk)).blocked && Date.now() < until) await sleep(150);
    }, `wait until ${what} is not covered`);
    return aim;
  }

  // Caller has already waited for the target (boxOf).
  async function highlightLocator(locator, label, ms, opts, hoverOk) {
    const aim = await waitUncovered(locator, "the highlight target", hoverOk);
    if (aim.blocked) throw new Error(`highlight "${label || ""}": the target is behind ${aim.blocked}; close the modal/popup first or highlight something inside it`);
    return demo.highlightBox(aim.box, label, ms, opts);
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
    // Before pressing, re-aim and check the target is really what is under the pointer: the
    // page may have scrolled/re-rendered during the pause, or an app bar/popup may cover it.
    // A silent miss otherwise surfaces several steps later as an unrelated error.
    async click(locator, { slow = false, pauseBefore, pauseAfter, highlight } = {}) {
      const b = await boxOf(locator);
      // Look before the pointer arrives: a cover that only shows on hover (a row action bar,
      // an image overlay) is part of what the user clicks; one that is already there is not.
      const hoverOk = pointerIn(b) || !(await aimAt(locator)).blocked;
      await moveTo(b.x + b.width / 2, b.y + b.height / 2);
      if (highlight) await highlightLocator(locator, highlight, slow ? 2200 : 1400, { keepCursor: true }, hoverOk);
      await sleep(pauseBefore ?? (slow ? 1200 : 400));
      const aim = await waitUncovered(locator, "the click target", hoverOk);
      if (aim.blocked) throw new Error(`click target is covered by ${aim.blocked} at (${Math.round(aim.x)},${Math.round(aim.y)}); close or scroll away what covers it`);
      if (Math.hypot(aim.x - mouse.x, aim.y - mouse.y) > 3) await moveTo(aim.x, aim.y);
      marks.push({ t: now(), label: "click", kind: "click" }); // post.py puts a click sound here
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

    // Highlight just the text that matters inside a big element — a terminal (xterm.js DOM
    // rows), a log, a <pre>, a long paragraph — instead of the whole element.
    // what: string (exact, case-insensitive) or RegExp; within: optional locator to search in.
    // { line: true } widens the box to the whole line the match is on.
    async highlightText(what, label, ms = 2200, { within, line = false, shot } = {}) {
      // spaces in a plain string match any run of whitespace incl. &nbsp; (terminals render spaces as U+00A0)
      const plain = s => ({ s: String(s).trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), f: "i" });
      // a paintext terminal draws Thai sara am as nikhahit + aa (scripts/terminal/thai.cjs): look for that form too
      const srcs = what instanceof RegExp ? [{ s: what.source, f: what.flags.replace("g", "") }]
        : String(what).includes("ำ") ? [plain(what), plain(thaiCells(what))] : [plain(what)];
      const scope = within ? await within.elementHandle() : null;
      const findOne = (src, center) => page.evaluate(({ src, scope, line, center }) => {
        const re = new RegExp(src.s, src.f);
        const rootEl = scope || document.body;
        const LINE = ".xterm-rows > div, tr, li, p, pre, td, th, h1, h2, h3, h4, label, button, div";
        const textNodes = el => {
          const out = [];
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode: n => n.parentElement && !n.parentElement.closest("#__demo_root,#__demo_redact,script,style") ? 1 : 2,
          });
          let n;
          while ((n = w.nextNode())) out.push(n);
          return out;
        };
        // match against whole lines: xterm.js and syntax highlighters split one line over many spans
        const done = new Set();
        let found = null, covered = null;
        // What is on top at the match: the row itself, or a modal/backdrop/toast hiding it
        // (coverInPage, installed just before this call). xterm's own layers never count.
        const coverOf = (row, box) => (window.__demoCoverAt
          ? window.__demoCoverAt(row, { x: box.x + box.width / 2, y: box.y + box.height / 2, allow: ".xterm" }) : null);
        for (const tn of textNodes(rootEl)) {
          if (!tn.nodeValue.trim()) continue;  // layout whitespace under <body> would make the whole page one "row"
          const row = tn.parentElement.closest(LINE) || tn.parentElement;
          if (done.has(row)) continue;
          done.add(row);
          const nodes = textNodes(row);
          const text = nodes.map(n => n.nodeValue).join("");
          const m = re.exec(text);
          if (!m) continue;
          // map match offsets back to (node, offset)
          const at = pos => {
            let acc = 0;
            for (const n of nodes) {
              if (pos <= acc + n.nodeValue.length) return [n, pos - acc];
              acc += n.nodeValue.length;
            }
            const last = nodes[nodes.length - 1];
            return [last, last.nodeValue.length];
          };
          const r = document.createRange();
          r.setStart(...at(m.index));
          r.setEnd(...at(m.index + m[0].length));
          // "nearest" moves the page least; after a covered try, centre it so a sticky
          // header or bottom bar is no longer on top of it
          row.scrollIntoView({ block: center ? "center" : "nearest" });
          const rects = [...r.getClientRects()].filter(x => x.width > 0);
          if (!rects.length) continue;
          const first = rects[0];
          const same = rects.filter(x => Math.abs(x.top - first.top) < 2); // stay on one visual line
          const left = Math.min(...same.map(x => x.left)), right = Math.max(...same.map(x => x.right));
          const rr = row.getBoundingClientRect();
          const box = line ? { x: rr.left, y: first.top, width: rr.width, height: first.height }
            : { x: left, y: first.top, width: right - left, height: first.height };
          const cover = coverOf(row, box);
          if (cover) { covered = covered || cover; continue; } // look for a visible copy (e.g. inside the modal)
          // in a terminal the newest output (lowest match) is the result; an earlier hit is usually the typed command
          if (!row.closest(".xterm-rows")) return { box };
          found = box;
        }
        return found ? { box: found } : covered ? { covered } : null;
      }, { src, scope, line, center });
      const find = async (center = false) => {
        await page.evaluate(COVER_SCRIPT).catch(() => {}); // again each try: the page may have navigated
        let covered = null;
        for (const src of srcs) {
          const r = await findOne(src, center);
          if (r && r.box) return { box: r.box };
          if (r && r.covered) covered = covered || r.covered;
        }
        return covered ? { covered } : null;
      };
      let found = null;
      await demo.waitApp(async () => {
        const start = Date.now();
        // text that is not there yet: up to 30 s; text hidden behind a modal/toast: up to 3 s
        while (!(found = await find(Boolean(found?.covered)))?.box && Date.now() - start < (found?.covered ? 3000 : 30000)) await sleep(250);
      }, "wait for text");
      if (found?.covered) throw new Error(`highlightText "${what}": the text is behind ${found.covered}; close the modal/popup first or highlight text inside it`);
      const b = found?.box;
      if (!b) throw new Error(`highlightText: "${what}" is not on screen as text. A canvas/WebGL terminal draws no DOM text — use xterm.js's DOM renderer (see references/surfaces.md), or highlight a known box with demo.highlightBox().`);
      // point at where the text ends: the eye follows the pointer, and the text stays readable
      await moveTo(b.x + Math.max(b.width - 3, b.width / 2), b.y + b.height / 2);
      return demo.highlightBox(b, label, ms, { shot });
    },

    // highlight(locator, label, ms, { shot: "title" }) also saves a still while it shows.
    // Refuses a target hidden behind a modal/backdrop/toast: the frame would point at something
    // the viewer cannot see. Close the modal in run() first, or highlight something inside it.
    async highlight(locator, label, ms = 2200, opts = {}) {
      // With the pointer already on the target, its own hover overlay is what the viewer sees.
      return highlightLocator(locator, label, ms, opts, pointerIn(await boxOf(locator)));
    },

    // Highlight a box in page pixels ({ x, y, width, height }). Refuses a box covering most of the
    // screen: an orange frame round everything (a whole terminal, a whole page) points at nothing.
    // A cursor standing on the frame or its label is hidden until it moves again; click's own
    // pre-click highlight passes keepCursor, since there the pointer shows what gets pressed.
    async highlightBox(b, label, ms = 2200, { shot, whole = false, keepCursor = false } = {}) {
      if (!whole && b.width * b.height > 0.5 * view.width * view.height) {
        throw new Error(`highlight "${label || ""}" would cover ${Math.round((100 * b.width * b.height) / (view.width * view.height))}% of the screen. ` +
          "Highlight the part that matters: demo.highlightText(text, label) inside terminals/logs/long text, a smaller locator, or pass { whole: true } if the whole screen really is the point.");
      }
      marks.push({ t: now(), end: now() + ms / 1000, label: "highlight: " + (label || ""), kind: "highlight" });
      await page.evaluate(({ b, label, ms, keepCursor }) => {
        const root = document.getElementById("__demo_root");
        if (!root) return;
        const pad = 8;
        const hl = document.createElement("div");
        hl.className = "__demo_hl";
        Object.assign(hl.style, { left: b.x - pad + "px", top: b.y - pad + "px", width: b.width + pad * 2 + "px", height: b.height + pad * 2 + "px" });
        root.appendChild(hl);
        // Nothing explanatory may cover anything else: the label never sits on the highlighted
        // element, the caption or another label, and the caption moves out of the way when it
        // would hide the highlighted element.
        const target = { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 };
        const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
        const hit = (a, c, gap = 6) => a.x < c.x + c.w + gap && c.x < a.x + a.w + gap && a.y < c.y + c.h + gap && c.y < a.y + a.h + gap;
        const area = (a, c) => Math.max(0, Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y));
        const cap = document.getElementById("__demo_caption");
        let movedCaption = null;
        if (cap && cap.style.opacity !== "0" && cap.textContent && hit(rectOf(cap), target, 0)) {
          movedCaption = cap.classList.contains("top");
          cap.classList.toggle("top", target.y + target.h / 2 > window.innerHeight / 2);
        }
        let lab;
        if (label) {
          lab = document.createElement("div");
          lab.className = "__demo_hl_label";
          lab.style.maxWidth = "42vw";
          lab.style.whiteSpace = "normal";
          lab.textContent = label;
          root.appendChild(lab);
          const lw = lab.offsetWidth, lh = lab.offsetHeight, g = 10, W = window.innerWidth, H = window.innerHeight;
          const obstacles = [target];
          if (cap && cap.textContent && cap.style.opacity !== "0") obstacles.push(rectOf(cap));
          document.querySelectorAll(".__demo_hl_label").forEach(o => { if (o !== lab) obstacles.push(rectOf(o)); });
          const cx = target.x + target.w / 2 - lw / 2, cy = target.y + target.h / 2 - lh / 2;
          const candidates = [
            { x: cx, y: target.y - lh - g },                     // above
            { x: cx, y: target.y + target.h + g },               // below
            { x: target.x + target.w + g, y: cy },               // right
            { x: target.x - lw - g, y: cy },                     // left
            { x: target.x, y: target.y - lh - g },               // above, left-aligned
            { x: target.x + target.w - lw, y: target.y + target.h + g }, // below, right-aligned
            { x: target.x + target.w + g, y: target.y },         // right, top-aligned
            { x: target.x - lw - g, y: target.y + target.h - lh },  // left, bottom-aligned
            // the same sides slid sideways, to reach empty space (end of a terminal line, margins)
            ...[120, 240, 360, 480, 640].flatMap(dx => [
              { x: target.x + target.w + g + dx, y: cy },
              { x: cx + dx, y: target.y - lh - g }, { x: cx - dx, y: target.y - lh - g },
              { x: cx + dx, y: target.y + target.h + g }, { x: cx - dx, y: target.y + target.h + g },
            ]),
          ].map(c => ({ x: Math.min(Math.max(8, c.x), W - lw - 8), y: Math.min(Math.max(8, c.y), H - lh - 8), w: lw, h: lh }));
          // page text near the target: a label should land on empty space, not on other content
          const textRects = [];
          const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: n => n.parentElement && n.nodeValue.trim() && !n.parentElement.closest("#__demo_root,#__demo_redact,script,style") ? 1 : 2,
          });
          for (let n; (n = tw.nextNode()) && textRects.length < 3000;) {
            const pr = n.parentElement.getBoundingClientRect();
            if (pr.bottom < 0 || pr.top > H || pr.right < 0 || pr.left > W) continue;
            const rg = document.createRange();
            rg.selectNodeContents(n);
            for (const x of rg.getClientRects()) if (x.width > 0) textRects.push({ x: x.left, y: x.top, w: x.width, h: x.height });
          }
          const covered = c => textRects.reduce((s, t) => s + area(c, t), 0);
          const freeOnes = candidates.filter(c => !obstacles.some(o => hit(c, o)));
          // among spots that touch no box/caption/label, the one covering the least page text
          const free = freeOnes.length ? freeOnes.reduce((a, c) => (covered(c) < covered(a) ? c : a)) : null;
          // nowhere fully free: least covered spot, never on the target itself if avoidable
          const best = free || candidates.slice().sort((a, c) =>
            obstacles.reduce((s, o, i) => s + area(a, o) * (i === 0 ? 10 : 1), 0) -
            obstacles.reduce((s, o, i) => s + area(c, o) * (i === 0 ? 10 : 1), 0))[0];
          Object.assign(lab.style, { left: best.x + "px", top: best.y + "px" });
        }
        const cur = document.getElementById("__demo_cursor");
        if (!keepCursor && cur && !cur.classList.contains("away")) {
          const cr = rectOf(cur);
          if (hit(cr, target, 2) || (lab && hit(cr, rectOf(lab), 2))) {
            cur.classList.remove("rest");
            cur.classList.add("away");
            try { sessionStorage.setItem("__demo_cursor_state", "away"); } catch {}
          }
        }
        setTimeout(() => {
          hl.remove();
          lab && lab.remove();
          if (movedCaption !== null && cap) cap.classList.toggle("top", movedCaption);
        }, ms);
      }, { b, label, ms, keepCursor });
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
        try { sessionStorage.setItem("__demo_caption", JSON.stringify({ text, top })); } catch {}
        const c = document.getElementById("__demo_caption");
        if (!c) return;
        c.textContent = text || "";
        c.classList.toggle("top", !!top);
        c.style.opacity = text ? 1 : 0;
      }, { text, top });
      await sleep(300);
    },

    // Mid-video title card over the app: same look and pacing as the opening card.
    async card({ tag = "", title, lines = [] }, ms) {
      const plan = cardPlan({ tag, title, lines }, { ms });
      marks.push({ t: now(), end: now() + (plan.total + plan.exitMs + 1100) / 1000, label: "card: " + title, kind: "card" });
      await page.evaluate(({ html, css }) => {
        const root = document.getElementById("__demo_root");
        if (!root) return;
        const s = document.createElement("style");
        s.textContent = css;
        const card = document.createElement("div");
        card.className = "demo-card mid";
        card.id = "__demo_card";
        card.innerHTML = html;
        root.appendChild(s);
        root.appendChild(card);
        requestAnimationFrame(() => card.classList.add("on"));
      }, { html: cardInner({ tag, title, lines }), css: cardCss(font, theme) });
      await page.evaluate(playCard, { id: "__demo_card", events: plan.events, exitAt: plan.total });
      await sleep(plan.total + plan.exitMs);
      await page.evaluate(() => {
        const c = document.getElementById("__demo_card");
        if (c) { c.classList.remove("on"); setTimeout(() => c.remove(), 600); }
      });
      await sleep(600);
    },
  };
  return demo;
}

module.exports = { startSession, recordCard, sleep, readMs, cardPlan, accentVars, DEFAULT_FONT, DEFAULT_VIEW, ACCENTS };
