const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { storyboard } = require("../storyboard.cjs");
const { runCase } = require("../run-case.cjs");

function tmp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo storyboard "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const forkliftCase = root => ({
  output: path.join(root, "out", "v1.mp4"),
  baseURL: "http://127.0.0.1:3000",
  title: { tag: "PM314", title: "Progress bar counts the truck", lines: ["A 2 full + 1 fraction"] },
  setup: async () => assert.fail("storyboard must not run setup"),
  login: async () => assert.fail("storyboard must not log in"),
  verify: async () => assert.fail("storyboard must not verify"),
  async run({ page, demo }) {
    await page.goto("/forklift/domestic");
    const card = page.locator(".queue-card", { hasText: "PM4" }).first();
    await demo.caption("Queue needs 7 pallets");
    await demo.highlight(card.getByText("0/7"), "Nothing on the truck yet", 3000);
    for (let i = 1; i <= 2; i++) {
      await demo.caption(`Forklift lifts A pallet ${i}`);
      await demo.click(page.getByRole("button", { name: "ยก" }).nth(i), { slow: true });
      await demo.scanText(`PALLET-${i}`);
      await demo.waitApp(() => page.getByText("สำเร็จ!").waitFor(), "save lift");
    }
    const bar = await card.locator(".bar-label").innerText();
    await demo.caption(`Bar now ${bar}`);
    if ((await page.getByRole("dialog").count()) > 0) await demo.click(page.getByRole("button", { name: "Close" }));
    await demo.card({ tag: "Packer", title: "Fractions done" });
  },
});

test("lists scenes, actions and length without setup, login, verify or a browser", async t => {
  const root = tmp(t);
  const result = await storyboard(forkliftCase(root), { caseKey: "k1" });
  assert.equal(result.steps, 4);
  assert.equal(result.stopped, null);
  const md = result.markdown;
  assert.match(md, /\| – \| \(before the first caption\) \| open \/forklift\/domestic \|/);
  assert.match(md, /\| 1 \| Queue needs 7 pallets \| \.queue-card with "PM4" › text "0\/7" — "Nothing on the truck yet" \|/);
  assert.match(md, /\| 2 \| Forklift lifts A pallet 1 \| click button "ยก" › #1 \(slow\); scan "PALLET-1" \(keyboard scanner\); wait: save lift \(fast-forwarded\) \|/);
  assert.match(md, /\| 4 \| Bar now ‹live: \.queue-card with "PM4" › \.bar-label › innerText\(\)› \| card: Packer · Fractions done \|/);
  assert.ok(!md.includes("Close"), "a branch on live page state (count() > 0) is not taken");
  assert.match(md, /\*\*≈ 0:\d\d after editing\*\* \(4 captioned steps/);
  assert.match(md, /2 value\(s\) come from the live page/, "the bar text and the dialog count()");
  const saved = JSON.parse(fs.readFileSync(path.join(root, "out", "v1.storyboard.json"), "utf8"));
  assert.deepEqual({ caseKey: saved.caseKey, steps: saved.steps }, { caseKey: "k1", steps: 4 });
  assert.ok(saved.seconds > 15 && saved.seconds < 60, `estimate ${saved.seconds}s`);
  assert.ok(fs.existsSync(path.join(root, "out", "v1.storyboard.md")));
});

test("a run() that loops on live page state stops with a note instead of hanging", async t => {
  const root = tmp(t);
  const config = {
    ...forkliftCase(root),
    async run({ page, demo }) {
      await demo.caption("Wait for the bar");
      for (;;) { await page.waitForTimeout(10); if (String(await page.locator("#bar").innerText()) === "7/7") break; }
    },
  };
  const result = await storyboard(config, { write: false });
  assert.match(result.stopped, /stopped after \d+ page calls/);
  assert.match(result.markdown, /\*\*Storyboard incomplete:\*\*/);
  assert.equal(result.steps, 1);
});

test("recording numbers steps against a storyboard of the same case only", async t => {
  const root = tmp(t);
  const events = [];
  const config = {
    output: path.join(root, "final.mp4"), projectDir: root, baseURL: "http://127.0.0.1:3000",
    title: { title: "T", lines: [] },
    run: async ({ demo }) => { await demo.caption("one"); await demo.caption("two"); },
  };
  const kit = {
    recordCard: async o => { const f = path.join(o.outDir, "card.webm"); fs.writeFileSync(f, "c"); return f; },
    startSession: async o => ({ page: {}, demo: { caption: async () => events.push("cap") }, browser: { close: async () => {} },
      finish: async () => { const f = path.join(o.outDir, "case.webm"); fs.writeFileSync(f, "r"); return f; } }),
  };
  const edit = async () => ({ status: "needs-review" });
  await storyboard(config, { caseKey: "same" });
  await runCase(config, { caseKey: "same", kit, edit });
  let log = fs.readFileSync(path.join(root, "final.progress.log"), "utf8");
  assert.match(log, / STEP 1\/2 one\n.* STEP 2\/2 two\n/);
  await runCase(config, { caseKey: "changed", kit, edit, retake: true });
  log = fs.readFileSync(path.join(root, "final.progress.log"), "utf8");
  assert.match(log, / STEP 1 one\n/, "a stale storyboard must not claim a total");
  assert.equal(events.length, 4);
});
