// Per shell: how to start it, how to know it is waiting for input, and how it looks
// (Windows Terminal default schemes, so the replay looks like the terminal people use).
const campbell = {
  black: "#0C0C0C", red: "#C50F1F", green: "#13A10E", yellow: "#C19C00",
  blue: "#0037DA", magenta: "#881798", cyan: "#3A96DD", white: "#CCCCCC",
  brightBlack: "#767676", brightRed: "#E74856", brightGreen: "#16C60C", brightYellow: "#F9F1A5",
  brightBlue: "#3B78FF", brightMagenta: "#B4009E", brightCyan: "#61D6D6", brightWhite: "#F2F2F2",
};

module.exports = {
  powershell: {
    file: "powershell.exe",
    args: ["-NoLogo"],
    prompt: /PS [^\r\n]*> ?$/,
    clear: "Clear-Host",
    prelude: ["[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8"],
    title: "Windows PowerShell",
    icon: { text: "❯_", color: "#3B78FF" },
    theme: { ...campbell, background: "#012456", foreground: "#CCCCCC", cursor: "#FFFFFF" },
  },
  cmd: {
    file: "cmd.exe",
    args: [],
    prompt: /[A-Za-z]:\\[^\r\n>]*>$/,
    clear: "cls",
    prelude: ["chcp 65001 >nul"],
    title: "Command Prompt",
    icon: { text: "C:\\", color: "#767676" },
    theme: { ...campbell, background: "#0C0C0C", foreground: "#CCCCCC", cursor: "#FFFFFF" },
  },
  bash: {
    file: process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash",
    args: ["--login", "-i"],
    prompt: /\$ ?$/,
    clear: "clear",
    prelude: ["export LANG=C.UTF-8"],
    title: "bash",
    icon: { text: "$", color: "#16C60C" },
    theme: {
      black: "#282C34", red: "#E06C75", green: "#98C379", yellow: "#E5C07B",
      blue: "#61AFEF", magenta: "#C678DD", cyan: "#56B6C2", white: "#DCDFE4",
      brightBlack: "#5A6374", brightRed: "#E06C75", brightGreen: "#98C379", brightYellow: "#E5C07B",
      brightBlue: "#61AFEF", brightMagenta: "#C678DD", brightCyan: "#56B6C2", brightWhite: "#DCDFE4",
      background: "#282C34", foreground: "#DCDFE4", cursor: "#A3B3CC",
    },
  },
};
