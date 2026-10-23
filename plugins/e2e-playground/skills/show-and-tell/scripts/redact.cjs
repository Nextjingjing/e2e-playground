// redact — cover credentials and personal data with solid bars BEFORE anything is recorded or captured.
//
// Draws opaque bars over matching text and fields in a pointer-events:none overlay; the app's
// DOM is never touched (rewriting text nodes breaks React and friends). A MutationObserver
// rescans on every DOM change (it runs before the browser paints, so new text never reaches a
// frame unblurred) and requestAnimationFrame moves the boxes with scrolling and animation.
//
//   const { redactInit, redactConfig } = require("./redact.cjs");
//   await context.addInitScript(redactInit, redactConfig({ text: ["Jane Doe"], selectors: [".user-badge"] }));
//
// Same copy in show-and-tell, paparazzi and hold-my-hand (each skill ships standalone) — keep in sync.

// Built-in patterns: on by default. Each is { name, src, flags }.
const DEFAULT_PATTERNS = [
  { name: "email", src: String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`, flags: "g" },
  { name: "jwt", src: String.raw`eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}`, flags: "g" },
  { name: "bearer", src: String.raw`\bBearer\s+[\w.~+/=-]{12,}`, flags: "gi" },
  { name: "api key", src: String.raw`\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}`, flags: "g" },
  { name: "github token", src: String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})`, flags: "g" },
  { name: "aws key", src: String.raw`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`, flags: "g" },
  { name: "google key", src: String.raw`\bAIza[\w-]{30,}`, flags: "g" },
  { name: "slack token", src: String.raw`\bxox[abprs]-[\w-]{10,}`, flags: "g" },
  { name: "key=value secret", src: String.raw`\b(?:pass(?:word)?|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S{4,}`, flags: "gi" },
  { name: "url credentials", src: String.raw`\b[a-z][\w+.-]*://[^\s/:@]+:[^\s/@]+@`, flags: "gi" },
  { name: "thai national id", src: String.raw`\b\d[- ]?\d{4}[- ]?\d{5}[- ]?\d{2}[- ]?\d\b`, flags: "g" },
  { name: "phone", src: String.raw`(?<![\w-])(?:\+66[- ]?|0)\d{1,2}[- ]?\d{3}[- ]?\d{4}(?![\w-])`, flags: "g" },
  { name: "card number", src: String.raw`\b(?:\d[ -]?){13,19}\b`, flags: "g" },
  { name: "long id", src: String.raw`\b\d{9,}\b`, flags: "g" }, // employee / account numbers
];

// Fields that hold secrets even when their value looks harmless.
const DEFAULT_SELECTORS = [
  'input[type="password"]',
  'input[name*="pass" i]', 'input[name*="token" i]', 'input[name*="secret" i]',
  'input[autocomplete="current-password"]', 'input[autocomplete="new-password"]',
  'input[autocomplete="one-time-code"]',
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// opts.text: exact strings to hide (real names, usernames, ids you know will appear)
// opts.patterns: extra { src, flags } regexes · opts.selectors: extra CSS selectors (whole element)
// opts.defaults: false to drop the built-ins (not recommended) · opts.skip: built-in names to drop
function redactConfig(opts = {}) {
  if (opts === false) return null;
  const o = opts === true ? {} : opts;
  const skip = new Set(o.skip || []);
  const base = o.defaults === false ? [] : DEFAULT_PATTERNS.filter(p => !skip.has(p.name));
  const text = (o.text || []).filter(Boolean).map(t => ({ name: "text", src: escapeRegex(String(t)), flags: "gi" }));
  return {
    patterns: [...base, ...(o.patterns || []), ...text].map(p => ({ src: p.src, flags: p.flags || "g" })),
    selectors: [...(o.defaults === false ? [] : DEFAULT_SELECTORS), ...(o.selectors || [])],
    pad: o.pad ?? 3,
  };
}

// Runs inside the page (addInitScript / evaluate). Must stay self-contained.
function redactInit(cfg) {
  if (!cfg || window.__demoRedact) return;
  window.__demoRedact = true;
  const pats = cfg.patterns.map(p => new RegExp(p.src, p.flags.includes("g") ? p.flags : p.flags + "g"));
  let targets = [];
  let layer = null;
  const pool = [];

  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement("div");
    layer.id = "__demo_redact";
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    (document.body || document.documentElement).appendChild(layer);
    return layer;
  }

  function matches(s) {
    if (!s || s.length < 4) return false;
    return pats.some(re => { re.lastIndex = 0; return re.test(s); });
  }

  function scan() {
    if (!document.body) return;
    const found = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest("#__demo_root,#__demo_redact,script,style,noscript")) return NodeFilter.FILTER_REJECT;
        return n.nodeValue && n.nodeValue.trim().length >= 4 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue;
      for (const re of pats) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(t))) {
          if (!m[0]) { re.lastIndex++; continue; }
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          found.push({ range: r });
        }
      }
    }
    for (const sel of cfg.selectors) {
      try { document.querySelectorAll(sel).forEach(el => found.push({ el })); } catch {}
    }
    document.querySelectorAll("input,textarea,select").forEach(el => {
      if (matches(el.value)) found.push({ el });
    });
    // text drawn by the app in attributes users can see (title tooltips are not painted; skip)
    targets = found;
    draw();
  }

  function draw() {
    const l = ensureLayer();
    const rects = [];
    for (const t of targets) {
      if (t.el) { if (t.el.isConnected) rects.push(t.el.getBoundingClientRect()); }
      else if (t.range.startContainer.isConnected) for (const r of t.range.getClientRects()) rects.push(r);
    }
    while (pool.length < rects.length) {
      const d = document.createElement("div");
      // opaque, not a blur: backdrop-filter is dropped from Playwright's video frames, and blur
      // can sometimes be undone; a solid bar is what the recording really keeps
      d.style.cssText = "position:fixed;border-radius:4px;background:repeating-linear-gradient(135deg,#6b7280 0 6px,#4b5563 6px 12px);box-shadow:0 0 0 1px rgba(0,0,0,.15);";
      l.appendChild(d);
      pool.push(d);
    }
    const p = cfg.pad;
    pool.forEach((d, i) => {
      const r = rects[i];
      if (!r || (r.width === 0 && r.height === 0)) { d.style.display = "none"; return; }
      Object.assign(d.style, { display: "block", left: r.left - p + "px", top: r.top - p + "px", width: r.width + 2 * p + "px", height: r.height + 2 * p + "px" });
    });
  }

  const start = () => {
    scan();
    // runs as a microtask after each DOM change, before the next paint
    // ignore our own overlays (blur boxes, cursor, captions) or every redraw would trigger a rescan
    const ours = node => {
      const el = node.nodeType === 1 ? node : node.parentElement;
      return !!(el && el.closest && el.closest("#__demo_root,#__demo_redact"));
    };
    new MutationObserver(muts => { if (muts.some(m => !ours(m.target))) scan(); }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["value", "class", "style", "hidden"] });
    document.addEventListener("input", scan, true);
    document.addEventListener("change", scan, true);
    const loop = () => { draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  };
  // observe from the very first byte: browsers paint partial pages before DOMContentLoaded
  start();
}

module.exports = { redactInit, redactConfig, DEFAULT_PATTERNS, DEFAULT_SELECTORS };
