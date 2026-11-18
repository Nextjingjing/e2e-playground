const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { runCase } = require("../run-case.cjs");

// Takes queue machine-wide, one at a time: keep this file's runs (and the CLI runs it spawns)
// out of the user's real queue.
const queueDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo queue "));
process.env.DEMO_QUEUE_DIR = queueDir;
process.on("exit", () => fs.rmSync(queueDir, { recursive: true, force: true }));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A throwaway value for redaction tests, generated per run so secret scanners never see a
// hard-coded password in the repo.
const fakeSecret = () => `fake-${require("node:crypto").randomBytes(6).toString("hex")}`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo runner "));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("demo runner "));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const output = path.join(root, "final.mp4");
  const events = [];
  const config = {
    output, projectDir: root, baseURL: "http://127.0.0.1:3000", startUrl: "/",
    title: { title: "A result", lines: [] },
    setup: async () => events.push("setup"),
    run: async () => events.push("action"),
    verify: async () => { events.push("verify"); return true; },
  };
  const kit = {
    recordCard: async options => {
      events.push("card");
      const file = path.join(options.outDir, `${options.name}.webm`);
      fs.writeFileSync(file, "card");
      return file;
    },
    startSession: async options => {
      events.push("open");
      assert.notEqual(options.redact, false);
      return { page: {}, demo: {}, browser: { close: async () => events.push("close") },
        finish: async () => {
          events.push("finish");
          const file = path.join(options.outDir, `${options.name}.webm`);
          fs.writeFileSync(file, "recording");
          return file;
        } };
    },
  };
  const edit = async () => { events.push("edit"); return { status: "needs-review" }; };
  return { root, config, events, kit, edit, options: { caseKey: "case-v1", kit, edit } };
}

test("first run sets up, records, verifies and edits; resume only edits", async t => {
  const f = fixture(t);
  await runCase(f.config, f.options);
  assert.deepEqual(f.events, ["setup", "card", "open", "action", "finish", "verify", "close", "edit"]);
  f.events.length = 0;
  await runCase(f.config, f.options);
  assert.deepEqual(f.events, ["edit"]);
  const job = JSON.parse(fs.readFileSync(path.join(f.root, "final.job.json")));
  assert.equal(job.record.attempts, 1);
  assert.equal(job.record.verification, "passed");
});

test("changed case or missing raw clip needs an explicit retake", async t => {
  const f = fixture(t);
  await runCase(f.config, f.options);
  await assert.rejects(runCase(f.config, { ...f.options, caseKey: "case-v2" }), /retake/);
  fs.unlinkSync(path.join(f.root, "final.work", "take-1", "case.webm"));
  await assert.rejects(runCase(f.config, f.options), /retake/);
  assert.equal(f.events.filter(e => e === "action").length, 1);
});

test("retakes are explicit and capped at two attempts", async t => {
  const f = fixture(t);
  await runCase(f.config, f.options);
  await runCase(f.config, { ...f.options, retake: true });
  await assert.rejects(runCase(f.config, { ...f.options, retake: true }), /two/);
  assert.equal(f.events.filter(e => e === "action").length, 2);
});

test("failed action closes browser, blocks editing and refuses automatic retry", async t => {
  const f = fixture(t);
  f.config.run = async () => { throw new Error("private app error"); };
  await assert.rejects(runCase(f.config, f.options));
  assert.equal(f.events.at(-1), "close");
  assert.ok(!f.events.includes("edit"));
  await assert.rejects(runCase(f.config, f.options), /retake/);
  const checkpoint = fs.readFileSync(path.join(f.root, "final.job.json"), "utf8");
  assert.ok(!checkpoint.includes("private app error"));
});

test("failed verification preserves raw video and can be retried without actions", async t => {
  const f = fixture(t);
  f.config.verify = async () => false;
  await assert.rejects(runCase(f.config, f.options), /verification/);
  assert.ok(!f.events.includes("edit"));
  f.config.verify = async () => true;
  await runCase(f.config, { ...f.options, caseKey: "fixed-verification", editOnly: true });
  assert.equal(f.events.filter(e => e === "action").length, 1);
  assert.equal(f.events.at(-1), "edit");
});

test("concurrent use of one output is refused before setup", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "final.job.json.lock"), "busy");
  await assert.rejects(runCase(f.config, f.options), /locked/);
  assert.deepEqual(f.events, []);
});

