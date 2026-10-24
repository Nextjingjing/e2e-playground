# FLOWS.md — what the scout learned about the app (template)

Written once in phase 3, read by every recorder and every later session instead of the code.
Keep it factual and short; fix a line the moment it turns out wrong.

```
# FLOWS — <app> · <date> · branch <branch> @ <commit>

## Access
- base URL: http://localhost:3009   start pages use #dev: yes/no
- login: <how> (credentials file: <path>, never the values)
- scanner stand-in: <e.g. purple #dev "คัดลอก" button → click scan input → Ctrl+V + Enter>

## Data setup
- command: <exact command, one line>   makes: <what, ids printed>   consumes per take: <what>
- claims file: <path>

## Screens
### <screen name> — <route>
- reach it: <click path from start page>
- key labels (exact): "<button text>", "<tab text>", ...
- locators that worked: page.getByText("<…>", { exact: true }) / getByRole(...)
- waits: <what to wait for after the action (selector / text)>
- gotchas: <popup that must be closed, slow polling, element covered by toast, ...>

## Terminal cases (paintext)
- shell: powershell / cmd / bash (asked: <date>)   size: 110x30   cwd: <path>
- hidden setup: <commands, one per line>   secrets: env <NAME> (never the value)
- steps: `<command>` → expect /<text>/ ; ... ; proof step: `<query>` → /<row>/
- gotchas: <slow command, prompt that needs an answer, output too long → | Select-Object -First N>

## Expected results (the proof each case shows)
- <case>: <what appears where, exact text>

## Known differences from the design (verified)
- <finding, evidence, date>
```
