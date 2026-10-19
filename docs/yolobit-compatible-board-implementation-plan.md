# Yolo:Bit-compatible Board — Implementation Plan

> **Phiên bản:** 0.4 (DRAFT, sau re-check lần 3) · **Ngày:** 2026-10-14 · **Trạng thái:** chờ **cùng reviewer** re-check cuối → freeze. Chưa dùng làm căn cứ implement cho tới khi freeze.
> **v0.2** đóng F1–F9 của review lần 1 (verdict *CHANGES REQUIRED*; kiến trúc được chấp nhận). **v0.3** đóng phần còn mở sau re-check: F3 (IR generic/typed, image, hàm), F6 (template `empty`, hạ profile, các tầng hợp lệ), N1 (acceptance theo phase), N2 (thẩm quyền quyết định display). **v0.4** đóng nốt N1: chuyển quyền sở hữu test hạ profile (YB-1 dùng fixture test-only; YB-6 chỉ dùng capability đã có; round-trip thật ở YB-7). Truy vết ở §0.1.
> **Cập nhật YB-0 (2026-10-14, contract 1.0-draft r3):** cập nhật theo `docs/yolobit-compatibility-contract.md`, không đổi kiến trúc.
> - Các mục đổi: §3 (Q5, Q6), §6.4, §6.5, §6.7, §7.3, §7.4, §10, §11.3, §13.9, §14, §15, §18.3, §18.4, §18.7, YB-1, YB-2, YB-3, YB-4, YB-7, §22, §24, §25.
> - r2 sửa review YB-0 (R1–R3, N1–N3). RV-1 = **ACCEPT WITH RESTRICTIONS**.
> - **Owner decisions áp dụng (2026-10-14):** **OQ-E APPROVED** (model display cuối); **C-Q6 = Option A** (analog native 0–4095, UI 0–100 %, không chuẩn hoá về 0–1023, PWM EXCLUDED). Không còn quyết định YB-0 nào đang chờ. **N17 B5 (owner, 2026-10-19):** PWM (C-26, `write_analog` 0..1023) và servo (C-27) mở ở Advanced, ngoài khoảng thì kẹp + cảnh báo, `pinOutputs` mang duty / góc servo, LED ngoài sáng theo duty, linh kiện `servo`; chi tiết contract §27. Chờ cùng reviewer final freeze check.
> **Repo:** `stem-demo` @ `4f9f249` (branch `poc-14-local-persistence`). Mô tả hiện trạng đọc từ source ở commit đó.
> **Input:** `docs/ohstem-yolobit-simulator-investigation.md` (finding; owner decisions ở §0, §18). **Không thay thế** `docs/stem-demo-implementation-plan.md`, vốn là lịch sử của PoC đã xong; boundary B1–B8 và working agreement §15 của nó **vẫn có hiệu lực**, trừ chỗ tài liệu này ghi khác.
> **Ngôn ngữ:** tài liệu tiếng Việt, giữ thuật ngữ tiếng Anh; UI, identifier, comment trong code tiếng Anh (CLAUDE.md).

---

## 0. Status / source of truth

| Hạng mục | Nguồn sự thật |
|---|---|
| Quyết định sản phẩm | §3 (sao từ investigation §0, §18). Chỉ owner được đổi |
| Kiến trúc, phase, contract nội bộ (schema, IR, capability, generator, giới hạn) | Tài liệu này, sau khi freeze |
| **API Python Yolo:Bit và ngữ nghĩa quan sát được** (dạng gọi, import, đơn vị, thang, mặc định, timing, lỗi, toạ độ, event, nội dung asset) | `docs/yolobit-compatibility-contract.md` (tạo ở YB-0) và bản **máy đọc được** `src/core/compat/yolobit-contract.ts` (tạo ở YB-1 từ contract đã freeze). Bảng §7.3 ở đây chỉ là bản tạm |
| Hành vi đã ship | Test (unit, golden, fixture, E2E) |

### 0.1 Review log (v0.1 → v0.2)

| Finding | Mức | Đóng bằng |
|---|---|---|
| F1 — UNKNOWN vẫn qua được gate | High | §6.2 **Exposure eligibility gate (EG)**; bỏ "known deviation hành vi" và "lựa chọn an toàn"; §7.2 field bắt buộc; §7.6; §6.9; acceptance từng phase; test EG tự động (§18.1) |
| F2 — Event/concurrency chưa định nghĩa | High | §6.6 **Event execution contract** EV1–EV10 + gate: không đủ evidence thì **hoãn event block**; test bắt buộc §18.6; YB-7 có điều kiện |
| F3 — Domain ngôn ngữ chưa chốt | High | §6.4 **Supported language domain** (chỉ số nguyên, kiểu tĩnh, `//`/`%`, không `/`, không float) + bảng enforcement 4 điểm; §6.5 **range: chỉ đếm lên** (Option B, block riêng); bỏ "float + cảnh báo" |
| F4 — Thiếu giới hạn tài nguyên | High | §6.7 **Resource-safety contract** (hằng số có lý do, kiểm *trước* thao tác tốn kém, diagnostic); test Stop/flood/tăng trưởng mũ §18.5 |
| F5 — Syntax check tuỳ chọn | Medium (chặn L2) | §6.9 L2 **bắt buộc** syntax check, thiếu công cụ ⇒ **L2 = PENDING**; §13.9 chiến lược thực thi được trước khi nghiệm thu YB-5A; tập con cú pháp của generator |
| F6 — Board/profile khi sửa chưa định nghĩa | Medium (chặn YB-1) | §8.5 **Board context resolution** R-F1…R-F11, dùng chung cho load, persistence, palette, toolbox, Run, generation, template, xoá/thay board; acceptance YB-1 |
| F7 — Asset/nội dung bị coi là tương đương | Medium | §6.8 **Asset parity triad**; ưu tiên hình/nhạc tự sinh có evidence; font/chạy chữ theo metric; §7.6 |
| F8 — `HardwareIO` nguyên khối | Medium | §10 **capability composition**; dịch vụ runtime tách riêng; kiểm capability lúc compile |
| F9 — Thiếu checkpoint trước YB-3 ∥ YB-4 | Low | Phase **YB-CP** (§21) + quyền sở hữu file dùng chung |

**Re-check lần 2 (v0.2 → v0.3).** Reviewer xác nhận F1, F2, F4, F5, F7, F8, F9 đã CLOSED; không mở lại. Còn mở:

| Finding | Đóng bằng |
|---|---|
| F3-A — `image` nằm ngoài hệ kiểu `int\|bool\|str` | §9.1: hình/giai điệu là **operand của capability** (`OpOperand`), lấy từ field của block, **không phải `Expr`**, không có kiểu giá trị. Hệ kiểu learner giữ `int\|bool\|str` |
| F3-B — IR generic bị ép sang dạng typed | §9.0: **hai dialect**. *Legacy generic IR* (`ProgramIR` hôm nay, không đổi, không có `type`) và *YBC IR v1* (`YbcProgramIR`, typed). Compiler, interpreter và entry point tách riêng; RunSession chọn theo family. Test GB11 |
| F3-C — Hàm MUST nhưng thiếu contract | §6.10: **gate FN** (FN1–FN10): procedure ≠ function; tham số `int\|str` kiểu tĩnh; không biến cục bộ ngoài tham số; function trả về đúng một lần ở cuối; không early return; không đệ quy; không `None` ngầm. Là **điều kiện trước của YB-7** |
| F6-A — Template `empty` (0 board) | §8.6: tách **tầng hợp lệ**. Template **generic** chỉ cần mở được (như hôm nay); chỉ template bài học `ybc-*` cần runtime-ready/generator-ready. Bảng kỳ vọng theo từng template |
| F6-B — Hạ profile làm document không mở được | §8.5 R-F9, R-F11 + §12: kiểm lúc load là **cấu trúc** (Blockly với **hợp mọi pack**), không theo profile. Hạ Advanced → Basic: lưu/reload mở được, block giữ, Run/Python bị chặn `not-in-profile`. Có ca nghiệm thu |
| F6-C — Các tầng hợp lệ bị gộp | §8.6: **L-1 loadable → L-2 profile-compatible → L-3 runtime-ready → L-4 generator-ready**, cùng một resolver/diagnostic |
| N1 — Acceptance đòi tính năng của phase sau | §21: YB-1 không có Python; YB-2 không có golden; YB-5A gánh generator/golden/syntax/allowlist. Bảng test/fixture có cột "bắt buộc từ phase" (§8.5, §18) |
| N2 — Ghi sai thẩm quyền về display | §3 Q5, §7.4, §25, investigation: **owner** duyệt nguyên tắc "tương thích > 8×8 tạm". **Model display logic cuối** cần owner xác nhận **sau** evidence YB-0, **trước** khi implement capability display (OQ-E). Khuyến nghị của reviewer chỉ là input kỹ thuật |

**Re-check lần 3 (v0.3 → v0.4).** Reviewer xác nhận F1–F9 và N2 CLOSED; kiến trúc, YB-0 và tương thích ngược PASS; không có finding mới. Còn mở:

| Finding | Đóng bằng |
|---|---|
| N1 (phần còn lại) — YB-1 và YB-6 đòi construct Advanced thật, vốn chỉ có ở YB-7 | **YB-1** chỉ test **cơ chế** profile/resolver bằng **fixture test-only** (§8.7). **YB-6** test UI chọn profile thật, nhưng chỉ với capability **đã có** tới phase đó. **YB-7** sở hữu **round-trip hạ profile đầy đủ** với construct Advanced thật (17 bước, §8.6). Cập nhật §8.5, §8.6, §18.1, YB-1, YB-6, YB-7 |

### 0.2 Working agreement

Thừa kế PoC plan §15:
1. Evidence thắng plan: thấy sai thì sửa plan/contract **trong cùng change**.
2. Một phase/sub-task = một branch + một PR, review độc lập.
3. Không làm sẵn hạng mục bị hoãn.

Luật riêng của track này:

| ID | Luật |
|---|---|
| R1 | Construct nào cũng phải đủ bốn lớp (block → IR → simulator → Python) và có test ở mọi lớp. Áp dụng từ YB-5A |
| R2 | Generator chỉ sinh API nằm trong contract (test allowlist, §13.9) |
| R3 | Không dùng nội dung độc quyền của OhStem: source firmware, block/generator JS, hình, model, icon, giai điệu, font, layout. Evidence chỉ gồm output Python của UI public **từ program của mình**, cộng tài liệu public (§7.1) |
| **R4** | **Exposure eligibility gate (EG, §6.2):** construct chỉ được nhìn thấy khi **mọi** field quan sát được mà nó cần đều VERIFIED hoặc DOCUMENTED |
| **R5** | Domain được enforce ở compiler + IR invariant + interpreter + generator (§6.4). Dữ liệu load từ ngoài không lách được |
| **R6** | Giới hạn tài nguyên là **hằng số có tên**, có test, và báo cho learner bằng diagnostic (§6.7) |

**Trước mỗi phase, đọc:** §0, §3, §4, §6, phase tương ứng ở §21, các contract mà phase trỏ tới, và contract YB-0 (từ YB-1 trở đi).

---

## 1. Goals

| ID | Mục tiêu |
|---|---|
| G1 | Thêm **board family tương thích Yolo:Bit** (`ybc-board`) **song song** với `board` generic; generic không đổi |
| G2 | Hai **curriculum profile**, `ybc-basic` và `ybc-advanced` (⊇ basic): một board, một IR, một engine, một generator |
| G3 | **Generator `IR → Yolo:Bit MicroPython`** là subsystem chính thức: deterministic, golden, cú pháp được kiểm, chỉ dùng API trong contract |
| G4 | Trong **supported domain** (§6.4, §6.7), simulator tái tạo đúng hành vi mà learner quan sát được của mọi construct đã qua EG |
| G5 | Giáo trình Basic (onboard trước, header sau) và Advanced mở được trong STEMLearning bằng template key, **không đổi** contract nhúng |
| G6 | Tuyên bố tương thích theo L1/L2/L3 (§6.9), có gate kiểm chứng cho từng mức |

## 2. Non-goals

- Python sửa được; Python/MicroPython runtime trong browser.
- Transport Web Serial/Bluetooth.
- Giả lập MCU/firmware; mô phỏng điện.
- Tái tạo firmware Yolo:Bit; clone UI hay thương hiệu OhStem.
- **Trong milestone này:**
  - số thực (`float`, phép `/`, `round`, hàm lượng giác);
  - vòng đếm xuống;
  - biến kiểu text ở Basic;
  - list (trừ khi YB-7 đủ điều kiện, NICE);
  - **event block, nếu gate EV không đạt** (§6.6).
- `postMessage`/chấm bài/completion mới; lưu bài làm trong lab nhúng. *(N6a, 2026-10-16: đã làm ngoài plan này, theo plan redesign STEMLearning §7: `stem-lab/v1`, Kiểm tra, `load-project`/`project-changed`; lab vẫn không lưu gì. Xem docs/lab-embed-contract.md và stem-demo plan §9.2 N6a.)*
- Viết lại i18n; layout mobile đầy đủ. *(N6a: lab `lab=` nói tiếng Việt qua từ điển UI; standalone giữ tiếng Anh. N8s: cả thông báo của core và nhãn bo mạch; lab `lab=` dưới 800 px dùng tab Chương trình / Mạch — chưa phải layout mobile đầy đủ.)*
- Bluetooth, Wi-Fi, MQTT, radio, IoT; module cần thư viện ngoài firmware chuẩn.
- Robot simulator.
- Thay đổi `board` generic, block `stem_*`, toolbox/palette generic, năm template cũ.

---

## 3. Owner decisions (frozen 2026-10-13)

| ID | Quyết định |
|---|---|
| D1 | Track Yolo:Bit: program Blockly xuất ra được **MicroPython Yolo:Bit thật** cho board vật lý. Không có ngôn ngữ riêng chỉ chạy trong STEMLearning |
| D2 | `Blockly → IR → { simulator ; Yolo:Bit MicroPython generator → .py → Yolo:Bit }` |
| D3 | Giữ `board` generic, năm template cũ, contract nhúng |
| D4 | Một board family tương thích Yolo:Bit; Basic/Advanced là curriculum profile |
| D5 | Runtime duy nhất là interpreter IR. Không Pyodide/MicroPython-WASM, không giả lập MCU |
| D6 | Generator MicroPython = MUST. Python sửa được, runtime Python trong browser, upload = Later |
| D7 | YB-0 bắt buộc trước khi chốt contract |
| D8 | Ba mức tuyên bố. Khi chưa có phần cứng, mạnh nhất là *"Yolo:Bit MicroPython code-generation compatible; physical-board verification pending."* |
| D9 | Compatibility target ≠ branding/artwork |
| Q1 | Không tích hợp board vật lý trong MVP; code vẫn nhắm Yolo:Bit MicroPython từ đầu |
| Q2 | Basic: THCS (~lớp 6–9), cũng là lộ trình nhập môn; Advanced: cuối THCS → THPT. Basic: onboard trước rồi header |
| Q3 | Block chính; Python sinh ra MUST; Python sửa được Later; runtime Python browser Later |
| Q4 | Giữ `board`; board tương thích Yolo:Bit nằm song song; tương thích ngược bắt buộc |
| Q5 | *Gốc (2026-10-13):* ma trận ảo 8×8 một màu trước, RGB sau, nhưng phải tách display ảo khỏi API Yolo:Bit nếu khác kích thước.<br>**Owner decision (2026-10-14):** tương thích ngữ nghĩa với Yolo:Bit **ưu tiên hơn** ưu tiên tạm 8×8.<br>**Ưu tiên tạm:** 8×8 **không** được freeze.<br>**Nghĩa vụ YB-0:** xác lập ngữ nghĩa display logic thật của Yolo:Bit.<br>**Freeze checkpoint:** sau evidence YB-0, trình **owner xác nhận lần cuối** model display logic **trước khi** implement capability display liên quan (OQ-E, §7.4). Khuyến nghị của reviewer là input kỹ thuật, **không** phải thẩm quyền thay owner. Artwork quanh display vẫn là của mình.<br>**Owner xác nhận cuối (OQ-E APPROVED, 2026-10-14):** display logic = **5×5 RGB**, toạ độ **0-based**, gốc **trên-trái**, `x` = cột, `y` = hàng, màu **hex** (`'#rrggbb'`), mặc định **đỏ** (contract §4.3) |
| Q6 | *Gốc (2026-10-13):* chân analog 0–1023; UI cảm biến onboard 0–100 %; chuyển đổi tường minh (investigation §18.2, §11.3).<br>**Owner decision (C-Q6 = Option A, 2026-10-14):** analog read dùng **thang native 0–4095** (tài liệu OhStem, contract §10); UI vẫn **0–100 %**; **không** chuẩn hoá về 0–1023; chuyển đổi tường minh `percentToNative(p, 4095)` (§11.3). **PWM/analog write vẫn EXCLUDED** |
| Q7 | Không làm completion/chấm bài; giữ `OnView` |
| Q8 | UI tiếng Anh; không cản i18n |
| Q9 | WebAudio, mặc định tắt khi nhúng; luôn có trạng thái hình ảnh |
| Q10 | Lab nhúng không lưu; standalone giữ nguyên |

---

## 4. Current-state constraints (VERIFIED từ source @ `4f9f249`)

| # | Hiện trạng | File | Hệ quả |
|---|---|---|---|
| S1 | Composition root hard-code một board: `registry.get('board')` → `boardPins` cho Blockly và `canOpenProgram` | `src/main.tsx` | YB-1 thay bằng board context resolution (§8.5) |
| S2 | `registerBlocks` chạy **một lần** (cờ module), dropdown chân lấy từ `boardPins` đầu tiên | `src/ui/blockly/editor-blocks.ts` | Mỗi family có block type riêng; đăng ký hợp mọi pack một lần (§12) |
| S3 | Preflight `isBoundedForBlockly` chỉ cho `extraState` trên `controls_if` (tổng else-if ≤ 1000) | `src/ui/blockly/editor-blocks.ts` | Mutator mới cần allowlist **có ngân sách** (§12) |
| S4 | `RunSession.start`: board = component có `definition.board`; đòi đúng 1; compile với tên chân của board | `src/core/run/run-session.ts` | Thay bằng §8.5; generic giữ nguyên kết quả |
| S5 | `HardwareIO = { digitalWrite, digitalRead }`; interpreter main thread; `forever` nhường 10 ms; Stop bằng `AbortSignal`; test tự dựng `HardwareIO` | `src/core/program/interpreter.ts`, `interpreter.test.ts` | Tách theo capability (§10); kiểu cũ trở thành `DigitalIO`, test double cũ vẫn hợp lệ |
| S6 | Compiler là `switch` theo type; `compileProgram(blocksJson, boardPins)` được gọi ở nhiều test | `src/core/program/compile-program.ts`, `*.test.ts` | Compiler legacy **không đổi** (§9.0); compiler YBC mới dùng bảng construct (§9.4). Test hiện có vẫn gọi đúng chữ ký cũ |
| S7 | Simulation 4 mức logic; `pinOutputs: Record<pin, 0\|1>`; `contacts` | `src/core/simulation/simulate-circuit.ts` | Signal-level cộng thêm; kết quả generic không đổi (§16) |
| S8 | Canvas: thao tác "giữ" gắn với model `contact` | `src/ui/canvas/CircuitCanvas.tsx` | Runtime control theo khai báo `control` (§11.3) |
| S9 | Board generic dùng `GenericRenderer` | `src/ui/canvas/renderers.ts` | `ybc-board` có renderer riêng |
| S10 | Document: `schemaVersion: 1`, `z.object` (Zod 4 **bỏ** key lạ khi parse) | `src/core/circuit/document.ts` | `profile` phải khai báo trong schema; tuỳ chọn → không tăng version |
| S11 | Template key là public contract, so khớp chính xác; lab nhúng không chạm IndexedDB | `src/samples/templates.ts`, `src/ui/app/startup.ts` | Chỉ thêm key |
| S12 | STEMLearning iframe: `sandbox="allow-scripts allow-same-origin"`, `allow` không có clipboard; khung 1100×640 có scale | `STEMLearning/Web/StudentWeb/src/features/courses/activities.tsx` | Download/clipboard có thể bị chặn (§17.3) |
| S13 | Chưa có Python, Monaco, worker, WebAudio, công cụ kiểm cú pháp Python; COOP/COEP `require-corp` ở dev/preview | `package.json`, `vite.config.ts` | Python panel `<pre>`; syntax check cần công cụ ngoài npm (§13.9, OQ-B) |
| S14 | Baseline: `pnpm verify` xanh (339 unit test / 26 file), 10 spec E2E | — | Giữ xanh |
| **S15** | **Palette liệt kê mọi device trong registry** (`paletteItems(registry)`) | `src/ui/canvas/palette-model.ts` | Thêm `ybc-board` vào catalog sẽ lộ ra palette generic → palette phải lọc theo family (§8.5) |
| **S16** | Khi sửa, mạch được phép có 0, 1 hay nhiều board; chỉ Run mới từ chối (`no-board`, `multiple-boards`); document lưu được ở mọi trạng thái đó | `src/ui/app/App.tsx`, `run-session.ts`, `project-repository.ts` | Giữ nguyên các trạng thái sửa này cho document generic (§8.5) |

---

## 5. Product model

### 5.1 Ba khái niệm

```text
┌──────────────────────────┐     ┌────────────────────────────────────────────────────────┐
│ Generic project          │     │ YBC project  (document.profile = ybc-basic|ybc-advanced) │
│ (document không profile) │     │  board "ybc-board": display/nút/cảm biến/buzzer/chân     │
│ device "board" D2–D13    │     │  theo model logic mà YB-0 xác lập; artwork của mình      │
│ block stem_*, toolbox cũ │     │  code target: Yolo:Bit MicroPython                       │
│ palette cũ; không gen    │     │  ├── profile ybc-basic                                   │
│ 5 template cũ            │     │  └── profile ybc-advanced (⊇ basic)                      │
└──────────────────────────┘     └────────────────────────────────────────────────────────┘
   dùng chung: document, canvas, netlist, RunSession, interpreter, Blockly panel, persistence
```

**Family của project được xác định bởi `document.profile`**, không bởi việc có board hay không (§8.5, R-F1).

### 5.2 Compatibility target ≠ branding (D9)

| Khía cạnh | Quyết định |
|---|---|
| Compatibility target | Yolo:Bit MicroPython, theo contract YB-0 (có ghi firmware/snapshot, §7.7) |
| Tên hiển thị của board | Của mình; owner chọn trước YB-6 (OQ-A). Tên làm việc `"STEM Bit Board"` không được ship |
| Artwork | Vẽ mới (Konva). **Display logic** (kích thước, toạ độ, màu) là ngữ nghĩa theo contract, không phải artwork |
| Id nội bộ | device `ybc-board`; profile `ybc-basic`/`ybc-advanced`; block prefix `ybc_`; target `yolobit-micropython`; template prefix `ybc-` |
| Text về tương thích | Chỉ dùng câu đúng mức đã đạt (§6.9) |

### 5.3 Bốn lớp tách bạch

| Lớp | Trạng thái |
|---|---|
| Simulator runtime (interpreter IR + simulation) | Milestone này |
| Code generator (IR → `.py`) | Milestone này, **MUST** |
| Physical transport (Serial/BLE) | Later |
| Editable Python + runtime Python trong browser | Later (nếu làm: cùng contract, cùng capability) |

---

## 6. Compatibility contract

### 6.1 Bốn lớp của một construct

```text
Block (Blockly JSON) ──compile──► IR node                 [compiler test]
IR node              ──run──────► simulator behaviour      [interpreter / fixture trace test]
IR node              ──emit─────► Yolo:Bit Python          [generator golden + syntax + allowlist]
simulator behaviour  ≡ (trong supported domain) hành vi Python trên Yolo:Bit, theo các field đã có evidence ở contract
```

Mỗi construct có đúng một **construct spec** (§9.4). Spec trỏ tới đúng một dòng contract (`contractId`).

### 6.2 Exposure eligibility gate (EG) — đóng F1

**Luật (frozen):** một thao tác mà learner nhìn thấy (block, biến thể block, lựa chọn trong dropdown, tham số, template) chỉ được **mở** cho profile `ybc-*` khi **mọi field quan sát được** trong danh sách bên dưới mà construct đó cần đều có nhãn **VERIFIED** hoặc **DOCUMENTED**, và đủ chính xác để định nghĩa **cả** hành vi simulator **lẫn** code sinh ra.

**Field quan sát được (OF):**

| Field | Ý nghĩa |
|---|---|
| `OF-call` | dạng gọi Python: tên, đối số, thứ tự, keyword |
| `OF-import` | import và preamble cần có |
| `OF-module` | module có trong firmware đích |
| `OF-unit` | đơn vị (ms, Hz, °C, …) |
| `OF-range` | khoảng giá trị hợp lệ của đối số và giá trị trả về |
| `OF-default` | giá trị mặc định của tham số **không truyền** (nếu generator không truyền tường minh) |
| `OF-clamp` | hành vi khi ngoài khoảng (chặn/lỗi/bỏ qua) |
| `OF-round` | quy tắc làm tròn |
| `OF-block` | có chặn không, chặn bao lâu |
| `OF-yield` | trong lúc chặn, cái gì còn chạy (event, âm thanh…) |
| `OF-return` | ngữ nghĩa giá trị trả về (vd. "nút đang được giữ ngay lúc gọi") |
| `OF-error` | thao tác ném lỗi khi nào |
| `OF-coord` | quy ước toạ độ: gốc, trục, chỉ số 0/1 |
| `OF-event` | ngữ nghĩa callback/event (§6.6) |
| `OF-content` | nội dung mà một identifier đại diện: điểm ảnh, nốt, metric chữ (§6.8) |

Mỗi dòng contract ghi rõ field nào **relevant** cho construct (field không liên quan ghi `n/a` kèm lý do). **INFERRED tính như UNKNOWN** khi xét EG.

**Nếu một field cần thiết vẫn UNKNOWN**, chỉ có hai lựa chọn:
1. **Loại** construct khỏi toolbox, template và tập block mà compiler chấp nhận (load từ dữ liệu → lỗi compile `not-eligible`); hoặc
2. **Thu hẹp** về một tập con có evidence. Ví dụ:
   - chỉ cho giá trị literal trong một khoảng đã DOCUMENTED;
   - generator **luôn truyền tường minh** tham số có tài liệu, để không phụ thuộc mặc định chưa rõ (*explicit-parameter strategy*);
   - bỏ một biến thể dropdown.

**Không có lựa chọn thứ ba.** Không có "hành vi an toàn do simulator chọn" cho một capability xuất ra Yolo:Bit.

**Áp dụng cho:** MUST, NICE và Advanced, **trước mỗi lần mở** (mỗi phase). Tier ở §14–§15 chỉ là **ý định giáo trình**; được mở hay không là do EG quyết định.

**Construct thuần ngôn ngữ** (biến, số nguyên, so sánh, vòng lặp…) được định nghĩa hoàn toàn bởi code Python mà generator sinh ra cộng ngữ nghĩa ngôn ngữ của MicroPython. Field của chúng đạt **DOCUMENTED** khi:
- tài liệu ngôn ngữ MicroPython mô tả hành vi đó cho **tập con domain §6.4**; và
- YB-0 đã ghi phiên bản/tính năng MicroPython của firmware đích (§7.7).

**Hai thứ không phải "field quan sát được"** (không đưa vào contract, không tuyên bố):
- **tốc độ thực thi** của statement không chặn: trên board nó cũng không xác định; simulator có thể nhường thêm để giữ UI phản hồi (§6.7);
- **trình bày**, tức field đánh dấu `presentation`: hình glyph, màu trên màn hình máy tính, âm sắc, âm lượng.

Mọi khác biệt **hành vi** đều là lỗi gate, không phải "known deviation".

**Domain guard (frozen):** khi một giá trị lúc chạy ra khỏi supported domain (§6.4) hoặc vượt giới hạn (§6.7), simulator **dừng program** với diagnostic `out-of-domain` hoặc `limit-exceeded` có `blockId`. Lần chạy đó **không có tuyên bố tương thích nào**, và code sinh ra không đổi. Đây là **từ chối mô phỏng**, không phải đoán hành vi.

**Enforcement:**
- **contract máy đọc được** (`src/core/compat/yolobit-contract.ts`), mỗi field có nhãn;
- **test EG**: mọi block trong toolbox của mọi profile, mọi block trong mọi template `ybc-*`, mọi block mà compiler chấp nhận cho `ybc-*` → construct → dòng contract → mọi field relevant ∈ {VERIFIED, DOCUMENTED}.

### 6.3 Learner-observable semantics

| Phải khớp (hành vi) | Trình bày (không thuộc contract; field `presentation`) |
|---|---|
| Nội dung display theo thời gian (điểm nào sáng, màu logic, thứ tự frame) | Hình glyph, đường cong độ sáng, màu thật của LED so với màn hình |
| Thời lượng các thao tác **chặn** (`OF-block`) | Độ trễ render (≤ 1 frame) |
| Âm thanh: tần số, bắt đầu/kết thúc | Âm sắc, âm lượng |
| Giá trị trả về của input theo thang contract | Cách thao tác input ảo |
| Output `print` (text, xuống dòng) | Font console |
| Có lỗi hay không và tại statement nào (lỗi Python có DOCUMENTED) | Câu chữ thông báo lỗi; trạng thái phần cứng **sau** lỗi (ngoài domain) |
| Thứ tự quan sát được của event và biến dùng chung (§6.6) | — |

### 6.4 Supported language domain — đóng F3

**Một câu trả lời duy nhất cho số thực:** milestone này **không có số thực** ở **cả hai** profile. Literal không nguyên, phép `/`, `round`, `math_single`, lượng giác, `math_random_float` đều **bị từ chối** ở compiler (`float-not-supported` / `not-in-profile`). Generator **không bao giờ** nhận float; nếu nhận được (vi phạm invariant) thì trả `unsupported-on-target`.

