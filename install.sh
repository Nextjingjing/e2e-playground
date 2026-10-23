#!/usr/bin/env sh
# Install the e2e-playground skills for any AI coding tool that reads SKILL.md folders.
#
#   ./install.sh                  # every tool found on this machine
#   ./install.sh codex gemini     # only these
#   DEST=~/my/skills ./install.sh # any other tool: its skills folder
#   COPY=1 ./install.sh           # copy instead of symlink (symlinks follow `git pull`)
#
# Claude Code is better served by the plugin (one source, no duplicates):
#   /plugin marketplace add Nextjingjing/e2e-playground
#   /plugin install e2e-playground@e2e-playground
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)/plugins/e2e-playground/skills"

target() {
  case "$1" in
    codex)  echo "$HOME/.codex/skills" ;;   # OpenAI Codex CLI / IDE / app
    gemini) echo "$HOME/.gemini/skills" ;;  # Gemini CLI
    agents) echo "$HOME/.agents/skills" ;;  # shared location several tools scan
    claude) echo "$HOME/.claude/skills" ;;  # only if you don't use the plugin
    *) echo "unknown tool '$1' (use: codex gemini agents claude, or DEST=<folder>)" >&2; exit 1 ;;
  esac
}

install_into() {
  mkdir -p "$1"
  for skill in "$SRC"/*/; do
    name="$(basename "$skill")"
    to="$1/$name"
    if [ -e "$to" ]; then echo "  skip $name (already in $1)"; continue; fi
    if [ "${COPY:-}" = 1 ]; then cp -R "$skill" "$to"; else ln -s "${skill%/}" "$to"; fi
    echo "  + $name -> $to"
  done
}

if [ -n "${DEST:-}" ]; then install_into "$DEST"; exit 0; fi
if [ "$#" -eq 0 ]; then
  set --
  command -v codex  >/dev/null 2>&1 && set -- "$@" codex
  command -v gemini >/dev/null 2>&1 && set -- "$@" gemini
  set -- "$@" agents
fi
for t in "$@"; do
  dir="$(target "$t")"
  echo "$t -> $dir"
  install_into "$dir"
done
echo "Done. Restart the tool so it picks the skills up."
