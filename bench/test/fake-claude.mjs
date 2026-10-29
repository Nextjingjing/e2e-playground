#!/usr/bin/env node
// Stand-in for `claude -p ... --output-format stream-json` in unit tests (no network, no cost).
// FAKE_SCENARIO: ok | timeout | error. FAKE_ARGV_FILE: write argv there for assertions.
import fs from "node:fs";

const scenario = process.env.FAKE_SCENARIO || "ok";
if (process.env.FAKE_ARGV_FILE) fs.writeFileSync(process.env.FAKE_ARGV_FILE, JSON.stringify(process.argv.slice(2)));
const out = obj => process.stdout.write(JSON.stringify(obj) + "\n");

out({ type: "system", subtype: "init", cwd: process.cwd(), tools: ["Read", "Glob", "Grep", "Skill"] });
if (scenario === "timeout") setInterval(() => {}, 1000);
else if (scenario === "grandchild") {
  // like claude.exe: a child process that inherits stdout and outlives the parent
  const { spawn } = await import("node:child_process");
  spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: ["ignore", "inherit", "inherit"] });
  setInterval(() => {}, 1000);
}
else {
  out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "e2e-playground:brat-e2e" } }] } });
  out({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: ".env" } }] } });
  // a plan in one message, then a short final question (the final alone would miss the plan)
  out({ type: "assistant", message: { content: [{ type: "text", text: "Plan: use a separate wms_e2e database." }] } });
  out({ type: "assistant", message: { content: [{ type: "text", text: process.env.FAKE_FINAL || "plan text" }] } });
  out({
    type: "result", subtype: scenario === "error" ? "error_during_execution" : "success",
    is_error: scenario === "error", num_turns: 3, duration_ms: 1234,
    result: scenario === "error" ? "" : (process.env.FAKE_FINAL || "plan text"),
    usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 200, output_tokens: 50 },
  });
}
