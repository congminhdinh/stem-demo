# N18 — Mô phỏng robot 3D trên Web cho bộ UNO/Arduino (M04) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (khuyến nghị) hoặc superpowers:executing-plans. Đây là **master plan** cho cả M04. Phase nào bắt đầu thì việc đầu tiên là viết sub-plan TDD chi tiết của phase đó vào `stem-demo/docs/superpowers/plans/2026-10-2x-n18-<phase>.md`, giữ đúng tên, interface, test và acceptance đã chốt ở đây. Bước dùng checkbox (`- [ ]`).

**Goal:** Dựng môi trường mô phỏng 3D trên Web: học sinh lập trình Blockly cho một robot dùng mạch UNO-compatible, robot chạy trên sa bàn 3D có vật lý và cảm biến, bài lab được chấm tự động, kết quả được lưu về LMS. Chuỗi *Block → API → chân/cổng → module* phải là **một nguồn dữ liệu chung** cho simulator, code Arduino C/C++ và thiết bị thật.

**Architecture:** Làm trong stem-demo (sản phẩm độc lập), như một lab kind mới `lab=robot`, nạp lazy. Pipeline: `Blockly JSON → compiler → IR (family "uno") → interpreter trên đồng hồ ảo → module binding (driver) → virtual UNO (mức chân) → module model → world vật lý (Rapier, bước cố định, tất định)`. Renderer three.js/R3F chỉ đọc snapshot. Cùng IR và binding đó sinh sketch Arduino C/C++ cho M06. LMS thêm activity type `RobotLab` và bảng `LabAttempt` để lưu điểm.

**Tech Stack:** TypeScript 6, React 19.3, Vite 8, Vitest 4, Blockly 13.3, Zod 4 (đã có). Mới: `three@0.186.1`, `@types/three@0.186.0`, `@react-three/fiber@9.8.1`, `@react-three/drei@10.7.9`, `@dimforge/rapier3d-deterministic@0.21.0` (wasm tách file) **hoặc** `@dimforge/rapier3d-deterministic-compat@0.21.0` (wasm nhúng base64). R0.1 đã chọn **bản tách file** (`docs/adr/0001-robot-physics.md`). Vite 8.3 tự xử lý `.wasm` nên **không** cần `vite-plugin-wasm`; `-compat` (cùng file wasm) chỉ dùng cho script Node thuần. Chỉ dùng ở dev/test: `avr8js@0.21.1`, `arduino-cli` (tool ngoài). STEMLearning: .NET (CourseService, LearningService), Next.js (`apps/learn`, `apps/admin`, `packages/*`).

**Spec:** văn bản "Thay đổi định hướng phần cứng" (Yolo:Bit → UNO, mục 1–7) và `STEMLearning - Dự toán.xlsx`, sheet "GĐ1 - Báo giá", dòng **M04 — Mô phỏng 3D trên Web, 720 man-hour**: *"Môi trường mô phỏng 3D tích hợp Blockly, robot/thiết bị ảo, cảm biến, sa bàn và các tình huống thực hành; lưu kết quả bài lab về LMS."* Khi thực thi, bước R0.0 chép spec vào `stem-demo/docs/uno-robot-direction.md`.

---

## 0. Context

- **Vì sao làm:** Định hướng phần cứng đổi từ Yolo:Bit (ESP32, MicroPython) sang **mạch UNO-compatible + Arduino Core + control board + module**. Văn bản định hướng nói rõ: phần 3D, vật lý và logic robot không phải viết lại theo phần cứng, nhưng **lớp liên kết Simulator ↔ Blockly ↔ code thật ↔ thiết bị thật** phải phản ánh đúng mạch UNO, pin mapping và library của phần cứng mới.
- **Hiện trạng (đã đọc source):**
  - stem-demo **chưa có 3D**, chưa có vật lý, chưa có Arduino.
  - Dùng lại được:
    - mô phỏng mạch 2D (Konva);
    - dialect IR "YBC" và interpreter async với `RuntimeServices` inject được `clock/sleep/yieldNow/scheduler/randomInt` (`src/core/capabilities/services.ts:48-115`). `createRunScheduler(timers)` nhận timers qua tham số (`:127`);
    - capability theo chân (`src/core/capabilities/io.ts`);
    - generator MicroPython kèm golden và parity harness;
    - challenge/goal;
    - `stem-lab/v1` (`docs/lab-embed-contract.md`, `src/ui/app/host-bridge.ts`).
  - Chỗ khoá cứng phải nới:
    - literal family/target: `devices/device-definition.ts:42,55`, `profiles/profile.ts:9`, `profiles/board-context.ts:13,69-70`, `program/block-packs.ts:91,348`, `compat/contract-types.ts:224,233`, `codegen/yolobit/generate-document.ts:41`, `ui/app/App.tsx:78,340`, `run/run-session.ts:414,553`, `ui/app/lab-host.ts:36`;
    - `values.ts` theo ngữ nghĩa Python;
    - thang analog/PWM của Yolo:Bit cố định ở `simulation/conversions.ts`;
    - pause 10 ms của `forever` cố định (`ybc-interpreter.ts:76,724`);
    - `RunSession` tự tạo services nên luôn chạy wall-clock (`run-session.ts:440-455`);
    - check dùng `setTimeout` thật kèm guard 250 ms và guard tab ẩn (`challenge/check-run.ts`);
    - **chưa có highlight block** (không file UI nào đọc `blockId`);
    - `PulseIO` chưa có cài đặt;
    - Zod `z.object` **bỏ key lạ**, nên field mới của document phải khai báo trong schema (`circuit/document.ts:22-39`).
  - LMS: lab chỉ lưu **cờ hoàn thành** (`ActivityCompletion`, theo `EnrollmentId`). Điểm và kết quả kiểm tra không rời trình duyệt, project nằm ở `localStorage`. Carryover R6 "server-side lab save" còn mở.
  - OhStem (`docs/ohstem-platform-investigation.md` §7.2, `docs/ohstem-demo-reconstruction-spec.md` §11–12): robot 3D của họ là Babylon + Havok + Pyodide, fork GEARS (**GPL-3.0, không dùng/copy**), và không giả lập MCU.
- **Kết quả mong muốn:** 01 khóa pilot (M07: 06 bài) chạy trọn luồng *lý thuyết → lab robot 3D → Kiểm tra → điểm lưu LMS → giáo viên xem*. Kit UNO thật của nhà cung cấp (chưa chốt) được thêm bằng **dữ liệu kit + driver**. Chỉ khi có **loại module mới** mới phải sửa engine, và phần đó có giờ riêng ở VG.

## 1. Phạm vi và ngân sách

| Trong phạm vi M04 | Ngoài M04 (ghi để không lẫn) |
|---|---|
| Lab `robot` trong stem-demo: Blockly + world 3D + robot kit + cảm biến + sa bàn + kịch bản + Kiểm tra + chấm điểm | **M06 (210h):** compile service, upload USB/WebSerial/agent, kiểm chứng L3 trên bo thật, xuất sa bàn để in. **C1** (generator Arduino C/C++) và **C2** (harness avr8js) nằm trong plan này vì contract parity cần chúng, nhưng **giờ tính vào M06** |
| HAL UNO: board profile, kit, port, driver, binding (dùng chung với M06) | **M05 (140h):** thi trong lớp, bảng xếp hạng, exam lab question cho robot (`LabScoring.ScoreRatio = 3`). Plan này chỉ đảm bảo kết quả có `score`/`simTimeMs` và tái lập được |
| Tích hợp LMS: `RobotLab`, `LabAttempt`, CMS chọn kịch bản + preview, giáo viên xem điểm cao nhất, seed khóa pilot | **M07 (80h):** nội dung bài học. Plan này cung cấp 6 kịch bản, starter và lời giải |
| | Robot builder tự do, map builder có UI, sửa C++ bằng text, nhiều robot, kit không có khung xe (thiết bị để bàn: schema cho phép `chassis` tuỳ chọn nhưng M04 chỉ ship kit robot), camera AI, mobile, Yolo:Bit mới (track `ybc` **đóng băng**, vẫn chạy như cũ) |

**Giờ M04 (ước lượng chi tiết sau review, đã gồm các mục ✂):** R0 72 · R1 76 · R2 116 · R3 136 · R4 116 · R5 62 · R6 56 · R7 80 · R8 28 = **742h**. Để về **720h**, cắt các mục ✂ (22h):
- ✂ replay "Xem lại" ở R6.3 (8h), chỉ giữ dòng giải thích lỗi;
- ✂ xuất sa bàn in ở R5.3 (6h), chuyển sang M06;
- ✂ phím tắt camera + vùng có hoa văn ở R8 (8h), chuyển sang P2.

Ngoài M04, tính vào M06: C1 52h, C2 24h.

Dự phòng: nếu **G0 fail** (Rapier không đạt), chuyển sang engine động học 2.5D (khoảng 40–60h). Bù lại bằng cách bỏ vật đẩy được (`object-in-zone`) và kịch bản 6 dùng lại sa bàn của kịch bản 4.

Với 2 dev song song (R3 ∥ R4 sau G1) thì khoảng 10–11 tuần lịch.

## 2. Quyết định kiến trúc (chốt cho M04)

| # | Quyết định | Lý do ngắn |
|---|---|---|
| D-R1 | Làm trong **stem-demo**, lab kind mới `robot`, chunk 3D + physics **lazy** (`React.lazy`), chỉ nạp khi `lab=robot`. Tích hợp LMS **chỉ** qua launch URL + `stem-lab/v1` (thêm field, không đổi nghĩa field cũ) | Quyết định sản phẩm đã có: stem-demo độc lập. Lab 2D không tải thêm byte nào |
| D-R2 | **Runtime = interpreter IR sẵn có**, chạy trên **hai đồng hồ ảo** (§3): `world.t` và `programClock`, với bất biến `world.t ≤ programClock < world.t + dt` trong lúc program chạy. Không dùng wall-clock | Giữ D5 cũ: chạy tức thì, Stop ngay. Kết quả **tất định**, không phụ thuộc FPS, tốc độ máy hay tab bị ẩn. Lab robot bỏ được guard 250 ms |
| D-R3 | **Mở rộng YBC engine thành "board family"** (`ybc` \| `uno`), không fork dialect thứ ba. Nới các literal ở §0. IR mang `numeric: 'python' \| 'cxx-int32'` và `loopPauseUs` do compiler ghi. Target `arduino-avr` | Compiler (1204 dòng) và interpreter (742 dòng) đã có test dày, fork sẽ nhân đôi bảo trì. Ngữ nghĩa số và nhịp `loop()` khác Python nên phải là dữ liệu của IR |
| D-R4 | **Binding hai tầng là nguồn sự thật duy nhất.** IR op ở mức module (`motor.set(motorLeft, 50)`). Kit map role → port → driver. Mỗi driver có **hai cài đặt song song**: TS (ghi chân trên virtual UNO) và C++ helper (sinh vào sketch, kèm danh sách library + version + license). Hai cài đặt được chứng minh tương đương bằng golden test (C1) và trace avr8js (C2) | Đúng yêu cầu "Block → API → pin/cổng → module". Đổi kit chỉ là đổi dữ liệu. Driver mới là code TS/C++ đã review |
| D-R5 | **Virtual UNO ở mức chân**: mode, mức số, duty PWM theo timer, ADC 10-bit, `pulseIn`, Serial, và `WireIO` ở mức giao dịch cho I²C. Có bảng chi phí µs cho mỗi lệnh Arduino, tính vào `programClock`. **Không** giả lập tập lệnh AVR trong lab | Đủ trung thực, chạy tức thì. avr8js chỉ dùng để **kiểm chứng** (C2) và để chốt hành vi chưa rõ (vd. Servo/Timer1) |
| D-R6 | Vật lý: **Rapier deterministic 0.21.0**, bước cố định `PHYSICS_HZ = 120`, `integrationParameters.lengthUnit` đặt cho vật cỡ cm. Nằm trong `src/core/world` (core thuần, test trên Node). Rapier JS đơn luồng nên không cần SAB/COEP. R0.1 (ADR 0001) chọn bản tách `.wasm` (1,18 MB gzip, đạt ngân sách; `-compat` 1,65 MB thì không), drive **(c) diff-drive mức vận tốc** trên khung dynamic, `lengthUnit = 0.1`, 4 solver iteration | Apache-2.0, tất định cross-platform. Không phụ thuộc renderer |
| D-R7 | Render: **three.js + @react-three/fiber + drei**. Đọc snapshot qua ref trong `useFrame` (không re-render React mỗi frame). Hình học **thủ tục** trước, GLB tự làm sau. UI ghi "mạch tương thích UNO", không logo Arduino/OhStem/vendor | MIT, hợp React 19. "Arduino"/"UNO" là thương hiệu |
| D-R8 | Kit tham chiếu **`ref-uno-rover@0`** (pin là PLACEHOLDER, §4.2) cho tới khi có schematic. Kit thật là `kits/<vendor>.kit.json` (+ driver mới nếu giao thức lạ) | M04 không bị chặn bởi nhà cung cấp (văn bản mục 6–7) |
| D-R9 | Chấm theo **world goal** đánh giá trên snapshot mỗi tick. Kiểm tra chạy **N biến thể seeded** (mặc định 3) cho bài 3–6. Bài 1–2 (open-loop) không có jitter. Input kịch bản (nút) là **script**, người dùng không can thiệp được trong lúc Kiểm tra | Tái lập được từ `(project, scenario@version, seeds, engine@version)`. Đây là nền cho M05 và verifier phía server |
| D-R10 | LMS: activity type **`RobotLab = 10`** (append-only, `CompletionMode.OnCheck`). Bảng **`LabAttempt`** trong LearningService, insert-only, khoá theo `EnrollmentId`. Server **tự kiểm** lesson/activity/type và ghi `ActivityCompletion` trong cùng transaction khi đạt | Theo pattern `ProgressBusiness.RecordActivityProgress`. Activity type riêng theo quyết định sản phẩm |
| D-R11 | Mức tuyên bố: **L1** sim-semantic · **L2** compile-verified (`arduino-cli compile --fqbn arduino:avr:uno`, pin version core + library) · **L2e** emulator-trace verified (avr8js, chỉ ATmega328P) · **L3** physical (M06). Không bao giờ ghi "100 % tương thích". Hành vi chưa có evidence (vd. PWM D10 khi có Servo) là **UNKNOWN** và **bị chặn** cho tới khi có trace | Với UNO, L2/L2e kiểm được thật, nên trung thực mà vẫn mạnh |
| D-R12 | Tất định: trong vòng tick của `src/core/world`, `sin/cos/atan2` đi qua `dmath.ts` (port fdlibm, golden **bit-exact**). `sqrt` và phép IEEE cơ bản thì dùng thẳng. Hash được kiểm trên **Node + Chromium + Firefox + WebKit** | `Math.sin` có thể khác giữa các engine. Node và Chromium đều là V8 nên kiểm hai cái đó chưa đủ |

**Sửa luật cũ (ghi vào plan gốc ở R2.1):**
- B5 nay là: "với lab robot, `RobotRunSession` là nơi duy nhất nối program ↔ hardware ↔ world";
- `io.ts` có amendment: thêm `modules` vào `Capabilities`/`capabilityKeys`, thêm `WireIO`;
- `lab-host.ts` đổi từ phép so boolean sang bảng `lab → family` (`blockly→generic`, `yolobit→ybc`, `robot→uno`). Cập nhật `docs/lab-embed-contract.md:79`.

## 3. Kiến trúc và luồng dữ liệu

```text
Kit JSON ──┬─► BoardTarget (board + kit: role, chân, capability) ─► compiler + toolbox (uno-basic|advanced) ─► BlocklyPanel (view)
Board JSON ┘                                                                                  │ Blockly JSON
                                         compile (family "uno") ──► IR {numeric, loopPauseUs} ─┬─► C1 Arduino C++ ─► .ino ─► (M06) compile/upload ─► UNO thật
                                                                                               │
                         RobotRunSession (nơi DUY NHẤT nối program ↔ hardware ↔ world)         ▼
 interpreter (async) ── ModuleIO ─► driver TS ─► VirtualUno (chân, timer, ADC, pulse, Wire) ─► module models (motor, servo, HC-SR04, line, LED, buzzer, nút)
        ▲ programClock (charge µs)                                                               │ mục tiêu actuator   ▲ giá trị đo
        └──────────── VirtualScheduler (deadline, seq) ◄── world.t ── World (Rapier 120 Hz, seeded) ◄┘ sensors (raycast, ground paint)
                                                                         │ RobotSnapshot
                                     goal tracker + scoring ◄────────────┤
                                                                         ▼
                       robot-run-store (≤1 commit/frame) ─► R3F Scene + HUD + PinInspector + TopView2D (fallback)
```

**Mô hình thời gian** (`src/core/run/virtual-clock.ts`, `robot-run-session.ts`):
- `programClock: ProgramClock = Clock & { charge(us: number): void }`. Mỗi lệnh Arduino (theo `costsUs` của board) và mỗi node (mặc định 1 µs) được **charge**. `pulseIn` charge thời gian chờ + độ rộng echo + 3,25 µs; không có xung thì charge chi phí đo của contract UNO §4.4 (20 752 µs với timeout 30000, **không phải** 30000: R0.4). Lệnh đọc là đồng bộ và đọc world state tại `world.t`.
- `VirtualScheduler.advanceTo(tWorld)` resolve timer **từng cái một** theo thứ tự `(deadline, seq)`. Với mỗi timer: đặt `programClock = deadline`, rồi `await whenBlocked()`. Không có lateness: `repeat 100 { wait 10 }` kết thúc đúng 1000 ms ảo cộng chi phí của chính nó, không bao giờ làm tròn lên tick. Mỗi `wait` là một `delay()` của board: `ms × 1000 + delayOverhead` (U-18; option `delayOverheadUs` của `createVirtualScheduler`, R3.6 truyền 8,5625 µs của board). R2.3 đo: 1000 ms khi node và overhead đều bằng 0, 1000,85625 ms với overhead, 1001,15825 ms với overhead và 1 µs/node.
- Ở chế độ ảo, `budget.step()` kiểm **mọi** step (bỏ khoảng 256). Khi `programClock ≥ world.t + dt` thì program **park** (một waiter đặc biệt) cho tới tick sau. Nhờ vậy program không bao giờ chạy trước world quá một `dt`.
- "Blocked" là một trong ba: đăng ký `sleep`, đăng ký `park`, hoặc kết thúc. Yield housekeeping theo wall-clock không bao giờ tính là blocked.
- `sleep` và `park` reject khi `signal` abort.
- `createRuntimeServices` thêm option `budget?` để inject budget ảo.
- `loop()` của family `uno`: `loopPauseUs = 0`, mỗi vòng charge `LOOP_MIN_US = 50`. `ybc` giữ `loopPauseUs = 10000`, hành vi không đổi. IR của `ybc` **không ghi** hai field này (vắng nghĩa là `python` và `10000`), vì test YB-2 khoá nguyên hình IR ybc (R2.3).

