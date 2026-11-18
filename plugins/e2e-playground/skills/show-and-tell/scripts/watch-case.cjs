#!/usr/bin/env node
// Watch one run-case.cjs run and print only the lines worth acting on, then exit when the
// run ends — successfully, with a failure, by dying silently, or by getting stuck.
// Usage: node watch-case.cjs OUT.mp4|OUT.progress.log [--stall 180] [--grace 15] [--since 120]
//
// Prints:  STEP/SETUP/TAKE/REC/VERIFY/EDIT/SHOT lines as they happen (progress),
//          DONE ... / FAIL ...            then exits 0 / 1
//          STALL no progress for Ns ...   when nothing new arrives for --stall seconds (keeps watching)
//          DEAD runner pid N exited ...   when the runner is gone without DONE/FAIL, exits 2
//
// Which run is watched (safe to start before, with or after the runner, and to restart):
//  - a run whose runner is still alive, however long ago it started — a watcher re-armed
//    after its monitor expired picks the running take up again;
//  - a run that starts after the watcher;
//  - a run that had already ended when the watcher started is reported only when no newer
//    run appears within --grace seconds (the next runner may not have reset the log yet) and
//    it ended at most --since seconds before the watcher started. Older logs are ignored.
const fs = require("node:fs");

const RUN = /^\S+ \+\d+s RUN pid=(\d+) at=(\d+)/;
const DONE = /^\S+ \+\d+s DONE\b/;
const FAIL = /^\S+ \+\d+s FAIL\b/;
const PLUS = /^\S+ \+(\d+)s /;
const outcome = line => (DONE.test(line) ? 0 : FAIL.test(line) ? 1 : null);

function parseArgs(argv) {
  const opts = { stall: 180, since: 120, grace: 15, poll: 1000, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stall") opts.stall = Number(argv[++i]);
    else if (a === "--since") opts.since = Number(argv[++i]);
    else if (a === "--grace") opts.grace = Number(argv[++i]);
    else if (a === "--poll") opts.poll = Number(argv[++i]);
    else if (!opts.file) opts.file = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.file) throw new Error("usage: node watch-case.cjs OUT.mp4|OUT.progress.log [--stall 180] [--grace 15] [--since 120]");
  if (opts.file.toLowerCase().endsWith(".mp4")) opts.file = opts.file.slice(0, -4) + ".progress.log";
  return opts;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

// The newest run in the log: its runner pid, start time, lines after RUN, whether it has
// ended (DONE/FAIL) and the time of its last line.
function newestRun(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(RUN);
    if (!m) continue;
    const rest = lines.slice(i + 1);
    const at = Number(m[2]);
    const lastPlus = Number((rest.at(-1) || "").match(PLUS)?.[1] || 0);
    return { pid: Number(m[1]), at, key: `${m[1]}@${m[2]}`, lines: rest,
      ended: rest.some(line => outcome(line) !== null), lastAt: at + lastPlus * 1000 };
  }
  return null;
}

const read = file => { try { return fs.readFileSync(file, "utf8"); } catch { return ""; } };
const hhmmss = ms => new Date(ms).toTimeString().slice(0, 8);

async function watch(opts, out = line => console.log(line)) {
  const started = Date.now();
  const grace = (opts.grace ?? 15) * 1000, since = (opts.since ?? 120) * 1000;
  let key = null, pid = null, shown = 0, lastChange = started, stallWarned = 0, skipped = null;

  // Is this run ours to report? See the header for the rules.
  const adoptable = run => {
    if (!run.ended && alive(run.pid)) return true;
    if (run.at >= started) return true;
    if (Date.now() - started < grace) return false;
    if (run.lastAt >= started - since) return true;
    skipped = run;
    return false;
  };

  for (;;) {
    const run = newestRun(read(opts.file));
    if (run && run.key !== key && adoptable(run)) {
      key = run.key; pid = run.pid; shown = 0; skipped = null;
      out(`RUN pid=${pid}${run.at < started ? ` (started ${hhmmss(run.at)}, before this watcher)` : ""}`);
    }
    if (key) {
      if (run && run.key === key) {
        for (const line of run.lines.slice(shown)) {
          out(line);
          lastChange = Date.now();
          stallWarned = 0;
          const code = outcome(line);
          if (code !== null) return code;
        }
        shown = run.lines.length;
      }
      if (!alive(pid)) {
        // Re-read once: the last line may have landed between the read and the check.
        const again = newestRun(read(opts.file));
        const late = again && again.key === key ? again.lines.slice(shown) : [];
        for (const line of late) {
          out(line);
          const code = outcome(line);
          if (code !== null) return code;
        }
        const last = (again && again.key === key ? again.lines : run && run.key === key ? run.lines : []).at(-1);
        out(`DEAD runner pid ${pid} exited without DONE/FAIL; last: ${last || "(nothing)"}`);
        return 2;
      }
    }
    const quiet = (Date.now() - lastChange) / 1000;
    if (quiet >= opts.stall * (stallWarned + 1)) {
      stallWarned++;
      const current = key && run && run.key === key ? run : null;
      out(current ? `STALL no progress for ${Math.round(quiet)}s; last: ${current.lines.at(-1) || "RUN"} (pid ${pid} still alive)`
        : `STALL no run started in ${opts.file} for ${Math.round(quiet)}s` +
          (skipped ? `; the run there ended at ${hhmmss(skipped.lastAt)}, too long before this watcher (see --since)` : ""));
    }
    await new Promise(resolve => setTimeout(resolve, opts.poll));
  }
}

module.exports = { watch, newestRun, parseArgs };
if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(64); }
  watch(opts).then(code => process.exit(code));
}
