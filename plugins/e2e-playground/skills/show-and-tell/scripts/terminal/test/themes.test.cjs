const test = require("node:test");
const assert = require("node:assert/strict");
const themes = require("../themes.cjs");

test("prompt regexes match each shell's prompt", () => {
  assert.ok(themes.powershell.prompt.test("PS C:\\work> "));
  assert.ok(themes.cmd.prompt.test("C:\\work>"));
  assert.ok(themes.bash.prompt.test("user@host:~/w$ "));
});

test("Windows Terminal backgrounds", () => {
  assert.equal(themes.powershell.theme.background, "#012456");
  assert.equal(themes.cmd.theme.background, "#0C0C0C");
});