**Vòng tick**, với mỗi tick `dt = 1/120 s`:
1. `advanceTo(world.t)`: chạy program tới khi blocked.
2. Module model đọc chân rồi đặt mục tiêu actuator.
3. `world.step(dt)`.
4. Goal tracker cập nhật.
5. Phát snapshot nếu UI đang nghe.

**Chế độ chạy:**
- `realtime`: UI gọi `advance(wallMs × speed)` từ rAF. Lời gọi này **single-flight**: thời gian nợ được cộng dồn, tối đa 8 tick mỗi frame, vượt thì hiện badge "chậm hơn thời gian thực".
- `headless`: `runUntil(tEnd)`, nhường bằng `MessageChannel`, không dùng `setTimeout(0)` vì kẹp 4 ms và bị throttle khi tab ẩn. Mỗi lượt nhường một `MessageChannel` **mới** (`VirtualScheduler.yieldNow`): Node xả hết hàng đợi của một port, kể cả message gửi trong lúc xả, nên một port dùng chung làm đói timer (R2.3 đo trên Node 24.22.1: timer 1 ms chạy 1 lần trong 300 ms, port mới thì 36–37 lần; `spikes/message-channel/`).
- Tab ẩn thì rAF dừng, sim dừng theo, **kết quả không đổi**.

## 4. Hợp đồng chính (tên chốt, task sau dùng đúng tên này)

### 4.0 Project document của lab robot (không bump schema)
`ProjectDocument` vẫn `schemaVersion: 1`:
- `profile: 'uno-basic'|'uno-advanced'`;
- `circuit` có **đúng một** component `deviceType: 'uno-r3'` và **không có dây**;
- `program.blocks`;
- field mới **khai báo trong Zod**: `kit: z.object({ id: z.string(), version: z.string() }).optional()`. Không có `kit` thì dùng `ref-uno-rover@0`.

Test round-trip: `kit survives inspectStoredProject, load-project and localStorage`. `resolveBoardContext` dùng `profile.family`. Profile `uno-*` có `palette: ['uno-r3']`.

DeviceDefinition mới `src/core/devices/definitions/uno-r3.json`: `family: 'uno'`, `board.codeTarget: 'arduino-avr'`, pin `D0–D13`, `A0–A5` với capability theo schema hiện có. Test `uno-r3 device pins equal board profile pins`.

### 4.1 Board profile — `src/core/hardware/board.ts` + `uno-r3.board.json` (mọi giá trị là **dữ liệu**, không phải literal type)
```ts
type BoardProfile = {
  id: string; version: string; mcu: string /* 'atmega328p' */; clockHz: number; adcMax: number; pwmMax: number;
  pins: { id: string /* 'D5' */; caps: PinCap[]; pwmTimer?: string /* 'T0' */ }[];  // UNO: D3,D11=T2 · D5,D6=T0 · D9,D10=T1
  reserved: { pin: string; when: 'serial' }[];                                        // D0, D1
  timerClaims: Record<string /* 'servo' | 'tone' */, string /* timer */>;            // servo→T1, tone→T2
  costsUs: Record<ArduinoCall, number>;                                               // R0.3 chốt
  emulator?: 'avr8js';                                                                // có thì C2 áp dụng
};
type PinCap = 'digital'|'pwm'|'analogIn'|'interrupt'|'i2c'|'serial'|'spi';
```
*Bổ sung khi làm R1.1 (dữ liệu, contract §4.3, §5.1):* `nonPwmThreshold: number` (128: `analogWrite` trên chân không PWM ≥ 128 là HIGH) và `millis: { overflowUs, fractPerOverflow, fractMax }` (mô hình Timer0 của `millis()`). `uno-r3` chỉ ghi `serial` trên D0/D1; `interrupt`, `i2c`, `spi` chờ dòng contract (U-43, U-46 DEFERRED).

### 4.2 Kit — `src/core/hardware/kit.ts` + `kits/ref-uno-rover.kit.json`
```ts
type ModuleKind = 'dc-motor'|'servo'|'ultrasonic'|'line-sensor'|'led'|'buzzer'|'button';   // thêm kind = việc của engine (VG)
type DriverId = 'hbridge-en-in1-in2'|'servo-lib'|'hcsr04-pulsein'|'line-digital'|'line-analog'|'led-digital'|'buzzer-tone'|'button-pullup';
type KitPort = { id: string /* 'M1' */; driver: DriverId; pins: Record<string, string>; params?: Record<string, number|boolean> };
type KitModule = { role: string /* 'motorLeft' */; kind: ModuleKind; port: string; mount: { posCm: [number,number,number]; yawDeg: number }; spec: ModuleSpec };
type Kit = { id: string; version: string; board: string; chassis?: ChassisSpec; ports: KitPort[]; modules: KitModule[] };
```
**Từ vựng role chuẩn** cho robot: `motorLeft, motorRight, ultrasonic, lineLeft, lineCenter, lineRight, servo1, led1, buzzer, button1`. Dropdown của block liệt kê đủ từ vựng này. Role mà kit không có thì compiler báo `capability-unavailable` (từ `BoardTarget` của kit).

**Pin PLACEHOLDER của `ref-uno-rover@0`:**
- M1 trái `EN=D5 IN1=D7 IN2=D8` · M2 phải `EN=D6 IN1=D4 IN2=D2`;
- siêu âm `TRIG=D12 ECHO=D11`;
- line `A0/A1/A2`;
- servo `D9` · LED `D13` · buzzer `D10` · nút `D3` (INPUT_PULLUP).

Không PWM nào nằm trên timer bị chiếm.

*Bổ sung khi làm R1.1:* `KitPort.pins` dùng đúng tên chân của driver (`EN`/`IN1`/`IN2`, `TRIG`/`ECHO`, `PIN`: là `<ROLE>_<chân>` của dạng C++ trong contract §2.3). `ModuleSpec`, `ChassisSpec` là record số/bool/chuỗi mà world (R3.3, R3.4) sở hữu khoá; R1 chỉ kiểm hình dạng. Không có `kit` thì dùng `referenceKitRef` của `src/core/hardware/catalog.ts`. Thay kit của nhà cung cấp: `src/core/hardware/kits/README.md`.

*Bổ sung khi làm R3.3:* phần cơ khí của kit nay có kiểu và được `loadKit` kiểm (`src/core/hardware/kit-mechanics.ts`, đường dẫn từng lỗi). **Khung robot** của `mount.posCm`: lấy tâm chassis, gốc trên mặt sàn ngay dưới tâm hộp thân khi robot đứng yên, **x trước, y trái, z lên**, cm và độ (`yawDeg` ngược chiều kim đồng hồ quanh z). `ChassisSpec = { bodyCm: [l, w, h]; clearanceCm; massG; comCm; trackCm; casterCm; casterRadiusCm; frictionWheel }`. `spec` theo kind: `dc-motor { maxRpm, tauS, stallTorqueNm, gearFrictionNm, wheelRadiusCm, wheelWidthCm }`, `servo { sPer60Deg, minDeg, maxDeg, restDeg, stallTorqueNm, armLengthCm, armWidthCm, armHeightCm, armMassG }`, `ultrasonic { coneHalfDeg, minCm, maxCm }`, `line-sensor { heightCm, spotRadiusCm, darkBelow }`, `led`/`buzzer`/`button` `{}`. Mọi khoá bắt buộc, khoá lạ bị từ chối; quy tắc hình học (hai bánh chung trục cách `trackCm`, bánh và caster chạm sàn, tâm khối lượng giữa trục và caster…) xem `kits/README.md`. `KitModule.spec` vẫn là record ở kiểu `Kit`; world đọc có kiểu qua `robotMechanics(kit)` / `modulesOfKind(kit, kind)`.

### 4.3 Driver — `src/core/hardware/drivers/<id>.ts`
```ts
type Driver<A> = {
  id: DriverId;
  sim(io: UnoPinIO, port: KitPort, args: A): void | number;
  cpp: { libraries: { name: string; version: string; license: string }[]; includes: string[];
         globals(port: KitPort): string[]; setup(port: KitPort): string[]; helper: string; call(port: KitPort, argExprs: string[]): string };
};
type UnoPinIO = DigitalIO & AnalogInIO & PwmIO & ServoIO & PulseIO & { pinMode(pin, mode): void; tone(pin, hz, ms?): void; noTone(pin): void; wire: WireIO };
type WireIO = { write(addr: number, bytes: number[]): void; read(addr: number, count: number): number[] };   // device model gắn theo địa chỉ
```
*Điều chỉnh khi làm R1.4 (evidence: contract §2.3 có một dòng cho mỗi op, và còi có `buzzer.tone`/`buzzer.stop`, line có `line.dark`/`line.raw`):* cặp `{ sim, cpp }` của §4.3 nằm ở **từng op**; driver giữ phần chung của các op. Hình dạng đã dựng (`src/core/hardware/drivers/driver.ts`):
```ts
type Driver = { id: DriverId; ops: Record<string /* op IR: 'motor.set' */, DriverOp>;
  libraries: CppLibrary[] /* hợp của libraries các op */; defines(port: KitPort, role: string): string[] /* '#define MOTOR_LEFT_EN 5' */ };
type DriverOp = { kind: 'call'|'read'; row: string /* dòng contract: 'U-20' */; args: (ArgRange|null)[] /* khoảng kẹp, null = bool */;
  requires?: { pin: string; cap: PinCap } /* line.raw chỉ có trên chân analogIn */; setup: SetupStep[] /* pinMode / servoAttach, chung cho TS và C++ */;
  sim(io: DriverIO, port: KitPort, args: number[]): void | number | boolean;
  cpp: { libraries: CppLibrary[]; includes: string[]; helper: { id: string; text: string } | null;
         globals(port: KitPort, role: string): string[]; setup(port: KitPort, role: string): string[]; call(port: KitPort, role: string, argExprs: string[]): string } };
type DriverIO = UnoPinIO & { delayMicroseconds(us: number): void; compute(us: number): void /* thời gian của chính helper mà contract đo; chỉ HC-SR04 */; costsUs: CostsUs };
```
`role` cần cho tên `#define` (`MOTOR_LEFT_EN`) và `Servo <role>;`. Drive (U-21, U-22) không phải driver: binding gọi hai motor, role `drive`, op `drive.move` (args `[direction, speed]`, `driveDirections`) / `drive.stop`; C++ của nó là `driveCall`.

### 4.4 IR (family `uno`) — `src/core/program/ybc-ir.ts`
- IR mới có thêm: `numeric: 'python'|'cxx-int32'`, `loopPauseUs: number`.
- Call: `motor.set(role, speed −100..100)`, `drive.move(dir: forward|backward|spinLeft|spinRight, speed)`, `drive.stop`, `servo.set(role, angle 0..180)`, `led.set(role, on)`, `buzzer.tone(hz, ms)`, `buzzer.stop`. Advanced thêm `digital.write`, `pwm.write (0..255)`.
- Read: `ultrasonic.cm(role)` (2..400, không echo → **400**), `line.dark(role)` (bool, driver chuẩn hoá cực tính), `line.raw(role)` (0..1023), `button.pressed(role)`, `digital.read`, `analogIn.read (0..1023)`, `time.millis`.
- Ngoài miền thì **kẹp + cảnh báo một lần mỗi role mỗi run**. Generator viết sẵn giá trị đã kẹp.

### 4.5 World — `src/core/world/world.ts`
```ts
createWorld(input: { arena: Arena; kit: Kit; seed: number; variant: VariantOffsets }): Promise<World>;
interface World { readonly t: number; step(dt: number): void; applyActuators(a: ActuatorTargets): void;
  sense: { distanceCm(role: string): number; groundReflectance(role: string): number /*0..1*/; contacts(): ContactEvent[] };
  snapshot(): RobotSnapshot; dispose(): void; }
type RobotSnapshot = { t: number; robot: Pose & { wheelRad: [number, number]; servoDeg: Record<string, number> };
  objects: { id: string; pose: Pose }[]; sensors: SensorReadout[]; pins: PinState[]; leds: Record<string, boolean>;
  activeBlockId: string | null; status: 'idle'|'running'|'finished'|'error'; outOfArena: boolean; score: ScoreState };
```

*Bổ sung khi làm R3.5 (`src/core/world/{world.ts,snapshot.ts,goal-frame.ts,robot/footprint.ts}`):*
- **Hai entry point.** `createScenarioWorld(scenario, kit, variantIndex, { ultrasonicNoiseCm? })` là entry point chính (R3.6 gọi): lấy `variantOffsets`, `applyVariant` rồi dựng world với seed của biến thể. `createWorld({ arena, start, kit, seed, variant?, ultrasonicNoiseCm? })` nhận `arena` và `start` **đã** áp biến thể; không bao giờ áp `variant` lần nữa, chỉ giữ lại (`world.variant`) và kiểm `seed === variant.seed`. Signature §4.5 thiếu `start`; nay có. `kit` phải là kit của scenario (`scenario.kit === kit.id`).
- **Kiểm chân xuất phát.** Trước khi dựng physics, `startFootprintIssues` so mọi phần của robot nhìn từ trên (thân từ `clearanceCm` trở lên, hai bánh, caster, tay servo ở **mọi** góc `minDeg..maxDeg`, lấy mẫu từng độ; mỗi mẫu dài thêm (w/2)·sin ½° ở hai đầu và rộng thêm L·sin ½° hai bên, cộng 0,1 mm, nên phủ mọi góc giữa hai mẫu với tay bất kỳ, kể cả tay rộng 4 cm hay dài 60 cm; dư tối đa L·sin ½°, 0,5 mm với tay 6 cm) với tường, box, cylinder, object của sa bàn. Chồng lấn (chạm không tính) và vật cao hơn đáy của phần đó là `ScenarioError` trên path `start`, nêu path và id của vật: `start: in variant 1, the robot’s body and left wheel overlap boxes[0] (block)`. Không đẩy vật ra. Dải thấp hơn khoảng sáng gầm được nằm dưới thân, không được nằm dưới bánh.
- **t = 0 là sau pha lắng** (60 bước, R3.3). Vật động của sa bàn (box/cylinder dynamic, object) ở t = 0 nằm ở chỗ pha lắng để lại: vật đặt đứng trên sàn lún khoảng 0,1 mm, hai vật đặt chồng lên nhau đã bị đẩy ra. Tác giả scenario cần biết: goal và snapshot chỉ thấy pose sau pha lắng.
- **Tick.** `step(dt)` chỉ nhận đúng `PHYSICS_DT_S` (khác thì `RangeError`). World đếm `tick`; `t = tick / PHYSICS_HZ`, không bao giờ cộng dồn (6 bước cộng dồn là 0,05000000000000001 s). R3.6 tính `advanceTo(tick * 1000 / PHYSICS_HZ)` từ `tick`.
- **Đo một lần mỗi tick** (sau mỗi bước, và ở t = 0): `readContacts` gọi đúng một lần (test đếm bằng spy), `sense.contacts()`, snapshot và goal frame dùng chung kết quả; mỗi siêu âm đo một lần, nhiễu rút một lần mỗi tick từ seed, nên số program đọc không phụ thuộc số lần đọc hay UI có đang nghe; mỗi line đọc một lần. `outOfArena` được **chốt**: đã ra khỏi sa bàn thì cả lượt chạy là ra.
- **`sense`** ghép mount của kit với pose chassis: `distanceCm(role)`, `ultrasonic(role) → { cm, echoUs, hitId }` (R3.6 cần `echoUs` cho `pulseIn`), `groundReflectance(role)`, `line(role) → { reflectance, dark, raw, level }` (cực tính theo `activeLow` của port), `contacts() → { otherId, kind, tags }[]` (có cả `#ground`). Role không có thì `RangeError`.
- **Nhiễu siêu âm** mặc định 0 (§9: mặc định không nhiễu); `ultrasonicNoiseCm > 0` thì mỗi lần đo cộng `uniform(−a, a)` từ `createWorldRng(seed)`.
- **`RobotSnapshot`** (snapshot.ts, chỉ type và số học thuần, UI được import): `Pose = { xCm, yCm, zCm, yawDeg, rotation }` theo khung sa bàn (cm, độ; quaternion trong khung x phải, y xa, z lên; sang three.js: vị trí `(x, z, −y)/100`, quaternion `(x, z, −y, w)`). `objects` là mọi body động theo thứ tự tạo, có `kind: 'box' | 'cylinder' | 'object'`. `sensors` theo thứ tự kit: siêu âm `{ cm, hitId }`, line `{ reflectance, dark, spotCm }` (`spotCm = null` khi bị nhấc quá 3 cm). World tự nó: `pins: []`, `leds` mọi LED `false`, `activeBlockId: null`, `status: 'idle'`, `score: { points: 0, maxScore: null, goals: [] }`; R3.6 ghép phần của nó vào một object mới. Snapshot là JSON thuần (round trip bằng nhau, không có −0), đóng băng sâu, cùng một object trong một tick, object mới sau mỗi bước.
- **`hashSnapshot(s)`** = FNV-1a 32 trên UTF-8 của `snapshotText(s)`: JSON với key mọi object sắp theo UTF-16 code unit, mỗi số viết thành `Math.round(n × 1e6)` (−0 thành 0), NaN/±Infinity viết thẳng. `ROBOT_ENGINE_VERSION = 1`.
- **Goal frame.** `toGoalFrame(snapshot, extras)` (goal-frame.ts, thuần) cho `GoalFrame` của R6.1. `world.frameExtras()` cho `{ contacts, speedCmS, footprint, servoRangeDeg }`; R3.6 thêm `buzzerHz` (từ chân). Contact giữ mọi tag (kind đứng đầu), bỏ `#ground`; spot line bị nhấc thì bỏ; `objects` chỉ là `arena.objects` theo id. `footprint` là đa giác lồi của thân và hai bánh (`robotFootprint(kit).outlineCm`) đặt theo pose.
  - **`speedCmS` là tốc độ *chạy* của robot** (fix round 1): tốc độ trên sàn của **điểm giữa trục bánh** (điểm robot hai bánh quay quanh), trừ phần do quay quanh một điểm cách nó tới `TURN_IN_PLACE_TOLERANCE_CM = 1` cm: `max(0, |v_trục| − |ω| · 1 cm)`, tức tốc độ của điểm chậm nhất trong vòng 1 cm quanh giữa trục. Lý do: drive của R3.3 cho robot quay tại chỗ quanh một điểm cách giữa trục 0,3–0,6 cm (đo: duty 100–255, sau giây đầu), nên nếu lấy đúng điểm giữa trục thì quay 60 s vẫn cộng thành 47,8 cm đường đi ở duty 150 và 224,7 cm ở duty 255, vượt 20 cm của goal canh gác. Với dung sai 1 cm: đi thẳng là tốc độ của trục (không đổi), quay tại chỗ là 0, xoay quanh một bánh (7,5 cm) là 6,5/7,5 tốc độ của trục. Hệ quả: robot chỉ quay tại chỗ không có đường đi (cả hai goal canh gác trượt với `robot-did-not-move`) và được coi là đứng yên (`stop-in-zone`). Vị trí của robot vẫn là điểm giữa thân (R6.1).
  - **Góc servo trong goal frame** được làm tròn tới 1/1000 độ rồi kẹp vào `[minDeg, maxDeg]` của servo (`servoRangeDeg`). Lý do: vật lý để tay lệch một chút (gập ở 0° đọc −1,2e-6°; chạy tới đầu mút vượt tới 0,06°; giữ ở 180° dao động 179,999987–180,000084°), nên goal `minDeg: 0`, `maxDeg: 180` hay `minDeg = maxDeg` không bao giờ qua. Làm tròn 1e-6 như ruling chưa đủ (179,999987 vẫn < 180), nên dùng 1e-3 (gấp 75 lần dao động, nhỏ hơn nhiều so với độ phân giải ~1° của servo thật). Snapshot giữ góc vật lý để vẽ.
