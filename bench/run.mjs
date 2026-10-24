#!/usr/bin/env node
// Benchmark runner: every case × arm (with / without the plugin) × run, graded and aggregated.
//   node bench/run.mjs [--skill brat-e2e] [--tag cheap] [--case name] [--runs 3] [--arms with,without]
//                      [-j 3] [--max-usd 3] [--model openai/gpt-6.1-sol] [--effort medium] [--keep]
// Writes bench/results/<stamp>/results.json and summary.md. Needs OPENROUTER_API_KEY.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runClaude } from "./lib/run-claude.mjs";
import { grade, makeJudge } from "./lib/graders.mjs";
import { scoreRun, scoreCase, runCost } from "./lib/score.mjs";
import { claudeEnv, openrouterUsage } from "./lib/openrouter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// USD / 1M tokens, from OpenRouter's /api/v1/models pricing (prompt, completion, input_cache_write, input_cache_read)
const PRICES = { "openai/gpt-6.1-sol": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.1 } };

function loadCases(root, skill, { tag, caseName } = {}) {
  const dir = path.join(root, skill, "cases");
  return fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, "case.json")))
    .map(n => ({ runs: 3, maxTurns: 15, timeoutSec: 300, tools: ["Read", "Glob", "Grep", "Skill"], tags: [], ...JSON.parse(fs.readFileSync(path.join(dir, n, "case.json"), "utf8")) }))
    .filter(c => (!tag || c.tags.includes(tag)) && (!caseName || c.name === caseName));
}

function wordCounts(skillFile) {
  const text = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, "utf8") : "";
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const words = s => (s.match(/\S+/g) || []).length;
  const desc = m ? (m[1].match(/^description:\s*(.*)$/m) || [, ""])[1] : "";
  return { skillWords: words(m ? m[2] : text), descriptionWords: words(desc) };
}

async function pool(jobs, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, n) }, async () => { while (i < jobs.length) await fn(jobs[i++]); }));
}

