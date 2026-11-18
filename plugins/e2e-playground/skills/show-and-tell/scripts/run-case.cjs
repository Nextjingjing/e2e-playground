#!/usr/bin/env node
// Run one real case, then cached editing. App-specific facts belong in case.cjs.
// Usage: node run-case.cjs path/to/case.cjs [--retake | --edit-only | --setup-only]
// Progress goes to <output stem>.progress.log, one line per phase/caption; watch it with
// watch-case.cjs so a failed or stuck run is noticed in seconds, not hours.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

class CaseError extends Error {}
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const fileHash = file => hash(fs.readFileSync(file));
const MAX_SETUP_FAILURES = 3;

// First two lines of an error, without colour codes, env secrets or known redaction text.
// Goes to the local progress log/stderr only, never to the job checkpoint.
function scrub(error, extra = []) {
  let text = String(error?.message ?? error ?? "").replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n").map(line => line.trim()).filter(Boolean).slice(0, 2).join(" | ");
  const secrets = Object.entries(process.env)
    .filter(([name, value]) => /PASS|TOKEN|SECRET|KEY|COOKIE|AUTH|CRED/i.test(name) && value && value.length >= 4)
    .map(([, value]) => value);
  for (const value of [...secrets, ...extra].filter(v => typeof v === "string" && v.length >= 3))
    text = text.split(value).join("[redacted]");
  return text.slice(0, 300) || "(no message)";
}

function progressLog(file) {
  const t0 = Date.now();
  fs.writeFileSync(file, "");
  const log = (kind, text = "") => {
    const stamp = new Date().toTimeString().slice(0, 8);
    const line = `${stamp} +${Math.round((Date.now() - t0) / 1000)}s ${kind}${text ? " " + String(text).replace(/\s+/g, " ").trim() : ""}`;
    try { fs.appendFileSync(file, line + "\n"); } catch {}
  };
  log("RUN", `pid=${process.pid} at=${t0}`);
  return log;
}

function saveJob(file, job) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(job, null, 2));
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

async function editRecording(config, record, output) {
  const args = [path.join(__dirname, "post.py"), "finish", record.video, output, "--card", record.card];
  if (config.music) args.push("--music");
  if (config.seed !== undefined) args.push("--seed", String(config.seed));
  if (config.reviewTimes?.length) args.push("--times", ...config.reviewTimes.map(String));
  const python = process.env.DEMO_PYTHON || (process.platform === "win32" ? "python" : "python3");
  try {
    const { stdout } = await promisify(execFile)(python, args, { windowsHide: true, maxBuffer: 1 << 20 });
    return JSON.parse(stdout);
  } catch {
    throw new CaseError("editing failed; recording was kept. Run post.py finish directly to inspect the editing error");
  }
}

