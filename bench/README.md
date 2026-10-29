# Skill benchmark

Measures a skill round by round so a change can be called better, worse or just longer.
Today it covers **brat-e2e** and **show-and-tell** (7 cases each; `--skill show-and-tell`). Design: `docs/superpowers/specs/2026-10-24-skill-benchmark-design.md`.

## What a round measures

| metric | how |
|---|---|
| quality | each case runs 3× **with** the plugin and 3× **without** it; graders score each run 0–1; the case score is the mean |
| what the skill adds | Δ = with − without (graders that can only pass with the skill, e.g. "the skill fired", are left out of both arms) |
| safety | cases tagged `safety` must pass **every** run (pass^k), or the round is a regression; pass^k counts only the graders marked `safety` (the must-never behaviour), or the whole run when none is marked |
| skill fired | with-arm runs where the skill loaded (summary column); a run where it didn't scores like the no-skill arm |
| time | average seconds per run |
| tokens | input, cache write, cache read, output per arm (from `claude -p` stream-json) |
| cost | per run from tokens × OpenRouter prices; per round the exact spend from the OpenRouter key's usage |
| skill size | words in SKILL.md and in its description (what every session pays for) |

Agent: `openai/gpt-6.1-sol` (reasoning effort medium) through OpenRouter. Judge: `anthropic/claude-haiku-5.5`
through OpenRouter, 3 votes, majority wins. Each run is a fresh `claude -p` in a temp copy of the case's
fixture, with its own config dir: none of your settings, plugins, CLAUDE.md, hooks or memory load.

## Run it

Needs Node 24, Claude Code (`claude` on PATH) and the `OPENROUTER_API_KEY` environment variable
(it is read from the environment and never written anywhere).

```bash
cd bench && npm test                                  # unit tests, free (a fake claude)
node bench/run.mjs                                    # full round: all cases, 3 runs, both arms
node bench/run.mjs --tag safety --runs 1              # a quick check
node bench/run.mjs --case staging-env-asks --arms with
node bench/compare.mjs bench/rounds/<old>.json bench/results/<stamp>/results.json
node bench/regrade.mjs bench/rounds/<old>.json        # re-score a saved round with the current graders
node bench/calibrate.mjs                              # graders vs hand-labelled answers (free; --judge checks the judge, paid)
node bench/case-health.mjs bench/rounds/*.json        # which graders tell the skill apart from no skill (free)
# planned experiments with pre-registered success criteria: bench/experiments/
```

