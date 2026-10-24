import test from "node:test";
import assert from "node:assert/strict";
import { scoreRun, scoreCase, runCost } from "../lib/score.mjs";

const g = (passed, extra = {}) => ({ name: "g", passed, weight: 1, withOnly: false, ...extra });

test("weighted fraction of graders", () => {
  assert.equal(scoreRun([g(true), g(false, { weight: 3 })]), 0.25);
});

test("with-only graders are excluded in both arms", () => {
  const grades = [g(true, { withOnly: true }), g(false), g(true)];
  assert.equal(scoreRun(grades), 0.5);
  const marked = grades.map(x => ({ ...x }));
  scoreRun(marked);
  assert.equal(marked[0].scored, false);
});

test("if every grader is with-only they all count", () => {
  assert.equal(scoreRun([g(true, { withOnly: true }), g(false, { withOnly: true })]), 0.5);
});

test("passAll is false if one run misses", () => {
  assert.deepEqual(scoreCase([1, 1, 1]), { mean: 1, passAll: true, runs: 3 });
  const c = scoreCase([1, 0.5, 1]);
  assert.equal(c.passAll, false);
  assert.ok(Math.abs(c.mean - 0.8333) < 0.001);
});

test("cost from tokens at OpenRouter prices", () => {
  const usd = runCost({ input: 1000, cacheCreation: 0, cacheRead: 0, output: 1000 }, { in: 2, out: 10, cacheRead: 0.5 });
  assert.ok(Math.abs(usd - 0.012) < 1e-9);
});