| Chủ đề | Domain (frozen) |
|---|---|
| Kiểu giá trị | `int`, `bool`, `str`. Không `float`, `None`, list (list: Advanced NICE, chỉ khi có contract riêng). **Hình hiển thị và giai điệu không phải giá trị**: chúng là operand của capability (§9.1), lấy từ field của block, không gán vào biến, không so sánh, không in, không truyền vào hàm. Có thêm kiểu giá trị (vd. hình làm giá trị) thì cần contract mới (Later) |
| `None` | Không bao giờ là giá trị của learner (biến, biểu thức, giá trị trả về). Code sinh ra chỉ được chứa `None` khi nó là **một phần dạng gọi API của contract** (vd. dòng preamble `button_a.on_pressed = None`, nếu YB-0 yêu cầu) |
| Số nguyên | Phải là safe integer: `|n| ≤ 2^53 − 1`. Mọi literal và **mọi kết quả trung gian** được kiểm; ra ngoài → `out-of-domain`. Lý do: interpreter (JS) chỉ chính xác trong khoảng này; MicroPython có số nguyên lớn, nên chương trình vượt khoảng nằm ngoài domain chứ không bị coi là "khác" |
| Phép số học | `+`, `−`, `×` (block riêng `ybc_arith`, dropdown chỉ ADD/MINUS/MULTIPLY; `math_arithmetic` của Blockly không dùng); **chia lấy nguyên** `//` (block `ybc_int_divide`); **chia lấy dư** `%` (`math_modulo`). Không có DIVIDE, POWER |
| `//` và `%` | Floor semantics của Python: `-7 // 2 == -4`, `-7 % 3 == 2`, dấu của `%` theo số chia. Chia cho 0 → lỗi `ZeroDivisionError` (DOCUMENTED); simulator dừng với lỗi tại block đó |
| So sánh | `== !=` giữa hai toán hạng **cùng kiểu** (`int`/`int`, `str`/`str`, `bool`/`bool`); `< <= > >=` chỉ `int`/`int`. Khác kiểu → lỗi compile `type-mismatch` (kiểu luôn biết được lúc compile, xem dưới) |
| Toán tử logic | `and`, `or`, `not` chỉ trên `bool`; **short-circuit** như Python (vế phải không được đánh giá khi không cần, kể cả khi nó có side effect như đọc số lần nhấn, gọi hàm) |
| Giá trị chân lý | Điều kiện của `if`/`while` **phải** có kiểu `bool`; dùng `int`/`str` làm điều kiện → lỗi compile. Không dựa vào truthiness |
| Biến | **Basic:** chỉ `int`, khởi tạo `0` lúc bắt đầu. **Advanced:** mỗi biến có **một kiểu tĩnh** (`int` hoặc `str`), suy ra từ mọi phép gán. Gán kiểu khác → lỗi compile. Biến `str` khởi tạo `''`. Biến toàn cục (như Blockly) |
| Đổi sang text | `str(int)` thập phân, `str(bool)` → `True`/`False`, `str(str)` giữ nguyên. Nối chuỗi (`text_join`, ≤ 50 phần) đổi từng phần bằng `str()` |
| `print` | Một đối số; output là `str(value)` cộng `\n`. Kiểm giới hạn độ dài text (§6.7) |
| `wait` (ms) | `int` trong `[0, 60000]`. Literal ngoài khoảng → lỗi compile; giá trị động ngoài khoảng → `out-of-domain`. Mức trên là giới hạn của domain, không phải của board |
| Random | **EXCLUDED ở YB-0** (contract C-40): `OF-module` của `random.randint` trên firmware là INFERRED. Domain đặc tả sẵn, chỉ có hiệu lực khi construct được mở lại: `−MAX_RANDOM_ABS ≤ a ≤ b ≤ MAX_RANDOM_ABS` và `b − a ≤ MAX_RANDOM_SPAN`; đánh giá `a` rồi `b`; literal vi phạm → lỗi compile; động → `out-of-domain` |
| `repeat N` | `N` là `int`, **`abs(N) ≤ MAX_REPEAT_ABS`** (YB-0: đối số `range` phải nằm trong machine word, contract §3.2); `N ≤ 0` → 0 lần (Python `range`, DOCUMENTED). Biến đếm là tên nội bộ của generator, không trùng biến learner |
| `while` | Điều kiện `bool`; được đánh giá trước mỗi vòng |
| Vòng đếm | Xem §6.5 (chỉ đếm lên) |
| Tràn số | Kết quả trung gian nào ngoài safe integer → `out-of-domain` tại block gây ra |
| Kết hợp kiểu sai | Chặn ở compile (kiểu tĩnh); interpreter vẫn kiểm phòng thủ → `internal-error` (bug, không phải domain) |
| Text hiển thị trên display | Ký tự phải thuộc **charset của display** mà YB-0 xác lập. Literal ngoài charset → lỗi compile; text động ngoài charset → `out-of-domain`. Text cho `print` cho phép Unicode trừ ký tự điều khiển |

**Vì sao kiểu luôn biết được lúc compile:**
- literal có kiểu;
- phép toán có kiểu kết quả cố định;
- read (nút, cảm biến) có kiểu trong contract;
- biến có một kiểu tĩnh.

Vì vậy mọi kiểm kiểu là **tĩnh**, và runtime chỉ còn lỗi số học (chia 0, tràn) và lỗi domain.

**Điểm enforce (R5):**

| Luật | Compiler (Blockly JSON → IR) | IR invariant | Interpreter | Generator |
|---|---|---|---|---|
| Chỉ số nguyên, không float | Từ chối literal không nguyên, block float | `number.value` là safe int | Kiểm kết quả mỗi phép toán → `out-of-domain` | Assert; vi phạm → `unsupported-on-target` |
| Tập phép toán | Chỉ map op cho phép; còn lại `not-in-profile` | Enum op giới hạn | — | Chỉ emit enum đó |
| Kiểu tĩnh, điều kiện `bool` | Suy kiểu, `type-mismatch` | Mỗi `Expr` mang `type` | Kiểm phòng thủ → `internal-error` | Dựa vào `type` |
| `wait`, `repeat`, display charset | Kiểm literal | Node mang ràng buộc | Kiểm giá trị động → `out-of-domain` | Không đổi giá trị |
| Vòng đếm lên (§6.5) | Kiểm literal: `step` literal 1..`MAX_RANGE_VALUE`; cận literal 0..`MAX_RANGE_VALUE`; hai cận literal và `a > b` → lỗi | `countUp.step` là literal; domain đi theo node | Đánh giá `from` rồi `to`, mỗi cái **một lần**; kiểm từng cái ngay sau khi đánh giá (`out-of-domain`) | Cận không literal → biến tạm `_cu_start_k`, `_cu_end_k` theo đúng thứ tự (§6.5) |
| Đọc chân trên `ybc-board` | — | — | Net `floating` hoặc `conflict` → `out-of-domain` (§11.1) | — |
| Giới hạn tài nguyên | Kích thước program | — | §6.7 | Kích thước output |
| Profile/eligibility | `not-in-profile`, `not-eligible` | — | — | Kiểm lại construct thuộc target |

**Program load từ ngoài** (IndexedDB, template, hook test) **luôn đi qua cùng compiler**, nên biến thể bị ẩn khỏi toolbox vẫn bị từ chối lúc Run/generate. Ngoài ra `canOpenProgram` kiểm theo profile lúc load (§8.5).

### 6.5 Vòng đếm (range) — chọn Option B

**Quyết định:** chỉ hỗ trợ **đếm lên**, dùng block riêng `ybc_count_up` ("count up with *i* from *a* to *b* by *s*"). Block `controls_for` của Blockly **không** được dùng, vì nó tự đổi chiều theo `a`/`b` và bỏ dấu `s`, khác với ngữ nghĩa `range` của Python.

**Sửa sau review YB-0 (R1, R2; contract §3.3):**
- Thứ tự đánh giá được **generator tường minh hoá**, không dựa vào thứ tự đánh giá đối số của MicroPython.
- Domain là **API-specific, không âm, có quan hệ**. Domain số học chung (safe-int, §6.4) không đổi.

| Trường hợp | Ngữ nghĩa simulator | Python sinh ra |
|---|---|---|
| `s` | **Literal nguyên** trong `1..MAX_RANGE_VALUE` (lỗi compile nếu không) | — |
| Thứ tự đánh giá (frozen) | Đánh giá `a` **trước**, rồi `b`, **mỗi cái đúng một lần**, trước vòng lặp. Kiểm domain của `a` ngay sau khi đánh giá `a` (trước khi đánh giá `b`); của `b` ngay sau khi đánh giá `b` | Cả hai cận literal: `for i in range(a, b+1[, s]):` (hằng gập lúc generate). Ngược lại: `_cu_start_k = <a>` · `_cu_end_k = <b>` · `for i in range(_cu_start_k, _cu_end_k + 1[, s]):` (`k` = thứ tự node, tên tạm theo §13.5, không bao giờ vào `global`) |
| Domain cận | `0 ≤ a ≤ MAX_RANGE_VALUE`, `0 ≤ b ≤ MAX_RANGE_VALUE`. Literal ngoài → lỗi compile `value-out-of-range`; động ngoài → `out-of-domain` | — |
| `a ≤ b` | `i = a, a+s, …` cho tới giá trị lớn nhất ≤ `b` | như trên |
| `a == b` | đúng 1 vòng, `i = a` | như trên |
| `a > b`, cả hai là literal | **lỗi compile** `descending-range-not-supported` (gợi ý dùng `repeat` + biến) | — |
| `a > b` lúc chạy (cả hai trong domain) | 0 vòng; `i` giữ giá trị cũ (Python `range`, DOCUMENTED) | như trên |
| Sau vòng | `i` = giá trị của vòng cuối (hoặc giữ nguyên nếu 0 vòng) | khớp Python |
| Cận trung gian | `b + 1 ≤ 1 000 001`; giá trị kế tiếp `≤ 2 000 000`: mọi giá trị < 2^21, không wrap (contract §3.2) | — |

Count up âm: không hỗ trợ trong milestone. Bài đếm ngược ở Basic dùng `repeat` + biến (§14.2). Vòng đếm xuống: Later.

### 6.6 Event execution contract — đóng F2

**Gate EV (frozen):** **không có event block nào được ship** (Basic hay Advanced) cho tới khi **mọi field hành vi** EV1, EV2, EV4, EV5, EV6, EV7, EV9, EV10 có evidence VERIFIED/DOCUMENTED từ Yolo:Bit (YB-0, hoặc bổ sung trước YB-7), và mô hình ở dưới **được sửa cho khớp** evidence. Hai mục **EV3** (tràn hàng đợi) và **EV8** (Stop) là **guard phía simulator**, không tuyên bố hành vi board: EV3 là domain guard, EV8 không có tương đương trên board ngoài reset. Chúng vẫn bắt buộc phải cài đặt và test, nhưng không cần evidence. Nếu không đạt gate: **event block bị hoãn**, Advanced dùng các bài polling (§15).

Mô hình **ứng viên** dưới đây chỉ để biết cần kiểm gì. Nó **không phải** ngữ nghĩa đã chốt, và không được ship nếu thiếu evidence.

| ID | Field phải chốt | Mô hình ứng viên (cần evidence) |
|---|---|---|
| EV1 | **Điểm dispatch** | Handler chỉ bắt đầu khi task chính ở một điểm dispatch: đang `wait`/thao tác chặn; khoảng nghỉ 10 ms cuối `forever`; vòng chờ rảnh sau `onStart` khi không có `forever`. Không bao giờ giữa một statement/biểu thức. Lần nhường ngầm của execution budget (§6.7) **không phải** điểm dispatch |
| EV2 | **Hàng đợi** | Một hàng đợi toàn cục, FIFO theo thời điểm phát hiện; sức chứa `MAX_EVENT_QUEUE`; có coalesce event giống hệt đang chờ hay không: phải theo evidence |
| EV3 | **Tràn hàng đợi** | Event mới bị bỏ, console có diagnostic `event-queue-overflow`; lần chạy đó **ngoài domain** (không tuyên bố) |
| EV4 | **Reentrancy** | Mỗi lúc chỉ một handler. Một handler không bao giờ chồng lên chính nó. Handler khác không chồng lên. Trong lúc handler đang `wait`, task chính và handler khác **không chạy** (handler chiếm task chính cho tới khi xong) |
| EV5 | **Biến dùng chung** | Chỉ một luồng chạy tại một thời điểm và chỉ đổi ở điểm dispatch, nên thứ tự quan sát được = thứ tự dispatch; mọi phép gán thấy ngay |
| EV6 | **Vòng đời** | Program có handler mà không có `forever`: tiếp tục "nghe" sau `onStart` tới khi Stop. Generator **thêm vòng chờ rảnh** `while True: time.sleep_ms(10)` cuối file, để vòng đời trên board cũng được xác định bởi chính code |
| EV7 | **Lỗi trong handler** | Theo evidence: hoặc dừng toàn program (status `error`, `blockId`, xoá hàng đợi), hoặc ghi lỗi rồi tiếp tục. Khác evidence → không ship |
| EV8 | **Stop** | Huỷ handler đang chạy, các `wait` của nó, hàng đợi, mọi dispatch sau này, và việc phát hiện input. Sau Stop không còn output |
| EV9 | **Starvation** | Handler dài làm trễ task chính và event khác (bị chặn bởi EV2/EV3). Task chính không có điểm dispatch (vòng chặt không `wait`) thì handler không chạy; điều này được ghi rõ |
| EV10 | **Phát hiện event** | Nút: cạnh lên của trạng thái giữ (runtime input). Nhấn và thả trước khi dispatch vẫn tính. Input lúc không chạy bị bỏ qua. Lắc: theo `OF-event` của contract |

Test bắt buộc trước khi ship event: §18.6.

### 6.7 Resource-safety contract — đóng F4

Mọi giới hạn là **hằng số có tên** trong `src/core/program/limits.ts` (core, thuần). Mỗi giới hạn có test và diagnostic cho learner. Giới hạn là **một phần của supported domain**: vượt giới hạn = `limit-exceeded`, program dừng, có `blockId` và tên giới hạn. Ngoại lệ: các giới hạn chỉ thuộc về trình bày, ghi rõ trong bảng.

| Hằng số | Giá trị | Lý do | Kiểm ở đâu, khi nào | Khi vượt |
|---|---|---|---|---|
| `MAX_SAFE_INT` | 2^53 − 1 | Độ chính xác của JS (§6.4) | Sau mỗi phép số học | `out-of-domain` |
| `MAX_TEXT_CHARS` | 1000 | Bài học dùng < 200 ký tự; chặn tăng trưởng mũ; an toàn cho heap của MicroPython | **Trước** khi nối/đổi sang text: tính độ dài kết quả từ độ dài các phần, rồi mới cấp phát | `limit-exceeded` |
| `MAX_TEXT_JOIN_PARTS` | 50 | Một lần nối không quá 50 phần | Compiler (L-3) | Lỗi compile `limit-exceeded`. **Không** phải điều kiện mở: editor tự tạo được join 51 phần (mutator), nên document vẫn mở và sửa được (L-1, giới hạn cấu trúc `maxMutatorItemsPerBlock` / `maxTotalMutatorItems`, §12); chỉ Run bị chặn. *Sửa theo evidence ở review YB-2b (R2)* |
| `MAX_CONSOLE_LINE_CHARS` | = `MAX_TEXT_CHARS` | Một `print` không thể dài hơn một text | Trước khi ghi console | (không xảy ra) |
| `MAX_CONSOLE_ENTRIES` / `MAX_CONSOLE_BYTES` | 500 dòng / 256 KB | UI phản hồi | Lúc ghi | **Trình bày:** bỏ dòng cũ nhất, hiện "N earlier lines hidden" (output của program không bị đổi) |
| `EXEC_SLICE_MS` | 8 ms | Giữ một frame 16 ms cho UI | Interpreter kiểm đồng hồ mỗi `STEP_CHECK_INTERVAL` bước | Nhường bằng macrotask (không phải điểm dispatch, EV1) |
| `STEP_CHECK_INTERVAL` | 256 bước | Chi phí `performance.now()` thấp | Bộ đếm bước (statement, vòng lặp, node biểu thức) | — |
| `MAX_WAIT_MS` | 60 000 | Domain của `wait` (§6.4) | Compile/runtime | Lỗi compile / `out-of-domain` |
| `MAX_RANGE_VALUE` | 1 000 000 | Count up: cận và bước (§6.5). Đối số `range` phải nằm trong machine word; giữ mọi trung gian < 2^21 (contract §3.2) | Compile (literal) + ngay sau khi đánh giá từng cận | Lỗi compile / `out-of-domain` |
| `MAX_REPEAT_ABS` | 1 000 000 | `repeat N`: `abs(N)` (cùng lý do) | Compile/runtime | Lỗi compile / `out-of-domain` |
| `MAX_RANDOM_ABS`, `MAX_RANDOM_SPAN` | 1 000 000, 1 000 000 | Domain **đặc tả sẵn** của `random.randint` (contract §3.5). **Không hoạt động** khi C-40 bị loại | — | — |
| `MAX_CALL_DEPTH` | 64 | Advanced, hàm | Mỗi lần gọi | `limit-exceeded` |
| `MAX_EVENT_QUEUE` | 16 | Nhấn liên tục, EV2 | Lúc phát hiện event | EV3 |
| `MAX_PROGRAM_BLOCKS` | 2000 | Bài học < 200 block | Preflight + compiler | Không mở được / lỗi compile `program-too-large` |
| `MAX_GENERATED_BYTES` | 256 KB | Khớp giới hạn trên | Generator, trước khi trả về | `ok: false`, `program-too-large` |
| `MAX_SNAPSHOT_RATE` | 1 commit React/frame | Đã có ở PoC (run store) | runStore | — |

**Stop luôn phản hồi trong ≤ 100 ms** trong mọi tình huống: vòng chặt, text gần giới hạn, flood console, bão event. Test ở §18.5.

**Ví dụ đối kháng bắt buộc có test:**
- Advanced, biến `str`: `s = join(s, s)` lặp lại → `limit-exceeded` ở lần vượt 1000 ký tự, không treo, không cấp phát chuỗi lớn;
- Basic: `print` trong `while true` không có `wait` → console giữ ≤ 500 dòng, UI vẫn mượt, Stop ≤ 100 ms.

### 6.8 Asset parity — đóng F7

Một **identifier công khai** (vd. `Image.HEART`, `music.DADADADUM`) **không** đảm bảo nội dung giống nhau. Mỗi asset dựng sẵn mà toolbox mở cần đủ **bộ ba**:

1. evidence cho **identifier** (`OF-call`);
2. evidence cho **nội dung** (`OF-content`: điểm ảnh, nốt + thời lượng + tempo, metric chữ);
3. **nguồn gốc chấp nhận được** cho biểu diễn trong simulator.

**Nguồn gốc chấp nhận được (frozen):**
- (a) tự làm; hoặc
- (b) license mở dễ dãi (MIT, BSD, Apache-2.0, CC0), có ghi attribution trong `docs/yolobit-compatibility-contract.md` §Provenance.

Nguồn khác: không dùng.

| Loại asset | Nếu đủ bộ ba | Nếu thiếu (2) hoặc (3) |
|---|---|---|
| Hình dựng sẵn | Generator sinh identifier (vd. `Image.HEART`), simulator vẽ đúng nội dung | Block "show icon" dùng **dữ liệu hình của mình**, generator sinh **hình tự định nghĩa** qua API custom image. API đó phải qua EG, và nội dung lúc này được định nghĩa ở cả hai phía. Nếu API custom image cũng chưa qua EG → không có block hình |
| Giai điệu dựng sẵn | Sinh identifier | Generator sinh **chuỗi nốt/tần số tự viết** bằng API pitch/note đã qua EG (kèm thời lượng tường minh). Không đủ → không có block giai điệu |
| Font / chạy chữ | Font của mình được phép **về hình dạng** (`presentation`), **chỉ khi** metric tác động hành vi đã có evidence: bước dịch theo cột/ký tự, khoảng cách ký tự, thời gian mỗi bước, tổng thời lượng chặn (`OF-block`), charset | Thiếu metric → **hoãn** chạy chữ/hiện chữ |
| Màu | Bảng màu logic của contract (`OF-content`) | Chỉ mở API không phụ thuộc màu, render bằng **màu mặc định** đã có evidence; không có thì chỉ có bật/tắt |

### 6.9 Mức tương thích và câu tuyên bố (tighten) — đóng F5

| Mức | Yêu cầu (tất cả) | Câu được phép |
|---|---|---|
| **L1 — Simulator-semantic verified** | Contract IR/interpreter có test; hành vi phần cứng ảo có test; fixture trace của program chuẩn xanh | "Runs in the simulator as specified." |
| **L2 — Generated-code verified** | L1 (khi áp dụng) **và** contract đã freeze **và** golden generator xác định **và syntax check bắt buộc xanh** **và** API allowlist xanh **và** supported-domain validation xanh **và** không có field UNKNOWN trong mọi construct được dùng (EG) | **"Yolo:Bit MicroPython code-generation compatible; physical-board verification pending."** |
| **L3 — Physical-board verified** | Chạy program chuẩn trên Yolo:Bit thật, đúng firmware/version của contract, đối chiếu trace/ý định | "Verified on Yolo:Bit (firmware X / snapshot Y) for the supported subset." |

- **L2 không có nghĩa là đã chạy trên phần cứng.**
- **Syntax check là bắt buộc cho L2.** Môi trường không chạy được syntax check → **L2 = PENDING** (không phải PASS, không lặng lẽ bỏ qua).
- Syntax check (CPython `ast`, hoặc trình biên dịch MicroPython) chỉ chứng minh **cú pháp**, **không** chứng minh tương thích runtime trên MicroPython/Yolo:Bit.
- Không có phần cứng → L3 = PENDING. Không bao giờ dùng câu "100 % compatible".

### 6.10 Function domain contract (gate FN) — điều kiện trước của YB-7

Hàm chỉ có ở Advanced. **Không block hàm nào được mở** cho tới khi FN1–FN10 được ghi vào contract §Language (DOCUMENTED bằng tài liệu ngôn ngữ MicroPython cho tập con này + phiên bản firmware §7.7) và mọi test §18.3b xanh. YB-2 **không** phải implement hàm.

| ID | Luật (frozen) |
|---|---|
| FN1 — Hai loại | **Procedure** (`procedures_defnoreturn` / `procedures_callnoreturn`, chỉ ở vị trí statement, không có giá trị) và **function** (`procedures_defreturn` / `procedures_callreturn`, chỉ ở vị trí biểu thức). Hai loại tách biệt; dùng sai vị trí → lỗi compile |
| FN2 — Tham số | 0–8 tham số. Mỗi tham số có **một kiểu tĩnh** thuộc `int \| str` (cùng tập kiểu với biến Advanced). Kiểu được suy ra từ mọi lời gọi và mọi chỗ dùng trong thân; mâu thuẫn → `type-mismatch`. Thiếu hoặc thừa đối số → lỗi compile |
| FN3 — Truyền tham số | Theo giá trị. `int`/`str` là bất biến (Python), nên không có aliasing quan sát được. Đối số được đánh giá **từ trái sang phải, mỗi đối số một lần**, trước khi vào thân hàm |
| FN4 — Phạm vi | Bên trong thân hàm, một tên là **tham số** nếu nó là tham số của hàm đó; mọi tên khác là **biến toàn cục**. **Không có biến cục bộ** nào ngoài tham số. Gán vào biến toàn cục trong thân → generator sinh `global <tên>` cho mọi biến toàn cục bị gán trong hàm (gồm cả trong khối lồng); tham số không bao giờ xuất hiện trong `global`. Interpreter dùng đúng luật phân giải tên này |
| FN5 — Giá trị trả về | Function có **đúng một kiểu trả về tĩnh** thuộc `int \| bool \| str`, là kiểu của biểu thức ở ô RETURN cuối của `procedures_defreturn`. Ô RETURN trống → lỗi compile `missing-return-value` |
| FN6 — Mọi đường đều trả về | **Không có early return**: `procedures_ifreturn` bị loại khỏi domain (`not-in-profile` nếu load từ dữ liệu). Vì vậy function luôn trả về **đúng một lần, ở cuối**, trên mọi đường thực thi. Procedure không có `return` |
| FN7 — Không `None` ngầm | Procedure không dùng được như giá trị (FN1); function luôn trả về giá trị có kiểu (FN5/FN6). Code sinh ra không bao giờ dựa vào `None` |
| FN8 — Đệ quy | **Không hỗ trợ.** Compiler dựng call graph; có chu trình (trực tiếp hay gián tiếp) → lỗi compile `recursion-not-supported` |
| FN9 — Độ sâu gọi | `MAX_CALL_DEPTH` (§6.7) vẫn enforce lúc chạy (phòng thủ; không có đệ quy nên độ sâu ≤ số hàm) |
| FN10 — Thứ tự khai báo | Thứ tự trên workspace không quan trọng. Generator sinh **mọi `def` trước mọi code thực thi ở top level** (§13.3), nên gọi trước khi khai báo trên workspace vẫn hợp lệ trên board. Interpreter dựng bảng hàm trước khi chạy |

Hàm gọi từ event handler chỉ có khi cả gate EV và gate FN đều đạt.

---

## 7. YB-0 compatibility matrix

### 7.1 Phương pháp

| Được phép | Không được phép |
|---|---|
| Dựng program nhỏ trên editor public `app.ohstem.vn/#!/codes/yolobit` (không đăng nhập); chép **output Python của program mình** | Đọc/chép firmware `.py`, `machine.py` giả, block/generator JS của OhStem |
| Tài liệu public (docs.ohstem.vn, wiki, giáo trình public, tài liệu MicroPython chính thức) → DOCUMENTED, ghi URL + ngày | Tải hình, icon, giai điệu, font, model; đăng nhập; endpoint private; dùng token lộ |
| Ghi dạng gọi, import, tham số, mặc định thấy trong output | Ghi VERIFIED cho điều suy ra từ đọc source |

Evidence lưu ngoài repo; repo chỉ chứa contract và đoạn code ngắn là output của program mình. Ngữ nghĩa chỉ biết được qua source firmware hoặc phần cứng → UNKNOWN → xử lý theo EG (§6.2).

### 7.2 Định dạng contract

Mỗi dòng: `id · capability · profile tier · block semantic · IR · simulator semantic · Python · field OF-* (giá trị + nhãn + evidence ref, hoặc n/a + lý do) · presentation fields · domain restriction (nếu thu hẹp) · eligibility (ELIGIBLE / RESTRICTED / EXCLUDED)`.

Contract cũng có các phần:
- §Firmware target (§7.7);
- §Display model (§7.4);
- §Event model (§6.6, hoặc ghi rõ "DEFERRED");
- §Provenance (§6.8);
- §Language (phiên bản/tính năng MicroPython, module có sẵn);
- §Parity records (output OhStem của P1–P11).

### 7.3 Ma trận sau YB-0 (2026-10-14, contract r2)

> Bảng tạm của v0.4 (nhãn 13/10, PRIOR) đã được thay bằng kết quả YB-0. Bản r2 sửa các finding của review (R1–R3, N1–N3). Chi tiết từng field, nhãn, claim và evidence: `docs/yolobit-compatibility-contract.md` §15 (contract là nguồn sự thật, plan §0).
>
> Ký hiệu: **E** = ELIGIBLE, **R** = RESTRICTED, **X** = EXCLUDED, **D** = DEFERRED. `S` = có field simDependent: evidence chỉ từ simulator public, chấp nhận theo **RV-1 = ACCEPT WITH RESTRICTIONS** (contract §0.4).

| ID | Capability | Python (YB-0, V·G) | Kết quả | Thu hẹp / lý do |
|---|---|---|---|---|
| C-01 | Program start | statement top level (editor: `if True:`) | E | — |
| C-02 | Forever | `while True:` … `time.sleep_ms(10)` | E | — |
| C-03a | `import time` | `import time` | E | Module: tài liệu MicroPython ESP32 + OhStem (không sim) |
| C-03b | `from yolobit import *` + preamble | `from yolobit import *` + 3 dòng `button_*.on_pressed…` | E·S | Module: chỉ quan sát trong simulator (`sim-module`); có trên firmware vật lý: L3 |
| C-03c | `import music` | `import music` | E·S | Như C-03b |
| C-03d | `import random` | `import random` | **X** | `random.randint` là tuỳ chọn khi build MicroPython; không có evidence chấp nhận được cho firmware Yolo:Bit |
| C-04 | Wait ms | `time.sleep_ms(n)` | E | `int` 0..60000; "at least n ms" (MicroPython) |
| C-05 | Hình dựng sẵn | `display.show(Image.HEART)` | X | Asset OhStem → thay bằng C-06 |
| C-06 | Hình tự định nghĩa | `display.show(Image("r0:r1:r2:r3:r4"))` | R·S | 5×5, chữ số `0` (tắt)/`1` (đỏ); thay toàn khung; không chặn |
| C-07 | Chạy chữ | `display.scroll('…')` | R·S | ASCII 0x20–0x7E. 1 ký tự: tĩnh, không chặn. n ≥ 2: 1 cột/≈200 ms, 6 cột/ký tự, chặn 1200·n ms, kết thúc trống; đỏ. **Timing = quan sát simulator, chưa kiểm vật lý** |
| C-08 | Hiện/chạy số | `display.scroll(n)` | R·S | Như C-07 với `str(n)` |
| C-09 | Xoá display | `display.clear()` | E·S | — |
| C-10 / C-42 / C-43 | Đặt / tắt điểm, đặt tất cả | `display.set_pixel(x, y, '#rrggbb')`, `clear_pixel`, `set_all` | R·S (Advanced) | x, y ∈ 0..4 (0-based, gốc trên-trái); 8 màu bảng editor |
| C-11 | Độ sáng | `display.set_brightness(n)` | X | Ngữ nghĩa không quan sát được |
| C-12 | Nút đang nhấn | `button_a.is_pressed()`, `button_b.is_pressed()` | R·S | `True` khi đang giữ lúc gọi, không chốt. A+B: **không được hỗ trợ trong snapshot simulator đã chấp nhận** (không có claim về board vật lý) |
| C-13 | Số lần nhấn | `button_a.get_presses()` | R·S (NICE) | Reset khi đọc (tooltip); cạnh nhấn (simulator); A, B |
| C-14 | Event nhấn nút | `button_a.on_pressed = f` | **D** | Gate EV: EV1–EV10 UNKNOWN |
| C-15 | Mức sáng | `light_level()` | E·S | `int` 0..100 theo **tooltip** (không theo widget); slider % đồng nhất |
| C-16 | Nhiệt độ | `temperature()` (float, °C) | R·S (Advanced) | Sinh `int(temperature())`. 0..50 °C là **domain hỗ trợ của contract**, không phải khoảng vật lý |
| C-17 / C-18 | Gia tốc; lắc / cử chỉ | `accelerometer.get_x()`, `is_gesture("shake")` | X | `OF-range`, `OF-coord`, tiêu chí UNKNOWN |
| C-19 | Thời gian chạy | `running_time()` | **X** | Không có evidence về wrap/reset/khoảng của phép trừ; gốc mâu thuẫn (R3). LATER |
| C-20 / C-21 / C-22 | Giai điệu dựng sẵn; `pitch`; `stop` | `music.play(music.ODE, …)`, `music.pitch(f, d)`, `music.stop()` | X | Asset; kết thúc/chồng tone UNKNOWN; không cần |
| C-50 / C-51 | Phát nốt / nghỉ (chặn) | `music.play(['C4:4'], wait=True)`, `['R:4']` + preamble `music.set_tempo(4, 120)` | R·S | 15 nốt C3…C5 tự nhiên; 1/2/4 tick = 125/250/500 ms (simulator) |
| C-23 | Digital write | `pin0.write_digital(1)` | R·S | **P0–P2**; 0/1 (tooltip) |
| C-24 | Digital read | `(pinN.read_digital() == 1)` | R·S | P0–P2; net hở/xung đột → `out-of-domain` |
| C-25 | Analog read | `int(pinN.read_analog())` | R·S | P0–P2; native **0..4095** theo **tài liệu OhStem** (docs.ohstem.vn: cảm biến góc xoay/rotary); learner dùng đúng thang này (**C-Q6 = A**); UI 0–100 % → `percentToNative(p, 4095)`. Simulator và tài liệu ESP32 chung chỉ là bổ trợ/ngữ cảnh |
| C-26 | Analog write/PWM | `pin0.write_analog(v)` | ~~X~~ R·S (Advanced, N17 B5) | Khoảng UNKNOWN (owner xác nhận vẫn loại ở C-Q6); N17 B5: mở với 0..1023 ghi UNVERIFIED, kẹp + cảnh báo (contract §27) |
| C-27 | Servo | `pin0.servo_write(angle)` | R·S (Advanced) | 0..180 (tooltip), P0–P2, không chặn |
| C-28 | Pulse in | `pin0.pulse_in(1)` | X | Timeout/lỗi UNKNOWN → siêu âm X/LATER |
| C-29 | Print | `print(x)` | E | Ra serial |
| C-30…C-38 | Ngôn ngữ (§6.4) | Python | E / R | `repeat`: `abs(N) ≤ MAX_REPEAT_ABS` |
| C-39 | Count up | `range(a, b+1)` (literal) hoặc `_cu_start_k`/`_cu_end_k` | R | Start rồi end, mỗi cái một lần (R1); `0 ≤ a, b ≤ MAX_RANGE_VALUE`, step literal 1..`MAX_RANGE_VALUE` (R2) — §6.5 |
| C-40 | Random int | `random.randint(a, b)` | **X** | Theo C-03d. Domain có quan hệ đã đặc tả sẵn để mở lại (§6.4) |
| C-56…C-59 | Text, biến `str`, `len`, hàm | Python | E / R | `len` chỉ chuỗi ASCII; hàm: FN1–FN10 DOCUMENTED (contract §3.4) |
| C-41 | Kết thúc program | — | n/a | Vòng chờ rảnh (§13.3) |

