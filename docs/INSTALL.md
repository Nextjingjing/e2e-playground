# Install e2e-playground in any AI tool

[ภาษาไทย](INSTALL.th.md) · about 5 minutes · no programming needed

e2e-playground is a set of five skills that make an AI better at:

| skill | helps with |
|---|---|
| hold-my-hand | step-by-step "how to test / how to use" guides with screenshots |
| paparazzi | real screenshots with outlines and numbered badges ①②③ |
| show-and-tell | demo videos on the real app: cursor, highlights, captions, music |
| brat-e2e | automated tests that don't fail at random |
| human-yardstick | numbers about people: how long text should stay up, how big it should be |

Install once; the AI picks the right skill from what you ask. You don't need to remember names.

---

## Step 1 — Get the files

Pick one.

**Option A. Never used git** (easiest)

1. Open https://github.com/Nextjingjing/e2e-playground
2. Click the green **Code** button, top right
3. Click **Download ZIP**
4. Right-click the downloaded file → **Extract All…** to a place you won't delete, e.g. `D:\e2e-playground`

**You should see:** a folder containing `install.ps1`, `install.sh` and `README.md`.
(If you get a folder inside a folder, e.g. `e2e-playground-main\e2e-playground-main`, use the inner one.)

**Option B. You use git** (easier to update)

```
git clone https://github.com/Nextjingjing/e2e-playground
```

> Don't move or delete this folder after installing — the AI tools read the skills from it.
> (claude.ai and the Claude Code plugin don't need it.)

---

## Step 2 — Pick your AI

| you use | go to |
|---|---|
| Claude Code (terminal / VS Code / app) | [A](#a-claude-code) |
| claude.ai in the browser, or Claude Desktop | [B](#b-claudeai--claude-desktop) |
| OpenAI Codex | [C](#c-openai-codex) |
| Gemini CLI | [D](#d-gemini-cli) |
| GitHub Copilot in VS Code | [E](#e-github-copilot-in-vs-code) |
| Cursor | [F](#f-cursor) |
| something else | [G](#g-any-other-ai) |

Using several? Do each one's section.

### Opening PowerShell in the folder (sections C–G on Windows)

1. Open the `e2e-playground` folder in File Explorer
2. Click the address bar at the top, type `powershell`, press Enter

**You should see:** a console whose last line ends with this folder, e.g. `PS D:\e2e-playground>`

macOS / Linux: open Terminal, type `cd `, drag the folder into the window, press Enter.

---

### A. Claude Code

You don't need the folder from step 1.

1. Open Claude Code
2. Type and press Enter:
   ```
   /plugin marketplace add Nextjingjing/e2e-playground
   ```
3. Type and press Enter:
   ```
   /plugin install e2e-playground@e2e-playground
   ```
4. Restart Claude Code (or type `/reload-plugins`)

**Check:** type `/plugin` → the Installed tab lists **e2e-playground**, enabled.

### B. claude.ai / Claude Desktop

Needs a Pro, Max, Team or Enterprise plan.

1. Open https://github.com/Nextjingjing/e2e-playground/releases/latest
2. Download the `.zip` of each skill you want (e.g. `hold-my-hand.zip`) — **don't unzip it**
3. In claude.ai go to **Settings → Capabilities** and turn on **Code execution and file creation**
4. Go to **Customize → Skills** and click **+** (older versions: Settings → Capabilities → **Upload skill**)
5. Choose the `.zip`; repeat for each file

**Check:** each skill appears in the Skills list with its switch on.
A greyed-out name means code execution is still off (step 3).

> show-and-tell and paparazzi drive a browser on your computer, so they work fully in tools that
> run locally (Claude Code, Codex, Gemini CLI, Cursor, Copilot) rather than on the web.

### C. OpenAI Codex

1. Open PowerShell in the folder (see above)
2. Type and press Enter:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Tools codex
   ```
   macOS / Linux: `./install.sh codex`
3. Restart Codex

**You should see** after step 2: `+ hold-my-hand`, `+ paparazzi` … all five, then `Done.`

### D. Gemini CLI

1. Open PowerShell in the folder
2. Type and press Enter:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Tools agents
   ```
   macOS / Linux: `./install.sh agents`
3. Start Gemini CLI again

**Check:** in Gemini CLI type `/skills list` → all five skills are listed.

### E. GitHub Copilot in VS Code

1. Do steps 1–2 of [D](#d-gemini-cli) (same `-Tools agents`; skip if already done)
2. In VS Code press `Ctrl+Shift+P`, type **Reload Window**, press Enter
3. Open Copilot Chat and switch to **Agent** mode

**Check:** ask Copilot "which skills do you have?" → it names hold-my-hand, show-and-tell, …
If not: open Settings, search `agent skills`, and turn the option on (still a preview in some versions).

### F. Cursor

1. Do steps 1–2 of [D](#d-gemini-cli) (`-Tools agents`)
2. In Cursor press `Ctrl+Shift+P`, type **Reload Window**, press Enter

**Check:** in Agent chat type `/` → the skill names are in the list.
If Cursor doesn't pick a skill by itself, call it directly, e.g. `/hold-my-hand`.

### G. Any other AI

- If it has its own skills folder:
  ```
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Dest "path\to\its\skills"
  ```
- If it doesn't know skills at all: tell it "read `AGENTS.md` in the e2e-playground folder before you
  start". That file says which skill to read for which kind of request.

---

## Step 3 — Try it

Ask as you normally would; the AI picks the skill:

- "write how QA should test the checkout page, as an HTML page with screenshots" → hold-my-hand
- "screenshot the login page and number the buttons" → paparazzi
- "record a video showing the search page really works, with music" → show-and-tell
- "add an e2e test for the cart page" → brat-e2e
- "how long should a 30-character caption stay on screen?" → human-yardstick

### Extra tools (only when you use the skill that needs them)

| skill | needs |
|---|---|
| hold-my-hand, paparazzi, brat-e2e | Node.js + Playwright in the project (`npm i -D @playwright/test`, then `npx playwright install chromium`) |
| show-and-tell | the above + [ffmpeg](https://ffmpeg.org/download.html) + Python with numpy (`pip install numpy`) |
| human-yardstick | nothing |

No need to install these in advance — the AI tells you if something is missing.

---

## Update

- **Option B (git):** run `git pull` in the folder — every AI gets the new version at once
- **Option A (ZIP):** download the ZIP again and extract over the old folder
- **Claude Code:** `/plugin marketplace update e2e-playground`
- **claude.ai:** delete the old skill in the list and upload the new zip

## Uninstall

```
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Tools codex,agents -Remove
```
(use the same names you installed with) — removes only the links in each AI; the files in the
e2e-playground folder stay. Claude Code: `/plugin uninstall e2e-playground@e2e-playground`

## Common problems

| you see | do this |
|---|---|
| `running scripts is disabled on this system` | use the full `powershell -ExecutionPolicy Bypass -File …` command above, not plain `.\install.ps1` |
| installed, but the AI doesn't see the skills | restart the AI or start a new chat |
| every skill shows up twice | it's installed in two places; remove one (`-Remove`) — `agents` alone covers Gemini, Copilot and Cursor |
| `= hold-my-hand already there` | already installed, nothing to do |
| skills vanished after moving the folder | move it back, or uninstall and install again from the new place |
| greyed-out skill on claude.ai | turn on code execution in Settings → Capabilities |
