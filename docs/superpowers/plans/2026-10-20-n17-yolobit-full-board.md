# N17 — Yolo:Bit mô phỏng đủ chức năng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bo mạch Yolo:Bit trong stem-demo **mô phỏng đủ các chức năng onboard** mà toolbox Yolo:Bit của OhStem cho học sinh dùng, và Python sinh ra đúng dạng API thật. Cụ thể:
- ma trận LED RGB: màu, điểm, đặt tất cả, hình có sẵn;
- nút A/B: bấm thẳng trên hình bo mạch, A+B;
- ánh sáng, nhiệt độ, gia tốc kế/lắc;
- còi: bài nhạc có sẵn, tần số, dừng;
- thời gian chạy, số ngẫu nhiên;
- ghi analog (PWM) và servo;
- mức **Nâng cao** khác **Cơ bản** thật sự;
- vài bài lab có mục tiêu dùng các chức năng mới;
- các rủi ro demo được bịt.

**Bối cảnh và quyết định của người dùng (2026-10-19):**
- "phát triển tính năng bảng mạch đầy đủ tất cả các functions và thật hoàn hảo để đi vào sử dụng thật"; sau đó chọn **"Mô phỏng đủ chức năng"**: học sinh không cần mạch, code MicroPython đúng API Yolo:Bit thật.
- Nạp code xuống mạch thật (WebSerial/BLE) **không** làm lần này; nó vào lộ trình.
- Buổi thuyết trình với Sở/Phòng GD&ĐT là trước 07:00 ngày 2026-10-20, nên mọi thứ phải ổn định để demo.

**Nguồn sự thật:**
- `docs/ohstem-yolobit-simulator-investigation.md` §5.3–5.7: toolbox và code OhStem đã kiểm.
- `docs/yolobit-compatibility-contract.md`: luật sinh code và khai báo VERIFIED/UNVERIFIED.
- `docs/yolobit-compatible-board-implementation-plan.md`: B1–B10, YB-7/YB-8 và các quyết định cũ.
- Hiện trạng code, với file:line: `.superpowers/sdd/yolobit-recon.md`.
- Code thắng tài liệu khi khác.

**Architecture:**
- Giữ nguyên kiến trúc: block (Blockly) → `compileYbcProgram` → `YbcProgramIR` → interpreter JS (`src/core/program/ybc-interpreter.ts`) chạy trên các capability (`src/core/simulation/peripherals/*`, `src/core/run/*`). Song song, `src/core/codegen/yolobit/generate.ts` sinh Python.
- Mỗi chức năng mới đi đủ năm lớp: construct + block, IR, interpreter + peripheral, codegen + golden, UI điều khiển/hiển thị.
- Không Pyodide. Không đổi giao thức `stem-lab/v1`; chỉ thêm template key.

**Tech Stack:** React 19, Vite 8, Vitest 4, TypeScript 6, Blockly và Konva như hiện có; ESLint 10 có luật biên B1. Không thêm thư viện.

## Model cho từng task

| Task | Model |
|---|---|
| B1. Ma trận LED RGB: màu, điểm, đặt tất cả, hình có sẵn, chữ chạy có màu | `opus` |
| B2. Cảm biến: nhiệt độ, gia tốc kế (x/y/z, lắc, nghiêng) + điều khiển + kịch bản Kiểm tra | `opus` |
| B3. Âm thanh: bài nhạc có sẵn, tần số, dừng, mở khóa âm thanh khi bấm Chạy/Kiểm tra | `opus` |
| B4. Tương tác và logic: bấm A/B trên bo mạch, A+B, thời gian chạy, ngẫu nhiên; chân thả nổi không dừng chương trình | `opus` |
| B5. Chân: ghi analog (PWM, LED sáng mờ) và servo trên canvas | `opus` |
| B6. Hồ sơ Cơ bản / Nâng cao, 4 template có mục tiêu, tài liệu, e2e | `opus` |

**Phụ thuộc:** tuần tự B1 → B6. Phía LMS (template key mới trong `LabTemplateCatalog.cs`/`lab-templates.ts`, iframe `allow="clipboard-write"`, chữ gợi ý Nâng cao) là task riêng **B7 ở repo STEMLearning**, chạy sau N16 của repo đó.

## Global Constraints

