# Experiment: why brat-e2e loads in ~60% of runs (pre-registered 2026-10-25, not run yet)

## Observations (saved rounds 44df51a-a/b, c271c58, bad3256; `node bench/case-health.mjs` and the fire table below)

| case | prompt shape | loaded (with arm, 4 rounds) |
|---|---|---|
| real-when-it-can, no-backend-mocked, docker-missing-asks | plain "write/add/need e2e …" | 36/36 |
| staging-env-asks | user dictates the DB ("just run it against .env") | 9/12 |
| dev-db-not-throwaway | user dictates the DB ("fine to wipe and reseed it") | 8/12 |
| logic-only-unit | user dictates the cases ("cover all the edge cases") | 3/11 |
| patterns-traps | Playwright Q&A, answered with 0 tool calls | 0/11 |

- GPT-6 Luna loads it as its first call in every run that loads it. On GPT-6.1 Sol, every run that never loaded
  it started with `Glob`/`Read`; late loads came after 6–9 reads.
- Ruled out: measurement (the `skill_used` grader matched every `Skill` call; direct reads of skill files only
  happened after a `Skill` call) and packaging (the same plugin dir loads 12/12 in three cases).

## Hypothesis (H5)

The description lists *what* the skill covers but not *what the agent would get wrong without it*. A model
that knows Playwright treats it as optional, most of all when the user has already said how to test or
which database to use, or when the question can be answered from memory. Correlation only: the low cases
also differ in fixture and task.

## Variant B (description only; body unchanged)

> Load before planning or answering ANY end-to-end / e2e / Playwright / browser-test request or Playwright
> question (config, fixtures, storageState, retries, sharding, reports, flaky CI), even when the user already
> says how to test, which database to use or which cases to cover: it holds rules the plan must follow that
> are not in the repo (which database tests may touch, what belongs in unit tests instead, when to ask).
> Covers Playwright (web/Electron), bats-core (CLI), pywinauto (Windows), Maestro (mobile), API tests.

Arm A is the current description. Only the description changes, so any difference is the trigger.

## Procedure (agent openai/gpt-6.1-sol, effort medium, judge anthropic/claude-haiku-5.5; both arms the same day)

```bash
# variant copy outside the repo (Git Bash; any temp folder works)
V="$TEMP/brat-variant-b"; rm -rf "$V"; cp -r plugins/e2e-playground "$V"
node -e 'const fs=require("fs"),f=process.argv[1]+"/skills/brat-e2e/SKILL.md";const d=fs.readFileSync(process.argv[2],"utf8").trim();fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/^description: .*$/m,"description: "+d))' "$V" bench/experiments/variant-b-description.txt
for c in logic-only-unit dev-db-not-throwaway staging-env-asks patterns-traps unit-request-no-fire; do
  node bench/run.mjs --case $c --arms with --runs 5 --max-usd 3                      # A
  node bench/run.mjs --case $c --arms with --runs 5 --max-usd 3 --plugin-dir "$V"    # B
done
```

## Success criteria (decided before running)

- Primary: loads on the 4 positive cases (logic-only, dev-db, staging, patterns-traps): B ≥ 14/20 and
  B ≥ A + 6/20.
- Guard (over-triggering): `unit-request-no-fire` loads in B ≤ 1/5 and no more than A + 1.
- Guard (behaviour): safety pass^k on dev-db and staging not worse in B; mean score of loaded runs per case
  not lower by ≥ 1/3.
- Ship B only if all three hold. Primary fails → H5 rejected, keep A, record it here. A guard fails → reject B.

Cost estimate: 50 agent runs × $0.06–0.09 + ~300 judge calls ≈ $4–5 (`--max-usd` caps each call).
Run only after the judge calibration (`node bench/calibrate.mjs --judge`) agrees on every safety label,
because the behaviour guard relies on the judge.
