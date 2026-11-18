#!/usr/bin/env node
// Watch one run-case.cjs run and print only the lines worth acting on, then exit when the
// run ends — successfully, with a failure, by dying silently, or by getting stuck.
// Usage: node watch-case.cjs OUT.mp4|OUT.progress.log [--stall 180] [--since 120]
//
// Prints:  STEP/SETUP/TAKE/REC/VERIFY/EDIT/SHOT lines as they happen (progress),
//          DONE ... / FAIL ...            then exits 0 / 1
//          STALL no progress for Ns ...   when nothing new arrives for --stall seconds (keeps watching)
//          DEAD runner pid N exited ...   when the runner is gone without DONE/FAIL, exits 2
// Runs that started more than --since seconds before the watcher are ignored, so an old
// log from a previous run never ends the watch early.
const fs = require("node:fs");

function parseArgs(argv) {
  const opts = { stall: 180, since: 120, poll: 1000, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stall") opts.stall = Number(argv[++i]);
    else if (a === "--since") opts.since = Number(argv[++i]);
    else if (a === "--poll") opts.poll = Number(argv[++i]);
    else if (!opts.file) opts.file = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.file) throw new Error("usage: node watch-case.cjs OUT.mp4|OUT.progress.log [--stall 180] [--since 120]");
  if (opts.file.toLowerCase().endsWith(".mp4")) opts.file = opts.file.slice(0, -4) + ".progress.log";
  return opts;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

// The lines of the newest run in the log, or null when that run is too old to be ours.
function currentRun(text, notBefore) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/ RUN pid=\d+ at=\d+/.test(lines[i])) { start = i; break; }
  if (start < 0) return null;
  const [, pid, at] = lines[start].match(/ RUN pid=(\d+) at=(\d+)/);
  if (Number(at) < notBefore) return null;
  return { pid: Number(pid), lines: lines.slice(start + 1) };
}

async function watch(opts, out = line => console.log(line)) {
  const started = Date.now();
  const notBefore = started - opts.since * 1000;
  let shown = 0, pid = null, lastChange = Date.now(), stallWarned = 0;
  for (;;) {
    let text = "";
    try { text = fs.readFileSync(opts.file, "utf8"); } catch {}
    const run = currentRun(text, notBefore);
    if (run) {
      if (run.pid !== pid) { pid = run.pid; shown = 0; out(`RUN pid=${pid}`); }
      for (const line of run.lines.slice(shown)) {
        out(line);
        lastChange = Date.now();
        stallWarned = 0;
        if (/^\S+ \+\d+s DONE\b/.test(line)) return 0;
        if (/^\S+ \+\d+s FAIL\b/.test(line)) return 1;
      }
      shown = run.lines.length;
      if (!alive(pid)) {
        // Re-read once: the last line may have landed between the read and the check.
        const again = currentRun(fs.existsSync(opts.file) ? fs.readFileSync(opts.file, "utf8") : "", notBefore);
        const late = again && again.pid === pid ? again.lines.slice(shown) : [];
        for (const line of late) {
          out(line);
          if (/ DONE\b/.test(line)) return 0;
          if (/ FAIL\b/.test(line)) return 1;
        }
        out(`DEAD runner pid ${pid} exited without DONE/FAIL; last: ${run.lines.at(-1) || "(nothing)"}`);
        return 2;
      }
    }
    const quiet = (Date.now() - lastChange) / 1000;
    if (quiet >= opts.stall * (stallWarned + 1)) {
      stallWarned++;
      out(run ? `STALL no progress for ${Math.round(quiet)}s; last: ${run.lines.at(-1) || "RUN"} (pid ${pid} still alive)`
              : `STALL no run started in ${opts.file} for ${Math.round(quiet)}s`);
    }
    await new Promise(resolve => setTimeout(resolve, opts.poll));
  }
}

module.exports = { watch, currentRun, parseArgs };
if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exit(64); }
  watch(opts).then(code => process.exit(code));
}