test("music is off, cozy (true) or calm; anything else is refused before setup", async t => {
  const f = fixture(t);
  f.config.music = "jazz";
  await assert.rejects(runCase(f.config, f.options), /music must be false, true \(cozy\), "cozy" or "calm"/);
  f.config.music = undefined;
  f.config.clickSound = "loud";
  await assert.rejects(runCase(f.config, f.options), /clickSound must be true or false/);
  assert.deepEqual(f.events, []);
});

test("editing gets cozy music and click sounds unless the case turns them off", () => {
  const { editArgs } = require("../run-case.cjs");
  const record = { video: "case.webm", card: "card.webm" };
  const args = config => editArgs({ ...config }, record, "out.mp4").slice(2).join(" ");
  assert.equal(args({}), "case.webm out.mp4 --card card.webm --music-style cozy");
  assert.equal(args({ music: true }), "case.webm out.mp4 --card card.webm --music-style cozy");
  assert.equal(args({ music: "calm" }), "case.webm out.mp4 --card card.webm --music-style calm");
  assert.equal(args({ music: false, clickSound: false, seed: 4 }), "case.webm out.mp4 --card card.webm --no-music --no-clicks --seed 4");
});

test("redaction cannot be disabled by the runner", async t => {
  const f = fixture(t);
  f.config.redact = false;
  await assert.rejects(runCase(f.config, f.options), /redact/);
  assert.deepEqual(f.events, []);
});

test("edit-only accepts changed config but never runs setup or recorded actions", async t => {
  const f = fixture(t);
  await runCase(f.config, f.options);
  f.events.length = 0;
  f.config.run = async () => assert.fail("must not replay");
  await runCase(f.config, { ...f.options, caseKey: "editing-change", editOnly: true });
  assert.deepEqual(f.events, ["edit"]);
});

test("edit-only without a completed take refuses before setup", async t => {
  const f = fixture(t);
  await assert.rejects(runCase(f.config, { ...f.options, editOnly: true }), /record/);
  assert.deepEqual(f.events, []);
});

for (const method of ["recordCard", "startSession"]) {
  test(`${method} closes Chromium if context creation fails before returning`, async t => {
    const f = fixture(t);
    const moduleDir = path.join(f.root, "node_modules", "playwright");
    fs.mkdirSync(moduleDir, { recursive: true });
    const file = path.join(moduleDir, "index.js");
    fs.writeFileSync(file, `exports.closed = 0; exports.chromium = { launch: async () => ({
      newContext: async () => { throw new Error('context initialization failed'); },
      close: async () => { exports.closed++; }
    }) };`);
    const playwright = require(file);
    const kit = require("../demo-kit.cjs");
    await assert.rejects(kit[method]({ projectDir: f.root, outDir: f.root, name: "failure", title: "Title" }), /initialization/);
    assert.equal(playwright.closed, 1);
  });
}

test("setup failure re-uses the take, is capped separately and keeps app text out of the job", async t => {
  const f = fixture(t);
  f.config.setup = async () => { f.events.push("setup"); throw new Error("setup private detail"); };
  for (let i = 1; i <= 3; i++) {
    await assert.rejects(runCase(f.config, f.options), /setup private detail/);
    const job = JSON.parse(fs.readFileSync(path.join(f.root, "final.job.json"), "utf8"));
    assert.equal(job.record.attempts, 1);
    assert.equal(job.record.stage, "setup-failed");
    assert.equal(job.record.setupFailures, i);
    assert.ok(!JSON.stringify(job).includes("private"));
  }
  await assert.rejects(runCase(f.config, f.options), /setup failed 3 times/);
  assert.ok(!f.events.includes("card"));
});

test("a setup retry that succeeds records take 1 without --retake", async t => {
  const f = fixture(t);
  let fail = true;
  f.config.setup = async () => { f.events.push("setup"); if (fail) throw new Error("flaky"); };
  await assert.rejects(runCase(f.config, f.options), /flaky/);
  fail = false;
  await runCase(f.config, f.options);
  const job = JSON.parse(fs.readFileSync(path.join(f.root, "final.job.json"), "utf8"));
  assert.equal(job.record.attempts, 1);
  assert.equal(job.record.stage, "recorded");
  await runCase(f.config, { ...f.options, retake: true }); // the real second take is still available
});

