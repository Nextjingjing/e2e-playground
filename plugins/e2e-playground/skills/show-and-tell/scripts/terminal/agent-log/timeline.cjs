// Real agent run log -> timeline of what happened (seconds from the first event).
// Honesty contract: text, tool calls, tool results, errors and token usage are COPIED from the log.
// The only change allowed is shortening long output, and every cut says how much was cut.
// Formats: Claude Code `claude -p --output-format stream-json --verbose`, each line wrapped as
// {"ts": epoch_ms, "ev": <event>} by the runner (log-run.py); opencode `run --format json`.
const fs = require("fs");

function cut(text, maxLines = 24) {
  let s = String(text).replace(/\x1b\[[0-9;]*m|\[\d+m/g, "").replace(/\s+$/, "");
  const limit = maxLines * 90;  // one long wrapped line can fill the pane too
  if (s.length > limit) s = s.slice(0, limit) + `… (+${s.length - limit} chars cut for the video)`;
  const lines = s.split(/\r?\n/);
  if (lines.length <= maxLines) return lines.join("\n");
  const h = Math.floor(maxLines / 2);
  return [...lines.slice(0, h), `… +${lines.length - 2 * h} lines cut for the video`, ...lines.slice(-h)].join("\n");
}

function toolArg(name, input) {
  if (input.command) return input.command;
  if (input.code) {  // browser code: show the text it really types
    const typed = [...input.code.matchAll(/keyboard\.type\((['"`])([\s\S]*?)\1\)/g)].map(m => m[2]);
    if (typed.length) return `type "${typed.join(" ")}"`;
  }
  return Object.entries(input).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ").slice(0, 160);
}

const shortName = n => n.replace(/^mcp__playwright__browser_/, "playwright:").replace(/^mcp__/, "");
const quiet = n => /^mcp__|^ToolSearch$|^Read$|^playwright/.test(n || "");  // echo code/snapshots: keep few lines

function claudeCode(rows) {
  const t0 = rows[0].ts, items = [], usage = new Map(), names = {};
  let model = "", result = null;
  const sum = f => [...usage.values()].reduce((a, u) => a + f(u), 0);
  for (const { ts, ev } of rows) {
    const t = (ts - t0) / 1000;
    if (ev.type === "system" && ev.model) model = ev.model;
    if (ev.type === "assistant") {
      const m = ev.message;
      if (m.usage) {
        usage.set(m.id, m.usage);
        items.push({ t, kind: "tokens", output: sum(u => u.output_tokens || 0),
          total: sum(u => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)) });
      }
      for (const c of m.content || []) {
        if (c.type === "text" && c.text.trim()) items.push({ t, kind: "text", text: c.text.replace(/\*\*/g, "").trim() });
        if (c.type === "tool_use") { names[c.id] = c.name; items.push({ t, kind: "tool", name: shortName(c.name), arg: toolArg(c.name, c.input || {}) }); }
      }
    }
    if (ev.type === "user") for (const c of (ev.message && ev.message.content) || []) {
      if (c.type !== "tool_result") continue;
      const body = typeof c.content === "string" ? c.content
        : (c.content || []).map(x => (x.type === "text" ? x.text : x.type === "image" ? "[image]" : "")).join("\n");
      items.push({ t, kind: "result", out: cut(body, quiet(names[c.tool_use_id]) ? 6 : 24), err: !!c.is_error });
    }
    if (ev.type === "result") result = ev;
  }
  return { model, items, result, t0 };
}

function opencode(events) {
  const t0 = events[0].timestamp, items = [];
  let model = "", tokens = 0, output = 0;
  for (const e of events) {
    const p = e.part || {}, st = p.state || {};
    const at = ms => ((ms || e.timestamp) - t0) / 1000;
    if (e.type === "text") items.push({ t: at(p.time && p.time.start), kind: "text", text: p.text.replace(/\*\*/g, "").trim() });
    if (e.type === "tool_use") {
      const t = at(st.time && st.time.start);
      items.push({ t, kind: "tool", name: p.tool, arg: toolArg(p.tool, st.input || {}) });
      const err = st.status === "error" ? String(st.error || "error").split(/\r?\n/)[0] : "";
      items.push({ t: at(st.time && st.time.end), kind: "result", out: cut(err || st.output || "", quiet(p.tool) ? 6 : 24), err: !!err });
    }
    if (e.type === "step_finish" && p.tokens) {
      const k = p.tokens;
      tokens += (k.input || 0) + (k.output || 0) + (k.reasoning || 0) + ((k.cache || {}).read || 0) + ((k.cache || {}).write || 0);
      output += (k.output || 0);
      items.push({ t: at(), kind: "tokens", total: tokens, output });
    }
    if (p.model && !model) model = p.model;
  }
  items.sort((a, b) => a.t - b.t);
  return { model, items, result: null, t0 };
}

module.exports = function timeline(file) {
  const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(l => l.startsWith("{")).map(l => JSON.parse(l));
  return rows[0].ev ? claudeCode(rows) : opencode(rows);
};
module.exports.cut = cut;