- **Đọc trước mỗi task:** `CLAUDE.md` của repo (plan §0, §5.1 biên B1–B8, §15). Biên B1: `src/core/**` không import react, konva, blockly, `src/ui`…; `pnpm lint` bắt.
- **Chữ:**
  - Chuỗi UI ở `src/ui/i18n/messages.ts`, hai ngôn ngữ cùng khóa; chữ block ở `src/ui/i18n/blocks.ts`.
  - Lab launch (`lab=`) nói tiếng Việt.
  - Identifier và comment viết tiếng Anh.
- **Sinh code:**
  - Theo đúng dạng trong investigation §5.3, ví dụ `display.show(Image.HEART)` và `music.play(music.DADADADUM, wait=False)`. Dạng đã kiểm thì ghi **VERIFIED** trong `docs/yolobit-compatibility-contract.md`.
  - Dạng chưa thấy trong tài liệu thì dùng tên của thư viện `yolobit` MicroPython (kiểu micro:bit) và ghi **UNVERIFIED** kèm lý do, **không bịa là đã kiểm**:
    - `display.set_pixel(x, y, '#rrggbb')`, `display.set_all('#rrggbb')`;
    - `temperature()`;
    - `accelerometer.get_x()`, `accelerometer.is_gesture('shake')`;
    - `music.pitch(freq, ms)`, `music.stop()`;
    - `running_time()`, `random.randint(a, b)`;
    - `pinN.write_analog(v)`, `pinN.servo_write(deg)`.
  - Golden file cho mỗi block mới; kiểm cú pháp bằng `ast.parse` như test hiện có.
- **Mô phỏng:**
  - Thời gian theo `setTimeout` có hủy được, như hiện nay. Stop dừng ngay mọi âm thanh, servo và scroll.
  - Không lưu trạng thái chạy vào tài liệu dự án.
  - Mọi input mới có giá trị mặc định khi bắt đầu chạy: nhiệt độ **25 °C**, gia tốc **(0, 0, −1024) mg** (nằm phẳng), ánh sáng giữ **50**.
- **Kiểm tra (Check):**
  - Input mới phải điều khiển được bằng kịch bản (scripted input) như ánh sáng.
  - Goal so khung hình mới so được **màu** khi goal khai báo màu. Goal cũ vẫn chỉ so sáng/tắt.
- **Tương thích:**
  - Dự án và template cũ mở và chạy y như trước.
  - Golden file cũ không đổi, trừ khi task nói rõ.
  - Template key cũ giữ nguyên: `ybc-heart`, `ybc-button-ab`, `ybc-night-light`, `ybc-melody`, `ybc-empty`.
- **Lệnh mỗi task:** `pnpm verify` PASS; task có UI thì `pnpm e2e` PASS (Chromium).
  - Dev server `localhost:5173` đang chạy thật cho LMS: không tắt, không chạy server thứ hai trên 5173. `pnpm e2e` của repo tự bật server theo `playwright.config.ts`; nếu nó đòi đúng cổng 5173 đang bận thì dùng `reuseExistingServer` sẵn có hoặc báo lại.
- **Git:**
  - Repo `/Users/hoangminh/Desktop/stem/stem-demo`, nhánh `feat/lab-embedding`.
  - Commit một `-m`, **không bao giờ** có `Co-Authored-By` hay trailer ghi công. Stage theo đường dẫn; không amend, rebase, reset hay push (controller push).
- **Không dispatch subagent.**

## Review Focus

1. **Bấm Stop giữa lúc phát nhạc, servo đang quay, hay chữ đang chạy:** mọi thứ dừng ngay; chạy lại bắt đầu sạch (servo về 90°, LED tắt). Test ở B3 và B5.
2. **Học sinh bấm A trên hình bo mạch rồi kéo chuột ra ngoài mới thả:** nút không bị kẹt "đang nhấn". Test ở B4.
3. **Màu nhập tay sai dạng** (`red`, `#ff00`, rỗng) trong block màu: không vỡ chương trình; dùng màu mặc định đỏ và cảnh báo. Test ở B1.
4. **Tab bị ẩn khi đang Kiểm tra:** kết quả không báo đạt sai. Chấp nhận báo "chưa đạt, chạy lại"; không được đạt giả. Test ở B6.
5. **Mở project cũ** (tạo trước N17) ở cả hai mức: chạy y như trước. Test ở B6.

---

### Task B1: Ma trận LED RGB