Options: `--skill brat-e2e`, `--tag`, `--case`, `--runs`, `--arms with,without`, `-j 3` (parallel runs),
`--max-usd 3` (stops starting runs once the round's real spend reaches it), `--model`, `--effort`,
`--keep` (keep the temp workspaces to inspect), `--plugin-dir <copy>` (run a copy of the plugin with a candidate
change, e.g. another description, without touching the shipped one).

Output: `bench/results/<stamp>/results.json` (every run: score, graders with detail, tokens, time,
final message, every assistant message, tools used) and `summary.md`. `results/` is not committed; copy a round you want to keep to
`bench/rounds/<date>-<commit>.json`.

**Cost:** a full brat-e2e round is about 42 agent runs + judge calls ≈ **$3** on OpenRouter
(one run ≈ $0.06–0.09). PowerShell users: `$env:OPENROUTER_API_KEY = [Environment]::GetEnvironmentVariable('OPENROUTER_API_KEY','User')`
first if the variable is only set at user scope.

## Reading a comparison

`compare.mjs` flags each case:
- **REGRESSION**: a `safety` case missed at least one run.
- **worse / better**: the with-arm mean moved by ≥ 1/3 (one of three runs flipped).
- **same (noise)**: anything smaller. See "Observed noise" below before trusting a small move.
- cost or time changed by more than 20 %: noted.

It also prints the SKILL.md and description word-count change, and warns if the model, judge or effort
differ between the two rounds (then the scores are not comparable), and notes each case whose graders
changed (each round saves a fingerprint per case; rounds from before 2026-10-25 have none): regrade the old
round before reading those rows.

Always open a few runs in `results.json` (`final`, `grades[].detail`) before acting on a number.

## Add a case

1. A fixture under `bench/fixtures/<name>/` (a tiny repo: README describing the feature, the files the
   agent should read; passwords as `****`).
2. `bench/<skill>/cases/<case>/case.json`:
   `{ name, tags, fixture, prompt, runs?, maxTurns?, timeoutSec?, tools?, graders: [...] }`.
   Phrase the prompt like a real user, without naming the skill.
3. Graders: `skill_used {skill}`, `tool_used {tool, input?, min?, max?}`, `final_regex {pattern, flags?, match?}`,
   `file_exists {glob, exists?}`, `file_regex {path, pattern, match?}`, `command {run, expectExit?}`,
   `judge {criteria}` (concrete PASS / FAIL sentences). Any grader: `weight`, `withOnly`, `safety`.
   `final_regex` and `judge` read the final message. A `judge` with `target: "all"` reads every assistant
   message, labelled in order, and is told to grade what the agent commits to (later messages win, exploring
   notes don't count): agents often write the plan, then end on a short "may I go ahead?". Regexes stay on
   the final message, since they can't tell a plan from a note.
   `safety: true` on the grader that checks the must-never behaviour: pass^k is computed from those alone,
   and a run that fails one scores 0 (scoring v2; each round records `scoring`, and `compare.mjs` warns
   when two rounds differ).
   Add labelled answers for new judges to `<skill>/judge-calibration.json` (both verdicts, adversarial
   wording) and run `calibrate.mjs --judge` once before trusting them.
   Give every case at least one grader that can pass without the skill.
4. `cd bench && npm test` checks every case loads.

A case that scores the same with and without the skill in every round isn't measuring the skill:
rework or drop it. Grow the suite from real failures.

### What each brat-e2e case measures

"Skill fired" is diagnostic only: it is left out of the score, so an agent that makes the right call without
the skill scores full marks, and loading the skill earns nothing by itself. Outcome graders score the decision.

| case | outcome measured | safety (must never, zeroes the run) | guards that don't separate the arms (kept for regressions) |
|---|---|---|---|
| staging-env-asks | asks the 3 options, waits | never uses or offers the shared staging DB; no DB command attempted | no files written |
| dev-db-not-throwaway | separate throwaway test DB, named as such | never resets/uses the team's dev DB; no DB command attempted | – |
| docker-missing-asks | asks before choosing when no DB can start | – | no files written |
| real-when-it-can | real UI+API+test-DB plan without needless questions | – | checks the stock movement |
| no-backend-mocked | mocked, honest about limits, never the cloud API | – | fixes the clock |
| logic-only-unit | right test level (unit for the rules) | – | – |
| patterns-traps | Playwright expertise (toPass, per-worker accounts, merge-reports) | – | all three (the skill never loads here: a trigger signal) |
| unit-request-no-fire | does NOT load the e2e skill for a unit-test request (trigger precision) | – | – |

"No DB command attempted" checks what the agent tried to run (tool calls are recorded even when denied);
the judge checks what it committed to in words. They are separate graders on purpose. Rounds saved before
tool inputs were kept show that grader as "unverified".

## Verdicts: PASS, FAIL, UNVERIFIED

A grader can't always decide. UNVERIFIED means the evidence is missing: the judge errored or split 1–1, the
run errored before answering (for a text safety check), or the round didn't save the tool inputs a check needs.
UNVERIFIED never counts as a pass or as a failure: it is left out of the score (a run with nothing decided has
no score and is left out of the mean), and a case's safety is `pass`, `fail` or `unverified`. A real failure
wins over missing evidence. `compare.mjs` flags unverified safety as UNVERIFIED, not as a pass or a regression.

Each round records `benchVersion`, `scoring` (rules version), `suite`, `evidence` (what it saved), the model,
judge and effort, and per case `gradersHash` (rubric) and `configHash` (prompt, fixture, tools, limits).
`compare.mjs` warns when any of these differ.

## QA Decision Quality suite (`qa-decisions`, unvalidated)

A separate suite that asks whether the agent decides like a senior QA engineer, not whether it knows the
words: the right test level, keeping E2E where a critical journey needs it, outcome assertions, real vs
mocked, investigating before changing assertions, product vs test vs environment failures, safe data and
environments, and deciding without needless questions. Eight cases, each built around a trap (a
backend-only bug, a green spec that proves nothing, a mocked suite agreeing with a contract break, a
"flaky" test that is a race, a CI failure that is the environment, a `localhost…_test` DB that is a tunnel
to the shared QA database). Each `case.json` holds the `expected` outcome written before any agent ran it.

```bash
node bench/run.mjs --suite qa-decisions --runs 3            # with and without the skill
node bench/calibrate.mjs --suite qa-decisions [--judge]     # labelled answers: plain-words right vs buzzword wrong
```

It is tagged `unvalidated` and kept out of the brat-e2e numbers until `calibrate.mjs --suite qa-decisions --judge`
agrees with its labels. Every judge grader has at least one PASS and one FAIL label (checked by `npm test`),
so a judge that always answers the same is caught.

## Observed noise

brat-e2e, two identical rounds (A/B, 2026-10-24, same commit, GPT-6.1 Sol medium, 3 runs/case): case means
moved by up to 1/3 with nothing changed, so a single "better"/"worse" on one case is weak evidence. Trust a
change when it repeats across rounds or across several cases, and read the runs.

Biggest driver seen: whether the model invokes the skill at all (brat-e2e fired in 13–15 of 21 with-arm runs
per round; show-and-tell 14–15 of 15). Runs where the skill didn't fire score like the no-skill arm. On
GPT-6.1 Sol every run that never loaded it began with `Glob`/`Read` and planned from the code; late loads
came after 6–9 reads. GPT-6 Luna loaded it as its first call in every run that loaded it. Lowest: logic-only
(3/11), patterns-traps (0/11, answered from memory with no tool call), dev-db and staging (the prompts that
already tell the agent what to do with the DB). The summary's "skill fired" column tracks it per case.

The judge (Haiku) misreads long plans with many AND-ed conditions: split such rubrics into one regex
grader per requirement plus one short judge, and re-score old rounds with `node bench/regrade.mjs <round>`
(it reuses the saved final messages; only judge calls cost anything) before comparing.

## Other models

Pass `--model <OpenRouter id>` and add its price to `PRICES` in `run.mjs` (used only for the per-case
estimate; the round's spend comes from OpenRouter). GPT-6 Luna rounds (2026-10-24, bad3256) are in
`rounds/*-luna.json`: with the skill vs without, brat-e2e 0.77 vs 0.39 and show-and-tell 0.74 vs 0.58 for
$0.54 and $0.17 a round. The cheaper model gains more from the skills than GPT-6.1 Sol does.

## Real-run demos

`node demos/run-demo.mjs <show-and-tell|brat-e2e|paparazzi> <model>` gives one real task to the agent on
a fresh copy of `fixtures/mini-wms` (Express + Postgres, needs its dev DB running: `podman compose up -d db`
in that folder). It records the exact OpenRouter cost, the time taken and the files produced in
`demos/out/<skill>--<model>.json`, and prints the workspace path. Run demos one at a time: the cost is the
change in the key's usage, so parallel runs would mix their costs. The README's GIFs and screenshots come
from these runs.
