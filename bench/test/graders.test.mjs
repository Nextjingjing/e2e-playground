import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { grade } from "../lib/graders.mjs";

function run(extra = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bench-g-"));
  fs.mkdirSync(path.join(workspace, "e2e"));
  fs.writeFileSync(path.join(workspace, "e2e", "test-db.js"), "if (!/_e2e$/.test(db)) throw new Error('refuse');\n");
  return { workspace, final: "Use a separate wms_e2e database.", toolUses: [
    { name: "Skill", input: { skill: "e2e-playground:brat-e2e" } },
    { name: "Read", input: { file_path: ".env" } },
    { name: "Read", input: { file_path: "README.md" } },
  ], isError: false, ...extra };
}

test("skill_used matches plain and namespaced names", async () => {
  assert.equal((await grade(run(), { type: "skill_used", skill: "brat-e2e" })).passed, true);
  assert.equal((await grade(run(), { type: "skill_used", skill: "paparazzi" })).passed, false);
});

test("tool_used counts with input regex, min and max", async () => {
  assert.equal((await grade(run(), { type: "tool_used", tool: "Read", input: "\\.env", min: 1 })).passed, true);
  assert.equal((await grade(run(), { type: "tool_used", tool: "Read", min: 3 })).passed, false);
  assert.equal((await grade(run(), { type: "tool_used", tool: "Write", min: 0, max: 0 })).passed, true);
});

test("final_regex contains and not_contains", async () => {
  assert.equal((await grade(run(), { type: "final_regex", pattern: "_e2e" })).passed, true);
  assert.equal((await grade(run(), { type: "final_regex", pattern: "staging-db", match: "not_contains" })).passed, true);
  assert.equal((await grade(run(), { type: "final_regex", pattern: "SEPARATE", flags: "i" })).passed, true);
});

test("file_exists and file_regex look in the workspace", async () => {
  const r = run();
  assert.equal((await grade(r, { type: "file_exists", glob: "e2e/*.js" })).passed, true);
  assert.equal((await grade(r, { type: "file_exists", glob: "e2e/*.spec.js", exists: false })).passed, true);
  assert.equal((await grade(r, { type: "file_regex", path: "e2e/test-db.js", pattern: "_e2e" })).passed, true);
  assert.equal((await grade(r, { type: "file_regex", path: "missing.js", pattern: "x" })).passed, false);
});

test("command passes on the expected exit code", async () => {
  const r = run();
  assert.equal((await grade(r, { type: "command", run: "node -e \"process.exit(0)\"" })).passed, true);
  assert.equal((await grade(r, { type: "command", run: "node -e \"process.exit(3)\"" })).passed, false);
  assert.equal((await grade(r, { type: "command", run: "node -e \"process.exit(3)\"", expectExit: 3 })).passed, true);
});

test("judge majority and errors", async () => {
  const seq = answers => { let i = 0; return async () => { const a = answers[i++]; if (a instanceof Error) throw a; return a; }; };
  const g = { type: "judge", criteria: "PASS if it uses a separate DB" };
  assert.equal((await grade(run(), g, { judge: seq(["PASS", "FAIL", "PASS"]) })).passed, true);
  const bad = await grade(run(), g, { judge: seq(["PASS", new Error("api down"), "FAIL"]) });
  assert.equal(bad.passed, false);
  assert.match(bad.detail, /api down/);
});

test("an errored run fails every grader", async () => {
  const r = run({ isError: true, error: "timeout" });
  assert.equal((await grade(r, { type: "final_regex", pattern: "_e2e" })).passed, false);
});

test("weight and withOnly are carried into the result", async () => {
  const res = await grade(run(), { type: "skill_used", skill: "brat-e2e", weight: 2, withOnly: true });
  assert.equal(res.weight, 2);
  assert.equal(res.withOnly, true);
});
