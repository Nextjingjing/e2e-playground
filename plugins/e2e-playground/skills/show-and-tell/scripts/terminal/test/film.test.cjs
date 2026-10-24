const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Terminal } = require("@xterm/headless");
const { film } = require("../film.cjs");
const { thaiCells } = require("../thai.cjs");
const { ordersCast } = require("./helpers.cjs");

const win = process.platform === "win32";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "paintext-film-"));
let cast;
test.before(async () => { if (win) cast = await ordersCast(tmp()); }, { timeout: 90000 });

const clean = rows => rows.map(r => r.replace(/ /g, " ").trimEnd()).filter(Boolean);

function headlessScreen(castFile) {
  const [header, ...lines] = fs.readFileSync(castFile, "utf8").trim().split("\n");
  const { width, height } = JSON.parse(header);
  const t = new Terminal({ cols: width, rows: height, allowProposedApi: true });
  const data = thaiCells(lines.map(l => JSON.parse(l)).filter(e => e[1] === "o").map(e => e[2]).join(""));
  return new Promise(r => t.write(data, () => {
    const b = t.buffer.active, rows = [];
    for (let i = b.viewportY; i < b.viewportY + height; i++) rows.push(b.getLine(i).translateToString(true));
    r(clean(rows));
  }));
}

test("replay screen equals headless screen", { skip: !win, timeout: 120000 }, async () => {
  const outDir = tmp();
  const s = await film({ cast, outDir, name: "eq" });
  await s.play();
  const rows = clean(await s.page.$$eval(".xterm-rows > div", ds => ds.map(d => d.textContent)));
  await s.finish();
  assert.deepEqual(rows, await headlessScreen(cast));
  assert.ok(!rows.some(r => /\bcd "/.test(r)), "hidden setup is on screen");
});

test("prompt and Thai visible", { skip: !win, timeout: 120000 }, async () => {
  const s = await film({ cast, outDir: tmp(), name: "prompt" });
  await s.play("step:1");
  const text = await s.page.$eval(".xterm-rows", d => d.textContent.replace(/ /g, " "));
  await s.finish();
  assert.match(text, /Continue\? \[y\/N\]/);
  assert.match(text, new RegExp(thaiCells("น้ำดื่ม")));
});

// A hand-made cast: no shell needed, and the chunk timing is exactly what we want to test.
function synthCast(dir, outputs) {
  const file = path.join(dir, "synth.cast");
  const header = { version: 2, width: 80, height: 10, paintext: { shell: "powershell", title: "Windows PowerShell" } };
  const ev = [[0, "m", "start"], ...outputs.map(([t, s]) => [t, "o", s]), [outputs[outputs.length - 1][0], "m", "end"]];
  fs.writeFileSync(file, [header, ...ev].map(x => JSON.stringify(x)).join("\n") + "\n");
  return file;
}

test("next() resolves only after its last output is drawn", { timeout: 60000 }, async () => {
  const dir = tmp();
  const c = synthCast(dir, [[0.1, "PS C:\\> list\r\n"], [0.3, "first row\r\n"], [0.305, "LAST ROW\r\n"]]);
  const s = await film({ cast: c, outDir: dir, name: "drawn" });
  let rows;
  try {
    rows = await s.page.evaluate(async () => {
      await window.paintext.next("end");
      return document.querySelector(".xterm-rows").textContent;  // same evaluate: no free frame
    });
  } finally { await s.finish(); }
  assert.match(rows, /LAST ROW/);
});

test("redaction covers names the replay rewrote (Thai sara am, spaces)", { timeout: 60000 }, async () => {
  const dir = tmp();
  const c = synthCast(dir, [[0.1, "customer: คำแก้ว ใจดี\r\n"], [0.2, "owner: Jane Doe\r\n"]]);
  const s = await film({ cast: c, outDir: dir, name: "redact", redact: { text: ["คำแก้ว ใจดี", "Jane Doe"] } });
  let covered;
  try {
    await s.play();
    covered = await s.page.evaluate(() => {
      const bars = [...document.querySelectorAll("#__demo_redact > div, #__paintext_redact > div")].map(d => d.getBoundingClientRect());
      return [...document.querySelectorAll(".xterm-rows > div")].slice(0, 2).map(row => {
        const r = row.getBoundingClientRect();
        return bars.some(b => b.top < r.bottom && b.bottom > r.top && b.width > 40);
      });
    });
  } finally { await s.finish(); }
  assert.deepEqual(covered, [true, true], "each name row needs a bar over it");
});

test("a failing film() does not leave the browser running", { timeout: 60000 }, () => {
  const dir = tmp(), bad = path.join(dir, "bad.cast");
  fs.writeFileSync(bad, JSON.stringify({ version: 2, width: 80, height: 10 }) + "\nnot json\n");
  const script = `require(${JSON.stringify(path.join(__dirname, "..", "film.cjs"))}).film({ cast: ${JSON.stringify(bad)}, outDir: ${JSON.stringify(dir)}, name: "bad" }).then(() => process.exit(3), () => {});`;
  const r = require("child_process").spawnSync(process.execPath, ["-e", script], { timeout: 40000 });
  assert.notEqual(r.error && r.error.code, "ETIMEDOUT", "node hung: browser left open");
  assert.equal(r.status, 0);
});

test("highlightText in a terminal points at the latest match", { skip: !win, timeout: 120000 }, async () => {
  const s = await film({ cast, outDir: tmp(), name: "latest" });
  let hlTop, rowTop;
  try {
    await s.play("proof");
    const pending = s.demo.highlightText("A-042", "row");
    await s.page.waitForSelector(".__demo_hl");
    hlTop = await s.page.$eval(".__demo_hl", el => el.getBoundingClientRect().top + 8);
    rowTop = await s.page.$$eval(".xterm-rows > div", ds => {
      const hits = ds.filter(d => /A-042/.test(d.textContent));
      return hits.map(d => Math.round(d.getBoundingClientRect().top));
    });
    await pending;
  } finally { await s.finish(); }
  assert.ok(Math.abs(hlTop - rowTop[rowTop.length - 1]) < 4, `highlight at y=${hlTop}, A-042 rows at y=${rowTop}`);
});

test("film produces webm and marks", { skip: !win, timeout: 180000 }, async () => {
  const outDir = tmp();
  const s = await film({ cast, outDir, name: "orders" });
  await s.play("proof");
  await s.demo.highlightText("A-042", "แถวที่บันทึก");
  await s.demo.highlightText("น้ำดื่ม", "ชื่อสินค้า");
  await s.play();
  await s.finish();
  const webm = path.join(outDir, "orders.webm");
  assert.ok(fs.statSync(webm).size > 0);
  const marks = JSON.parse(fs.readFileSync(path.join(outDir, "orders.marks.json"), "utf8"));
  assert.ok(marks.some(m => m.kind === "start"));
  assert.ok(marks.some(m => m.kind === "idle" && m.label === "waiting for output"));
  assert.equal(marks.filter(m => m.kind === "highlight").length, 2);
});
