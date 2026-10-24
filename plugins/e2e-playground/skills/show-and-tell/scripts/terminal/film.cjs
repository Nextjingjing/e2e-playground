// paintext film — record the replay of a capture (capture.cjs) as a demo-kit session, so captions,
// highlightText, cards, shots, redaction, idle marks and post.py all work as on a web case.
//
//   const { film } = require("<skill>/scripts/terminal/film.cjs");
//   const s = await film({ cast: "<work>/cases/01/01.cast", outDir, name: "01-case" });
//   await s.demo.caption("Send the order to Sorting");
//   await s.play("proof");                                  // until the step marked "proof" is done
//   await s.demo.highlightText("A-042", "The new row");
//   await s.play();                                         // to the end
//   await s.finish();                                       // <outDir>/01-case.webm + .marks.json
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const kit = require("../demo-kit.cjs");
const themes = require("./themes.cjs");
const { thaiCells } = require("./thai.cjs");
const { redactConfig } = require("../redact.cjs");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_IDLE_MS = 2000;  // nothing moves on screen during a gap, and post.py squeezes idle spans anyway
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// redact.text matches exact strings, but the replay draws spaces as U+00A0 and Thai ำ as ํ + า:
// turn each name into patterns that match what is really on screen.
function terminalRedact(redact) {
  if (!redact || redact === true || !redact.text) return redact;
  const patterns = [...new Set(redact.text.filter(Boolean).flatMap(t => [String(t), thaiCells(t)]))]
    .map(t => ({ src: t.trim().split(/\s+/).map(esc).join("[\\s\\u00A0]+"), flags: "gi" }));
  return { ...redact, text: [], patterns: [...(redact.patterns || []), ...patterns] };
}

async function film({ cast, outDir, name, view, redact, font, theme, projectDir = __dirname }) {
  const text = fs.readFileSync(cast, "utf8");
  const header = JSON.parse(text.slice(0, text.indexOf("\n")));
  const th = themes[(header.paintext && header.paintext.shell) || "powershell"];
  const red = terminalRedact(redact ?? {});
  const rows = redactConfig(red);  // the same patterns, matched over whole terminal rows (term.html)
  const cfg = { cast: text, theme: { ...th.theme, ...theme }, title: th.title, icon: th.icon, font, redact: rows && rows.patterns };
  const s = await kit.startSession({
    outDir, name, view, redact: red, projectDir,
    startUrl: pathToFileURL(path.join(__dirname, "term.html")).href,
    beforeStart: page => page.evaluate(c => window.paintext.load(c), cfg),
  });
  async function play(label) {
    for (;;) {
      const r = await s.page.evaluate(l => window.paintext.next(l), label);
      if (r.gap) await s.demo.waitApp(() => sleep(Math.min(r.gap * 1000, MAX_IDLE_MS)), "waiting for output");
      else return r;
    }
  }
  return { page: s.page, demo: s.demo, play, finish: s.finish };
}

module.exports = { film };
