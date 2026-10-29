#!/usr/bin/env node
// Stand-in for `codex exec ... -o <file> -` in unit tests. FAKE_CODEX_FAIL_FIRST=<counter file>: the first
// call dies without an answer (like a hung call killed at the timeout), later calls answer FAKE_CODEX_ANSWER.
import fs from "node:fs";

const argv = process.argv.slice(2);
const out = argv[argv.indexOf("-o") + 1];
let input = "";
process.stdin.on("data", d => { input += d; });
process.stdin.on("end", () => {
  if (process.env.FAKE_CODEX_HANG) { setInterval(() => {}, 1000); return; }   // never answers, like the stalled calls
  const counter = process.env.FAKE_CODEX_FAIL_FIRST;
  if (counter) {
    const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
    fs.writeFileSync(counter, String(n + 1));
    if (n === 0) process.exit(1);
  }
  fs.writeFileSync(out, `${process.env.FAKE_CODEX_ANSWER || "PASS"}\nbecause the rubric holds.`);
  process.stderr.write("tokens used\n1,234\n");
});
