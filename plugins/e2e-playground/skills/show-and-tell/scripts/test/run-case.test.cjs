const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { runCase } = require("../run-case.cjs");

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

  process.env.DEMO_TEST_PASSWORD = "hunter2-secret";
  t.after(() => { delete process.env.DEMO_TEST_PASSWORD; });
  f.config.run = async () => { throw new Error("login failed for hunter2-secret as Jane Doe\nsecond line\nthird line"); };
  f.config.redact = { text: ["Jane Doe"] };
  await assert.rejects(runCase(f.config, { ...f.options, retake: true }));
  const failed = fs.readFileSync(path.join(f.root, "final.progress.log"), "utf8");
  assert.match(failed, / FAIL recording: login failed for \[redacted\] as \[redacted\] \| second line\n/);
  assert.ok(!failed.includes("hunter2") && !failed.includes("Jane") && !failed.includes("third line"));
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
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "run-case.cjs"), caseFile],
    { encoding: "utf8", timeout: 20000, env: { ...process.env, DEMO_PASSWORD: "s3cret-pw" } });
  assert.equal(result.error, undefined, "runner must exit by itself");
  assert.ok(Date.now() - started < 15000);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /case failed: select did not stick for \[redacted\]/);
  assert.ok(!result.stderr.includes("s3cret-pw"));
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