test("setup-only rehearses setup without using a take, and rehearsals are capped", async t => {
  const f = fixture(t);
  assert.deepEqual(await runCase(f.config, { ...f.options, setupOnly: true }), { setup: "ok", rehearsals: 1 });
  assert.deepEqual(f.events, ["setup"]);
  const job = JSON.parse(fs.readFileSync(path.join(f.root, "final.job.json"), "utf8"));
  assert.equal(job.record, undefined, "a rehearsal uses no take");
  await assert.rejects(runCase(f.config, { ...f.options, setupOnly: true, retake: true }), /choose one/);
  await runCase(f.config, { ...f.options, setupOnly: true });
  await runCase(f.config, { ...f.options, setupOnly: true });
  await assert.rejects(runCase(f.config, { ...f.options, setupOnly: true }), /rehearsed 3 times/);
  assert.equal(f.events.filter(e => e === "setup").length, 3);
  await runCase(f.config, f.options); // the take itself is still available
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "final.job.json"), "utf8")).record.attempts, 1);
});

test("after the setup-failure cap, a passing rehearsal allows exactly one more try", async t => {
  const f = fixture(t);
  let fail = true;
  f.config.setup = async () => { f.events.push("setup"); if (fail) throw new Error("select did not stick"); };
  for (let i = 0; i < 3; i++) await assert.rejects(runCase(f.config, f.options), /did not stick/);
  await assert.rejects(runCase(f.config, f.options), /setup failed 3 times; fix setup\(\), then prove it with --setup-only/);
  await assert.rejects(runCase(f.config, { ...f.options, retake: true }), /setup failed 3 times/);
  await assert.rejects(runCase(f.config, { ...f.options, setupOnly: true }), /did not stick/); // failed rehearsal unlocks nothing
  await assert.rejects(runCase(f.config, f.options), /setup failed 3 times/);
  fail = false;
  await runCase(f.config, { ...f.options, setupOnly: true });
  await runCase(f.config, f.options);
  const job = JSON.parse(fs.readFileSync(path.join(f.root, "final.job.json"), "utf8"));
  assert.equal(job.record.attempts, 1);
  assert.equal(job.record.stage, "recorded");
});

test("a runner killed during setup leaves a stale lock and stage 'setup': both recover without --retake", async t => {
  const f = fixture(t);
  const gone = require("node:child_process").spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  fs.writeFileSync(path.join(f.root, "final.job.json"), JSON.stringify({ schema: 1, status: "recording",
    record: { attempts: 1, caseKey: "case-v1", stage: "setup", verification: "pending" } }));
  fs.writeFileSync(path.join(f.root, "final.job.json.lock"), JSON.stringify({ pid: Number(gone.stdout), at: Date.now() }));
  await runCase(f.config, f.options);
  const job = JSON.parse(fs.readFileSync(path.join(f.root, "final.job.json"), "utf8"));
  assert.equal(job.record.attempts, 1, "a killed setup filmed nothing, so it keeps the take");
  assert.equal(job.record.setupFailures, 1);
  assert.ok(!fs.existsSync(path.join(f.root, "final.job.json.lock")));
});

test("a lock held by a live runner is refused with its pid", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "final.job.json.lock"), JSON.stringify({ pid: process.pid, at: Date.now() }));
  await assert.rejects(runCase(f.config, f.options), new RegExp(`in use by run pid ${process.pid}`));
  assert.ok(fs.existsSync(path.join(f.root, "final.job.json.lock")), "a live run's lock stays");
  assert.deepEqual(f.events, []);
});

test("an unwritable progress log neither fails the run nor leaves the lock behind", async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, "final.progress.log")); // writeFileSync/appendFileSync both fail on a directory
  await runCase(f.config, f.options);
  assert.ok(!fs.existsSync(path.join(f.root, "final.job.json.lock")));
});

test("long editing writes heartbeat lines so a watcher does not report STALL", async t => {
  const f = fixture(t);
  const edit = async () => { await new Promise(r => setTimeout(r, 130)); return { status: "needs-review" }; };
  await runCase(f.config, { ...f.options, edit, heartbeatMs: 40 });
  const text = fs.readFileSync(path.join(f.root, "final.progress.log"), "utf8");
  assert.ok((text.match(/ EDIT still encoding \(\d+s\)/g) || []).length >= 2, text);
});

