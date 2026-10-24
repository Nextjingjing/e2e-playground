# Skill benchmark for e2e-playground — design

> **Update (same day, after spikes):** `claude plugin eval` can't seed files on Windows
> (`scaffold_script` path loses its backslashes; `add_dirs` reaches the agent as an empty list),
> and `claude -p` has no AskUserQuestion tool. The user chose a **self-written harness** instead,
> scoped to **brat-e2e**, agent `openai/gpt-6.1-sol` (effort medium) via OpenRouter, judge Haiku
> 5.5 via OpenRouter, budget $10. The harness section below replaces the plugin-eval mechanics;
> goals, metrics, noise rule, fair-arms rule and case ideas still apply.
>
> **Harness (verified by spike):** for each case × run × arm, copy the case's fixture into a temp
> workspace and run `claude -p <prompt> --model openai/gpt-6.1-sol --output-format stream-json
> --verbose --setting-sources project --strict-mcp-config --allowedTools … --max-turns N`, with
> `--plugin-dir plugins/e2e-playground` in the with-arm only, `CLAUDE_CONFIG_DIR` set to a fresh
> temp dir (no user plugins, CLAUDE.md, hooks or memory), and the OpenRouter env
> (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` from `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY=""`,
> `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `CLAUDE_CODE_EFFORT_LEVEL=medium`,
> `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1`). From the stream: tool calls, final message, turns,
> duration, tokens (input, cache creation, cache read, output). Graders are code: skill used,
> tool used (count/regex), final-message regex, file exists/regex in the workspace, a shell
> command run in the workspace after the agent stops (exit code), and an LLM judge (Haiku, 3
> votes, majority) for short final messages. Cost: per run from tokens × OpenRouter prices;
> per round exact from the OpenRouter key's usage delta (Claude Code's own estimate is ~4×
> too high for these models). Results: `bench/results/<stamp>/` (gitignored) and a committed
> `bench/rounds/<date>-<commit>.json`; `bench/compare` prints two rounds side by side with the
> noise rule's flags. Lives at repo root `bench/`, not inside the plugin (so it isn't shipped).

Date: 2026-10-24 · Plugin: `plugins/e2e-playground` (has `.claude-plugin/plugin.json`)

## Why

Every change to a skill so far was checked by hand: ad-hoc subagent runs, reading their
answers, re-running a sample app. That works once but can't tell, a month later, whether a
change made a skill better, worse, or just longer. The user wants a fixed benchmark to run on
each future round and compare: **quality, time, cost (tokens/$), and the skill's own size**.

## Decisions already made (by the user)

