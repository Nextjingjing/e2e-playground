// Graders: each takes a Run (from run-claude.mjs) and returns { name, passed, scored, weight, withOnly, detail }.
// Deterministic types first; `judge` asks a small model 3 times and passes on a majority of PASS votes.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function globToRegex(glob) {
  const s = glob.replace(/\\/g, "/").split(/(\*\*\/?|\*|\?)/).map(part =>
    part === "**/" || part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(`^${s}$`);
}

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

const regex = g => new RegExp(g.pattern, g.flags || "");
const matches = (g, text) => (g.match === "not_contains" ? !regex(g).test(text) : regex(g).test(text));

const checks = {
  skill_used(run, g) {
    const re = new RegExp(`^(?:[\\w-]+:)?${g.skill}$`);
    const n = run.toolUses.filter(t => t.name === "Skill" && re.test(String(t.input.skill || ""))).length;
    return { passed: n > 0, detail: `${g.skill} invoked ${n}x` };
  },
  tool_used(run, g) {
    const re = g.input ? new RegExp(g.input) : null;
    const n = run.toolUses.filter(t => t.name === g.tool && (!re || re.test(JSON.stringify(t.input)))).length;
    const min = g.min ?? 1, max = g.max ?? Infinity;
    return { passed: n >= min && n <= max, detail: `${g.tool} called ${n}x (expected ${min}..${max})` };
  },
  final_regex(run, g) {
    return { passed: matches(g, run.final), detail: `${g.match || "contains"} /${g.pattern}/` };
  },
  file_exists(run, g) {
    const re = globToRegex(g.glob), hits = listFiles(run.workspace).filter(f => re.test(f));
    const want = g.exists ?? true;
    return { passed: want ? hits.length > 0 : hits.length === 0, detail: `${g.glob}: ${hits.slice(0, 5).join(", ") || "none"}` };
  },
  file_regex(run, g) {
    const p = path.join(run.workspace, g.path);
    if (!fs.existsSync(p)) return { passed: false, detail: `${g.path} missing` };
    return { passed: matches(g, fs.readFileSync(p, "utf8")), detail: `${g.path} ${g.match || "contains"} /${g.pattern}/` };
  },
  command(run, g) {
    try {
      execSync(g.run, { cwd: run.workspace, stdio: "pipe", timeout: g.timeoutMs || 300000 });
      return { passed: (g.expectExit ?? 0) === 0, detail: `${g.run} → exit 0` };
    } catch (e) {
      const code = typeof e.status === "number" ? e.status : -1;
      return { passed: code === (g.expectExit ?? 0), detail: `${g.run} → exit ${code}: ${String(e.stderr || e.message).slice(-200)}` };
    }
  },
  async judge(run, g, { judge }) {
    if (!judge) throw new Error("judge grader needs a judge function");
    const votes = [];
    for (let i = 0; i < 3; i++) {
      try { votes.push(/^\s*PASS\b/i.test(await judge(g.criteria, run.final)) ? "PASS" : "FAIL"); }
      catch (e) { votes.push(`ERROR(${e.message})`); }
    }
    return { passed: votes.filter(v => v === "PASS").length >= 2, detail: `votes: ${votes.join(" ")}` };
  },
};

export async function grade(run, g, ctx = {}) {
  const name = g.name || `${g.type}${g.pattern ? ":" + g.pattern : g.skill ? ":" + g.skill : g.tool ? ":" + g.tool : ""}`;
  const meta = { name, type: g.type, weight: g.weight ?? 1, withOnly: !!g.withOnly, scored: true };
  if (!checks[g.type]) throw new Error(`unknown grader type: ${g.type}`);
  if (run.isError) return { ...meta, passed: false, detail: `run failed: ${run.error}` };
  return { ...meta, ...(await checks[g.type](run, g, ctx)) };
}

export const graderTypes = Object.keys(checks);

// A judge backed by `claude -p` on a small model (through the same isolated env as the agent).
export function makeJudge({ model = "haiku", env = {} } = {}) {
  const bin = process.env.BENCH_CLAUDE_BIN || "claude";
  return (criteria, answer) => new Promise((resolve, reject) => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-judge-"));
    const prompt = `You grade an AI assistant's reply against a rubric. Reply with exactly one word first: PASS or FAIL, then one short sentence why.\n\nRUBRIC:\n${criteria}\n\nREPLY TO GRADE:\n<<<\n${answer}\n>>>`;
    const child = spawn(bin, ["-p", "--model", model, "--output-format", "json", "--setting-sources", "project", "--strict-mcp-config", "--max-turns", "1", "--tools", ""],
      { cwd: configDir, env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: configDir }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    child.on("close", () => {
      fs.rmSync(configDir, { recursive: true, force: true });
      try { const j = JSON.parse(out); if (j.is_error) reject(new Error(j.subtype || "judge error")); else resolve(String(j.result || "")); }
      catch { reject(new Error(`judge gave no JSON: ${err.slice(-200)}`)); }
    });
    child.stdin.end(prompt);
  });
}
