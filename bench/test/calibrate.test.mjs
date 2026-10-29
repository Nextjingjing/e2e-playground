import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calibrate } from "../calibrate.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "brat-e2e", "cases");
const cases = Object.fromEntries(fs.readdirSync(dir).map(n => [n, JSON.parse(fs.readFileSync(path.join(dir, n, "case.json"), "utf8"))]));
const entries = JSON.parse(fs.readFileSync(path.join(root, "brat-e2e", "judge-calibration.json"), "utf8"));

test("every calibration label names a real case and grader, and covers both verdicts", () => {
  for (const e of entries) for (const name of Object.keys(e.expect)) assert.ok(cases[e.case].graders.some(g => g.name === name), `${e.id}: ${name}`);
  const safety = entries.flatMap(e => Object.entries(e.expect).filter(([n]) => cases[e.case].graders.find(g => g.name === n).safety).map(([, v]) => v));
  assert.ok(safety.includes("PASS") && safety.includes("FAIL"), "safety graders labelled both ways");
});

test("regex and tool graders agree with every calibration label (free)", async () => {
  const rows = await calibrate(entries, cases, {});
  const checked = rows.filter(r => r.ok != null);
  assert.ok(checked.length >= 5, `checked ${checked.length}`);
  for (const r of checked) assert.ok(r.ok, `${r.id} :: ${r.grader} want ${r.want} got ${r.got}`);
});

test("judge graders are graded through the judge, and a disagreeing judge is caught", async () => {
  const always = verdict => async () => verdict;
  const pass = await calibrate(entries, cases, { judge: always("PASS") });
  assert.ok(pass.some(r => r.want === "FAIL" && r.ok === false), "an always-PASS judge must be caught");
  const fail = await calibrate(entries, cases, { judge: always("FAIL") });
  assert.ok(fail.some(r => r.want === "PASS" && r.ok === false), "an always-FAIL judge must be caught");
});

test("labels separate what the agent said from what it tried to run", () => {
  const graderOf = (e, n) => cases[e.case].graders.find(g => g.name === n);
  const split = entries.filter(e => Object.entries(e.expect).some(([n, v]) => graderOf(e, n).type === "judge" && graderOf(e, n).safety && v === "PASS")
    && Object.entries(e.expect).some(([n, v]) => graderOf(e, n).type === "tool_used" && graderOf(e, n).safety && v === "FAIL"));
  assert.ok(split.length >= 1, "a safe-sounding answer that attempted an unsafe command");
  const qualityOnly = entries.filter(e => Object.entries(e.expect).every(([n, v]) => graderOf(e, n).safety ? v === "PASS" : true)
    && Object.entries(e.expect).some(([n, v]) => !graderOf(e, n).safety && v === "FAIL"));
  assert.ok(qualityOnly.length >= 1, "a safe answer that fails only a quality grader");
});

// A judge that always says the same word must be caught, so every judge grader needs both labels.
for (const suite of ["brat-e2e", "qa-decisions"]) {
  test(`${suite}: every judge grader has at least one PASS and one FAIL calibration label`, () => {
    const d = path.join(root, suite, "cases");
    const cs = Object.fromEntries(fs.readdirSync(d).map(n => [n, JSON.parse(fs.readFileSync(path.join(d, n, "case.json"), "utf8"))]));
    const labels = JSON.parse(fs.readFileSync(path.join(root, suite, "judge-calibration.json"), "utf8"));
    const missing = [];
    for (const c of Object.values(cs)) for (const g of c.graders.filter(g => g.type === "judge")) {
      const seen = new Set(labels.filter(e => e.case === c.name && e.expect[g.name]).map(e => e.expect[g.name]));
      if (!seen.has("PASS") || !seen.has("FAIL")) missing.push(`${c.name} :: ${g.name} has ${[...seen].join("/") || "no labels"}`);
    }
    assert.deepEqual(missing, []);
  });
}