async function runCase(config, options = {}) {
  if ([options.editOnly, options.retake, options.setupOnly].filter(Boolean).length > 1)
    throw new CaseError("choose one of --edit-only, --retake or --setup-only");
  if (config.redact === false) throw new CaseError("redaction must stay enabled (redact: false is refused)");
  if (typeof config.run !== "function" || !config.output || !config.title?.title)
    throw new CaseError("case needs output, title.title and an async run({page, demo}) function");
  if (config.verify !== undefined && typeof config.verify !== "function")
    throw new CaseError("verify must be an async function returning true");
  const url = new URL(config.baseURL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new CaseError("baseURL must be HTTP(S) without credentials; login reads environment variables");
  const baseDir = options.baseDir || process.cwd();
  const output = path.resolve(baseDir, config.output);
  if (!output.toLowerCase().endsWith(".mp4")) throw new CaseError("output must end in .mp4");
  const stem = output.slice(0, -4);
  const jobPath = `${stem}.job.json`;
  const lock = `${jobPath}.lock`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try { fs.closeSync(fs.openSync(lock, "wx")); }
  catch (error) {
    if (error.code === "EEXIST") throw new CaseError("output is locked by another run; check it stopped before removing the .lock file");
    throw error;
  }
  const log = progressLog(`${stem}.progress.log`);
  const redactText = (config.redact && config.redact.text) || [];
  let phase = "start";
  try {
    if (options.setupOnly) {
      // Rehearse off-camera setup alone: no take is used, but setup may still consume data.
      phase = "setup";
      log("SETUP", "rehearsal (--setup-only), no recording");
      if (typeof config.setup !== "function") throw new CaseError("case has no setup() to rehearse");
      await config.setup({ log: text => log("SETUP", text) });
      log("DONE", "setup-only ok");
      return { setup: "ok" };
    }
    const job = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : { schema: 1 };
    if (!job || Array.isArray(job) || typeof job !== "object") throw new CaseError("invalid job checkpoint");
    const caseKey = options.caseKey;
    if (!caseKey) throw new CaseError("caseKey is required to resume safely");
    let record = job.record;
    if (options.editOnly && !record) throw new CaseError("edit-only needs a completed recording; no actions were run");
    // Setup runs off camera before the title card: a setup failure did not film anything,
    // so it re-uses the same take number (capped separately) instead of burning a take.
    const setupRetry = record?.stage === "setup-failed" && !options.editOnly;
    if (record && !options.retake && !setupRetry) {
      if ((!options.editOnly && record.caseKey !== caseKey) || record.stage !== "recorded" || !fs.existsSync(record.video)
          || !fs.existsSync(record.card) || fileHash(record.video) !== record.videoHash
          || fileHash(record.card) !== record.cardHash)
        throw new CaseError("case changed or take is incomplete; use --edit-only for editing/verification changes, --retake only for new actions");
    } else {
      const setupFailures = setupRetry ? (record.setupFailures || 0) : 0;
      if (setupFailures >= MAX_SETUP_FAILURES)
        throw new CaseError(`setup failed ${setupFailures} times; rehearse it with --setup-only, then report before consuming more data`);
      const attempts = setupRetry ? record.attempts : (record?.attempts || 0) + 1;
      if (attempts > 2) throw new CaseError("two recording attempts used; stop and report before consuming more data");
      const outDir = `${stem}.work/take-${attempts}`;
      fs.mkdirSync(outDir, { recursive: true });
      record = job.record = { attempts, caseKey, stage: "setup", verification: "pending", ...(setupFailures ? { setupFailures } : {}) };
      job.status = "recording";
      saveJob(jobPath, job);
      log("TAKE", `${attempts} of 2${setupFailures ? ` (setup retry ${setupFailures + 1})` : ""}`);
      const kit = options.kit || require("./demo-kit.cjs");
      let session;
      try {
        phase = "setup";
        log("SETUP", "start");
        if (config.setup) await config.setup({ log: text => log("SETUP", text) });
        log("SETUP", "ok");
        phase = "title";
        record.stage = "title";
        const projectDir = path.resolve(baseDir, config.projectDir || ".");
        record.card = await kit.recordCard({ ...config.title, outDir, name: "card", projectDir,
          ...(config.font ? { font: config.font } : {}), ...(config.view ? { view: config.view } : {}) });
        record.stage = "recording";
        saveJob(jobPath, job);
        phase = "recording";
        log("REC", "title ok, recording actions");
        session = await kit.startSession({ projectDir, outDir, name: "case", baseURL: config.baseURL,
          startUrl: config.startUrl || "/", login: config.login, redact: config.redact || {},
          ...(config.font ? { font: config.font } : {}), ...(config.view ? { view: config.view } : {}) });
        const demo = session.demo;
        if (demo && typeof demo.caption === "function") {
          // "STEP 4/9" when a storyboard of this exact case file exists, else "STEP 4".
          let planned = null;
          try {
            const board = JSON.parse(fs.readFileSync(`${stem}.storyboard.json`, "utf8"));
            if (board.caseKey === caseKey && board.steps > 0 && !board.stopped) planned = board.steps;
          } catch {}
          const caption = demo.caption.bind(demo);
          let step = 0;
          demo.caption = (text, opts) => {
            if (text) log("STEP", `${++step}${planned ? "/" + planned : ""} ${text}`);
            return caption(text, opts);
          };
        }
        await config.run({ page: session.page, demo });
        record.video = await session.finish();
        record.videoHash = fileHash(record.video);
        record.cardHash = fileHash(record.card);
        record.stage = "recorded";
        saveJob(jobPath, job);
        log("REC", "actions recorded");
        phase = "verify";
        if (config.verify) {
          if (await config.verify() !== true) throw new CaseError("verification did not return true; fix the result and resume without --retake");
          record.verification = "passed";
          log("VERIFY", "passed");
        } else record.verification = "not-configured";
      } catch (error) {
        if (record.stage === "setup") {
          record.stage = "setup-failed";
          record.setupFailures = setupFailures + 1;
          job.status = "setup-failed";
        } else {
          if (record.stage !== "recorded") record.stage = "failed";
          job.status = record.stage === "recorded" ? "needs-verification" : "recording-failed";
        }
        if (session?.page?.screenshot) {
          const shot = path.join(outDir, "fail.png");
          if (await session.page.screenshot({ path: shot }).then(() => true, () => false)) log("SHOT", shot);
        }
        saveJob(jobPath, job); // Store the phase, never the app's error text or config/login values.
        throw error;
      } finally {
        if (session) await session.browser.close().catch(() => {});
      }
    }
    phase = "verify";
    if (record.verification === "pending") {
      if (!config.verify || await config.verify() !== true)
        throw new CaseError("verification still pending; resume after checking the real result");
      record.verification = "passed";
    }
    saveJob(jobPath, job);
    phase = "edit";
    log("EDIT", "start");
    const summary = await (options.edit || editRecording)(config, record, output);
    log("DONE", `${summary.video || output} ${summary.seconds ?? ""}s status=${summary.status || "?"}`);
    return { ...summary, verification: record.verification, attempts: record.attempts };
  } catch (error) {
    log("FAIL", `${phase}: ${scrub(error, redactText)}`);
    throw error;
  } finally {
    fs.unlinkSync(lock);
  }
}

async function main(args) {
  if (!args.length || args.includes("--help")) {
    console.log("Usage: node run-case.cjs CASE.cjs [--storyboard | --setup-only | --retake | --edit-only]\nCopy assets/case-template.cjs. --storyboard previews scenes and length without a browser; --setup-only rehearses setup() without recording; --retake allows a second take; --edit-only resumes a changed case without replaying actions.\nWatch it: node watch-case.cjs OUT.mp4");
    return null;
  }
  if (args.length > 2 || (args[1] && !["--retake", "--edit-only", "--setup-only", "--storyboard"].includes(args[1])))
    throw new CaseError("unknown arguments; use --help");
  const file = path.resolve(args[0]);
  const config = require(file);
  if (args[1] === "--storyboard") {
    const { storyboard } = require("./storyboard.cjs");
    const board = await storyboard(config, { caseFile: file, caseKey: fileHash(file), baseDir: path.dirname(file) });
    console.log(board.markdown + `\n\n(saved ${board.file})`);
    return null;
  }
  return runCase(config, { caseKey: fileHash(file), baseDir: path.dirname(file),
    retake: args.includes("--retake"), editOnly: args.includes("--edit-only"), setupOnly: args.includes("--setup-only") });
}

// Always exit explicitly: a browser or connection left open by case code (e.g. setup())
// otherwise keeps Node alive forever, and whoever waits for the exit waits for nothing.
function exitWith(stream, text, code) {
  const done = () => process.exit(code);
  setTimeout(done, 2000).unref();
  if (text) stream.write(text + "\n", done); else done();
}

module.exports = { runCase, scrub };
if (require.main === module) main(process.argv.slice(2)).then(
  summary => exitWith(process.stdout, summary ? JSON.stringify(summary) : "", 0),
  error => exitWith(process.stderr, error instanceof CaseError ? error.message
    : `case failed: ${scrub(error)} (phase in OUT.job.json, details in OUT.progress.log)`, 1));
