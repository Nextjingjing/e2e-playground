# Show-and-tell fast path implementation plan

> **For agentic workers:** Use executing-plans to implement these tasks inline.

**Goal:** Reduce repeated agent work by bundling recording and editing commands, with safe resume and a shorter default workflow.

**Architecture:** Keep demo-kit and post.py as the recording/rendering engines. Add a cached `post.py finish` command and a small case runner/template. Persist phase checkpoints in one job sidecar; human visual review stays explicit.

**Tech Stack:** Node.js CommonJS, Python standard library, existing Playwright and ffmpeg.

**Spec:** User-approved proposal in this conversation: default single-thread/single-case flow, reusable scripts, one job file, bounded retakes, real app/data, redaction and verification preserved.

## Global constraints

- Work in the existing checkout; preserve unrelated uncommitted benchmark/brat-e2e changes.
- No automatic rerun of actions that consume real data. Explicit retake, at most two recording attempts.
- No credentials in job/config examples/logs. Login reads environment variables; redaction stays on.
- Cache reuse requires unchanged source, marks, render settings and output. Never manufacture a successful visual review.
- Shared databases still require protection; only confirmed disposable data may skip backup.
- No paid model benchmarks or publishing as part of this implementation.

## Review focus

- Input/output paths containing spaces and relative paths on Windows.
- Invalidated video/marks/settings must not reuse a stale render or review.
- Failed recording or verification must close the browser and stop before post-processing.
- Resume must never consume the same data a second time silently.
- A ready-to-review video must remain distinguishable from an accepted video.

### Task 1: One-command cached editing

- [x] Add failing Python tests for render/sheet reuse, invalidation, review state and input validation.
- [x] Add `post.py finish VIDEO OUT [--card CARD] [--music] [--times ...] [--force]`.
- [x] Store only generated phase metadata in `OUT.job.json`; preserve recording checkpoint.
- [x] Verify with real ffmpeg clips, including paths with spaces and review invalidation.

### Task 2: Reusable recording runner

- [x] Add failing Node tests for first run, safe resume, explicit retake budget and cleanup on failure.
- [x] Add `scripts/run-case.cjs` and `assets/case-template.cjs`; keep app-specific actions in the case module.
- [x] Run the existing kit, optional read-only verification, then `post.py finish` in one invocation.
- [x] Verify one physical browser action against a local test server and resume without repeating it.

### Task 3: Short default workflow and final verification

- [x] Rewrite SKILL.md around the single-case path; move multi-case coordination to conditional reference guidance.
- [x] Align recording/agent references, document commands and keep old post.py commands compatible.
- [x] Run focused suites, CLI help and whitespace checks; obtain one independent review and address important findings.
- [x] Record verification and limitations below; leave changes uncommitted for review.

## Execution notes

- Baseline: show-and-tell files clean; unrelated changes already present in benchmark and brat-e2e files.
- Python: 11/11 passed, including a real ffmpeg round trip and unchanged-output resume.
- Node: 12/12 passed (11 orchestration/failure tests plus one real Chromium/HTTP/ffmpeg CLI test).
- Independent review found two important issues; both reproduced RED then fixed GREEN: changed-case editing-only resume, and Chromium cleanup before returning a session.
- The CLI integration test edits the case file, refuses an implicit replay, then succeeds with --edit-only while the server-side movement count stays exactly one.
- New login state stays in memory; the browser integration test asserts no _auth-state.json artifact.
- Existing terminal suite: 27/28 passed in the full run; its unchanged capture timing test failed with Missing expected rejection, then passed alone. ConPTY AttachConsole diagnostics also appeared in the full run. No terminal capture code/test was changed.
- CLI smoke measured about 24 seconds for the first small fixture recording/edit and 1.55 seconds for resume; these are fixture timings, not model/token benchmarks. Actual token savings have not been measured.
- Installed skill is a junction to this repo; the new files are immediately available through the existing skill path.
- No commits, paid model evaluations or publishing performed.
