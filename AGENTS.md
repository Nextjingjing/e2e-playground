# AGENTS.md — e2e-playground skills

For AI coding tools that don't load SKILL.md skills by themselves. When a task matches a row,
read that SKILL.md first and follow it; it points to its own scripts and references.
Paths are relative to this repo.

| when the user wants… | read |
|---|---|
| a step-by-step "how to test / how to use" page a colleague can follow (วิธีทดสอบ, คู่มือ) | `plugins/e2e-playground/skills/hold-my-hand/SKILL.md` |
| real annotated screenshots, or a Markdown manual with pictures | `plugins/e2e-playground/skills/paparazzi/SKILL.md` |
| a video showing the feature working on the real system (อัดวิดีโอ, demo clip) | `plugins/e2e-playground/skills/show-and-tell/SKILL.md` |
| an automated end-to-end test that won't flake | `plugins/e2e-playground/skills/brat-e2e/SKILL.md` |
| a duration, size, text length or pacing choice for something people read/watch/click | `plugins/e2e-playground/skills/human-yardstick/SKILL.md` |

Tool-specific words in the skills map like this: "subagent" = any parallel worker your tool
offers (another session or terminal is fine); "look at an image" = open the PNG with whatever
image viewing your tool has. Scripts are plain Node.js / Python / ffmpeg and run in any shell.
