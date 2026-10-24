import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSuite } from "../run.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function suite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bench-suite-"));
  fs.mkdirSync(path.join(root, "fixtures", "tiny"), { recursive: true });
  fs.writeFileSync(path.join(root, "fixtures", "tiny", "README.md"), "# tiny\n");
  const c = path.join(root, "brat-e2e", "cases", "tiny-case");
  fs.mkdirSync(c, { recursive: true });
  fs.writeFileSync(path.join(c, "case.json"), JSON.stringify({
    name: "tiny-case", tags: ["brat-e2e", "cheap"], prompt: "plan", fixture: "tiny", runs: 2,
    graders: [{ type: "skill_used", skill: "brat-e2e", withOnly: true }, { type: "final_regex", pattern: "plan" }],
  }));
  return root;
}

const opts = (root, extra = {}) => ({
  root, skill: "brat-e2e", pluginDir: path.join(root, "plugin"), out: path.join(root, "results"),
  arms: ["with", "without"], concurrency: 2, maxUsd: 5, judge: async () => "PASS",
  usage: async () => 1.0, claudeBin: `node ${JSON.stringify(path.join(here, "fake-claude.mjs"))}`,
  skillFile: path.join(root, "SKILL.md"), quiet: true, ...extra,
});

test("end to end with the fake CLI writes results and a summary", async () => {
  process.env.FAKE_SCENARIO = "ok";
  const root = suite();
  fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: brat-e2e\ndescription: Use when testing things end to end\n---\n# body words here\n");
  const res = await runSuite(opts(root));
  const c = res.cases[0];
  assert.equal(c.name, "tiny-case");
  assert.equal(c.arms.with.runs.length, 2);
  assert.equal(c.arms.with.mean, 1);
  assert.equal(c.arms.without.mean, 1);   // with-only skill grader excluded in both arms
  assert.equal(c.delta, 0);
  assert.ok(c.tokens.with.output > 0);
  assert.ok(res.round.skillWords > 0 && res.round.descriptionWords > 0);
  assert.ok(fs.existsSync(path.join(res.dir, "results.json")));
  assert.ok(fs.existsSync(path.join(res.dir, "summary.md")));
});

test("an infra error (no turns) is retried once, then kept out of the score", async () => {
  process.env.FAKE_SCENARIO = "timeout";
  const root = suite();
  const c = path.join(root, "brat-e2e", "cases", "tiny-case", "case.json");
  fs.writeFileSync(c, JSON.stringify({ ...JSON.parse(fs.readFileSync(c, "utf8")), runs: 1, timeoutSec: 1 }));
  fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: x\ndescription: y\n---\n");
  const res = await runSuite(opts(root, { arms: ["with"] }));
  const a = res.cases[0].arms.with;
  assert.equal(a.runs[0].infraError, true);
  assert.equal(a.runs[0].attempts, 2);
  assert.equal(a.mean, null, "no scored runs");
  assert.equal(a.infraErrors, 1);
});

test("stops starting runs past max-usd", async () => {
  process.env.FAKE_SCENARIO = "ok";
  const root = suite();
  fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: x\ndescription: y\n---\n");
  let calls = 0;
  const res = await runSuite(opts(root, { concurrency: 1, maxUsd: 0.5, usage: async () => 1.0 + 0.4 * calls++ }));
  const all = [...res.cases[0].arms.with.runs, ...res.cases[0].arms.without.runs];
  assert.ok(all.some(r => r.skipped === "budget"), "some runs skipped for budget");
  assert.ok(all.some(r => !r.skipped), "the first run still happened");
});
