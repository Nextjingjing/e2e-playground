# วิธีติดตั้ง e2e-playground ให้ AI ทุกตัว

[English](INSTALL.md) · ใช้เวลาประมาณ 5 นาที · ไม่ต้องเป็นโปรแกรมเมอร์ก็ทำตามได้

e2e-playground คือชุด "สกิล" 5 ตัว ที่สอน AI ให้ทำงานเหล่านี้ได้ดีขึ้น:

| สกิล | ช่วยเรื่อง |
|---|---|
| hold-my-hand | เขียนคู่มือ/วิธีทดสอบ ทีละขั้น พร้อมรูปหน้าจอ |
| paparazzi | แคปหน้าจอจริง ใส่กรอบและเลข ①②③ |
| show-and-tell | อัดวิดีโอสาธิตบนระบบจริง มีเคอร์เซอร์ ไฮไลต์ คำบรรยาย และเพลง |
| brat-e2e | เขียนเทสต์อัตโนมัติที่ไม่พังมั่ว |
| human-yardstick | ตัวเลขเกี่ยวกับคน เช่น ข้อความควรค้างกี่วินาที ตัวหนังสือควรใหญ่แค่ไหน |

ติดตั้งครั้งเดียว แล้ว AI จะเลือกใช้สกิลเองตามงานที่คุณสั่ง ไม่ต้องจำชื่อ

---

## ขั้นที่ 1 — เอาไฟล์ลงเครื่อง

เลือกทางใดทางหนึ่ง

**ทาง ก. ไม่เคยใช้ git** (ง่ายสุด)

1. เปิด https://github.com/Nextjingjing/e2e-playground
2. กดปุ่มสีเขียว **Code** ด้านขวาบน
3. กด **Download ZIP**
4. คลิกขวาไฟล์ที่ได้ → **Extract All…** (แตกไฟล์) ไปไว้ที่ที่จะไม่ลบทิ้ง เช่น `D:\e2e-playground`

**ควรเห็น:** โฟลเดอร์ที่มีไฟล์ `install.ps1`, `install.sh`, `README.md` อยู่ข้างใน
(ถ้าได้โฟลเดอร์ซ้อนสองชั้น เช่น `e2e-playground-main\e2e-playground-main` ให้ใช้ชั้นในที่มีไฟล์พวกนี้)

**ทาง ข. ใช้ git เป็น** (อัปเดตง่ายกว่า)

```
git clone https://github.com/Nextjingjing/e2e-playground
```

> อย่าย้ายหรือลบโฟลเดอร์นี้หลังติดตั้ง — AI อ่านสกิลจากโฟลเดอร์นี้โดยตรง
> (ยกเว้น claude.ai และ Claude Code แบบ plugin ที่ไม่ต้องใช้โฟลเดอร์นี้)

---

## ขั้นที่ 2 — เลือก AI ที่คุณใช้

