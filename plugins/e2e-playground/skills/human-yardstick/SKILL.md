---
name: human-yardstick
description: Reference numbers about people — how fast they read (Thai and English), how long text or a highlight must stay on screen, how long they wait before losing the thread, how much they can hold in mind at once, how big text and tap targets must be, line length, contrast, colour blindness, ideal video length, and how to say things in keywords so they stick — each with its source and how solid it is, plus ready formulas. Use whenever you choose a duration, size, amount of text or pacing for something people will watch, read or click: demo videos, captions, title cards, slides, guides, screenshots, UI review, presentations, chat/status messages — or the user asks "คนอ่านทันไหม", "ควรค้างกี่วิ", "ตัวอักษรควรใหญ่แค่ไหน", "สั้นแค่ไหนดี", "พูดยังไงให้จำง่าย", "human factors", "UX numbers". Also use when another skill (show-and-tell, hold-my-hand, paparazzi) needs a timing or size default.
---

# Human yardstick

Numbers to design for real people instead of guessing. Each row says where it comes
from and how far to trust it:

- **[P]** primary source checked (paper or the standard itself)
- **[S]** widely cited, confirmed only through secondary sources
- **[H]** heuristic derived here from [P]/[S] numbers — a sensible default, test it

When a number matters (a client deliverable, an accessibility claim), cite the source,
not this file. Use the formulas, then watch the result once as a first-time viewer.

## 1. Reading

| what | number | src |
|---|---|---|
| Silent reading, adult English non-fiction | **238 wpm** (range 175–300); fiction 260 | [P] Brysbaert 2019, 190 studies |
| Reading aloud | 183 wpm | [P] Brysbaert 2019 |
| Eye fixation while reading | ~225–250 ms; saccades 25–60 ms | [S] Rayner 1998 |
| Subtitle reading speed, adult (Netflix, per language) | Korean 12, Indonesian / Vietnamese / Croatian 17, Telugu 22, Chinese 9 chars/s; children ~3–4 lower | [P] Netflix Timed Text guides |
| Thai subtitle speed | **not published** in what we found | — |
| Subtitle on screen | min **5/6 s**, max **7 s** per event, ≤ 2 lines | [P] Netflix general requirements |
| Line length, subtitles | ~42 chars (most Latin languages); **Thai 35** (tone marks and upper/lower vowels not counted) | [P] Netflix |
| Line length, body text | **50–75 chars** | [S] Baymard |
| Line height / spacing users may need | line 1.5×, paragraph 2×, letter 0.12×, word 0.16× font size | [P] WCAG 2.2 SC 1.4.12 |

Thai has no spaces between words, so count **base characters**, not words. Until a Thai
figure is published, use **12–15 chars/s** for adults [H] — between Korean and the 17 of
other alphabetic languages — and slower for older viewers or technical terms.

## 2. Seeing and attention

