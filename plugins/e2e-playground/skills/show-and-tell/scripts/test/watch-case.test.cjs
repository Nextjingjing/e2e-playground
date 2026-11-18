const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { watch, parseArgs, newestRun } = require("../watch-case.cjs");

function logFile(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo watch "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "final.progress.log");
}
const line = (kind, text) => `12:00:00 +1s ${kind} ${text}\n`;
const run = (pid, at = Date.now()) => `12:00:00 +0s RUN pid=${pid} at=${at}\n`;
const fast = file => ({ file, stall: 0.3, since: 120, grace: 0.2, poll: 20 });
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

test("a watcher restarted long after the take began picks the running take up again", async t => {
  const file = logFile(t);
  fs.writeFileSync(file, run(process.pid, Date.now() - 40 * 60e3) + line("STEP", "3/9 pack pallet"));
  const out = [];
  const watching = watch(fast(file), l => out.push(l));
  await pause(100);
  assert.match(out[0], /^RUN pid=\d+ \(started \d\d:\d\d:\d\d, before this watcher\)/);
  assert.ok(out.some(l => l.includes("STEP 3/9 pack pallet")));
  fs.appendFileSync(file, line("DONE", "x.mp4"));
  assert.equal(await watching, 0);
});

test("a result from the previous run is not taken for the new one that is about to start", async t => {
  const file = logFile(t);
  const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  fs.writeFileSync(file, run(Number(gone.stdout), Date.now() - 31e3) + line("DONE", "setup-only ok"));
  const out = [];
  const watching = watch({ ...fast(file), grace: 1, stall: 60 }, l => out.push(l));
  await pause(300);
  assert.deepEqual(out, [], "the old DONE must not end the watch during the grace period");
  fs.writeFileSync(file, run(process.pid) + line("TAKE", "1 of 2"));
  await pause(100);
  fs.appendFileSync(file, line("FAIL", "recording: click target is covered by div.toast"));
  assert.equal(await watching, 1);
  assert.ok(!out.some(l => l.includes("setup-only ok")));
});

test("a run that failed just before the watcher started is still reported after the grace period", async t => {
  const file = logFile(t);
  const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
  fs.writeFileSync(file, run(Number(gone.stdout), Date.now() - 20e3) + line("FAIL", "setup: no free pallet"));
  const out = [];
  assert.equal(await watch(fast(file), l => out.push(l)), 1);
  assert.ok(out.at(-1).includes("FAIL setup: no free pallet"));
});

test("only a DONE/FAIL line kind ends the watch, never the same word inside a caption", () => {
  const log = run(1, 5) + line("STEP", "9/9 Picking DONE") + line("SETUP", "FAIL counter reset");
  const r = newestRun(log);
  assert.equal(r.ended, false);
  assert.equal(newestRun(log + line("FAIL", "edit: encoder")).ended, true);
});