**Files:** `src/core/constructs/ybc.display.ts`, `src/core/program/{block-packs.ts, compile-ybc-program.ts, ybc-ir.ts, ybc-interpreter.ts}`, `src/core/simulation/peripherals/display.ts`, `src/core/capabilities/frame.ts`, `src/core/codegen/yolobit/{generate.ts, modules.ts}` + `hardware/__golden__/*`, `src/ui/blockly/*` (field màu), `src/ui/i18n/{blocks.ts, messages.ts}`, `src/core/challenge/goal-tracker.ts` (so màu), test tương ứng.

**Produces:**
- Block mới:
  - `ybc_display_show_icon` (dropdown hình có sẵn: HEART, HEART_SMALL, HAPPY, SAD, CONFUSED, ANGRY, SURPRISED, YES, NO, ARROW_N/E/S/W);
  - `ybc_display_set_pixel` (cột 0–4, hàng 0–4, màu);
  - `ybc_display_set_all` (màu);
  - `ybc_display_clear_pixel` (cột, hàng);
  - `ybc_colour` (colour picker → chuỗi `#rrggbb`).
- `ybc_display_show_image` có thêm field màu cho các ô bật (mặc định đỏ `#ff0000`): ảnh cũ không có field thì vẫn đỏ.
- `ybc_display_scroll_text`/`number` có input màu, mặc định đỏ, hoặc không có input khi là block cũ.

- [ ] **Step 1:** test fail.
  - `display.test.ts`: set_pixel đặt đúng ô và màu; set_all; clear_pixel; icon HEART cho đúng 25 ô theo bảng micro:bit.
  - `generate` golden: `display.show(Image.HEART)`, `display.set_pixel(2, 3, '#00ff00')`.
  - Màu sai dạng → đỏ kèm cảnh báo.
  - goal `display-shows` có `colour` thì so màu.
- [ ] **Step 2:** chạy, thấy fail. `pnpm vitest run src/core`.
- [ ] **Step 3:** code đủ năm lớp. Renderer đã vẽ `#rrggbb`; kiểm lại glow/độ sáng cho màu tối.
- [ ] **Step 4:** `pnpm verify && pnpm e2e` PASS.
- [ ] **Step 5:** commit `feat(ybc): RGB display — colours, pixels, fill, built-in icons and coloured scrolling text`.

### Task B2: Cảm biến nhiệt độ và gia tốc kế

**Files:** `src/core/constructs/ybc.input.ts`, IR/interpreter/compile, `src/core/simulation/peripherals/{temperature.ts, accelerometer.ts}` (mới), `src/core/simulation/peripherals/onboard-capabilities.ts`, `src/main.tsx` (ghép capability), `src/ui/runtime-controls/*` (thanh nhiệt độ; tấm nghiêng 2D kéo thả + nút "Lắc"), `src/ui/canvas/YbcBoardRenderer.tsx` (hiện số đo khi chạy), codegen + golden, `src/core/challenge/*` (scripted input `temperature`, `tilt`, `shake`), i18n, test.

**Produces:** block
- `ybc_temperature` → số °C, nguyên;
- `ybc_accel` (x|y|z) → mg, nguyên −2048..2048;
- `ybc_gesture_is` (shake | tilt_left | tilt_right | face_up | face_down | logo_up | logo_down) → Boolean.

**Luật mô phỏng:**
- `shake` đúng trong **1 s** sau khi bấm "Lắc".
- Nghiêng suy từ x/y với ngưỡng **±400 mg**.
- Nhiệt độ **−10..50**, bước 1.

- [ ] **Step 1:** test fail.
  - peripheral: mặc định khi bắt đầu chạy;
  - `shake` hết hạn sau 1 s (fake timers);
  - suy cử chỉ từ tấm nghiêng;
  - interpreter đọc giá trị mới;
  - golden `temperature()`, `accelerometer.get_x()`, `accelerometer.is_gesture('shake')`;
  - challenge kịch bản `shake` tại 300 ms làm goal đạt.
- [ ] **Step 2:** chạy, thấy fail.
- [ ] **Step 3:** code.
- [ ] **Step 4:** `pnpm verify && pnpm e2e` PASS.
- [ ] **Step 5:** commit `feat(ybc): temperature and accelerometer — sliders, a tilt pad and a shake button, readouts on the board, scripted in checks`.

### Task B3: Âm thanh đầy đủ

**Files:** `src/core/constructs/ybc.sound.ts`, IR/interpreter/compile, `src/core/simulation/peripherals/sound.ts`, `src/ui/audio/audio-player.ts`, `src/ui/app/*` (mở khóa âm thanh), codegen + golden, i18n, test.

