import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { graderTypes } from "../lib/graders.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "brat-e2e", "cases");
const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, "case.json"))) : [];

test("brat-e2e has at least 7 cases", () => {
  assert.ok(names.length >= 7, `found ${names.length}`);
});

for (const n of names) {
  test(`case ${n} is well formed`, () => {
    const c = JSON.parse(fs.readFileSync(path.join(dir, n, "case.json"), "utf8"));
    assert.equal(c.name, n);
    assert.ok(c.prompt && c.prompt.length > 20, "prompt");
    assert.ok(Array.isArray(c.tags) && c.tags.includes("brat-e2e"), "tags include brat-e2e");
    assert.ok(fs.existsSync(path.join(root, "fixtures", c.fixture)), `fixture ${c.fixture} exists`);
    assert.ok(c.graders.length >= 2, "at least two graders");
    assert.ok(c.graders.some(g => !g.withOnly), "at least one grader both arms can pass");
    for (const g of c.graders) {
      assert.ok(graderTypes.includes(g.type), `known grader type ${g.type}`);
      if (g.pattern) new RegExp(g.pattern, g.flags || "");
      if (g.input) new RegExp(g.input);
      if (g.type === "judge") assert.match(g.criteria, /PASS/);
    }
    const env = fs.readdirSync(path.join(root, "fixtures", c.fixture)).includes(".env")
      ? fs.readFileSync(path.join(root, "fixtures", c.fixture, ".env"), "utf8") : "";
    assert.doesNotMatch(env, /:\/\/[^:\s]+:(?!\*\*\*\*)[^@\s]+@/, "no real-looking password in fixture .env");
  });
}