- **Giá:** cả world (bước, cảm biến, snapshot, goal frame) **0,099–0,155 ms CPU/tick** (mean, 3 lần, sa bàn `boxes`); headless 3 biến thể × 60 s, đủ 9 goal mỗi tick, **2,26–2,76 s CPU** (M4 Pro, Node 24.22.1, load average 5–7). Bước + đo chiếm ~96 µs (physics ~50, `readContacts` ~25), snapshot + extras + frame + goal ~14 µs. Chưa có interpreter và virtual UNO (R3.6).

### 4.6 Scenario — `src/core/scenario/scenario.ts` + `src/samples/robot-scenarios/rb-*.json`
```ts
type Scenario = { key: `rb-${string}`; version: number; title: { vi: string; en: string }; profile: 'uno-basic'|'uno-advanced';
  kit: string; arena: Arena; start: PoseCm;
  variants: { count: number; seed: number; startJitterCm: number; yawJitterDeg: number; obstacleJitterCm?: number };
  inputs?: { atS: number; role: string; action: 'press'|'release' }[];       // script, khoá tương tác khi Kiểm tra
  timeLimitS: number; goals: RobotGoalSpec[]; scoring: { timeBonusMax?: number; penalties?: PenaltySpec[] };
  starter: BlocklyJson; toolbox?: ToolboxRestriction };
type RobotGoalSpec = { id: string; label: { vi: string; en: string }; points: number } & (
  | { kind: 'reach-zone'; zone: string } | { kind: 'checkpoints-in-order'; zones: string[] }
  | { kind: 'stay-on-line'; minRatio: number } | { kind: 'avoid-contact'; tag: string }
  | { kind: 'object-in-zone'; object: string; zone: string } | { kind: 'stop-in-zone'; zone: string; maxSpeedCmS: number; holdS: number }
  | { kind: 'servo-angle'; role: string; minDeg: number; maxDeg: number; whenInZone?: string }
  | { kind: 'finish-within'; seconds: number } | { kind: 'uses-block'; blockType: string } );
```
- `maxScore = Σ points + (timeBonusMax ?? 0)`. Điểm kẹp vào `[0, maxScore]`.
- Kết quả gồm:
  - `passed`: mọi goal qua ở **mọi** biến thể;
  - `score`: điểm **thấp nhất** trong các biến thể (ruling cho R6.2, thay cho trung bình: chương trình qua một biến thể may mắn không được điểm cao);
  - `goal.passed` (gửi host): goal đó qua ở mọi biến thể.
- Key `rb-*` **không bao giờ đổi tên hay tái dùng**. Đổi hành vi thì tăng `version`.

*Bổ sung khi làm R5.2a fix round 2 (ruling của controller):*
- **`endOnContact?: string[]`:** các tag (hoặc loại collider) mà lần chạm đầu tiên **kết thúc lượt chạy**, như đâm xe trong thi robot. Ở tick đầu
  tiên robot chạm collider có một trong các tag đó, lượt chạy dừng; goal được chấm trên các frame tới hết tick đó (gồm cả nó). Goal cần giữ hay
  dừng (`stop-in-zone`, `servo-angle`) mà chưa đạt thì trượt với `reasonKey = run-ended-contact` (`robot.goal.reason.run-ended-contact`, vi/en).
  Schema: mỗi tag phải có trong sa bàn (cùng tập tag với `avoid-contact`), không trùng, danh sách không rỗng. `runEndingContact(scenario,
  contacts)` (scenario.ts) cho tag kết thúc của một tick (tag đầu tiên của danh sách mà một contact có) hoặc `null`. Dừng lượt chạy là việc của
  run session và check (R3.6, R6.2); R5.2a chỉ đặt nó lên kịch bản (bài 3: `wall`, 5: `gate`, 6: `obstacle`) và chạy nó trong spike.
- **`variants.startJitterAlongCm?`:** chỗ xuất phát dời tới ±giá trị này **dọc hướng xuất phát** và ±`startJitterCm` ngang hướng (đường thẳng
  xuất phát của bài bám vạch: dời dọc xa mà vẫn thấy vạch). Hai lần bốc đầu là dọc và ngang, quay ra dx, dy bằng yaw đã soạn (đúng tuyệt đối ở các
  góc vuông); không có trường này thì như cũ (dx, dy cùng ±`startJitterCm`), nên kịch bản cũ ra đúng các biến thể cũ.

*Bổ sung khi làm R5.1 (`src/core/scenario/`, catalog ở `src/samples/robot-scenarios/index.ts`):*
- **Không vòng import:** bảng key/profile/kit nằm ở `src/samples/robot-keys.ts` (lá, không import gì; `robot-templates.ts` re-export). `scenario-schema.ts`, `scenario.ts` và catalog chỉ import lá này, vì R5.2 cho `robotReadyFields` đọc catalog (`robot-templates → robot-scenarios → core/scenario → scenario-schema → robot-templates` sẽ là vòng, lỗi TDZ khi nạp module). R5.2a cuối cùng đọc thẳng file kịch bản qua `robot-scenarios/ready-fields.ts` (lá chỉ import `robot-keys.ts` và JSON), xem R5.2.
- `PoseCm = { xCm, yCm, yawDeg }`: điểm trên sàn dưới giữa thân robot (cùng `RobotStart` của R3.3). Vị trí xuất phát phải nằm trên sa bàn.
- **Điểm:** mọi scenario có điểm đều `maxScore = 100` đúng: `Σ points + (timeBonusMax ?? 0) = 100`, `points` và `timeBonusMax` là số nguyên ≥ 0. `rb-sandbox` không goal, không `maxScore` (schema cấm `timeBonusMax`). `penalties` chỉ nhận mảng rỗng cho tới khi R6.2 định nghĩa `PenaltySpec`.
- **Key:** chỉ 7 key của `robot-templates.ts`; `profile` phải đúng mức scenario cần, `kit` phải là `ref-uno-rover`. `version` là số nguyên ≥ 1; `timeLimitS` ∈ (0, 600].
- **Tham chiếu phải tồn tại:** `zone` là id vùng sơn, `object` là id `arena.objects`, `avoid-contact.tag` là một loại collider (`wall`, `box`, `cylinder`, `object`) hoặc tag có trong sa bàn, `servo-angle.role` là role servo (`0 ≤ minDeg ≤ maxDeg ≤ 180`), `stay-on-line` cần có vạch, các vùng của một goal `checkpoints-in-order` không chồng nhau (R6.1), `uses-block.blockType` phải nằm trong `toolbox` nếu có. `id` goal duy nhất, ≤ 50 ký tự `[a-z0-9-]`; label vi/en ≤ 200 ký tự (luật của LMS).
- **`inputs`:** `role` là role nút, `0 ≤ atS < timeLimitS`, mỗi nút xen kẽ `press`/`release` bắt đầu từ nhả, một nút không có hai input cùng lúc. `loadScenario` sắp theo thời gian. `inputsDueBetween(scenario, t0S, t1S)` trả input có `t0S ≤ atS < t1S`: các cửa sổ nối tiếp nhau (một tick, một khung hình, một lô headless) trao mỗi input đúng một lần.
- **Biến thể:** `variantOffsets(scenario, index)` thuần và tất định (seed `variants.seed + index`, `world/rng.ts`, trig qua `dmath`). Biến thể 0 không lệch. Biến thể ≥ 1 bốc `±startJitterCm` (x, y), `±yawJitterDeg` rồi `±obstacleJitterCm` cho box/cylinder có tag `jitter`; bốc trượt (ra ngoài sa bàn, chạm tường, vật, robot hay vật cản khác) thì bốc lại, tối đa 20 lần, rồi giữ vị trí tác giả đặt (robot chỉ giữ lại *vị trí*: góc quay không làm bốc trượt nên vẫn lệch theo góc của lần bốc đầu). Chân robot tính là hình tròn bán kính 11 cm (`ROBOT_FOOTPRINT_RADIUS_CM`; R5.1 ghi 10 cm cho "thân 15 × 10 cm", nhưng kit thật là thân 15 × 12 cm, góc ngoài phía sau của bánh cách tâm **10,27 cm**, nên R3.5 nâng lên 11 cm; `robotFootprint(kit).radiusCm` cho con số của kit, test giữ kit tham chiếu trong vòng tròn này); kit lớn hơn phải tăng số này. World còn kiểm chân thật của robot (§4.5). `applyVariant(scenario, offsets)` cho `{ start, arena }` để dựng world.

### 4.7 `stem-lab/v1` (chỉ thêm) — `docs/lab-embed-contract.md`, `src/ui/app/host-bridge.ts`
- Launch: `?embed=1&lab=robot&template=rb-<key>&profile=uno-basic|uno-advanced&origin=<o>`.
- `ready` thêm `{ lab: 'robot', scenarioVersion, maxScore }`.
- `check-result` thêm (tuỳ chọn): `{ score, maxScore, simTimeMs, variants: [{ seed, passed, score, simTimeMs }], engine: 'robot-engine@1', scenarioVersion, programHash }`. Ràng buộc:
  - `variants` ≤ 10;
  - số hữu hạn, `0 ≤ score ≤ maxScore`;
  - `programHash` là hex ≤ 64, hash của **IR** (không phải Blockly JSON, vì JSON có toạ độ/id).
- Parser của host bỏ cả message nếu field sai, nên hai repo cùng test với **một fixture JSON chung** (`docs/fixtures/stem-lab-v1-robot.json`, chép sang STEMLearning).
- `goals[]` giữ hình dạng `{id,label,passed}`. Không đổi gì cho `blockly`/`yolobit`.

## 5. Global Constraints

- B1: `src/core/**` không import `react`, `three`, `@react-three/*`, `konva`, `blockly`, `zustand`, `dexie`… Thêm `three`, `@react-three/*` vào `eslint.config.js:8-19`, kèm case trong `tests/core-boundary.test.ts`. Rapier **chỉ** được import trong `src/core/world/**` (rule override). `src/ui/**` không import Rapier, chỉ đọc `RobotSnapshot`.
- B2/B3/B6: document không chứa runtime state. World là state machine thuần trong core. Kit/board/scenario là JSON validate bằng Zod. Không `eval`. Driver là code TS/C++ đã review, tham chiếu bằng id.
- Version phụ thuộc đúng như Tech Stack (đều ≥ 2 tuần tuổi tính tới 2026-10-25). Đọc type đã cài trước khi dùng API.
- Ngôn ngữ: identifier/comment tiếng Anh, docs tiếng Việt. UI string chỉ ở `src/ui/i18n/messages.ts` (`en`+`vi`, cùng key). `lab=robot` nói tiếng Việt. Text block overlay ở `src/ui/i18n/blocks.ts`.
- Khung nhúng **1100×640** là kích thước thiết kế chính. Dưới 800 px dùng tab. Không thêm quyền iframe ngoài `LAB_FRAME_ALLOW`.
- **Ngân sách hiệu năng** (đo ở R0, giữ tới R8):
  - JS chunk 3D ≤ **0,6 MB gzip**; physics WASM ≤ **1,3 MB gzip** (cache sau lần đầu);
  - init physics ≤ **1,5 s** khi CPU throttle 4×;
  - ≥ **50 fps** trên laptop tầm trung, ≥ **30 fps** ở tier thấp khi throttle 4×;
  - physics ≤ **0,5 ms/tick** trên máy tầm trung;
  - Kiểm tra headless 3 biến thể × 60 s ≤ **10 s** (tầm trung) / ≤ **30 s** (yếu);
  - Chạy → robot chuyển động ≤ **300 ms** (sau khi đã init).
- Tất định: cùng `(project, scenario@version, seed, engine@version)` cho cùng **hash snapshot** trên Node, Chromium, Firefox, WebKit.
- Thương hiệu: không logo Arduino/OhStem/vendor. Không copy asset/code GEARS (GPL). Code sinh ra không dùng thư viện GPL.
- Commit: **không** thêm dòng `Co-Authored-By` (yêu cầu của user, ưu tiên hơn reminder mặc định). Mỗi task: test xanh → commit → fast-forward push `origin master` (cả hai repo dùng `master`).
- `pnpm verify` xanh mỗi task. `pnpm e2e` cho task UI. STEMLearning: `dotnet test` cho service bị sửa, `pnpm verify` ở `Web/`. Toàn bộ test `ybc`/pre-n17 phải xanh **mà không sửa assertion**.

## 6. Review Focus

1. **Program không có `wait`** (`forever` dày hoặc `while dist > 20` trong on-start): program không được chạy trước world quá `dt`, sim không đóng băng. *Test ở R2.3:* `pulseIn loop never leads world by more than dt`; `tight forever loop never blocks a tick > 8 ms wall`.
2. **Tab bị ẩn / máy chậm giữa lúc Kiểm tra**: kết quả **giống hệt**. *Test ở R6.3:* `same score/passed/hash for 1×, 4× and headless`.
3. **Robot lật, kẹt tường, rơi khỏi sa bàn**: không NaN, không treo, goal trượt kèm giải thích, Reset robot về trạng thái y như mới. *Test ở R3.4/R3.6:* `robot falling off arena yields outOfArena and finite poses`; `resetRobot hash equals fresh start`.
4. **Xung đột timer/chân** (vd. kit vendor đặt motor PWM ở D10 khi có servo): R0.4 đã có trace (ADR 0003 §3.4–3.5: chân giữ LOW, `tone` đổi tần số), quyết định vẫn là sim **từ chối chạy** với `timer-claimed` (contract UNO §5.3, U-48). *Test ở R1.2:* `pwm on D10 with servo is refused with timer-claimed`.
5. **WebGL không có hoặc mất context** (máy trường học, iframe): lab vẫn dùng được qua top view 2D, state sim không mất. *Test ở R4.6:* e2e với WebGL tắt.

---

## 7. Phase và task

Mỗi task ghi **Files**, **Interfaces**, **Tests** (tên + assertion chính), **Acceptance** và giờ. Sub-plan của phase sẽ chi tiết hoá thành các bước TDD.

### R0 — Spike và hợp đồng (72h) → **Gate G0**

**R0.0 Spec vào repo (2h).** Chép spec + plan này vào `stem-demo/docs/uno-robot-direction.md` và `stem-demo/docs/robot-3d-implementation-plan.md`. Thêm dòng N18 vào `docs/stem-demo-implementation-plan.md` §9.2.

**R0.1 Spike vật lý (20h).**
- Files: `spikes/robot-physics/` (không vào `src`, xoá sau gate), `docs/adr/0001-robot-physics.md`.
- So sánh 3 mô hình drive:
  - (a) revolute joint + motor vận tốc;
  - (b) `DynamicRayCastVehicleController`;
  - (c) diff-drive mức vận tốc trên khung dynamic.
- Thiết lập: `lengthUnit` cỡ cm, tune `numSolverIterations`.
- Đo:
  - đi thẳng 2 m;
  - quay 90° tại chỗ 10 lần (sai số lặp ≤ 1°);
  - đẩy hộp 100 g;
  - không rung;
  - `ms/tick`;
  - kích thước gzip/brotli và thời gian init của bản tách `.wasm` so với `-compat` (Vite 8 + `vite-plugin-wasm` nếu cần).
- Acceptance (G0):
  - hash pose sau 3 000 tick **bằng nhau** giữa 2 lần chạy và giữa Node / Chromium / Firefox / WebKit;
  - đạt ngân sách §5.
- Fail → ADR chọn engine động học 2.5D, giữ nguyên interface `World` (§1 dự phòng).

**R0.2 Spike render (12h).**
- Làm:
  - R3F Canvas trong iframe 1100×640 (`e2e/lesson-host.mjs`);
  - sa bàn 2×2 m + robot thủ tục + replay 1 000 tick;
  - đo chunk lazy và FPS tier cao/thấp (CPU throttle 4×);
  - Playwright với `--use-angle=swiftshader --enable-unsafe-swiftshader`.
- Acceptance: đạt §5 hoặc ghi rõ chỗ lệch kèm biện pháp.

