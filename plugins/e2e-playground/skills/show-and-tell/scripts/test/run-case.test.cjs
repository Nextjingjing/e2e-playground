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
