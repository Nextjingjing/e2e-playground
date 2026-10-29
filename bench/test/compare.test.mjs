import test from "node:test";
import assert from "node:assert/strict";
import { compareRounds } from "../compare.mjs";

const round = (extra = {}) => ({ commit: "a", model: "m", judge: "j", effort: "medium", skillWords: 1000, descriptionWords: 80, ...extra });
const kase = (name, mean, extra = {}) => ({ name, tags: [], arms: { with: { mean, passAll: mean === 1 }, without: { mean: 0.5 } }, delta: mean - 0.5,
  costUsd: { with: 0.1 }, durationMs: { with: 30000 }, ...extra });

test("flags worse, better and noise by the one-run-in-three rule", () => {
  const a = { round: round(), cases: [kase("x", 1), kase("y", 1 / 3), kase("z", 2 / 3)] };
  const b = { round: round({ commit: "b" }), cases: [kase("x", 2 / 3), kase("y", 2 / 3), kase("z", 2 / 3)] };
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

test("warns when a case's graders differ between rounds or are unknown", () => {
  const a = { round: round(), cases: [kase("same", 1, { gradersHash: "h1" }), kase("changed", 1, { gradersHash: "h1" }), kase("old", 1)] };
  const b = { round: round(), cases: [kase("same", 1, { gradersHash: "h1" }), kase("changed", 1, { gradersHash: "h2" }), kase("old", 1, { gradersHash: "h3" })] };
  const out = compareRounds(a, b);
  const notes = n => out.rows.find(r => r.name === n).notes.join(" ");
  assert.equal(notes("same"), "");
  assert.match(notes("changed"), /graders changed/);
  assert.match(notes("old"), /graders unknown/);
  assert.match(out.warnings.join(" "), /2 case\(s\) graded differently/);
});

test("warns when the scoring rules differ; rounds without the field count as version 1", () => {
  const out = compareRounds({ round: round(), cases: [] }, { round: round({ scoring: 2 }), cases: [] });
  assert.match(out.warnings.join(" "), /scoring rules differ: v1 → v2/);
  assert.equal(compareRounds({ round: round({ scoring: 2 }), cases: [] }, { round: round({ scoring: 2 }), cases: [] }).warnings.length, 0);
});

test("UNVERIFIED safety is its own flag, not a pass and not a regression", () => {
  const a = { round: round(), cases: [kase("s", 1, { tags: ["safety"] })] };
  const b = { round: round(), cases: [kase("s", 1, { tags: ["safety"], arms: { with: { mean: 1, passAll: false, safety: "unverified" }, without: { mean: 0 } } })] };
  assert.equal(compareRounds(a, b).rows[0].flag, "UNVERIFIED");
});

test("warns when the rounds saved different evidence or come from different suites", async () => {
  const { evidenceOf } = await import("../compare.mjs");
  const oldRound = { round: round(), cases: [kase("x", 1, { arms: { with: { mean: 1, runs: [{ final: "f" }] } } })] };
  const newRound = { round: round({ evidence: { messages: true, toolInputs: true }, suite: "brat-e2e" }), cases: [] };
  assert.deepEqual(evidenceOf(oldRound), { messages: false, toolInputs: false });
  const out = compareRounds(oldRound, newRound);
  assert.match(out.warnings.join(" "), /evidence differs: messages/);
  assert.match(compareRounds({ round: round({ suite: "brat-e2e" }), cases: [] }, { round: round({ suite: "qa-decisions" }), cases: [] }).warnings.join(" "), /different suites/);
});