test("progress log streams phases and captions, and a scrubbed failure reason", async t => {
  const f = fixture(t);
  const startSession = f.kit.startSession;
  f.kit.startSession = async options => ({ ...(await startSession(options)), demo: { caption: async () => {} } });
  f.config.run = async ({ demo }) => { await demo.caption("Forklift lifts pallet 1"); await demo.caption(null); };
  f.config.setup = async ({ log }) => log("queue PM9 ready");
  await runCase(f.config, f.options);
  const text = fs.readFileSync(path.join(f.root, "final.progress.log"), "utf8");
  for (const want of [/ RUN pid=\d+ at=\d+/, / TAKE 1 of 2/, / SETUP queue PM9 ready/, / STEP 1 Forklift lifts pallet 1/, / DONE /])
    assert.match(text, want);
  assert.equal((text.match(/ STEP /g) || []).length, 1, "hiding a caption is not a step");

  const fakePassword = fakeSecret(); // made at run time: no password-like literal in the repo
  process.env.DEMO_TEST_PASSWORD = fakePassword;
  t.after(() => { delete process.env.DEMO_TEST_PASSWORD; });
  f.config.run = async () => { throw new Error(`login failed for ${fakePassword} as Jane Doe\nsecond line\nthird line`); };
  f.config.redact = { text: ["Jane Doe"] };
  await assert.rejects(runCase(f.config, { ...f.options, retake: true }));
  const failed = fs.readFileSync(path.join(f.root, "final.progress.log"), "utf8");
  assert.match(failed, / FAIL recording: login failed for \[redacted\] as \[redacted\] \| second line\n/);
  assert.ok(!failed.includes(fakePassword) && !failed.includes("Jane") && !failed.includes("third line"));
});

test("failure text hides redact.text in any case, built-in PII patterns and login env values", async t => {
  const f = fixture(t);
  process.env.DEMO_USER = "jdoe_ops";
  t.after(() => { delete process.env.DEMO_USER; });
  f.config.redact = { text: ["Jane Doe"] };
  f.config.setup = async ({ log }) => { log("row for JANE DOE ready"); throw new Error("no row for JANE DOE (jane.doe@corp.com), user jdoe_ops"); };
  await assert.rejects(runCase(f.config, f.options));
  const text = fs.readFileSync(path.join(f.root, "final.progress.log"), "utf8");
  assert.match(text, / FAIL setup: no row for \[redacted\] \(\[redacted\]\), user \[redacted\]/);
  assert.match(text, / SETUP row for \[redacted\] ready/);
  assert.ok(!/jane|doe|corp\.com|jdoe/i.test(text), text);
});

test("CLI exits even when setup leaves a handle open, with a readable reason", t => {
  const { spawnSync } = require("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo runner cli "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caseFile = path.join(root, "case.cjs");
  fs.writeFileSync(caseFile, `module.exports = {
    output: "out/final.mp4", baseURL: "http://127.0.0.1:9", title: { title: "T", lines: [] },
    run: async () => {},
    setup: async () => { setInterval(() => {}, 1000); throw new Error("select did not stick for " + process.env.DEMO_PASSWORD); },
  };`);
  const started = Date.now();
  const fakePassword = fakeSecret();
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "run-case.cjs"), caseFile],
    { encoding: "utf8", timeout: 20000, env: { ...process.env, DEMO_PASSWORD: fakePassword } });
  assert.equal(result.error, undefined, "runner must exit by itself");
  assert.ok(Date.now() - started < 15000);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /case failed: select did not stick for \[redacted\]/);
  assert.ok(!result.stderr.includes(fakePassword));
  assert.match(fs.readFileSync(path.join(root, "out", "final.progress.log"), "utf8"), / FAIL setup: select did not stick/);
});

test("CLI error line applies the case's redaction, not only env secrets", t => {
  const { spawnSync } = require("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo runner cli "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caseFile = path.join(root, "case.cjs");
  fs.writeFileSync(caseFile, `module.exports = {
    output: "out/final.mp4", baseURL: "http://127.0.0.1:9", title: { title: "T", lines: [] },
    redact: { text: ["Jane Doe"] }, run: async () => {},
    setup: async () => { throw new Error("no row for JANE DOE (jane.doe@corp.com)"); },
  };`);
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "run-case.cjs"), caseFile], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /case failed: no row for \[redacted\] \(\[redacted\]\)/);
  assert.ok(!/jane|corp\.com/i.test(result.stderr), result.stderr);
});

// 2026-11-18: cases recorded in parallel against one app and database deadlocked. Nothing
// failed, so the takes just waited and nobody was told.

test("a setup that never finishes fails after stallSeconds of silence and keeps the take", async t => {
  const f = fixture(t);
  f.config.setup = async ({ log }) => { log("queue PM9 created"); await new Promise(() => {}); }; // e.g. blocked on a DB lock
  f.config.stallSeconds = 0.3;
  await assert.rejects(runCase(f.config, f.options), /no progress for \d+s in setup; last: SETUP queue PM9 created/);
  const text = fs.readFileSync(path.join(f.root, "final.progress.log"), "utf8");
  assert.match(text, / FAIL setup: no progress for \d+s in setup/);
  assert.ok(!fs.existsSync(path.join(f.root, "final.job.json.lock")));
  assert.deepEqual(fs.readdirSync(queueDir), [], "the machine turn is given back");
  f.config.setup = async () => {};
  await runCase(f.config, f.options);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "final.job.json"), "utf8")).record.attempts, 1, "a hung setup filmed nothing");
});