Danh sách đầy đủ, gồm cả C-44…C-70 bị loại, nằm ở contract §15.2.

**Display model (YB-0, OQ-E APPROVED 2026-10-14):** **5×5 RGB**, toạ độ **0-based**, `x` = cột 0..4 trái→phải, `y` = hàng 0..4 trên→dưới, gốc **trên-trái** (DOCUMENTED bằng bài học OhStem 2021, VERIFIED trên simulator public). Màu là chuỗi `'#rrggbb'`, mặc định đỏ. *Sửa ghi chú v0.4 "UI đánh số từ 1 (13/10)":* đó chỉ là giá trị mặc định `1, 1` của block. Model cuối: contract §4.3.

**Thu hẹp domain mà YB-2/YB-3/YB-4 phải cài (contract §19):**
- `MAX_RANGE_VALUE`, `MAX_REPEAT_ABS` (§6.7) và thứ tự đánh giá count up (§6.5);
- charset chạy chữ ASCII 0x20–0x7E;
- `len` chỉ cho chuỗi ASCII;
- chân chỉ P0–P2;
- toạ độ 0..4, 8 màu;
- 15 nốt × {1, 2, 4} tick;
- servo 0..180;
- nhiệt độ: domain hỗ trợ 0..50 °C.

Builtin `int` vào allowlist generator (C-16, C-25).

**Quyết định của owner (đã áp dụng, 2026-10-14):**
- **OQ-E: APPROVED.** Model display cuối như trên.
- **C-Q6 = Option A:** analog read dùng native 0–4095; UI 0–100 %; không chuẩn hoá về 0–1023. PWM EXCLUDED. (Xung đột với giả định 0–1023 của Q6 đã được owner giải quyết; Q6 cập nhật ở §3.)

**RV-1** đã được reviewer quyết: **ACCEPT WITH RESTRICTIONS** (contract §0.4).

### 7.4 Display: thẩm quyền và quy trình quyết định

| Hạng mục | Trạng thái |
|---|---|
| **Owner decision (đã duyệt, 2026-10-14)** | Tương thích ngữ nghĩa với Yolo:Bit **ưu tiên hơn** ưu tiên tạm 8×8 |
| **Ưu tiên tạm** | 8×8 một màu: **không** freeze |
| **Nghĩa vụ YB-0** | Xác lập ngữ nghĩa display logic thật của Yolo:Bit: kích thước logic, gốc/chỉ số toạ độ, màu logic (bảng/mặc định), độ sáng, hành vi hình dựng sẵn và hình tự định nghĩa |
| **Freeze checkpoint (OQ-E)** | Sau evidence YB-0, model display logic đề xuất được trình **owner xác nhận lần cuối**. Khuyến nghị của reviewer chỉ là input kỹ thuật, không phải thẩm quyền. **Đã xác nhận (OQ-E APPROVED, 2026-10-14)** → capability display (YB-3a, YB-7a) được implement theo model đã duyệt |
| Artwork | Của mình, ngoài phạm vi quyết định này |
| **Kết quả YB-0 (2026-10-14)** | Model xác lập đủ (hàng 1 bảng dưới): **5×5 RGB**, 0-based, x = cột trái→phải, y = hàng trên→dưới, gốc trên-trái, màu `'#rrggbb'`, mặc định đỏ (contract §4.3). Basic: hình bật/tắt (đỏ) + chạy chữ ASCII + xoá. Advanced: thêm điểm với 8 màu. Không có độ sáng. **Owner đã xác nhận (OQ-E APPROVED, 2026-10-14)** |

Kết quả YB-0 → **đề xuất** trình owner (owner xác nhận; nếu owner từ chối thì capability display bị hoãn, không implement một model khác Yolo:Bit cho board family này):