| ใช้ AI ตัวไหน | ไปที่ |
|---|---|
| Claude Code (เทอร์มินัล / VS Code / แอป) | [ข้อ A](#a-claude-code) |
| claude.ai บนเว็บ หรือ Claude Desktop | [ข้อ B](#b-claudeai--claude-desktop) |
| OpenAI Codex | [ข้อ C](#c-openai-codex) |
| Gemini CLI | [ข้อ D](#d-gemini-cli) |
| GitHub Copilot ใน VS Code | [ข้อ E](#e-github-copilot-ใน-vs-code) |
| Cursor | [ข้อ F](#f-cursor) |
| ตัวอื่น | [ข้อ G](#g-ai-ตัวอื่น) |

ใช้หลายตัวพร้อมกันได้ ทำข้อของแต่ละตัว

### วิธีเปิด PowerShell ในโฟลเดอร์ (ใช้ในข้อ C–G บน Windows)

1. เปิดโฟลเดอร์ `e2e-playground` ใน File Explorer
2. คลิกช่องที่อยู่ (แถบด้านบนที่เขียน path) พิมพ์ `powershell` แล้วกด Enter

**ควรเห็น:** หน้าต่างสีน้ำเงิน/ดำ ที่บรรทัดสุดท้ายลงท้ายด้วยชื่อโฟลเดอร์นี้ เช่น `PS D:\e2e-playground>`

บน Mac / Linux: เปิด Terminal แล้วพิมพ์ `cd ` ตามด้วยลากโฟลเดอร์มาวาง แล้วกด Enter

---

### A. Claude Code

ไม่ต้องใช้โฟลเดอร์จากขั้นที่ 1

1. เปิด Claude Code
2. พิมพ์แล้วกด Enter:
   ```
   /plugin marketplace add Nextjingjing/e2e-playground
   ```
3. พิมพ์แล้วกด Enter:
   ```
   /plugin install e2e-playground@e2e-playground
   ```
4. ปิด Claude Code แล้วเปิดใหม่ (หรือพิมพ์ `/reload-plugins`)

**ตรวจว่าใช้ได้:** พิมพ์ `/plugin` → ในแท็บ Installed ควรเห็น **e2e-playground** สถานะ enabled

### B. claude.ai / Claude Desktop

ต้องใช้แพ็กเกจ Pro, Max, Team หรือ Enterprise

1. เปิด https://github.com/Nextjingjing/e2e-playground/releases/latest
2. ดาวน์โหลดไฟล์ `.zip` ของสกิลที่อยากใช้ (เช่น `hold-my-hand.zip`) — **ไม่ต้องแตกไฟล์**
3. ใน claude.ai ไปที่ **Settings → Capabilities** แล้วเปิด **Code execution and file creation**
4. ไปที่ **Customize → Skills** แล้วกด **+** (บางเวอร์ชันอยู่ที่ Settings → Capabilities → **Upload skill**)
5. เลือกไฟล์ `.zip` ที่ดาวน์โหลดมา ทำซ้ำทีละไฟล์

**ตรวจว่าใช้ได้:** ในรายการ Skills ควรเห็นชื่อสกิลพร้อมสวิตช์ที่เปิดอยู่
ถ้าชื่อเป็นสีเทา แปลว่ายังไม่ได้เปิด Code execution (ข้อ 3)

> show-and-tell และ paparazzi ต้องควบคุมเบราว์เซอร์บนเครื่องคุณ จึงทำงานได้เต็มที่ในเครื่องมือที่รันบนเครื่อง
> (Claude Code, Codex, Gemini CLI, Cursor, Copilot) มากกว่าบนเว็บ

### C. OpenAI Codex

1. เปิด PowerShell ในโฟลเดอร์ (ดูหัวข้อด้านบน)
2. พิมพ์แล้วกด Enter:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Tools codex
   ```
   Mac / Linux: `./install.sh codex`
3. ปิด Codex แล้วเปิดใหม่

**ควรเห็น** หลังข้อ 2: บรรทัด `+ hold-my-hand`, `+ paparazzi` … ครบ 5 ตัว และ `Done.`

### D. Gemini CLI

1. เปิด PowerShell ในโฟลเดอร์
2. พิมพ์แล้วกด Enter:
   ```
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Tools agents
   ```
   Mac / Linux: `./install.sh agents`
3. เปิด Gemini CLI ใหม่

**ตรวจว่าใช้ได้:** ใน Gemini CLI พิมพ์ `/skills list` → ควรเห็นสกิลทั้ง 5 ตัว

### E. GitHub Copilot ใน VS Code

1. ทำข้อ 1–2 ของ [ข้อ D](#d-gemini-cli) (ใช้ `-Tools agents` เหมือนกัน — ถ้าทำแล้วข้ามได้)
2. ใน VS Code กด `Ctrl+Shift+P` พิมพ์ **Reload Window** แล้วกด Enter
3. เปิดแชท Copilot และเลือกโหมด **Agent**

**ตรวจว่าใช้ได้:** ถาม Copilot ว่า "มีสกิลอะไรบ้าง" → ควรตอบชื่อ hold-my-hand, show-and-tell …
ถ้าไม่เห็น: เปิด Settings ค้นคำว่า `agent skills` แล้วเปิดตัวเลือกที่เกี่ยวข้อง (บางเวอร์ชันยังเป็นฟีเจอร์ทดลอง)

### F. Cursor

1. ทำข้อ 1–2 ของ [ข้อ D](#d-gemini-cli) (`-Tools agents`)
2. ใน Cursor กด `Ctrl+Shift+P` พิมพ์ **Reload Window** แล้วกด Enter

**ตรวจว่าใช้ได้:** ในแชท Agent พิมพ์ `/` → ควรเห็นชื่อสกิลในรายการ
ถ้า Cursor ไม่หยิบสกิลมาใช้เอง ให้เรียกตรงๆ เช่น `/hold-my-hand`

### G. AI ตัวอื่น

- ถ้ามันมีโฟลเดอร์ skills ของตัวเอง:
  ```
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Dest "ที่อยู่โฟลเดอร์ skills ของมัน"
  ```
- ถ้ามันไม่รู้จักสกิลเลย: บอกมันว่า "อ่าน `AGENTS.md` ในโฟลเดอร์ e2e-playground ก่อนทำงาน"
  ไฟล์นี้บอกว่างานแบบไหนต้องอ่านสกิลไหน

---

## ขั้นที่ 3 — ลองใช้

พิมพ์สั่ง AI ตามปกติ มันจะเลือกสกิลเอง เช่น

- "ทำวิธีทดสอบหน้าสั่งซื้อ เป็น html ว่ากดยังไง พร้อมรูป" → hold-my-hand
- "แคปหน้าจอหน้า login ใส่เลขกำกับปุ่ม" → paparazzi
- "อัดวิดีโอให้ดูว่าหน้าค้นหาใช้ได้จริง ใส่เพลงด้วย" → show-and-tell
- "เขียน e2e ให้หน้าตะกร้าสินค้า" → brat-e2e
- "คำบรรยายภาษาไทย 30 ตัวอักษรควรค้างกี่วินาที" → human-yardstick

### สิ่งที่ต้องมีเพิ่ม (เฉพาะตอนใช้สกิลที่ต้องการ)

| สกิล | ต้องมี |
|---|---|
| hold-my-hand, paparazzi, brat-e2e | Node.js + Playwright ในโปรเจกต์ที่ทดสอบ (`npm i -D @playwright/test` แล้ว `npx playwright install chromium`) |
| show-and-tell | ข้างบน + [ffmpeg](https://ffmpeg.org/download.html) + Python ที่มี numpy (`pip install numpy`) |
| human-yardstick | ไม่ต้องมีอะไร |

ไม่ต้องติดตั้งล่วงหน้า ถ้าขาดอะไร AI จะบอกเอง

---

## อัปเดต

- **ทาง ข. (git):** ในโฟลเดอร์พิมพ์ `git pull` จบ ทุก AI ได้ของใหม่พร้อมกัน
- **ทาง ก. (ZIP):** ดาวน์โหลด ZIP ใหม่ แตกไฟล์ทับโฟลเดอร์เดิม
- **Claude Code:** `/plugin marketplace update e2e-playground`
- **claude.ai:** ลบสกิลเก่าในรายการ แล้วอัปโหลด zip ใหม่

## ถอนการติดตั้ง

```
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Tools codex,agents -Remove
```
(ใส่ชื่อเดียวกับตอนติดตั้ง) — ลบแค่ทางลัดใน AI แต่ละตัว ไฟล์ในโฟลเดอร์ e2e-playground ยังอยู่
Claude Code: `/plugin uninstall e2e-playground@e2e-playground`

## ปัญหาที่เจอบ่อย

| อาการ | ทำแบบนี้ |
|---|---|
| `running scripts is disabled on this system` | ใช้คำสั่งแบบมี `powershell -ExecutionPolicy Bypass -File …` ตามที่เขียนไว้ อย่าพิมพ์ `.\install.ps1` เปล่าๆ |
| ติดตั้งแล้ว AI ยังไม่เห็นสกิล | ปิดแล้วเปิด AI ใหม่ หรือเริ่มแชทใหม่ |
| สกิลขึ้นซ้ำ 2 อัน | ติดตั้งไว้สองที่ ถอนอันหนึ่งออก (`-Remove`) — ใช้ `agents` อย่างเดียวก็พอสำหรับ Gemini/Copilot/Cursor |
| `= hold-my-hand already there` | มีอยู่แล้ว ไม่ต้องทำอะไร |
| ย้ายโฟลเดอร์แล้วสกิลหาย | ย้ายกลับ หรือถอนแล้วติดตั้งใหม่จากที่ใหม่ |
| claude.ai ชื่อสกิลเป็นสีเทา | เปิด Code execution ใน Settings → Capabilities |