**R0.3 UNO compatibility contract v0 (28h).**
- Files: `docs/uno-compatibility-contract.md`, `src/core/compat/uno-contract.ts`. Mở rộng `compat/contract-types.ts`, vì hiện nó mang hình MicroPython (`fields:{import,module}` :211, `generatorBuiltins` :222, `tier` :233): thêm `cpp: { form; includes; libraries }` theo target.
- Chốt từng dòng construct (id `U-xx`), mỗi dòng có nhãn DOCUMENTED/VERIFIED/UNKNOWN:
  - Khung `setup()`/`loop()`. Không có `forever` thì `loop()` rỗng, board vẫn có nguồn. `loop()` **không có delay ẩn**.
  - Biến `long` (int32, wrap). **Literal có hậu tố `L`**, đọc `(long)millis()`. Chia nguyên cắt về 0, `%` theo dấu số bị chia, quyết định cho `INT32_MIN / -1` và `% -1`. Basic không có float. Chuỗi chỉ để in (`F()`). Bool in ra `1`/`0`.
  - Count up: `{ const long _to = (b); for (long _c = (a); _c <= _to; _c += 1) { x = _c; … } }`, giữ thứ tự đánh giá như contract Yolo:Bit §3.3.
  - `delay`, `millis`, bảng `costsUs`, `LOOP_MIN_US = 50`.
  - Quy tắc chân/timer §4.1. `analogWrite` trên chân không PWM: ≥128 → HIGH, ngược lại LOW. **PWM trên timer bị Servo/tone chiếm = UNKNOWN**, phải chờ trace R0.4.
  - Ngữ nghĩa module §4.4:
    - duty = `round(|s| × 255 / 100)`, chiều quay, `stop` = cả hai IN LOW;
    - servo attach trong `setup`;
    - HC-SR04 `pulseIn(ECHO, HIGH, 30000)`, cm = µs/58, timeout → 400;
    - line: cực tính theo `activeLow`.
  - `Serial.begin(9600)` khi có `print`, chi phí 1,04 ms/ký tự khi vượt buffer 64 B.
  - RAM 2 KB / flash 32 KB: L2 báo % dùng; lời giải mẫu ≤ 75 % RAM.
  - Pin version của Arduino AVR core và `Servo` (bản mới nhất ≥ 2 tuần tuổi, đọc ở R0.4).
- Acceptance: không construct nào được mở mà còn field UNKNOWN. Có ma trận L1/L2/L2e/L3.

**R0.4 Spike avr8js (8h).**
- Compile bằng `arduino-cli`, chạy HEX trong `avr8js` trên Node, trích pin trace có timestamp. 4 sketch:
  - blink;
  - motor PWM;
  - servo + `pulseIn`;
  - **`Servo.attach(9)` + `analogWrite(10,200)`** và **`tone` + `analogWrite(11,…)`**.
- Acceptance: trace khớp kỳ vọng ±1 % thời gian. Hành vi timer bị chiếm được ghi vào contract (thay UNKNOWN). Go/no-go cho C2 ghi vào ADR.

**R0.5 Bảng câu hỏi nhà cung cấp (2h).** `docs/uno-vendor-questions.md` (§10), gửi PM.

### R1 — HAL: board, kit, driver, virtual UNO (76h)

**R1.1 Schema + dữ liệu (16h).**
- Files: `src/core/hardware/{board.ts,board-schema.ts,uno-r3.board.json,kit.ts,kit-schema.ts,kits/ref-uno-rover.kit.json,index.ts}`, `src/core/devices/definitions/uno-r3.json`.
- Interfaces: `loadBoard(json): BoardProfile`, `loadKit(json, board): Kit` (Zod, lỗi có đường dẫn).
- Tests:
  - `uno-r3 lists exactly D3,D5,D6,D9,D10,D11 as pwm`;
  - `kit with unknown driver id is rejected`;
  - `kit referencing pin not on board is rejected`;
  - `uno-r3 device pins equal board profile pins`.

**R1.2 Pin rules + BoardTarget của kit (12h).**
- Files: `src/core/hardware/{pin-rules.ts,board-target.ts}`.
- Interfaces:
  - `checkKit(kit, board, usage: { servo: boolean; tone: boolean; serial: boolean }): Diagnostic[]` (dùng `Diagnostic` của `capabilities/diagnostics.ts`);
  - `kitBoardTarget(kit, board): BoardTarget` (role có mặt, chân dùng được, capability) để compiler biết kit.
- Tests:
  - `two ports on one pin → pin-conflict`;
  - `pwm on D10 with servo is refused with timer-claimed` (error, chặn Run/Check);
  - `D0 used while serial → pin-reserved`;
  - `ref-uno-rover has no diagnostics`.

**R1.3 Virtual UNO (24h).**
- Files: `src/core/hardware/virtual-uno.ts`.
- Interface: `createVirtualUno(board: BoardProfile, clock: ProgramClock): VirtualUno` với:
  - `io: UnoPinIO`, `pins(): PinState[]`;
  - `attachAnalogSource(pin, () => number)`, `attachPulseSource(pin, (level, timeoutUs) => number)`;
  - `attachWireDevice(addr, model)`, `onChange(listener)`.
  - Mỗi lệnh `charge(costsUs[call])`.
  - *Bổ sung khi làm (R1.3):* `attachDigitalSource(pin, () => 0|1)` (nút, line digital: không đoán ngưỡng điện áp từ nguồn analog); nguồn pulse trả `number` (độ rộng, chờ 0) **hoặc** `{ waitUs, widthUs }` để charge cả thời gian chờ echo (§3); `millis()` theo mô hình Timer0; `report`/`diagnostics()`/`onDiagnostic` (cảnh báo `not-pwm`, `timer-claimed`, `value-clamped`, `wire-nack`, mỗi code một lần mỗi chân/role/địa chỉ). `PinState = { pin, mode, level, duty (0..pwmMax), toneHz, servoDeg }` là thứ world đọc. Không mô hình tải ngắt (contract §13).
- Tests:
  - `analogWrite(D7,100) → LOW and warns not-pwm`;
  - `analogRead clamps to 0..adcMax and charges 105.8125 µs` (contract UNO §4.4, đo ở R0.4; lần đầu 201.8125 µs);
  - `pulseIn returns 0 on timeout and charges the no-pulse cost` (contract UNO §4.4: 20752 µs với timeout 30000);
  - `wire write to unattached address → wire-nack diagnostic`.

**R1.4 Driver + binding (24h).**
- Files: `src/core/hardware/drivers/{index,hbridge,servo-lib,hcsr04,line-sensor,led,buzzer,button}.ts`, `src/core/hardware/binding.ts`.
- Interface: `createModuleIO(kit, uno: VirtualUno): ModuleIO`, với `call(role, op, args)` / `read(role, op)`. Đây là capability mới `modules`.
  - *Bổ sung khi làm (R1.4):* tham số thứ ba `uses` (các `{ role, op }` program dùng; mặc định: mọi op của kit): tạo binding là đầu `setup()`, chạy bước setup của các op được dùng theo thứ tự port của kit, như sketch sinh ra. `modules` vào capability set qua kit: `kitBoardContext(context, kit)` thêm `modules` vào board context đã resolve (board `uno-r3` một mình chỉ có `digital`, `pwm`, `analogIn`). `kitCpp(kit, uses)` cho C1 phần C++ module của sketch theo thứ tự port.
- Tests:
  - `motor.set(motorLeft, 50) → D5 duty 128, D7 HIGH, D8 LOW`;
  - `motor.set(-100) → D7 LOW, D8 HIGH, duty 255`;
  - `ultrasonic 400 when pulse source times out`;
  - `line.dark honours activeLow`;
  - mỗi driver có snapshot test của `cpp` (C1 dùng lại).

### R2 — Program: block, compiler, interpreter trên đồng hồ ảo (116h)

**R2.1 Board family + profile + sửa luật (20h).**
- Nới literal ở các chỗ liệt kê trong §0:
  - `device-definition.ts`: family `'uno'`, `codeTarget: 'yolobit-micropython' | 'arduino-avr'`;
  - `profile.ts`, `block-packs.ts`, `board-context.ts` (dùng `profile.family`), `contract-types.ts` (`Profiles`, `tier`);
  - `generate-document.ts`, `App.tsx`, `run-session.ts` (family `uno` trả `reason: 'unsupported-family'`), `lab-host.ts` (bảng lab → family).
- Thêm `profiles/uno-basic.json`, `uno-advanced.json`.
- `simulation/conversions.ts` lấy thang theo board.
- `document.ts` thêm `kit` (§4.0).
- `capabilities/io.ts` thêm `modules`, `WireIO` (amendment).
- Ghi các sửa luật §2 vào `docs/stem-demo-implementation-plan.md` §5.1.
- Contract chỉ import trong test, theo pattern hiện có.
- Tests:
  - `uno-basic exposes only drive/sensor/servo/led constructs`;
  - `ybc board keeps 0..4095 analog scale`;
  - `lab=blockly refuses a uno project; lab=robot refuses a generic one`;
  - `kit survives inspectStoredProject, load-project and localStorage`;
  - toàn bộ test hiện có xanh.

**R2.2 Construct pack + block JSON (20h).**
- Files: `src/core/constructs/{uno.drive,uno.sensors,uno.servo,uno.output,uno.pins}.ts`, block def trong `src/core/program/block-packs.ts` (data), text vi/en ở `src/ui/i18n/blocks.ts`.
- Block Basic:
  - *robot đi [tới/lùi/xoay trái/xoay phải] tốc độ (n) %*, *dừng robot*;
  - *motor [trái/phải] tốc độ (n) %*;
  - *khoảng cách siêu âm (cm)*;
  - *cảm biến line [trái/giữa/phải] thấy vạch đen?*;
  - *servo [1] góc (n)°*, *đèn [bật/tắt]*, *còi kêu (hz) trong (ms)*, *nút được nhấn?*.
- Advanced thêm chân thô `D0–D13/A0–A5` (theo board), `line.raw`, `millis`.
- Tests: conformance kiểu `tests/ybc-blockly-conformance.test.ts` cho mọi block `uno_*`; `role missing from kit → capability-unavailable on that block`.
- *Bổ sung khi làm (R2.2, mở rộng theo ruling của controller: compile + interpreter của mọi op §4.4):*
  - Block def nằm cạnh construct của nó (`constructs/uno.*.ts`, như `ybc.*.ts`); `block-packs.ts` dựng pack family `uno` (13 pack: Basic `uno.structure`, `uno.drive`, `uno.sensors`, `uno.servo`, `uno.output`, `uno.logic`, `uno.loops`, `uno.math`, `uno.text`, `uno.variables`; Advanced thêm `uno.sensors.advanced` (`line.raw`), `uno.output.advanced` (dừng còi), `uno.pins` (chân thô + `millis`)). Block ngôn ngữ là của dialect Yolo:Bit, bỏ `random` (U-45) và `running time` (U-19 là `millis` của board); riêng chia và đếm lên có nghĩa khác trên UNO nên có block riêng (`constructs/uno.lang.ts`, fix round 1): `uno_int_divide` (cắt về 0: −7 / 2 là −3) và `uno_count_up` (luôn bước 1, không có field STEP), compile ra đúng node `//` và `countUp` của dialect; compiler vẫn đọc `ybc_int_divide`/`ybc_count_up` trong family `uno` (test ngôn ngữ R2.3) nhưng không profile uno nào hiện chúng. `constructs/uno.ts` là bảng dòng contract ↔ block; `uno.roles.ts` (tên role, dropdown, câu cảnh báo kẹp), `uno.run.ts` (kẹp + gọi capability). Dropdown role liệt kê đủ từ vựng theo loại (motor trái/phải, line trái/giữa/phải, servo 1); siêu âm, đèn, còi, nút là role riêng của block. Dropdown chân thô lấy chân của board: mọi chân cho số, chân PWM cho PWM, A0–A5 cho analog.
  - IR: `ModuleCallStatement` (`motor.set`, `drive.move`, `drive.stop`, `servo.set`, `led.set`, `buzzer.tone`, `buzzer.stop`) và `ModuleReadExpr` (`ultrasonic.cm`, `line.dark`, `line.raw`, `button.pressed`, `time.millis`) với operand (`role`, `drive`); chân thô là node `digital.write`/`pwm.write`/`digital.read`/`analogIn.read` của YB-4 có thêm `operand: { kind: 'pin', pin }` (không có thì là chân P0–P2 của Yolo:Bit). Đèn và mức HIGH/LOW là đối số bool.
  - Compile theo kit: `compileUnoProject(project, rules)` (`program/compile-uno-program.ts`) dùng `kitBoardTarget(kit, board)` với capability của `kitBoardContext(resolveBoardContext(…), kit)`; role/op kit không có → `capability-unavailable` trên block; chân thô → `rawPinCheck` sau khi biết cả program (servo giữ T1, tone giữ T2, in giữ D0/D1); rồi `checkKit` cho cái program dùng, lỗi đặt ở block đầu tiên gây ra. Literal ngoài khoảng được ghi sẵn giá trị đã kẹp + cảnh báo `value-clamped` (trừ tốc độ drive INT32_MIN: `neg32` giữ nguyên nên kẹp theo từng motor lúc chạy). Mã mới của compiler: `pin-unavailable`, `timer-claimed`, `not-pwm`, `value-clamped`, `pin-conflict`, `pin-reserved` (`n18CompileDiagnosticCodes`). `unoUsesOf(ir, kit)` cho binding/C1 biết op module, chân ghi số (OUTPUT trong setup), chân nối module mà program đọc số thô (`inputPins`: `pinMode` của driver module trong setup, như program dùng module chỉ để setup; nút nhả đọc HIGH qua `INPUT_PULLUP`, contract U-33 từ 0.1.2) và `KitUsage`. `kit` mà catalog không biết là diagnostic L-1 `unknown-kit`, không throw.
  - Interpreter: op module qua `capabilities.modules` (`drive.move` thành hai `motor.set` sau `neg32`, mỗi motor tự kẹp), chân thô qua `digital`/`pwm`/`analogIn` của virtual UNO, `millis` qua role `clock` của binding (`CLOCK_ROLE`). Kẹp + cảnh báo một lần mỗi role (chân) mỗi run, có `blockId`. `createProgramIO(kit, uno, uses)` dựng capability của program (binding + chân + `pinMode OUTPUT` cho chân ghi số).
  - Bất biến đồng hồ ảo cho mọi lần đọc: trước mỗi op module (cả lần đọc trong biểu thức) interpreter gọi `budget.atHardware?.()`; budget ảo park program khi đồng hồ đã tới world.t + dt, nên lần đọc siêu âm thứ hai trong cùng câu lệnh (20,8 ms mỗi lần không có echo) chờ tick của nó. Biểu thức có đọc phần cứng đi qua `evaluateReading` (async); biểu thức khác và mọi program ybc như cũ. Một lần đọc phần cứng tới `evaluate` đồng bộ (IR không phải của compiler) là `internal-error`, không đọc.
  - L-1: `kit` mà catalog không biết → `inspectStoredProject` trả `unknown-kit` (không throw), lùi về như profile lạ (dự án mới/bài mẫu + thông báo); câu báo có tiếng Việt (`core-text.ts`).

**R2.3 Ngữ nghĩa số + đồng hồ ảo (64h).**
- Files:
  - sửa `src/core/program/{compile-ybc-program.ts,values.ts,ybc-interpreter.ts,execution-budget.ts}`, `capabilities/services.ts`: export `Timers`, option `budget?`;
  - thêm `src/core/run/virtual-clock.ts`: `createVirtualScheduler(): { programClock: ProgramClock; sleep: Sleep; park(): Promise<void>; yieldNow(): Promise<void>; timers: Timers; budget(signal): ExecutionBudget; advanceTo(tWorldMs: number): Promise<void>; whenBlocked(): Promise<void> }`.
- `valuesFor(numeric)`:
  - `python` giữ nguyên `values.ts`;
  - `cxx-int32` dùng phép `| 0` cho `+ −` và `Math.imul` cho `×` (contract UNO §3.1), chia cắt về 0, `%` theo dấu số bị chia, bool in `1/0`.
- Interpreter đọc `ir.numeric` và `ir.loopPauseUs`.
- Tests:
  - `cxx-int32: 2147483647+1 wraps to -2147483648`;
  - `-7/2 = -3, -7%2 = -1`;
  - `python semantics unchanged (existing fixtures)`;
  - `repeat 100 × wait 10 ends at exactly 1000 ms virtual`;
  - `pulseIn loop never leads world by more than dt`;
  - `tight forever loop never blocks a tick > 8 ms wall`;
  - `Stop while parked ahead of world ends the run within one tick`;
  - `ybc run with real services behaves exactly as before`.

**R2.4 Highlight block + diagnostics (12h).** Đây là tính năng **mới**.
- Core: `RuntimeServices.trace?(blockId)` (mặc định no-op). Interpreter gọi ở mỗi statement. Trong pause của `forever`/`wait`, báo block đang đợi (hoặc hat block), không báo `undefined`. `RobotRunSession` ghi `activeBlockId` vào snapshot.
- UI: `BlocklyPanel` nhận `highlightBlockId`, gọi `workspace.highlightBlock(id)`, debounce 100 ms.
- Tests: `trace reports blockId of each executed statement in order`; e2e: block `wait` sáng khi robot đang đợi.

### R3 — World: vật lý, robot, cảm biến, sa bàn (136h)

**R3.1 Nền tảng (16h).** `src/core/world/{rapier.ts,units.ts,dmath.ts,rng.ts}`. `initPhysics(): Promise<void>` (idempotent). `dmath` port `sin/cos/atan2` của fdlibm. Tests: `dmath matches bit-exact golden table`; `initPhysics twice is no-op`.

**R3.2 Arena (22h).**
- Files: `src/core/world/arena/{arena-schema.ts,build-arena.ts,ground-paint.ts}`.
- Đơn vị cm/độ:
  - `ground {sizeCm, color}`;
  - `paint: { lines: { pointsCm, widthCm }[]; zones: { id, polygonCm, color, kind }[] }`;
  - `walls`;
  - `boxes/cylinders` (`fixed|dynamic`, `tags`, `ultrasonic: boolean`);
  - `objects` (đẩy được).
- `groundReflectanceAt(xCm, yCm, radiusCm): number` lấy mẫu vector, không dùng texture.
- Test: `reflectance 0 on centre of 2 cm line, 1 on blank, ~0.5 at edge`.

