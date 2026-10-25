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
- `VirtualScheduler.advanceTo(tWorld)` resolve timer **từng cái một** theo thứ tự `(deadline, seq)`. Với mỗi timer: đặt `programClock = deadline`, rồi `await whenBlocked()`. Không có lateness: `repeat 100 { wait 10 }` kết thúc đúng 1000 ms ảo.
- Ở chế độ ảo, `budget.step()` kiểm **mọi** step (bỏ khoảng 256). Khi `programClock ≥ world.t + dt` thì program **park** (một waiter đặc biệt) cho tới tick sau. Nhờ vậy program không bao giờ chạy trước world quá một `dt`.
- "Blocked" là một trong ba: đăng ký `sleep`, đăng ký `park`, hoặc kết thúc. Yield housekeeping theo wall-clock không bao giờ tính là blocked.
- `sleep` và `park` reject khi `signal` abort.
- `createRuntimeServices` thêm option `budget?` để inject budget ảo.
- `loop()` của family `uno`: `loopPauseUs = 0`, mỗi vòng charge `LOOP_MIN_US = 50`. `ybc` giữ `loopPauseUs = 10000`, hành vi không đổi.

**Vòng tick**, với mỗi tick `dt = 1/120 s`:
1. `advanceTo(world.t)`: chạy program tới khi blocked.
2. Module model đọc chân rồi đặt mục tiêu actuator.
3. `world.step(dt)`.
4. Goal tracker cập nhật.
5. Phát snapshot nếu UI đang nghe.

**Chế độ chạy:**
- `realtime`: UI gọi `advance(wallMs × speed)` từ rAF. Lời gọi này **single-flight**: thời gian nợ được cộng dồn, tối đa 8 tick mỗi frame, vượt thì hiện badge "chậm hơn thời gian thực".
- `headless`: `runUntil(tEnd)`, nhường bằng `MessageChannel`, không dùng `setTimeout(0)` vì kẹp 4 ms và bị throttle khi tab ẩn.
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
  - `score`: trung bình điểm các biến thể;
  - `goal.passed` (gửi host): goal đó qua ở mọi biến thể.
- Key `rb-*` **không bao giờ đổi tên hay tái dùng**. Đổi hành vi thì tăng `version`.

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

**R3.4 Cảm biến (26h).**
- Files: `src/core/world/sensors/{ultrasonic.ts,line.ts,contacts.ts}`.
- Siêu âm: 5 tia hướng hằng số trong nón ±15°, lấy tia ngắn nhất, chỉ trúng collider `ultrasonic: true`, miền 2..400 cm, nhiễu seeded tuỳ chọn.
- Line: lấy mẫu chiếu xuống. Cao > 3 cm thì "không phản xạ".
- Tests:
  - `wall at 50 cm reads 50±1`;
  - `angled wall beyond cone reads 400`;
  - `robot falling off arena yields outOfArena and finite poses`.

**R3.5 World facade + snapshot + tất định (20h).**
- Files: `src/core/world/{world.ts,snapshot.ts}`, `tests/robot-determinism.test.ts`, `e2e/robot-determinism.spec.ts`.
- `playwright.config.ts` thêm project `firefox` và `webkit`, chỉ chạy spec này.
- `hashSnapshot(s): string`: FNV-1a trên số đã lượng tử 1e-6.
- Golden hash mỗi scenario ở `tests/__snapshots__/robot-determinism.json`. Đổi engine thì cố ý bump `ROBOT_ENGINE_VERSION`.
- Tests: `same seed twice → identical hash after 3000 ticks`; 4 runtime cho cùng hash.

**R3.6 RobotRunSession (16h).**
- Files: `src/core/run/robot-run-session.ts`. Services tạo bằng `createRuntimeServices({ signal, console, clock: programClock, sleep, yieldNow, scheduler: createRunScheduler(timers), budget, randomInt: createSeededRandomInt(seed), warn })`.
- Interface: `createRobotRunSession({ kit, board, scenario, registry }): RobotRunSession` với `start(project, variantIndex)`, `stop()`, `advance(wallMs, speed)` (single-flight), `runUntil(tS)`, `resetRobot()` (**dựng world mới** từ đầu), `getSnapshot()`, `subscribe()`. Giữ quy tắc reentrancy của `run-session.ts`.
- Tests:
  - `stop mid-tick publishes no further snapshot`;
  - `overlapping advance calls never run ticks concurrently`;
  - `resetRobot hash equals fresh start`.

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

**R5.3 Hướng dẫn soạn + in sa bàn (12h).** `docs/robot-scenario-authoring.md` (6h). ✂ (6h) `scripts/export-arena-mat.mjs` xuất PNG đúng tỉ lệ (150 dpi) để in sa bàn thật; nếu cần về 720h thì chuyển sang M06.

### R6 — Kiểm tra và chấm điểm (56h)

**R6.1 Goal library (22h).** Không dùng lại `check-run.ts`/`goal-tracker.ts` (hai file gắn wall-clock và goal ybc). `uses-block` dùng lại walk tĩnh `challenge/running-blocks.ts`. Mỗi kind ở `src/core/scenario/goals/*.ts` là `createGoal(spec) → { update(snapshot, dt): void; result(): GoalResult }`, với `GoalResult = { id; passed; points; progress: 0..1; reasonKey?: string; atS?: number }`. Tests theo từng kind, có case biên (chạm rồi rời vùng, checkpoint sai thứ tự).

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

**C2 avr8js parity harness (24h), nếu R0.4 = go.**
- Files: `tests/uno-emulator-parity.test.ts`, `scripts/build-parity-hex.mjs`. HEX fixture được commit kèm hash của `.ino` nguồn.
- So pin trace (IR + VirtualUno) với trace của HEX trên avr8js cho mọi driver và fixture ngôn ngữ. Lệch timing ≤ 1 %. Chạy trên Node, không cần tool ngoài.

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
