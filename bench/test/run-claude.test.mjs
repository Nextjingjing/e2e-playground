import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude } from "../lib/run-claude.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.BENCH_CLAUDE_BIN = `node ${JSON.stringify(path.join(here, "fake-claude.mjs"))}`;

function fixture() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "bench-fx-"));
  fs.writeFileSync(path.join(d, ".env"), "DATABASE_URL=postgres://app:****@staging-db.internal:5432/wms\n");
  fs.writeFileSync(path.join(d, "README.md"), "# app\n");
  return d;
}
const base = () => ({ fixtureDir: fixture(), prompt: "plan it", withPlugin: true, pluginDir: "/plugin", model: "m", tools: ["Read"], maxTurns: 5, timeoutMs: 20000 });

test("parses tools, tokens and final message", async () => {
  process.env.FAKE_SCENARIO = "ok";
  const run = await runClaude(base());
  assert.equal(run.isError, false);
  assert.equal(run.final, "plan text");
  assert.deepEqual(run.toolUses.map(t => t.name), ["Skill", "Read"]);
  assert.equal(run.toolUses[0].input.skill, "e2e-playground:brat-e2e");
  assert.deepEqual(run.tokens, { input: 10, cacheCreation: 100, cacheRead: 200, output: 50 });
  assert.equal(run.turns, 3);
  assert.ok(run.durationMs >= 0);
});

test("copies dotfiles into the workspace", async () => {
  process.env.FAKE_SCENARIO = "ok";
  const run = await runClaude(base());
  assert.ok(fs.existsSync(path.join(run.workspace, ".env")));
  assert.ok(fs.existsSync(path.join(run.workspace, ".git")), "workspace is a git repo");
});

test("records a timeout as an error run", async () => {
  process.env.FAKE_SCENARIO = "timeout";
  const run = await runClaude({ ...base(), timeoutMs: 2000 });
  assert.equal(run.isError, true);
  assert.match(run.error, /timeout/i);
});

test("a timeout returns promptly even when a grandchild holds stdout", async () => {
  process.env.FAKE_SCENARIO = "grandchild";
  const t0 = Date.now();
  const run = await runClaude({ ...base(), timeoutMs: 2000 });
  assert.equal(run.isError, true);
  assert.match(run.error, /timeout/i);
  assert.ok(Date.now() - t0 < 12000, `took ${Date.now() - t0} ms`);
});

test("records an API error as an error run", async () => {
  process.env.FAKE_SCENARIO = "error";
  const run = await runClaude(base());
  assert.equal(run.isError, true);
});

test("passes --plugin-dir only with the plugin", async () => {
  process.env.FAKE_SCENARIO = "ok";
  const argvFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bench-argv-")), "argv.json");
  process.env.FAKE_ARGV_FILE = argvFile;
  await runClaude(base());
  assert.ok(JSON.parse(fs.readFileSync(argvFile, "utf8")).includes("--plugin-dir"));
  await runClaude({ ...base(), withPlugin: false });
  assert.ok(!JSON.parse(fs.readFileSync(argvFile, "utf8")).includes("--plugin-dir"));
  const argv = JSON.parse(fs.readFileSync(argvFile, "utf8"));
  for (const flag of ["--setting-sources", "--strict-mcp-config", "--output-format", "--model"]) assert.ok(argv.includes(flag), flag);
  delete process.env.FAKE_ARGV_FILE;
});
