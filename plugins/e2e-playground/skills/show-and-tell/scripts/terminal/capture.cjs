// paintext capture — run a REAL shell in a pseudo-terminal and save what it printed (asciicast v2).
//
// Each step is typed at human speed, so the shell's own echo (PSReadLine colours, redraws) is
// recorded for real; the replay never draws input itself. A step waits for its `expect` text
// (default: the shell prompt); text that never appears fails the capture instead of producing
// a misleading video.
//
//   const { capture } = require("<skill>/scripts/terminal/capture.cjs");
//   await capture({ shell: "powershell", cwd, out: "<work>/cases/01/01.cast" }, [
//     { type: "cd C:\\demo", hidden: true },                       // setup, not shown
//     { type: "mytool orders send A-042", expect: /Continue\? \[y\/N\]/ },
//     { type: "y", expect: /done/ },
//     { secret: "DB_PASSWORD" },                                    // types $env value, saves ‹env:DB_PASSWORD›
//     { type: "mytool orders list", mark: "proof" },
//   ]);
//   node capture.cjs <steps.cjs>        (the file exports { opts, steps })
//
// Cast events: [t,"o",data] output · [t,"i",data] input · [t,"m",label] markers. "start" sits after
// the hidden setup and a screen clear; "step:<n>" and the step's `mark` when step n is done.
// No secret reaches the file: secret inputs are placeholders, and a cast whose output holds an
// env value used here or a credential pattern is refused.
const fs = require("fs");
const path = require("path");
const pty = require("@lydell/node-pty");
const { Terminal } = require("@xterm/headless");
const themes = require("./themes.cjs");
const { DEFAULT_PATTERNS } = require("../redact.cjs");

