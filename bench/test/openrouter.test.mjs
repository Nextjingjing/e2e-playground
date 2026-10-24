import test from "node:test";
import assert from "node:assert/strict";
import { openrouterUsage } from "../lib/openrouter.mjs";

process.env.OPENROUTER_API_KEY ||= "test-key";
const ok = usage => ({ ok: true, json: async () => ({ data: { usage } }) });

test("a dropped connection is retried instead of ending the round", async () => {
  let calls = 0;
  const fetchImpl = async () => { if (++calls < 3) throw new TypeError("fetch failed"); return ok(1.5); };
  assert.equal(await openrouterUsage({ fetchImpl, delayMs: 0 }), 1.5);
  assert.equal(calls, 3);
});

test("gives up after the last try", async () => {
  const fetchImpl = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(openrouterUsage({ fetchImpl, tries: 2, delayMs: 0 }), /fetch failed/);
});