**Produces:** block
- `ybc_sound_melody` (dropdown: DADADADUM, ENTERTAINER, PRELUDE, ODE, NYAN, RINGTONE, FUNK, BLUES, BIRTHDAY, WEDDING, FUNERAL, PUNCHLINE, PYTHON, BADDY, CHASE, BA_DING, JUMP_UP, JUMP_DOWN, POWER_UP, POWER_DOWN; chờ xong / không chờ);
- `ybc_sound_pitch` (Hz 20–20000, ms 0–60000);
- `ybc_sound_stop`.

Giai điệu là dãy nốt của micro:bit `music`, viết tay trong một bảng dữ liệu (`melodies.ts`).

**Mở khóa âm thanh:**
- Click **Chạy** hoặc **Kiểm tra** là cử chỉ người dùng, nên `AudioContext.resume()` gọi ngay trong handler đó.
- Nút "Bật âm thanh" chỉ còn là công tắc tắt/bật tiếng, mặc định **bật** trong lab.

- [ ] **Step 1:** test fail.
  - giai điệu không chờ chạy song song với code sau;
  - `stop` dừng ngay;
  - Stop chương trình dừng tiếng;
  - golden `music.play(music.BIRTHDAY, wait=False)`, `music.pitch(440, 500)`, `music.stop()`;
  - audio-player resume khi có cử chỉ (mock AudioContext).
- [ ] **Step 2:** chạy, thấy fail.
- [ ] **Step 3:** code.
- [ ] **Step 4:** `pnpm verify && pnpm e2e` PASS.
- [ ] **Step 5:** commit `feat(ybc): built-in melodies, tones and stop; sound starts with Run or Check without a separate unlock`.

### Task B4: Tương tác và logic

**Files:** `src/ui/canvas/YbcBoardRenderer.tsx` (nút A/B bấm được: `listening` true, pointer down/up/leave/cancel), `src/ui/runtime-controls/*`, `src/core/constructs/ybc.input.ts` (A+B), `src/core/constructs/*` (thời gian chạy, ngẫu nhiên), IR/interpreter/compile, codegen + golden, `src/core/run/ybc-pin-io.ts` (chân thả nổi), i18n, test.

**Produces:**
- Block:
  - `ybc_button_pressed` thêm lựa chọn `A+B`;
  - `ybc_running_time` → ms từ lúc chạy;
  - `ybc_random_int` (từ, đến; bao cả hai đầu).
- Chân thả nổi (B9 cũ): đọc digital của chân không có nguồn trả **0** (pull-down mặc định) và hiện cảnh báo một lần "Chân P1 đang thả nổi — đọc là 0". Chương trình **không** dừng. Xung đột hoặc chân tự ghi vẫn dừng như cũ.

- [ ] **Step 1:** test fail.
  - pointer down trên nút A trong renderer thì `is_pressed` true; leave hoặc cancel thì false (không kẹt);
  - A+B;
  - `running_time` tăng theo fake timers;
  - `random_int` trong khoảng, có seed khi test;
  - chân thả nổi đọc 0 kèm cảnh báo;
  - golden `button_a.is_pressed() and button_b.is_pressed()`, `running_time()`, `random.randint(1, 6)` cùng `import random`.
- [ ] **Step 2:** chạy, thấy fail.
- [ ] **Step 3:** code.
- [ ] **Step 4:** `pnpm verify && pnpm e2e` PASS.
- [ ] **Step 5:** commit `feat(ybc): press A and B on the board itself, A+B, running time and random numbers; a floating pin reads 0 with a warning instead of stopping`.

### Task B5: Ghi analog và servo

**Files:** `src/core/constructs/ybc.pins.ts`, IR/interpreter/compile, `src/core/run/ybc-pin-io.ts`, linh kiện servo mới (`src/core/devices/definitions/servo.json` + renderer canvas: cánh tay quay theo góc, có animation tôn trọng reduced-motion), LED nhận độ sáng từ PWM, `ybc-basic.json`/`ybc-advanced.json` palette, codegen + golden, i18n, test.

**Produces:**
- Block:
  - `ybc_pin_write_analog` (P0–P2, 0–1023);
  - `ybc_servo_write` (P0–P2, 0–180°).
