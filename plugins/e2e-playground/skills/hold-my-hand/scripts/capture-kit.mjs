// Helpers for hold-my-hand screenshots. Copy this file AND redact.cjs next to your capture script:
//   import { launch, annotate, clearMarks, around, shot } from "./capture-kit.mjs";
// Resolve playwright from the app's own node_modules so nothing is installed globally:
//   const { page, browser } = await launch({ appPackageJson: "/path/to/your-app/package.json", time: "2026-01-15T10:00:00Z" });
// Credentials / personal data on screen are covered before every shot (redact: { text: ["Real Name"] }
// to add your own; redact: false only for data you know is fake).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const { redactInit, redactConfig } = createRequire(import.meta.url)("./redact.cjs");

export const NO_MOTION = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
const ACCENT = "#b45309";

export async function launch({ appPackageJson, time, timezoneId = "UTC", locale = "en-US", viewport = { width: 1680, height: 1000 }, redact = {} }) {
  const { chromium } = createRequire(appPackageJson)("playwright");
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, timezoneId, locale });
  const rc = redactConfig(redact);
  if (rc) await context.addInitScript(redactInit, rc);
  const page = await context.newPage();
  if (time) await page.clock.install({ time: new Date(time) });
  return { browser, context, page };
}

// What a reader would see at the element's centre: null when it is the element (or its
// child/parent, light or shadow DOM), else "tag#id.class" of what covers it — an open modal,
// its backdrop, a toast. Our own marks and redaction bars are pointer-events:none, so they are
// looked through; a pointer-events:none target (a floating label) is made hittable for the probe.
// Same check as show-and-tell's demo-kit coverInPage (each skill ships standalone).
function coverAtCentre(el) {
  const doc = el.ownerDocument;
  const parentOf = (n) => n.assignedSlot || (n.parentNode && n.parentNode.nodeType === 11 && n.parentNode.host) || n.parentNode;
  const within = (outer, inner) => { for (let n = inner; n; n = parentOf(n)) if (n === outer) return true; return false; };
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
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
  if (getComputedStyle(el).pointerEvents === "none") {
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
  const cls = typeof hit.className === "string" ? hit.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
  return hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + cls.map((c) => "." + c).join("");
}

export async function coveredBy(locator) {
  return locator.evaluate(coverAtCentre);
}

// marks: [{ el: Locator, n?: number, box?: boolean (default true), pos?: "corner" | "left" }]
// Refuses an element hidden behind a modal/backdrop/toast: a badge on something the reader
// cannot see sends them to the wrong place. Close the modal first, or mark what is inside it.
export async function annotate(page, marks) {
  // Scroll every target first, then measure and check each one: scrolling to a later mark can
  // move an earlier one or put something on top of it.
  for (const m of marks) await m.el.scrollIntoViewIfNeeded();
  const rects = [];
  for (const m of marks) {
    const b = await m.el.boundingBox();
    if (!b) throw new Error(`annotate: element for badge ${m.n ?? "-"} is not visible`);
    const cover = await coveredBy(m.el);
    if (cover) throw new Error(`annotate: element for badge ${m.n ?? "-"} is behind ${cover}; close the modal/popup first or mark something inside it`);
    rects.push({ ...b, n: m.n, box: m.box !== false, left: m.pos === "left" });
  }
  await page.evaluate(({ rects, accent }) => {
    // badges never sit on another badge: try the asked spot, then the other corners/side
    const placed = [];
    const clash = (x, y) => placed.some(p => Math.abs(p.x - x) < 36 && Math.abs(p.y - y) < 36); // 28px badge + gap
    const spot = r => {
      const cx = r.x + r.width / 2 - 14;
      const tries = r.left
        ? [[r.x - 40, r.y + r.height / 2 - 14], [r.x - 16, r.y - 16], [cx, r.y - 38], [cx, r.y + r.height + 8]]
        : [[r.x - 16, r.y - 16], [cx, r.y - 38], [r.x + r.width - 12, r.y - 16], [cx, r.y + r.height + 8], [r.x - 40, r.y + r.height / 2 - 14]];
      const free = tries.find(([x, y]) => !clash(x, y)) || tries[0];
      placed.push({ x: free[0], y: free[1] });
      return free;
    };
    for (const r of rects) {
      if (r.box) {
        const o = document.createElement("div");
        o.dataset.annot = "1";
        o.style.cssText = `position:fixed;left:${r.x - 4}px;top:${r.y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid ${accent};border-radius:8px;z-index:99998;pointer-events:none`;
        document.body.append(o);
      }
      if (r.n) {
        const b = document.createElement("div");
        b.dataset.annot = "1";
        b.textContent = String(r.n);
        const [x, y] = spot(r);
        b.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:28px;height:28px;border-radius:50%;background:${accent};color:#fff;display:flex;align-items:center;justify-content:center;font:700 15px system-ui;box-shadow:0 0 0 2px #fff,0 3px 8px rgba(0,0,0,.35);z-index:99999;pointer-events:none`;
        document.body.append(b);
      }
    }
  }, { rects, accent: ACCENT });
}

export const clearMarks = (page) => page.evaluate(() => document.querySelectorAll("[data-annot]").forEach((e) => e.remove()));

// Tight clip around locators (e.g. table header + one row), clamped to the viewport.
export async function around(page, locators, pad = 24) {
  const boxes = [];
  for (const l of locators) {
    const b = await l.boundingBox();
    if (!b) throw new Error("around: a locator is not visible");
    boxes.push(b);
  }
  const vp = page.viewportSize();
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// clip undefined = full viewport (good for modals)
export async function shot(page, outDir, name, clip) {
  fs.mkdirSync(outDir, { recursive: true });
  await page.screenshot({ path: path.join(outDir, `${name}.png`), clip });
  console.log("saved", name);
}