| Kết quả YB-0 | Đề xuất trình owner |
|---|---|
| Model xác lập đủ (vd. 5×5, toạ độ, màu mặc định) | Display ảo = model đó. "Một màu trước" = chỉ mở API không phụ thuộc màu, render bằng màu mặc định; API màu mở sau khi qua EG |
| Kích thước xác lập, nhưng màu/độ sáng chưa | Chỉ mở bật/tắt bằng màu mặc định có evidence; nếu màu mặc định cũng chưa có thì render "sáng" không màu, chỉ khi màu là field `presentation` của API đó; block màu/độ sáng bị loại |
| Không xác lập được kích thước/toạ độ | **Mọi** construct display bị loại; Basic dựa vào âm thanh/nút/console/chân (rủi ro #2, §22). Báo owner |

Phương án B (vẽ 8×8 nhưng dùng vùng 5×5) và C (board generic 8×8 thứ hai) đã bị loại ở v0.1 vì lý do trong investigation §18.1 / v0.1 §7.4. Lý do giữ nguyên.

### 7.5 YB-0 phải giải quyết

1. **Firmware target** (§7.7).
2. **Display model** (§7.4), charset và metric chữ (§6.8).
3. **Asset**: với mỗi hình/giai điệu định mở: bộ ba §6.8, hoặc quyết định dùng biểu diễn tự định nghĩa.
4. Nút: `is_pressed`, `get_presses`, event (field hành vi của gate EV, §6.6).
5. Cảm biến: dạng gọi, đơn vị, thang, làm tròn của ánh sáng, nhiệt độ, gia tốc, lắc.
6. Âm thanh: pitch, stop, note, tempo, chặn/không chặn, `OF-yield`.
7. Chân: danh sách, capability, chân reserved, dạng gọi, thang, chặn/lỗi; servo; pulse.
8. Ngôn ngữ: phiên bản/tính năng MicroPython, module `time`/`random`; parity với output OhStem cho if/loop/math/text/biến/hàm.
9. Preamble và cấu trúc file (`main.py`).
10. Đặc tả contract máy đọc được (`yolobit-contract.ts`).

### 7.6 Exit criteria của YB-0 (hard gate)

- [ ] **Firmware target** có ghi: version/build nếu quan sát được hoặc có tài liệu; ngày quan sát; nguồn evidence. Nếu không xác định được version: ghi giới hạn đó, **pin snapshot** theo ngày + build marker (vd. `?v=…` của app) và không tuyên bố tương thích "vô thời hạn".
- [ ] Mọi construct ứng viên của §14/§15 có dòng contract, từng field có nhãn; eligibility = ELIGIBLE / RESTRICTED (ghi tập con) / EXCLUDED (ghi lý do). **INFERRED tính như UNKNOWN.**
- [ ] Không có construct nào ELIGIBLE/RESTRICTED mà còn field bắt buộc UNKNOWN.
- [ ] Display model đã xác lập và **đề xuất model display logic đã trình owner** (OQ-E, §7.4), hoặc construct display bị EXCLUDED. *(Owner xác nhận là điều kiện để implement capability display ở YB-3a/YB-7a, không phải điều kiện freeze phần còn lại của contract.)*
- [ ] Mỗi asset dựng sẵn định mở có bộ ba §6.8, hoặc được thay bằng biểu diễn tự định nghĩa, hoặc bị loại. Bảng Provenance đã điền.
- [ ] Event: mọi field hành vi của gate EV (EV1, EV2, EV4–EV7, EV9, EV10) có evidence, hoặc ghi **"Events: DEFERRED"**.
- [ ] Ngôn ngữ: phiên bản/tính năng MicroPython và module ghi rõ; output OhStem của P1–P11 đã ghi (chỉ text) cho parity.
- [ ] §14, §15, lesson list và §7.3 của plan đã cập nhật theo eligibility; lesson nào phụ thuộc construct bị loại thì được thay hoặc bỏ.
- [ ] Không có nội dung độc quyền trong repo (reviewer kiểm).
- [ ] Review độc lập xong → contract v1.0 freeze. **Không cần owner duyệt từng construct bị loại**; owner được báo danh sách loại (§25).

### 7.7 Firmware target (output bắt buộc của YB-0)

Ghi trong contract §Firmware target:
- tên/phiên bản/build firmware Yolo:Bit (nếu có, vd. danh sách public của `fw.ohstem.vn`);
- phiên bản MicroPython bên dưới (nếu có tài liệu);
- ngày quan sát;
- build marker của editor public (vd. `app.ohstem.vn` `?v=20261007130057` lúc quan sát 2026-10-13);
- URL tài liệu.

Mọi câu tuyên bố L2/L3 phải trích phiên bản/snapshot này.

---

## 8. Board/profile schema

### 8.1 `DeviceDefinition` (chỉ thêm field tuỳ chọn)

```ts
// src/core/devices/device-definition.ts (sketch). Existing generic definitions stay valid unchanged.
family?: 'generic' | 'ybc';                       // default 'generic' — device-level, used for palette filtering
board?: {
  pins: { name: string; portId?: string; capabilities?: PinCapability[] }[];   // capabilities default ['digital']
  codeTarget?: 'yolobit-micropython';             // ybc only
  onboard?: OnboardPeripheral[];                  // ybc only
  reservedPins?: string[];                        // used by onboard hardware: never wireable, never in dropdowns
};
type PinCapability = 'digital' | 'analogIn' | 'pwm' | 'servo' | 'pulse';   // each must be contract-evidenced per pin
type OnboardPeripheral = {
  id: string;                                     // 'display' | 'button-a' | 'button-b' | 'buzzer' | 'light' | …
  model: string;                                  // simulation model id
  capability: CapabilityId;                       // §10
  config?: Record<string, unknown>;               // e.g. display { width, height, colourModel } from the contract
  control?: RuntimeControl;                       // §11.3
  at: { x: number; y: number; width: number; height: number };   // our artwork
  label: string;                                  // UI text key (i18n-ready)
};
```

### 8.2 Curriculum profile

```ts
// src/core/profiles/ybc-basic.json, ybc-advanced.json
type CurriculumProfile = {
  id: 'ybc-basic' | 'ybc-advanced';
  family: 'ybc';
  boardType: 'ybc-board';
  extends?: string;              // ybc-advanced extends ybc-basic: union only
  constructs: string[];          // construct ids exposed (each must pass EG)
  blockPacks: string[];          // toolbox categories, ordered
  palette: string[];             // device types allowed in the circuit (includes 'ybc-board')
  controls: string[];            // onboard peripherals whose runtime controls are shown
  variableTypes: ('int' | 'str')[];   // basic: ['int']; advanced: ['int', 'str']
};
```

Profile chỉ **chọn**; không định nghĩa hành vi. Test: `ybc-advanced` ⊇ `ybc-basic` trên mọi trường.

### 8.3 Document

- Thêm `profile?: 'ybc-basic' | 'ybc-advanced'` ở top level; schema Zod khai báo (S10). **Không** tăng `schemaVersion`.
- **Triển khai YB-1:** schema Zod là `z.string().min(1).optional()`, không phải `z.enum`. Lý do: fixture test-only (§8.7) cần document có `profile: 'test-base'` mở được, nên **danh mục profile là dữ liệu được inject**, và việc "id có hợp lệ không" được kiểm ở **L-1** (`inspectStoredProject`, mã `unknown-profile`), không ở schema. Kết quả quan sát được giống hệt: profile lạ ⇒ không mở được (R-F2); document cũ không có key `profile`.
- Document cũ không có `profile` → **generic project**, hành vi y hệt hôm nay.
- Runtime state không vào document (B2).

### 8.4 Vị trí file

```text
src/core/devices/definitions/ybc-board.json, potentiometer.json (+ servo.json, ultrasonic.json ở YB-7)
src/core/profiles/*.json, index.ts, board-context.ts      ← resolveBoardContext (§8.5)
src/core/compat/yolobit-contract.ts                        ← contract máy đọc được
src/core/constructs/<pack>.ts                              ← construct spec
src/core/capabilities/*.ts                                 ← interface capability (§10)
src/core/program/limits.ts, values.ts
src/core/simulation/conversions.ts, peripherals/*
src/core/codegen/yolobit/*
src/ui/canvas/YbcBoardRenderer.tsx, src/ui/runtime-controls/*, src/ui/code/PythonPanel.tsx, src/ui/audio/*
```

### 8.5 Board context resolution — đóng F6

**Một hàm duy nhất** `resolveBoardContext(document, registry, profiles) → BoardContext` trong core. Đây là nơi **duy nhất** ra quyết định về family/profile/board. Mọi consumer gọi nó: load/startup, persistence (`readStoredProject`), palette, toolbox/Blockly, Run (`RunSession.start`), generation (Python panel), template loading, thao tác xoá/thêm board.

```ts
type BoardContext = {
  family: 'generic' | 'ybc';
  profile: CurriculumProfile | null;            // null for generic
  allowedDeviceTypes: readonly string[];        // the palette
  boards: ComponentInstance[];                  // components whose definition has `board`
  incompatible: ComponentInstance[];            // components whose device type is not allowed for this family/profile
  readiness: { ok: true; board: ComponentInstance; capabilities: CapabilitySet }
           | { ok: false; reason: 'no-board' | 'multiple-boards' | 'incompatible-devices'; componentIds: string[] };
};
```

| Luật | Nội dung |
|---|---|
| R-F1 | **Family** = `ybc` khi và chỉ khi `document.profile` có mặt; ngược lại `generic`. Việc có board, xoá board hay thêm board **không bao giờ** đổi family |
| R-F2 | `profile` là id không biết → document **không mở được** (đi đường "saved project could not be opened" sẵn có). Chỉ document mới có field này, nên document cũ không bị ảnh hưởng |
| R-F3 | **Device được phép:** generic = mọi device có `family` = `generic` (mặc định; đúng danh sách hôm nay: `board`, `led`, `resistor`, `push-button`); ybc = **danh sách tường minh** `profile.palette` (có `ybc-board`; có thể dùng lại `led`, `resistor`, `push-button`; không có `board` generic). Device **mới** của track này (`ybc-board`, `potentiometer`, `servo`, `ultrasonic`) khai báo `family: 'ybc'`, nên palette generic giữ y hệt (GB9). `incompatible` = component có `deviceType ∉ allowedDeviceTypes` |
| R-F4 | **Trạng thái sửa:** document được chứa **0, 1 hay nhiều** board và component bất kỳ (tương thích ngược S16). Palette chỉ đưa ra `allowedDeviceTypes`. Component không được phép mà có sẵn trong dữ liệu thì **giữ nguyên**, đánh dấu cảnh báo trên canvas, không thêm được từ palette |
| R-F5 | **Readiness của board (Run và generation dùng chung):** đúng **1** board thuộc family, **0** component không được phép → `ok`; ngược lại `no-board` / `multiple-boards` / `incompatible-devices` (kèm id). Đây là một phần của tầng L-2/L-3 ở §8.6. Run và Python panel (từ YB-5A) hiện **cùng** diagnostic. Generic: generation không áp dụng (không có panel) |
| R-F6 | **Toolbox:** generic → toolbox generic (như hôm nay); ybc → toolbox của profile. Toolbox **không** phụ thuộc số board, nên xác định và chỉ đổi khi `profile` đổi hoặc khi load project |
| R-F7 | **Xoá board:** cho phép; family/profile giữ nguyên; dây nối board bị xoá theo I4; readiness → `no-board`. Thêm lại `ybc-board` → readiness `ok` (dây phải nối lại) |
| R-F8 | **Thay board** = xoá + thêm loại board được phép. Trong project ybc chỉ thêm được `ybc-board`; trong project generic chỉ thêm được `board` |
| R-F9 | **Đổi profile** (chỉ standalone, YB-6): Basic → Advanced luôn hợp lệ. Advanced → Basic: **không xoá gì**; block chỉ có ở Advanced vẫn hiện và được giữ, nhưng → lỗi `not-in-profile` (tầng L-2); device chỉ có ở Advanced → `incompatible` (giữ, đánh dấu). Toolbox dựng lại ngay theo profile mới. Document vẫn **loadable** (L-1). Kịch bản đầy đủ và phase kiểm từng phần: §8.6 (cơ chế ở YB-1 bằng fixture §8.7; UI ở YB-6; round-trip thật ở YB-7) |
| R-F10 | **Template:** template generic không có `profile`; template `ybc-*` khai báo `profile`. **Không** áp một mức readiness chung cho mọi template: mỗi template có **mức kỳ vọng** riêng (§8.6) |
| R-F11 | **Persistence:** lưu `profile`; reload → cùng resolution. `readStoredProject` chỉ kiểm **tầng L-1** (cấu trúc): schema, I1–I3, device type có trong registry, `profile` id hợp lệ (R-F2), và program **mở được về mặt cấu trúc** bởi Blockly đã đăng ký **hợp mọi pack** (không lọc theo profile), kèm preflight có ngân sách (§12). Nó **không** từ chối vì số board, component không được phép, block ngoài profile hay lỗi compile; đó là tầng L-2…L-4, là trạng thái sửa hợp lệ |

**Ca nghiệm thu** (unit cho resolution + E2E cho UI; mỗi ca có persist/reload). Cột "YB-1" bắt buộc ở YB-1; cột "Python" chỉ bắt buộc **từ YB-5A** (khi generator tồn tại). Không ca nào ở YB-1 dùng construct Advanced thật: phần "nội dung ngoài profile" dùng **fixture test-only** (§8.7). UI đổi profile thuộc YB-6; round-trip hạ profile với construct Advanced thật thuộc **YB-7** (§8.6).

| Ca | YB-1 (bắt buộc) | Python (từ YB-5A) |
|---|---|---|
| Generic, 0 board (gồm template `empty`) | Mở/sửa/lưu/reload được; palette generic; Run → `no-board` (như hôm nay) | n/a (generic) |
| Generic, 1 board | Như hôm nay (GB1–GB11) | n/a |
| Generic, nhiều board | Mở/sửa/lưu/reload được; Run → `multiple-boards` | n/a |
| YBC basic, 1 `ybc-board`, program rỗng | Toolbox Basic; palette Basic; Run → `running`, Stop → `idle` (YBC IR skeleton, §9.0) | Panel sinh code hợp lệ cho program rỗng (vòng chờ rảnh, §13.3) |
| YBC advanced, 1 `ybc-board`, program rỗng | Toolbox Advanced; Run/Stop như trên | Như trên |
| YBC, xoá board | Profile giữ; toolbox giữ; Run → `no-board` | Panel → cùng `no-board` |
| YBC, thay board (xoá + thêm `ybc-board`) | Run ok sau khi nối lại | Panel ok |
| Trộn family (chỉ đến từ dữ liệu) | Mở được; component bị đánh dấu; Run → `incompatible-devices` | Panel → cùng diagnostic |
| YBC, `profile` lạ | Không mở được (L-1); thông báo sẵn có | — |
| **Nội dung ngoài profile** (fixture test-only §8.7: document profile `test-base` chứa block/device chỉ có ở `test-extended`) | Unit: L-1 mở được; block và device giữ nguyên qua save/reload (deep-equal); L-2 → `not-in-profile` / `incompatible-devices`; toolbox/palette chỉ có nội dung của `test-base`; đổi document sang `test-extended` → L-2 đạt | Unit: generation bị chặn với cùng diagnostic (YB-5A) |
| **Round-trip hạ profile Advanced → Basic với construct Advanced thật** | Không thuộc YB-1 (construct Advanced chưa tồn tại) → **YB-7** (§8.6) | → **YB-7** |
| Reload mọi trạng thái hợp lệ ở trên | Document deep-equal; context giống trước reload | Kết quả panel giống trước reload |

### 8.6 Các tầng hợp lệ (validity layers) — đóng F6

Cùng một resolver (§8.5) cộng compiler/generator tạo ra **bốn tầng tách biệt**. Mỗi tầng có diagnostic riêng. Một document có thể qua tầng trước mà trượt tầng sau; đó là **trạng thái sửa hợp lệ**, không phải lỗi load.

| Tầng | Điều kiện | Ai kiểm | Trượt thì |
|---|---|---|---|
| **L-1 Loadable** (cấu trúc) | Zod schema; I1–I3; device type có trong registry; `profile` id hợp lệ hoặc vắng; program mở được về cấu trúc bởi Blockly với **hợp mọi pack** + preflight có ngân sách | `readStoredProject`, template loader, hook `loadProject` | Không mở; đi đường thông báo sẵn có (standalone) hoặc màn hình lỗi launch (lab) |
| **L-2 Profile-compatible** | Generic: mọi component thuộc palette generic, mọi block thuộc tập generic. YBC: mọi component ∈ `profile.palette`; mọi block thuộc construct của profile **và** đã qua EG (§6.2) | Resolver + bước đầu của compiler | Editor mở bình thường; Run và Python hiện `incompatible-devices` / `not-in-profile` / `not-eligible` |
| **L-3 Runtime-ready** | L-2 + đúng 1 board (R-F5) + program compile không lỗi (kiểu, domain literal, FN/EV nếu có) | `RunSession.start` | Run bị chặn với diagnostic (như `no-board` hôm nay) |
| **L-4 Generator-ready** (chỉ YBC) | L-3 + generator `ok` (giới hạn kích thước, mọi node có mapping). **Điều kiện để tuyên bố L2** thêm: syntax check chạy và xanh, allowlist xanh (§6.9) | Generator + Python panel (từ YB-5A) | Panel hiện diagnostic; không có Download |

**Mức kỳ vọng của từng template** (bảng trong `templates.test.ts`, không thêm field vào dữ liệu template):

| Template | Mức kỳ vọng |
|---|---|
| `empty` (generic, 0 board) | **L-1** (như hôm nay). Run → `no-board` là đúng |
| `blink`, `led-on`, `button-direct`, `button-led` (generic) | L-3 (như hôm nay) |
| Bài học `ybc-*` (B1–B10, `ybc-adv-*` trừ empty) | **L-4** (+ L2 hoặc L2 PENDING theo §6.9) |
| `ybc-basic-empty`, `ybc-adv-empty` (1 `ybc-board`, program rỗng) | L-4 |

**Kịch bản hạ profile — contract (F6-B).** Hợp đồng hành vi có hiệu lực cho **cơ chế** từ YB-1, nhưng được kiểm theo từng phase như sau (N1):

| Phase | Kiểm cái gì | Bằng gì |
|---|---|---|
| YB-1 | Cơ chế resolver/tầng hợp lệ: giữ nội dung ngoài profile, save/reload, diagnostic L-2, lọc toolbox/palette | **Fixture test-only** (§8.7), unit |
| YB-5A | Generation bị chặn với cùng diagnostic L-2 | Fixture test-only, unit |
| YB-6 | UI chọn profile thật (Basic ↔ Advanced); profile được lưu; toolbox/palette làm mới; load/save/reload; diagnostic bằng construct **đã có** (vd. `no-board`, `incompatible-devices`) | E2E, profile thật. **Không** đòi construct Advanced thật chạy hay sinh code |
| **YB-7** | **Round-trip đầy đủ với construct Advanced thật** (17 bước dưới) | E2E + unit. Đây là production acceptance đầu tiên chứng minh toàn bộ contract hạ profile |

**Round-trip đầy đủ (acceptance của YB-7).** Dùng **ít nhất một** construct chỉ có ở Advanced mà YB-7 thật sự mở (qua EG), vd. đọc nhiệt độ hoặc đặt điểm display (gia tốc kế bị loại ở YB-0); cộng một hàm nếu gate FN đạt:

```text
 1. tạo/mở project YBC Advanced (có 1 ybc-board)
 2. thêm block/capability chỉ có ở Advanced
 3. Run thành công (L-3)
 4. sinh MicroPython thành công (L-4)
 5. đổi profile Advanced → Basic
 6. block chỉ có ở Advanced được giữ (vẫn hiện; toolbox = Basic)
 7. Save
 8. Reload
 9. project mở thành công (L-1)
10. profile vẫn là Basic
11. block chỉ có ở Advanced vẫn còn (deep-equal)
12. Run bị chặn với `not-in-profile` (kèm blockId)
13. sinh MicroPython bị chặn với cùng diagnostic tương thích profile
14. đổi lại Basic → Advanced
15. cùng program đó profile-compatible trở lại (L-2)
16. Run thành công
17. sinh MicroPython thành công
```

Không bao giờ tự xoá hay migrate block ngoài profile; không bao giờ làm document đã lưu thành không mở được vì profile.

### 8.7 Fixture test-only cho cơ chế profile (YB-1)

Để YB-1 kiểm cơ chế profile mà **không** phụ thuộc construct Advanced (YB-7), test dùng fixture riêng:

| Fixture | Nội dung |
|---|---|
| Profile `test-base`, `test-extended` (`extends: test-base`) | Family `ybc`, board `ybc-board`; `test-extended` thêm đúng một construct và một device |
| Construct `test_marker` | Block type chỉ đăng ký trong test (Blockly headless của test), compile thành node IR no-op của dialect YBC. **Không có** mapping Python thật, không có dòng contract Yolo:Bit |
| Device `test-device` | Definition dữ liệu tối thiểu, `family: "ybc"`, chỉ nằm trong registry của test |

**Luật:**
- fixture nằm **chỉ** trong `__fixtures__` hay file test (vd. `src/core/profiles/__fixtures__/`); được inject qua tham số `resolveBoardContext(document, registry, profiles)` và registry/Blockly của test;
- **không bao giờ** là block cho learner, không có trong catalog, profile, toolbox hay template production, và không giả làm capability Yolo:Bit;
- id có tiền tố `test`. Một unit test khẳng định catalog/profile/toolbox/template production không chứa id `test`, và không file production nào import `__fixtures__`;
- dùng fixture để kiểm:
  - lọc theo profile;
  - giữ nội dung đã biết nhưng ngoài profile;
  - giữ qua save/reload (repository Dexie trên `fake-indexeddb`);
  - diagnostic của resolver (`not-in-profile`, `incompatible-devices`);
  - lọc palette/toolbox;
  - (từ YB-5A) generation bị chặn với cùng diagnostic.

---

## 9. IR changes

### 9.0 Hai dialect cùng tồn tại — đóng F3-B

| | **Legacy generic IR** | **YBC IR v1** |
|---|---|---|
| Type | `ProgramIR` trong `src/core/program/ir.ts`, **giữ nguyên từng byte** | `YbcProgramIR` trong `src/core/program/ybc-ir.ts` (mới) |
| Node | `DigitalWrite`, `Wait`, `If` (branches + else), `DigitalRead`, `Not`; `onStart`, `forever` | §9.1 (typed) |
| Có `type` trên node? | **Không**, và không bao giờ được thêm | Có: mọi `Expr` mang `type` |
| Compiler | `compileProgram(blocksJson, boardPins)` hiện có: **không sửa** trong milestone này (chỉ được refactor nội bộ nếu GB3/GB11 vẫn giống từng byte) | `compileYbcProgram(blocksJson, context)` mới, dùng bảng construct (§9.4) |
| Interpreter | `runProgram(ir, io: DigitalIO, …)` hiện có: **không đổi** hành vi (E1–E7) | `runYbcProgram(ir, capabilities, services)` mới. Helper dùng chung (sleep huỷ được, abort, `RunOutcome`) được tách ra mà không đổi hành vi generic |
| Chọn bởi | `RunSession.start` theo `BoardContext.family` (§8.5): `generic` → legacy, `ybc` → YBC | |
| Generator | Không áp dụng | Chỉ nhận `YbcProgramIR` |
| Hat dùng chung | `stem_on_start`, `stem_forever` được **cả hai** compiler chấp nhận (K7 ngoại lệ) | |

- **Không migration:** document, sample, template và project đã lưu của generic không đổi. Không node cũ nào phải mang `type`. IR không persist ở cả hai dialect.
- **Test bắt buộc GB11** (§16): mọi Blockly JSON generic hiện có (4 sample, `empty`, fixture của `src/core/program/__fixtures__/`, program trong test hiện có) → `compileProgram` → IR **deep-equal** golden IR đã chụp ở đầu YB-1 → `runProgram` → trace/snapshot **giống hệt** test hiện có. Không có bước migration nào.
- **YBC IR skeleton** (YB-1): chỉ `onStart`/`forever` rỗng, đủ để chạy ca §8.5 "program rỗng"; ngôn ngữ đầy đủ đến ở YB-2.

### 9.1 YBC IR v1 (YB-2; hàm ở YB-7)

```ts
// src/core/program/ybc-ir.ts — YBC dialect only; legacy ProgramIR is untouched.
type Type = 'int' | 'bool' | 'str';                        // learner value types, nothing else

type YbcProgramIR = {
  onStart: YbcStatement[];
  forever: YbcStatement[] | null;
  variables: { id: string; name: string; type: 'int' | 'str' }[];   // basic: int only (§6.4)
  functions: FunctionDef[];                                 // [] until the FN gate (§6.10), YB-7
  handlers: Handler[];                                      // [] unless the EV gate passes (§6.6)
};

type YbcStatement =
  | { kind: 'set'; variable: string; value: Expr; blockId: string }
  | { kind: 'if'; branches: { condition: Expr /*bool*/; body: YbcStatement[] }[]; else: YbcStatement[]; blockId: string }
  | { kind: 'repeat'; times: Expr /*int*/; body: YbcStatement[]; blockId: string }
  | { kind: 'while'; condition: Expr /*bool*/; body: YbcStatement[]; blockId: string }
  | { kind: 'countUp'; variable: string; from: Expr; to: Expr; step: number /*literal ≥ 1*/; body: YbcStatement[]; blockId: string }
  | { kind: 'print'; value: Expr; blockId: string }
  | { kind: 'waitMs'; ms: Expr /*int*/; blockId: string }
  | { kind: 'call'; op: OpId; args: Expr[]; operand?: OpOperand; blockId: string }   // capability op
  | { kind: 'callProcedure'; name: string; args: Expr[]; blockId: string };          // YB-7, FN gate

type Expr = { type: Type; blockId: string } & (
  | { kind: 'int'; value: number } | { kind: 'bool'; value: boolean } | { kind: 'str'; value: string }
  | { kind: 'variable'; variable: string }                  // or a parameter inside a function (FN4)
  | { kind: 'arith'; op: '+' | '-' | '*' | '//' | '%'; left: Expr; right: Expr }
  | { kind: 'compare'; op: '==' | '!=' | '<' | '<=' | '>' | '>='; left: Expr; right: Expr }
  | { kind: 'logic'; op: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'not'; value: Expr }
  | { kind: 'join'; parts: Expr[] }                         // ≤ MAX_TEXT_JOIN_PARTS
  | { kind: 'randomInt'; from: Expr; to: Expr }
  | { kind: 'read'; op: OpId; args: Expr[] }                // capability read (button, sensor, pin…)
  | { kind: 'callFunction'; name: string; args: Expr[] });  // YB-7, FN gate

// Capability-specific operands: NOT values (F3-A). They come only from block fields, are validated by
// the op's construct spec, and can never be stored, compared, printed or passed to a function.
type OpOperand =
  | { kind: 'image'; image: { source: 'builtin'; id: string } | { source: 'custom'; frame: FrameData } }   // §6.8
  | { kind: 'melody'; melody: { source: 'builtin'; id: string } | { source: 'notes'; notes: NoteData[] } }; // §6.8

type FunctionDef = {                                        // §6.10
  name: string; kind: 'procedure' | 'function';
  params: { name: string; type: 'int' | 'str' }[];          // ≤ 8
  body: YbcStatement[];
  returnValue?: Expr;                                       // required for 'function' (FN5), absent for 'procedure'
  blockId: string;
};
```

- Invariant **chỉ của dialect YBC:** mọi `Expr` mang `type ∈ {int, bool, str}`. Không có node float, image hay `None` trong `Expr`.
- Không có statement `return`/early return (FN6), không `break`/`continue` (chưa có trong milestone).
- Mọi node có `blockId`. IR không persist.

### 9.2 Capability op, event

- `OpId` thuộc đúng một construct spec và một capability (§10). `OpOperand` chỉ hợp lệ với op mà construct spec của nó khai báo nhận operand đó.
- `Handler` chỉ có khi gate EV đạt.

### 9.3 Runtime value (`src/core/program/values.ts`, chỉ dialect YBC)

`Value = { t: 'int'; v: number } | { t: 'bool'; v: boolean } | { t: 'str'; v: string }`. Mọi phép toán đi qua một module duy nhất cài đặt §6.4 và §6.7. Operand hình/giai điệu không phải `Value`. Bảng test ngữ nghĩa ở §18.3.

### 9.4 Compiler YBC theo bảng construct

- `compileYbcProgram` giữ các luật C1–C8 của PoC (không throw, diagnostics có `blockId`, độ sâu ≤ 100) và dùng **bảng `blockType → compile`** lấy từ construct spec. Compiler generic **không** dùng bảng này (§9.0).
- **Construct spec** (`src/core/constructs/*`): `{ id, blockTypes, capability, contractId, compile, check (type/domain), run, python }`. Một spec ứng với một dòng contract. `python` được thêm từ YB-5A.
- **Test completeness/EG** chứng minh đủ bốn lớp và eligibility cho mọi block của mọi profile.
- **Diagnostic mới:**
  - compile: `not-in-profile`, `not-eligible`, `type-mismatch`, `float-not-supported`, `descending-range-not-supported`, `value-out-of-range` (literal), `display-char-unsupported`, `capability-unavailable`, `program-too-large`, `missing-return-value`, `recursion-not-supported`, `wrong-call-arity`;
  - runtime: `out-of-domain`, `limit-exceeded`, `zero-division`, `internal-error`;
  - board context: `no-board`, `multiple-boards`, `incompatible-devices`.

---

## 10. Capability composition — đóng F8

Bỏ ý tưởng một `HardwareIO` nguyên khối. Thay bằng **interface theo capability**, ghép theo board và profile:

```ts
// src/core/capabilities/*.ts
interface DigitalIO   { digitalWrite(pin: string, level: 0 | 1): void; digitalRead(pin: string): 0 | 1 }   // = today's HardwareIO
interface AnalogInIO  { analogRead(pin: string): number }            // 0..4095 native (contract C-25, C-Q6 = A)
interface PwmIO       { pwmWrite(pin: string, value: number): void }
interface DisplayIO   { setFrame(frame: Frame): void; setBrightness?(level: number): void }
interface ButtonIO    { isPressed(id: ButtonId): boolean; takePresses?(id: ButtonId): number }
interface SoundIO     { startTone(hz: number): void; stopTone(): void }
interface LightIO     { lightLevel(): number }
interface TemperatureIO { temperature(): number }
interface MotionIO    { acceleration(axis: 'x' | 'y' | 'z'): number; gesture?(): string | null }
interface ServoIO     { servoWrite(pin: string, angle: number): void }
interface PulseIO     { pulseIn(pin: string, level: 0 | 1, timeoutUs: number): number }

type Capabilities = {
  digital?: DigitalIO; analogIn?: AnalogInIO; pwm?: PwmIO; display?: DisplayIO; buttons?: ButtonIO;
  sound?: SoundIO; light?: LightIO; temperature?: TemperatureIO; motion?: MotionIO; servo?: ServoIO; pulse?: PulseIO;
};

// Runtime services: not hardware, provided by RunSession to every program
interface RuntimeServices { clock: Clock; console: ConsoleSink; budget: ExecutionBudget; sleep: Sleep; scheduler: RunScheduler }
```

**Luật:**
- **Board chỉ cài đặt capability nó thật sự có.** Generic: chỉ `digital`. `ybc-board`: capability suy ra từ `onboard` và capability của chân, giao với `profile.constructs`.
- `HardwareIO` hôm nay trở thành alias của `DigitalIO`. Interpreter legacy (`runProgram`, §9.0) và test double cũ (`{ digitalWrite, digitalRead }`) **không phải đổi**, và không phải cài đặt peripheral Yolo:Bit. Chỉ `runYbcProgram` nhận `Capabilities` + `RuntimeServices`.
- **Kiểm trước khi chạy:** compiler nhận `CapabilitySet` từ `BoardContext.readiness`. Construct cần capability không có → `capability-unavailable` lúc compile, cũng chặn generation. Runtime không bao giờ tới một capability vắng mặt.
- Timing (chạy chữ, thời lượng nốt) nằm ở `run` của construct, dùng `RuntimeServices.sleep`/`scheduler`, vì nó là ngữ nghĩa Yolo:Bit chứ không phải phần cứng.
- `RunSession` vẫn là nơi duy nhất ghép `Capabilities` + `RuntimeServices` và nối với simulation (B5). Nó thêm `setComponentInput` (tổng quát hoá `setContactInput`, giữ wrapper), run scheduler (huỷ khi Stop) và console ring buffer. Seam event chỉ có khi EV đạt.

---

## 11. Simulator signal/peripheral model

### 11.1 Header pin: signal-level

- `pinOutputs` → `Record<pin, PinDrive>`, `PinDrive = { kind: 'digital'; level } | { kind: 'pwm'; value }`. Giá trị cũ `0 | 1` chuẩn hoá thành `digital` → kết quả generic không đổi (GB4). *(YB-4: PWM EXCLUDED nên không có biến thể `pwm`; `pinOutputs` giữ `0 | 1`. Xem ghi chú triển khai YB-4 #2.)*
- Net có `level` (như cũ), cộng `analog?: number` (0..1) và `duty?: number`.
- `analog-source` (biến trở 3 chân): `out = slider` khi VCC high và GND low. `analogRead` theo §11.3: net analog → `percentToRaw`; net `high` → giá trị tối đa của thang, net `low` → 0, **chỉ khi** contract đã xác nhận thang (`OF-range`); nếu không thì analog read không qua EG.
- **Net floating hoặc conflict trên `ybc-board`** (digital hay analog): phần cứng thật cho giá trị phụ thuộc pull-up/pull-down hay nhiễu, nên simulator **không đoán**. Đọc chân như vậy → `out-of-domain` (domain guard), trừ khi contract có evidence về pull mặc định (`OF-return` của C-24/C-25); khi đó mô phỏng đúng evidence. Board **generic** giữ quy tắc cũ "floating đọc ra 0" (GB4), vì nó không có code target.
  > **N17 B4 (owner, 2026-10-19):** quyết định owner thay cho evidence còn thiếu: **đọc on/off (digital) một net floating trả 0** (như có pull-down) và chương trình chạy tiếp, kèm cảnh báo một lần mỗi chân mỗi lần chạy ("Chân P1 đang thả nổi — đọc là 0. Hãy nối nút với 3V3 hoặc GND."); pull của board ghi **UNVERIFIED** (C-24 `default`, contract §26). Conflict, chân chương trình tự ghi, và đọc **analog** net floating vẫn `out-of-domain`.
- PWM: chân có capability `pwm` (theo contract) drive duty; LED ngoài render độ sáng tuyến tính (`presentation`).
- Vẫn là tín hiệu/logic, không phải điện.

### 11.2 Peripheral onboard

- Không đi qua netlist; chân dùng nội bộ nằm trong `reservedPins`.
- State output (frame display, tone) là runtime state của run, được đưa vào `simulateCircuit` và trả ra ở `components['<board>/<peripheral>']`. Renderer **chỉ đọc snapshot**.
- Model: `matrix-display` (cấu hình theo display model của contract), `button`, `buzzer`, `light-sensor`, `temperature-sensor`, `accelerometer`.

### 11.3 Runtime control và chuyển đổi

| Control | Dùng cho | Thao tác | Giá trị core |
|---|---|---|---|
| `hold` | Nút A/B, nút ngoài | pointer down/up; Space/Enter khi focus | `closed: boolean` |
| `slider` | Ánh sáng (%), nhiệt độ, biến trở (%), khoảng cách | `<input type=range>` có nhãn | số nguyên trong `[min, max]`, chặn ở biên |
| `tilt` | Gia tốc kế | tilt pad + phím mũi tên | `{x, y}` theo thang contract |
| `gesture` | Lắc | nút "Shake" | sự kiện một lần |

Mọi chuyển đổi nằm ở **một module** `src/core/simulation/conversions.ts` (investigation §18.2, cập nhật theo **C-Q6 = Option A**, 2026-10-14):
- `percentToRaw(p) = percentToNative(p, 4095) = floor(clamp(p, 0, 100) × 4095 / 100 + 0.5)` (analog read native 0–4095; không chuẩn hoá về 0–1023);
- `rawToPercent(r) = floor(r × 100 / 4095 + 0.5)` (chỉ để hiển thị);
- `percentToNative(p, N) = floor(clamp(p, 0, 100) × N / 100 + 0.5)` với `N` từ contract;
- ~~`duty = raw / 1023`~~: không dùng, PWM EXCLUDED (contract C-26).

Analog write/PWM: **không có trong milestone** (C-26 EXCLUDED), nên không có domain ghi analog. *(N17 B5: PWM mở ở Advanced: duty 0..1023 trên net, `brightness = duty / 1023` của LED (`dutyToBrightness`), ngoài khoảng kẹp + cảnh báo; contract §27.)* Đọc analog: giá trị `0..4095` (net `high` → 4095, `low` → 0, analog-source → `percentToNative(p, 4095)`; net hở/xung đột → `out-of-domain`, §11.1).

> **YB-0:** PWM/analog write **EXCLUDED** (contract C-26). Analog read có thang native 0–4095 theo tài liệu OhStem; **owner chọn C-Q6 = Option A** (2026-10-14): learner dùng thang native, UI 0–100 %.

### 11.4 Snapshot

- `ComponentState` mở rộng: `{ lit?, brightness?, closed?, value?, frame?, hz?, angle? }`.
- Generic: `nets`/`components`/`pinReads` giữ nguyên (GB4).
- Snapshot chỉ phát khi có thay đổi; ≤ 1 commit React mỗi frame; console nằm trong snapshot dạng ring buffer (§6.7).

### 11.5 Âm thanh

- Core chỉ biết `hz` và thời điểm. WebAudio là renderer ở UI, đọc snapshot.
- Mặc định tắt; bật bằng thao tác người dùng; âm lượng có trần.
- Luôn có chỉ báo hình kèm text (§19).

---

## 12. Blockly/toolbox architecture

| Chủ đề | Thiết kế |
|---|---|
| Block pack | Data trong core: block JSON + category + construct spec. Pack: `ybc.structure`, `ybc.display`, `ybc.input`, `ybc.sound`, `ybc.pins`, `lang.logic`, `lang.loops`, `lang.math`, `lang.text`, `lang.variables`, `lang.functions` |
| Block type | Phần cứng: `ybc_*`. Ngôn ngữ: built-in của Blockly (`controls_if`, `controls_repeat_ext`, `controls_whileUntil`, `logic_compare`, `logic_operation`, `logic_negate`, `logic_boolean`, `math_number`, `math_modulo`, `math_random_int`, `text`, `text_join`, `variables_get/set`, `procedures_*`), cộng block của mình `ybc_arith` (+ − ×), `ybc_while` (chỉ "while", không có biến thể "until" của `controls_whileUntil`), `ybc_count_up`, `ybc_int_divide`, `ybc_wait_ms`. Hat dùng chung: `stem_on_start`, `stem_forever` |
| Biến thể bị ẩn | Mỗi dropdown learner thấy được chỉ có biến thể thuộc domain: block built-in có biến thể ngoài domain (`math_arithmetic`: DIVIDE, POWER) **không dùng**, thay bằng block riêng (`ybc_arith`). Block built-in vẫn được đăng ký toàn cục để document load được (L-1) và **không bao giờ** bị đổi giá trị hay migrate; nó không nằm trong toolbox/profile, và compiler từ chối (`float-not-supported` cho DIVIDE/POWER, `unsupported-construct` cho phần còn lại). Test đọc dropdown từ block Blockly thật (`tests/ybc-dropdowns.test.ts`) |
| Đăng ký | Hợp mọi pack, một lần (S2). Dropdown chân `ybc_*` lấy từ chân của `ybc-board` (đã bỏ `reservedPins`, lọc theo capability) |
| Toolbox | Theo `BoardContext` (R-F6): generic → toolbox cũ; ybc → `profile.blockPacks`. Variables/Functions là category động |
| Kiểu biến | Basic: mọi biến `int`. Advanced: kiểu tĩnh suy ra lúc compile. Blockly variable type không dùng để enforce (enforce ở compiler) |
| Kiểm lúc mở (tầng L-1) | `canOpenProgram(blocks)` là kiểm **cấu trúc**: load vào workspace headless đã đăng ký **hợp mọi pack** (không lọc theo profile), để document đã hạ profile vẫn mở được (§8.6). Preflight `isBoundedForBlockly` thành **allowlist có ngân sách** cho từng mutator: `controls_if` (như cũ), `text_join` (`itemCount` nguyên, không âm) và `controls_if` (`elseIfCount`), mỗi block ≤ `maxMutatorItemsPerBlock`, tất cả cộng lại ≤ `maxTotalMutatorItems`. Hai trần này là giới hạn **cấu trúc** (chống DoS), không phải giới hạn ngôn ngữ, và tách theo hai chi phí. **Mỗi block** mutator (một `text_join` hoặc một `controls_if`): `maxMutatorItemsPerBlock` = 2 × `MAX_PROGRAM_BLOCKS` = 4000, vì Blockly dựng input của một block theo thời gian bậc hai (đo: 4 000 phần 22 ms, 8 000 phần 100 ms, 100 000 phần 26 s); mỗi phần của join và mỗi else-if của program chạy được là một block của nó nên không block nào chạm trần. **Cả document**: `maxTotalMutatorItems` = `MAX_PROGRAM_BLOCKS` × `MAX_TEXT_JOIN_PARTS` = 100 000, vì nhiều block nhỏ tốn xấp xỉ tuyến tính (2000 join × 50 phần: 40–75 ms). Tổng phải lớn vì editor lưu cả block mà compiler bỏ qua (block rời ngoài `on start`/`forever`, block bị disabled): join/if của chúng không nằm trong 2000 block của program chạy, nhưng document vẫn phải mở lại (review YB2B-R3). 50 phần là giới hạn của Run (L-3), không phải của việc mở, vì mutator tạo được 51, `procedures_*` (tham số ≤ 8, ≤ 50 hàm), cộng tổng ≤ `MAX_PROGRAM_BLOCKS`. Mỗi giới hạn có test chống DoS (bài học F1/F4 của POC-14). Profile được kiểm ở tầng L-2, không phải ở đây |
| Profile | Block ngoài profile → `not-in-profile` (lỗi compile, không phải Blockly throw) |
| Text | Message theo key (tiếng Anh), sẵn cho i18n |
| Field tuỳ biến | Ô vẽ hình: `src/ui/blockly/fields/`, serialize thành JSON thuần |
| Highlight | `blockId` đang chạy/lỗi qua snapshot (NICE) |

---

## 13. Yolo:Bit MicroPython generator

Subsystem first-class trong `src/core/codegen/yolobit/`: TS thuần (B1), không Blockly (B4), không chạy Python.

### 13.1 Input
`ProgramIR` đã compile OK cho profile `ybc-*`, với `BoardContext.readiness.ok`, `GenTarget = { id: 'yolobit-micropython'; contract: '<version/snapshot>' }`.

### 13.2 Output
```ts
type GenerateResult =
  | { ok: true; source: string; lineMap: { line: number; blockId: string }[]; names: Record<string, string>; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };
```

### 13.3 Cấu trúc file (thứ tự cố định)

1. Comment cố định: `# Generated by STEM Studio for Yolo:Bit MicroPython (contract <version>)`. Không timestamp, không text của learner.
2. Import theo thứ tự chuẩn của contract; chỉ import thứ được dùng (trừ khi contract bắt buộc).
3. Preamble, nếu contract yêu cầu.
4. Khởi tạo biến (`name = 0`, hoặc `name = ''` với `str` ở Advanced), theo thứ tự `variables`.
5. Hàm (Advanced, chỉ khi gate FN đạt, §6.10): mọi `def` đứng **trước** mọi code thực thi ở top level (FN10); `global` cho mọi biến toàn cục bị gán trong thân, không bao giờ cho tham số (FN4); function kết thúc bằng đúng một `return <biểu thức>` (FN5/FN6).
6. Handler + đăng ký (chỉ khi EV đạt).
7. Statement của `on start` ở top level.
8. Nếu có `forever`: `while True:` … `time.sleep_ms(10)`. Nếu không có `forever`: **vẫn sinh vòng chờ rảnh** `while True:` + `time.sleep_ms(10)`. Như vậy vòng đời trên board được xác định bởi code (né C-41), khớp E6 của simulator: board vẫn "chạy" cho tới khi Stop/reset.

### 13.4 Định dạng, tập con cú pháp, tính xác định

- **Tập con cú pháp Python mà generator được dùng (frozen).** Chọn để CPython và MicroPython đều chấp nhận như nhau.
  - Statement: gán, `if/elif/else`, `while`, `for … in range(…)`, `def`/`return`/`global`, expression statement, `import`, `from … import *`, `pass`.
  - Biểu thức: literal số nguyên, chuỗi (nháy đơn), `True`/`False`; tên, lời gọi, thuộc tính, `+ - * // %`, so sánh, `and/or/not`, ngoặc. `None` chỉ được xuất hiện khi nó là một phần dạng gọi API của contract (vd. preamble), không bao giờ là giá trị của learner (§6.4). Cũng chỉ trong dạng gọi API của contract: list literal và đối số từ khoá (vd. `music.play(['C4:4'], wait=True)`, C-50/C-51, YB-3).
  - Không dùng: f-string, `:=`, type hint, comprehension, `lambda`, `nonlocal`.
- **Suite rỗng** (vd. `if` không có thân) → sinh `pass`.
- 4 dấu cách (PEP 8), LF, UTF-8, xuống dòng cuối file, không khoảng trắng cuối dòng.
- **Chuỗi:** nháy đơn; escape `\\`, `\'`, `\n`, `\r`, `\t`, các ký tự điều khiển khác thành `\xNN`. Ký tự ngoài ASCII giữ dạng UTF-8 (đã kiểm charset với display ở compile).
- **Xác định:** cùng `(IR, target, profile)` → cùng byte. Có test chạy hai lần và test xáo thứ tự key.

### 13.5 Tên

- Tên Blockly → ASCII: bỏ dấu (`đ → d`), ký tự lạ → `_`, chữ số đầu → thêm `v_`.
- Không bao giờ dùng tên bắt đầu bằng `_` cho tên của learner (dành cho biến nội bộ của generator, vd. bộ đếm của `repeat`).
- Tránh keyword, builtin, mọi tên trong contract, helper. Trùng → `_2`, `_3` theo thứ tự xác định.

### 13.6 Lỗi

- Không throw. Node không hỗ trợ / không eligible / float → `ok: false` kèm `blockId`. **Không bao giờ sinh code dở dang** hay lời gọi rỗng (K4).
- Readiness không `ok` → `ok: false`, cùng diagnostic như Run (R-F5).

### 13.7 UI (Python panel)

- `<pre>` read-only có số dòng; cập nhật debounce 250 ms khi compile OK, ngược lại hiện diagnostics.
- Nút Copy và Download `.py`. Tên file `main.py` chỉ dùng khi contract xác nhận Yolo:Bit chạy `main.py` lúc khởi động; ngược lại dùng `program.py`.
- Câu tuyên bố đúng mức đạt được (§6.9; L2 PENDING thì nói rõ).
- Nhúng: §17.3.

### 13.8 Golden test

- `__golden__/<case>.py` so khớp chính xác bằng `toMatchFileSnapshot` (Vitest; không thêm package).
- Cập nhật golden chỉ bằng lệnh tường minh; mọi diff golden phải được review.

### 13.9 Syntax check bắt buộc cho L2, allowlist, parity — đóng F5

- **Chiến lược thực thi được** (chọn và chạy được **trước khi nghiệm thu YB-5A**):
  - script `scripts/check-python-syntax` duyệt mọi `__golden__/*.py` và mọi `expected.py` của fixture;
  - checker cấu hình được: **ưu tiên `mpy-cross`** (trình biên dịch của MicroPython, gần đích hơn: kiểm cú pháp/biên dịch MicroPython), **dự phòng CPython 3** (`ast.parse`, chỉ kiểm cú pháp);
  - chế độ CI (`--require`) **exit ≠ 0** nếu không có checker → báo **L2 = PENDING**, không bao giờ PASS.
- Cài công cụ ngoài npm (Python/`mpy-cross`) trên dev/CI cần owner đồng ý (OQ-B). Chưa đồng ý → L2 PENDING; mọi phần khác của YB-5A vẫn nghiệm thu được.
- Syntax check **không** chứng minh tương thích runtime MicroPython/Yolo:Bit (§6.9).
- **Case syntax bắt buộc:**
  - suite rỗng (`pass`);
  - chuỗi có `\\`, `\'`, `\n`, ký tự điều khiển;
  - Unicode trong `print`;
  - tên đã làm sạch (dấu tiếng Việt, trùng keyword/API, chữ số đầu);
  - biểu thức lồng sâu (100 tầng);
  - `if/elif/else`;
  - `repeat`/`while`/`countUp`;
  - (Advanced) `def` + `global` + `return`;
  - file có/không có `forever`.
- **API allowlist** (K2): tokenizer trong test thu `import`, `from … import`, `name(`, `obj.attr`, rồi đối chiếu với allowlist sinh từ contract + tên của learner + builtin cho phép (`print`, `range`, `str`, `int`, `len`, contract IM-9) + tên tạm của generator (`_r…`, `_cu_start_k`, `_cu_end_k`).
- **Parity:** P1–P11 so với output OhStem (YB-0) sau khi chuẩn hoá; mọi khác biệt được giải thích trong contract.

---

## 14. Basic curriculum profile (`ybc-basic`)

**Tier = ý định giáo trình. Mở hay không do EG quyết (§6.2).** Cột "YB-0" là kết quả eligibility (contract §16): **E** ELIGIBLE, **R** RESTRICTED, **X** EXCLUDED, **D** DEFERRED.

| Capability | Tier | Giá trị giáo trình | YB-0 (contract) | Thu hẹp | Effort | Phase |
|---|---|---|---|---|---|---|
| `on start`, `forever` | MUST | Khung | E (C-01, C-02) | — | S | YB-1/2 |
| `wait` (ms) | MUST | Thời gian | E (C-04) | `int` 0..60000 | S | YB-2 |
| Biến `int`, gán | MUST | Đếm, trạng thái | E (C-30) | — | M | YB-2 |
| `if/elif/else`, so sánh, `and/or/not` | MUST | Rẽ nhánh | E (C-34–C-36) | — | S | YB-2 |
| `repeat`, `while`, `count up` | MUST | Lặp | E / R (C-37–C-39) | `repeat`: `abs(N) ≤ MAX_REPEAT_ABS`. Count up: đánh giá start rồi end, mỗi cái một lần; `0 ≤ start, end ≤ MAX_RANGE_VALUE`; step literal (§6.5) | M | YB-2 |
| `+ − ×`, `//`, `%` | MUST | Tính toán | E (C-31–C-33) | safe-int (§6.4) | M | YB-2 |
| Random int | MUST | Trò chơi | **X** (C-40) | `random.randint` chưa có evidence trên firmware. Domain đặc tả sẵn (§6.4) để mở lại khi có evidence | — | — |
| Text literal, nối, `print` | MUST | Debug, kết quả | E (C-29, C-56) | — | S | YB-2 |
| Hiện hình **tự vẽ** (hình dựng sẵn bị loại, §6.8) | MUST | Output đầu tiên | R (C-06) | 5×5, ô bật = đỏ (`1`) / tắt (`0`) | M | YB-3a |
| Xoá display | MUST | | E (C-09) | — | S | YB-3a |
| Chạy chữ / hiện số | MUST | Hiện kết quả | R (C-07, C-08) | ASCII 0x20–0x7E; 1 ký tự tĩnh; n ≥ 2: 1200·n ms, font tự vẽ | M | YB-3a |
| Nút A/B đang nhấn | MUST | Input đầu tiên | R (C-12) | A, B riêng; **không A+B** | S | YB-3a |
| **Phát nốt / nghỉ (chặn)**, thay cho "phát tần số + dừng" | MUST | Âm thanh | R (C-50, C-51) | 15 nốt C3…C5 tự nhiên; 1/2/4 tick @ `set_tempo(4, 120)` = 125/250/500 ms. `pitch`/`stop` **X** | M | YB-3b |
| Mức sáng (slider %) | MUST | Cảm biến | E (C-15) | `int` 0..100, slider đồng nhất | S | YB-3b |
| Header: digital write/read | MUST | Mạch ngoài | R (C-23, C-24) | **Chỉ P0, P1, P2**; đọc → `bool`; net hở/xung đột → `out-of-domain` | M | YB-4 |
| Analog read (biến trở) | MUST | Analog | R (C-25) | P0–P2; native **0..4095** (C-Q6 = A); slider 0–100 %; `int(...)` | M | YB-4 |
| PWM (độ sáng LED ngoài) | MUST | Fade | **X** (C-26) | Khoảng `write_analog` UNKNOWN; owner xác nhận vẫn loại (C-Q6) | — | — |
| Python panel | MUST (D6) | Sang text | — | — | M | YB-5A |
| Runtime control (giữ A/B, slider) | MUST | Tương tác | — | — | S–M | YB-CP/3/4 |
| Số lần nhấn | NICE | Đếm | R (C-13) | A, B; đếm ở cạnh nhấn, reset khi đọc | S | YB-3a |
| Giai điệu **tự viết** (§6.8) | NICE | Hấp dẫn | R (= chuỗi C-50/C-51) | Giai điệu dựng sẵn **X** | M | YB-3b |
| Thời gian chạy | NICE | Phản xạ | **X** (C-19) | Wrap/reset/khoảng phép trừ UNKNOWN → LATER | — | — |
| Map range (biểu thức `//` nội tuyến) | NICE | Đổi thang | E (ngôn ngữ) | — | S | YB-2 |
| Highlight block đang chạy | NICE | Hiểu luồng | — | — | S | YB-5B |
| Nhiệt độ, vẽ hình tự do | → Advanced | | | | | YB-7 |
| Event nút | → Advanced | | **D** (gate EV) | | | — |
| Float, `/`, `round`, đếm xuống, biến text, màu/độ sáng, chân cảm ứng, PWM, A+B, random, thời gian chạy | LATER / X | | | | | — |

**Bài học** (key đề xuất, freeze ở YB-6). YB-0 đã thay/bỏ những bài phụ thuộc construct bị loại. Hình và nốt trong bài là **tự làm** (§6.8).

> **N6a (2026-10-16):** key đã ship cho STEMLearning là `ybc-heart`, `ybc-button-ab`, `ybc-night-light`, `ybc-melody`, `ybc-empty` (CourseService `LabTemplateCatalog`), thay cho danh sách đề xuất dưới đây; các bài còn lại là backlog của YB-6. ~~B9 vẫn chờ quyết định của owner.~~ **N17 B4:** owner đã quyết định cho B9: net hở đọc 0 + cảnh báo (§11.1 ở trên, contract §26).

| Bài | Key | Nội dung (sau YB-0) | Construct | Ghi chú YB-0 |
|---|---|---|---|---|
| B1 | `ybc-hello` | Hiện hình **tự vẽ**, rồi chạy chữ ASCII | display | Hình dựng sẵn → hình tự vẽ |
| B2 | `ybc-blink` | Hình tự vẽ nhấp nháy (hiện / xoá) | display, wait | Giữ |
| B3 | `ybc-button` | A → hình A, B → hình B (polling) | nút, if | Không dùng A+B |
| B4 | `ybc-counter` | Đếm số lần nhấn (biến trạng thái phát hiện cạnh), chạy số, `print` | biến, so sánh | Giữ |
| B5 | `ybc-countdown` | Đếm ngược bằng `repeat` + biến giảm dần, **nốt báo** | `repeat`, biến, nốt | Âm báo = C-50 |
| B6 | `ybc-night-light` | Ánh sáng < ngưỡng (thang 0..100) → hình đèn | cảm biến | Giữ |
| B7 | `ybc-alarm` | Nút → **chuỗi nốt/nghỉ** theo nhịp | nốt, vòng lặp | `pitch` → C-50/C-51 |
| B8 | `ybc-pin-led` | LED ngoài trên **P0** nhấp nháy | header digital | Chỉ P0–P2 |
| B9 | `ybc-pin-button` | Nút ngoài trên P1 → display | header digital read | **Điều kiện:** chân đọc phải luôn được drive (không hở/xung đột), vì net hở → `out-of-domain`. *(YB-4: với nút SPST và mô hình không có pull, điều kiện này **không đạt được**; cần quyết định của owner trước YB-6, xem ghi chú triển khai YB-4 #9.)* **N17 B4:** điều kiện bỏ: nút SPST giữa P1 và 3V3 chạy được, nhả ra P1 đọc 0 + cảnh báo một lần (contract §26) |
| B10 | `ybc-knob` (thay `ybc-dimmer`) | Biến trở trên P1 → LED P0 bật/tắt theo ngưỡng (0..4095) | analog read, digital write | PWM bị loại; thang native 0–4095 (C-Q6 = A) |
| — | `ybc-basic-empty` | Project Basic trống | — | Giữ |

---

## 15. Advanced curriculum profile (`ybc-advanced`)

Advanced = Basic ∪ dưới đây; mỗi dòng phải qua EG trước khi mở. Cột "YB-0" theo contract §17.

| Capability | Tier | YB-0 (contract) | Thu hẹp / lý do | Phase |
|---|---|---|---|---|
| Display: đặt/tắt điểm, vẽ hình tự do | MUST | R (C-10, C-42, C-06) | x, y ∈ 0..4; 8 màu bảng; hình qua `Image` `0`/`1` | YB-7a |
| Màu display | MUST nếu EG đạt | R (C-10, C-43) | Chỉ 8 màu hex của bảng editor | YB-7a |
| Độ sáng display | MUST nếu EG đạt | **X** (C-11) | Không quan sát được → LATER | — |
| Gia tốc x/y/z, nghiêng | MUST | **X** (C-17) | `OF-range`, `OF-coord` UNKNOWN → LATER | — |
| Lắc (polling) | MUST | **X** (C-18) | Tiêu chí UNKNOWN → LATER | — |
| Nhiệt độ | MUST | R (C-16) | Sinh `int(temperature())`, °C, slider 0..50 | YB-7b |
| Biến `str` (kiểu tĩnh), thao tác text (độ dài, nối) | MUST | E / R (C-56–C-58) | `len` chỉ chuỗi ASCII; giới hạn §6.7 | YB-7b |
| Hàm: procedure và function | MUST, sau gate FN | R (C-59) | **FN1–FN10 DOCUMENTED** (contract §3.1); test §18.3b vẫn bắt buộc | YB-7b |
| Thời gian chạy, timer | MUST | **X** (C-19, `timer.*`) | Wrap/reset/khoảng phép trừ của `running_time()` UNKNOWN (review R3) → LATER | — |
| Nốt nhạc, giai điệu | MUST | R (C-50, C-51) | Giai điệu tự viết = chuỗi nốt/nghỉ chặn; dựng sẵn **X** | YB-7b |
| Servo (linh kiện ngoài) | MUST | R (C-27) | Loại 180°, 0..180, P0–P2; 270/360 **X** | YB-7c |
| Siêu âm (linh kiện ngoài) | MUST nếu đo được, ngược lại LATER | **X / LATER** (C-28, C-69) | `pulse_in` timeout UNKNOWN, không có trigger µs | — |
| **Event** (nhấn nút, lắc) | Có điều kiện | **DEFERRED** (C-14) | Gate EV không đạt (contract §13) | — |
| List | NICE | X | Không có contract | — |
| Biểu đồ display, chân cảm ứng | NICE | X (C-44, C-48) | `OF-content` / ngưỡng UNKNOWN | — |
| Module cần thư viện (NeoPixel, OLED, DHT…), game, giao tiếp | LATER | X | K3 | — |

**Bài học** (key đề xuất, freeze ở YB-8):
- `ybc-adv-dice`: **hoãn**. Cần random (C-40 EXCLUDED) và lắc (EXCLUDED);
- `ybc-adv-level` (nghiêng → điểm sáng): **hoãn**, gia tốc kế bị loại;
- `ybc-adv-thermometer`: `int(temperature())`, chạy số, ngưỡng;
- `ybc-adv-reaction`: **viết lại (r2)** thành trò phản xạ **hai người**. Procedure `countdown()`, function `winner()` trả 1/2 bằng polling A/B, hiện người thắng. Không thời gian chạy, không random, không event;
- `ybc-adv-servo`: servo 180° trên P0;
- `ybc-adv-parking` (siêu âm): **hoãn**, siêu âm bị loại;
- `ybc-adv-melody` (đề xuất mới): giai điệu tự viết bằng hàm + nốt;
- `ybc-adv-empty`.

---

## 16. Existing generic-board compatibility

| # | Bất biến | Kiểm bằng |
|---|---|---|
| GB1 | Definition `board`, `led`, `resistor`, `push-button` không đổi nội dung (thêm `family` mặc định là ngầm, không ghi vào file) | Snapshot definition (YB-1, trước refactor) |
| GB2 | Block `stem_*` và toolbox generic không đổi | Snapshot |
| GB3 | IR của 4 sample generic không đổi | **Golden IR** (thêm đầu YB-1) |
| GB4 | Kết quả simulation của sample/scenario không đổi | Test hiện có + snapshot |
| GB5 | Năm template key, lỗi launch, contract nhúng không đổi | Test hiện có |
| GB6 | Project standalone generic đã lưu mở/lưu như cũ, kể cả 0 board và nhiều board | Persistence test + E2E-4 + ca §8.5 |
| GB7 | Mọi E2E hiện có xanh, không sửa assertion | `pnpm e2e` |
| GB8 | Generic không có Python panel, không có runtime control mới | E2E |
| **GB9** | **Palette của project generic giống hệt hôm nay** (không có `ybc-board`) | Test `palette-model` theo context + E2E |
| **GB10** | Test double `HardwareIO` cũ (`{digitalWrite, digitalRead}`) vẫn dùng được | Test interpreter/run-session hiện có không đổi |
| **GB11** | **Legacy generic IR không đổi, không migration:** Blockly JSON generic hiện có (4 sample, `empty`, fixture, program trong test) → `compileProgram` → IR deep-equal golden → `runProgram` → hành vi giống hệt; không node nào có `type` (§9.0) | Golden IR (chụp đầu YB-1) + test interpreter/run-session hiện có |
| **GB12** | Template `empty` (0 board) vẫn mở/sửa/lưu như hôm nay (tầng L-1); Run → `no-board` | Template test + E2E embed hiện có |

---

## 17. STEMLearning/template integration

### 17.1 Không đổi
`?embed=1&template=<key>`; lỗi key lạ; lab không lưu (Q10); `OnView` (Q7); không `postMessage`; không thêm quyền iframe.

> **N6a (2026-10-16):** phần "không `postMessage`" và `OnView` chỉ còn đúng cho URL S1 trên. Launch `lab=blockly|yolobit` (thêm `profile=`, `origin=`) có `stem-lab/v1` và Kiểm tra; host STEMLearning hoàn thành activity bằng `check-result` (`OnCheck`). Hợp đồng: docs/lab-embed-contract.md.

### 17.2 Thêm
- Key `ybc-*` (§14, §15), freeze trước khi đưa vào lesson; không đổi tên, không tái dùng.
- Template ybc khai báo `profile`. Mức kỳ vọng theo từng template ở §8.6: bài học `ybc-*` và `ybc-*-empty` → L-4; template generic giữ mức hôm nay (`empty` chỉ cần L-1).
- Danh sách template của CMS là config ở repo STEMLearning (`Web/AdminCms/Config/appsettings.json`, D-9): thay đổi ở repo kia, ngoài phạm vi code của plan này (OQ-C).
- Standalone: New → "Generic circuit" / "Basic" / "Advanced" (YB-6). Lab nhúng: luôn mở template.

### 17.3 Ràng buộc khung nhúng (S12)

| Vấn đề | Kế hoạch |
|---|---|
| Không có `allow-downloads` | Download có thể bị chặn (INFERRED; E2E với `lesson-host` có `sandbox` sẽ xác nhận). Bị chặn → ẩn hoặc báo; code vẫn chọn/copy tay được; link "Open the lab in a new tab" của StudentWeb mở đủ |
| Không có `clipboard-write` | Thử clipboard API; lỗi → chọn sẵn toàn bộ text + hướng dẫn Ctrl+C |
| Khung 1100×640 | Canvas trái; bên phải tab **Blocks / Python**; console thu gọn được; control nằm sát board. E2E chụp ở 1100×640 |
| Audio | Mặc định tắt; bật bằng click trong frame |

---

## 18. Verification strategy

**Nguyên tắc (N1):** một assertion chỉ trở thành bắt buộc ở phase mà tính năng nó kiểm **đã tồn tại**. Không phase nào phải pass test của tính năng phase sau. Từ YB-5A trở đi, cùng một fixture được chạy **qua cả interpreter lẫn generator** (regression kết hợp).

### 18.1 Các lớp test

| Lớp | Nội dung | Bắt buộc từ |
|---|---|---|
| Board context, các tầng hợp lệ | Ca §8.5 (cột YB-1); §8.6 tầng L-1/L-2/L-3; **cơ chế** giữ nội dung ngoài profile bằng **fixture test-only** §8.7 (unit) | **YB-1** |
| UI chọn profile thật | Chọn Basic ↔ Advanced, profile được lưu, toolbox/palette làm mới, load/save/reload, diagnostic bằng construct đã có (§8.6, hàng YB-6) | **YB-6** |
| Round-trip hạ profile với construct Advanced thật | 17 bước §8.6 (E2E + unit) | **YB-7** |
| Generic regression | GB1–GB12 | **YB-1** |
| E2E board/profile | Mở/sửa/lưu/reload, palette, toolbox, Run/Stop program rỗng | **YB-1** |
| Compiler (YBC) | Blockly JSON thật → YBC IR, diagnostics domain/profile/eligibility | **YB-2** |
| Interpreter/semantic (YBC) | YBC IR + timeline input → trace capability (fake clock) | **YB-2** |
| Domain/limits | §18.3 (phần compile/trace), §18.5 | **YB-2** |
| Generator golden + syntax + allowlist + diagnostic generator | §13.8–§13.9; golden được **bổ sung** cho mọi construct đã có từ YB-2 | **YB-5A** |
| Completeness + EG | Mọi block/template/construct được chấp nhận → spec đủ 4 lớp → dòng contract → field relevant ∈ {VERIFIED, DOCUMENTED} | **YB-5A** (và mỗi phase mở construct sau đó) |
| Cột "Python" của §8.5/§8.6 | Panel chặn với cùng diagnostic như Run | **YB-5A** |
| Shared contract | Type + test của 6 deliverable YB-CP | **YB-CP** |
| Hardware construct (onboard / pin) | Compile + trace + golden + syntax + EG, **cùng phase** với construct | **YB-3 / YB-4** |
| Semantic fixture đầy đủ + parity | §18.2 (mọi file), parity với OhStem | **YB-5B** (Basic), **YB-8** (Advanced) |
| Template theo mức kỳ vọng | §8.6 | **YB-6** (Basic), **YB-8** (Advanced) |
| Hàm (gate FN) | §18.3b | **YB-7** |
| Event (gate EV) | §18.6 | **YB-7**, chỉ khi gate đạt |
| Physical | §18.9 | YB-P |

### 18.2 Semantic fixture

```text
tests/compat/<id>/
  program.blocks.json   Blockly serialization (Blockly thật)
  profile.txt           ybc-basic | ybc-advanced
  inputs.json           timeline runtime input
  expected.trace.json   frame display, tone {hz, start, end}, print, pin drive, lỗi, theo ms
  expected.py           golden generator
  intent.md             program làm gì trên board thật (cho L3)
```

| File / assertion | Bắt buộc từ |
|---|---|
| `program.blocks.json` compile OK + `expected.trace.json` (fixture chỉ dùng ngôn ngữ) | YB-2 |
| `expected.py` golden + syntax + allowlist cho các fixture đó | YB-5A |
| Fixture có construct phần cứng: blocks + trace + `expected.py` | Phase của construct (YB-3/YB-4/YB-7) |
| `intent.md` + parity record | YB-5B (P1–P7), YB-8 (P9–P11; P8 DEFERRED ở YB-0) |

### 18.3 Ngôn ngữ (YB-2; cột golden từ YB-5A)

| Nhóm ca | Compile/trace (YB-2) | Golden Python (YB-5A) |
|---|---|---|
| **Range / count up** (§6.5, contract §3.3):<br>• `a < b` với `s = 1, 2, 3`; `a == b`; `a > b` literal → lỗi compile; `a > b` động → 0 vòng, biến giữ giá trị;<br>• `s = 0`, `s < 0`, `s` không literal, `s > MAX_RANGE_VALUE` → lỗi compile;<br>• cận literal `−1`, `1 000 001` → lỗi compile; cận động `−1`, `1 000 001` → `out-of-domain` (cận `a` vi phạm thì `b` **không** được đánh giá);<br>• biên `0`, `1 000 000`;<br>• **thứ tự đánh giá có side effect:** `a` = `số lần nhấn A`, `b` = `số lần nhấn A` (2 lần nhấn trước đó) → `a = 2`, `b = 0`, 0 vòng, mỗi lần đọc đúng một lần; Advanced: `a` = hàm in `S` trả 1, `b` = hàm in `E` trả 3 → console `S`, `E` rồi mới tới thân vòng; random (chỉ khi C-40 được mở lại) | ✓ | ✓: cận literal → `range(a, b+1)`; cận không literal → `_cu_start_k`/`_cu_end_k` đúng thứ tự; count up lồng nhau → `k` xác định; count up trong hàm → tên tạm không vào `global` |
| **Short-circuit có side effect:** `false and <presses A>` không tiêu số lần nhấn A; `true or <presses B>` không tiêu số lần nhấn B | ✓ (hardware read mock) | ✓ |
| **Biên số:** `2^53 − 1 + 1` → `out-of-domain`; nhân tràn; số âm lớn | ✓ | — |
| **`//` và `%`:** `±7 // ±2`, `±7 % ±3`, chia 0 → lỗi | ✓ | ✓ (khớp Python) |
| **Kiểu sai:** `int < str`, điều kiện `int`, gán `str` cho biến `int` (Basic), `str` + `int` không qua `join` → lỗi compile | ✓ | — |
| **Float:** literal `1.5`, DIVIDE/POWER trong JSON load từ ngoài → bị từ chối | ✓ | — |
| **`wait`:** −1, 0, 60000, 60001, giá trị động ngoài khoảng | ✓ | ✓ (ca hợp lệ) |
| **Random:** C-40 EXCLUDED ở YB-0 → compiler từ chối `math_random_int` (`not-eligible`). Ca domain đặc tả sẵn (`a > b`, `b − a > MAX_RANDOM_SPAN`, cận ±1 000 001) chỉ bắt buộc khi C-40 được mở lại | ✓ (`not-eligible`) | — |
| **Repeat:** `N = 0`, `N < 0`, `N` từ biến; `abs(N) = 1 000 000` hợp lệ; `abs(N) = 1 000 001` → lỗi compile / `out-of-domain` | ✓ | ✓ |
| **Escape chuỗi, làm sạch tên** (§13.9) | — | ✓ |
| **Generic IR không đổi** (GB11) | YB-1 | n/a |

### 18.3b Hàm — gate FN (YB-7)

Compile/trace/golden/syntax cho:
- procedure và function; dùng sai vị trí → lỗi;
- tham số `int`/`str` suy kiểu từ lời gọi; mâu thuẫn kiểu; sai số đối số;
- đối số đánh giá trái → phải, mỗi cái một lần;
- tham số trùng tên với biến toàn cục (tham số thắng trong thân, không có trong `global`);
- gán biến toàn cục trong thân → `global` trong golden, interpreter cập nhật biến toàn cục;
- ô RETURN trống → `missing-return-value`;
- `procedures_ifreturn` trong JSON → `not-in-profile`;
- đệ quy trực tiếp và gián tiếp → `recursion-not-supported`;
- gọi hàm khai báo sau trên workspace → hợp lệ (`def` đứng trước code top level);
- `MAX_CALL_DEPTH` (phòng thủ).

### 18.4 Tài sản/display/âm thanh (YB-3, YB-7; bắt buộc có cả Python theo R1)

- **Điểm ảnh:** frame simulator == dữ liệu hình (của mình hoặc đã có bộ ba) == ý nghĩa của Python sinh ra (hình tự định nghĩa: so ô theo ô).
- **Chạy chữ:** chuỗi frame và thời điểm khớp metric của contract (fake clock); charset ngoài → lỗi.
- **Âm thanh:** chỉ mapping đã mở (contract §8.2).
  - Mỗi nốt/nghỉ **chặn** C-50/C-51 → `music.play(['<N>:<t>'], wait=True)` / `music.play(['R:<t>'], wait=True)`, với `t ∈ {1, 2, 4}`. Preamble `music.set_tempo(4, 120)`.
  - Trace simulator: tần số theo bảng nốt → Hz của contract; thời lượng `t × 125` ms (fake clock); statement chặn đúng khoảng đó.
  - Giai điệu tự viết == chuỗi lệnh `music.play` một nốt trong Python.
  - **Không** có parity `pitch`/`stop`/giai điệu dựng sẵn ở YB-3/YB-7 trừ khi contract được sửa riêng để mở chúng.
- **Operand không phải giá trị:** JSON load từ ngoài cố đưa hình vào biến/so sánh/`print` → lỗi compile (F3-A).

### 18.5 Tài nguyên và Stop (YB-2, mở rộng ở YB-7)

- Tăng trưởng mũ của text (Advanced, YB-7): `s = join(s, s)` → `limit-exceeded` đúng lần vượt; không cấp phát chuỗi lớn (kiểm bằng spy/độ dài).
- Flood console (YB-2): `print` trong vòng chặt 10 s → ≤ 500 dòng, bộ nhớ ổn định, ≤ 1 commit/frame.
- Vòng chặt không `wait` (YB-2): UI vẫn phản hồi (có lần nhường mỗi ≤ 8 ms), Stop ≤ 100 ms.
- Stop khi đang nối text gần giới hạn (YB-2), đang chạy chữ / phát âm (YB-3), đang flood console (YB-2) → ≤ 100 ms; sau đó không còn output.
- (Khi có event, YB-7) Stop trong bão event.

### 18.6 Event (chỉ khi gate EV đạt, YB-7)

Phải có trace test cho:
1. nhấn A lặp lại nhanh;
2. A/B xen kẽ;
3. nhấn trong khi handler đang `wait`;
4. handler cập nhật biến dùng chung với `forever`;
5. program chỉ có event (không `forever`);
6. Stop trong lúc dispatch;
7. lỗi trong handler (theo EV7);
8. tràn hàng đợi (EV3);
9. golden cho handler + `global` + vòng chờ rảnh.

### 18.7 Program chuẩn

Đã xem lại ở YB-0 (2026-10-14, r2). Output OhStem của từng program và khác biệt dự kiến của generator mình: contract §18. Hình/nốt trong program là tự làm. Mọi program chỉ dùng construct ELIGIBLE/RESTRICTED.

| ID | Program (sau YB-0) | Profile | YB-0 | Lý do |
|---|---|---|---|---|
| P0 | 4 sample generic | generic | KEEP | — |
| P1 | hiện hình **tự vẽ**, rồi chạy chữ ASCII | Basic | REWRITE | Hình dựng sẵn bị loại (asset) |
| P2 | A/B đổi hình tự vẽ (polling) | Basic | REWRITE | Như P1; không A+B |
| P3 | hình / xoá nhấp nháy theo `wait` | Basic | KEEP | — |
| P4 | đèn ngủ: ánh sáng (0..100) < ngưỡng → hình | Basic | KEEP | — |
| P5 | **chuỗi nốt + nghỉ chặn**, giai điệu tự viết | Basic | REWRITE | `pitch` + `stop` bị loại (kết thúc/chồng tone UNKNOWN) |
| P6 | đếm nhấn (phát hiện cạnh), `print`, chạy số, `count up` 1..3 (literal, trong domain §6.5), `repeat 2` | Basic | KEEP | Không dùng random |
| P7 | header: biến trở P1 (0..4095) > ngưỡng → LED P0 bật/tắt | Basic | REWRITE | PWM bị loại; thang native 0–4095 (C-Q6 = A) |
| P8 | gia tốc: xúc xắc khi lắc, thước thuỷ | Advanced | DEFER | Gia tốc kế, lắc, random bị loại |
| P9 | servo P0 quét 0..180 bằng `count up` bước 30 (cận literal) | Advanced | REWRITE | Siêu âm bị loại |
| P10 | **r2:** trò phản xạ hai người. Procedure `countdown()` (3-2-1 rồi hình), function `winner()` trả 1/2 bằng polling A/B, hiện người thắng | Advanced | REWRITE | Event DEFERRED; thời gian chạy (C-19) và random (C-40) bị loại |
| P11 | nhiệt kế: `int(temperature())`, chạy số, ngưỡng | Advanced | REWRITE | Nhiệt độ trả float |

Milestone Basic (§24) nghiệm thu L1 cho P1–P7 **bản trên**.

### 18.8 Gate

| Gate | Điều kiện | Khi nào |
|---|---|---|
| L1 | Trace của program chuẩn xanh + E2E tập con | Cuối YB-5B (Basic), YB-8 (Advanced) |
| L2 | §6.9 đủ mọi điều kiện, **kể cả syntax check chạy thật**; thiếu công cụ → PENDING | Cùng thời điểm |
| L3 | §18.9 | YB-P |

### 18.9 Gate vật lý (sau)

- Dùng công cụ public (editor Python của OhStem App, hoặc công cụ MicroPython chuẩn) làm **transport kiểm chứng**, không phải tính năng sản phẩm.
- Ghi: board, firmware/snapshot (§7.7), ngày, người chạy, kết quả từng program.
- Thấy lệch → sửa simulator hoặc thu hẹp domain/loại construct, rồi cập nhật contract.

---

## 19. Accessibility/mobile/performance constraints

**Accessibility (MUST ở mỗi phase UI):**
- Control là phần tử native có nhãn. Giữ nút A/B bằng Space/Enter khi focus. Không có phím tắt toàn cục cướp phím của Blockly.
- Focus nhìn thấy được; thứ tự tab: toolbar → control → program → Python.
- Display có bản text (throttle). Console dùng `role="log"`. Âm thanh có chỉ báo hình + text.
- Màu không là kênh duy nhất. Python panel đọc/chọn được bằng bàn phím.

**Mobile/touch (tối thiểu):**
- pointer capture; `pointercancel` nhả nút; `touch-action: none` trên control;
- dùng được khi scale ≥ ~0,6; không có thông tin chỉ hiện khi hover;
- E2E với `hasTouch`.

**Performance:**

| Chỉ số | Mục tiêu |
|---|---|
| Run → frame display đầu | ≤ 100 ms |
| Nhấn → display đổi (polling) | ≤ 50 ms |
| Stop trong mọi tình huống §18.5 | ≤ 100 ms |
| Sai lệch frame chạy chữ (thời gian thật) | ≤ ±20 ms; fake clock: chính xác |
| Generator, program 300 block | ≤ 20 ms |
| Commit React | ≤ 1 mỗi frame |
| Bundle gzip tăng | ≤ 150 KB so với baseline YB-1 |
| Khởi động lab nhúng | ≤ baseline + 200 ms |

---

## 20. Security/runtime constraints

- Không `eval`/`new Function`; không chạy Python sinh ra.
- Generator: escape (§13.4), làm sạch tên (§13.5), không đưa text learner vào comment, import chỉ theo allowlist.
- Interpreter: giới hạn §6.7 (hằng số, kiểm **trước** thao tác tốn kém, diagnostic); nhường theo ngân sách; độ sâu gọi; hàng đợi event.
- Dữ liệu: definition/profile/contract parse bằng Zod; document load qua `resolveBoardContext` + compiler cùng luật (R5); preflight có ngân sách.
- Audio: không autoplay; trần âm lượng; tắt ngay khi Stop.
- Download: Blob `text/x-python`, tên file cố định.
- Không thêm quyền iframe, không gọi mạng, không thêm phụ thuộc runtime.

---

## 21. Rollout/task phases

### 21.0 Boundary bắt buộc (mọi phase)

1. Core TS thuần (B1); generator, construct, profile, contract, limits, conversions, board context đều ở core.
2. `RunSession` là điểm điều phối duy nhất (B5).
3. Runtime state ngoài document (B2).
4. Device/board/profile/contract là data khi có thể (B6).
5. GB1–GB12.
6. Không giả lập MCU.
7. Một engine cho Basic/Advanced.
8. Không nội dung độc quyền (R3).
9. EG (R4) và domain (R5) cho mọi construct được mở.

### 21.1 Thứ tự

```text
YB-0 → YB-1 → YB-2 → YB-5A → YB-CP → ( YB-3 ∥ YB-4 ) → YB-5B → YB-6 → YB-7 → YB-8 → YB-9 → (sau) YB-P
```

- YB-5 tách thành 5A (ngay sau YB-2) và 5B (sau YB-3/4), lý do như v0.1: ngữ nghĩa simulator không được đóng băng trước khi biết nó map được sang Python.
- **YB-CP** mới (đóng F9).
- YB-7 có thể bắt đầu sau YB-5B, song song YB-6.

**Kích thước tương đối:** YB-0 M · YB-1 M · YB-2 L (2a/2b) · YB-5A M · YB-CP S · YB-3 L (3a/3b) · YB-4 M · YB-5B M · YB-6 M · YB-7 L (7a/7b/7c) · YB-8 M · YB-9 M.

**Ở mọi phase có mở construct, acceptance bắt buộc gồm:** test EG xanh cho construct được mở; domain enforce ở 4 điểm (§6.4); golden + syntax (hoặc L2 PENDING được ghi rõ) + allowlist.

---

### YB-0 — Yolo:Bit compatibility contract
- **Goal:** contract v1.0 (§7.2) có eligibility cho từng construct; firmware target; display model; event model hoặc DEFERRED; provenance.
- **Files:** mới `docs/yolobit-compatibility-contract.md`; cập nhật §7, §14, §15, §18.7 của plan.
- **Tasks:**
  1. danh sách construct ứng viên;
  2. thu output Python của program mình trên editor public;
  3. tài liệu public;
  4. P1–P11 (parity);
  5. danh sách §7.5;
  6. phân loại ELIGIBLE/RESTRICTED/EXCLUDED;
  7. đặc tả contract máy đọc được;
  8. review → freeze.
- **Acceptance:** §7.6 (hard gate).
- **Out-of-scope:** code; phần cứng; source firmware.
- **Dependencies:** không.
- **Risks:** nhiều field chỉ thấy trên phần cứng → construct bị loại (§22 #2).

### YB-1 — Board/profile architecture + board context resolution
- **Goal:** `ybc-board` + profile + `resolveBoardContext` (§8.5) + các tầng hợp lệ (§8.6) cùng tồn tại với generic; contract máy đọc được; YBC IR skeleton (§9.0).
- **Files:**
  - core: `device-definition.ts`, `definitions/ybc-board.json`, `local-catalog.ts`, `src/core/profiles/*`, `board-context.ts`, `src/core/compat/yolobit-contract.ts`, `document.ts` (`profile`), `project-repository.ts` (tầng L-1), `run-session.ts` (resolution + chọn dialect), `src/core/program/ybc-ir.ts` (skeleton: hat rỗng);
  - ui: `main.tsx`, `palette-model.ts` (lọc theo context), `BlocklyPanel.tsx` (toolbox theo context), `editor-blocks.ts` (`canOpenProgram(blocks)` cấu trúc, hợp mọi pack), `renderers.ts`, `YbcBoardRenderer.tsx`.
- **Public contracts:** §8.1–§8.6, §9.0.
- **Tasks:**
  1. **trước tiên** chụp golden IR generic + snapshot definition/toolbox/palette (GB1–GB3, GB9, GB11);
  2. schema;
  3. `ybc-board.json` theo contract;
  4. profile data (chỉ `ybc.structure`);
  5. `resolveBoardContext` + các tầng L-1…L-3 + dùng ở mọi consumer;
  6. YBC IR skeleton + chọn dialect trong `RunSession`;
  7. bỏ hard-code board;
  8. renderer board;
  9. đo baseline bundle/khởi động.
- **Tests (chỉ phạm vi YB-1):**
  - board/profile resolution;
  - load/save/reload;
  - palette/toolbox/profile context;
  - các tầng hợp lệ và diagnostic của trạng thái sửa: cột "YB-1" của §8.5, mức kỳ vọng template generic §8.6;
  - cơ chế profile bằng **fixture test-only** (§8.7, chỉ unit): lọc theo profile, giữ nội dung ngoài profile, save/reload, diagnostic resolver, lọc palette/toolbox; cộng test khẳng định không có id `test` trong production;
  - GB1–GB12;
  - E2E: mở/sửa/lưu/reload, Run/Stop program rỗng.
- **Acceptance:** mọi điểm ở Tests xanh; GB1–GB12 xanh không sửa assertion; không còn `registry.get('board')`; palette generic giống hệt hôm nay; Basic/Advanced chỉ khác ở profile data; `pnpm verify` + `pnpm e2e` xanh; 0 `eslint-disable` cho B1/B8. **Không** có yêu cầu nào về Python generator/panel, và **không** có test nào cần construct Advanced thật (thuộc YB-7).
- **Out-of-scope:** ngôn ngữ YBC (YB-2), block phần cứng, generator/panel (YB-5A), template key mới (YB-6), UI đổi profile (YB-6).
- **Dependencies:** YB-0 (pin list, board model, display model 5×5 đã được owner duyệt ở OQ-E).
- **Risks:** đăng ký block toàn cục; trạng thái sửa cũ.
- **Ghi chú triển khai (YB-1, 2026-10-14).** Không đổi kiến trúc; các điểm sau là chi tiết mà plan để mở hoặc cần chốt khi viết code:
  1. `BoardContext` thêm `blockPacks` (toolbox đọc từ context, R-F6); `boards` chỉ gồm board **được phép** trong context (R-F5 "đúng 1 board thuộc family"); `capabilities` là danh sách id (chân + onboard), chưa giao với `profile.constructs` vì profile YB-1 chưa có construct phần cứng.
  2. Thứ tự readiness: `incompatible-devices` trước `no-board`/`multiple-boards` (thiết bị sai family là thứ người dùng phải sửa trước). Generic không có thiết bị sai family nên thứ tự cũ `no-board` → `multiple-boards` giữ nguyên.
  3. `profile.palette` của hai profile YB-1 chỉ có `ybc-board`: chưa có runtime cho chân header (YB-4) nên chưa cho thả `led`/`resistor`/`push-button` vào dự án ybc. Thêm vào là sửa dữ liệu profile ở YB-4.
  4. Block pack là dữ liệu core (`block-packs.ts`): `generic.stem` (toolbox PoC nguyên vẹn, GB2) và `ybc.structure` (hai hat dùng chung). Hat dùng chung được khai báo ở cả hai pack, catalog loại trùng theo `type` và báo lỗi nếu hai định nghĩa khác nhau. Dropdown chân của block generic lấy từ **mọi board generic** trong registry, không còn `registry.get('board')`.
  5. L-2 cho block (`not-in-profile`) áp dụng cho **cả hai family** nhưng chỉ với block mà một pack đã biết sở hữu; block không pack nào sở hữu vẫn là `unknown-block` của compiler (generic không đổi hành vi).
  6. `paletteItems(registry, context)` nhận context (không còn nhận mỗi registry); `readStoredProject` và `openLastProject` nhận thêm `profiles` tuỳ chọn (mặc định: profile production); `RunSnapshot.diagnostics` và `StartResult.diagnostics` được nới thành `RunDiagnostic[]` (cấu trúc, `code: string`) vì hai dialect có tập `code` riêng; `StartResult.reason` thêm `incompatible-devices`. Test `registry.test.ts` "lists every definition" đổi theo catalog mới (thêm `ybc-board` ở cuối); test palette đổi cách gọi, **kỳ vọng giữ nguyên** (GB9).
  7. Contract máy đọc được: `EVD-02` của §20 là "GEN + UI" nên tách thành `EVD-02` (GEN) và `EVD-02U` (UI); mỗi field có thể có `corroboratedBy` (bằng chứng cùng chiều nhưng field không dựa vào), vì cột simDependent của §15.1 chỉ tính claim **chỉ** có nguồn SIM; thêm `restrictions` (chữ), `alsoCovers` (dòng gộp C-55/C-61…C-66), `observedPython` (dạng editor sinh cho dòng bị loại, không vào allowlist). Khác biệt §15.1 và §20 đã sửa ở fix turn sau review: ô `block` V·S của C-12/13/15/16/25/43 giờ trích trace riêng (EVD-24…EVD-28, thêm vào §20 của contract từ raw đã thu ở YB-0). Một quy tắc duy nhất (`FIELD_CLAIM_KINDS` + `establishes` của từng entry ledger) dùng chung cho `validateContract` và cổng EG.

### YB-2 — Programming IR language foundation
- **Goal:** YBC IR v1 + domain §6.4/§6.5 + giới hạn §6.7 trong compiler/IR/interpreter của dialect YBC; console.
- **Sub-task:** **2a** value model, kiểu tĩnh, biểu thức, biến `int`, so sánh/logic (short-circuit), `print`, console, `limits.ts`; **2b** `repeat`/`while`/`count up` (thứ tự đánh giá + domain §6.5), nhường theo ngân sách, `join`, `waitMs`. Random **không** thuộc YB-2 (C-40 EXCLUDED ở YB-0).
- **Files:** `ybc-ir.ts`, `compile-ybc-program.ts` (bảng construct), `ybc-interpreter.ts`, helper dùng chung tách khỏi `interpreter.ts` (không đổi hành vi legacy), `values.ts`, `limits.ts`, `src/core/constructs/lang.*.ts`, `run-session.ts` (console, `RuntimeServices`), `editor-blocks.ts` (preflight `text_join`), `Console.tsx`, `tests/blockly-conformance.test.ts`. **Không** sửa `ir.ts` hay `compile-program.ts` của legacy (§9.0).
- **Public contracts:** YBC IR v1 §9.1 (trừ hàm/handler); domain §6.4; range §6.5; limits §6.7; diagnostics §9.4.
- **Tests (chỉ phạm vi YB-2):**
  - compiler;
  - domain ngôn ngữ YBC có kiểu;
  - IR;
  - interpreter;
  - fixture ngữ nghĩa ngôn ngữ (cột "Compile/trace" của §18.3);
  - hành vi resource-safety (§18.5, phần YB-2);
  - preflight chống DoS;
  - GB11 (legacy không đổi);
  - E2E chương trình đếm in ra console.
- **Acceptance:** mọi construct ngôn ngữ MUST compile/chạy đúng domain; cột "Compile/trace" của §18.3 xanh; Stop ≤ 100 ms ở §18.5; GB xanh. **Không** có golden Python hay syntax check ở phase này. Construct chưa learner nhìn thấy được (chưa có template/New cho ybc tới YB-6).
- **Out-of-scope:** Python (YB-5A), hàm (YB-7, gate FN), biến `str` (YB-7), event.
- **Dependencies:** YB-1; contract (language, module).
- **Risks:** lệch ngữ nghĩa (giảm bằng domain chỉ số nguyên).
- **Ghi chú triển khai (YB-2a, 2026-10-14).** Không đổi kiến trúc; các điểm plan để mở:
  1. Phạm vi 2a: C-29, C-30, C-31, C-32, C-33, C-34, C-35, C-36 (chỉ `if` và `if/else`; `else if` bị từ chối `unsupported-construct`), C-56 (text literal, không `join`). `compile-ybc-skeleton.ts` / `run-ybc-skeleton.ts` tiến hoá thành `compile-ybc-program.ts` / `ybc-interpreter.ts`; thêm `values.ts`, `limits.ts` (chỉ giới hạn của 2a), `console.ts`, `src/core/constructs/lang.ts` (bảng block type ↔ `contractId`). Pack mới: `lang.logic`, `lang.math`, `lang.text`, `lang.variables`; hai profile thêm các pack và id construct tương ứng (dữ liệu profile), Advanced vẫn chỉ ⊇ Basic.
  2. Diagnostic compile thêm (ngoài danh sách §9.4): `undefined-variable`, `unsupported-construct`, `missing-input`, `invalid-condition` (điều kiện không phải `bool`; `type-mismatch` dành cho phần còn lại). Lỗi runtime có `code` (`out-of-domain`, `zero-division`, `limit-exceeded`, `internal-error`) và `blockId`; `RunSnapshot.error` có thêm `code?` tuỳ chọn.
  3. **Quyết định (review YB2A-R1):** phép `+ − ×` dùng block riêng `ybc_arith` (dropdown đúng ADD/MINUS/MULTIPLY), cùng kiểu với `ybc_int_divide`; C-31 = `math_number` + `ybc_arith`. `math_arithmetic` của Blockly vẫn được đăng ký toàn cục để load document, không nằm trong toolbox/profile YBC; nếu xuất hiện, compiler từ chối (DIVIDE/POWER → `float-not-supported`, còn lại → `unsupported-construct`) và không bao giờ đọc thành `ybc_arith` hay ADD.
  4. `RunSnapshot.console?` (`{ lines, hidden }`) chỉ có ở run YBC; snapshot generic không đổi một byte (test). Console là ring buffer 500 dòng / 256 KB (UTF-8), runtime state, không vào document.
  5. `forever` ở 2a chạy thân rồi nghỉ 10 ms như interpreter legacy (E3); chưa có execution budget/vòng lặp (2b).
  6. Block chỉ thuộc pack YBC (vd. `math_number`) nay là "known" nên một document **generic** chứa chúng nhận `not-in-profile` ở L-2 thay vì `unknown-block` của compiler legacy. Không chương trình generic nào tạo được từ UI chứa các block đó.
  7. `else if` của C-36: **chưa** thuộc 2a (2a chỉ `if` và `if/else`, theo yêu cầu phase); hoãn sang **YB-2b** — **đã đóng ở YB-2b** (xem ghi chú YB-2b).
  8. Giới hạn `MAX_PROGRAM_BLOCKS` = 2000 hiện được kiểm **ở compiler YBC**: đếm mọi block của workspace JSON (hat, statement, value, shadow) bằng `listBlocks`, tối đa 100 000 block được duyệt; vượt 2000 → `program-too-large`. Preflight riêng cho YBC — **đã làm ở YB-2b** (ghi chú YB-2b); không đặt quy tắc chung cho mọi document vì sẽ xung đột GB6 (document generic lớn vẫn phải mở được).
  9. Ghi nhận cho sau (không làm ở 2a): giữ console sau Stop + auto-scroll (trước YB-6); `noop` chỉ cho fixture (YB-2b); chi tiết ký tự Unicode/surrogate của text (YB-5A, contract text); hiệu năng snapshot console (YB-2b); khử trùng tên biến cho generator (YB-5A).

- **Ghi chú triển khai (YB-2b, 2026-10-14).** Không đổi kiến trúc YB-2a; các điểm plan để mở:
  1. Phạm vi 2b: C-36 phần `else if` (`controls_if`, `extraState.elseIfCount`; điều kiện đánh giá từ trên xuống, nhánh đúng đầu tiên thắng, các điều kiện sau **không** được đánh giá), C-37 `repeat` (`controls_repeat_ext`), C-38 `while` (block riêng `ybc_while`, vì `controls_whileUntil` có dropdown "until" ngoài domain), C-39 count up (`ybc_count_up`: biến Blockly `VAR`, hai input `FROM`/`TO`, ô số `STEP` 1..1 000 000 là literal), C-04 `wait` (`ybc_wait_ms`, đơn vị **ms** thẳng, không đổi giây), và `join` của C-56 (`text_join`, ≤ 50 phần, theo ghi chú "2b: join" của plan; không có khái niệm đồng thời). Pack `lang.loops` (category Loops và Time); hai profile thêm C-04, C-37, C-38, C-39 và pack. Random vẫn EXCLUDED.
  2. IR: `repeat`, `while`, `countUp`, `waitMs`, và `Expr.join`; `if` đã có `branches` nên `elif` không cần node mới. Domain: `repeat` `abs(N) ≤ MAX_REPEAT_ABS`, `N ≤ 0` chạy 0 lần (Python range, contract §3.2); literal ngoài khoảng → `value-out-of-range`, giá trị tính ra ngoài khoảng → `out-of-domain` tại block đó. `wait` 0..`MAX_WAIT_MS`. Count up đúng contract §3.3: `start` đánh giá và kiểm trước, rồi `end` đánh giá và kiểm, mỗi cái **một lần** trước vòng lặp; `0 ≤ start, end ≤ MAX_RANGE_VALUE`; `start > end` chạy 0 vòng và biến giữ giá trị cũ; hai literal `start > end` → `descending-range-not-supported`; biến vòng lặp gán ở **đầu mỗi vòng** (như `for … in range`), nên gán lại trong thân không đổi dãy đếm; sau vòng nó giữ giá trị vòng cuối. Biến là biến Blockly theo id, không có scope mới.
  3. Execution budget (`execution-budget.ts`), theo §6.7 "statement, vòng lặp, node biểu thức": mỗi **statement**, mỗi **vòng lặp** và mỗi **node biểu thức** là một bước. Biểu thức vẫn đồng bộ (không `await` giữa biểu thức, thứ tự đánh giá không đổi): mỗi node chỉ tăng bộ đếm chung (`work()`), còn điểm kiểm tra nằm ở nơi interpreter chờ được là đầu mỗi statement và mỗi vòng lặp (`step()`). `step()` luôn kiểm Stop (`signal.throwIfAborted`); cứ `STEP_CHECK_INTERVAL` = 256 bước (mọi loại) mới đọc đồng hồ; hết `EXEC_SLICE_MS` = 8 ms thì nhường event loop bằng `setTimeout(0)` rồi chạy tiếp. Nhờ đó vòng lặp quanh biểu thức ~2000 node kiểm tra đồng hồ ở **mỗi** vòng, không phải sau 256 vòng (đo: khoảng trống event loop 37–38 ms → 17–24 ms trên máy dev, trước/sau khi đếm node). Nhường là việc nội bộ: không đổi biến, không in, không đổi vòng lặp. 10 ms cuối mỗi vòng `forever` và `wait` vẫn là ngữ nghĩa của program, đi qua `sleep` (huỷ được bằng Stop); sau mỗi lần ngủ slice bắt đầu lại, nên không có độ trễ đôi. Vòng lặp là vòng `for`/`while` thật, không đệ quy theo số vòng. Stop ≤ 100 ms có test thời gian thật (heartbeat + deadline, kể cả Stop được lập lịch trên chính event loop khi đang tính biểu thức lớn).
  4. Preflight YBC: `exceedsBlockLimit` (một helper chung cho compiler và `RunSession`) đếm hat, statement, value, shadow và dừng ở block thứ 2001; danh sách top-level dài hơn 2000 phần tử bị từ chối trước khi duyệt. Phạm vi cam kết: duyệt dừng ở block thứ 2001, kết thúc trên object **và array** đã gặp (tham chiếu vòng), và không dùng spread nên mảng rất lớn không tràn stack; nó **không** hứa chi phí hằng số với mọi cấu trúc rác lồng nhau (chi phí tỉ lệ với số phần tử phải duyệt tới giới hạn). Chỉ áp cho family `ybc`, document generic không đổi (GB6), document YBC quá lớn vẫn mở được để sửa (L-1). `isBoundedForBlockly` thêm allowlist có ngân sách cho mutator `text_join`: `itemCount` nguyên không âm ≤ trần mỗi block, tổng ≤ trần cả document (trần mỗi block 4000 và tổng cả document 100 000, §12; chỉ là cấu trúc: block rời hoặc disabled vẫn mở được); một join > 50 phần **mở được** (L-1) và Run trả `limit-exceeded` tại block (L-3), không cắt, không xoá input (review R2). Giới hạn vòng lặp/`wait` ở `limits.ts` được ghim vào predicate của contract (C-04, C-37, C-39) bằng test đối chiếu compiler + interpreter ở các giá trị biên.
  5. `noop` chỉ còn cho block được liệt kê tường minh (`noopBlockTypes`, chỉ fixture test-only truyền vào); block do profile mở mà compiler không có handler → `unsupported-construct`.
  6. Console: `print` chỉ đánh dấu console cũ; `RunSession.getSnapshot()` mới sao chép (≤ 500 dòng) và chỉ báo một lần cho mỗi đợt print; run store đọc session tối đa một lần mỗi frame. Ngữ nghĩa console (bỏ dòng cũ nhất, `hidden`) không đổi.
  7. Chưa làm (đúng phase): call-depth 64 (hàm, YB-7), event, random, thời gian chạy, generator.

### YB-5A — Generator core
- **Goal:** generator `YbcProgramIR → MicroPython` (§13) + Python panel + golden + **syntax check bắt buộc, thực thi được** + API allowlist + diagnostic generator + test completeness/EG.
- **Files:** `src/core/codegen/yolobit/*`, `__golden__/`, `src/core/constructs/*` (thêm `python`), `scripts/check-python-syntax.*`, `PythonPanel.tsx`, `App.tsx` (layout).
- **Tasks:**
  1. generator (§13.3–§13.6);
  2. tên/escape/tập con cú pháp;
  3. golden **bổ sung** cho mọi construct đã có từ YB-1/YB-2 + case §13.9 + cột "Golden" của §18.3;
  4. test xác định;
  5. allowlist;
  6. completeness/EG;
  7. script syntax check + quyết định checker (OQ-B);
  8. panel; cột "Python" của §8.5/§8.6 (panel chặn với cùng diagnostic như Run);
  9. regression kết hợp: fixture YB-2 chạy qua cả interpreter lẫn generator.
- **Acceptance:**
  - mọi construct của profile có golden;
  - **syntax check chạy thật trên toàn bộ golden** ở môi trường được chọn; nếu chưa có công cụ thì L2 ghi PENDING tường minh và mọi tiêu chí khác vẫn xanh;
  - allowlist + diagnostic generator xanh;
  - generic không có panel;
  - `pnpm verify` + E2E xanh.
- **Dependencies:** YB-2, contract.
- **Risks:** tên trùng API; phát hiện ngữ nghĩa YB-2 cần đổi (sửa trong phase này).
- **Ghi chú triển khai (YB-5A, 2026-10-14).** Không đổi kiến trúc; các điểm plan để mở:
  1. **OQ-B — quyết định của owner (2026-10-14): CPython `ast.parse` chỉ là kiểm tra dự phòng khi phát triển; nghiệm thu/freeze YB-5A cần corpus golden PASS bằng `mpy-cross`. Trạng thái hiện tại: MicroPython syntax validation = PENDING.** Checker là `scripts/check-python-syntax.mjs`; `pnpm check:python` (`--require`: có checker nào chạy) dùng khi phát triển, `pnpm check:micropython` (`--require-mpy`: exit 2 nếu `mpy-cross` không PASS) là **điều kiện freeze**. Công cụ được **phát hiện, không cài, không tải**, không thêm dependency npm: ưu tiên `mpy-cross` (biến `MPY_CROSS` hoặc PATH), dự phòng CPython 3 `ast.parse` (Windows: `python`, `py -3`; còn lại: `python3`, `python`; `python3` trên Windows bị bỏ qua vì thường là stub của Microsoft Store). Báo cáo có hai trường tách bạch: `status` (kết quả của checker đã chạy) và `micropython` (`pass`/`fail` chỉ khi checker là `mpy-cross`, ngược lại `pending`); CPython PASS **không bao giờ** được ghi là MicroPython PASS. Không có checker → `pending`, test syntax được **skip**. Môi trường dev hiện tại **chưa có `mpy-cross`**, có CPython 3.11.9: 25 golden PASS bằng `ast.parse` (cú pháp CPython 3), `micropython = pending`. Đường `mpy-cross` được test bằng một executable giả (POSIX; bị skip trên Windows vì Node không chạy `.cmd`) chỉ để chứng minh việc chọn checker và cách báo; nó **không** là kiểm tra MicroPython thật. Để freeze: cài `mpy-cross` ngoài npm (việc owner đã giao là điều kiện, không phải việc của code) và chạy `pnpm check:micropython` xanh; khi đó mới đổi câu của panel (#10). Chưa cài gì.
  2. Phạm vi generator: C-01, C-02, C-04, C-29…C-39, C-56 (`generatedConstructs`, bằng đúng danh sách `constructs` của hai profile; test completeness/EG so khớp). Output chỉ có `import time` (IM-1): `from yolobit import *` + preamble (IM-2) và `import music` (IM-3) chỉ xuất hiện khi có construct phần cứng (YB-3/4), chưa có chỗ nào để sinh. Không `random`, event, PWM, thời gian chạy, hàm.
  3. Kiến trúc: `src/core/codegen/yolobit/generate.ts` nhận `YbcProgramIR` (không Blockly, không UI), `names.ts` (đặt tên), `limits.ts`, `generate-document.ts` (`generateForDocument`: cùng chuỗi L-2 → L-3 với Run rồi generator = **L-4**; kết quả báo tầng đã chặn; `null` cho document generic). `ValidityLayer` thêm `'L-4'`. Generator **không bao giờ** ném lỗi và không bao giờ trả source khi có diagnostic (K4).
  4. Lệch so với văn bản YB-5A: (a) "`src/core/constructs/*` thêm `python`" **không làm**: IR → Python là `switch` theo `kind` của IR, quan hệ nhiều–nhiều với dòng contract; thay bằng `generatedConstructs` + test completeness/EG (profile = generated; mỗi construct có golden; mỗi block type của pack ngôn ngữ thuộc construct được sinh). (b) `lineMap` chỉ ghi dòng đầu của mỗi block (highlight là YB-5B).
  5. Quyết định ngữ nghĩa: số `k` của `_cu_start_k` / `_cu_end_k` / `_rK` đếm theo thứ tự duyệt của **mọi** node cùng loại (kể cả count up có cận literal đã gập, nên k có thể có chỗ trống); `noop` không sinh code (suite chỉ có `noop` → `pass`); literal âm luôn có ngoặc khi nằm trong phép toán (`a - (-5)`); toán hạng của so sánh/`and`/`or`/`not` là so sánh/`not`/logic luôn có ngoặc (chặn chained comparison của Python); `join` 1 phần = chính phần đó, 0 phần = `''`.
  6. **Đóng N5 (text):** chuỗi nháy đơn, escape `\\ \' \n \r \t`, mọi ký tự điều khiển C0, DEL và C1 thành `\xNN`, ký tự khác giữ nguyên UTF-8. **Lone surrogate** (compiler cho qua) không có dạng UTF-8 → generator trả `invalid-literal` tại block đó: chương trình vẫn **chạy** trong simulator (L-3) nhưng không **L-4**. Không thay bằng ký tự thay thế.
  7. **Đóng N8 (tên):** §13.5 + ASCII hoá (NFD bỏ dấu, `đ → d`), tên rỗng / bắt đầu bằng số hoặc `_` → tiền tố `v_` (tên learner không bao giờ bắt đầu bằng `_`, nên `_rK`, `_cu_*` không thể trùng); tránh keyword, builtin, `time`/`music`/`random`/`yolobit`/`display`/`Image`/`button_a`/`button_b`/`light_level`/`temperature`/`pinN`; trùng → `_2`, `_3` theo thứ tự `variables`, bỏ qua hậu tố đã bị chiếm. Hai biến cùng tên khác id cho hai tên Python.
  8. Giới hạn của generator (thấp hơn giới hạn parser CPython: 100 mức thụt, 200 ngoặc lồng): lồng statement ≤ 64, lồng biểu thức ≤ 100; vượt → `limit-exceeded` (L-4). Compiler cho lồng tới 100 nên chương trình 65–100 mức chạy được mà không sinh được Python.
  9. Parity: cùng fixture (`__fixtures__/lang-cases.ts`, 24 ca) chạy qua interpreter, qua generator (golden `__golden__/*.py`), qua syntax check, và — khi có CPython — chạy **golden bằng CPython với module `time` giả** (dừng ở lần nghỉ 10 ms đầu tiên) để so dòng `print` với console của simulator. Đây là kiểm tra ngữ nghĩa ngôn ngữ chung (`//`, `%`, short-circuit, `range`, `str()`), **không** phải verification trên MicroPython/Yolo:Bit; ca có `wait` không thuộc parity chạy.
  10. Python panel (`PythonPanel.tsx`, §13.7): chỉ khi `context.family === 'ybc'`; `<pre>` read-only, số dòng bằng CSS counter (không bị chép theo), debounce 250 ms, Copy và Download `program.py` (IM-8); khi bị chặn hiện diagnostic cùng tầng với Run (L-2/L-3/L-4) và **vô hiệu** Copy/Download. Câu tuyên bố chỉ nói điều đang đúng: *"Generated for Yolo:Bit MicroPython. MicroPython syntax validation: pending. Physical-board verification: pending."* Câu L2 của §6.9 ("code-generation compatible…") **chưa** dùng vì syntax check bằng MicroPython chưa PASS (#1); đổi hằng `claim` khi `pnpm check:micropython` xanh. Bốn khái niệm tách bạch: **L-3** = chạy được trong simulator; **L-4** = generator `ok` (tạo được file); **MicroPython syntax validated** = `mpy-cross` PASS (hiện PENDING); **physical-board verified** = L3 của §6.9 (PENDING). Iframe lab nhúng không có `allow=clipboard` (S12): Copy có thể không hoạt động ở đó, Download vẫn dùng được. Generic không có panel.
  11. Chưa làm (đúng phase): highlight dòng ↔ block (YB-5B), preamble `yolobit` và API phần cứng (YB-3/4), `def`/`global` (YB-7).
  12. **Domain guard là của simulator (§6.3 "Domain guard (frozen)", §6.4, bảng enforce R5):** giá trị động ra ngoài domain (safe-int ±(2^53−1), `wait` 0..60000, `repeat` `abs(N) ≤ 10^6`, count up cận 0..10^6, `MAX_TEXT_CHARS`) khiến **simulator** dừng với `out-of-domain` / `limit-exceeded`; "code sinh ra không đổi", generator "không đổi giá trị", và MicroPython có số nguyên lớn nên chương trình vượt khoảng "nằm ngoài domain chứ không bị coi là khác". Vì vậy code sinh ra **không có guard/helper runtime** (không `raise`, `assert`, `min`/`max`, `def`), và một run ngoài domain **không thuộc tuyên bố tương thích**; đây là quyết định đã đóng băng, không phải sai lệch. Phần dùng chung: mọi giá trị **trong** domain (kể cả biên), literal ngoài domain (compiler **và** generator đều từ chối), và lỗi của chính ngôn ngữ (`ZeroDivisionError` ↔ `zero-division`). `generate.domain.test.ts` ghi từng quy tắc: simulator, CPython, và loại hàng (`parity` / `domain` / `fault`), kèm kiểm tra file sinh ra không chứa guard. Một số chương trình hợp lệ trong Python nhưng bị simulator từ chối (vd. tràn trung gian rồi quay lại trong domain, `repeat` 1 000 001 lần) là hệ quả trực tiếp.
  13. **Chương trình không có `forever`:** simulator **kết thúc** thân `on start` (status `finished`, test YB-2) nhưng board **vẫn được cấp nguồn tới khi Stop** (E6); trên board, vòng đời do code xác định nên generator sinh vòng chờ rảnh `while True:` + `time.sleep_ms(10)` (plan §13.3 mục 8, contract IM-6, né C-41). Hai bên khớp: không có gì quan sát được sau `on start` trước YB-CP/event. Có test.
  14. **Import:** chỉ `import time` (IM-1, luôn có). `from yolobit import *` + preamble (IM-2) chỉ khi program dùng construct của `yolobit`, `import music` (IM-3) chỉ khi dùng C-50/C-51; các construct ngôn ngữ của YB-5A không dùng module nào ngoài `time`, nên bỏ import `yolobit` là **đúng contract** (plan §13.3 mục 2: "chỉ import thứ được dùng"). Có test.
  15. **Sửa theo review YB-5A (R1–R4).** R1: `MAX_GENERATED_BYTES` = 256 KB (`codegen/yolobit/limits.ts`, vì giới hạn của generator nằm cạnh generator) được kiểm trên **byte UTF-8** của file (`TextEncoder`, không phải `.length`), sau khi sinh và trước khi trả về; vượt → `program-too-large`, **không có source**; `== MAX` qua, `MAX + 1` bị chặn; L-4 gồm ngữ nghĩa generator, mã hoá nguồn và kích thước file, vẫn tách khỏi `mpy-cross` và board. R2: Copy/Download **không dùng source đang hiển thị**: mỗi lần bấm gọi `saveNow()` của Blockly (đưa workspace vào document ngay, kể cả sự kiện Blockly còn đang xếp hàng), đọc document từ store, sinh lại **đồng bộ** và chỉ xuất kết quả đó; panel hiển thị cùng kết quả. Cả hai khoảng trễ (lưu Blockly 250 ms, sinh lại 250 ms) được phủ; sinh đồng bộ nên không có kết quả cũ hoàn thành sau kết quả mới. R3: clipboard từ chối → chọn sẵn source, focus vào `<pre>`, thông báo `role="status"` "Copy failed. Press Ctrl+C to copy the selected code." (Cmd+C trên macOS); không hiện "Copied". R4: cận count up literal được kiểm số nguyên/safe-range (`invalid-literal`) trước khi gập thành `range`.

### YB-CP — Shared runtime contract checkpoint (mới, đóng F9)
- **Goal:** chốt các contract dùng chung **trước khi** YB-3 và YB-4 chạy song song, để hai phase không tự đặt ra contract không tương thích.
- **Deliverable (type + test, không có peripheral thật):**
  1. interface capability §10 (`DigitalIO`…`PulseIO`) + `RuntimeServices`;
  2. biểu diễn runtime input (`ComponentInput`, `setComponentInput`, id `<board>/<peripheral>`);
  3. shape snapshot/peripheral state (`ComponentState`, `Frame`, tone state);
  4. `conversions.ts` (hàm + bảng test §11.3);
  5. mô hình diagnostic/lỗi (danh sách code §9.4, shape lỗi runtime);
  6. điểm mở rộng của `RunSession` (ghép capability, scheduler của run; **không** có seam event cho tới YB-7). Console và `RuntimeServices` đã có từ YB-2; YB-CP chỉ **freeze** chúng, không làm lại.
- **Quyền sở hữu file:**
  - YB-CP sở hữu `src/core/capabilities/*`, `src/core/simulation/conversions.ts`, các type snapshot/input trong `simulate-circuit.ts`, và phần mở rộng `run-session.ts`;
  - YB-3/YB-4 chỉ thêm **implementation** (model, construct, renderer, control);
  - cần đổi file dùng chung thì mở một PR "contract amendment" riêng, được reviewer của cả hai phase duyệt, merge trước PR phụ thuộc.
- **Acceptance:** type + test của 6 mục trên xanh; GB xanh; tài liệu ownership ghi trong PR.
- **Dependencies:** YB-5A.
- **Ghi chú triển khai (YB-CP, 2026-10-14).** Chỉ type + test, không peripheral thật, không construct/profile/contract/evidence nào đổi (learner không thấy gì mới). Ánh xạ 6 deliverable:
  1. **Capability + services:** `src/core/capabilities/{io,frame,services,compose,diagnostics,index}.ts`. `io.ts`: 11 interface của §10, `Capabilities`, `capabilityKeys`; `HardwareIO` của interpreter legacy là **alias type** của `DigitalIO` (cùng hai method, không đổi hành vi, test type-equal). `services.ts`: `Clock`, `ConsoleSink`, `RunScheduler` (+ `createRunScheduler`), **`RuntimeServices` = { clock, console, budget, sleep, scheduler, signal }** (đúng 5 service của §10, thêm `signal` = huỷ của run, dùng chung cho budget / `Sleep` / interpreter) và `createRuntimeServices(...)`, dựng services của một run với budget YB-2 (`createExecutionBudget`, không viết lại). Console / budget / `Sleep` là của YB-2, **chỉ đặt tên**. `compose.ts`: `availableCapabilityKeys` / `missingCapabilities` (nền cho `capability-unavailable` khi có op) / `composeCapabilities` (bỏ implementation của capability board không có). Id capability của `ybc-board` (`digital, analogIn, display, buttons, light, sound`) khớp đúng `capabilityKeys`; generic chỉ `digital`; `pwm/temperature/motion/servo/pulse` không có ở `ybc-board` (PWM EXCLUDED, C-26).
  2. **Runtime input:** `ComponentInput` = `hold | slider | tilt | gesture` (§11.3), `inputKindOfModel` (button → hold, light/temperature-sensor → slider, accelerometer → tilt; display và buzzer không có), id `<board>/<peripheral>` (`peripheralComponentId` / `splitPeripheralComponentId`, tách ở dấu `/` cuối), `isComponentInput` — trong `simulate-circuit.ts`. `RunSession.setComponentInput(componentId, input)` tổng quát hoá `setContactInput` (giữ wrapper, hành vi y hệt). **Thứ tự định tuyến: mạch thắng** — id trùng một component của mạch của run (id là text tự do, có thể chứa `/`, vd. `saved/button`) luôn được xử lý như component đó (contact nhận `hold`, loại khác bị bỏ qua), không bao giờ bị đọc là `<board>/<part>`; chỉ khi không có component nào trùng thì id mới được thử như part onboard của board của run, nhận input đúng loại của model, lưu như **state của run** (rơi cùng run, B2) và đọc qua `RunEnvironment.input(id)`; sai loại / không tồn tại / board khác / không có control / sai dạng → bỏ qua. Part onboard **không** phát snapshot (chưa có model).
  3. **Snapshot / peripheral state:** `ComponentState` mở rộng thêm `brightness?, value?, frame?, hz?, angle?` (mọi trường optional → snapshot generic không đổi, GB4); `Frame` = 25 pixel row-major `'#RRGGBB' | null`, 5×5, gốc trên-trái, x = cột, y = hàng (contract §4.3, test đối chiếu `yolobitContract.display`); `ToneState = { hz }` (§11.5). Không `Frame`/`hz` nào được sinh ra ở YB-CP.
  4. **`conversions.ts`:** `percentToNative(p, N)`, `percentToRaw = percentToNative(p, 4095)`, `rawToPercent` đúng công thức §11.3 và bảng test (kể cả round-trip 0..100); clamp ở hai đầu, `NaN` → `RangeError`, ±∞ bị clamp; **không** có thang 0..1023 / duty (C-26).
  5. **Diagnostic / lỗi:** `capabilities/diagnostics.ts` là registry duy nhất các code (theo nguồn: compile = danh sách §9.4 + các code YB-2 thêm; runtime; board context; generator), `Diagnostic`, `RuntimeError`. Test đối chiếu **danh sách trong chính plan này** (§9.4) và buộc bằng type: `YbcDiagnosticCode ⊆ compile`, `RuntimeFault['code'] = runtime`, `GenDiagnosticCode = generator`, code của `LayerDiagnostic`/`StartFailureReason` ⊆ registry, nên không code nào xuất hiện mà không được đặt tên. Lệch có chủ ý so với §6.4: generator dùng `unsupported-node` (không phải `unsupported-on-target`).
  6. **Điểm mở rộng `RunSession` và ranh giới interpreter (§9.0, §10):** mỗi run YBC được dựng theo thứ tự: huỷ của run (`AbortController`) → `RuntimeServices` (`createRuntimeServices`: budget YB-2 trên signal đó, scheduler riêng, console, clock, sleep) → capabilities từ `RunSessionOptions.capabilities?: CapabilityFactory` (gọi **một lần**, sau khi biết board, trước khi chạy) rồi `composeCapabilities` với capability của board. **Cùng một** `services` đi vào factory (`RunEnvironment = { board, capabilitySet, services, input() }` (amendment 1 thêm bốn thành viên: mục 9)) và vào interpreter, cùng các `capabilities` đã ghép: **`runYbcProgram(ir, capabilities, services)`** (chữ ký của §9.0). Interpreter không tự tạo budget hay signal; `Stop` = abort signal đó, một chủ huỷ duy nhất; budget bắt đầu slice khi chương trình bắt đầu, ngữ nghĩa budget của YB-2 không đổi. Mỗi run có services riêng (budget, scheduler, signal), bị huỷ khi Stop hoặc khi bị run mới thay (không huỷ khi chương trình tự kết thúc: board vẫn cấp nguồn, E6). Factory ném lỗi → run không bắt đầu, mọi thứ đã dựng bị huỷ, diagnostic `internal-error` (không lộ chi tiết lỗi). Không bao giờ dùng cho run generic (giữ `runProgram` + `DigitalIO`). Console của services ghi qua cùng đường thông báo như `print` (`noteConsoleWrite`). `YbcServices` / `defaultServices` của YB-2 **bị thay** bằng `RuntimeServices`; `onPrint` thành chính `console.write` của run. Không có seam event (YB-7). Reentrancy khi kết thúc run (không đổi luật §6.4, chỉ cách giữ): `Stop`/thay run chốt `retiring = current` rồi chỉ huỷ **run đó** (`retire`: abort signal, dispose scheduler; lặp lại an toàn); abort handler của run có thể ghi console → listener gọi `start`/`stop` đồng bộ, nên sau khi huỷ chỉ được xoá `current` và publish `idle` nếu `current === retiring`; một `start` bị lời gọi mới hơn chen vào thì bỏ phần nó đã chuẩn bị (services bị huỷ) và để trạng thái của lời gọi mới nhất đứng nguyên.
  7. **Còn để cho YB-3, YB-4:** `capabilities` đã vào interpreter nhưng chưa được đọc vì IR chưa có op capability (`call`/`read`, §9.1); không có hardware op, model hay construct nào ở YB-CP. Chưa có `capability-unavailable` ở compiler vì chưa có construct cần capability. (Bản trước của ghi chú này ghi rằng budget do interpreter tự tạo và chữ ký `(ir, services)` được giữ: đã bỏ, vì mâu thuẫn với §9.0/§10.)
  8. **Ownership (ghi trong PR):** YB-CP sở hữu `src/core/capabilities/*`, `src/core/simulation/conversions.ts`, phần type snapshot/input của `src/core/simulation/simulate-circuit.ts`, và phần mở rộng của `src/core/run/run-session.ts` (factory, scheduler, `setComponentInput`, `noteConsoleWrite`). YB-3 / YB-4 chỉ thêm implementation (model, construct, renderer, control) phía sau các shape này; đổi shape dùng chung = PR "contract amendment" riêng.
  9. **Amendment 1 — peripheral-state seam (2026-10-14).** Đây là PR "contract amendment" dùng chung của YB-CP (mục 8), merge **trước** YB-3 và YB-4; không phải việc của riêng phase nào. Không construct, profile, contract hay evidence nào đổi: learner không thấy gì mới, và không có hardware op, model hay event.
     - **Vì sao cần (đã kiểm trên code @ `336aa36`).** Hai consumer độc lập cùng chạm bốn chỗ hở của seam đã freeze:
       1. *State → snapshot (YB-3: frame, `hz`, ...).* `ComponentState`/`Frame`/`ToneState` có kiểu nhưng không có đường nào đưa state của một peripheral vào `snapshot.simulation.components`; `simulateCircuit` chỉ sinh `led` và `contact`.
       2. *Input của component trong mạch không phải contact (YB-4: biến trở).* `setComponentInput` bỏ qua mọi input của component thuộc mạch trừ `hold` của contact, và `SimulationInputs` không có chỗ chứa input khác; nhánh YB-4 phải thêm `SimulationInputs.sliders`, đúng kiểu "mỗi loại control một field" mà mục 2 muốn tránh.
       3. *Lịch sử nhấn (YB-3: C-13 `get_presses`).* `RunEnvironment.input(id)` chỉ trả **giá trị mới nhất**. Contract §5 (EVD-09/17/25) đòi đếm ở cạnh nhấn xuống, nhấn trong lúc `sleep` vẫn được đếm, đọc xong đếm lại từ 0: nhấn-thả ba lần giữa hai lần poll cho `closed: false` ở cả hai lần.
       4. *Truy cập simulation (YB-4: chân header).* Factory không có cách đọc simulation mới nhất của run hay ghi mức chân; nhánh YB-4 đã phải ghép capability của chân thẳng trong `RunSession`.
     - **Thiết kế (additive; không đổi `RuntimeServices`, `Capabilities`, `Frame`, `ToneState`, `runYbcProgram`, `RunSession`, `RunSnapshot`).**
       - `SimulationInputs.inputs?: Record<componentId, ComponentInput>`: **một** đường cho mọi input của component khác contact, dùng đúng `ComponentInput` (§11.3). `contacts` giữ nguyên. Chưa model nào đọc `inputs`; YB-4 là phase đầu tiên.
       - Định tuyến `setComponentInput`: **mạch vẫn thắng** (mục 2). Component của mạch: contact nhận `hold` như cũ; component khác nhận loại input mà `inputKindOfModel[simulation.model]` cho, lưu vào `inputs`, simulate lại và publish. Hôm nay không model nào của catalog có trong `inputKindOfModel`, nên chưa gì được nhận. Part onboard giữ như cũ (lưu, không publish).
       - `RunEnvironment` thêm: `takePresses(id)` (đọc rồi đặt lại; đếm cạnh `closed: false → true` **lúc input được nhận**, nên không mất nhấn giữa hai lần poll; part còn giữ chỉ đếm một lần, đúng EVD-17), `report(id, state | null)` (đặt hoặc xoá `ComponentState` của một part onboard `<board>/<peripheral>`, **thay thế** state cũ, publish khi đổi), `simulation()` (simulation mới nhất của run; **mỗi lần gọi là một bản sao**, nên sửa nó không đổi gì của run) và `drivePin(pin, level)` (ghi mức chân của chính board này rồi simulate lại, như `digitalWrite` của generic).
       - `report` chỉ nhận id của part onboard của board này; id trùng một component của mạch bị bỏ qua và state của mạch được ghép **sau cùng**, nên part onboard không bao giờ đè component của mạch. Quyền sở hữu của state và input: xem mục "Sở hữu dữ liệu" bên dưới. Snapshot generic không có state onboard: byte-identical (GB4).
       - **Sở hữu theo run.** Mọi thứ trên (`inputs`, `presses`, `reported`, pin đã ghi) nằm trong `ActiveRun`, rơi cùng run khi Stop, khi bị thay, hoặc khi start lỗi. Mỗi `RunEnvironment` có một kiểm tra duy nhất (`holder.run` là run đang sở hữu session); environment của run đã hết, hoặc chưa từng thành run (factory ném lỗi, hay một `start` mới hơn thắng), **không làm gì và không đọc gì**. Report/ghi chân trong lúc factory chạy bị bỏ qua vì run chưa tồn tại: state ban đầu do capability báo khi chương trình dùng nó.
       - **Sở hữu dữ liệu (sửa theo review CP-A1…A4).** Một quy tắc: *đối tượng mà bên ngoài còn với tới được không bao giờ là alias của state của run.* Vào run: `setComponentInput` lưu **bản sao** của input (caller được sửa và gửi lại cùng một đối tượng; mỗi lần gửi được so với giá trị đã nhận thật, nên một lần nhấn không bị mất, và `takePresses` đếm đúng), `report` lưu bản sao của state. Ra khỏi run: `input()` và `simulation()` trả bản sao cho mỗi lần gọi; simulation nhận bản sao của input; snapshot được publish là **bản sao** của simulation riêng của run (`run.simulation`, thứ mà `digitalRead` và `simulation()` đọc), nên subscriber sửa snapshot không với tới được state của run. Bản sao của input viết theo từng `kind` (thêm một kind mà quên sửa hàm là lỗi compile) và có thứ tự thuộc tính cố định. Không `Object.freeze`: repo không dùng, và một lần ghi vào bản sao thì vô hại thay vì ném lỗi vào chương trình của learner. Hai thành viên có từ YB-CP **không** đổi ở đây: `RunEnvironment.board` vẫn là chính `ComponentInstance` của document, và `services` là services dùng chung của run theo thiết kế; reviewer quyết định có siết hay không.
       - **Id là dữ liệu.** Id component là text tự do (`constructor`, `__proto__`, `toString`…). Mọi thứ được khoá theo id của amendment dùng `Map` (`inputs`, `presses`, `reported`) hoặc `Set`, nên id chưa đặt cho `undefined` chứ không phải một thành viên của `Object.prototype`; bản ghi đưa cho simulation (`SimulationInputs.inputs`) không có prototype. `contacts`/`pinOutputs` vốn đã an toàn (so sánh `=== true`, pin phải thuộc board); tra `inputKindOfModel[model]` chỉ so sánh với bốn chuỗi kind nên an toàn dù model có tên là thành viên của object.
       - **So sánh state.** `report` bỏ qua state không đổi bằng `sameComponentState` (độc lập thứ tự thuộc tính; `undefined` = vắng; frame so từng pixel; thuộc tính lạ khác nhau thì coi là khác, tức publish dư chứ không bao giờ thiếu), không dùng `JSON.stringify`.
       - **R4 giữ nguyên.** `report`/`drivePin` publish là bước **cuối** như mọi thao tác; một listener gọi `start`/`stop` trong lúc đó vẫn theo luật "lời gọi sau cùng thắng", và abort handler của run cũ có thể report (tắt âm) mà không đụng được vào run mới. Các kịch bản có test ở `run-session.peripheral-state.test.ts` và `run-session.simulation-access.test.ts`.
     - **Không làm (cố ý).** Không event, hàng đợi, callback hay `onInputChanged` (seam event chỉ có khi EV đạt, YB-7): lịch sử nhấn là bộ đếm **kéo** (pull), không ai được gọi lại. Không field theo thiết bị (`sliders`, `buttons`, ...). Không ngữ nghĩa chân, display, âm thanh, ánh sáng. Không validate nội dung `ComponentState` (kiểu và `isFrame` của capability sở hữu nó).
     - **Cách YB-3 / YB-4 dùng.** YB-3: `ButtonIO.isPressed` đọc `input(id)`, `takePresses` gọi `takePresses(id)`; `DisplayIO.setFrame` gọi `report(peripheralComponentId(board.id, 'display'), { frame })`; âm thanh báo `{ hz }` rồi `report(.., null)` qua `services.scheduler`. YB-4: `digitalWrite` gọi `drivePin`, `digitalRead`/`analogRead` đọc `simulation()`; biến trở thêm **một dòng dữ liệu** `'analog-source': 'slider'` vào `inputKindOfModel` và model của nó đọc `SimulationInputs.inputs[id]`. `RunSession` không cần biết tên thiết bị nào.
     - **Giới hạn đã biết.** `gesture` được vận chuyển như mọi `ComponentInput` nhưng chưa có bộ đếm: C-18 đang EXCLUDED, và đếm theo cạnh chỉ cần cho `hold` (C-13). `RunSessionOptions.capabilities` vẫn là **một** factory; khi YB-3 và YB-4 cùng land, ghép hai factory (capability của họ rời nhau) là việc của PR merge sau, ở composition root.

### YB-3 — Basic onboard hardware + runtime controls
- **Goal:** display, nút A/B, âm thanh, ánh sáng (chỉ construct đã ELIGIBLE/RESTRICTED), control, renderer, audio.
- **Sub-task:** **3a** display + nút + `hold`; **3b** âm thanh + ánh sáng + slider.
- **Files:**
  - core: `src/core/constructs/ybc.display.ts`, `ybc.input.ts`, `ybc.sound.ts`, `src/core/simulation/peripherals/*`;
  - ui: `YbcBoardRenderer.tsx`, `src/ui/runtime-controls/*`, `src/ui/audio/*`;
  - data: dữ liệu hình/font/nốt **của mình** (provenance §6.8).
- **Tests:** §18.4; trace + golden + syntax + EG cho mọi construct; a11y bàn phím; E2E P1–P4.
- **Acceptance:** chỉ construct đạt EG xuất hiện; Stop tắt âm ngay; âm mặc định tắt có chỉ báo hình; budget §19.
- **Out-of-scope:** event, màu, vẽ hình tự do, nhiệt độ.
- **Dependencies:** YB-CP. 3a implement theo model display đã duyệt (OQ-E APPROVED, §7.4). **Không** sửa file dùng chung ngoài thủ tục amendment.
- **Ghi chú triển khai (YB-3, 2026-10-14).** Không đổi kiến trúc, contract hay evidence; dùng seam của Amendment 1 (YB-CP mục 9) nguyên vẹn. Các điểm plan để mở hoặc cần chốt khi viết code:
  1. **Phạm vi: 3a + 3b.** Đúng 9 hàng contract: display C-06 (hình tự vẽ), C-07 (chạy chữ), C-08 (chạy số), C-09 (xoá); nút C-12 (đang giữ), C-13 (`get_presses`, NICE); ánh sáng C-15; âm thanh C-50 (nốt), C-51 (nghỉ). Cả hai profile liệt kê các hàng này (Advanced ⊇ Basic, cùng dữ liệu), thêm pack `ybc.display`, `ybc.input`, `ybc.sound` (category Display, Input, Sound; thứ tự `ybc.structure`, `ybc.display`, `ybc.input`, `ybc.sound`, rồi pack ngôn ngữ) và `controls: ['button-a', 'button-b', 'light']`. Không mở: đặt/tắt điểm và màu (YB-7a), nhiệt độ (YB-7b), servo (YB-7c), chân header (YB-4), `pitch`/`stop`/giai điệu dựng sẵn/tempo của learner, độ sáng, A+B, event (DEFERRED), PWM, random, thời gian chạy. Mỗi dropdown learner thấy được nằm đúng domain: nút `A`/`B`, 15 nốt tự nhiên C3…C5, độ dài `1`/`2`/`4` tick.
  2. **Quyết định của owner (2026-10-14): YB-3 sinh Python cho hàng của chính nó.** Theo YB-3 "Tests: trace + golden + syntax + EG cho mọi construct", §18.1 ("cùng phase với construct"), §18.2 và ghi chú YB-5A #2/#14. Bất biến đã freeze của YB-5A (`profile.constructs` = `generatedConstructs`) vẫn đúng; hai câu "không sinh hàng phần cứng" của `generate.constructs.test.ts` là ảnh chụp theo phase nên chỉ được sửa cho 9 hàng YB-3 mở. Golden YB-3 nằm ở thư mục riêng `src/core/codegen/yolobit/hardware/__golden__/` (script syntax đã quét mọi thư mục tên `__golden__`), nên 25 golden ngôn ngữ của YB-5A **không đổi một byte** và các test liệt kê golden của YB-5A không phải sửa.
  3. **IR (`ybc-ir.ts`, theo §9.1).** `Statement` thêm `{ kind: 'call'; op; … }` và `Expr` thêm `{ kind: 'read'; op; … }`, **gõ kiểu theo từng `op`** (không `args: Expr[]` tự do): `display.show` (operand `image`), `display.scrollText`, `display.scrollNumber`, `display.clear`, `sound.playNote` (operand `note`), `sound.rest`; `button.isPressed` (bool), `button.getPresses` (int), `light.level` (int). Hình, nốt, nút là **operand**, lấy từ field của block, không phải giá trị (F3-A): không gán, so sánh, in hay truyền được. Giá trị của dropdown vào IR là kiểu rõ (`'A' | 'B'`, `NoteName`, `NoteTicks`), không phải tên field của Blockly.
  4. **Compiler.** `compileYbcProgram(blocks, exposed, noop?, capabilitySet?)`: `capabilitySet` là `BoardContext.readiness.capabilities`; block mà capability của nó không có → `capability-unavailable` (§10). `RunSession.compileFor` và `generateForDocument` chỉ truyền tập này đi tiếp, không biết tên tính năng nào. Domain enforce ở compile: literal text ngoài ASCII 0x20–0x7E → `display-char-unsupported` (block của text); nốt/độ dài/nút ngoài domain → `value-out-of-range`; dropdown thiếu hoặc không phải chuỗi → `malformed-program`; ô hình thiếu = tắt (đúng cách Blockly nạp), ô không phải boolean → `malformed-program`. **Evidence trên Blockly 13.3.0:** giá trị dropdown ngoài danh sách (`E9`, `8`, số `2`) bị Blockly thay bằng **lựa chọn đầu** khi nạp, nên chỉ document đi vòng qua editor mới tới được compiler; compiler vẫn từ chối (test trên Blockly thật).
  5. **Interpreter (`ybc-interpreter.ts`).** Thời gian là của câu lệnh (§10), qua `services.sleep` và budget, không timer rời. **Chạy chữ** (contract §4.2, timing là quan sát simulator, không phải kiểm vật lý): text rỗng không làm gì; 1 ký tự hiện tĩnh, không chặn; n ≥ 2 ký tự: 6n bước, mỗi bước một cột sau `SCROLL_STEP_MS` = 200 ms, ký tự đầu sát cột 0, kết thúc bằng khung trống, tổng 1200·n ms; mỗi bước là một budget step nên Stop dừng ở cột kế tiếp. Các cột đến hạn tại thời điểm cố định tính từ cột đầu (`due += SCROLL_STEP_MS`, đọc `services.clock`), không phải "chờ 200 ms sau mỗi cột": timer luôn trễ một chút, và độ trễ đó sẽ cộng dồn dọc một text dài (đo thật: 66 cột trễ ≈36 ms ở cột cuối, trên budget §19 ±20 ms); trễ thì lần chờ kế ngắn lại; trễ từ một cột trở lên (tab ẩn, máy treo) không bù bằng một loạt khung nhanh. Fake clock vẫn chính xác. Text **động** ngoài ASCII → `out-of-domain` tại block (domain guard). **Nốt:** `startTone(hz)` → chờ `ticks × NOTE_TICK_MS` (125 ms ở tempo (4, 120) do generator đặt, IM-4) → `stopTone()` trong `finally`, nên Stop không để lại tiếng; **nghỉ** chỉ chờ. `capability` vắng hoặc trả giá trị sai miền (ánh sáng ngoài 0..100, số lần nhấn âm/lẻ) → `internal-error`, không throw. Lệch nhỏ đã ghi: contract §8.1 viết "`:1` ≈ 130 ms" (đo `sound-indicator`), còn hàng C-50 và EVD-20 (131 / 250 / 500) cùng IM-4 nêu **125 ms/tick** là domain đã freeze; code theo C-50.
  6. **Peripheral qua seam đã freeze (`src/core/simulation/peripherals/*`).** `createOnboardCapabilities` (một `CapabilityFactory`) dùng **chỉ** `environment.input`, `environment.takePresses`, `environment.report`; trả đúng bốn key `display`, `buttons`, `light`, `sound` để factory của YB-4 ghép theo key; `RunSession` không biết tên thiết bị nào và không thêm gì cho YB-3. Display báo `{ frame }` tại `<board>/display`; buzzer báo `{ hz }` tại `<board>/buzzer` khi nốt đang phát và `null` khi hết. Nút và ánh sáng **không** báo gì: `takePresses` đếm ở cạnh nhấn lúc input tới (nhấn–thả ba lần trong một `sleep` vẫn đọc ra 3, rồi 0), `isPressed` đọc giá trị mới nhất. Vì seam cố ý không có listener, snapshot không phản chiếu nút/slider; trạng thái "đang nhấn" và vị trí slider chỉ là **trình bày** của control (UI). Snapshot ban đầu không có state của display (seam bỏ qua `report` trong lúc factory chạy): renderer coi vắng mặt là tắt hết.
  7. **Ánh sáng (C-15).** `light_level()` là `int` 0..100 theo tooltip (không theo widget); slider UI 0–100 % và thang của board cùng N = 100 nên đọc qua `percentToNative(value, 100)` của `conversions.ts` (clamp/làm tròn ở đó, không viết lại công thức). Giá trị ban đầu của một run là 50 (`LIGHT_LEVEL_INITIAL`): contract không nói gì (đọc cảm biến là của môi trường), nên đây là lựa chọn của môi trường ảo, không phải field quan sát được.
  8. **Font (`peripherals/font.ts`).** Font 5×5 **của dự án** cho ASCII 0x20–0x7E (95 glyph), vẽ mới, không lấy từ OhStem hay font nào khác (provenance §14 của contract đã cập nhật). Hình dạng glyph là `presentation`; metric có evidence (ô 6 cột, 200 ms/cột) nằm ở `display.ts`.
  9. **Python (§13).** `generate.ts` thêm header theo thứ tự cố định: `import time`; nếu có op của `yolobit` (display, nút, ánh sáng): `from yolobit import *` + đúng 3 dòng preamble (IM-2); nếu có nốt/nghỉ: `import music` + `music.set_tempo(4, 120)` (IM-3, IM-4). Dạng gọi lấy nguyên từ contract: `display.show(Image("r0:r1:r2:r3:r4"))` (hàng trên→dưới, chữ số trái→phải, `1` sáng), `display.scroll(<text hoặc int>)`, `display.clear()`, `button_a|b.is_pressed()`, `button_a|b.get_presses()`, `light_level()`, `music.play(['<note>:<ticks>'], wait=True)`, `music.play(['R:<ticks>'], wait=True)`. Module nào dùng mới import (một program chỉ có nốt không import `yolobit`). Việc tìm module dùng stack tường minh (IR có thể lồng sâu tuỳ ý; generator không bao giờ throw). Header được viết trong `generate.ts` (không đọc từ contract, để dữ liệu contract lớn không vào bundle); test ghim chúng bằng dữ liệu contract. Allowlist, parity (CPython với module `time`/`yolobit`/`music` giả: timeline simulator = timeline Python) và domain defence có test; 11 golden gồm mọi nốt/độ dài.
  10. **UI.** `partStates` (state của các part onboard, đọc từ snapshot bằng `Object.hasOwn`) đi vào `YbcBoardRenderer`; control là `RuntimeControls` (nút giữ: pointer + Space/Enter, slider ánh sáng) gọi `RunSession.setComponentInput` với `hold`/`slider`, id `<board>/<part>`; logic control là module thuần để test. Audio (`src/ui/audio/`) là adapter UI theo run: mặc định **tắt**, bật bằng click, có chỉ báo chữ ("Silent" / "Playing 262 Hz") luôn đúng theo snapshot, Stop (snapshot idle) tắt tiếng ngay, không `AudioContext` toàn cục. **Evidence (sửa lỗi phát hiện khi review):** run store chỉ giao cho React snapshot mới nhất mỗi frame, mà core kết thúc một nốt và bắt đầu nốt kế trong cùng một task (`report` `{ hz }` → `null` → `{ hz }`); nên với hai nốt cùng cao độ liên tiếp (vd. C4 C4) khung hình không bao giờ thấy khoảng lặng giữa chúng và tai nghe một nốt dài; tab ẩn không có `requestAnimationFrame` nên tiếng đang phát không bao giờ nhận lệnh tắt. Vì vậy **âm thanh** theo *mọi* snapshot của session qua `runStore.onSnapshot` (không qua snapshot theo frame; chỉ báo chữ vẫn theo frame), và một nốt bắt đầu muộn `START_LEAD_S` = 15 ms nên hai nốt cùng cao độ nghe thành hai nốt; tắt vẫn tức thì. Đây là cách trình diễn (`presentation`, contract §6.3: âm sắc, âm lượng), không đổi `ToneState` hay tuyên bố gì về board. Player chạy *bên trong* run (là listener của snapshot), nên một lỗi Web Audio (`InvalidStateError` khi tạo/khởi động/dừng node, `resume`/`close` ném) chỉ có nghĩa là im lặng: player không bao giờ throw và bỏ node hỏng, nếu không lỗi đó thoát qua `report()` và kết thúc chương trình của learner bằng `internal-error`; chỉ báo chữ vẫn nói đúng buzzer đang làm gì. Phía core, `startTone` nằm trong `try` cùng `finally { stopTone() }` nên một `report` lỗi sau khi tone đã được ghi cũng không để lại buzzer "đang kêu" trong snapshot của run đã kết thúc. Nút bật/tắt đổi nhãn ("Turn sound on" / "Turn sound off") và **không** có `aria-pressed` (hai thứ cùng lúc làm trình đọc màn hình đọc trạng thái hai lần). Blockly tự tạo `AudioContext` của nó khi khởi động (engine âm thanh mà editor giữ im lặng, `sounds: false`); E2E chỉ đếm context/oscillator sinh ra sau khi trang lên. Display có bản text 5×5. `src/main.tsx` truyền `createOnboardCapabilities` làm factory của `createRunSession`.
  11. **Validity (§8.6).** L-1: block của ba pack nằm trong Blockly đã đăng ký hợp mọi pack, nên document hạ profile vẫn mở được. L-2: `not-in-profile` như mọi pack. L-3: thêm `capability-unavailable`. L-4: generator `ok` cho cả 9 hàng, nên một program hợp lệ trong simulator không bị chặn ở L-4.
  12. **Test cũ đã sửa vì bị YB-3 thay thế (chỉ các ảnh chụp theo phase):** danh sách pack/construct của profile (`profile.test.ts`, `board-context.test.ts`, `block-packs.test.ts`, `lang.test.ts`), bảng `allowed` của dropdown (`tests/ybc-dropdowns.test.ts`), và hai câu của `generate.constructs.test.ts`; E2E cũ chỉ sửa danh sách category của toolbox. Mọi assertion về hành vi generic, lifecycle (R4), ownership, id có `/`, Frame và golden ngôn ngữ giữ nguyên.
  13. **Chưa làm (đúng phase):** fixture P1–P7 đầy đủ, parity với output OhStem và câu tuyên bố L2 trong UI (YB-5B); highlight block; template `ybc-*` (YB-6); chân header, biến trở (YB-4). **Môi trường:** `pnpm e2e` mặc định của Playwright 1.63 cần `chromium_headless_shell-1243`, còn máy cloud chỉ có bản 1194 (không đổi cấu hình repo); E2E chạy bằng cấu hình ngoài repo trỏ vào Chromium 1194. `mpy-cross` không có trên máy này: MicroPython syntax validation = **PENDING** (CPython `ast.parse` đã PASS làm kiểm tra dự phòng). **Giới hạn đã biết (từ review đối kháng):** (a) `generateYbcMicroPython` ném `TypeError` thay vì trả diagnostic với IR thiếu operand/args cấu trúc — compiler không bao giờ sinh IR đó và các node ngôn ngữ của YB-5A (`print`, `set`, `wait`, `if`, `repeat`) hành xử y hệt, nên không đổi ở đây; (b) `notEligible`, `arithOps`, `compareOps` trong `compile-ybc-program.ts` là object thường tra bằng chuỗi của document (có từ trước YB-3, không thuộc phase này; bảng YB-3 dùng `Map`/`Object.hasOwn`); chỉ document đi vòng qua editor mới tới được, vì Blockly thay giá trị dropdown lạ khi nạp.

### YB-4 — Signal-level I/O (header)
- **Goal:** chân header của `ybc-board` (P0–P2): digital, analog read (native 0–4095, C-Q6 = A), signal-level simulation, biến trở. PWM bị loại ở YB-0 (C-26).
- **Files:** `simulate-circuit.ts` (implementation `PinDrive`), `definitions/potentiometer.json`, `src/core/constructs/ybc.pins.ts`, renderer LED (độ sáng), renderer/slider biến trở.
- **Tests:** scenario digital + analog read; **GB4**; conversions (`percentToNative(p, 4095)`, §11.3); golden/syntax/EG; domain guard (net hở/xung đột, giá trị ngoài khoảng); E2E P7.
- **Acceptance:** construct pin đạt EG có đủ 4 lớp; generic không đổi; chân reserved không dùng được.
- **Dependencies:** YB-CP (gồm Amendment 1, peripheral-state seam).
- **Ghi chú triển khai (YB-4, 2026-10-14).** Không đổi kiến trúc và **không amend contract YB-CP**: YB-4 chạy trên các seam đã đóng băng của YB-CP kể cả Amendment 1 (mục 9 của ghi chú YB-CP) và không đổi shape nào của `Capabilities`, `RuntimeServices`, `RunEnvironment`, `RunSessionOptions`, `ComponentInput`, `SimulationInputs`. Phần dùng chung YB-4 thêm chỉ là **một dòng dữ liệu** `'analog-source': 'slider'` trong `inputKindOfModel` (đúng như Amendment 1 mô tả). Contract Yolo:Bit (`docs/yolobit-compatibility-contract.md`, `yolobit-contract.ts`, evidence) **không đổi một chữ**. Các điểm plan để mở, hoặc evidence cho thấy text YB-4 ở trên cần chỉnh:
  1. **Phạm vi:** C-23 (digital write), C-24 (digital read), C-25 (analog read, native 0..4095), cả Basic và Advanced; pack `ybc.pins` (`src/core/constructs/ybc.pins.ts`) với ba block `ybc_pin_write` (dropdown `PIN` ∈ P0..P2, `LEVEL` ON=`1` / OFF=`0`), `ybc_pin_read` (output `Boolean`), `ybc_pin_analog` (output `Number`); thiết bị `potentiometer` (`family: "ybc"`, ba cổng `vcc`/`out`/`gnd`). Không có block nào khác: PWM/analog write (C-26), servo (C-27, Advanced, YB-7), pulse (C-28) vẫn ngoài phạm vi.
  2. **`PinDrive` thu về chỉ còn digital (sửa §11.1).** `PinDrive = digital | pwm` chỉ để mang duty của PWM; PWM EXCLUDED (C-26) nên biến thể `pwm` sẽ không có consumer. `SimulationInputs.pinOutputs` giữ `0 | 1` (GB4 giữ nguyên từng byte) và dòng "renderer LED (độ sáng)" của task YB-4 **không làm** (nó cũng chỉ phục vụ PWM). Cái được thêm vào simulation: `ybc-board` được mô phỏng như board (rail 3V3/GND, chân), `NetLevel` thêm `'analog'`, và `potentiometer` (model `analog-source`) là nguồn analog duy nhất (`out` = vị trí slider, đọc từ `SimulationInputs.inputs[id]`, khi `vcc` high và `gnd` low; hai nguồn trên một net, hoặc nguồn analog cùng nguồn logic, là `conflict`). `analogPercent` là **số nguyên phần trăm 0..100**, không phải phân số 0..1 như sketch §11.1, vì `percentToNative(p, 4095)` nhận phần trăm và làm tròn `floor(p·4095/100 + 0.5)`: đi qua số thực sẽ có sai số ở các điểm .5.
  3. **Quy tắc đọc chân (thu hẹp, chưa từng mở rộng).** Hợp đồng: net `floating`/`conflict` → `out-of-domain` (C-24, C-25). Hai trường hợp contract không có evidence cũng bị chặn theo cùng nguyên tắc ("simulator không đoán", §6.2), thông điệp nói rõ bằng chữ: (a) **đọc on/off (digital) trên net analog** (ngưỡng logic của chip là claim `electrical`, bị cấm bởi RV-1) → dùng "analog read"; (b) **đọc một chân mà chính chương trình đã ghi** (`write_digital`) → C-23 ghi rõ "ghi rồi đọc lại của simulator không phải evidence", và wrapper `read_digital` có chuyển chân sang input hay không là UNKNOWN. Net `high` đọc analog = 4095, `low` = 0 (C-25).
  4. **Nối capability qua seam của Amendment 1 (không đổi shape).** `digital` và `analogIn` do một `CapabilityFactory`, `createPinCapabilities(registry)` trong `src/core/run/ybc-pin-io.ts`, tạo cho từng run từ `RunEnvironment` của run đó: ghi chân là `environment.drivePin(pin, level)`, đọc chân là tín hiệu của net trong `environment.simulation()` (bản sao; `null` khi run đã hết hoặc bị thay → capability inert: đọc 0, ghi không tới đâu). Chân mà chương trình đã ghi được nhớ trong chính capability của run đó (chương trình không đọc lại chân đã ghi, mục 3b); không giữ trạng thái toàn cục. `RunSession` **không biết** chân, biến trở hay tên thiết bị của YB-4 (chỉ chuyển `BoardTarget` cho compiler, mục 5): composition root `src/main.tsx` truyền factory vào `RunSessionOptions.capabilities`, vẫn là **một** factory (ghép với factory của YB-3 khi hai nhánh cùng land là việc của composition root, như Amendment 1 đã ghi). Một run ybc không factory vẫn nhận `{}` như ở YB-CP; ba kỳ vọng của `run-session.boundary.test.ts` giữ nguyên bản amendment, cùng các bất biến YB-CP (cùng một `RuntimeServices` cho factory và interpreter, bỏ capability board không có, mỗi run có services riêng, reentrancy R4, run đã mất quyền không ghi và không đọc). Ghi tên chân lạ (`constructor`, `P3`…) hoặc mức không phải 0/1 → `out-of-domain`.
  5. **`capability-unavailable` (§10, YB-CP note 7).** `compileYbcProgram(blocks, exposed, noop, target)` nhận thêm `BoardTarget` (`src/core/devices/board-pins.ts`: capability id của board và các chân dùng được cho từng capability, **trừ chân `reservedPins`**); `RunSession` và `generateForDocument` đều truyền cùng target, nên Run và Python panel luôn nói cùng một chẩn đoán. Không truyền target = board không có gì → block cần capability bị `capability-unavailable` (không giả thành công). Chân ngoài P0–P2 hoặc bị reserved → `value-out-of-range`. Chân reserved không vào dropdown, không qua compiler, không qua runtime; `ybc-board` hiện có `reservedPins: []` nên các ca reserved được test bằng registry fixture.
  6. **Bốn lớp trong cùng phase (R1, §18.1) — ranh giới với YB-5B.** Acceptance YB-4 đòi pin "đủ 4 lớp" và §21.0 đòi golden + syntax + allowlist ở phase mở construct, nên YB-4 **có** Python cho đúng C-23/C-24/C-25 và dòng import/preamble IM-2: `generatedConstructs` thêm ba hàng, `from yolobit import *` + ba dòng preamble chỉ xuất hiện khi chương trình dùng pin (`codegen/yolobit/modules.ts`, text ghim vào contract bằng test); golden ở `codegen/yolobit/pins/__golden__/` (thư mục `__golden__` riêng để không đụng corpus YB-5A, vẫn nằm trong corpus của `check-python-syntax`). Parity: chạy cùng IR qua interpreter và qua golden dưới CPython với `yolobit` giả, so từng lời gọi chân theo thứ tự và các dòng `print`. YB-5B vẫn sở hữu: fixture P1–P7, parity với output OhStem, EG/completeness cho toàn bộ `ybc-basic`, câu tuyên bố UI, highlight. Tuyên bố vẫn đúng mức: syntax check bằng CPython **không** là MicroPython PASS.
  7. **Profile (YB-1 note 3).** `profile.palette` của hai profile thêm `led`, `resistor`, `push-button`, `potentiometer` (sau `ybc-board`); `blockPacks` thêm `ybc.pins` (sau `ybc.structure`); `constructs` thêm C-23, C-24, C-25. Advanced vẫn ⊇ Basic (hai profile giống nhau về pin).
  8. **Slider biến trở.** Input runtime `slider` là `ComponentInput` chung (§11.3): số nguyên, state của run (rơi khi Stop/thay run, B2). Đường đi: `PotentiometerControls` → `setComponentInput(id, { kind: 'slider', value })` → input plane chung của run → `SimulationInputs.inputs` → model `analog-source` → net analog → `analogIn.analogRead`. `RunSession` chỉ định tuyến theo dữ liệu `inputKindOfModel['analog-source'] = 'slider'`; **mạch thắng** như YB-CP (id có dấu `/` vẫn là component của mạch). Model kẹp ở hai đầu 0..100 (`clampSliderPercent`; không phải số nguyên → vị trí nghỉ), mặc định 0 % khi chưa chạm. Vì input plane lưu và so sánh input **nguyên văn**, `999` sau `100` là một input mới (có thể có thêm một snapshot) dù núm vẫn ở 100. UI (`PotentiometerControls`) chỉ thích ứng input: `<input type="range">` có nhãn, chỉ hiện khi đang chạy, tìm control theo `inputKindOfModel`, số hiển thị lấy từ snapshot (`components[id].value`), renderer vẽ núm từ cùng con số.
  9. **Bằng chứng B9 sai (cập nhật §14, bài `ybc-pin-button`).** *(Đã giải quyết ở N17 B4 bằng quyết định owner: net hở đọc 0 + cảnh báo; xem contract §26.)* Plan viết "YB-4 chọn linh kiện/mạch" để chân đọc luôn được drive. Với `push-button` (SPST) và simulation mức logic không có pull (pull mặc định UNKNOWN, `set_pull` EXCLUDED, BL-S1 hoãn), net hở khi nhả nút → mọi lần đọc chân đó dừng chương trình `out-of-domain`; một điện trở không giúp được vì điện trở dẫn thẳng và ép net `conflict`. Hai chân được drive liên tục chỉ có thể là (i) biến trở (analog read), (ii) nối thẳng 3V3/GND hoặc loopback từ chân khác. **YB-4 không thêm thiết bị đổi mạch hay mô hình pull** (ngoài file list, và pull là evidence UNKNOWN). Bài B9 cần quyết định của owner trước YB-6: thiết bị đổi mạch (SPDT) hoặc bài đọc chân qua loopback/biến trở.
  10. **Các tầng hợp lệ.** L-1: block pin và `potentiometer` mở được ở mọi family (Blockly đã đăng ký mọi pack). L-2: ngoài `ybc-basic`/`ybc-advanced`, block pin là `not-in-profile` và `potentiometer` là `incompatible-devices`; giữ nguyên trong tài liệu. L-3: một board + compile cho đúng board đó; đọc chân hở/xung đột là lỗi **runtime**, không phải compile. L-4: generator `ok` cho cùng chương trình đó (sự kiện domain lúc chạy không phải việc của generator, §YB-5A #12).
  11. **Không có:** event (đọc là polling), PWM, random, thời gian chạy, A+B, `set_pull`. Không dependency mới.

### Tích hợp YB-3 + YB-4 (ghi chú, 2026-10-15)
- **Đầu vào:** YB-3 `423abc4` và YB-4 `46b86d0` (cả hai đã review và freeze, cùng gốc YB-CP Amendment 1 `d47395b`), merge vào nhánh tích hợp bằng merge commit thường. Không đổi ngữ nghĩa của construct nào và không amend contract YB-CP; các điểm dưới đây chỉ là cách ghép hai phase ở những chỗ dùng chung. Ghi chú YB-3 #4 và YB-4 #4–#6 mô tả từng phase khi còn riêng; khi khác, ghi chú này là trạng thái sau tích hợp.
  1. **Compiler:** một tham số `target?: BoardTarget` thay cho `capabilitySet?` (YB-3) và `target = noBoardTarget` (YB-4). Có target: block onboard kiểm `target.capabilities`, block pin kiểm capability và chân dùng được. Không có target (chỉ unit test): block onboard **không** bị kiểm (như YB-3), block pin là `capability-unavailable` (như YB-4). `RunSession.compileFor` và `generateForDocument` truyền cùng `boardTargetOf(board, readiness.capabilities)`.
  2. **IR:** `CallStatement` / `ReadExpr` (onboard, YB-3) cùng `PinCallStatement` / `PinReadExpr` (header pin, YB-4, mỗi op một member để kiểm `op` là phân biệt được). Interpreter và generator rẽ theo `op`: pin → `runPinCall` / `runPinRead` và dạng Python của YB-4; còn lại → `runCall` / `readPart` và `emitCall` / `renderRead` của YB-3.
  3. **Import (IM-1…IM-4):** bảng `moduleOfOp` (của YB-3, thêm ba op pin → `yolobit`) nằm ở `codegen/yolobit/modules.ts` cùng `yolobitModuleLines`; `usesYolobitModule` đọc bảng đó, nên chương trình chỉ có âm thanh **không** import `yolobit`. Thứ tự giữ nguyên: `time` → `yolobit` + preamble → `music` + `set_tempo`.
  4. **Composition root:** `src/main.tsx` ghép hai factory, `createOnboardCapabilities` (`display`, `buttons`, `light`, `sound`) và `createPinCapabilities(registry)` (`digital`, `analogIn`); key không trùng, `RunSession` bỏ capability board không có. `RunSession` vẫn không biết tên thiết bị.
  5. **Profile và toolbox:** hợp của hai phase; `blockPacks` = structure, display, input, sound, pins, rồi pack ngôn ngữ, nên toolbox là Program, Display, Input, Sound, Pins, Logic, …; `palette` của YB-4, `controls` của YB-3.
  6. **UI:** container điều khiển biến trở đổi tên `runtime-controls` → `potentiometer-controls` (class, `data-testid`, CSS, E2E của YB-4), vì `runtime-controls` là của YB-3 (`src/ui/runtime-controls/*`) và hiện cả khi idle: trùng tên làm CSS overlay của YB-4 áp lên board panel và làm assertion E2E của YB-4 sai. Control biến trở nằm trong `.circuit-stage` (dự án ybc) như overlay của canvas.
  7. **Test:** các test ranh giới phase (`ybc.test.ts`, `tests/ybc-phase-boundary.test.ts`, allowlist hardware, `tests/ybc-pins-seam.test.ts`) chuyển sang ranh giới chung YB-3 + YB-4, giữ nguyên mọi loại trừ khác (PWM, servo, pulse, nhiệt độ, event, random, thời gian chạy, A+B, giai điệu, pitch/stop/tempo, display Advanced). `tests/ybc-integration.test.ts` kiểm phần chỉ có khi ghép: import của chương trình dùng cả hai module, chương trình chỉ có âm thanh, một run dùng cả hai factory.

### YB-5B — Basic compatibility suite + export UX
- **Goal:** L1 + L2 cho Basic.
- **Tasks:**
  1. fixture P1–P7;
  2. parity;
  3. EG/completeness cho toàn bộ `ybc-basic`;
  4. câu tuyên bố trong UI (L2 hoặc L2 PENDING);
  5. highlight (NICE).
- **Acceptance:** L1 đạt; L2 đạt **hoặc** ghi rõ PENDING vì thiếu công cụ syntax; không còn field UNKNOWN ở construct được mở.
- **Dependencies:** YB-3, YB-4.

### YB-6 — Basic templates + STEMLearning
- **Goal:** bài B1–B10 thành key; mở được khi nhúng; New ở standalone chọn family/profile; đổi profile (R-F9).
- **Files:** `src/samples/ybc-*.project.json`, `templates.ts`, `App.tsx`, `e2e/embed.spec.ts`, `e2e/ybc-lessons.spec.ts`.
- **Tests:**
  - mọi key đạt **mức kỳ vọng** của nó (§8.6): bài học và `ybc-*-empty` → L-4 (mở, compile, generate, syntax); template generic giữ mức hôm nay (`empty` chỉ L-1);
  - GB5, GB12;
  - iframe sandbox (§17.3);
  - layout 1100×640;
  - UI chọn profile thật (R-F9, §8.6 hàng YB-6), **chỉ với capability đã có tới YB-6**:
    - chọn Basic ↔ Advanced;
    - profile được lưu và khôi phục sau reload;
    - toolbox/palette làm mới đúng profile;
    - load/save/reload;
    - diagnostic bằng construct đã có (vd. xoá board → `no-board`, dữ liệu trộn family → `incompatible-devices`).
- **Acceptance:** key Basic freeze và mở đúng; lab không lưu; GB xanh; UI chọn profile đạt các điểm trên; bàn giao danh sách key cho STEMLearning. **Không** đòi construct Advanced thật chạy hay sinh code (round-trip hạ profile thật thuộc YB-7).
- **Out-of-scope:** `postMessage`, sửa repo STEMLearning. *(N6a đã làm `postMessage` và 5 key `ybc-*` cho STEMLearning; YB-6 còn lại: bài B1–B10, UI chọn profile ở standalone.)*
- **Dependencies:** YB-5B; OQ-A trước khi ship ra lesson.

### YB-7 — Advanced hardware/peripherals
- **Goal:** construct Advanced đạt EG (§15).
- **Điều kiện trước (gate, không phải task):** contract Advanced đã freeze; **gate FN** (§6.10) đã ghi vào contract trước khi mở block hàm; **gate EV** (§6.6) trước khi mở event. Model display cho 7a: đã duyệt (OQ-E APPROVED).
- **Sub-task:** **7a** display nâng cao + field vẽ hình; **7b** nhiệt độ, biến `str` + text, nốt/giai điệu tự viết, hàm (**chỉ khi gate FN đạt**); **7c** servo. Theo YB-0: gia tốc/lắc, thời gian chạy, siêu âm, random **không mở**; event DEFERRED.
- **Files:** `src/core/constructs/ybc.*`, `lang.functions.ts`, `lang.text.ts`, `ybc-interpreter.ts` (bảng hàm, phân giải tên FN4, độ sâu gọi, task event nếu có), `compile-ybc-program.ts` (suy kiểu tham số, call graph FN8, `missing-return-value`), `run-session.ts` (amendment: seam event nếu EV đạt), peripheral, `definitions/servo.json`, `ultrasonic.json`, control (`tilt`, `gesture`, slider khoảng cách), `src/ui/blockly/fields/*`, `editor-blocks.ts` (preflight `procedures_*`).
- **Tests:** §18.3b (hàm), §18.4, §18.5 (tăng trưởng mũ của text, độ sâu gọi), **§18.6 nếu có event**, golden/syntax/EG; E2E P9–P11 (P8 DEFERRED); **round-trip hạ profile đầy đủ 17 bước** (§8.6) với construct chỉ có ở Advanced mà phase này thật sự mở (E2E + unit).
- **Acceptance:** chỉ construct đạt EG được mở; hàm chỉ có khi gate FN đạt + §18.3b xanh; event chỉ có khi gate EV (§6.6) đạt + mọi test §18.6 xanh (kể cả guard EV3, EV8); **round-trip 17 bước xanh**: không tự xoá hay migrate block; Run và sinh MicroPython bị chặn bằng `not-in-profile` khi ở Basic, thành công lại khi về Advanced; Basic không đổi; GB xanh.
- **Dependencies:** YB-5B; contract Advanced (freeze ở đầu YB-7 nếu YB-0 chưa đủ).

### YB-8 — Advanced compatibility suite + templates
- **Goal:** L1 + L2 Advanced; key `ybc-adv-*` freeze.
- **Dependencies:** YB-7.

### YB-9 — Final verification
- **Tasks:**
  1. toàn bộ E2E (generic + Basic + Advanced) lặp 3 lần;
  2. checklist a11y;
  3. touch + scale 0,6;
  4. budget §19 so với baseline;
  5. báo cáo tương thích (L1, L2 hoặc PENDING, L3 PENDING; trích firmware/snapshot);
  6. checklist gate vật lý;
  7. Learning log.
- **Acceptance:** §24.
- **Dependencies:** YB-6, YB-8.

### YB-P — Physical-board gate (sau milestone)
§18.9. Có thể nâng lên L3 cho từng program.

---

## 22. Risks

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| 1 | Lệch ngữ nghĩa simulator ↔ MicroPython | EG (không đoán); domain chỉ số nguyên, kiểu tĩnh; YB-5A sớm; fixture hai phía; gate vật lý |
| 2 | **YB-0 không đủ evidence không cần phần cứng** → nhiều construct bị EXCLUDED, Basic mỏng (display, âm thanh, cảm biến) | Ưu tiên DOCUMENTED; explicit-parameter strategy; biểu diễn tự định nghĩa (§6.8); xin phần cứng sớm (OQ-D); bài học được thiết kế lại theo những gì đủ điều kiện |
| 3 | Event không có evidence | Gate EV: hoãn event, dùng bài polling |
| 4 | Display logic của Yolo:Bit khác ưu tiên tạm 8×8 | Owner đã duyệt nguyên tắc tương thích > 8×8 và đã xác nhận model cuối 5×5 (OQ-E APPROVED, 2026-10-14) |
| 5 | IP/license asset, tên | R3; provenance §6.8; OQ-A |
| 6 | Treo/hết bộ nhớ trình duyệt | §6.7; test §18.5 |
| 7 | Trạng thái sửa/board lẫn lộn | §8.5 + ca nghiệm thu |
| 8 | Không có công cụ syntax trên CI | L2 PENDING tường minh; OQ-B |
| 9 | Hai phase song song đặt contract khác nhau | YB-CP + quyền sở hữu file |
| 10 | Scope creep | Non-goals §2; R1/R4 |
| 11 | Layout chật trong 1100×640 | Tab Blocks/Python; E2E |
| 12 | Firmware đổi API | Firmware target/snapshot §7.7 |
| 13 | Phối hợp CMS STEMLearning | OQ-C |
| 14 | Autoplay | Mặc định tắt; chỉ báo hình |

---

## 23. Deferred work

- Python sửa được; Python → block; runtime Python trong browser.
- Transport Serial/BLE; gate L3 (cần phần cứng).
- Số thực, đếm xuống, list (nếu YB-7 chưa đủ điều kiện), `break`/`continue`.
- **Event**, nếu gate EV không đạt.
- ~~`postMessage`/chấm bài~~ (N6a); lưu bài làm trong lab (host giữ, lab không lưu); i18n ngoài lab `lab=`.
- Module cần thư viện; giao tiếp; game; nhiều board.
- Màu/độ sáng display (nếu chưa qua EG); layout mobile (lab `lab=` có tab dưới 800 px từ N8s; standalone chưa).
- Ngôn ngữ mới cho board generic; robot.

---

## 24. Definition of Done

**Mỗi phase/sub-task:**
- [ ] Acceptance của phase đạt.
- [ ] `pnpm verify` xanh; `pnpm e2e` xanh nếu đổi UI.
- [ ] GB1–GB12 xanh, không sửa assertion.
- [ ] Mọi construct được mở: đủ 4 lớp, **qua EG** (không field UNKNOWN/INFERRED), domain enforce ở 4 điểm; hàm chỉ khi gate FN đạt, event chỉ khi gate EV đạt, display theo model đã duyệt (OQ-E).
- [ ] Assertion chỉ bắt buộc từ phase mà tính năng tồn tại (§18, N1); legacy generic IR không đổi (GB11).
- [ ] Golden + allowlist xanh. Syntax check chạy và xanh, hoặc **L2 PENDING được ghi rõ** (không bỏ qua lặng lẽ).
- [ ] Giới hạn là hằng số có test; vượt giới hạn có diagnostic.
- [ ] Không nội dung độc quyền; asset mới có provenance.
- [ ] Không runtime state trong document; 0 `eslint-disable` cho B1/B8.
- [ ] Plan/contract cập nhật trong cùng change nếu ngữ nghĩa đổi.
- [ ] Câu tuyên bố đúng mức đạt (§6.9).
- [ ] Review độc lập xong.

**Milestone Basic** (YB-0 → YB-6): L1 cho P1–P7 (hoặc bản đã viết lại theo EG); L2 hoặc L2 PENDING (chỉ vì thiếu công cụ syntax); key Basic freeze; generic không đổi.
**Milestone Advanced** (YB-7 → YB-9): như trên cho P9–P11 (P8 DEFERRED ở YB-0); a11y/touch/performance đạt; báo cáo tương thích; checklist L3 sẵn sàng.

---

## 25. Open questions remaining after owner decisions

Những gì **không còn** là câu hỏi mở (đã chốt trong plan v0.2):

| Trước đây | Đã chốt ở |
|---|---|
| Nguyên tắc display (OQ2 v0.1) | Owner đã duyệt (2026-10-14): tương thích ngữ nghĩa > ưu tiên tạm 8×8 |
| **OQ-E** — model display logic cuối | **APPROVED (2026-10-14):** 5×5 RGB, 0-based, gốc trên-trái, `x` = cột, `y` = hàng, màu hex, mặc định đỏ (§3 Q5, contract §4.3) |
| **C-Q6** — thang analog (owner decision conflict từ YB-0) | **Option A (2026-10-14):** analog read native 0–4095, UI 0–100 %, không chuẩn hoá về 0–1023; PWM EXCLUDED (§3 Q6, contract §10.2) |
| Firmware target (OQ10) | Output bắt buộc của YB-0 (§7.7) |
| Nguồn hình/giai điệu/font (OQ4) | §6.8: tự làm hoặc license mở dễ dãi có attribution |
| Basic chỉ số nguyên? (OQ8) | §6.4: không có số thực ở cả hai profile trong milestone |
| Thụt lề (OQ9) | §13.4: 4 dấu cách |
| Board generic có block ngôn ngữ mới? (OQ5) | Non-goal §2 |
| UX của New (OQ11) | §17.2: ba lựa chọn |
| Syntax check có bắt buộc? (OQ7) | §6.9: bắt buộc cho L2 (công cụ: OQ-B) |

**Câu hỏi thật sự còn mở**, theo thời điểm cần trả lời:

| # | Câu hỏi (chủ: owner trừ khi ghi khác) | Cần trước | Mặc định nếu chưa trả lời |
|---|---|---|---|
| **Giải quyết trong YB-0** (việc kỹ thuật, không phải owner) | Display model, firmware target, field UNKNOWN, provenance asset | Freeze YB-0 | **Xong** (contract 1.0-draft r3). Owner được báo danh sách construct bị EXCLUDED/RESTRICTED và lesson bị thay (contract §15.2, §19) |
| **Trước YB-2** | Không còn: domain ngôn ngữ đã chốt ở §6.4 (YB-0 thêm `MAX_RANGE_VALUE`, `MAX_REPEAT_ABS` và thứ tự count up, §6.5, §6.7) | — | — |
| **OQ-B** — trước khi nghiệm thu YB-5A | Cho phép cài công cụ ngoài npm (Python 3 và/hoặc `mpy-cross`) trên máy dev/CI để kiểm cú pháp? | YB-5A | Chưa cho → L2 = PENDING. **Quyết định owner (2026-10-14):** CPython `ast.parse` được giữ làm kiểm tra dự phòng khi phát triển; **freeze YB-5A cần `mpy-cross` PASS** trên corpus golden (`pnpm check:micropython`). Hiện **MicroPython syntax validation = PENDING** (máy dev chưa có `mpy-cross`; không dependency npm nào được thêm; xem ghi chú YB-5A #1) |
| **OQ-A** — trước YB-6 / phát hành | Tên sản phẩm của board, và UI có được ghi "compatible with Yolo:Bit" không (pháp lý/thương hiệu) | YB-6 | Không ship template ybc ra lesson; chỉ dùng câu mô tả trong phần export |
| **OQ-C** — trước YB-6 / phát hành | Ai cập nhật danh sách template trong CMS STEMLearning (repo kia), và khi nào | YB-6 | Bàn giao danh sách key; iframe giữ nguyên |
| **OQ-D** — để sau được | Khi nào có Yolo:Bit thật, ai chạy gate L3 | YB-P (không chặn milestone) | Xin sớm để giảm rủi ro #1–#3 |
| Để sau được | Transport upload thật; giao tiếp (BLE/Wi-Fi/MQTT/radio) | Phase sau | Later |
