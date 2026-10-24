# Skill benchmark

Measures a skill round by round so a change can be called better, worse or just longer.
Today it covers **brat-e2e** and **show-and-tell** (7 cases each; `--skill show-and-tell`). Design: `docs/superpowers/specs/2026-10-24-skill-benchmark-design.md`.

## What a round measures

| metric | how |
|---|---|
| quality | each case runs 3× **with** the plugin and 3× **without** it; graders score each run 0–1; the case score is the mean |
| what the skill adds | Δ = with − without (graders that can only pass with the skill, e.g. "the skill fired", are left out of both arms) |
| safety | cases tagged `safety` must pass **every** run (pass^k), or the round is a regression |
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
```

Options: `--skill brat-e2e`, `--tag`, `--case`, `--runs`, `--arms with,without`, `-j 3` (parallel runs),
`--max-usd 3` (stops starting runs once the round's real spend reaches it), `--model`, `--effort`,
`--keep` (keep the temp workspaces to inspect).

Output: `bench/results/<stamp>/results.json` (every run: score, graders with detail, tokens, time,
final message, tools used) and `summary.md`. `results/` is not committed; copy a round you want to keep to
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
differ between the two rounds (then the scores are not comparable).

Always open a few runs in `results.json` (`final`, `grades[].detail`) before acting on a number.

## Add a case

1. A fixture under `bench/fixtures/<name>/` (a tiny repo: README describing the feature, the files the
   agent should read; passwords as `****`).
2. `bench/<skill>/cases/<case>/case.json`:
   `{ name, tags, fixture, prompt, runs?, maxTurns?, timeoutSec?, tools?, graders: [...] }`.
   Phrase the prompt like a real user, without naming the skill.
3. Graders: `skill_used {skill}`, `tool_used {tool, input?, min?, max?}`, `final_regex {pattern, flags?, match?}`,
   `file_exists {glob, exists?}`, `file_regex {path, pattern, match?}`, `command {run, expectExit?}`,
   `judge {criteria}` (concrete PASS / FAIL sentences). Any grader: `weight`, `withOnly`.
   Give every case at least one grader that can pass without the skill.
4. `cd bench && npm test` checks every case loads.

A case that scores the same with and without the skill in every round isn't measuring the skill:
rework or drop it. Grow the suite from real failures.

## Observed noise

brat-e2e, two identical rounds (A/B, 2026-10-24, same commit, GPT-6.1 Sol medium, 3 runs/case): case means
moved by up to 1/3 with nothing changed, so a single "better"/"worse" on one case is weak evidence. Trust a
change when it repeats across rounds or across several cases, and read the runs.

Biggest driver seen: whether the model invokes the skill at all (brat-e2e fired in 13–15 of 21 with-arm runs
per round; show-and-tell 14–15 of 15). Runs where the skill didn't fire score like the no-skill arm.

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
