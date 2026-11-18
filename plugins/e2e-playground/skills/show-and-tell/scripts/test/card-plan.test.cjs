const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cardPlan } = require("../demo-kit.cjs");

test("card timeline: title first, then each line after the previous one could be read", () => {
  const plan = cardPlan({ tag: "Case 1", title: "Progress bar", lines: ["short", "a much longer second line to read"] });
  const kinds = plan.events.map(e => e.kind);
  assert.deepEqual(kinds, ["tag", "title", "line", "line"]);
  const [, title, first, second] = plan.events;
  assert.ok(first.at - title.at >= 1500, "the title gets a moment to be read alone");
  assert.ok(second.at - first.at >= 750, "a line is not followed at once by the next");
  assert.ok(plan.total > second.at + 2000, "the last line stays long enough to be read");
  assert.equal(plan.exitMs, 800);
});

test("more than three lines are paged; reading time follows the text, Thai counted by base letters", () => {
  const paged = cardPlan({ title: "T", lines: ["1", "2", "3", "4", "5"] });
  assert.deepEqual(paged.events.filter(e => e.kind === "pageOut").map(e => e.page), [0]);
  assert.deepEqual(paged.events.filter(e => e.kind === "line").map(e => `${e.page}.${e.i}`), ["0.0", "0.1", "0.2", "1.0", "1.1"]);
  const thai = cardPlan({ title: "ที่นี่", lines: [] });   // 2 base letters + vowel/tone marks
  const latin = cardPlan({ title: "ab", lines: [] });
  assert.equal(thai.total, latin.total, "tone marks and upper vowels add no reading time");
});

test("a card never runs past 14 s on its own, and ms forces the reading time", t => {
  const warnings = [];
  t.mock.method(console, "warn", m => warnings.push(m));
  const long = cardPlan({ title: "Title", lines: Array.from({ length: 9 }, (_, i) => `a fairly long line number ${i} with words`) });
  assert.equal(long.total, 14000);
  assert.match(warnings[0], /shorten it/);
  assert.ok(long.events.every(e => e.at < 14000), "events squeezed into the time");
  const forced = cardPlan({ title: "Title", lines: ["one"] }, { ms: 3000 });
  assert.equal(forced.total, 3000);
  assert.equal(warnings.length, 1, "an explicit ms is the author's choice: no warning");
});
