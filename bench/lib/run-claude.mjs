// Run one benchmark case: copy the fixture into a fresh workspace and run an isolated
// `claude -p` there (no user settings, plugins, CLAUDE.md, hooks or memory), reading its
// stream-json. The prompt goes in on stdin, so no shell quoting is involved.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function claudeCommand() {
  const bin = process.env.BENCH_CLAUDE_BIN || "claude";
  const m = bin.match(/^node\s+"?(.+?)"?$/);  // tests: `node "fake-claude.mjs"`
  return m ? [process.execPath, [m[1]]] : [bin, []];
}

export async function runClaude({ fixtureDir, prompt, withPlugin, pluginDir, model, tools = [], maxTurns = 15, timeoutMs = 300000, env = {} }) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bench-ws-"));
  fs.cpSync(fixtureDir, workspace, { recursive: true });  // includes dotfiles such as .env
  const git = args => execFileSync("git", args, { cwd: workspace, stdio: "ignore" });
  git(["init", "-q"]); git(["add", "-A"]); git(["-c", "user.email=bench@local", "-c", "user.name=bench", "commit", "-qm", "fixture", "--allow-empty"]);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-cfg-"));

  const args = ["-p", "--model", model, "--output-format", "stream-json", "--verbose",
    "--setting-sources", "project", "--strict-mcp-config", "--max-turns", String(maxTurns)];
  if (tools.length) args.push("--allowedTools", ...tools);
  if (withPlugin) args.push("--plugin-dir", pluginDir);

  const [cmd, pre] = claudeCommand();
  const started = Date.now();
  const run = { workspace, final: "", toolUses: [], turns: 0, durationMs: 0, tokens: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }, isError: false, error: "" };

  await new Promise(resolve => {
    const child = spawn(cmd, [...pre, ...args], { cwd: workspace, env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: configDir }, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "", stderr = "", gotResult = false, done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); run.durationMs = Date.now() - started; resolve(); };
    // On Windows claude.exe can leave a child holding stdout, so "close" may never come (a round saw
    // 1450 s runs with a 300 s limit): kill the whole tree and stop waiting a few seconds later.
    const timer = setTimeout(() => {
      run.isError = true; run.error = `timeout after ${timeoutMs} ms`;
      if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch {} }
      else child.kill("SIGKILL");
      setTimeout(finish, 5000);
    }, timeoutMs);
    child.stdout.on("data", d => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        const content = ev.message && Array.isArray(ev.message.content) ? ev.message.content : [];
        if (ev.type === "assistant") for (const c of content) if (c.type === "tool_use") run.toolUses.push({ name: c.name, input: c.input || {} });
        if (ev.type === "result") {
          gotResult = true;
          run.final = ev.result || "";
          run.turns = ev.num_turns || 0;
          const u = ev.usage || {};
          run.tokens = { input: u.input_tokens || 0, cacheCreation: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 };
          if (ev.is_error) { run.isError = true; run.error = run.error || ev.subtype || "error"; }
        }
      }
    });
    child.stderr.on("data", d => { stderr += d; });
    child.on("close", code => {
      if (!gotResult && !run.isError) { run.isError = true; run.error = `exited ${code} without a result: ${stderr.slice(-300)}`; }
      finish();
    });
    child.stdin.end(prompt);
  });
  try { fs.rmSync(configDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
  return run;
}
