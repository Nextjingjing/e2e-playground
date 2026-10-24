import test from "node:test";
import assert from "node:assert/strict";
import { regradeRound } from "../regrade.mjs";

const round = () => ({
  round: { skill: "s", spendUsd: 1 },
  cases: [{ name: "c", tags: [], arms: { with: { runs: [
    { i: 0, final: "uses PowerShell", tools: ["Skill"], toolUses: [{ name: "Skill", input: { skill: "s" } }], score: 0, grades: [] },
    { i: 1, final: "uses bash", tools: [], score: 0, grades: [] },
    { i: 2, infraError: true },
  ] } } }],
});

test("re-scores saved finals with the current graders, skipping infra errors", async () => {
  const cases = { c: { name: "c", graders: [{ type: "final_regex", pattern: "powershell", flags: "i" }] } };
  const out = await regradeRound(round(), cases, {});
  const runs = out.cases[0].arms.with.runs;
  assert.equal(runs[0].score, 1);
  assert.equal(runs[1].score, 0);
  assert.equal(out.cases[0].arms.with.mean, 0.5);
  assert.equal(out.round.regraded, true);
});

test("cases missing from the current suite are dropped", async () => {
  const out = await regradeRound(round(), {}, {});
  assert.equal(out.cases.length, 0);
});