| what | number | src |
|---|---|---|
| Gist of a picture | can register in **13 ms**; full understanding takes longer | [S] Potter et al. 2014 (MIT) |
| Feels instant | **0.1 s** | [S] Miller 1968 / Nielsen |
| Flow of thought kept | **1 s** (noticed, not disruptive) | [S] Miller 1968 / Nielsen |
| Attention lost | **10 s** — beyond this show progress and a way out | [S] Miller 1968 / Nielsen |
| Productivity jump when the system answers in | < **400 ms** (practical target, not a brain constant) | [S] Doherty & Thadani 1982, IBM |
| Items held in mind at once | **~4 chunks** (young adults; fewer for children/elderly; Miller's 7 was rhetorical) | [P] Cowan 2001 |
| Video length vs engagement | shorter is much more engaging; often quoted as **≤ 6 min** | [P] Guo, Kim & Rubin 2014 (6.9 M sessions); 6-min cut-off [S] |

## 3. Size, contrast, colour

| what | number | src |
|---|---|---|
| Text contrast (AA) | **4.5:1** normal, **3:1** large (≥ 18 pt ≈ 24 px, or 14 pt ≈ 18.5 px bold); AAA 7:1 / 4.5:1 | [P] WCAG 2.2 SC 1.4.3 / 1.4.6 |
| Click/tap target, web minimum (AA) | **24 × 24 CSS px** (or enough spacing) | [P] WCAG 2.2 SC 2.5.8 |
| Tap target, platforms | iOS **44 × 44 pt**, Android **48 × 48 dp**, WCAG AAA 44 × 44 px | [S] Apple HIG, Material |
| Colour vision deficiency | ~**8 % of men**, ~0.5 % of women (varies by population: ~4–8 %) | [S] |

Never carry meaning by red vs green alone: add a word, an icon or a shape.

## 4. Formulas (use these as defaults)

**Text on screen (caption, card, label, toast)** [H, from §1]
```
hold_s = clamp(1.0 + base_chars / cps, 2.5, 9)     cps: Thai 12–15, English ~17–20
per caption event: ≥ 0.83 s, ≤ 7 s; split longer text into the next caption
```
If the formula says more than ~7 s for one caption or 9 s for a card, the text is too
long — cut words before adding seconds.

**Highlight / proof moment in a video** [H]
- Viewer must find it (2–3 fixations ≈ 0.5–0.75 s) and read its label (formula above):
  `hold_s ≈ 0.75 + label_hold`, at least **1.5 s**; the one moment that proves the point
  **3–5 s**.
- Do not show more than one new thing at once; ≤ 4 items in any list or card (Cowan).

**Pacing a recorded demo** [H, from §2]
- Any stretch > **1 s** where nothing new happens breaks the flow → fast-forward it.
- A wait > **10 s** loses the viewer → cut it to under a second of sped-up footage.
- Mouse travel to a target ~0.5–1 s; pause ~0.5 s before an ordinary click, 1–1.5 s
  before the click that matters, so the eye arrives first.
- One case ~1–2 min; a whole video ≤ 6 min, or split into chapters (segmenting).

**Text size in a video** [H, from §3]
- Render at 1440×900 or 1920×1080: captions ≥ **24 px**, card titles ≥ 56 px.
- If it will be watched on a phone, the frame shrinks ~3.5×: render captions ≥ **36 px**
  (or record at 1280×720 with ≥ 32 px) so they stay ≥ ~10 px on the phone.
- Caption box: white on ≥ 85 % opaque dark → well above 4.5:1.

**Writing and speaking in keywords** [S: Mayer's multimedia principles; H for the rest]
- **Front-load the keyword**: the first 2–3 words carry the meaning
  ("ไม้ผีเกิดแล้ว · หาไม้ใหม่ ZCA เดียวกัน", not "หลังจากที่รถยกได้ทำการ…").
- **One idea per caption / slide / message**; ≤ 4 chunks (Cowan).
- **Signal** what matters (highlight, arrow, bold) — signaling principle.
- **Cut what doesn't serve the point** — coherence principle; decoration costs attention.
- **Narration + picture, not narration + the same text on screen** — redundancy principle.
  In a silent demo the caption *is* the narration, so keep it short and let the screen
  show the detail.
- **Chunk long flows** with a mid-title before each new part — segmenting principle.
- Say the **result**, not the mouse action ("ระบบไม่จองไม้ใหม่ให้" beats "กดปุ่มยืนยัน").
- Spoken pace for a talk or voice-over: ~140–160 wpm [S, coach sources]; slow down for
  numbers and names.

## 5. Quick answers

| question | answer |
|---|---|
| คำบรรยายภาษาไทย 30 ตัวอักษร ค้างกี่วิ | 1 + 30/13 ≈ **3.3 s** |
| การ์ดเปิดเคส 3 บรรทัด ~70 ตัว | 1 + 70/14 ≈ **6 s**; ถ้าเกิน 9 s ให้ตัดคำ |
| รอโหลด 4 วิในวิดีโอ | เกิน 1 s → เร่งให้เหลือ ~0.6 s |
| ปุ่มบนแท็บเล็ตรถยกเล็กสุด | 44–48 px ขึ้นไป (ถุงมือ → ใหญ่กว่านี้) |
| ตัวหนังสือในวิดีโอที่ดูบนมือถือ | ≥ 36 px ตอนอัด 1440 กว้าง |
| ใส่กี่ข้อในการ์ดเดียว | ≤ 4 |
| สีแดง/เขียวบอกสถานะพอไหม | ไม่พอ — เติมคำหรือไอคอน |

## Sources

- Brysbaert, M. (2019). How many words do we read per minute? *Journal of Memory and Language*. https://www.Gwern.net/doc/psychology/linguistics/2019-brysbaert.pdf
- Netflix Timed Text Style Guide — General Requirements: https://backlothelp.netflix.com/hc/en-us/articles/215758617 ; Thai: https://backlothelp.netflix.com/hc/en-us/articles/220448308 ; Korean: https://backlothelp.netflix.com/hc/en-us/articles/216001127 ; Indonesian: https://backlothelp.netflix.com/hc/en-us/articles/216009727 ; reading-speed counting: https://backlothelp.netflix.com/hc/en-us/articles/115001352212
- Rayner (1998) via Encyclopedia of the Mind, "Eye movements during reading": https://sk.sagepub.com/ency/edvol/embed/encyclopedia-of-the-mind/chpt/eye-movements-during-reading
- Potter et al. (2014), MIT News: https://news.mit.edu/index%2Ephp/2014/in-the-blink-of-an-eye-0116
- Nielsen, response-time limits: https://www.nngroup.com/videos/3-response-time-limits-interaction-design/ ; https://jakobnielsenphd.substack.com/p/time-scale-ux
- Doherty threshold: https://lawsofux.com/doherty-threshold/ ; caveat https://newsletter.kentbeck.com/p/the-precious-eyeblink
- Cowan, N. (2001). The magical number 4 in short-term memory. *BBS*. https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf
- Guo, Kim & Rubin (2014). How video production affects student engagement. L@S. https://www.cs.rochester.edu/hci/pubs/pdfs/edX-MOOC-video-production-and-engagement_LAS-2014.pdf ; 6-minute summary: https://curriculumfellows.hms.harvard.edu/sites/projects.iq.harvard.edu/files/cfp_version2/files/whiteboardworkshopslides_marked.pdf
- WCAG 2.2: text spacing https://www.w3.org/WAI/WCAG22/Understanding/text-spacing ; target size https://kb.daisy.org/publishing/docs/wcag/target-size-minimum.html ; contrast https://accessibilityinsights.io/info-examples/web/color-contrast/
- Line length: https://baymard.com/blog/line-length-readability
- Mayer's principles: https://services.dartmouth.edu/TDClient/1806/Portal/KB/PrintArticle?ID=171655
- Tap targets (secondary): https://frontendchecklist.io/rules/accessibility/touch-targets
- Speaking rate (coach sources, rough): https://virtualspeech.com/blog/average-speaking-rate-words-per-
