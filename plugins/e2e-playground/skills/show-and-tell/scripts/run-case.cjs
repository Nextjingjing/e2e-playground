#!/usr/bin/env node
// Run one real case, then cached editing. App-specific facts belong in case.cjs.
// Usage: node run-case.cjs path/to/case.cjs [--retake | --edit-only | --setup-only]
// Progress goes to <output stem>.progress.log, one line per phase/caption; watch it with
// watch-case.cjs so a failed or stuck run is noticed in seconds, not hours.
// Takes on one machine run one at a time (the next one prints QUEUE and waits), and a take
// with no sign of progress for stallSeconds (default 300) fails itself instead of waiting.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { redactConfig } = require("./redact.cjs");

class CaseError extends Error {}
class StallError extends Error {}
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const fileHash = file => hash(fs.readFileSync(file));
const MAX_SETUP_FAILURES = 3;
const MAX_REHEARSALS = 3;
const EDIT_BEAT_MS = 60000;
const EDIT_BEAT_MAX_S = 20 * 60; // then go quiet, so a hung encoder still shows up as STALL
const STALL_S = 300;             // setup/recording/verify with no progress this long = stuck
const QUEUE_NOTE_MS = 60000;     // a QUEUE line this often, below the watcher's --stall
const QUEUE_MAX_MS = 45 * 60000;

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Takes on one machine run one at a time. Two takes against the same app and database can
// lock each other for good (2026-11-18: cases filmed in parallel deadlocked and nobody was
// told), and two filmed browsers also compete for the CPU. Each waiter writes a QUEUE line
// to its own progress log. A turn whose runner is gone is taken over. Resolves to release().
async function takeTurn(dir, output, log, { pollMs = 1000, noteMs = QUEUE_NOTE_MS, maxMs = QUEUE_MAX_MS } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "take.lock");
  const id = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const started = Date.now();
  let noted = -Infinity;
  for (;;) {
    try {
      const fd = fs.openSync(file, "wx");
      try { fs.writeSync(fd, JSON.stringify({ id, pid: process.pid, output, at: Date.now() })); } finally { fs.closeSync(fd); }
      return () => { try { if (JSON.parse(fs.readFileSync(file, "utf8")).id === id) fs.rmSync(file, { force: true }); } catch {} };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let holder = null;
    try { holder = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    if (Number.isInteger(holder?.pid) && !alive(holder.pid)) { fs.rmSync(file, { force: true }); continue; }
    if (!holder) { // being written this instant, or a half-written file left by a crash
      let age = 0;
      try { age = Date.now() - fs.statSync(file).mtimeMs; } catch { continue; }
      if (age > 10000) { fs.rmSync(file, { force: true }); continue; }
    }
    const who = holder ? `the take of pid ${holder.pid} (${path.basename(String(holder.output || "?"))})` : "another take";
    const waited = Date.now() - started;
    if (waited >= maxMs) throw new CaseError(`waited ${Math.round(waited / 60000)} min for ${who} on this machine; read its progress log, and stop it if it is stuck`);
    if (Date.now() - noted >= noteMs) { log("QUEUE", `waiting for ${who}: takes on one machine run one at a time`); noted = Date.now(); }
    await sleep(pollMs);
  }
}

// A setup() or app that waits for a lock nobody releases never fails by itself: it waits
// forever, and the watcher can only print STALL. guard() fails such a phase once nothing
// has happened for limitMs. Progress lines and every kit call count as something happening.
function watchdog(limitMs, lastLine) {
  let last = Date.now();
  return {
    bump() { last = Date.now(); },
    guard(promise, phase) {
      last = Date.now();
      let timer;
      const stuck = new Promise((_, reject) => {
        timer = setInterval(() => {
          const quiet = Date.now() - last;
          if (quiet >= limitMs) reject(new StallError(`no progress for ${Math.round(quiet / 1000)}s in ${phase}; last: ${lastLine()}. ` +
            "Probably waiting on the app or on a database lock held by another process (tests, a script, another agent); stopped"));
        }, Math.max(20, Math.min(1000, limitMs / 5)));
      });
      return Promise.race([promise, stuck]).finally(() => clearInterval(timer));
    },
  };
}

// Hide what the video hides: the case's redact.text/patterns, the built-in patterns (emails,
// tokens, ids, phones...) and the values of login/secret environment variables, all
// case-insensitive. Used for every app or case text that reaches the log or stderr.
function redactText(text, redact) {
  if (Array.isArray(redact)) redact = { text: redact }; // older callers passed redact.text alone
  const cfg = redactConfig(redact && typeof redact === "object" ? redact : {});
  const envValues = Object.entries(process.env)
    .filter(([name, value]) => /PASS|TOKEN|SECRET|KEY|COOKIE|AUTH|CRED|USER|LOGIN|EMAIL/i.test(name) && value && value.length >= 4)
    .map(([, value]) => ({ src: escapeRegex(value), flags: "gi" }));
  let out = String(text);
  for (const p of [...envValues, ...cfg.patterns]) {
    try { out = out.replace(new RegExp(p.src, p.flags.includes("g") ? p.flags : p.flags + "g"), "[redacted]"); } catch {}
  }
  return out;
}

// First two lines of an error, without colour codes, secrets or personal data.
// Goes to the local progress log/stderr only, never to the job checkpoint.
function scrub(error, redact) {
  const text = String(error?.message ?? error ?? "").replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n").map(line => line.trim()).filter(Boolean).slice(0, 2).join(" | ");
  return redactText(text, redact).slice(0, 300) || "(no message)";
}

// The lock holds the runner's pid. A lock whose runner is gone (killed, crashed) is stale and
// is cleared here, so nobody ever has to delete it by hand.
function takeLock(lock) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lock, "wx");
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() })); } finally { fs.closeSync(fd); }
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let holder = null;
      try { holder = JSON.parse(fs.readFileSync(lock, "utf8")); } catch {}
      if (attempt === 0 && Number.isInteger(holder?.pid) && !alive(holder.pid)) { fs.rmSync(lock, { force: true }); continue; }
      throw new CaseError(Number.isInteger(holder?.pid)
        ? `output is in use by run pid ${holder.pid}; wait for it to end or stop that process (the lock clears itself once it is gone)`
        : "output is locked by an older runner that recorded no pid; report it to the user instead of deleting the lock");
    }
  }
}

