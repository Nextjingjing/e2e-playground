#!/usr/bin/env node
// Compare two benchmark rounds:  node bench/compare.mjs <old results.json> <new results.json>
// Flags per case: REGRESSION (a safety case missed any run), worse / better (with-arm mean moved
// by ≥ 1/3, i.e. at least one of three runs flipped), else "same (noise)". Cost or duration
// changes over 20 % are noted. Prints the SKILL.md / description word-count change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STEP = 1 / 3 - 1e-9;  // one of three runs flipping moves the mean by exactly 1/3
const pct = (a, b) => (a ? Math.round(((b - a) / a) * 100) : 0);

// What a round saved to grade from. Older rounds lack the field: read it off their runs.
export function evidenceOf(r) {
  if (r.round.evidence) return r.round.evidence;
  const runs = r.cases.flatMap(c => Object.values(c.arms).flatMap(a => a.runs || []));
  return { messages: runs.some(x => Array.isArray(x.messages)), toolInputs: runs.some(x => Array.isArray(x.toolUses)) };
}

export function compareRounds(a, b) {
  const warnings = [];
  if ((a.round.suite || a.round.skill) !== (b.round.suite || b.round.skill)) warnings.push(`different suites: ${a.round.suite || a.round.skill} → ${b.round.suite || b.round.skill}`);
  const ea = evidenceOf(a), eb = evidenceOf(b);
  for (const k of ["messages", "toolInputs"]) if (ea[k] !== eb[k]) warnings.push(`evidence differs: ${k} saved ${ea[k] ? "yes" : "no"} → ${eb[k] ? "yes" : "no"} (graders reading it see different input; some verdicts are UNVERIFIED in the older round)`);
  for (const k of ["model", "judge", "effort"]) if (a.round[k] !== b.round[k]) warnings.push(`${k} differs: ${a.round[k]} → ${b.round[k]} (scores are not directly comparable)`);
  // rounds from before the field existed were scored by version 1
  const sa = a.round.scoring ?? 1, sb = b.round.scoring ?? 1;
  if (sa !== sb) warnings.push(`scoring rules differ: v${sa} → v${sb} (run regrade.mjs on the older round first)`);
  const size = { skillWords: b.round.skillWords - a.round.skillWords, descriptionWords: b.round.descriptionWords - a.round.descriptionWords };
  const old = new Map(a.cases.map(c => [c.name, c]));
  const rows = b.cases.map(c => {
    const o = old.get(c.name), w = c.arms.with || {}, ow = (o && o.arms.with) || {};
    let flag;
    // safety: rounds before scoring v3 only have passAll
    const safety = w.safety || (w.passAll === false ? "fail" : w.passAll ? "pass" : undefined);
    if (c.tags.includes("safety") && safety === "fail") flag = "REGRESSION";
    else if (c.tags.includes("safety") && safety === "unverified") flag = "UNVERIFIED";
    else if (!o || ow.mean == null || w.mean == null) flag = "new";
    else if (w.mean - ow.mean <= -STEP) flag = "worse";
    else if (w.mean - ow.mean >= STEP) flag = "better";
    else flag = "same (noise)";
    const notes = [];
    // graders changed (or a round saved before fingerprints): the means measure different things
    if (o && (!o.gradersHash || !c.gradersHash)) notes.push("graders unknown in one round: regrade it first");
    else if (o && o.gradersHash !== c.gradersHash) notes.push("graders changed: regrade the old round first");
    if (o && o.configHash && c.configHash && o.configHash !== c.configHash) notes.push("case setup changed (prompt, fixture, tools or limits)");
    if (o && o.costUsd && c.costUsd && Math.abs(pct(o.costUsd.with, c.costUsd.with)) > 20) notes.push(`cost ${pct(o.costUsd.with, c.costUsd.with) > 0 ? "+" : ""}${pct(o.costUsd.with, c.costUsd.with)}%`);
    if (o && o.durationMs && c.durationMs && Math.abs(pct(o.durationMs.with, c.durationMs.with)) > 20) notes.push(`time ${pct(o.durationMs.with, c.durationMs.with) > 0 ? "+" : ""}${pct(o.durationMs.with, c.durationMs.with)}%`);
    return { name: c.name, oldMean: ow.mean ?? null, newMean: w.mean ?? null, delta: c.delta, flag, notes };
  });
  const changed = rows.filter(x => x.notes.some(n => n.startsWith("graders"))).length;
  if (changed) warnings.push(`${changed} case(s) graded differently in the two rounds: run regrade.mjs on the old round before comparing`);
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
