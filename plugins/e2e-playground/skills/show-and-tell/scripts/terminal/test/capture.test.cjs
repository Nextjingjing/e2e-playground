const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { capture } = require("../capture.cjs");
const { ordersCast } = require("./helpers.cjs");

const win = process.platform === "win32";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "paintext-"));
const readCast = file => {
  const [header, ...rest] = fs.readFileSync(file, "utf8").trim().split("\n");
  return { header: JSON.parse(header), events: rest.map(l => JSON.parse(l)) };
};
const afterStart = events => {
  const i = events.findIndex(e => e[1] === "m" && e[2] === "start");
  return events.slice(i + 1).filter(e => e[1] === "o").map(e => e[2]).join("");
};


test("powershell session with prompt, Thai and DB", { skip: !win, timeout: 90000 }, async () => {
  const out = await ordersCast(tmp());
  const { header, events } = readCast(out);
  assert.equal(header.version, 2);
  assert.equal(header.paintext.shell, "powershell");
  const marks = events.filter(e => e[1] === "m").map(e => e[2]);
  assert.deepEqual(marks.filter(m => m === "start" || /^step:|^proof$/.test(m)),
    ["start", "step:1", "step:2", "step:3", "proof"]);
  const shown = afterStart(events);
  assert.match(shown, /บันทึกแล้ว/);
  assert.match(shown, /A-042\s+น้ำดื่ม/);
  assert.doesNotMatch(shown, /\bcd "/);
});

test("cmd prints Thai without author chcp", { skip: !win, timeout: 60000 }, async () => {
  const dir = tmp(), out = path.join(dir, "t.cast");
  await capture({ shell: "cmd", cwd: dir, out }, [{ type: "echo สวัสดี น้ำ" }]);
  assert.match(afterStart(readCast(out).events), /สวัสดี น้ำ/);
});

test("fails fast when expect never matches", { skip: !win, timeout: 30000 }, async () => {
  const dir = tmp(), out = path.join(dir, "t.cast"), t0 = Date.now();
  await assert.rejects(
    capture({ shell: "powershell", cwd: dir, out, timeoutMs: 3000 }, [{ type: "echo hi", expect: /never/ }]),
    err => /step 1/.test(err.message) && /echo hi/.test(err.message));
  assert.ok(Date.now() - t0 < 15000, "took too long");
  assert.equal(fs.existsSync(out), false);
});

test("refuses to write a cast containing a secret", { skip: !win, timeout: 60000 }, async () => {
  const dir = tmp(), out = path.join(dir, "t.cast");
  await assert.rejects(
    capture({ shell: "powershell", cwd: dir, out, env: { PT_TOKEN: "s3cr3t-XYZ-123" } },
      [{ type: "echo $env:PT_TOKEN" }]),
    /secret/);
  assert.equal(fs.existsSync(out), false);
});

test("secret input stored as placeholder", { skip: !win, timeout: 60000 }, async () => {
  const dir = tmp(), out = path.join(dir, "t.cast");
  process.env.PT_PASS = "pw-Very-Secret-77";
  try {
    await capture({ shell: "powershell", cwd: dir, out }, [
      { type: "$x = Read-Host 'Password' -AsSecureString", expect: /Password:\s*$/ },
      { secret: "PT_PASS" },
      { type: "'ok'" },
    ]);
  } finally { delete process.env.PT_PASS; }
  const text = fs.readFileSync(out, "utf8");
  assert.match(text, /‹env:PT_PASS›/);
  assert.doesNotMatch(text, /pw-Very-Secret-77/);
});

test("fails when output never settles after expect matched", { skip: !win, timeout: 30000 }, async () => {
  const dir = tmp(), out = path.join(dir, "t.cast"), t0 = Date.now();
  await assert.rejects(
    capture({ shell: "powershell", cwd: dir, out, timeoutMs: 3000 },
      [{ type: "1..300 | % { 'tick'; Start-Sleep -m 50 }", expect: /tick/ }]),
    /step 1/);
  assert.ok(Date.now() - t0 < 20000, "took too long");
});

test("hidden step failure fails capture", { skip: !win, timeout: 60000 }, async () => {
  const dir = tmp(), out = path.join(dir, "t.cast");
  await assert.rejects(
    capture({ shell: "powershell", cwd: dir, out, timeoutMs: 5000 }, [{ type: "exit 3", hidden: true }, { type: "'x'" }]),
    /hidden step/);
  assert.equal(fs.existsSync(out), false);
});
