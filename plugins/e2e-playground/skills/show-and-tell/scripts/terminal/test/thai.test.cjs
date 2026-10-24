const test = require("node:test");
const assert = require("node:assert/strict");
const { thaiCells, ThaiStream } = require("../thai.cjs");

test("thaiCells moves nikhahit before the tone mark and splits sara am", () => {
  assert.equal(thaiCells("น้ำ ทำ ค่ำ"), "น\u0E4D\u0E49\u0E32 ท\u0E4D\u0E32 ค\u0E4D\u0E48\u0E32");
});

test("thaiCells leaves text without sara am unchanged", () => {
  assert.equal(thaiCells("abc สวัสดี"), "abc สวัสดี");
});

test("ThaiStream carries a trailing tone mark", () => {
  const s = new ThaiStream();
  const first = s.push("น\u0E49");
  assert.equal(first, "น");
  assert.equal(first + s.push("\u0E33x") + s.flush(), thaiCells("น้ำx"));
});

test("ThaiStream flush with nothing held returns empty", () => {
  const s = new ThaiStream();
  assert.equal(s.push("abc"), "abc");
  assert.equal(s.flush(), "");
});
