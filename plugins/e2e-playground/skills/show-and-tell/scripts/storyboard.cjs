#!/usr/bin/env node
// Preview what a case will film BEFORE recording: run the case's own run() against a fake
// page and a fake demo kit (no browser, no app, no setup/login/verify, no data used), and
// list every scene (caption), click, highlight, card and wait with an estimated length.
// Usage: node storyboard.cjs CASE.cjs   (or: node run-case.cjs CASE.cjs --storyboard)
// Writes <output stem>.storyboard.md (show it to the user) and .storyboard.json (the runner
// uses its step count to print "STEP 4/9" while recording).
// Limits: values read from the live page show as ‹live: …›; code in run() that is not page
// or demo calls (DB queries, files) still runs, so keep side effects out of run().
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readMs } = require("./demo-kit.cjs");

const CALL_BUDGET = 5000;
class StoryboardStop extends Error {}

const short = value => {
  if (value instanceof RegExp) return String(value);
  if (typeof value === "string") return `"${value.length > 40 ? value.slice(0, 39) + "…" : value}"`;
  if (value && value.__desc) return value.__desc;
  if (typeof value === "function") return "fn";
  if (value && typeof value === "object") {
    const name = value.name ?? value.hasText ?? value.has;
    return name !== undefined ? short(name) : "{…}";
  }
  return String(value);
};

// How a locator chain reads to a person: button "Max" › with "PM4" › #2
function describe(parent, method, args) {
  const [a, b] = args;
  const join = text => (parent ? `${parent} › ${text}` : text);
  switch (method) {
    case "getByRole": return join(`${a}${b && b.name !== undefined ? " " + short(b.name) : ""}`);
    case "getByText": return join(`text ${short(a)}`);
    case "getByLabel": case "getByPlaceholder": return join(`field ${short(a)}`);
    case "getByTestId": return join(`[data-testid=${a}]`);
    case "getByAltText": case "getByTitle": return join(`${method.slice(5).toLowerCase()} ${short(a)}`);
    case "locator": return join(`${typeof a === "string" ? a : short(a)}${b && b.hasText !== undefined ? ` with ${short(b.hasText)}` : ""}`);
    case "filter": return join(a && a.hasText !== undefined ? `with ${short(a.hasText)}` : "filtered");
    case "first": case "last": return parent || method;
    case "nth": return join(`#${a}`);
    default: return join(`${method}(${args.map(short).join(", ")})`);
  }
}