const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[=>()][0-9A-Za-z]?/g;
const strip = s => s.replace(ANSI, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Credentials only: personal data (emails, phone numbers, ids) is covered on screen by redact.cjs when filming.
const CREDENTIALS = DEFAULT_PATTERNS.filter(p => !["email", "thai national id", "phone", "card number", "long id"].includes(p.name));
// Hidden commands are not shown, so they may be wrapped: a failing one ends the shell and so the capture.
const GUARD = {
  powershell: c => `${c}; if (-not $?) { exit 97 }`,
  cmd: c => `${c} || exit 97`,
  bash: c => `${c} || exit 97`,
};

async function capture(opts, steps) {
  const shell = opts.shell || "powershell";
  const th = themes[shell];
  if (!th) throw new Error(`capture: unknown shell "${shell}" (powershell, cmd, bash)`);
  const { cwd = process.cwd(), out, cols = 110, rows = 30, env = {}, typeMs = 60, timeoutMs = 20000, settleMs = 300 } = opts;
  if (!out) throw new Error("capture: opts.out (.cast path) is required");

  const p = pty.spawn(th.file, th.args, { name: "xterm-256color", cols, rows, cwd, env: { ...process.env, ...env }, useConpty: true });
  const kill = () => { try { p.kill(); } catch {} };
  process.once("exit", kill);
  const t0 = Date.now(), events = [];
  const now = () => Math.round(Date.now() - t0) / 1000;
  let recording = true, since = "", lastOut = Date.now(), exited = null;
  const screen = new Terminal({ cols, rows, allowProposedApi: true });  // for error messages only
  p.onData(d => {
    if (recording) events.push([now(), "o", d]);
    screen.write(d);
    since += strip(d); lastOut = Date.now();
  });
  p.onExit(e => { exited = e; });

  const screenTail = () => {
    const b = screen.buffer.active, lines = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i).translateToString(true));
    return lines.filter(l => l.trim()).slice(-10).join("\n");
  };
  const atPrompt = () => th.prompt.test(since) || th.prompt.test(since.slice(-400).replace(/\r?\n/g, ""));
  async function wait(what, re) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (exited) throw new Error(`${what}: the shell exited (code ${exited.exitCode}).\nLast screen lines:\n${screenTail()}`);
      const seen = re ? re.test(since) : atPrompt();
      if (seen && Date.now() - lastOut >= settleMs) return;
      if (Date.now() > end) {
        const why = seen ? `output kept coming after ${re || "the prompt"} appeared (no ${settleMs} ms pause)` : `${re || "the prompt"} did not appear`;
        throw new Error(`${what}: ${why} within ${timeoutMs} ms.\nLast screen lines:\n${screenTail()}`);
      }
      await sleep(50);
    }
  }
  // fast: hidden setup nobody watches, sent in one go
  async function typeLine(text, { enter = true, shown = text, fast = false } = {}) {
    if (process.env.PT_DEBUG) console.error(`[capture ${now()}s] type ${JSON.stringify(shown)}`);
    events.push([now(), "i", shown + (enter ? "\r" : "")]);
    if (!enter) since = "";
    if (fast) p.write(text);
    else for (const ch of text) { p.write(ch); await sleep(typeMs + Math.random() * 40); }
    if (enter) { await sleep(typeMs * 3); since = ""; p.write("\r"); }  // expect sees only what came after Enter
  }

  try {
    await wait("shell start");
    const hidden = steps.filter(s => s.hidden), shown = steps.filter(s => !s.hidden);
    for (const c of th.prelude) { await typeLine(c, { fast: true }); await wait("UTF-8 prelude"); }
    for (const [i, s] of hidden.entries()) {
      const what = `hidden step ${i + 1} (${s.type ?? "‹env:" + s.secret + "›"})`;
      if (s.secret) await typeLine(process.env[s.secret] || "", { enter: s.enter ?? true, shown: `‹env:${s.secret}›`, fast: true });
      else await typeLine(GUARD[shell](s.type), { enter: s.enter ?? true, shown: s.type, fast: true });
      await wait(what, s.expect);
    }
    await typeLine(th.clear, { fast: true }); await wait("clear screen");
    events.push([now(), "m", "start"]);
    for (const [i, s] of shown.entries()) {
      const n = i + 1;
      if (s.secret) {
        if (!(s.secret in process.env)) throw new Error(`step ${n}: env var ${s.secret} is not set`);
        await typeLine(process.env[s.secret], { enter: s.enter ?? true, shown: `‹env:${s.secret}›` });
      } else await typeLine(s.type, { enter: s.enter ?? true });
      await wait(`step ${n} (${s.type ?? "‹env:" + s.secret + "›"})`, s.expect);
      events.push([now(), "m", `step:${n}`]);
      if (s.mark) events.push([now(), "m", s.mark]);
    }
    recording = false;

    const header = { version: 2, width: cols, height: rows, timestamp: Math.floor(t0 / 1000),
      env: { SHELL: shell, TERM: "xterm-256color" }, paintext: { shell, title: th.title } };
    const text = events.map(e => JSON.stringify(e)).join("\n");
    checkSecrets(events, [...Object.values(env), ...steps.filter(s => s.secret).map(s => process.env[s.secret])]);
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(header) + "\n" + text + "\n");
    p.write("exit\r");
    for (let i = 0; i < 40 && !exited; i++) await sleep(50);
    return { cast: out, events };
  } finally {
    kill();
    process.removeListener("exit", kill);
  }
}

function checkSecrets(events, values) {
  const output = strip(events.filter(e => e[1] === "o").map(e => e[2]).join(""));  // the stream as the terminal got it
  const inputs = events.filter(e => e[1] === "i").map(e => e[2]).join("\n");
  for (const v of values) {
    if (v && String(v).length >= 4 && (output.includes(String(v)) || inputs.includes(String(v))))
      throw new Error("capture refused: the terminal showed a secret value (an env var used in this capture). Don't print it on screen.");
  }
  const masked = m => /^[*•●]+$/.test(m.split(/[:=\s]+/).pop());  // "Password: ****" is the shell hiding it
  for (const p of CREDENTIALS) {
    const re = new RegExp(p.src, p.flags.includes("g") ? p.flags : p.flags + "g");
    if ([...output.matchAll(re)].some(m => !masked(m[0])))
      throw new Error(`capture refused: the output looks like it holds a secret (${p.name}). Keep it off screen.`);
  }
}

module.exports = { capture, strip };

if (require.main === module) {
  const file = path.resolve(process.argv[2] || "");
  const { opts, steps } = require(file);
  capture(opts, steps).then(r => console.log(`capture: ${r.events.length} events -> ${r.cast}`))
    .catch(e => { console.error(e.message); process.exit(1); });
}