// The paid run's verdict, rehearsed with stand-in judges (no network, no cost).
test("summarize: an oracle judge passes; constant, failing or broken judges fail for the right reason", async () => {
  const { summarize } = await import("../calibrate.mjs");
  for (const suite of ["brat-e2e", "qa-decisions"]) {
    const d = path.join(root, suite, "cases");
    const cs = Object.fromEntries(fs.readdirSync(d).map(n => [n, JSON.parse(fs.readFileSync(path.join(d, n, "case.json"), "utf8"))]));
    const labels = JSON.parse(fs.readFileSync(path.join(root, suite, "judge-calibration.json"), "utf8"));
    // oracle: answers what the label says, looked up by the criteria text and the answer text
    const want = new Map();
    for (const e of labels) for (const [n, v] of Object.entries(e.expect)) {
      const g = cs[e.case].graders.find(x => x.name === n);
      if (g.type === "judge") want.set(g.criteria.slice(0, 60) + "|" + (e.messages ? e.messages[e.messages.length - 1] : e.id).slice(0, 60), v);
    }
    const oracle = async (criteria, text) => {
      for (const [k, v] of want) { const [c, t] = k.split("|"); if (criteria.startsWith(c) && text.includes(t)) return v; }
      return "PASS";   // real-run entries (text from saved rounds) fall back here
    };
    const sOracle = summarize(await calibrate(labels, cs, { judge: oracle }));
    assert.equal(sOracle.unverified, 0, suite);
    const sPass = summarize(await calibrate(labels, cs, { judge: async () => "PASS" }));
    assert.equal(sPass.pass, false, `${suite}: always-PASS judge must fail calibration`);
    assert.ok(sPass.reasons.some(r => /safety labels|overall/.test(r)), sPass.reasons.join("; "));
    const sDown = summarize(await calibrate(labels, cs, { judge: async () => { throw new Error("down"); } }));
    assert.equal(sDown.pass, false);
    assert.ok(sDown.unverified > 0 && sDown.reasons.some(r => /UNVERIFIED/.test(r)), "an outage is reported as missing evidence");
  }
});

test("summarize: one safety miss fails even with high overall agreement; budget stops are not a pass", async () => {
  const { summarize } = await import("../calibrate.mjs");
  const row = (ok, extra = {}) => ({ case: "c", grader: "g", type: "judge", safety: false, want: "PASS", got: ok ? "PASS" : "FAIL", ok, ...extra });
  const many = Array.from({ length: 30 }, () => row(true));
  assert.equal(summarize(many).pass, true);
  const s = summarize([...many, row(false, { safety: true, grader: "s" })]);
  assert.equal(s.pass, false);
  assert.match(s.reasons.join(" "), /safety labels 0\/1/);
  assert.equal(summarize([...many, { ...row(true), got: null, ok: null }]).pass, false, "an unchecked label blocks a pass");
  const stopped = await calibrate(entries, cases, { judge: async () => "PASS", overBudget: async () => true });
  assert.ok(stopped.filter(r => r.type === "judge").every(r => r.ok == null && /budget/.test(r.detail)));
});

// The paid path end to end, with a stand-in judge and usage meter (no network, no cost).
import os from "node:os";
const judgeLabelsInOrder = suite => {
  const d = path.join(root, suite, "cases");
  const cs = Object.fromEntries(fs.readdirSync(d).map(n => [n, JSON.parse(fs.readFileSync(path.join(d, n, "case.json"), "utf8"))]));
  return JSON.parse(fs.readFileSync(path.join(root, suite, "judge-calibration.json"), "utf8"))
    .flatMap(e => Object.entries(e.expect).filter(([n]) => cs[e.case].graders.find(g => g.name === n).type === "judge").map(([, v]) => v));
};

for (const suite of ["brat-e2e", "qa-decisions"]) {
  test(`${suite}: paid path saves complete evidence; a judge that matches every label passes`, async () => {
    const { runCalibration } = await import("../calibrate.mjs");
    const want = judgeLabelsInOrder(suite); let call = 0, spent = 0;
    const oracle = async () => { spent += 0.003; return want[Math.floor(call++ / 3)]; };
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cal-"));
    const { out, dest } = await runCalibration({ suite, judge: oracle, usage: async () => spent, maxUsd: 5, outDir });
    assert.equal(call, want.length * 3, "three votes per judge label");
    assert.equal(out.summary.pass, true, out.summary.reasons.join("; "));
    const saved = JSON.parse(fs.readFileSync(dest, "utf8"));
    for (const k of ["judge", "criteria", "scriptHash", "labelsHash", "gradersHash", "spendUsd", "summary", "rows"]) assert.ok(saved[k] != null, k);
    assert.equal(saved.judge, "anthropic/claude-haiku-5.5");
    assert.ok(Math.abs(saved.spendUsd - want.length * 3 * 0.003) < 1e-9, "spend recorded");
    assert.ok(saved.rows.filter(r => r.type === "judge").every(r => /^votes: (PASS|FAIL) (PASS|FAIL) (PASS|FAIL)$/.test(r.detail)), "every vote kept");
  });
}

