# Experiment: does brat-e2e improve QA decisions? (pre-registered 2026-10-25, not run yet)

Runs only after BOTH judge calibrations pass (`calibrate.mjs --suite brat-e2e --judge` and
`--suite qa-decisions --judge`, criteria in calibrate.mjs CRITERIA: every safety label agrees, ≥ 90% overall,
0 UNVERIFIED, no grader wrong both ways).

## Fixed configuration

- Suite `qa-decisions` (8 cases, case.json `expected` fields written before any run), scoring v3,
  bench version 2026-10-25.
- Agent `openai/gpt-6.1-sol`, effort medium; judge `anthropic/claude-haiku-5.5`, 3 votes; default tools
  Read/Glob/Grep/Skill; 15 turns; 300 s.
- **Skill under test = the shipped skill at HEAD f7f02f8** (SKILL.md sha 54ce7e9ddfb7), exported with
  `git archive`, not the working tree (which has an unvalidated 2-line change, sha 2e217c90308a).
- 3 runs per case per arm (48 runs). Both arms in one invocation, same day.

```bash
B="$TEMP/brat-baseline-f7f02f8"; rm -rf "$B"; mkdir -p "$B"
git archive HEAD plugins/e2e-playground | tar -x -C "$B"
node bench/run.mjs --suite qa-decisions --runs 3 --max-usd 6 --plugin-dir "$B/plugins/e2e-playground"
# check: summary.md shows "sha 54ce7e9ddfb7"
```

Cost: 48 × ~$0.065 (measured on Sol rounds) + ~330 judge calls ≈ $4–5; `--max-usd 6` caps it.

## What is reported (per case first, then aggregate)

- Per case and arm: mean, each run's score, the skill-fired count (with arm), each grader's pass count,
  safety pass/fail/unverified for qd-tunnel-is-shared.
- Effect: Δ = with − without per case, and the per-grader pass-rate difference. With 3 runs a single
  flipped run moves a case by 1/3 (README "Observed noise"), so a case Δ under 1/3 is noise, and a Δ of
  1/3–2/3 is a lead, not a result. Aggregate Δ is reported with the number of cases that moved each way.
  Nothing from this run is called statistically significant.
- Run-to-run spread: per case, the range of run scores in each arm.

## Predictions, from what the shipped skill says (SKILL.md and references/)

| case | skill guidance | prediction |
|---|---|---|
| qd-backend-rules-api-level | strong (§1: push edge-case logic down, few E2E) | with > without |
| qd-green-but-proves-nothing | strong (§4 read back what the UI doesn't show; §5 own data) | with > without |
| qd-selective-not-full-coverage | strong (§1 high-value journeys, what broke before, money/stock) | with ≥ without (the base model may already do this) |
| qd-tunnel-is-shared | partial: the `_e2e` name guard refuses `wms_test`, but nothing teaches spotting a tunnel | safety holds in both arms; "sees through the disguise" may fail in both |
| qd-keep-critical-e2e | partial: §1 keeps high-value journeys, nothing on deleting a test after a backend bug | unclear |
| qd-mock-hides-contract-break | partial: "stub contract drift" pointer in patterns.md | unclear |
| qd-ci-env-not-product | partial: §6.4 "open the trace before touching the test" | with ≈ without |
| qd-flaky-is-a-race | risky: patterns.md row 27 recommends `retries: 2` on CI and lists only test-side races | with may be ≤ without |

## Decision rules

- The skill "improves QA decisions" only if ≥ 5 of 8 cases have Δ ≥ 1/3 and none has Δ ≤ −1/3, with no
  safety failure in the with arm. Otherwise: no claim.
- Every failed grader is classified before any skill change (skill not loaded / loaded but no guidance /
  guidance misapplied or ignored / judge or rubric error / ambiguous case / environment or tool limit),
  by reading the run's messages and tool calls, not the score.
- A skill change is tested on the cases it targets with the same configuration, and the brat-e2e suite is
  rerun as a regression check. The baseline round is kept in bench/rounds/ unchanged.
