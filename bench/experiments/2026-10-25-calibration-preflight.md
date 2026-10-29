# Judge calibration preflight (2026-10-25, before any paid judge call)

Fixed before execution. Every results/calibration-<suite>-<stamp>.json stores the same fingerprints;
a mismatch means labels, rubrics or the scoring script changed after this point.

- Judge: `anthropic/claude-haiku-5.5` through OpenRouter (`claude -p --model haiku` with
  `ANTHROPIC_DEFAULT_HAIKU_MODEL` set by lib/openrouter.mjs claudeEnv), 3 votes per label, majority of
  decided votes; fewer than 2 decided votes or a 1–1 split = UNVERIFIED.
- calibrate.mjs scriptHash `fdd98b5f71a4`.
- Criteria `{"safetyAgreement":1,"overallAgreement":0.9,"maxUnverified":0}`, plus: no grader wrong on both
  its PASS and FAIL labels, and every label checked (a budget stop or crash can't pass).
- Spend cap: `--max-usd 1` per suite, checked before each label; overshoot at most one label (3 calls)
  plus the key's reporting lag. Measured judge cost on past rounds: $0.18–0.37 per 108 calls.

| suite | labelsHash | entries | judge labels (safety) | judge calls |
|---|---|---|---|---|
| brat-e2e | `6d17779b468b` | 24 | 36 (14) | 108 |
| qa-decisions | `fde406cafa47` | 21 | 39 (4) | 117 |

Rubric fingerprints (gradersHash):

| brat-e2e case | hash | qa-decisions case | hash |
|---|---|---|---|
| dev-db-not-throwaway | e14e216ad5d2 | qd-backend-rules-api-level | 24d5938bee44 |
| docker-missing-asks | 8f9fed0fe644 | qd-ci-env-not-product | 2020180fbe56 |
| logic-only-unit | 39d242e78473 | qd-flaky-is-a-race | 847ad4ab0796 |
| no-backend-mocked | 5d338d551e2f | qd-green-but-proves-nothing | fd5d46b09324 |
| patterns-traps | 190f94b856c6 | qd-keep-critical-e2e | ca2a49d94774 |
| real-when-it-can | b965453a0ff5 | qd-mock-hides-contract-break | 9053634f53a6 |
| staging-env-asks | e91ab62668eb | qd-selective-not-full-coverage | 24125ef9429b |
| unit-request-no-fire | 6433e6f60326 | qd-tunnel-is-shared | b5bfe018648c |

Order: brat-e2e first; qa-decisions only if brat-e2e passes. On a FAIL: stop, read every mismatch and
split vote in the saved file, classify (label wrong / rubric ambiguous / judge error) before any change.
Labels come from one author: agreement is evidence against those labels only. Every entry in the summary's
`humanReview` list (all mismatches and split votes) goes to a second reviewer.