**R3.3 Robot assembly + drive (36h).**
- Files: `src/core/world/robot/{assembly.ts,dc-motor.ts,servo-arm.ts}`. Mô hình drive theo ADR R0.1.
- Motor: `ω_target = duty/255 × maxRpm × dir`, đáp ứng bậc 1 (`tauS`), lực giới hạn.
- Servo: `0.1 s/60°`.
- Tham số lấy từ `kit.modules[].spec`.
- Tests:
  - `50% both motors → straight 1 m within 2% heading drift`;
  - `spinLeft 90° repeatable within 1° over 10 runs`;
  - `servo reaches 90° in ~0.15 s from 0°`;
  - `pushes 100 g box`.
- *Bổ sung khi làm R3.3:*
  - Thêm `robot/drive.ts` (mô hình (c), thuần số học) và `robot/robot-frame.ts` (khung kit → khung local của chassis).
  - Input cho R3.6: `ActuatorTargets = { motors?: Partial<Record<role, { duty: 0..255; dir: -1|0|1; brake: boolean }>>; servos?: Partial<Record<role, deg>> }`. Motor **không giữ** target: role không ghi là dừng (duty 0, dir 0), để role bị quên không chạy mãi. Servo không ghi thì giữ góc cũ (lúc đầu `restDeg`). Ghi role với giá trị `undefined` là lỗi (RangeError); target sai thì không áp gì cả.
  - Motor: `ω_target = duty/255 × ω₀ × dir`, tham chiếu theo bậc 1 `tauS` (dạng Tustin `2dt/(2τ+dt)`, chặn ở 1 khi τ < dt/2; không dùng `exp`), mô-men mỗi bánh nằm giữa 0 và đường T = T_s·(u − ω/ω₀), cắt thêm theo độ bám μ·N, đẩy bằng **lực trong suốt bước** (không phải xung lực trước bước), đặt **tại chỗ mỗi bánh chạm sàn** (lực ngang chống trượt đặt trên sàn dưới tâm khối lượng), cùng độ cao với ma sát nên không có ngẫu lực làm chúi. **Ma sát hộp số** `gearFrictionNm` (Coulomb) là ma sát tiếp xúc của bi đỡ dưới bánh (μ = T_f/(r·N), N là tải theo pháp tuyến tiếp xúc của bước trước, nên trên dốc cũng ra T_f/r), do solver áp trong bước. Đo với `ref-uno-rover@0`: robot dừng giữ sạch lực đẩy tới khoảng 1,1 N (danh nghĩa 2·T_f/r = 1,52 N), bánh chạy tự do ở ω₀·(1 − T_f/T_s) = 69 % ω₀; khởi động không có ngưỡng cứng (duty ≤ 75 đứng yên, ~78 bò vài mm, từ ~80 chạy chậm). **Dừng = thả trôi** (contract: IN1, IN2, EN LOW): motor hở mạch, chỉ ma sát hộp số hãm và giữ; tham chiếu giảm theo `tauS` (chỉ dùng cho bánh lơ lửng). **Phanh** (IN1 = IN2 với EN HIGH, nếu driver tạo ra): tham chiếu về 0 ngay, mô-men hãm theo đường u = 0 (tỉ lệ tốc độ), đứng yên thì ma sát giữ. Chỉ đẩy khi bánh **chạm đất** (contact pair của narrow phase, không dùng event).
  - `assembleRobot(world, kit, start, { settleSteps = 60 })` dựng robot ở độ cao nghỉ, chạy 60 bước lắng trước t = 0 (cả world), rồi `refreshQueries`. `RobotBody` cho `pose()`, `linvel()`, `angvel()`, `wheelAngles()` (∑ ω·dt), `servoAngles()`, `isGrounded()`, `bodies` (thứ tự hash), `ownsCollider`, `placeAt` (teleport → propagate → refresh). Tick: `applyActuators` → `beforeStep()` → `world.step()` → `afterStep()` (`stepWorld`).
  - `refreshQueries` (R3.1) nay chạy **hai** bước timestep 0: đo được là body bị dời bằng tay chỉ hiện lại với ray sau bước thứ hai khi world có ≤ ~10 collider (ADR 0001 §9).

**R3.4 Cảm biến (26h).**
- Files: `src/core/world/sensors/{ultrasonic.ts,line.ts,contacts.ts}`.
- Siêu âm: 5 tia hướng hằng số trong nón ±15°, lấy tia ngắn nhất, chỉ trúng collider `ultrasonic: true`, miền 2..400 cm, nhiễu seeded tuỳ chọn.
- Line: lấy mẫu chiếu xuống. Cao > 3 cm thì "không phản xạ".
- Tests:
  - `wall at 50 cm reads 50±1`;
  - `angled wall beyond cone reads 400`;
  - `robot falling off arena yields outOfArena and finite poses`.
- *Bổ sung khi làm R3.4:*
  - Cảm biến là **hàm thuần** trên pose của cảm biến trong world; R3.5 ghép chassis pose + mount thành pose. `measureUltrasonic(world, lookup, pose, spec, { exclude?, noise? }) → { cm, echoUs, hit }`, `measureLine(paint, positionWorld, spec, { activeLow? }) → { reflectance, dark, raw, level }`, `readContacts(world, lookup, bodies) → info[]`, `isOutOfArena(arena, position)` (thêm file `sensors/{collider-lookup.ts,out-of-arena.ts}`). `spec` là kiểu của kit (`UltrasonicSpec`, `LineSensorSpec` trong `hardware/kit.ts`, R3.3), không có định nghĩa song song. `lookup` là `{ infoOf(collider) }`, ví dụ `BuiltArena`. Collider mà lookup không biết thì vô hình với mọi cảm biến.
  - Siêu âm: 5 tia là trục và 4 mép nón (trái, phải, trên, dưới), tính một lần mỗi nón bằng dmath. Tia ngắn nhất thắng: khoảng cách xiên tới tiếng vọng đầu tiên. Miền đo là `[max(minCm, 2), min(maxCm, 400)]`; gần hơn thì đọc đầu gần. Không trúng thì 400 với `echoUs = 0`: pulseIn không thấy xung, helper trả 400 (contract §6.6) và virtual UNO charge `pulseInNoPulse30000`. Có echo thì `echoUs = cm × 58`. Khoảng cách được làm tròn tới 1 µm (`Math.round(toi × 100 × 1e4) / 1e4`) trước nhiễu và kẹp: toi của Rapier là float32 (đo được: tường 5 cm đọc 4,999995 cm), mà program cắt hai lần (`pulseIn` về µs nguyên, helper về cm nguyên), nên tường cách số cm nguyên sẽ đọc thiếu 1 cm; test quét 5..95 cm ở yaw 0 và 90 đọc đúng d qua `echoToCm(trunc(echoUs))`. `loadKit` từ chối `minCm ≥ maxCm` và `minCm ≥ 400` (đường dẫn `modules.<i>.spec.minCm`). Pose NaN/∞ hoặc quaternion độ dài 0 thì không echo (đo được: Rapier trả hit toi 0 cho tia NaN). Nhiễu: mỗi lần đo rút đúng một `uniform(−a, a)`, kể cả khi không echo. **Góc tới:** tia gặp mặt có pháp tuyến lệch quá `ULTRASONIC_MAX_INCIDENCE_DEG = 60°` so với tia thì không echo, và mặt đó vẫn che những gì phía sau (âm bị hắt đi). So bằng tích vô hướng với cos 60° = 0,5, không cần `acos`. Góc tính cho từng tia, nên với nón ±15° một bức tường xoay tới 75° so với trục vẫn được tia mép phía pháp tuyến nghe thấy (ví dụ tường 70°: tia mép gặp ở 55°); tường 80° thì đọc 400. Tia bắt đầu trong collider (toi 0, không có pháp tuyến) vẫn tính là echo ở đầu gần. Đo được 5,3–5,9 µs/lần đo (Apple M4 Pro, Node 24.22.1, sa bàn `boxes`; 4,1–4,7 µs trước khi có pháp tuyến).
  - Line: cao hơn 3 cm (hoặc vị trí không hữu hạn) thì không nhận được phản xạ: reflectance 0, **dark**, như module TCRT5000 thật và như mép sàn (`LIFTED_REFLECTANCE = OFF_GROUND_REFLECTANCE`). Robot bị nhấc lên, lật hoặc rơi khỏi bàn thì mọi cảm biến line đọc dark. `heightCm` của spec là độ cao nghỉ mà `loadKit` so với mount; số đo lấy độ cao thật từ vị trí. `raw` là ADC lý tưởng `min(1023, floor(signal × 1024))`, với `signal = 1 − reflectance` khi `activeLow: false` (dark = HIGH, raw cao) và `signal = reflectance` khi `activeLow: true`. `level` là mức `digitalRead` mà driver `line-digital` so với mức dark của nó. Test nối số đo vào virtual UNO: driver đọc lại đúng `dark` và `raw` ở cả hai cực tính.
  - Contacts: ứng viên lấy từ hai nguồn, gộp và bỏ trùng: `contactPairsWith` (pair state, không dùng event) và `intersectionsWithShape` ở vị trí **hiện tại** với shape của collider robot nở thêm 1 mm (cuboid → round cuboid, ball → ball lớn hơn, cylinder → round cylinder: đúng tập điểm trong khe 1 mm). Pair graph dựng ở đầu step, nên vật đi hết vài mm cuối trong một step chưa có pair ở tick tới (đo được: khối lập phương 0,25 m/s từ 3 mm, còn 0,91 mm sau tick, không có pair); test: khối lập phương 0,25–1 m/s và rover tham chiếu 0,6 m/s, khe 0–12 mm, đều báo đúng tick tới. Tốn khoảng 20 µs/lần gọi cho rover trong sa bàn `boxes` (9 µs khi chỉ dùng pair graph). Body hoặc collider có pose không hữu hạn thì không chạm gì (không throw). "Chạm" thì đo bằng `Collider.contactCollider` ở vị trí **hiện tại** (≤ 1 mm), không đọc manifold. Lý do: manifold được tính ở đầu step, trước solver, nên trễ một step, và không cập nhật khi body ngủ. Đo được: khối lập phương ngủ trên sàn, lún 0,07 mm, vẫn giữ manifold 1,7 mm; khi trượt vào tường, manifold báo chạm trễ 8 tick, còn `contactCollider` báo đúng tick tới. Kết quả mỗi id một lần, sắp theo id (code unit). Kiểm tra chạm đất của robot (R3.3, `isGrounded`) vẫn đọc manifold: chấp nhận được vì chassis và tay servo không bao giờ ngủ (`setCanSleep(false)`), nên chỉ trễ một tick khi bánh chạm hoặc rời sàn (ghi chú cho R3.5).
  - `robot falling off arena yields outOfArena and finite poses` dùng rover tham chiếu (`assembleRobot` + `stepWorld`), chạy hết công suất ra mép sàn trống trong 600 tick: pose, rotation, góc servo và bánh, cm và `echoUs` siêu âm, số đo line đều hữu hạn mọi tick, `readContacts` không throw, `isOutOfArena` đúng từ tick 66 và giữ đúng. `isOutOfArena` chỉ xét gốc khung robot (dưới tâm thân), là hàm bậc thang không có hysteresis: gốc dao động qua biên thì đọc ra/vào xen kẽ; R3.5/R6 tự chốt "đã rơi".

**R3.5 World facade + snapshot + tất định (20h).**
- Files: `src/core/world/{world.ts,snapshot.ts}`, `tests/robot-determinism.test.ts`, `e2e/robot-determinism.spec.ts`.
- `playwright.config.ts` thêm project `firefox` và `webkit`, chỉ chạy spec này.
- `hashSnapshot(s): string`: FNV-1a trên số đã lượng tử 1e-6.
- Golden hash mỗi scenario ở `tests/__snapshots__/robot-determinism.json`. Đổi engine thì cố ý bump `ROBOT_ENGINE_VERSION`.
- Tests: `same seed twice → identical hash after 3000 ticks`; 4 runtime cho cùng hash.
- *Bổ sung khi làm R3.5* (API ở §4.5):
  - **Fixture tất định** (`tests/robot-determinism.fixtures.ts`, dùng chung cho Node và trình duyệt), mỗi cái 3000 tick, hash mỗi tick gồm snapshot và `frameExtras` (contacts nằm ngoài snapshot): `boxes-script` (kịch bản mở của R3.3, đẩy object), `line-follow` (bám vạch 3 cảm biến, vòng kín: 565 cm, cảm biến giữa trên vạch 78 % số tick), `mini-mission-v1-noise` (biến thể 1 của scenario fixture, né vật bằng siêu âm có nhiễu ±1 cm, servo quét). Golden `{ final, trajectory }` ở `tests/__snapshots__/robot-determinism.json` kèm `engineVersion: 1`.
  - **Bằng nhau trên 4 runtime** (đo 2026-10-25): Node 24.22.1 (Vitest 4.1.11, cả bản split lẫn `-compat`), Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6 (Playwright 1.63, dev server Vite 8.3.2) đều ra `4927ee22/abf46454`, `17c47f8d/3e412cc4`, `d02081f3/2693afb5` (final/trajectory; trajectory đổi ở fix round 1 vì tốc độ và dải servo của `frameExtras` nằm trong hash, final không đổi). Trang thử `e2e/robot-determinism.html`; project `firefox`/`webkit` chỉ chạy `robot-determinism.spec.ts`, `chromium` chạy mọi spec như cũ. Một lượt 3 fixture mất 0,95 s (Chromium), 1,16 s (Firefox), 0,99 s (WebKit).
  - **Dev server và gói `.wasm` tách riêng:** dependency optimizer của Vite 8.3.2 pre-bundle `@dimforge/rapier3d-deterministic` kèm một bản glue wasm-bindgen riêng, trong khi wasm helper của Vite instantiate file `.wasm` với file glue gốc: hai bản glue, bản Rapier gọi không bao giờ có wasm (`wasm.memory` undefined, cả ba trình duyệt, mọi lần tải). `vite.config.ts` thêm `optimizeDeps.exclude` cho gói này (chỉ ảnh hưởng dev; build không đổi). R4.2 cũng cần điều này khi lab robot nạp world ở dev.
  - **Servo của `ref-uno-rover@0` (ruling):** thư viện Servo bắt đầu ở 90° nên mọi program dùng servo chĩa tay ra trước. Trục servo dời về x = 1,5 cm và tay ngắn lại 5,5 cm (tay 6 cm rộng 0,8 cm luôn thò ra 0,13 mm ở mọi vị trí trục, vì √(6² + 0,4²) = 6,013 > 6 cm nửa bề rộng thân): tay nằm trong khung thân ở mọi góc 0–180° (xa nhất 7,01 cm phía trước, 5,51 cm sang hai bên). Servo là cờ/thanh chắn, đẩy vật là việc của thân. Golden của R3.3 đổi thành `a9395d3a`.
  - **Contacts:** `Collider.contactCollider` của Rapier 0.21 có khi không trả contact cho cặp chồng lên nhau một chút (đo được: thân rover lún 0,054 mm vào tường, yaw 0,02°: từ phía thân không có contact kể cả prediction 1 cm, từ phía tường là −0,054 mm). `readContacts` nay hỏi thêm `intersectsShape` (shape gốc) khi `contactCollider` trả null.
  - `kit-mechanics.ts` từ chối `max(minCm, 2) ≥ min(maxCm, 400)` (vd. 0,5..1,5 cm, lỗi trên `spec.maxCm`). Lint: `src/ui` không được import `core/world/{world,rapier,arena/build-arena,robot/*,sensors/*}`, kể cả `import type` và `import()`; được import `snapshot`, `goal-frame`, `arena-schema`, `ground-paint`, `units`, `dmath`, `rng`.

**R3.6 RobotRunSession (16h).**
- Files: `src/core/run/robot-run-session.ts`. Scheduler tạo bằng `createVirtualScheduler({ signal, delayOverheadUs: board.costsUs.delayOverhead })`; services tạo bằng `createRuntimeServices({ signal, console, clock: programClock, sleep, scheduler: createRunScheduler(timers), budget: budget(signal), randomInt: createSeededRandomInt(seed), warn, trace })`, **không** truyền `yieldNow` (nó chỉ dựng budget YB-2, mà `budget` ảo thay thế; R2.3 fix round 1).
- Interface: `createRobotRunSession({ kit, board, scenario, registry }): RobotRunSession` với `start(project, variantIndex)`, `stop()`, `advance(wallMs, speed)` (single-flight), `runUntil(tS)`, `resetRobot()` (**dựng world mới** từ đầu), `getSnapshot()`, `subscribe()`. Giữ quy tắc reentrancy của `run-session.ts`.
- Tests:
  - `stop mid-tick publishes no further snapshot`;
  - `overlapping advance calls never run ticks concurrently`;
  - `resetRobot hash equals fresh start`.
