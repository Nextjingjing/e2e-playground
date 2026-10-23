# Brief template — one recording agent per case

Copy this into a file in your scratch folder, fill the `<…>` parts once, and give each
agent: "Read and follow <brief path>. Your case: …" plus the per-case block at the end.

---

# Brief: <feature> demo videos (one agent per case)

<One paragraph: what the feature does and what the videos must prove. Name the UI words
the viewer will see. Point to any design notes worth reading first.>

## Hard rules (do not break)
1. Real app <URL> + real backend + real DB <name>. No mocks, no `page.route`, no API calls
   from the recording script, no `element.click()`/`dispatchEvent`. Every filmed action
   goes through the kit (`demo.click`, `demo.type`, `demo.scanText`, `demo.pasteAndEnter`).
2. Act like a person: the cursor moves then clicks; important steps `{ slow: true }`;
   highlight the proof.
3. Stand-ins allowed only for inputs from outside the browser: <e.g. "#dev mode shows a
   copy button for each barcode; click it, click the scan field, pasteAndEnter">.
4. Do not film setup. Start on <start screen> with the item already there.
5. Exactly <one> item per case.
6. Title card first (text in your case block); captions on every step.
7. Story: <generic story every case follows, ending with the proof on screen>.

## Do NOT
- Edit the product repo or run git commands that change state. Found a bug? Stop and
  report it with a screenshot and what you did.
- Restore/back up/drop the DB, delete data you did not create, or touch other agents' data.
- Write results to the DB directly. Read-only queries are fine.
- Fake a step because the real system will not get there — stop and report instead.
- Run paid tools.

## Kit
`<skill>/scripts/demo-kit.cjs` (read its header). Your files go in `<scratch>/cases/<case>/`.
Wrap every wait for the app in `demo.waitApp(...)` so post.py can fast-forward it.
Login helper / credentials: `<path>` (never print them).

```
python <skill>/scripts/post.py one <case>.webm "<output dir>/<name>.mp4" --card <card>.webm --seed <seed>
```

Read-only DB access: `<command>`.

## Start from FLOWS.md, not the code
`<work>/FLOWS.md` already has the routes, exact labels, working locators, waits and gotchas
for every screen, and the setup command. Use it as is. Read product code only when a line in
FLOWS.md turns out wrong — then fix that line (others read it too) and carry on.

## Data setup (off camera)
- Run the setup command from FLOWS.md / your case block. Only if there is none: prefer the
  real UI the staff use, driven by a non-recorded Playwright run.
- Allowed stand-in for systems that do not exist locally: `<e.g. dev fixtures module>`.
- Claims: read `<scratch>/claims/*.json` before choosing data; write yours. Pick records
  nobody else claimed. Use your own identifiers from your case block.
- Each take consumes data; max 3 recorded takes. Dry-run (non-recorded) first.

## Keep STATUS.md (you may be stopped at any moment)
After every step write `<scratch>/cases/<case>/STATUS.md`: what is done (files, data ids,
which take consumed which data), what you are doing now, the exact next step. Someone else
may resume from it — make it enough on its own.

## Save tokens
- Explore with text (`innerText`, `ariaSnapshot`) before screenshots; keep screenshots
  ≤ 960 px wide. Print the first line of an error, not the whole call log.
- Read narrowly: `grep -n` + a few lines of context, or a line range. Never a whole large
  file. Never re-read a file you already read in this task.
- Check videos with ONE contact sheet: `python <skill>/scripts/post.py sheet <mp4> <png> <t1> <t2> ...`.
  Before looking at any video run `post.py seen <mp4>`; if it says SEEN, do not open frames.

## Verify, then report (final message, concise)
Make a contact sheet of title card / key action / proof / end and look at it once; confirm
in the DB read-only; then save what you saw:
`post.py seen <mp4> --save "<time> <what> ok | ..." --by <case>-agent`. Report: mp4 path + length; data setup and ids; step-by-step with timestamps;
anything that differed from the design (with evidence); anything typed or stood in for.

---

Per-case block (one per agent):

```
Case: <name>   folder: cases/<case>   video: NN-<case>   seed: <n>   output: <path>.mp4
Identifiers: <queue/order number reserved for this agent>
Data: <what to set up and how>
Story: <steps, which ones slow, what to highlight>
Title card: tag "<…>", title "<…>", lines ["<…>", "<…>"]
Mid card (optional): tag "<…>", title "<…>", lines ["<…>"]
```