function makeFakes(events) {
  let calls = 0, live = 0;
  const tick = () => { if (++calls > CALL_BUDGET) throw new StoryboardStop(`stopped after ${CALL_BUDGET} page calls (run() probably loops on live page state)`); };
  const pageEvent = { goto: url => `open ${url}`, reload: () => "reload page", goBack: () => "go back" };

  // Shared traps: awaiting a fake gives the fake back; using it as a value counts as "live".
  function special(desc, prop) {
    if (prop === "then") return { value: undefined };
    if (prop === "__desc") return { value: desc };
    if (prop === Symbol.toPrimitive) return { value: hint => { live++; return hint === "number" ? 0 : `‹live: ${desc || "page"}›`; } };
    if (prop === Symbol.iterator) return { value: function* () {} };
    if (typeof prop === "symbol") return { value: undefined };
    return null;
  }

  // A page, locator or other object: every property is a member that may be called or read.
  function chain(desc, isPage = false) {
    return new Proxy(function () {}, {
      get(_, prop) {
        const s = special(desc, prop);
        if (s) return s.value;
        if (isPage && (prop === "keyboard" || prop === "mouse")) return chain(prop);
        return member(desc, prop, isPage);
      },
      apply() { tick(); return chain(desc); },
    });
  }

  // locator.click(...) when called; locator.someProperty.x when read further.
  function member(owner, prop, isPage) {
    const base = isPage ? "" : owner;
    return new Proxy(function () {}, {
      apply(_, __, args) {
        tick();
        if (isPage && pageEvent[prop]) events.push({ kind: "nav", text: pageEvent[prop](...args), secs: 0.6 });
        if (isPage && prop === "waitForTimeout") events.push({ kind: "pause", secs: Math.min(Number(args[0]) || 0, 2500) / 1000 });
        if (owner === "keyboard" && prop === "press") events.push({ kind: "key", text: `press ${args[0]}`, secs: 0.3 });
        if (owner === "keyboard" && (prop === "type" || prop === "insertText")) events.push({ kind: "key", text: `type ${short(args[0])}`, secs: String(args[0] || "").length * 0.05 });
        return chain(describe(base, prop, args));
      },
      get(_, inner) {
        const desc = describe(base, prop, []);
        const s = special(desc, inner);
        return s ? s.value : member(desc, inner, false);
      },
    });
  }

  const target = loc => (loc && loc.__desc) || (typeof loc === "string" ? short(loc) : "element");
  const clickSecs = (slow, pauseBefore, pauseAfter) => 0.75 + (pauseBefore ?? (slow ? 1200 : 400)) / 1000 + (pauseAfter ?? (slow ? 1300 : 500)) / 1000;
  const known = {
    async caption(text) { if (text) events.push({ kind: "caption", text: String(text), secs: 0.3 }); },
    async click(loc, { slow = false, pauseBefore, pauseAfter, highlight } = {}) {
      if (highlight) events.push({ kind: "highlight", text: `${target(loc)} — "${highlight}"`, secs: (slow ? 2200 : 1400) / 1000 });
      events.push({ kind: "click", text: `click ${target(loc)}${slow ? " (slow)" : ""}`, secs: clickSecs(slow, pauseBefore, pauseAfter) });
    },
    async hover(loc, ms = 800) { events.push({ kind: "hover", text: `hover ${target(loc)}`, secs: 0.65 + ms / 1000 }); },
    async type(loc, text, { delay = 85 } = {}) { events.push({ kind: "type", text: `type ${short(String(text))} into ${target(loc)}`, secs: clickSecs(false, undefined, 250) + String(text).length * delay / 1000 + 0.4 }); },
    async scanText(text) { events.push({ kind: "scan", text: `scan ${short(String(text))} (keyboard scanner)`, secs: String(text).length * 0.018 + 0.25 }); },
    async pasteAndEnter() { events.push({ kind: "scan", text: "paste + Enter", secs: 0.6 }); },
    async highlight(loc, label, ms = 2200) { events.push({ kind: "highlight", text: `${target(loc)}${label ? ` — "${label}"` : ""}`, secs: 0.25 + ms / 1000 }); },
    async highlightText(what, label, ms = 2200) { events.push({ kind: "highlight", text: `text ${short(what)}${label ? ` — "${label}"` : ""}`, secs: ms / 1000 }); },
    async highlightBox(_, label, ms = 2200) { events.push({ kind: "highlight", text: `box${label ? ` — "${label}"` : ""}`, secs: ms / 1000 }); },
    async card(card = {}, ms) {
      const t = [card.tag, card.title, ...(card.lines || [])].filter(Boolean);
      events.push({ kind: "card", text: `card: ${t.join(" · ")}`, secs: ((ms ?? readMs(t)) + 1400) / 1000 });
    },
    async waitApp(what, label = "wait") {
      if (typeof what === "function") await what();
      events.push({ kind: "wait", text: `wait: ${label} (fast-forwarded)`, secs: 0.6 });
    },
    async sleep(ms) { events.push({ kind: "pause", secs: Math.min(Number(ms) || 0, 2500) / 1000 }); },
    async shot(title) { events.push({ kind: "shot", text: `still: ${title}`, secs: 0 }); },
    mark() {},
  };
  const demo = new Proxy(known, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return async () => { events.push({ kind: "other", text: `demo.${prop}()`, secs: 1 }); };
    },
  });
  return { page: chain("", true), demo, liveCount: () => live };
}

