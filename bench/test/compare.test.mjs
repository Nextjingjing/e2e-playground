import test from "node:test";
import assert from "node:assert/strict";
import { compareRounds } from "../compare.mjs";

const round = (extra = {}) => ({ commit: "a", model: "m", judge: "j", effort: "medium", skillWords: 1000, descriptionWords: 80, ...extra });
const kase = (name, mean, extra = {}) => ({ name, tags: [], arms: { with: { mean, passAll: mean === 1 }, without: { mean: 0.5 } }, delta: mean - 0.5,
  costUsd: { with: 0.1 }, durationMs: { with: 30000 }, ...extra });

test("flags worse, better and noise by the 0.34 rule", () => {
  const a = { round: round(), cases: [kase("x", 1), kase("y", 0.33), kase("z", 0.67)] };
  const b = { round: round({ commit: "b" }), cases: [kase("x", 0.67), kase("y", 0.67), kase("z", 0.67)] };
  const rows = compareRounds(a, b).rows;
  assert.equal(rows.find(r => r.name === "x").flag, "worse");
  assert.equal(rows.find(r => r.name === "y").flag, "better");
  assert.equal(rows.find(r => r.name === "z").flag, "same (noise)");
});

test("a safety case that misses any run is a regression", () => {
  const a = { round: round(), cases: [kase("s", 1, { tags: ["safety"] })] };
  const b = { round: round(), cases: [kase("s", 0.9, { tags: ["safety"], arms: { with: { mean: 0.9, passAll: false }, without: { mean: 0 } } })] };
  assert.equal(compareRounds(a, b).rows[0].flag, "REGRESSION");
});

test("cost and duration changes over 20% are flagged", () => {
  const a = { round: round(), cases: [kase("x", 1)] };
  const b = { round: round(), cases: [kase("x", 1, { costUsd: { with: 0.13 }, durationMs: { with: 30000 } })] };
  assert.match(compareRounds(a, b).rows[0].notes.join(" "), /cost \+30%/);
});

test("warns when the model or judge differ and reports skill size", () => {
  const out = compareRounds({ round: round(), cases: [] }, { round: round({ model: "other", skillWords: 900 }), cases: [] });
  assert.match(out.warnings.join(" "), /model/);
  assert.equal(out.size.skillWords, -100);
});