export async function runSuite(o) {
  if (o.claudeBin) process.env.BENCH_CLAUDE_BIN = o.claudeBin;
  const model = o.model || "openai/gpt-6.1-sol";
  const cases = loadCases(o.root, o.skill, o);
  const usage0 = await o.usage();
  const results = cases.map(c => ({ name: c.name, tags: c.tags, arms: Object.fromEntries(o.arms.map(a => [a, { runs: [] }])) }));
  const jobs = [];
  cases.forEach((c, ci) => { for (const arm of o.arms) for (let i = 0; i < (o.runs || c.runs); i++) jobs.push({ c, ci, arm, i }); });

  await pool(jobs, o.concurrency, async ({ c, ci, arm, i }) => {
    const slot = results[ci].arms[arm].runs;
    const spent = (await o.usage()) - usage0;
    if (spent >= o.maxUsd) { slot.push({ i, skipped: "budget" }); return; }
    const run = await runClaude({ fixtureDir: path.join(o.root, "fixtures", c.fixture), prompt: c.prompt, withPlugin: arm === "with",
      pluginDir: o.pluginDir, model, tools: c.tools, maxTurns: c.maxTurns, timeoutMs: c.timeoutSec * 1000, env: o.env || {} });
    const grades = [];
    for (const g of c.graders) grades.push(await grade(run, g, { judge: o.judge }));
    const score = scoreRun(grades);
    slot.push({ i, score, grades, tokens: run.tokens, turns: run.turns, durationMs: run.durationMs,
      isError: run.isError, error: run.error, final: run.final, tools: run.toolUses.map(t => t.name),
      costUsd: runCost(run.tokens, PRICES[model] || PRICES["openai/gpt-6.1-sol"]) });
    if (!o.keep) fs.rmSync(run.workspace, { recursive: true, force: true });
    if (!o.quiet) console.log(`${c.name} [${arm} #${i + 1}] score ${score.toFixed(2)}${run.isError ? " ERROR " + run.error : ""}`);
  });

  for (const r of results) {
    for (const arm of Object.keys(r.arms)) {
      const a = r.arms[arm], done = a.runs.filter(x => !x.skipped).sort((x, y) => x.i - y.i);
      const s = scoreCase(done.map(x => x.score));
      a.mean = s.mean; a.passAll = s.passAll;
      a.runs = a.runs.sort((x, y) => x.i - y.i);
      r.tokens = r.tokens || {}; r.durationMs = r.durationMs || {}; r.costUsd = r.costUsd || {};
      r.tokens[arm] = done.reduce((t, x) => ({ input: t.input + x.tokens.input, cacheCreation: t.cacheCreation + x.tokens.cacheCreation, cacheRead: t.cacheRead + x.tokens.cacheRead, output: t.output + x.tokens.output }), { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 });
      r.durationMs[arm] = done.length ? Math.round(done.reduce((s, x) => s + x.durationMs, 0) / done.length) : null;
      r.costUsd[arm] = done.reduce((s, x) => s + x.costUsd, 0);
    }
    r.delta = r.arms.with && r.arms.without && r.arms.with.mean != null && r.arms.without.mean != null ? r.arms.with.mean - r.arms.without.mean : null;
  }

  let commit = "unknown";
  try { commit = execSync("git rev-parse --short HEAD", { cwd: o.root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch {}
  const round = { date: new Date().toISOString(), commit, skill: o.skill, model, judge: o.judgeModel || "anthropic/claude-haiku-5.5",
    effort: o.effort || "medium", arms: o.arms, ...wordCounts(o.skillFile), spendUsd: (await o.usage()) - usage0 };
  const dir = path.join(o.out, round.date.replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  const out = { round, cases: results };
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(dir, "summary.md"), summary(out));
  return { ...out, dir };
}

const f2 = v => (v == null ? "–" : v.toFixed(2));
export function summary({ round, cases }) {
  const lines = [`# ${round.skill} benchmark ${round.date}`, "",
    `commit ${round.commit} · agent ${round.model} (effort ${round.effort}) · judge ${round.judge}`,
    `SKILL.md ${round.skillWords} words · description ${round.descriptionWords} words · OpenRouter spend $${round.spendUsd.toFixed(4)}`, "",
    "| case | with | without | Δ | safety pass^k | tokens out (with) | avg s (with) | est. $ (with) |", "|---|---|---|---|---|---|---|---|"];
  for (const c of cases) {
    const w = c.arms.with || {}, wo = c.arms.without || {};
    lines.push(`| ${c.name} | ${f2(w.mean)} | ${f2(wo.mean)} | ${f2(c.delta)} | ${c.tags.includes("safety") ? (w.passAll ? "yes" : "**NO**") : ""} | ${c.tokens.with ? c.tokens.with.output : "–"} | ${c.durationMs.with != null ? (c.durationMs.with / 1000).toFixed(0) : "–"} | ${c.costUsd.with != null ? c.costUsd.with.toFixed(3) : "–"} |`);
  }
  return lines.join("\n") + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const skill = opt("--skill", "brat-e2e");
  const env = claudeEnv({ effort: opt("--effort", "medium") });
  runSuite({
    root: here, skill, tag: opt("--tag"), caseName: opt("--case"), runs: opt("--runs") ? Number(opt("--runs")) : undefined,
    arms: opt("--arms", "with,without").split(","), concurrency: Number(opt("-j", "3")), maxUsd: Number(opt("--max-usd", "3")),
    model: opt("--model", "openai/gpt-6.1-sol"), effort: opt("--effort", "medium"), keep: argv.includes("--keep"),
    pluginDir: path.resolve(here, "..", "plugins", "e2e-playground"), skillFile: path.resolve(here, "..", "plugins", "e2e-playground", "skills", skill, "SKILL.md"),
    out: path.join(here, "results"), env, usage: openrouterUsage, judge: makeJudge({ env }),
  }).then(r => { console.log(`\n${summary(r)}\nresults: ${r.dir}`); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