- *Bổ sung khi làm R3.6* (`src/core/run/{robot-run-session.ts,robot-modules.ts}`, hook `World.goalFrame` ở `world.ts`, kiểu `GoalFrameSource` ở `goal-frame.ts`):
  - **API.** `createRobotRunSession({ scenario, kit, board, registry, profiles?, packs?, scorer?, wallNow? })`. `start(project, variantIndex = 0, { check? })` là **async** (world nạp physics) và trả `{ ok: true }` hoặc `{ ok: false, reason, diagnostics }` với `reason` là `layer` (L-1 `unknown-kit`, L-2, L-3), `compile` (cả luật chân của kit: `timer-claimed`, `pin-conflict`, `pin-reserved`), `world-error`, `scorer-error` (scorer không tạo được, throw ở frame t = 0 hay ở score đầu tiên; session idle), `superseded` (một `stop` hay `start` mới tới trong lúc dựng world) hoặc `idle` (`resetRobot` khi không có run). Variant không có thì reject `RangeError`. Project được compile với **duy nhất** kit của session: kit khác, kể cả kit app biết, là `unknown-kit`. `getSnapshot()` trả `RobotRunSnapshot = { status, diagnostics, error, console, world: RobotSnapshot | null, slowerThanRealtime }` (JSON thuần, object mới mỗi lần phát; `world` đóng băng sâu, hash bằng `hashSnapshot(world)`). `pressButton(role, down)` áp từ tick sau, bị bỏ qua khi đang Kiểm tra (`check: true`), khi idle và với role không phải nút của kit.
  - **Program bắt đầu trong tick 0** (fix round 1), sau input của tick 0, không phải lúc `start`: nếu chạy ngay từ `start` thì program chạy xen microtask với lời gọi đầu tiên, và một input lúc t = 0 được thấy ở thời điểm phụ thuộc lúc tick đầu được gọi (hash khác giữa "ngay" và "một frame sau"). Snapshot t = 0 và frame t = 0 của scorer có trước đó. `resetRobot` đi cùng đường.
  - **Một tick k:** (1) input của khoảng `[k·dt, (k+1)·dt)`: nút UI bấm từ tick trước, rồi script `inputsDueBetween` (cả hai chế độ); ở tick 0 program bắt đầu ngay sau đó; (2) `advanceTo(k * 1000 / PHYSICS_HZ)`; (3) module model đọc `VirtualUno.pins()` → `applyActuators`; (4) `world.step(PHYSICS_DT_S)`; (5) scorer nhận goal frame dựng từ body (`World.goalFrame`, bằng `toGoalFrame` của snapshot), không dựng snapshot. Snapshot chỉ dựng khi phát: tối đa một lần mỗi `advance`, một lần cuối `runUntil`.
  - **Module model** (`robot-modules.ts`, nghịch đảo đúng các lệnh ghi chân của driver): H-bridge `{ duty: EN, dir: IN1 HIGH/IN2 LOW → +1, ngược lại −1 }`; EN tắt (duty 0, không phải OUTPUT, hay PWM trên timer bị chiếm) là coast; IN1 = IN2 với EN bật (duty > 0, PWM < 255 cũng tính) là `brake: true` (driver hbridge không bao giờ làm vậy). Servo: góc đã ghi, chưa attach thì không ghi (world giữ `restDeg`). LED sáng khi chân là OUTPUT có duty > 0. Buzzer: `toneHz`.
  - **Thời gian của phần cứng (sửa lỗi tìm được):** VirtualUno đo hết tone theo clock nó được giao. Program clock đứng yên khi program đang `wait`, nên `tone 1000 ms` rồi `wait 2000` sẽ kêu 2000 ms. Session giao cho VirtualUno clock = `max(programClock, (k + 1) · dt)` sau tick k. Khi program chạy một statement clock của nó luôn ≥ world.t, nên `millis` và mọi charge không đổi.
  - **Siêu âm:** pulse source trả `sense.ultrasonic(role).echoUs` (0 khi không echo: `pulseInNoPulse30000`, helper trả 400). Mọi lần đọc **bắt đầu** trong tick của nó; driver gửi trigger (3 `digitalWrite` + 12 µs = **25,6875 µs**) rồi mới lấy mẫu echo, nên mẫu có thể vượt `world.t + dt` tối đa chừng đó (đo: 4/1172 mẫu khi có echo, 19/241 khi không; lead lớn nhất 8,3556 / 8,3578 ms). World không có thời gian chờ trước echo, nên không phân giải được vài µs này.
  - **Chạy:** `advance` single-flight; frame bắt đầu ở microtask sau lời gọi, nên mọi lời gọi trong cùng một lượt cộng vào frame đó. Frame chạy hết số tick nợ khi nợ tối đa `MAX_TICKS_PER_FRAME + JITTER_TICKS` = 9 (fix round 1: ở 4× màn 60 Hz đòi đúng 8 tick/frame, frame 16,9 ms nợ 8,1, nên với ngưỡng 8 badge nhấp nháy và mất tick; nay 600 frame 16,5–16,9 ms ở 4× không bật badge, không mất tick); nợ hơn 9 thì chạy 8, **bỏ** phần dư (không đuổi theo), bật `slowerThanRealtime` tới khi một frame vừa lại (máy chậm, frame 25 ms ở 4× = 12 tick: luôn bật). `runUntil(tS)` chạy tới `world.t ≥ tS`, nhường `VirtualScheduler.yieldNow()` mỗi `EXEC_SLICE_MS` (8 ms) wall; từ lúc gọi tới khi xong `advance` không cộng thời gian, xong thì không còn nợ và tắt badge. Khi tick đã dừng (lỗi) `advance` không cộng thời gian và `pressButton` bị bỏ qua. Kết quả không phụ thuộc chế độ (test: 1×, 4×, frame ngẫu nhiên và headless cùng hash; input lúc t = 0 cùng hash dù tick đầu chạy ngay hay sau một frame).
  - **Kết thúc run:** program xong → `finished`, world vẫn chạy (motor giữ theo chân). Lỗi program (`error`, có block) hay lỗi của chính mô phỏng (timer task throw làm `advanceTo` reject, world từ chối step, scorer throw) → `error` (`internal-error` kèm diagnostic), tick dừng, world đứng ở thời điểm đó.
  - **Scorer (chỗ nối của R6.2):** `scorer({ scenario, arena, program, variantIndex, check }) → { update(frame, dtS), score() }`, tạo mới mỗi `start`/`resetRobot`; nhận frame t = 0 với `dtS = 0`, rồi mỗi tick sau step với `PHYSICS_DT_S`; `score()` vào `world.score` (bản copy). Không có scorer thì score rỗng.
  - **Giá** (M4 Pro, Node 24.22.1, CPU của thread, sa bàn fixture `all-goals` biến thể 1, đủ 9 goal mỗi tick): tick có interpreter **0,108–0,110 ms** (né vật cản), **0,242–0,243 ms** (bám line, ~140 vòng `loop()`/tick), 0,112–0,113 ms (vòng đếm không phần cứng); headless 3 biến thể × 60 s **2,0 s**. Heap JS cấp phát mỗi tick: riêng world ~51 KiB, goal frame +5,7 KiB, 9 goal +6 KiB, session ~0; interpreter đọc phần cứng ~1,4 KiB mỗi lần đọc (bám line 849 KiB/tick). Goal frame từ body 3,5–3,7 µs, qua snapshot 5,6–5,7 µs (heap 5,8 so với 6,3 KiB).
  - **Nhường trong trình duyệt** (`spikes/robot-run-until/`, Playwright 1.63): một lượt MessageChannel mới 4,65 µs (Chromium 153), 5,61 µs (Firefox 155), 25,45 µs (WebKit 26.6); `setTimeout(0)` 4,9–7,6 ms. `runUntil(60)` của bài kiểm tra trên: 549–567 / 1425–1446 / 601–625 ms có nhường so với 536–538 / 1378–1392 / 576–588 ms không nhường (+4 / +4 / +5 %), cùng hash `0adb8d09` với Node.

### R4 — Giao diện 3D (116h)

**R4.1 Launch + lab shell (16h).**
- Sửa `src/ui/app/{launch.ts,lab-host.ts,App.tsx,test-hooks.ts}`, `src/main.tsx`, `src/samples/{templates.ts,robot-templates.ts}` (`LabKind` thêm `'robot'`).
- `lab=robot` mở `RobotLab` qua `React.lazy`.
- `window.__stem.robot` (chỉ dev): `getSnapshot()`, `setSpeed(n)`, `snapshotHash()`.
- Tests: `launch-isolation.test.ts` thêm case robot (profile thấp hơn scenario thì lỗi launch); e2e: `lab=blockly` không tải chunk 3D.

**R4.2 Scene (32h).** `src/ui/robot3d/{RobotLab.tsx,Scene.tsx,ArenaView.tsx,RobotView.tsx,robot-run-store.ts,quality.ts}`.
- Hình thủ tục từ `Kit`/`Arena`.
- `useFrame` đọc snapshot từ store ref.
- Tier `high|low` (bóng; DPR ≤ 1,5 / 1).
- `frameloop="demand"` khi không chạy.

**R4.3 Camera + overlay cảm biến (14h).** `CameraRig.tsx` (Theo xe / Nhìn từ trên / Tự do bằng `OrbitControls`), `SensorOverlay.tsx` (tia siêu âm, chấm line sáng/tối, vùng đích). `prefers-reduced-motion` thì tắt chuyển động mượt.

**R4.4 HUD, điều khiển, console (22h).**
- `Hud.tsx`: thời gian ảo, điểm, goal, badge "chậm hơn thời gian thực".
- `RobotControls.tsx`: Chạy/Dừng/Tạm dừng/Bước 0,1 s/Tốc độ 0,5–4×/Reset robot. Khoá khi đang Kiểm tra.
- Console Serial dùng lại console hiện có.
  - *Ghi chú C1 (contract UNO §7):* nếu sau này nối thời gian hàng TX (`serialQueueByte`… vào `programClock`), interpreter phải in một join **từng phần**: đánh giá phần k, đưa vào hàng, rồi mới đánh giá phần k + 1. Board làm vậy vì sketch viết mỗi phần một `Serial.print`. Hiện interpreter đánh giá mọi phần rồi in một lần; chữ in ra giống nhau, thời điểm đọc robot thì chưa.

**R4.5 Pin inspector + tab code (16h).** `PinInspector.tsx`: role → port → chân → giá trị sống (vd. *motor trái 50 % → M1 → D5 PWM 128, D7 HIGH, D8 LOW*). Tab "C++" hiện output C1 (read-only, Copy theo pattern clipboard đã có).

**R4.6 Fallback + layout (16h).**
- `webgl-support.ts`, `TopView2D.tsx` (Konva tối giản, đọc cùng snapshot). Xử lý `webglcontextlost`.
- Layout 1100×640: viewport trái khoảng 60 %; phải là tab Khối lệnh / C++ / Cổng & chân. Dưới 800 px dùng tab.
- E2E: `robot-layout.spec.ts` (1100×640, 760 px); `robot-webgl-fallback.spec.ts` (WebGL tắt → top view, Run vẫn chạy).

### R5 — Sa bàn và kịch bản pilot (62h)

**R5.1 Scenario schema + loader (12h).** `src/core/scenario/{scenario.ts,scenario-schema.ts,variants.ts}`. `variantOffsets(scenario, index): VariantOffsets` (seeded). Tests: `variant 0 is exact start`; `variants differ and stay inside arena`; `inputs are applied at atS in every mode`.

**R5.2 Sáu kịch bản cho khóa pilot (38h).** Starter, lời giải chuẩn và (bài 3–6) lời giải "chạy mù" ở `src/samples/robot-solutions.ts`:

| Key | Bài | Kiến thức | Goal chính | Biến thể |
|---|---|---|---|---|
| `rb-drive-to-zone` | 1. Làm quen | motor, `wait` | `stop-in-zone` | 1, không jitter |
| `rb-square-route` | 2. Đi theo lộ trình | lặp, rẽ | `checkpoints-in-order` | 1, không jitter |
| `rb-stop-at-wall` | 3. Siêu âm | `if`, so sánh | `stop-in-zone` + `avoid-contact` | 3 |
| `rb-line-follow` | 4. Dò line | `if/else`, vòng lặp | `stay-on-line ≥ 0.85` + `reach-zone` | 3 |
| `rb-servo-gate` | 5. Servo | servo + siêu âm | `servo-angle whenInZone` | 3 |
| `rb-mini-mission` | 6. Tổng hợp / thi nhỏ | kết hợp | checkpoint + line + tránh vật cản, `finish-within`, time bonus | 3 |

Thêm `rb-sandbox` (không goal).

Test `tests/robot-scenarios.test.ts`:
- lời giải chuẩn qua **mọi** biến thể;
- bài 3–6: lời giải mù trượt ≥ 1 biến thể;
- lời giải ≤ 75 % RAM (khi có L2).

*Bổ sung khi làm R5.2a (R5.2 tách đôi: R5.2a soạn dữ liệu và kiểm tĩnh; R5.2b chạy lời giải qua run session R3.6 và check R6.2):*
- **File:** `src/samples/robot-scenarios/rb-*.json` (bảy kịch bản), `src/samples/robot-solutions.ts` (`{ reference, blind?, notes }`
  cho sáu kịch bản có điểm), `tests/robot-scenarios.test.ts`, `tests/robot-solutions/rb-<key>.ino`, `docs/robot-scenario-authoring.md`
  (R5.3, 6h). Sa bàn, goal, seed và lý do chọn: bảng ở mục 9 của tài liệu soạn kịch bản; số đo ở `notes` của từng lời giải.
- **Thiết kế bằng số đo, không bằng ước lượng:** spike `spikes/r52-scenario-sim` chạy chương trình đã compile trên virtual UNO, world của
  R3.5 (`createScenarioWorld`, `toGoalFrame`) và goal của R6.1, có luật `endOnContact` (sau fix round 2). Kết quả (M4 Pro, Node 24.22.1): lời
  giải chuẩn qua mọi goal ở mọi biến thể; lời giải mù qua biến thể 0 và trượt cả hai biến thể còn lại (đâm tường hay dừng ngắn 7–8 cm ở bài 3,
  5; tỉ lệ bám vạch 0,48–0,58 ở bài 4; chạm cọc hay rời vạch ở bài 6); starter 0 điểm; không `exploit` nào qua check, điểm check của chúng
  0–60. Spike nối pin → actuator và time bonus đơn giản hơn R3.6/R6.2 sẽ làm, nên R5.2b đo lại.
- **`robotReadyFields` đọc file kịch bản qua `robot-scenarios/ready-fields.ts`, không qua catalog** (lệch khỏi ruling "đọc catalog" vì hai
  ràng buộc có test): `robot-templates.ts` nằm trong bundle chính của mọi lab, còn catalog kéo scenario schema → `src/core/world/arena`
  (`e2e/robot-bundle.spec.ts` cấm lab khác tải `src/core/world`); và Playwright import `robot-templates.ts` vào Node thuần
  (`e2e/robot-lab.spec.ts`), nơi không có `import.meta.glob` và JSON cần `with { type: 'json' }`, chỉ có default export. Lá này import bảy
  file như thế, đọc `version`, `goals[].points`, `scoring` y như `scenarioMaxScore`; test giữ nó bằng catalog cho mọi key. Giá: bundle chính
  thêm 12,8 kB minified (2,7 kB gzip), JSON của bảy file; schema và world không vào.
- **Golden của lời giải ở `tests/robot-solutions/`, không ở thư mục `__golden__`:** `check-arduino.test.ts` (C1) ghim lần chạy mặc định của
  `scripts/check-arduino.mjs` vào đúng số case của C1, nên golden mới trong `__golden__` dưới `src/`, `tests/` sẽ làm đỏ test đó. Lệnh
  `pnpm check:arduino` nay truyền `src tests` (compile mọi `.ino` trong đó: golden của C1 và sketch của lời giải). Nếu muốn đưa golden về
  `tests/__golden__`, chỉ cần đổi assertion đếm của C1 thành số golden tìm thấy.
- **Fix round 1 (review chất lượng nội dung, ruling của controller):** (a) goal canh gác dùng **tầm xa ròng** thay cho tổng quãng đường và
  (b) `stay-on-line` tính tỉ lệ **theo quãng đường** thay cho số tick (xem §R6.1; test của `goals/travel`, `stay-on-line`, `avoid-contact`
  viết lại). Bài 4: vạch mở vòng qua sa bàn vào một gara có miệng quay về hướng vạch tới (không cú chạy thẳng nào vào được), điểm vạch 40 /
  gara 60, lời giải chuẩn là bộ bám vạch dùng cảm biến giữa có "else dừng" (bộ bám hai cảm biến bên kẹt ở góc 45°). Bài 5: tên mới "Giơ cờ ở
  cổng" / "Raise the flag at the gate" (key giữ `rb-servo-gate`), cờ ≥ 150°, điểm 40/40/20. Bài 6: vạch chạy tới y 137, sát tường bến, nên bộ
  bám vạch dừng khi mất vạch gặp tường trước (fix round 2: và chỗ xuất phát dời ±15 cm dọc đường thẳng xuất phát, nên dừng sau một thời gian cố định
  cũng trượt bến ở một biến thể). `robot-solutions.ts` thêm `exploits` (chương trình lách và điểm tối đa) cho R5.2b. Chưa kịch bản
  nào được phát hành, nên `version` vẫn là 1.
- **Fix round 2 (ruling của controller):** schema thêm `endOnContact` và `variants.startJitterAlongCm` (xem bổ sung ở §4.6), lý do mới
  `run-ended-contact`. Bài 3, 5, 6 kết thúc lượt chạy ở lần chạm đầu tường / cổng / vật cản và tường bến: đâm rồi lùi một thời gian cố định không
  còn đỗ được (trước đó được 70 / 80 ở mọi biến thể vì tường không dời). Bài 6 dời chỗ xuất phát ±15 cm dọc đường thẳng xuất phát (seed 3225:
  −13,8 và +14,2 cm), xa hơn chiều dài bến (23 cm), nên bám vạch rồi dừng sau một thời gian cố định trượt bến ở một biến thể với mọi thời gian
  (spike quét 240 000 – 380 000 vòng: không giá trị nào qua, điểm check cao nhất 45). Bài 4: `timeLimitS` 120 (bộ bám đúng ở 35 % vào gara lúc
  khoảng 94 s), nhãn "Vào gara". Luật 10 của tài liệu soạn: chương trình mở không được qua check, điểm check cao nhất ghi ở `exploits`, nên ≤ 60.
  Điểm check là **điểm thấp nhất** trong các biến thể (ruling cho R6.2).
- **Fix round 3 (ruling của controller):** `stop-in-zone` chấm ở cuối run (xem §R6.1), mọi kịch bản `maxSpeedCmS: 0,5`: "phóng rồi bò chậm
  qua vùng" (trước đó 70 / 80 / 65 ở bài 3 / 5 / 6) còn 0 / 40 / 45, cùng các biến thể của nó (spike quét thời gian phóng). Bài 6
  `finish-within` 35 s (bộ bám đúng ở 40 % đỗ lúc 26,6–31,1 s). `exploits` thêm `dash-then-creep`, `flag-dash-then-creep`,
  `timed-follower-creep`, `timed-follower-creep-forever`, `follower-bump-and-back`; không cái nào qua check, điểm check ≤ 45.
- **Starter:** nằm trong JSON (`starter`), hat của bài và một khối chạy rời bị tắt. `robotStarterDocument` vẫn mở project với `program.blocks
  = {}`; nạp `scenario.starter` vào workspace là việc của UI lab robot (R4).

