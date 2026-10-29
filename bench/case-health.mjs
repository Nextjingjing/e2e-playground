#!/usr/bin/env node
// Does each grader tell the skill apart from no skill? Pools saved rounds and prints, per grader,
// how often it passed when the skill loaded, when it was available but didn't load, and without it.
//   node bench/case-health.mjs bench/rounds/<a>.json bench/rounds/<b>.json ...
// "no signal": passes about as often without the skill as with it loaded (a guard at best; it also
// shrinks the case's Δ). "inverse": passes less often with the skill loaded: the skill hurts here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GAP = 1 / 3;  // smaller than one run in three flipping is noise (see README "Observed noise")

export function caseHealth(rounds) {
  const t = new Map();
  for (const r of rounds) for (const c of (Array.isArray(r.cases) ? r.cases : Object.values(r.cases))) {
    for (const [arm, a] of Object.entries(c.arms)) for (const x of a.runs || []) {
      if (x.isError || x.infraError || x.skipped || !x.grades) continue;
      const loaded = x.grades.some(g => g.type === "skill_used" && g.passed);
      const bucket = arm === "without" ? "without" : loaded ? "loaded" : "notLoaded";
      for (const g of x.grades) {
        if (g.type === "skill_used") continue;
        const k = `${c.name} :: ${g.name}`;
        if (!t.has(k)) t.set(k, { case: c.name, grader: g.name, loaded: [0, 0], notLoaded: [0, 0], without: [0, 0] });
        const b = t.get(k)[bucket];
        b[1]++; if (g.passed) b[0]++;
      }
    }
  }
  return [...t.values()].map(row => {
    const rate = ([p, n]) => (n ? p / n : null);
    const w = rate(row.loaded), wo = rate(row.without);
    const verdict = w == null || wo == null ? "not enough data" : w - wo >= GAP ? "separates" : wo - w >= GAP ? "inverse" : "no signal";
    return { ...row, verdict };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error("usage: node bench/case-health.mjs <round.json> [...]"); process.exit(2); }
  const rows = caseHealth(files.map(f => JSON.parse(fs.readFileSync(f, "utf8"))));
  const f = ([p, n]) => (n ? `${p}/${n}` : "–");
  console.log("| case :: grader | skill loaded | available, not loaded | without | verdict |\n|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.case} :: ${r.grader} | ${f(r.loaded)} | ${f(r.notLoaded)} | ${f(r.without)} | ${r.verdict} |`);
}