test("a take stuck on the app fails with a screenshot; steady kit calls count as progress", async t => {
  const f = fixture(t);
  const startSession = f.kit.startSession;
  f.kit.startSession = async options => ({ ...(await startSession(options)),
    page: { screenshot: async ({ path: file }) => fs.writeFileSync(file, "png") },
    demo: { caption: async () => {}, sleep, waitApp: () => new Promise(() => {}) } });
  f.config.stallSeconds = 0.3;
  // 8 x 100 ms is longer than the limit, but something happens every 100 ms: not stuck.
  f.config.run = async ({ demo }) => { for (let i = 0; i < 8; i++) await demo.sleep(100); };
  await runCase(f.config, f.options);
  f.config.run = async ({ demo }) => { await demo.caption("Scan the pallet"); await demo.waitApp(async () => {}, "wait for 8/8"); };
  await assert.rejects(runCase(f.config, { ...f.options, retake: true }), /no progress for \d+s in recording; last: STEP 1 Scan the pallet/);
  const text = fs.readFileSync(path.join(f.root, "final.progress.log"), "utf8");
  assert.match(text, / SHOT .*fail\.png/);
  assert.ok(f.events.includes("close"), "the browser is closed");
});

test("takes on one machine run one at a time: the next waits with QUEUE lines, then starts", async t => {
  const a = fixture(t), b = fixture(t);
  let release;
  a.config.run = () => new Promise(r => { release = r; });
  const first = runCase(a.config, a.options);
  while (!release) await sleep(10);
  const second = runCase(b.config, { ...b.options, queuePollMs: 20, queueNoteMs: 60 });
  await sleep(250);
  assert.deepEqual(b.events, [], "the second take has not touched the app yet");
  const waiting = fs.readFileSync(path.join(b.root, "final.progress.log"), "utf8");
  assert.ok((waiting.match(new RegExp(` QUEUE waiting for the take of pid ${process.pid} \\(final\\.mp4\\)`, "g")) || []).length >= 2, waiting);
  release();
  await first;
  await second;
  assert.deepEqual(b.events, ["setup", "card", "open", "action", "finish", "verify", "close", "edit"]);
});

test("the machine turn of a runner that died is taken over; a live one is waited for only so long", async t => {
  const f = fixture(t);
  const gone = require("node:child_process").spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  fs.writeFileSync(path.join(queueDir, "take.lock"), JSON.stringify({ id: "x", pid: Number(gone.stdout), output: "old.mp4", at: Date.now() }));
  await runCase(f.config, { ...f.options, setupOnly: true });
  fs.writeFileSync(path.join(queueDir, "take.lock"), JSON.stringify({ id: "y", pid: process.pid, output: "busy.mp4", at: Date.now() }));
  t.after(() => fs.rmSync(path.join(queueDir, "take.lock"), { force: true }));
  await assert.rejects(runCase(f.config, { ...f.options, setupOnly: true, queuePollMs: 20, queueMaxMs: 100 }),
    new RegExp(`waited \\d+ min for the take of pid ${process.pid} \\(busy\\.mp4\\)`));
});

test("CLI: a setup stuck forever is reported and the runner exits", t => {
  const { spawnSync } = require("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo runner cli "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caseFile = path.join(root, "case.cjs");
  fs.writeFileSync(caseFile, `module.exports = {
    output: "out/final.mp4", baseURL: "http://127.0.0.1:9", title: { title: "T", lines: [] }, stallSeconds: 1,
    run: async () => {},
    setup: () => new Promise(() => { setInterval(() => {}, 1000); }),
  };`);
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "run-case.cjs"), caseFile], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.error, undefined, "runner must exit by itself");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /case failed: no progress for \d+s in setup/);
});

test("--storyboard exits 3 when the storyboard is incomplete, like storyboard.cjs", t => {
  const { spawnSync } = require("node:child_process");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo runner cli "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const caseFile = path.join(root, "case.cjs");
  fs.writeFileSync(caseFile, `module.exports = {
    output: "out/final.mp4", baseURL: "http://127.0.0.1:9", title: { title: "T", lines: [] },
    run: async ({ demo }) => { await demo.caption("one"); throw new Error("needs the real page"); },
  };`);
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "run-case.cjs"), caseFile, "--storyboard"], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stdout, /Storyboard incomplete/);
});
