#!/usr/bin/env node
// Re-score a saved round with the CURRENT case graders, without running the agent again:
//   node bench/regrade.mjs <results.json> [--out <file>]
// final_regex and judge graders are recomputed from each run's saved final message; tool graders use
// the saved tool calls; graders that need the workspace (files, commands) keep their old result when
// one with the same name exists. Use it to compare an old round fairly after a grader was fixed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { grade, makeJudge, gradersHash } from "./lib/graders.mjs";
import { scoreRun, scoreCase, runSafe, SCORING_VERSION } from "./lib/score.mjs";
import { claudeEnv } from "./lib/openrouter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function regradeRound(saved, casesByName, { judge }) {
  const out = { round: { ...saved.round, regraded: true, scoring: SCORING_VERSION }, cases: [] };
  for (const c of saved.cases) {
    const def = casesByName[c.name];
    if (!def) continue;
    const nc = { ...c, gradersHash: gradersHash(def.graders), arms: {} };
    for (const [arm, a] of Object.entries(c.arms)) {
      const runs = [];
      for (const x of a.runs) {
        if (x.infraError || x.skipped) { runs.push(x); continue; }
        const toolUses = x.toolUses || (x.tools || []).map(name => ({ name, input: {} }));
        const run = { final: x.final || "", messages: x.messages || [], toolUses, isError: !!x.isError, error: x.error, workspace: null };
        const grades = [];
        for (const g of def.graders) {
          const needsWorkspace = ["file_exists", "file_regex", "command"].includes(g.type);
          const needsInputs = (g.type === "skill_used" || (g.type === "tool_used" && g.input)) && !x.toolUses;
          const old = (x.grades || []).find(o => o.name === (g.name || o.name));
          if ((needsWorkspace || needsInputs) && old) grades.push({ ...old, withOnly: !!g.withOnly, safety: !!g.safety, weight: g.weight ?? 1 });
          else {
            const r = await grade(run, g, { judge });
            // a round saved before tool inputs were kept: the input pattern can't be checked
            grades.push(needsInputs ? { ...r, passed: false, verdict: "UNVERIFIED", detail: `${r.detail}; tool inputs not saved in this round` } : r);
          }
        }
        runs.push({ ...x, grades, score: scoreRun(grades) });
      }
      const done = runs.filter(x => !x.infraError && !x.skipped);
      const s = scoreCase(done.map(x => x.score), done.map(x => runSafe(x.grades, x.score)));
      nc.arms[arm] = { ...a, runs, mean: s.mean, passAll: s.passAll, safety: s.safety };
    }
    nc.delta = nc.arms.with && nc.arms.without && nc.arms.with.mean != null && nc.arms.without.mean != null ? nc.arms.with.mean - nc.arms.without.mean : null;
    out.cases.push(nc);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2);
  const i = process.argv.indexOf("--out");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  const dir = path.join(here, saved.round.skill, "cases");
  const cases = Object.fromEntries(fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, "case.json")))
    .map(n => [n, JSON.parse(fs.readFileSync(path.join(dir, n, "case.json"), "utf8"))]));
  regradeRound(saved, cases, { judge: makeJudge({ env: claudeEnv() }) }).then(r => {
    const dest = i > 0 ? process.argv[i + 1] : file.replace(/\.json$/, ".regraded.json");
    fs.writeFileSync(dest, JSON.stringify(r, null, 2));
    console.log(`regraded ${r.cases.length} cases -> ${dest}`);
  }).catch(e => { console.error(e.message); process.exit(1); });
}