- Servo nối chân tín hiệu vào P0–P2, nguồn 3V3/GND như LED.
- LED nối qua điện trở vào chân PWM sáng theo tỉ lệ (0 tắt, 1023 sáng nhất).

- [ ] **Step 1:** test fail.
  - PWM đặt độ sáng LED trên net;
  - servo nhận góc;
  - Stop đưa servo về 90°;
  - giá trị ngoài khoảng bị kẹp kèm cảnh báo;
  - golden `pin0.write_analog(512)`, `pin1.servo_write(90)`.
- [ ] **Step 2:** chạy, thấy fail.
- [ ] **Step 3:** code.
- [ ] **Step 4:** `pnpm verify && pnpm e2e` PASS.
- [ ] **Step 5:** commit `feat(ybc): analog writes dim an LED and a servo turns on P0–P2`.

### Task B6: Cơ bản / Nâng cao, template mới, tài liệu, e2e

**Files:** `src/core/profiles/{ybc-basic.json, ybc-advanced.json}`, `src/core/program/block-packs.ts`, `src/samples/{ybc-templates.ts, ybc-solutions.ts, challenges.ts}`, `docs/yolobit-compatibility-contract.md`, `docs/stem-demo-demo-script.md`, `docs/lab-embed-contract.md` (template key mới), `e2e/ybc-full-board.spec.ts`, test.

**Hồ sơ:**
- **Cơ bản** = các block hiện có, cộng `set_pixel`/`set_all` màu, hình có sẵn và ngẫu nhiên.
- **Nâng cao** = Cơ bản, cộng nhiệt độ, gia tốc/cử chỉ, giai điệu, tần số, dừng, A+B, thời gian chạy, ghi analog, servo, cùng palette có servo.
- Bỏ `variableTypes: ["int","str"]` chưa dùng, hoặc ghi rõ là chưa dùng; không hứa điều không có.

**Template mới (key cố định, có mục tiêu và lời giải):**
- `ybc-rainbow`: bấm A thì cả ma trận đổi màu; goal: màu khác nhau sau hai lần A.
- `ybc-thermometer`: hiện số nhiệt độ khi bấm B; goal: kịch bản nhiệt độ 30 thì chữ chạy có "30".
- `ybc-dice`: lắc thì hiện số ngẫu nhiên 1–6; goal: sau khi lắc, ma trận khác trống. Kiểm tra dùng seed.
- `ybc-servo-gate`: ánh sáng < 30 thì servo 0°, ngược lại 90°; goal theo kịch bản ánh sáng.

**Tài liệu:**
- contract: bảng mọi dạng code mới, VERIFIED/UNVERIFIED;
- demo script: 3 phút demo bo mạch cho Sở GD&ĐT;
- `lab-embed-contract.md`: template key mới.

- [ ] **Step 1:** test fail.
  - hồ sơ: block nào có ở mức nào;
  - template mới mở được ở cả embed;
  - lời giải đạt mọi goal (`challenges.test.ts`);
  - project cũ chạy như trước (Review Focus 5);
  - tab ẩn không đạt giả (Review Focus 4);
  - e2e: mở `?embed=1&lab=yolobit&template=ybc-rainbow&profile=ybc-advanced`, chạy lời giải, Kiểm tra đạt; bấm A trên hình bo mạch.
- [ ] **Step 2:** chạy, thấy fail.
- [ ] **Step 3:** code và tài liệu.
- [ ] **Step 4:** `pnpm verify && pnpm e2e` PASS; ghi số test.
- [ ] **Step 5:** commit `feat(ybc): Basic and Advanced boards differ, four new graded labs (rainbow, thermometer, dice, servo gate), contract and demo script`.

### Task B7 (repo STEMLearning, sau N16): LMS biết board mới

**Files:**
- `Services/CourseService/Features/Activities/LabTemplateCatalog.cs` (+ test): template key mới, có mục tiêu.
- `Web/packages/api/src/lab/lab-templates.ts` (+ test).
- `Web/packages/activities/src/renderers/lab/{LabFrame.tsx, YolobitBoardHint.tsx}`: iframe `allow="clipboard-write"`; gợi ý liệt kê đủ chức năng.
- `Web/packages/i18n/messages/vi/{player.json, admin.json}`: tên template, chữ mức Nâng cao đúng thực tế.
- Template dropdown trong admin `LabEditor.tsx`.

Commit: `feat(lab): the LMS offers the new Yolo:Bit labs and the Advanced board's real abilities; Copy works inside the lab`.
