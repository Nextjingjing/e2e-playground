#!/usr/bin/env node
// Real-run demos for the README: one skill, one model, on a fresh copy of the sample app, with the
// exact OpenRouter cost (usage delta; runs are sequential). The workspace is kept for the artifacts.
//   node bench/demos/run-demo.mjs <skill> <model> [--app <sample app dir>] [--timeout-min 25]
// Writes bench/demos/out/<skill>--<model>.json (cost, time, tokens, turns, final message, workspace).
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runClaude } from "../lib/run-claude.mjs";
import { claudeEnv, openrouterUsage } from "../lib/openrouter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const [skill, model] = process.argv.slice(2);
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const app = path.resolve(opt("--app", path.join(here, "..", "fixtures", "mini-wms")));

// The answers the skill would ask for are given up front: `claude -p` can't ask the user.
const setup = "The app is in the current folder (Express + public/forklift.html + Postgres). Its dev database is already running " +
  "(container app_db_1, localhost:5432, see .env) and is a demo DB that will be reset afterwards, so no backup is needed. " +
  "Docker is not installed; Podman is (`podman compose`). Playwright browsers are already installed on this machine. " +
  "`npm install` is fine. Start the app with `npm run migrate && npm run seed && npm start` (port 3000). Work only inside this folder. " +
  "You can't ask me questions in this session: where a choice comes up, take the option you'd recommend and say so at the end.";
const PROMPTS = {
  "show-and-tell": "Record a short demo video (under a minute) for the team showing order A-001 being sent to Sorting on the Forklift page " +
    "and the row disappearing. One case, English captions and title card. Save the final video as demo-out/send-to-sorting.mp4. " + setup,
  "brat-e2e": "Write e2e tests for send-to-sorting on the Forklift page and make sure they pass. When they pass, save the output of the " +
    "final test run to demo-out/test-run.txt. " + setup,
  "paparazzi": "Make annotated screenshots of the Forklift page for a one-page quick guide: number badges on the waiting-orders table, " +
    "the Send to Sorting button and the status message after sending. Save the PNGs and a short guide.md in demo-out/. " + setup,
};

async function main() {
  if (!PROMPTS[skill] || !model) throw new Error(`usage: run-demo.mjs <${Object.keys(PROMPTS).join("|")}> <model>`);
  // reset the demo DB: every order WAITING, no movements
  try { execSync(`podman exec app_db_1 psql -U postgres -d wms -c "delete from stock_movements; update orders set status='WAITING';"`, { stdio: "ignore" }); } catch {}
  const env = claudeEnv();
  const before = await openrouterUsage();
  const run = await runClaude({ fixtureDir: app, prompt: PROMPTS[skill], withPlugin: true, pluginDir: path.resolve(here, "..", "..", "plugins", "e2e-playground"),
    model, tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"], maxTurns: 120, timeoutMs: Number(opt("--timeout-min", "25")) * 60000, env });
  // the agent may leave the app running; the next demo must start it itself (Windows only)
  try { execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -EA SilentlyContinue | % { taskkill /T /F /PID $_.OwningProcess }"`, { stdio: "ignore" }); } catch {}
  await new Promise(r => setTimeout(r, 20000));  // OpenRouter usage lags a little
  const costUsd = (await openrouterUsage()) - before;
  const out = { skill, model, costUsd, durationMs: run.durationMs, turns: run.turns, tokens: run.tokens, isError: run.isError, error: run.error,
    skillFired: run.toolUses.some(t => t.name === "Skill" && String(t.input.skill || "").endsWith(skill)),
    artifacts: fs.existsSync(path.join(run.workspace, "demo-out")) ? fs.readdirSync(path.join(run.workspace, "demo-out")) : [],
    final: run.final };  // the workspace path is printed, not saved: it holds the local user name
  fs.mkdirSync(path.join(here, "out"), { recursive: true });
  const file = path.join(here, "out", `${skill}--${model.replace(/\//g, "_")}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`${skill} / ${model}: $${costUsd.toFixed(3)}, ${(run.durationMs / 60000).toFixed(1)} min, ${run.turns} turns, artifacts: ${out.artifacts.join(", ") || "none"}${run.isError ? ", ERROR " + run.error : ""}\nworkspace: ${run.workspace}`);
}
main().catch(e => { console.error(e.message); process.exit(1); });
