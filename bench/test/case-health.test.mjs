import test from "node:test";
import assert from "node:assert/strict";
import { caseHealth } from "../case-health.mjs";

const run = (loaded, passed) => ({ grades: [{ type: "skill_used", name: "skill fired", passed: loaded }, { type: "judge", name: "g", passed }] });
const round = (withRuns, withoutRuns) => ({ cases: [{ name: "c", arms: { with: { runs: withRuns }, without: { runs: withoutRuns } } }] });

test("splits with-arm runs by whether the skill loaded and labels the grader", () => {
  const [row] = caseHealth([round([run(true, true), run(true, true), run(false, false)], [run(false, false), run(false, false), run(false, true)])]);
  assert.deepEqual(row.loaded, [2, 2]);
  assert.deepEqual(row.notLoaded, [0, 1]);
  assert.deepEqual(row.without, [1, 3]);
  assert.equal(row.verdict, "separates");
});

test("no signal and inverse", () => {
  assert.equal(caseHealth([round([run(true, true)], [run(false, true)])])[0].verdict, "no signal");
  assert.equal(caseHealth([round([run(true, false), run(true, false)], [run(false, true), run(false, true)])])[0].verdict, "inverse");
});

test("errored and infra runs are left out", () => {
  const [row] = caseHealth([round([run(true, true), { isError: true, grades: [] }, { infraError: true }], [run(false, false)])]);
  assert.deepEqual(row.loaded, [1, 1]);
});