function scenes(events) {
  const list = [{ caption: null, actions: [], secs: 0 }];
  for (const e of events) {
    if (e.kind === "caption") list.push({ caption: e.text, actions: [], secs: e.secs });
    else {
      const s = list.at(-1);
      s.secs += e.secs;
      if (e.text) s.actions.push(e.text);
    }
  }
  if (!list[0].actions.length && !list[0].secs) list.shift();
  return list;
}

const clock = secs => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;
const cell = text => String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");

async function storyboard(config, { caseFile = "case.cjs", caseKey = null, baseDir = process.cwd(), write = true } = {}) {
  if (typeof config.run !== "function" || !config.output || !config.title?.title)
    throw new Error("case needs output, title.title and an async run({page, demo}) function");
  const events = [];
  const fakes = makeFakes(events);
  let stopped = null;
  try { await config.run({ page: fakes.page, demo: fakes.demo }); }
  catch (error) { stopped = error instanceof StoryboardStop ? error.message : `run() threw on the fake page: ${String(error?.message || error).split("\n")[0]}`; }
  const title = config.title;
  const titleSecs = (readMs([title.tag, title.title, ...(title.lines || [])].filter(Boolean)) + 1400) / 1000;
  const list = scenes(events);
  const steps = list.filter(s => s.caption).length;
  const total = titleSecs + list.reduce((sum, s) => sum + s.secs, 0);
  const md = [
    `# Storyboard: ${title.title}`,
    "",
    `From \`${path.basename(caseFile)}\` without a browser: nothing was recorded and no data was used.`,
    "",
    `**Title card** (≈${titleSecs.toFixed(1)} s): ${[title.tag, title.title].filter(Boolean).join(" · ")}${(title.lines || []).length ? " — " + title.lines.join(" / ") : ""}`,
    "",
    "| # | caption on screen | what happens | ≈ s |",
    "|---|---|---|---|",
    ...list.map((s, i) => `| ${s.caption ? list.slice(0, i + 1).filter(x => x.caption).length : "–"} | ${cell(s.caption || "(before the first caption)")} | ${cell(s.actions.join("; ") || "—")} | ${s.secs.toFixed(1)} |`),
    "",
    `**≈ ${clock(total)} after editing** (${steps} captioned steps; app waits counted as 0.6 s, long pauses as ≤ 2.5 s).`,
  ];
  if (fakes.liveCount()) md.push("", `${fakes.liveCount()} value(s) come from the live page and show as ‹live: …›; the real video shows the actual value.`);
  if (stopped) md.push("", `**Storyboard incomplete:** ${stopped}. Scenes after this point depend on the real page.`);
  const summary = { caseKey, steps, seconds: Math.round(total), stopped };
  if (write) {
    const stem = path.resolve(baseDir, config.output).slice(0, -4);
    fs.mkdirSync(path.dirname(stem), { recursive: true });
    fs.writeFileSync(`${stem}.storyboard.md`, md.join("\n") + "\n");
    fs.writeFileSync(`${stem}.storyboard.json`, JSON.stringify(summary, null, 2));
    summary.file = `${stem}.storyboard.md`;
  }
  return { ...summary, markdown: md.join("\n") };
}

async function main(args) {
  if (args.length !== 1 || args[0] === "--help") {
    console.log("Usage: node storyboard.cjs CASE.cjs  — preview scenes and length without recording");
    return 0;
  }
  const file = path.resolve(args[0]);
  const config = require(file);
  const caseKey = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const result = await storyboard(config, { caseFile: file, caseKey, baseDir: path.dirname(file) });
  console.log(result.markdown);
  console.log(`\n(saved ${result.file})`);
  return result.stopped ? 3 : 0;
}

module.exports = { storyboard };
if (require.main === module) main(process.argv.slice(2)).then(
  code => process.exit(code),
  error => { console.error(String(error?.message || error).split("\n")[0]); process.exit(1); });
