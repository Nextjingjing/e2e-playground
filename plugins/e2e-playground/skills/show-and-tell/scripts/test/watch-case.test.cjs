const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { watch, parseArgs } = require("../watch-case.cjs");

function logFile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo watch "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "final.progress.log");
}
const line = (kind, text) => `12:00:00 +1s ${kind} ${text}\n`;
const run = (pid, at = Date.now()) => `12:00:00 +0s RUN pid=${pid} at=${at}\n`;
const fast = file => ({ file, stall: 0.3, since: 120, poll: 20 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test("mp4 path maps to its progress log", () => {
  assert.ok(parseArgs(["demo-out/a.mp4"]).file.endsWith("demo-out/a.progress.log"));
});

test("streams steps and ends on DONE, ignoring an old run in the same file", async t => {
  const file = logFile(t);
  fs.writeFileSync(file, run(process.pid, Date.now() - 3600e3) + line("DONE", "old.mp4"));
  const out = [];
  const watching = watch({ ...fast(file), stall: 60 }, l => out.push(l));
  await pause(100);
  assert.deepEqual(out, [], "an old DONE must not end the watch");
  fs.writeFileSync(file, run(process.pid) + line("STEP", "lift pallet 1"));
  await pause(100);
  fs.appendFileSync(file, line("DONE", "new.mp4"));
  assert.equal(await watching, 0);
  assert.ok(out.some(l => l.includes("STEP lift pallet 1")));
  assert.ok(out.at(-1).includes("DONE new.mp4"));
});

test("FAIL ends with code 1", async t => {
  const file = logFile(t);
  fs.writeFileSync(file, run(process.pid) + line("FAIL", "setup: select did not stick"));
  const out = [];
  assert.equal(await watch(fast(file), l => out.push(l)), 1);
  assert.ok(out.at(-1).includes("FAIL setup"));
});

test("a runner that died without DONE/FAIL is reported, not waited on", async t => {
  const file = logFile(t);
  const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  fs.writeFileSync(file, run(Number(gone.stdout)) + line("STEP", "scan pallet"));
  const out = [];
  assert.equal(await watch(fast(file), l => out.push(l)), 2);
  assert.match(out.at(-1), /^DEAD runner pid \d+ exited without DONE\/FAIL; last: .*STEP scan pallet/);
});

test("a quiet but alive runner raises STALL and keeps watching", async t => {
  const file = logFile(t);
  fs.writeFileSync(file, run(process.pid) + line("STEP", "wait for packer"));
  const out = [];
  const watching = watch(fast(file), l => out.push(l));
  await pause(450);
  assert.ok(out.some(l => /^STALL no progress for \d+s; last: .*wait for packer/.test(l)));
  fs.appendFileSync(file, line("DONE", "x.mp4"));
  assert.equal(await watching, 0);
});