**R5.3 Hướng dẫn soạn + in sa bàn (12h).** `docs/robot-scenario-authoring.md` (6h). ✂ (6h) `scripts/export-arena-mat.mjs` xuất PNG đúng tỉ lệ (150 dpi) để in sa bàn thật; nếu cần về 720h thì chuyển sang M06.

### R6 — Kiểm tra và chấm điểm (56h)

**R6.1 Goal library (22h).** Không dùng lại `check-run.ts`/`goal-tracker.ts` (hai file gắn wall-clock và goal ybc). `uses-block` dùng lại walk tĩnh `challenge/running-blocks.ts`. Mỗi kind ở `src/core/scenario/goals/*.ts` là `createGoal(spec) → { update(snapshot, dt): void; result(): GoalResult }`, với `GoalResult = { id; passed; points; progress: 0..1; reasonKey?: string; atS?: number }`. Tests theo từng kind, có case biên (chạm rồi rời vùng, checkpoint sai thứ tự).

*Bổ sung khi làm R6.1 (`src/core/scenario/goals/`, test cạnh từng kind):*
- **API:** `createGoal(spec, ctx: { arena; scenario; program?; othersPassedAtS? }) → { update(frame, dtS): void; result(): GoalResult }`. Goal **không đọc `RobotSnapshot`** mà đọc `GoalFrame` (`goals/frame.ts`, số thuần cm/độ: `tS`, `robot { xCm, yCm, yawDeg, speedCmS, footprint, lineSpotsCm? }`, `objects`, `contacts { otherId, tags }`, `servoDeg`, `leds`, `buzzerHz`, `outOfArena`); R3.5 viết adapter snapshot → frame. `result()` là phán quyết "tính tới lúc này", không đổi state; gọi sau frame cuối để lấy kết quả cuối. `ctx.scenario` chưa kind nào đọc.
- **Điểm all-or-nothing:** `points = spec.points` khi `passed`, ngược lại 0; `progress` 0..1 chỉ cho UI. Goal chưa qua luôn có `reasonKey` (khoá `robot.goal.reason.*` trong `messages.ts`, có vi/en; danh sách ở `goals/reasons.ts`), goal đã qua thì không. `atS` là giờ mô phỏng của sự kiện quyết định (qua, chạm, rời sa bàn), bỏ trống khi không có sự kiện.
- **Vị trí robot = tâm thân** (`robot.xCm, yCm`). "Trong vùng" là luật point-in-polygon của `goals/geometry.ts`, cùng phép tính và luật cạnh với `ground-paint.ts` (even-odd, cạnh dưới/trái thuộc vùng, cạnh trên/phải không). Luật này chỉ bằng thứ cảm biến đọc được ở chỗ không có gì đè lên vùng: băng keo được sơn đè lên vùng và vùng sau đè lên vùng trước, nên dưới băng keo hoặc ở chỗ hai vùng chồng nhau cảm biến đọc băng/vùng kia, còn goal vẫn tính robot ở trong cả hai vùng.
- **Từng kind:**
  - `reach-zone`: qua ngay lần đầu tâm robot vào vùng, giữ nguyên kể cả khi rời đi.
  - `checkpoints-in-order`: chỉ tính **lần vào** (khung này trong vùng, khung trước không; khung đầu coi như vào). Vùng kế tiếp được vào thì tính, vùng đến sau mà vào trước thì **không tính** nhưng không làm hỏng lộ trình (robot quay lại sau vẫn được); vào lại vùng đã tính là vô hại. Không xong: `checkpoint-out-of-order` (có vào sai thứ tự, `atS` là lần đầu) hoặc `checkpoint-missed`. Vùng liệt kê hai lần cần hai lần vào. **Luật schema:** các vùng của một goal `checkpoints-in-order` **không được chồng nhau** (giao diện tích hoặc chứa nhau; chỉ chạm cạnh/góc thì được), vì robot ở chỗ chồng sẽ vào hai điểm một lúc và thứ tự phụ thuộc cách viết danh sách. `loadScenario` báo lỗi ở `goals[i].zones[j]` của vùng đứng sau trong cặp (`zone "b" overlaps zone "a" (zones[k])`), mỗi cặp một lần, vùng liệt kê hai lần không tính là chồng với chính nó; kiểm tra bằng `scenario/polygon-overlap.ts` (quét theo x, chính xác cho đa giác lõm). Hai goal khác nhau được phép dùng các vùng chồng nhau. Evaluator vẫn xử lý được vùng chồng nếu goal được dựng tay: vùng vào cùng khung tính theo thứ tự liệt kê, vùng đang đứng trong không tính là vào lại.
  - `stay-on-line` (goal canh gác, xem dưới): tỉ lệ **quãng đường** (từ R5.2a fix round 1, ruling của controller; trước đó là tỉ lệ số tick, bị lách bằng cách bò chậm trên vạch rồi phóng nhanh ngoài vạch) có ≥ 1 điểm nhìn của cảm biến vạch nằm trên băng keo: `Σ(speedCmS·dtS khi trên vạch) / Σ(speedCmS·dtS)`, tính từ t=0 tới hết run; tốc độ là tốc độ chạy của frame (giữa trục bánh, quay tại chỗ là 0), nên robot đứng yên hay quay tại chỗ không cộng gì, tốc độ không phải số dương hữu hạn cũng vậy. Qua khi tỉ lệ `≥ minRatio` **và** robot đã đi đủ xa (xem dưới). Các tick cùng độ dài và cùng tốc độ cho tỉ lệ của hai bội số nguyên, là số double gần tỉ lệ thật nhất như hằng số tác giả viết, nên run đúng ở biên vẫn qua. "Trên băng keo" = `groundReflectanceAt(điểm, 0) ≤ 0,25` và điểm nằm trong nền (ngoài mép nền đọc 0 nhưng không có băng). Chưa đi quãng nào thì tỉ lệ là 0.
  - `avoid-contact` (goal canh gác, xem dưới): trượt vĩnh viễn ở sự kiện đầu tiên trong hai: tick đầu chạm collider có `tag` (tag gồm cả loại `wall/box/cylinder/object`, `reasonKey = contact`) hoặc robot ra khỏi sa bàn (`out-of-arena`: rơi khỏi bàn là đã đâm); chạm collider khác bị bỏ qua. Lỗi của chính nó đứng trước lý do tầm xa; không lỗi mà robot chưa đi đủ xa khỏi chỗ xuất phát (tầm xa ròng, xem dưới) thì chưa qua.
  - `object-in-zone`: tâm vật trong vùng ở **frame cuối** (đẩy vào rồi đẩy ra thì không qua).
  - `stop-in-zone` (chấm **ở cuối run** từ R5.2a fix round 3, ruling của controller; trước đó qua một lần là giữ, bị lách bằng cách bò chậm qua vùng dưới ngưỡng tốc độ): qua khi ở **frame cuối** goal nhận được, tâm robot đã ở trong vùng với `speedCmS ≤ maxSpeedCmS` liên tục `holdS` giây gần nhất. Rời vùng hay chạy nhanh hơn một frame thì đếm lại; robot dừng rồi chạy tiếp thì không qua. `atS` là lúc lần dừng đang kéo dài hoàn tất. Lượt chạy bị `endOnContact` cắt thì chỉ qua khi robot đã dừng đủ `holdS` trong vùng trước tick đó. Ra khỏi sa bàn thì trượt hẳn (như `object-in-zone`). Mọi kịch bản pilot dùng `maxSpeedCmS: 0,5` (ngưỡng đứng yên của R6.2; kit placeholder bò 1,0–1,5 cm/s ở duty 32–33 %).
  - `servo-angle`: góc trong `[minDeg, maxDeg]` (gồm hai đầu) **liên tục 0,5 s** (`SERVO_HOLD_S`, tính như mục "Giữ khi đủ thời gian" bên dưới); qua một lần là giữ, servo quay đi sau đó cũng không mất, còn góc chỉ được đặt ở tick cuối thì chưa qua. 0,5 s áp dụng cả hai trường hợp: có `whenInZone` thì góc đúng **và** tâm robot trong vùng cùng lúc; không có thì chỉ xét góc, robot ở đâu cũng được.
  - `finish-within`: scorer (R6.2) truyền `ctx.othersPassedAtS(): number | null` (giờ mà goal cuối cùng của các goal khác qua, `null` nếu còn goal chưa qua); qua khi giá trị đó `≤ seconds` (gồm đúng bằng). Goal tự không xem frame; thiếu callback thì throw lúc tạo.
  - `uses-block`: tĩnh, chỉ từ `ctx.program` (JSON Blockly) qua `runningBlockTypes`: khối bị tắt (kể cả những khối nằm trong nó) và khối rời không được tính. Thiếu `program` thì throw lúc tạo.
- **Goal canh gác (`travel.ts`, ruling của controller; tầm xa ròng từ R5.2a fix round 1):** `avoid-contact` và `stay-on-line` được thoả bằng việc *không* làm gì (không chạm, không rời vạch), nên robot đứng yên cũng qua. Hai goal này chỉ qua khi **robot đã có lúc cách chỗ xuất phát ≥ `MIN_GUARD_TRAVEL_CM = 20` cm** (tầm xa ròng, net reach); chưa đủ thì `passed: false`, `reasonKey = robot-did-not-move` (`robot.goal.reason.robot-did-not-move`), bất kể tỉ lệ. Tầm xa = khoảng cách lớn nhất của giữa thân (`robot.xCm`, `yCm`) tới vị trí ở frame đầu tiên được tính; frame `outOfArena` và vị trí không phải số hữu hạn không được tính (không làm điểm xuất phát, không tính tầm xa). Trước đây là tổng quãng đường Σ `speedCmS · dtS`, bị lách bằng quay lệch hay đi tới đi lui tại chỗ (đường dài mà không đi đâu). Chỉ + − × và `Math.sqrt` (làm tròn đúng theo IEEE 754) nên tất định; so với 20 có dung sai `1e-9` cm (vị trí 12,3 và 32,3 cách nhau 19,999999999999996). Đánh giá ở cuối run (`result()` sau frame cuối). `progress` của hai goal này lấy phần nhỏ hơn giữa tầm xa/20 cm và tỉ lệ/`minRatio`. `dtS` âm hoặc không phải số hữu hạn là lỗi của caller (`RangeError`), như `stop-in-zone` và `servo-angle`.
- **Giữ khi đủ thời gian (`hold.ts`):** khung đầu tiên điều kiện đúng bắt đầu đếm với 0 s, mỗi khung liên tiếp sau đó cộng thêm `dtS`; xong khi tổng `≥ holdS − 1e-9`. Nghĩa là `holdS` giây là khoảng giữa hai khung đều thoả điều kiện (tick 0,25 s, `holdS = 1` cần 5 khung liên tiếp); tick kết thúc ở khung đầu không được tính vì robot có thể đang chạy trong tick đó. Một khung không thoả thì đếm lại từ đầu. `dtS` âm, vô hạn hoặc NaN là lỗi của caller (`RangeError`).
- **Ra khỏi sa bàn (`frame.outOfArena`):** mọi goal **chưa qua** thì trượt vĩnh viễn, `reasonKey = out-of-arena`, `atS` là lúc rời; goal đã qua thì giữ, trừ goal chấm ở cuối run (`object-in-zone`, `stay-on-line`, `avoid-contact`, `stop-in-zone`): rời sa bàn là trượt chúng, robot không còn ở đó lúc cuối. Áp dụng cho `reach-zone`, `checkpoints-in-order`, `stay-on-line`, `avoid-contact`, `object-in-zone`, `stop-in-zone` và `servo-angle` (cả hai dạng). Trừ `finish-within` (chỉ so giờ scorer với giới hạn) và `uses-block` (chỉ nhìn chương trình). Vị trí lúc rơi không được tính vào tầm xa của goal canh gác. Khung vừa ra ngoài vừa trong vùng (hay vừa chạm collider) thì ra ngoài thắng.
- **Kiểm tra tick:** mọi kind kiểm tra `dtS` ở dòng đầu của `update` bằng một hàm chung (`goals/tick.ts`): `dtS` không hữu hạn hoặc âm thì `RangeError`, kể cả khi goal đã chốt kết quả hay kind không dùng đến `dtS`.
- **Dành cho R6.2 (không phải việc của R6.1):** `othersPassedAtS` không được là "lần đầu mọi goal khác cùng qua" (đó là cách nối ngây thơ trong helper `scoreRun` của `goals/index.test.ts`, có ghi chú): goal theo dõi tới cuối run (`object-in-zone`, `stay-on-line`, `avoid-contact`) có thể mất lại sau đó. Phải lấy **đầu chuỗi liên tục cuối cùng** mà mọi goal khác cùng qua cho tới hết run, hoặc yêu cầu kết quả cuối của các goal khác đều qua (nếu không thì `null`).

**R6.2 Scoring + check (20h).** `src/core/scenario/{scoring.ts,check-robot.ts}`. `checkRobot(project, scenario, opts: { mode: 'realtime'|'headless'; speed?: number }): { progress: AsyncIterable<CheckProgress>; result: Promise<RobotCheckResult> }`. Ra `{ passed, score, maxScore, simTimeMs, goals, variants, engine, scenarioVersion, programHash }` theo luật §4.6. Huỷ thì không có kết quả (giữ quy tắc `App.tsx`).

**R6.3 UX kiểm tra (14h).**
- Hiện "Lượt k/N" và tốc độ (1× / 4× / Nhanh = headless).
- Giải thích lỗi, vd. *"Xe chạm tường lúc 12,4 s ở lượt 2"*.
- ✂ (8h) Replay "Xem lại" lượt trượt, phát từ snapshot đã ghi. Cắt nếu cần về 720h.
- Test: `same score/passed/hash for 1×, 4× and headless`.

### R7 — Tích hợp LMS (80h)

**R7.1 Bridge phía stem-demo (10h).** `src/ui/app/host-bridge.ts` + `docs/lab-embed-contract.md` §1–§3 (field §4.7, bảng lab → family). Fixture chung `docs/fixtures/stem-lab-v1-robot.json`. `scripts/export-robot-manifest.mjs` xuất `robot-scenarios.v1.json` (key, version, title, goal ids, maxScore, profile, hasGoals).

**R7.2 CourseService (12h).**
- `Entities/Activity.cs`: thêm `RobotLab = 10`.
- `ActivitySettings.cs`: `RobotLabSettings { ScenarioKey; Instructions?; RequiresCheck; PassScore? }`.
- `Features/Activities/RobotLabRules.cs`.
- `ActivityTypes.cs`: IsLab, `OnCheck`.
- `LabTemplateCatalog`: `CourseService:LabTemplates:Robot`, `HasGoals` (`rb-sandbox` không có goal nên ép `RequiresCheck=false`).
- `LearnerCourseDto.OutlineSettings`.
- **DTO nội bộ của lesson** cho LearningService thêm `Type`, `TemplateKey`, `RequiresCheck`, `PassScore`.
- Tests: `ActivityTypesTests` pin `RobotLab = 10`, OnCheck; rules từ chối key lạ; `PassScore` ngoài `0..maxScore` bị từ chối.

**R7.3 LearningService `LabAttempt` (24h).**
- Entity insert-only `LabAttempt { Id, EnrollmentId, LessonId, ActivityId, LabKind, TemplateKey, TemplateVersion, Engine, Passed, Score?, MaxScore?, SimTimeMs?, GoalsJson, VariantsJson?, ProgramHash?, ProjectJson? (≤ 262 144 B, chuỗi như N12), CreatedAt }`. Migration `AddLabAttempts`.
- `POST /learning/lab-attempts`, theo đúng pattern `ProgressBusiness.RecordActivityProgress` (`Features/ProgressBusiness.cs:88-121`):
  - enrollment lấy từ token;
  - kiểm lesson qua `_courseContent.GetLesson()`, activity thuộc lesson, `Type` là lab, `TemplateKey` khớp settings;
  - lấy write lock.
- **Chỉ lưu `ProjectJson` khi `ProgramHash` khác lần trước.**
- Lab báo `passed` **và** (`PassScore` null **hoặc** `score ≥ PassScore`) thì ghi `ActivityCompletion` **trong cùng transaction** (idempotent). Host không gọi `record()` riêng cho `RobotLab` nữa.
- `GET /learning/lab-attempts?activityId=`: của mình, điểm cao nhất + lần cuối. `GET` cho giáo viên theo lớp: best score.
- XP giữ luật derived (`LabBonusXp` khi qua lần đầu). Bảng dùng chung cho mọi lab kind, nên đóng carryover R6 cho phần kết quả.
- Tests:
  - `rejects activity not in lesson / wrong type / wrong template`;
  - `learner id never read from body`;
  - `project stored only on hash change`;
  - `passing attempt writes completion once`;
  - best-score query.

**R7.4 Web (34h).**
- `packages/api/src/`:
  - `courses.ts` (ActivityType mirror + settings type);
  - `learning.ts` (client lab-attempts);
  - `lab/lab-protocol.ts` (parse field robot theo bounds §4.7, test bằng fixture chung);
  - `lab/lab-launch.ts` (`lab=robot&profile=`);
  - `lab/lab-templates.ts` (`LAB_TEMPLATES` `Record<LabKind,…>` thêm `robot`, `GOALLESS_TEMPLATES` thêm `rb-sandbox`, pin test so với manifest + appsettings).
- `packages/activities`:
  - `RobotLabActivity` dùng lại `LabFrame` + `useLabBridge`, gửi `LabAttempt` sau mỗi check có verdict, hiện điểm cao nhất;
  - cập nhật `phases.ts`, `settings/{types,read}.ts`, `renderers/activityTypes.tsx`, `preview/ActivityPreview.tsx` (`COMPLETION_MODES`).
- Admin: `activity-kinds.ts`, `editors/registry.ts`, `LabEditor` thêm picker kịch bản (thumbnail + `LabPreview`) và ô `PassScore`.
- Giáo viên: `apps/learn/src/features/teach/progress/*` (heatmap) hiện best score cho ô `RobotLab`.
- `apps/learn/src/lib/bff-routes.ts`, `@stem/i18n` vi.
- `Web/scripts/seed/data/courses.ts`: khóa pilot 6 bài, mỗi bài lý thuyết → `RobotLab`.

### R8 — Hardening và nghiệm thu (28h)