function progressLog(file) {
  const t0 = Date.now();
  // Start a fresh log. If another program holds it open, append instead (the watcher reads
  // from the newest RUN line) rather than failing the run over a log file.
  try { fs.writeFileSync(file, ""); } catch {}
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

// post.py finish arguments. Music is on by default (cozy) and a soft click sound marks every
// real click; the case turns them off with music: false / clickSound: false.
function editArgs(config, record, output) {
  const args = [path.join(__dirname, "post.py"), "finish", record.video, output, "--card", record.card];
  if (config.music === false) args.push("--no-music");
  else args.push("--music-style", typeof config.music === "string" ? config.music : "cozy");
  if (config.clickSound === false) args.push("--no-clicks");
  if (config.seed !== undefined) args.push("--seed", String(config.seed));
  if (config.reviewTimes?.length) args.push("--times", ...config.reviewTimes.map(String));
  return args;
}

async function editRecording(config, record, output) {
  const args = editArgs(config, record, output);
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
  if (![undefined, false, true, "cozy", "calm"].includes(config.music))
    throw new CaseError('music must be false, true (cozy), "cozy" or "calm"');
  if (![undefined, true, false].includes(config.clickSound)) throw new CaseError("clickSound must be true or false");
  const stallSeconds = config.stallSeconds ?? STALL_S;
  if (!(typeof stallSeconds === "number" && stallSeconds > 0))
    throw new CaseError("stallSeconds must be a positive number of seconds");
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
  takeLock(lock);
  let log = () => {};
  let phase = "start";
  let lastLine = "RUN";
  const wd = watchdog(stallSeconds * 1000, () => lastLine);
  const guard = promise => wd.guard(promise, phase);
  let releaseTurn = () => {};
  const waitTurn = async () => {
    phase = "queue";
    releaseTurn = await takeTurn(options.queueDir || process.env.DEMO_QUEUE_DIR || path.join(os.homedir(), ".show-and-tell", "queue"),
      output, log, { pollMs: options.queuePollMs, noteMs: options.queueNoteMs, maxMs: options.queueMaxMs });
  };
  const setupLog = text => log("SETUP", redactText(text, config.redact));
  try {
    const write = progressLog(`${stem}.progress.log`);
    log = (kind, text = "") => {
      lastLine = `${kind}${text ? " " + String(text).replace(/\s+/g, " ").trim() : ""}`;
      wd.bump();
      write(kind, text);
    };
    const job = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : { schema: 1 };
    if (!job || Array.isArray(job) || typeof job !== "object") throw new CaseError("invalid job checkpoint");
    if (options.setupOnly) {
      // Rehearse off-camera setup alone: no take is used, but setup still consumes data, so
      // rehearsals are counted and capped. A passing rehearsal after the setup-failure cap
      // allows one more setup try in the take.
      if (typeof config.setup !== "function") throw new CaseError("case has no setup() to rehearse");
      if ((job.rehearsals || 0) >= MAX_REHEARSALS)
        throw new CaseError(`setup was rehearsed ${job.rehearsals} times (--setup-only); stop and report before consuming more data`);
      await waitTurn(); // setup uses the app's data like a take does
      phase = "setup";
      job.rehearsals = (job.rehearsals || 0) + 1;
      saveJob(jobPath, job);
      log("SETUP", `rehearsal ${job.rehearsals} of ${MAX_REHEARSALS} (--setup-only), no recording`);
      await guard(config.setup({ log: setupLog }));
      const stuck = job.record && ["setup-failed", "setup"].includes(job.record.stage) && (job.record.setupFailures || 0) >= MAX_SETUP_FAILURES;
      if (stuck) {
        job.record.setupFailures = MAX_SETUP_FAILURES - 1;
        saveJob(jobPath, job);
        log("SETUP", "rehearsal passed: one more setup try allowed in the take");
      }
      log("DONE", "setup-only ok");
      return { setup: "ok", rehearsals: job.rehearsals };
    }
    const caseKey = options.caseKey;
    if (!caseKey) throw new CaseError("caseKey is required to resume safely");
    let record = job.record;
    if (options.editOnly && !record) throw new CaseError("edit-only needs a completed recording; no actions were run");
    // Setup runs off camera before the title card: a setup failure did not film anything,
    // so it re-uses the same take number (capped separately) instead of burning a take.
    // Stage "setup" left behind means the runner was killed or hung during setup: same thing.
    const setupRetry = ["setup-failed", "setup"].includes(record?.stage) && !options.editOnly;
    if (record && !options.retake && !setupRetry) {
      if ((!options.editOnly && record.caseKey !== caseKey) || record.stage !== "recorded" || !fs.existsSync(record.video)
          || !fs.existsSync(record.card) || fileHash(record.video) !== record.videoHash
          || fileHash(record.card) !== record.cardHash)
        throw new CaseError("case changed or take is incomplete; use --edit-only for editing/verification changes, --retake only for new actions");
    } else {
      const setupFailures = setupRetry ? (record.setupFailures || 0) + (record.stage === "setup" ? 1 : 0) : 0;
      if (setupFailures >= MAX_SETUP_FAILURES) {
        if (record.stage !== "setup-failed" || record.setupFailures !== setupFailures) {
          record.stage = "setup-failed";
          record.setupFailures = setupFailures;
          job.status = "setup-failed";
          saveJob(jobPath, job);
        }
        throw new CaseError(`setup failed ${setupFailures} times; fix setup(), then prove it with --setup-only (a passing rehearsal allows one more try, at most ${MAX_REHEARSALS} rehearsals), or report to the user`);
      }
      const attempts = setupRetry ? record.attempts : (record?.attempts || 0) + 1;
      if (attempts > 2) throw new CaseError("two recording attempts used; stop and report before consuming more data");
      await waitTurn(); // before stage "setup" is saved: a runner stopped while queued used nothing
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
        if (config.setup) await guard(config.setup({ log: setupLog }));
        log("SETUP", "ok");
        phase = "title";
        record.stage = "title";
        const projectDir = path.resolve(baseDir, config.projectDir || ".");
        const look = { ...(config.font ? { font: config.font } : {}), ...(config.view ? { view: config.view } : {}),
          ...(config.theme ? { theme: config.theme } : {}) };
        record.card = await guard(kit.recordCard({ ...config.title, outDir, name: "card", projectDir, ...look }));
        record.stage = "recording";
        saveJob(jobPath, job);
        phase = "recording";
        log("REC", "title ok, recording actions");
        const opening = kit.startSession({ projectDir, outDir, name: "case", baseURL: config.baseURL,
          startUrl: config.startUrl || "/", login: config.login, redact: config.redact || {}, ...look });
        let gaveUp = false; // a browser that opens only after the stall was reported is closed
        opening.then(s => { if (gaveUp) Promise.resolve(s?.browser?.close?.()).catch(() => {}); }, () => {});
        try { session = await guard(opening); } catch (error) { gaveUp = true; throw error; }
        const demo = session.demo;
        // Every kit call is a sign of life for the watchdog: a long take that keeps acting is
        // not stuck, one waiting on a single call is.
        if (demo) for (const [name, fn] of Object.entries(demo)) {
          if (typeof fn !== "function") continue;
          demo[name] = function (...args) {
            wd.bump();
            const result = fn.apply(this, args);
            return result && typeof result.then === "function" ? Promise.resolve(result).finally(wd.bump) : result;
          };
        }
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
        await guard(config.run({ page: session.page, demo }));
        record.video = await guard(session.finish());
        record.videoHash = fileHash(record.video);
        record.cardHash = fileHash(record.card);
        record.stage = "recorded";
        saveJob(jobPath, job);
        log("REC", "actions recorded");
        phase = "verify";
        if (config.verify) {
          if (await guard(config.verify()) !== true) throw new CaseError("verification did not return true; fix the result and resume without --retake");
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
        releaseTurn(); // editing does not touch the app: the next take may start
      }
    }
    phase = "verify";
    if (record.verification === "pending") {
      if (!config.verify || await guard(config.verify()) !== true)
        throw new CaseError("verification still pending; resume after checking the real result");
      record.verification = "passed";
    }
    saveJob(jobPath, job);
    phase = "edit";
    log("EDIT", "start");
    // Encoding a long clip prints nothing for minutes: say it is still working, so a watcher
    // does not report STALL on a healthy run.
    const editStart = Date.now();
    const beat = setInterval(() => {
      const secs = Math.round((Date.now() - editStart) / 1000);
      if (secs <= EDIT_BEAT_MAX_S) log("EDIT", `still encoding (${secs}s)`);
    }, options.heartbeatMs || EDIT_BEAT_MS);
    beat.unref?.();
    let summary;
    try { summary = await (options.edit || editRecording)(config, record, output); }
    finally { clearInterval(beat); }
    log("DONE", `${summary.video || output} ${summary.seconds ?? ""}s status=${summary.status || "?"}`);
    return { ...summary, verification: record.verification, attempts: record.attempts };
  } catch (error) {
    log("FAIL", `${phase}: ${scrub(error, config.redact)}`);
    throw error;
  } finally {
    releaseTurn();
    fs.rmSync(lock, { force: true });
  }
}

// The case's redaction settings, so the CLI error line hides what the video hides.
let cliRedact;

// Resolves to { summary } after a run, { code } otherwise.
async function main(args) {
  if (!args.length || args.includes("--help")) {
    console.log("Usage: node run-case.cjs CASE.cjs [--storyboard | --setup-only | --retake | --edit-only]\nCopy assets/case-template.cjs. --storyboard previews scenes and length without a browser; --setup-only rehearses setup() without recording; --retake allows a second take; --edit-only resumes a changed case without replaying actions.\nWatch it: node watch-case.cjs OUT.mp4");
    return {};
  }
  if (args.length > 2 || (args[1] && !["--retake", "--edit-only", "--setup-only", "--storyboard"].includes(args[1])))
    throw new CaseError("unknown arguments; use --help");
  const file = path.resolve(args[0]);
  const config = require(file);
  cliRedact = config.redact;
  if (args[1] === "--storyboard") {
    const { storyboard } = require("./storyboard.cjs");
    const board = await storyboard(config, { caseFile: file, caseKey: fileHash(file), baseDir: path.dirname(file) });
    console.log(board.markdown + `\n\n(saved ${board.file})`);
    return { code: board.stopped ? 3 : 0 }; // 3 = storyboard incomplete, as in storyboard.cjs
  }
  return { summary: await runCase(config, { caseKey: fileHash(file), baseDir: path.dirname(file),
    retake: args.includes("--retake"), editOnly: args.includes("--edit-only"), setupOnly: args.includes("--setup-only") }) };
}

// Always exit explicitly: a browser or connection left open by case code (e.g. setup())
// otherwise keeps Node alive forever, and whoever waits for the exit waits for nothing.
function exitWith(stream, text, code) {
  const done = () => process.exit(code);
  setTimeout(done, 2000).unref();
  if (text) stream.write(text + "\n", done); else done();
}

module.exports = { runCase, scrub, redactText, editArgs };
if (require.main === module) main(process.argv.slice(2)).then(
  ({ summary, code = 0 } = {}) => exitWith(process.stdout, summary ? JSON.stringify(summary) : "", code),
  error => exitWith(process.stderr, error instanceof CaseError ? error.message
    : `case failed: ${scrub(error, cliRedact)} (phase in OUT.job.json, details in OUT.progress.log)`, 1));
