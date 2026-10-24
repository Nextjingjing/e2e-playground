// Thai sara am (ำ) after a tone mark loses its nikhahit circle in xterm.js cells
// ("น้ำ" is drawn as "น้า"). Drawing nikhahit, tone, aa instead renders right.
// Display only: the text means the same, the capture file keeps the original bytes.
// Works as require() and as a <script> (sets window.thai).
(function (root) {
  const AM = /([่-๋]?)ำ/g;
  const TONE_AT_END = /[่-๋]$/;

  function thaiCells(s) { return String(s).replace(AM, "ํ$1า"); }

  // Output arrives in chunks; a tone mark at the end of one chunk may belong to a sara am
  // at the start of the next, so hold it back until we know.
  class ThaiStream {
    constructor() { this.held = ""; }
    push(chunk) {
      let s = this.held + chunk;
      this.held = "";
      if (TONE_AT_END.test(s)) { this.held = s.slice(-1); s = s.slice(0, -1); }
      return thaiCells(s);
    }
    flush() { const s = this.held; this.held = ""; return s; }
  }

  const api = { thaiCells, ThaiStream };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.thai = api;
})(typeof window !== "undefined" ? window : globalThis);
