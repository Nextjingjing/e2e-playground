#!/usr/bin/env node
// Compare two benchmark rounds:  node bench/compare.mjs <old results.json> <new results.json>
// Flags per case: REGRESSION (a safety case missed any run), worse / better (with-arm mean moved
// by ≥ 0.34, i.e. at least one of three runs flipped), else "same (noise)". Cost or duration
// changes over 20 % are noted. Prints the SKILL.md / description word-count change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STEP = 0.34;
const pct = (a, b) => (a ? Math.round(((b - a) / a) * 100) : 0);

export function compareRounds(a, b) {
  const warnings = [];
  for (const k of ["model", "judge", "effort"]) if (a.round[k] !== b.round[k]) warnings.push(`${k} differs: ${a.round[k]} → ${b.round[k]} (scores are not directly comparable)`);
  const size = { skillWords: b.round.skillWords - a.round.skillWords, descriptionWords: b.round.descriptionWords - a.round.descriptionWords };
  const old = new Map(a.cases.map(c => [c.name, c]));
  const rows = b.cases.map(c => {
    const o = old.get(c.name), w = c.arms.with || {}, ow = (o && o.arms.with) || {};
    let flag;
    if (c.tags.includes("safety") && w.passAll === false) flag = "REGRESSION";
    else if (!o || ow.mean == null || w.mean == null) flag = "new";
    else if (w.mean - ow.mean <= -STEP) flag = "worse";
    else if (w.mean - ow.mean >= STEP) flag = "better";
    else flag = "same (noise)";
    const notes = [];
    if (o && o.costUsd && c.costUsd && Math.abs(pct(o.costUsd.with, c.costUsd.with)) > 20) notes.push(`cost ${pct(o.costUsd.with, c.costUsd.with) > 0 ? "+" : ""}${pct(o.costUsd.with, c.costUsd.with)}%`);
    if (o && o.durationMs && c.durationMs && Math.abs(pct(o.durationMs.with, c.durationMs.with)) > 20) notes.push(`time ${pct(o.durationMs.with, c.durationMs.with) > 0 ? "+" : ""}${pct(o.durationMs.with, c.durationMs.with)}%`);
    return { name: c.name, oldMean: ow.mean ?? null, newMean: w.mean ?? null, delta: c.delta, flag, notes };
  });
  return { warnings, size, rows, spend: { old: a.round.spendUsd, new: b.round.spendUsd } };
}

const f2 = v => (v == null ? "–" : v.toFixed(2));
export function formatComparison(r, a, b) {
  const s = n => (n > 0 ? `+${n}` : `${n}`);
  return [
    `old ${a.round.commit} (${a.round.date}) → new ${b.round.commit} (${b.round.date})`,
    ...r.warnings.map(w => `WARNING: ${w}`),
    `SKILL.md words ${a.round.skillWords} → ${b.round.skillWords} (${s(r.size.skillWords)}), description ${a.round.descriptionWords} → ${b.round.descriptionWords} (${s(r.size.descriptionWords)})`,
    `OpenRouter spend per round $${(r.spend.old ?? 0).toFixed(3)} → $${(r.spend.new ?? 0).toFixed(3)}`, "",
    "| case | with (old → new) | Δ vs no skill | flag | notes |", "|---|---|---|---|---|",
    ...r.rows.map(x => `| ${x.name} | ${f2(x.oldMean)} → ${f2(x.newMean)} | ${f2(x.delta)} | ${x.flag} | ${x.notes.join(", ")} |`),
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [fa, fb] = process.argv.slice(2);
  if (!fa || !fb) { console.error("usage: node bench/compare.mjs <old results.json> <new results.json>"); process.exit(2); }
  const a = JSON.parse(fs.readFileSync(fa, "utf8")), b = JSON.parse(fs.readFileSync(fb, "utf8"));
  const r = compareRounds(a, b);
  console.log(formatComparison(r, a, b));
  process.exit(r.rows.some(x => x.flag === "REGRESSION") ? 1 : 0);
}
