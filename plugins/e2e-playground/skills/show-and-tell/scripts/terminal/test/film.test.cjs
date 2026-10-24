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