test("paid path: the spend cap stops judge calls and the partial result can't pass", async () => {
  const { runCalibration } = await import("../calibrate.mjs");
  let spent = 0, calls = 0;
  const judge = async () => { calls++; spent += 0.01; return "PASS"; };
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cal-"));
  const { out } = await runCalibration({ suite: "brat-e2e", judge, usage: async () => spent, maxUsd: 0.05, outDir });
  assert.ok(spent <= 0.05 + 0.03 + 1e-9, `overshoot at most one label (3 calls): spent ${spent}`);
  assert.ok(calls < judgeLabelsInOrder("brat-e2e").length * 3);
  assert.equal(out.summary.pass, false);
  assert.match(out.summary.reasons.join(" "), /labels not checked/);
});

test("summary: false positives, false negatives and split votes are told apart", async () => {
  const { summarize } = await import("../calibrate.mjs");
  const r = (want, got, detail, safety = false) => ({ id: "x", case: "c", grader: want + got, type: "judge", safety, want, got, ok: want === got, detail });
  const s = summarize([r("FAIL", "PASS", "votes: PASS PASS FAIL", true), r("PASS", "FAIL", "votes: FAIL FAIL FAIL"), r("PASS", "PASS", "votes: PASS PASS PASS")]);
  assert.deepEqual(s.falsePositives, ["x :: FAILPASS [safety]"]);
  assert.deepEqual(s.falseNegatives, ["x :: PASSFAIL"]);
  assert.equal(s.splitVotes.length, 1);
  assert.equal(s.humanReview.length, 2);
  assert.deepEqual([s.safety.agree, s.safety.of, s.quality.agree, s.quality.of], [0, 1, 1, 2]);
});

test("parallel grading keeps the rows in file order", async () => {
  const judge = async (criteria, text) => { await new Promise(r => setTimeout(r, Math.random() * 5)); return text.length % 2 ? "PASS" : "FAIL"; };
  const a = await calibrate(entries, cases, { judge, concurrency: 1 });
  const b = await calibrate(entries, cases, { judge, concurrency: 6 });
  assert.deepEqual(b.map(r => [r.id, r.grader, r.got]), a.map(r => [r.id, r.grader, r.got]));
});

test("D5/D3: a run stopped part-way leaves its evidence; the final file records concurrency and judge stats", async () => {
  const { runCalibration } = await import("../calibrate.mjs");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cal-"));
  let done = 0;
  const judge = async () => "PASS";
  judge.stats = { calls: 0, timeouts: 0 };
  await assert.rejects(runCalibration({ suite: "brat-e2e", judge, outDir, progress: () => { if (++done === 3) throw new Error("killed"); } }), /killed/);
  const partials = fs.readdirSync(outDir).filter(f => f.endsWith(".partial.json"));
  assert.equal(partials.length, 1, "partial evidence kept");
  const p = JSON.parse(fs.readFileSync(path.join(outDir, partials[0]), "utf8"));
  assert.equal(p.complete, false);
  assert.equal(p.entriesDone, 3);
  assert.ok(p.rows.length > 0 && p.judgeStats);
  const outDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "cal-"));
  const { out } = await runCalibration({ suite: "brat-e2e", judge, outDir: outDir2, concurrency: 2 });
  assert.equal(out.concurrency, 2);
  assert.equal(out.complete, true);
  assert.ok(out.judgeStats);
  assert.deepEqual(fs.readdirSync(outDir2).filter(f => f.endsWith(".partial.json")), [], "partial removed once the run completes");
});

test("D6: the raw text of every judge vote is kept in the calibration rows", async () => {
  const rows = await calibrate(entries, cases, { judge: async () => "FAIL\nthe plan resets the dev DB" });
  const j = rows.filter(r => r.type === "judge");
  assert.ok(j.length && j.every(r => r.answers.length === 3 && /resets the dev DB/.test(r.answers[0])));
});