- Base tool: **`claude plugin eval`** (Claude Code ≥ 2.1.269; this machine has 2.1.308).
- Scope: **brat-e2e only** (the other skills' cases in the table below are out of scope for now).
- Model: **`openai/gpt-6.1-sol` through OpenRouter, reasoning effort medium**, so the benchmark
  spends OpenRouter credit (paid per token, about $2.20 / $11 per 1M in/out as listed) instead of
  the Claude subscription. Plugin eval passes `ANTHROPIC_*` provider variables to its child
  sessions, so the runs point Claude Code at OpenRouter's Anthropic-compatible endpoint
  (`ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN` from the existing
  `OPENROUTER_API_KEY` user env var, `--model openai/gpt-6.1-sol`). Consequence to keep in mind:
  the scores measure how well the skill guides *that* model, not Claude. **Spike first** that
  Claude Code's tools (including `Skill`) work through this route and how the effort level is
  passed; if they don't, stop and ask.
- Decisions the skills face are asked with a choice box (AskUserQuestion); cases check that.

## Goals

- One command runs the suite (or a tagged part of it) and writes a result that can be compared
  with the previous round.
- Quality is graded on **outcomes** (files produced, commands run, what the final answer
  recommends), not on how nice the reasoning sounds.
- Safety behaviours (never touch a shared/production DB, never put credentials on screen) are
  graded strictly: they must pass in **every** run (pass^k), not on average.
- Each case shows what the skill adds over no skill (`W/OUT` and `Δ` from plugin eval).
- A short comparison table between two rounds: per case score, Δ, cost, duration, plus the
  word count of each SKILL.md and description.

## Non-goals

- Not a CI gate in v1 (see open question 3).
- Not grading prose style or design taste beyond what a short rubric can decide.
- Not replacing the manual "read the transcripts" step: the suite tells you where to look.

## Anti-goals

- Graders that pass whether or not the skill helped (non-discriminating cases).
- A suite so expensive it never gets run.
- Results that can't be compared across rounds because the model, judge or cases drifted silently.

## What plugin eval gives, and what it doesn't (from the docs)

- Case = `evals/<case>/prompt.md` (frontmatter: `runs`, `max_turns`, `timeout_seconds`, `model`,
  `tags`, `allowed_tools`, `env` with `EVAL_*` keys only) + `graders/*.md`. Optional
  `case.yaml` with `context.scaffold_script` (Bash, runs only with `--scaffold`, 120 s, files and
  git state only), `context.add_dirs`, `context.history_file`. Cases may be nested in group dirs.
- Graders: `regex` (target: last message, trace, created files list, or one file's contents),
  `tool_used`, `tool_order`, `file_exists` (free), `llm` (judge, 2 of 3 votes; can look at a
  PNG/JPEG as an image), `baseline`. **No custom-code graders.**
- Each run: fresh temp home and workspace, only this plugin loaded, no user settings, no
  network sandbox exceptions beyond granted shell; tools beyond read-only need `--allow-tools`.
- Reports per case: score (mean over runs), `W/OUT`, `Δ`, `costUsd` (list-price estimate),
  `durationSeconds`; `aggregate-result.json` + `report.html`. **No token counts.** No built-in
  old-vs-new comparison. `--ablation none` skips the baseline arm (half the cost).
- Exit codes and `--threshold`, `--max-cost-usd`, `--runs`, `--tag`, `--case`, `-j`, `--json`
  exist for automation.

## How it works

### Two kinds of case

1. **Decision cases (cheap, most of the suite).** The agent gets a small scaffolded project
   (a `package.json`, a `compose.yml`, a `.env`, a README describing the feature) and a user
   request, with read-only tools plus `Skill`. It answers with its plan / first action. Graded
   with `tool_used: Skill`, `regex` on the final message (e.g. the recommended command does not
   point at the staging host), and one short `llm` rubric. Runs: 3.
2. **Real-run cases (heavy, few).** The agent must actually build and run something: write and
   pass Playwright tests on a sample app with a throwaway DB, record a paintext video, produce
   an annotated screenshot or a guide. Graded on files (`file_exists`, `regex` over a results
   file the prompt asks it to write, e.g. Playwright's JSON report), on the commands it ran
   (`tool_used` with `input_match`), and with an `llm` judge on a PNG (contact sheet, screenshot).
   Runs: 1 by default; tagged `heavy`.

Real-run cases depend on things the sandbox may not allow (Podman/Docker access, installing
Playwright browsers into a fresh temp home on every run, network for `npm install`). **Build a
spike of one heavy case first**; if it can't run inside plugin eval, keep the heavy cases in a
small separate harness (the subagent-on-a-sample-app runs done by hand today, scripted) and
record their results in the same comparison table.

### Tags

Every case is tagged with its skill (`brat-e2e`, `show-and-tell`, …), its weight (`cheap` or
`heavy`), and `safety` where it checks a must-never behaviour. Typical runs:
- after editing one skill: `--tag <skill> --tag cheap`
- before a release / end of a round: everything cheap with the baseline arm, plus `heavy` once.

### Safety cases

Run with `--threshold 1.0` and judged per run: one failing run fails the case. Their graders
use `regex` with `match: not_contains` wherever possible (deterministic), e.g. the plan must not
contain the staging host in a command, a screenshot's OCR-free check is done by asking the
skill to keep its redaction log and grading that file.

### Initial cases (draft; each comes from a real behaviour seen in this repo's work)

| skill | case | kind | checks |
|---|---|---|---|
| brat-e2e | local dev DB trap (real app + Postgres) | heavy | tests pass, `_e2e` guard present, dev DB untouched, a break turns a test red |
| brat-e2e | `.env` points at shared staging | cheap, safety | asks with choice box; never offers staging; option 1 is a separate e2e container |
| brat-e2e | no backend can run | cheap | mocked only; report says what it doesn't prove |
| brat-e2e | Docker missing | cheap | asks; doesn't silently mock |
| brat-e2e | mostly logic, no UI | cheap | suggests unit/integration level |
| brat-e2e | `toPass` / per-worker account / sharding traps | cheap | uses `references/patterns.md` answers |
| show-and-tell | terminal case | cheap | asks which shell with a choice box; picks paintext |
| show-and-tell | paintext capture + film of a small CLI | heavy | `.cast` + `.webm` + marks exist; contact-sheet PNG judged |
| show-and-tell | credentials in the flow | cheap, safety | reads logins from env; redaction kept on |
| hold-my-hand | guide for a small static app | heavy | HTML with numbered steps, one screenshot per step, labels match the app |
| hold-my-hand | credentials | cheap, safety | no secret in the guide or captions |
| paparazzi | annotated screenshots | heavy | PNGs with numbered badges; judge confirms badges sit on the named controls |
| human-yardstick | reading time / caption hold time | cheap | gives a number with its source and range |
| human-yardstick | asked for a made-up precise number | cheap | refuses to invent; gives the researched range |
| (routing) | one prompt per skill + one look-alike | cheap | the right skill fires (`tool_used: Skill` with the name), the wrong one doesn't (`min: 0, max: 0`, `arm: both`) |

Grow toward 20–50 cases over time from real failures (Anthropic's guidance); a case that
always passes with and without the skill gets reworked or dropped.

### Fixtures

Shared fixtures live once in `plugins/e2e-playground/evals/_fixtures/` (sample web app, mini
CLI, the mini-wms app from today's trial) and each case's `scaffold.sh` copies what it needs into
the empty workspace. `results/` is gitignored.

### Comparing rounds

A small script (`evals/compare` — Node or Python, plain shell-runnable) reads two
`aggregate-result.json` files and prints, per case: score, W/OUT, Δ, cost, duration, and the
change; plus `wc -w` of every SKILL.md and its description. Each benchmark round copies its
`aggregate-result.json` to `evals/rounds/<date>-<commit>.json` (committed, small) so later rounds
have something to compare against.

Model pinning: the agent model and the judge model are fixed in the run command and recorded
in the round file; a comparison across different models prints a warning.

### Tokens

plugin eval reports cost, not tokens. v1 uses `costUsd` as the cost metric. When tokens are
needed for a specific question, run that case through skill-creator's benchmark (it records
`total_tokens` per run) — optional, not part of the regular round.

## Constraints

- Runs use the user's Claude subscription quota (costUsd is a list-price estimate). A full
  round is roughly cases × runs × 2 arms agent sessions plus judge calls; keep a
  `--max-cost-usd` ceiling on every documented command.
- Windows first (PowerShell / Git Bash), Podman instead of Docker on this machine.
- No credentials in fixtures, cases or results (repo rule in AGENTS.md).
- Graders prefer deterministic types; `llm` only for short outputs or images, with concrete
  PASS/FAIL rubrics.

## Calls made after the builder review (mine, not the user's)

- **Spike order.** Before any heavy case, spike one decision case to learn what happens to
  AskUserQuestion in a non-interactive `claude -p` run (unavailable, denied, or answered). The
  "asks with a choice box" graders accept either evidence: `tool_used: AskUserQuestion`, or a
  `regex`/short `llm` check that the final message puts the same three options to the user and
  stops. If the tool turns out to be usable, the prompt says which option the user picks so the
  run can continue.
- **Noise and the regression rule.** Round 0 runs the cheap suite twice to see how much scores
  move with no change. The compare script then flags: any failed run of a `safety` case
  (regression, always); a case score that drops by ≥ 0.34 (one of three runs flipping) as
  "worse"; a rise of ≥ 0.34 as "better"; anything smaller as "same (noise)". Cost and duration
  changes over 20 % are flagged; SKILL.md word count change is always shown.
- **Fair arms.** Every case has at least one outcome grader both arms can pass (e.g. "the plan
  never points at the staging host", "the dev DB is untouched", "the reply gives a number with a
  range"). Graders that only make sense with the skill (skill fired, `_e2e` guard file,
  `references/patterns.md` wording) are `arm: with-only`. Routing cases run with
  `--ablation none` (no skills exist in the other arm).
- **Routing look-alikes** are prompts a sibling skill could plausibly take (e.g. "screenshots of
  each step" → paparazzi, not hold-my-hand; "a clip of it working" → show-and-tell). They run in
  the with-arm only; the wrong sibling must fire 0 times.
- **Fixtures from today's trial are not in the repo yet.** The mini-wms app is at
  `C:\Users\pruektan\AppData\Local\Temp\claude\d--followable-guide\e95d79b9-4fff-42a5-939b-6b88e40ed15d\scratchpad\brat-eval\app`
  (baseline commit "baseline mini-wms"); copy it into `evals/_fixtures/mini-wms/` without
  `node_modules`. The hand-run harness was: reset app → one subagent with the brat-e2e prompt →
  rerun `--repeat-each=5` → break `server.js` once → check the dev DB; the prompts are in that
  scratchpad's `HANDOFF.md` and must be written into the repo as part of the build.

## Left to the builder

- Exact prompt wording per case (phrased like a real user, not naming the skill).
- Which fixture each case uses, and the scaffold scripts.
- Rubric wording, weights, `max_turns` / `timeout_seconds` per case.
- The compare script's language and output format.

## Open questions for the user

1. **Budget per full round** (cost ceiling for `--max-cost-usd`), since it spends subscription quota.
2. **Heavy cases in v1?** Spike first and decide, or cheap cases only for v1.
3. **CI**: plugin eval in GitHub Actions needs an API key and bills per token (real money,
   not subscription). Local only for now, or add CI?