- Đo lại ngân sách §5 trên build production (`vite build --base /lab/`).
- a11y tối thiểu: `aria-live` cho kết quả, focus trong iframe, tương phản HUD. ✂ (8h) Phím tắt camera và vùng có hoa văn + nhãn; cắt sang P2 nếu cần về 720h.
- `scripts/verify-attempt.mjs`: chạy lại headless từ một `LabAttempt` (project + seeds + engine) để so điểm. Đây là nền cho verifier phía server.
- **Diễn tập đổi kit**: `kits/rehearsal.kit.json` đổi chân/cực tính, chạy lại toàn bộ test, không đụng engine.
- **Browser test** toàn luồng (một lần, cuối plan):
  - học sinh mở bài 1–6 trong `apps/learn`, Kiểm tra, điểm lưu và hiện lại sau reload;
  - giáo viên thấy best score trong heatmap;
  - admin chọn kịch bản + preview.
  - Ghi `STEMLearning/.superpowers/sdd/browser-test/n18-robot3d.md`. Cập nhật carryover.

### C — Codegen, giờ tính vào M06 (làm xen trong plan này)

**C1 Arduino C++ generator (52h), sau R2.3.**
- Files:
  - `src/core/codegen/arduino/{generate.ts,sections.ts,names.ts}`;
  - `__golden__/*.ino` (`toMatchFileSnapshot`, pattern `codegen/yolobit/generate.golden.test.ts`);
  - `generate-document.ts` dispatch theo `codeTarget`;
  - bảng op → include/helper là `Record` có kiểu đầy đủ (như `modules.ts`);
  - `scripts/check-arduino.mjs` (`pnpm check:arduino`): `arduino-cli lib install <name>@<ver>` theo `Driver.cpp.libraries`, rồi `arduino-cli compile --fqbn arduino:avr:uno`. Không có tool thì ghi **L2 = PENDING**, không PASS.
- Thứ tự cố định: header comment (scenario, kit@version) → `#include` → `#define` chân từ kit → globals → helper driver → hàm của học sinh → `setup()` → `loop()`. Chỉ `Servo.h` của core; không thư viện GPL.
- Golden **bắt buộc** (không phụ thuộc C2): `300*200 literal emits mul32(300L, 200L)`; `millis compared as (long)`; `countUp evaluates bounds once and leaves variable at last value`; `INT32 wrap` (qua helper `add32…mod32`, không bao giờ toán tử thường: contract UNO §3.2, R0.4); `every scenario solution compiles` (L2).
- *Bổ sung khi làm (C1):*
  - API: `generateUnoSketch(ir, { kit, board, scenario? })` → `{ ok: true, source, lineMap, libraries, names }` hoặc `{ ok: false, diagnostics }` (`codegen/arduino/generate.ts`). `lineMap`: mỗi blockId của IR → dòng `from…to` (1-based) cho tab C++ của R4.5. Nguồn ≤ 256 KiB (`program-too-large`).
  - Dispatch: `generateCodeForDocument(project, rules)` trong `codegen/yolobit/generate-document.ts` chọn theo `board.codeTarget` của family: `yolobit-micropython` → `generateForDocument` (byte như cũ), `arduino-avr` → `compileUnoProject` rồi `generateUnoSketch`, generic → null. `generateForDocument` vẫn null cho uno.
  - Header 3 dòng tiếng Anh: `// Scenario: <key>@<version>|none, kit: <id>@<version>, board: <id>@<version>`, dòng "generated, sửa không đổi lab", dòng `Target … Libraries: name@version (license), …` (check:arduino đọc dòng này để cài library). `setup()`: `Serial.begin(9600);` khi có in → setup của port theo thứ tự kit (`kitCpp`) → `pinMode` của `uses.inputPins` (mode của driver, U-33) → `uses.outputPins` (OUTPUT, U-31), không trùng; đúng thứ tự `createProgramIO` của simulator.
  - Bảng `unoOps` (`sections.ts`): op → dòng contract + helper của ngôn ngữ (`int32`, `pwm-write`); helper/include của module op là của driver. Test so text helper, include, target với data contract (production không import `uno-contract.ts`).
  - Tên C++ (`names.ts`): ASCII, một `_`, bắt đầu bằng chữ; tránh keyword C++ (cả `and`, `or`…), tên của sketch (helper, `setup`/`loop`, role, macro chân), và **mọi tên toolchain đã pin dùng ở file scope**: `toolchain-names.ts` (1634 tên, sinh bởi `node scripts/arduino-reserved-names.mjs --write`, kiểm lại bằng `--check`: macro, khai báo `long <tên> = 0L;` không compile, class/struct, symbol của core/Servo như `timer0_millis`) + mẫu `B[01]{1,8}` của binary.h. Trùng → `_2`, `_3`.
  - Thứ tự toán hạng (contract 0.1.3 §3.5, ruling của controller): avr-gcc 7.3 đánh giá đối số của lời gọi **từ phải sang trái** (`add32(se(1L), se(2L))` in `eval=2` rồi `eval=1`; spike `spikes/avr8js/sketches/eval-order`, `node spikes/avr8js/run-eval-order.mjs`, EMU-15), simulator trái sang phải. Biểu thức có hai lần đọc robot trở lên (module read, `millis`, chân thô, hoặc `&&`/`||` có đọc, lấy nguyên khối) trong toán hạng không tuần tự (helper `add32…mod32`, so sánh, hai đối số của `buzzerTone`) được viết bằng dạng tuần tự: `(_s1 = <read>, _s2 = <read>, sub32(_s1, _s2))`, biến tạm `long`/`bool _s<k>;` khai báo ở đầu `setup()` (sau dòng setup) / `loop()`, tên dành riêng trong `names.ts`. Dạng tuần tự in `eval=1` rồi `eval=2` trên avr8js. `&&`/`||` giữ nguyên (tuần tự, short-circuit); một lần đọc thì viết như cũ. Mọi chương trình chạy được trong simulator đều có C++ (bản refusal `unsequenced-reads` trước đó đã bỏ).
  - Golden (`codegen/arduino/__golden__`, 17 file): `empty-program`, `mul-literal`, `int32-wrap`, `division-by-zero`, `count-up-bounds-once`, `count-up-body-changes-variable` (thân đổi biến đếm: vẫn đủ 5 vòng, sau vòng giữ giá trị thân để lại), `millis-compare`, `print-mixed`, `nested-control`, `names`, `every-module-op`, `raw-pins`, `deep-nesting` (64 mức block), `forever-blink`, và §3.5: `sequenced-reads` (line raw trái − phải, distance + distance, so sánh, `buzzerTone`, đối số motor), `while-two-reads` (điều kiện while, else-if), `logic-reads` (`&&`/`||` native, `&&` nguyên khối trong so sánh). Parity: IR của các golden tự kết thúc chạy trên đồng hồ ảo, console bằng số học contract (BigInt, không dùng `values.ts`). Allowlist: test rút gọn code bằng các dạng của `cppAllowlist`. `lineMap` của một join (và join lồng trong nó) là mọi dòng `Serial.print` của các phần của nó. Ghi chú hàng TX cho join: contract §7, R4.4.
  - `pnpm check:arduino` (`scripts/check-arduino.mjs`, không thuộc `pnpm verify`): mọi `__golden__/*.ino` dưới `src/`, `tests/` (lời giải R5.2 thêm sketch của chúng làm golden là được kiểm); thiếu `arduino-cli 1.5.1` hoặc `arduino:avr@1.8.8` → `L2 = PENDING`, `--require` → exit 2; không tìm thấy sketch nào → PENDING, dưới `--require` là FAIL (exit 1), không bao giờ PASS. Fail khi warning của chính sketch, RAM > 75 % (theo byte: > 1536 B), không compile, library GPL. Contract 0.1.2: allowlist thêm `cpp.variants` (INT32_MIN của U-04, `Serial.print(F("<text>"));` của U-17); 0.1.3: dạng tuần tự §3.5 (U-05, U-06, U-07, U-09, U-25; EMU-15, CC-05, CXX-09, CXX-10).

**C2 avr8js parity harness (24h), nếu R0.4 = go.**
- Files: `tests/uno-emulator-parity.test.ts`, `scripts/build-parity-hex.mjs`. HEX fixture được commit kèm hash của `.ino` nguồn.
- So pin trace (IR + VirtualUno) với trace của HEX trên avr8js cho mọi driver và fixture ngôn ngữ. Lệch timing ≤ 1 %. Chạy trên Node, không cần tool ngoài.
- *Bổ sung khi làm (C2, contract 0.1.6, ADR 0003 §10):*
  - Harness ở `tests/parity/`: `emulated-uno.ts` (avr8js 0.21.1, port từ spike), `intel-hex.ts` (kiểm checksum), `inputs.ts` (input kịch bản, lái mọi chân input của kit), `sim-run.ts` (interpreter + virtual UNO + binding dưới `createVirtualScheduler`, chỉ nghe: lời gọi và câu lệnh của nó, node, vòng `loop()`, chờ, dòng in và đầu câu lệnh in), `board-run.ts` (HEX dừng đúng ở `setupCycle + recordUs`) + `board-trace.ts` (cạnh → trạng thái, waveform là khoảng một chu kỳ timer, hai chu kỳ từ HIGH), `compare.ts` (trạng thái và dòng Serial khớp đúng; mỗi sự kiện và mỗi dòng tính giờ từ mốc nó phụ thuộc: chờ ±1 %, lời gọi −41 %, `tone()` theo cách viết tần số, node và `LOOP_MIN_US` phía simulator, ngắt và Serial phía board), `allowed-differences.ts` (19 khác biệt được phép là dữ liệu, mỗi mục một dòng contract §13), `fixtures.ts` (25 fixture: 14 golden ngôn ngữ, golden `raw-pins`, 9 chương trình driver gồm hai có LED ngay sau `tone()`, `negate-drive`).
  - `scripts/build-parity-hex.mjs` (`pnpm build:parity-hex`): sketch từ generator (Vite SSR), compile với toolchain pin, không cài gì (thiếu → PENDING), ghi `tests/__parity__/<name>.hex` + `<name>.ino.sha256` + `toolchain.json` (kèm sha256 từng HEX). Test fail khi hash sketch hoặc HEX lệch; sửa: chạy lại script. Không thuộc `pnpm verify` (cần arduino-cli); test parity thì thuộc.
  - Contract 0.1.5…0.1.6: virtual UNO charge phần tính của `motorSet` (`costsUs.motorSetOverhead` 43,3125 µs, lâu nhất các speed đo) và `tone()` theo băng prescaler (`toneUs`, đo trên sketch sinh ra, tần số tính lúc chạy, chân im/đang kêu, cạnh băng 31, 122, 244, 487, 973, 3892 Hz theo `Tone.cpp`; EMU-17, EMU-18). Đổi thời gian simulator: `motor.set` 60,125 µs (trước C2 16,8125), `tone(440)` trên chân im 258,9375 µs (trước C2 174,0625).
  - `-flto` gập `tone()` tuỳ chương trình (ít chỗ gọi, tần số literal: tới 17,6875 µs ở 1000 Hz): khác biệt `tone-fold`, chia theo cách sketch viết tần số; virtual UNO không biết chương trình được compile ra sao, nên charge lời gọi không gập.
  - Kết quả: 25/25 khớp; khoảng ≥ 1 ms không có in lệch tối đa 0,276 %; mọi dòng mở U-01…U-34 trích EMU-16. 2,255 s ảo, cả file ≈ 1,8 s trên M4 Pro.
  - Evidence mới, ghi contract §13: xung servo đầu tiên 52,8 ms sau `attach`; chi phí `tone()` theo chương trình; LOW trước khi `analogWrite`/`attach`/`tone` trên chân input; join in từng phần; gốc `millis()`; rung xung servo/tone.

## 8. Gate và mốc

| Gate | Gồm | Điều kiện qua |
|---|---|---|
| **G0** | R0 | Rapier tất định trên 4 runtime, ổn định, đạt ngân sách. Render đạt FPS/size. Contract v0 không còn UNKNOWN ở construct được mở. Có quyết định C2 |
| **G1** | R1, R2.1–R2.3 (R2.2 chỉ block Basic), R3.1–R3.3, R3.5, R3.6, R4.1–R4.2, R5.1, R6.1 (chỉ `stop-in-zone`), R6.2 | `rb-drive-to-zone` chạy Blockly → sim 3D → Kiểm tra qua trong iframe host E2E |
| **G2** | + R2.4, R3.4, R4.3–R4.6, R6.1 (đủ kind), R6.3, C1 | Đủ cảm biến, kịch bản 1–4 xanh, tất định trên 4 runtime, tab C++ có code L2 |
| **G3** | + R5.2–R5.3, R7 | 6 kịch bản trong LMS, `LabAttempt` lưu và hiện lại, giáo viên thấy best score |
| **G4** | + R8 (+ C2 nếu go) | Browser test xanh, diễn tập đổi kit xanh |
| **VG** (song song) | Nhà cung cấp gửi đủ §10 | Kit vendor qua `checkKit`, mọi scenario test xanh, tham số cơ khí/motor cập nhật từ phép đo kit thật. Mỗi **loại module mới** (vd. cảm biến màu, driver I²C): block + IR op + contract + model + goal, khoảng 16–24h/loại, ngoài 720h |

## 9. Verification (end-to-end)

1. stem-demo:
   - `pnpm verify`: typecheck + lint B1 mới + unit, gồm `robot-determinism`, `robot-scenarios`, `uno-emulator-parity` nếu có C2;
   - `pnpm check:arduino` (L2; PENDING nếu máy không có `arduino-cli`);
   - `pnpm e2e`, thêm:
     - `robot-lab.spec.ts`: iframe 1100×640, nạp lời giải qua `__stem.loadProject`, Kiểm tra → bắt `check-result` có `score`;
     - `robot-layout`, `robot-webgl-fallback`;
     - `robot-determinism` trên chromium/firefox/webkit.
2. Hiệu năng: `vite build` → đo gzip/brotli của chunk 3D và WASM. Playwright + CDP `Emulation.setCPUThrottlingRate(4)` → FPS tier thấp ≥ 30, Kiểm tra headless ≤ 30 s.
3. Tất định: hash trong `tests/__snapshots__/robot-determinism.json` bằng hash đọc từ 3 trình duyệt.
4. STEMLearning:
   - `dotnet test` (CourseService, LearningService);
   - `pnpm verify` ở `Web/`;
   - AppHost + `pnpm dev` stem-demo, làm theo browser test R8.
5. L3 (M06, ngoài plan): chạy sketch của 6 lời giải trên kit thật + sa bàn in, so hành vi, cập nhật contract và tham số kit.

## 10. Câu hỏi bắt buộc gửi nhà cung cấp (R0.5)

1. **MCU và bản mạch:** MCU chính xác (ATmega328P? LGT8F328P? ESP32 dạng UNO?), chip USB-serial, bootloader, baud upload. Không phải ATmega328P thì C2 bị loại và phải viết board profile mới (là dữ liệu, cộng chi phí test).
2. **Schematic và driver motor:** schematic mạch UNO + control board, bảng **port → chân**. Driver motor là gì: IC nào, điều khiển kiểu EN/IN, PWM/DIR, I²C (vd. PCA9685), hay vi điều khiển phụ có protocol riêng.
3. **Thông số linh kiện:**
   - motor: RPM theo điện áp, tỉ số truyền, có encoder không;
   - bánh: đường kính, bề rộng;
   - pin/nguồn;
   - servo;
   - siêu âm;
   - line sensor: số mắt, analog/digital, cực tính.
4. **Bản vẽ cơ khí / CAD 3D** của robot (kích thước thân, vị trí cảm biến) và **quyền dùng** để dựng mô hình 3D.
5. **Phần mềm họ đang có:** library, firmware, Blockly block, code generator, uploader. Cần biết ai sở hữu, có source không, license gì, có cho tích hợp/sửa/dùng thương mại không.
6. **Sa bàn/mat in chuẩn:** họ có sẵn không (kích thước, độ rộng vạch, màu).

## 11. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Nhà cung cấp chậm | Kit tham chiếu. VG chỉ thay dữ liệu, loại module mới có giờ riêng. Diễn tập đổi kit ở R8 |
| Vật lý khó chịu (trượt, rung, không giống xe thật) | R0.1 so 3 mô hình drive, `lengthUnit`, tune solver. Dự phòng 2.5D sau cùng interface `World` |
| Máy trường học yếu, mạng chậm | Chunk lazy, WASM cache, tier thấp, top view 2D, đo khi throttle 4× |
| Lệch sim ↔ thật (motor lệch nhau, pin yếu, nhiễu) | Mặc định không nhiễu. Tham số hiệu chỉnh từ phép đo kit thật (VG/L3). `loop()` không có delay ẩn. Ngữ nghĩa int32 kiểu C++ |
| Hành vi Arduino đoán sai (timer, `pulseIn`) | UNKNOWN thì chặn. avr8js trace (R0.4, C2) là evidence |
| Mất tính tất định giữa trình duyệt | `dmath` bit-exact, Rapier deterministic, test hash trên 4 runtime |
| Kết quả check bị giả mạo (client gửi) | Server kiểm lesson/activity/template. `LabAttempt` đủ dữ liệu để tái lập. `verify-attempt.mjs`. Exam giữ `NeedsReview` |
| License | Rapier Apache-2.0, three/R3F/drei MIT, avr8js MIT (chỉ dev/test), `arduino-cli` GPL-3.0 **chỉ là tool** dev/CI (nếu M06 chạy trên server thì review riêng). Không GEARS. Không thư viện Arduino GPL trong code sinh ra. Mỗi driver khai báo library + license |
| Phình phạm vi | Ngoài phạm vi ghi ở §1. Mục ✂ đã chỉ rõ. Backlog sau pilot |

## 12. Ghi chú thực thi

- Chạy tự động theo task, không hỏi lại. Mỗi task có test tự động. Browser test chỉ một lần ở R8.
- Sau khi plan được duyệt:
  - lưu memory `n18-robot3d-plan` (trạng thái, đường dẫn plan trong repo, gate hiện tại) và thêm dòng vào `MEMORY.md`;
  - cập nhật memory `board-feature-request`: Yolo:Bit đóng băng, hướng mới là UNO.
- Thứ tự: R0 → G0 → R1 ∥ R2.1–R2.2 → R2.3 → R3 ∥ R4 (sau G1) → C1 → R5/R6 → R7 → R8 → C2 (nếu go).
