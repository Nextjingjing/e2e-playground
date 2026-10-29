#!/usr/bin/env node
// Run one real case, then cached editing. App-specific facts belong in case.cjs.
// Usage: node run-case.cjs path/to/case.cjs [--retake | --edit-only]
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

class CaseError extends Error {}
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const fileHash = file => hash(fs.readFileSync(file));

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
  if (options.editOnly && options.retake) throw new CaseError("choose --edit-only or --retake, not both");
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
  try {
    const job = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : { schema: 1 };
    if (!job || Array.isArray(job) || typeof job !== "object") throw new CaseError("invalid job checkpoint");
    const caseKey = options.caseKey;
    if (!caseKey) throw new CaseError("caseKey is required to resume safely");
    let record = job.record;
    if (options.editOnly && !record) throw new CaseError("edit-only needs a completed recording; no actions were run");
    if (record && !options.retake) {
      if ((!options.editOnly && record.caseKey !== caseKey) || record.stage !== "recorded" || !fs.existsSync(record.video)
          || !fs.existsSync(record.card) || fileHash(record.video) !== record.videoHash
          || fileHash(record.card) !== record.cardHash)
        throw new CaseError("case changed or take is incomplete; use --edit-only for editing/verification changes, --retake only for new actions");
    } else {
      const attempts = (record?.attempts || 0) + 1;
      if (attempts > 2) throw new CaseError("two recording attempts used; stop and report before consuming more data");
      const outDir = `${stem}.work/take-${attempts}`;
      fs.mkdirSync(outDir, { recursive: true });
      record = job.record = { attempts, caseKey, stage: "setup", verification: "pending" };
      job.status = "recording";
      saveJob(jobPath, job);
      const kit = options.kit || require("./demo-kit.cjs");
      let session;
      try {
        if (config.setup) await config.setup();
        const projectDir = path.resolve(baseDir, config.projectDir || ".");
        record.card = await kit.recordCard({ ...config.title, outDir, name: "card", projectDir,
          ...(config.font ? { font: config.font } : {}), ...(config.view ? { view: config.view } : {}) });
        record.stage = "recording";
        saveJob(jobPath, job);
        session = await kit.startSession({ projectDir, outDir, name: "case", baseURL: config.baseURL,
          startUrl: config.startUrl || "/", login: config.login, redact: config.redact || {},
          ...(config.font ? { font: config.font } : {}), ...(config.view ? { view: config.view } : {}) });
        await config.run({ page: session.page, demo: session.demo });
        record.video = await session.finish();
        record.videoHash = fileHash(record.video);
        record.cardHash = fileHash(record.card);
        record.stage = "recorded";
        saveJob(jobPath, job);
        if (config.verify) {
          if (await config.verify() !== true) throw new CaseError("verification did not return true; fix the result and resume without --retake");
          record.verification = "passed";
        } else record.verification = "not-configured";
      } catch (error) {
        if (record.stage !== "recorded") record.stage = "failed";
        job.status = record.stage === "recorded" ? "needs-verification" : "recording-failed";
        saveJob(jobPath, job); // Store the phase, never the app's error text or config/login values.
        throw error;
      } finally {
        if (session) await session.browser.close().catch(() => {});
      }
    }
    if (record.verification === "pending") {
      if (!config.verify || await config.verify() !== true)
        throw new CaseError("verification still pending; resume after checking the real result");
      record.verification = "passed";
    }
    saveJob(jobPath, job);
    const summary = await (options.edit || editRecording)(config, record, output);
    return { ...summary, verification: record.verification, attempts: record.attempts };
  } finally {
    fs.unlinkSync(lock);
  }
}

async function main(args) {
  if (!args.length || args.includes("--help")) {
    console.log("Usage: node run-case.cjs CASE.cjs [--retake | --edit-only]\nCopy assets/case-template.cjs. --edit-only resumes a changed case without replaying actions; --retake allows a second take.");
    return;
  }
  if (args.length > 2 || (args[1] && !["--retake", "--edit-only"].includes(args[1])))
    throw new CaseError("unknown arguments; use --help");
  const file = path.resolve(args[0]);
  const config = require(file);
  const summary = await runCase(config, { caseKey: fileHash(file), baseDir: path.dirname(file),
    retake: args.includes("--retake"), editOnly: args.includes("--edit-only") });
  console.log(JSON.stringify(summary));
}

module.exports = { runCase };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof CaseError ? error.message : "case failed; inspect the phase in OUT.job.json (app error text omitted to protect secrets)");
  process.exitCode = 1;
});
