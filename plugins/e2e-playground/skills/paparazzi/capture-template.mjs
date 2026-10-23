// Template for a manual-screenshot capture script. Copy this into the target
// project's docs folder and fill in the TODOs — do not run it as-is, the
// selectors below are placeholders. See SKILL.md for the technique writeups.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const baseUrl = "http://localhost:3000"; // TODO: this project's dev server
const assets = "docs/assets"; // TODO: where images should land, relative to cwd

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

// --- Log in as a seeded/demo account. Wait for a real "loaded" signal,
// never a fixed sleep. ---
await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
// await page.getByLabel("...").fill("...");
// await page.getByRole("button", { name: "..." }).click();
// await page.waitForURL(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
// await page.getByRole("heading", { name: "..." }).waitFor();

// Freeze animations so repeat runs produce pixel-stable screenshots.
await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });

// --- Plain overview shot ---
await page.screenshot({ path: `${assets}/overview.png`, fullPage: true });

// --- Outline technique: highlight one region ---
const outline = async (locator) => {
  await locator.evaluate((el) => {
    el.style.boxShadow = "inset 0 0 0 4px #b45309";
    el.style.borderRadius = "8px";
  });
};
// const section = page.locator("...");
// await outline(section);
// await section.screenshot({ path: `${assets}/some-section.png` });
// await section.evaluate((el) => el.removeAttribute("style"));

// --- Numbered badges keyed to a step list ---
// Use this when the manual prose says "1. do X   2. do Y   3. do Z" and you
// want a screenshot with matching numbered circles on the real elements.
async function addNumberedBadges(page, steps) {
  // steps: Array<{ selector: string, number: number, within?: string }>
  // `within` optionally scopes `selector` to inside another element's match
  // (e.g. find the first row that actually has the feature, then number
  // things inside THAT row) — pass a function instead of a string when the
  // target isn't a plain CSS match. See SKILL.md's "pick the specific
  // instance" rule before using a bare index like `:nth-child`.
  for (const step of steps) {
    const locator = page.locator(step.selector).first();
    if (await locator.count()) await locator.scrollIntoViewIfNeeded();
  }

  await page.evaluate((steps) => {
    const addBadge = (rect, number) => {
      if (!rect) return;
      const badge = document.createElement("div");
      badge.textContent = String(number);
      badge.style.cssText = `position:fixed;left:${rect.left - 13}px;top:${rect.top - 13}px;
        width:26px;height:26px;border-radius:50%;background:#b45309;color:#fff;
        display:flex;align-items:center;justify-content:center;font:700 14px system-ui;
        box-shadow:0 0 0 2px #fff,0 4px 10px rgba(0,0,0,.35);z-index:10000`;
      document.body.append(badge);
    };
    for (const step of steps) {
      const el = document.querySelector(step.selector);
      addBadge(el?.getBoundingClientRect(), step.number);
    }
  }, steps);
}

// Example call:
// await addNumberedBadges(page, [
//   { selector: '[role="tablist"]', number: 1 },
//   { selector: "table tbody tr:first-child td:first-child", number: 2 },
// ]);
// await page.screenshot({ path: `${assets}/annotated-step.png` });

await browser.close();
