const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const RECORD = path.join(__dirname, "..", "agent-log", "record.cjs");

test("agent-log replay still films a Claude Code run", { timeout: 120000 }, () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "paintext-agent-"));
  fs.cpSync(path.join(__dirname, "fixtures", "agent-run"), work, { recursive: true });
  execFileSync(process.execPath, [RECORD, work], { stdio: "pipe" });
  const kinds = JSON.parse(fs.readFileSync(path.join(work, "replay.json"), "utf8")).items.map(i => i.kind);
  for (const k of ["text", "tool", "result"]) assert.ok(kinds.includes(k), `no ${k} item in ${kinds}`);
  assert.equal(fs.readdirSync(path.join(work, "replay")).filter(f => f.endsWith(".webm")).length, 1);
});
