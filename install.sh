#!/usr/bin/env sh
# Install the e2e-playground skills for AI coding tools that read SKILL.md folders.
# Step-by-step guide: docs/INSTALL.md (English) / docs/INSTALL.th.md (ไทย)
#
#   ./install.sh                    # default: ~/.agents/skills + ~/.codex/skills
#   ./install.sh cursor copilot     # pick tools (agents codex gemini copilot cursor claude)
#   DEST=~/my/skills ./install.sh   # any other tool: its skills folder
#   COPY=1 ./install.sh             # copy instead of symlink (symlinks follow `git pull`)
#   ZIP=1 ./install.sh              # make dist/<skill>.zip for claude.ai / Claude Desktop upload
#   REMOVE=1 ./install.sh           # take the links/copies out again
#
# Claude Code: use the plugin instead (one source, no duplicates):
#   /plugin marketplace add Nextjingjing/e2e-playground
#   /plugin install e2e-playground@e2e-playground
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/plugins/e2e-playground/skills"

# ~/.agents/skills is read by Gemini CLI, VS Code Copilot and Cursor, so installing there AND
# into their own folder makes every skill show up twice.
target() {
  case "$1" in
    agents)  echo "$HOME/.agents/skills" ;;   # shared: Gemini CLI, VS Code Copilot, Cursor
    codex)   echo "$HOME/.codex/skills" ;;    # OpenAI Codex CLI / IDE / app
    gemini)  echo "$HOME/.gemini/skills" ;;   # only if you skip "agents"
    copilot) echo "$HOME/.copilot/skills" ;;  # only if you skip "agents"
    cursor)  echo "$HOME/.cursor/skills" ;;   # only if you skip "agents"
    claude)  echo "$HOME/.claude/skills" ;;   # only if you don't use the Claude Code plugin
    *) echo "unknown tool '$1' - use: agents codex gemini copilot cursor claude, or DEST=<folder>" >&2; exit 1 ;;
  esac
}

if [ "${ZIP:-}" = 1 ]; then
  mkdir -p "$ROOT/dist"
  for skill in "$SRC"/*/; do
    name="$(basename "$skill")"
    rm -f "$ROOT/dist/$name.zip"
    (cd "$SRC" && zip -qr "$ROOT/dist/$name.zip" "$name" -x '*/node_modules/*' '*/__pycache__/*')   # zip holds the folder itself
    echo "  zip dist/$name.zip"
  done
  echo "Upload each zip in claude.ai: Customize > Skills > + (or Settings > Capabilities > Upload skill)."
  exit 0
fi

apply() {
  for skill in "$SRC"/*/; do
    name="$(basename "$skill")"
    to="$1/$name"
    if [ "${REMOVE:-}" = 1 ]; then
      if [ -L "$to" ]; then rm "$to"; echo "  - $name"; elif [ -d "$to" ]; then rm -r "$to"; echo "  - $name"; fi
      continue
    fi
    mkdir -p "$1"
    if [ -e "$to" ]; then echo "  = $name already there"; continue; fi
    if [ "${COPY:-}" = 1 ]; then cp -R "$skill" "$to"; else ln -s "${skill%/}" "$to"; fi
    echo "  + $name"
  done
}

if [ -n "${DEST:-}" ]; then echo "$DEST"; apply "$DEST"
else
  [ "$#" -eq 0 ] && set -- agents codex
  for t in "$@"; do
    dir="$(target "$t")"
    echo "$t -> $dir"
    apply "$dir"
  done
fi
echo "Done. Restart the AI tool (or open a new chat) so it loads the skills."
