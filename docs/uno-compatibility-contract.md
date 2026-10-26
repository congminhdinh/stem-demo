# UNO Compatibility Contract

> **Version:** 0.1.7 (v0) · **Date:** 2026-10-25 · **Task:** N18 R0.3 · **Status:** v0: mọi construct được mở đã có evidence cho mọi field; L1 PASS bằng test của simulator (N18 final fix M4), L3 chờ M06.
> **Target snapshot (pin):** `arduino-cli 1.5.1`, FQBN `arduino:avr:uno`, core `arduino:avr@1.8.8` (2026-05-21), avr-gcc `7.3.0-atmel3.6.1-arduino7`, library `Servo 1.3.0` (2025-11-06, LGPL-2.1), emulator `avr8js@0.21.1` (2026-08-31, MIT). MCU giả định **ATmega328P, 16 MHz**. **Board chính xác: UNKNOWN** (§1).
> **Evidence:** spike R0.4 `spikes/avr8js/` (số liệu `spikes/avr8js/out/results.json`), ADR `docs/adr/0003-avr8js-parity.md`, ledger §14. **Bản máy đọc được:** `src/core/compat/uno-contract.ts` (§15).
> **Quan hệ tài liệu:** spec `docs/uno-robot-direction.md`, plan `docs/robot-3d-implementation-plan.md` (R0.3, R0.4; §4.1 board, §4.2 kit, §4.3 driver, §4.4 IR). Kỷ luật evidence theo `docs/yolobit-compatibility-contract.md` (§0, §15, §21). Từ R1, tài liệu này là **source of truth** cho hành vi của mọi block robot trong simulator và trong C++ Arduino sinh ra (C1, C2, R1, R2).

---

## 0. Status / evidence rules

### 0.1 Kết quả R0.3 (tóm tắt)

| Hạng mục | Kết quả |
|---|---|
| Construct được mở | 39 dòng (U-01…U-39): 31 dòng cho cả hai profile, 8 dòng chỉ Advanced (N19 thêm U-35…U-39 của xe tay gắp: 4 cho cả hai, U-39 chỉ Advanced). **Không dòng nào còn field UNKNOWN** (§10.1, test `uno-contract.test.ts`) |
| Không mở | 11 dòng (U-40…U-50): 8 EXCLUDED, 3 DEFERRED, mỗi dòng có lý do (§10.2) |
| Số học | `cxx-int32`: wrap, chia cắt về 0, `%` theo dấu số bị chia, `INT32_MIN / -1 = INT32_MIN`, `x % -1 = 0`, `x / 0 = x % 0 = 0` (+ cảnh báo). Generator **không bao giờ** viết toán tử thường lên giá trị của learner: avr-gcc gập tràn có dấu (§3) |
| Thứ tự toán hạng (0.1.3) | Toán hạng đánh giá trái sang phải, mỗi cái một lần, như simulator. C++ không cố định thứ tự đối số của lời gọi và toán hạng của so sánh; avr-gcc 7.3 đánh giá đối số **phải sang trái** (EMU-15). Hai lần đọc robot trở lên trong cùng biểu thức như vậy → generator gán từng lần đọc vào biến tạm `_s<k>` bằng toán tử phẩy (§3.5) |
| Timer bị chiếm | **Đã có trace** (thay UNKNOWN): Servo làm D9/D10 mất PWM (giữ LOW, cả sau `detach`); `tone` làm D3/D11 mất PWM và `analogWrite(11)` đổi tần số tone. Quyết định: từ chối `timer-claimed` (§5.3, U-48) |
| `costsUs` | Đo bằng cycle của avr8js (§4.4) |
| Ma trận L1/L2/L2e/L3 | §12: L1, L2 và L2e PASS cho mọi dòng mở (L1: test của simulator TST-01…TST-10, ruling L110, N18 final fix M4; L2/L2e của U-35…U-39: CC-06/EMU-19, sketch `gripper-forms`); L3 PENDING (M06) |
| Go/no-go C2 | **GO, có điều kiện** (ADR 0003 §7) |
| Parity C2 (0.1.4…0.1.7) | `tests/uno-emulator-parity.test.ts` (EMU-16): 28 fixture (14 golden ngôn ngữ C1, golden chân thô, 12 chương trình driver: mỗi driver op của `ref-uno-rover@0` ít nhất một lần và năm chương trình có sự kiện chân ngay sau `tone()`: literal, tính lúc chạy, vòng lặp một chỗ gọi literal ở 31, 121, 200 Hz; `negate-drive`) chạy trên simulator và bằng HEX của sketch sinh ra trên avr8js, cùng input kịch bản: mọi dòng Serial và trạng thái chân khớp; từng sự kiện chân và từng dòng Serial được tính giờ từ mốc nó phụ thuộc, phần chờ ±1 %, phần còn lại theo khác biệt được phép (dữ liệu: `tests/parity/allowed-differences.ts`, mỗi mục một dòng §13). L2e của **mọi** dòng mở (U-01…U-34) trích thêm EMU-16 (§12). N19 C2: thêm 5 fixture của `ref-uno-gripper@0` (`driver-gripper`, `driver-ir`, `driver-color`, `driver-color-nack`, `kit-gripper-all`; bus I²C có thời gian `tests/parity/twi-device.ts` gọi cùng model TCS34725 ở hai phía), 33 fixture; L2e của U-35…U-39 cũng trích EMU-16. Virtual UNO charge phần tính của `motorSet` (lâu nhất đo được) và `tone()` theo băng tần số, đo trên sketch sinh ra (§4.4, EMU-17, EMU-18) |

### 0.2 Nhãn

Chỉ dùng **VERIFIED, DOCUMENTED, UNKNOWN, n/a**. Contract UNO **không** dùng INFERRED và **không** có lối mở UNVERIFIED của Yolo:Bit N17: một dòng chỉ được mở bằng evidence.

| Ký hiệu | Nhãn | Nguồn |
|---|---|---|
| `V·E` | VERIFIED | **Trace avr8js** của HEX do mình compile từ sketch **của mình** (EMU). Chỉ cho claim `emu-trace` (§0.4) |
| `V·C` | VERIFIED | **arduino-cli** với sketch của mình (CC): compile được, kích thước, disassembly |
| `D·A` | DOCUMENTED | Arduino reference (nguồn `github.com/arduino/reference-en`) và tài liệu library Servo 1.3.0 đã cài, trích nguyên văn |
| `D·S` | DOCUMENTED | Datasheet Microchip DS40002061A (ATmega328P), trích nguyên văn |
| `D·X` | DOCUMENTED | C++ working draft (`eel.is/c++draft`) và GCC 7.3 manual, trích nguyên văn (claim `documented` hoặc `language`) |
| `U` | UNKNOWN | Chưa xác lập. Dòng có field UNKNOWN không được mở |
| `–` / `–ᴰ` / `–ᴱ` | n/a | Không áp dụng / ngoài domain (literal → lỗi compile, giá trị tính ra → `out-of-domain`) / generator luôn truyền tường minh |

Một field DOCUMENTED có thể kèm **corroboratedBy** (evidence cùng chiều nhưng field không phụ thuộc). Các dòng ngôn ngữ (U-01…U-18) được xác lập bằng tài liệu C++/Arduino và compile; trace avr8js chỉ **xác nhận thêm**. Nhờ vậy chúng vẫn đứng nếu evidence avr8js bị thu hồi (§0.4).

### 0.3 Phương pháp

| Được dùng | Không dùng |
|---|---|
| Sketch **của mình** (15 sketch, `spikes/avr8js/sketches/`), compile bằng toolchain đã pin, chạy HEX trong avr8js trên Node, ghi chân + byte USART kèm cycle | Code của vendor kit / GEARS; firmware của board lạ; asset có thương hiệu |
| Tài liệu public (Arduino reference, Servo docs, datasheet, C++ draft, GCC manual), tải và trích nguyên văn ngày 2026-10-25 | Suy diễn "trông hiển nhiên" thành VERIFIED |
| Đọc source core/library đã pin (LGPL) để **thiết kế** sketch đo, và `avr-objdump` HEX của mình | Source core/library làm nguồn của claim (claim đi từ trace hoặc tài liệu) |

Mọi con số trong contract là số **đo** (ADR 0003 §2: máy, lệnh tái lập), không ước lượng. Số nào là chính sách của simulator (ví dụ `LOOP_MIN_US`) thì ghi rõ là chính sách.

### 0.4 Ranh giới evidence của emulator (RV-U1 = ACCEPT WITH RESTRICTIONS)

avr8js mô phỏng CPU theo tập lệnh và các ngoại vi Timer0/1/2, GPIO, USART, ADC; nó **không** phải board vật lý. Ranh giới là luật, mã hoá trong `UNO_EVIDENCE_SCOPE` và `UNO_FIELD_CLAIM_KINDS` (`contract-types.ts`):

| Kind | Được đỡ claim | Không bao giờ |
|---|---|---|
| EMU | `emu-trace`: mức chân, thứ tự và thời gian (theo cycle) của chương trình đã compile, giá trị chương trình tính ra | `physical-range`, `electrical`, `physical-timing`, `firmware-identity` (board thật có phải ATmega328P không) |
| CC | `compile-ok`, `compile-size`, `disassembly` | thời gian chạy, giá trị chạy |
| ARD, DS | `documented` | |
| CXX | `documented`, `language` | |
| PKG | (chỉ `snapshot`) | |
| TST | (chỉ `sim-semantic`: evidence của mức L1, §12) | mọi field: test cho biết simulator làm đúng contract, không cho biết board làm gì |

Hệ quả:
- Field mà mọi nguồn của một claim đều là EMU là **emulator-dependent** (cột cuối §10.1, suy ra, không viết tay).
- **Nếu RV-U1 bị thu hồi** (ví dụ C2 phát hiện avr8js sai ở chỗ quan trọng): mọi dòng module/chân (U-19…U-39) mất field và bị loại; ngôn ngữ, in, chờ (U-01…U-18) vẫn đứng (test "would keep the language and drop every module and pin row").
- Khác biệt đã biết giữa avr8js và datasheet (ADR 0003 §6) **không** được dùng làm claim về board: Timer0 duty v/256 vs (v+1)/256; USART 1044,17 vs 1040 µs/byte; hàng 64 vs 65 byte; không có pull-up.

### 0.5 Luật áp dụng

- **EG:** dòng learner thấy được chỉ mở khi mọi field VERIFIED/DOCUMENTED/n/a với nguồn được phép (§0.4). Validator dùng **cùng một hàm** cho Yolo:Bit và UNO (`contract-validation.ts`, `rulesOf(contract)`).
- **Domain guard:** giá trị tính ra ngoài domain → simulator dừng `out-of-domain` (có `blockId`): từ chối mô phỏng, không phải ngữ nghĩa.
- **Kẹp:** đối số module ngoài khoảng (tốc độ, góc, Hz, ms, PWM) **bị kẹp** kèm cảnh báo `value-clamped` một lần mỗi role (chân) mỗi run; generator viết sẵn literal đã kẹp; với giá trị tính ra, helper C++ kẹp đúng như simulator (plan §4.4).

---

## 1. Target board / toolchain snapshot

| Mục | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Compile | `arduino-cli 1.5.1`, `--fqbn arduino:avr:uno` | V·C | CC-01, PKG-01 |
| Core | `arduino:avr@1.8.8` (phát hành 2026-05-21), LGPL-2.1 | V·C | CC-01, PKG-01 |
| Toolchain | avr-gcc `7.3.0-atmel3.6.1-arduino7`; cờ `-Os -flto -std=gnu++11 -fpermissive -fno-exceptions -ffunction-sections -fdata-sections -fno-threadsafe-statics` | V·C | CC-01 (`platform.txt` của core) |
| Library | `Servo 1.3.0` (phát hành 2025-11-06), LGPL-2.1, thư mục user | V·C | CC-01, PKG-01 |
| Emulator | `avr8js@0.21.1` (phát hành 2026-08-31), MIT | — | PKG-01 |
| MCU | ATmega328P 16 MHz, flash 32 256 B dùng được (32 KB − bootloader), RAM 2048 B | V·C | CC-01 ("Maximum is 32256 bytes", "Maximum is 2048 bytes") |
| Board chính xác (MCU thật, chip USB-serial, bootloader) | **UNKNOWN** | U | plan §10 câu 1 (hỏi nhà cung cấp, R0.5) |

Mọi version đều ≥ 2 tuần tuổi tính tới 2026-10-25 (test kiểm). Đổi bất kỳ version nào là đổi contract (version mới, chạy lại `node spikes/avr8js/run-all.mjs` và `pnpm build:parity-hex`).

**Tuyên bố pin:**

> The exact board (MCU, USB-serial chip, bootloader) is UNKNOWN; this contract is pinned to arduino-cli 1.5.1, arduino:avr@1.8.8, Servo 1.3.0 and avr8js 0.21.1 for an ATmega328P at 16 MHz as of 2026-10-25, and is not a timeless compatibility guarantee.

Nếu board thật không phải ATmega328P, mọi field `V·E` mất giá trị cho board đó và C2 không áp dụng (plan §10 câu 1).

---

## 2. Cấu trúc sketch, include, module

### 2.1 Thứ tự (C1, frozen)

header comment (scenario, kit@version) → `#include` → `#define` chân từ kit (`MOTOR_LEFT_EN 5`, …) → global (`long` của learner, `Servo <role>;`) → helper (§3.2, §6, chỉ những cái được dùng, mỗi cái một lần) → hàm của learner (DEFERRED, U-42) → `setup()` → `loop()`. `spikes/avr8js/sketches/contract-forms/contract-forms.ino` là một sketch đúng thứ tự này (CC-03, EMU-13). N19 (A5): dạng C++ của xe tay gắp (`ref-uno-gripper@0`, U-35…U-39) nằm trong sketch riêng `spikes/avr8js/sketches/gripper-forms/gripper-forms.ino` (CC-06, EMU-19), vì `contract-forms.ino` là của `ref-uno-rover@0` và dùng A4 (PC4) làm mốc thời gian, mà A4 là SDA của cảm biến màu.

### 2.2 Module (tách khả dụng khỏi cú pháp include)

| ID | Module | Include | Library | `import` | `module` | Eligibility |
|---|---|---|---|---|---|---|
| U-M1 | Arduino AVR core | không (build `.ino` tự include `Arduino.h`) | `arduino:avr@1.8.8`, LGPL-2.1 | – | V·C (CC-03, corroborated CC-01) | ELIGIBLE |
| U-M2 | Servo | `#include <Servo.h>` | `Servo@1.3.0`, LGPL-2.1 | V·C (CC-03) | V·C (CC-03, CC-01) | ELIGIBLE |
| U-M3 | Wire (N19) | `#include <Wire.h>` | `Wire@1.0` có sẵn trong `arduino:avr@1.8.8`, LGPL-2.1-or-later (header của `Wire.cpp`, `twi.c`) | V·C (CC-06) | V·C (CC-06, corroborated ARD-18) | ELIGIBLE |

Không có library GPL. `scripts/check-arduino.mjs` (C1) cài đúng `name@version` từ `cpp.libraries` của các dòng được dùng; Wire 1.0 đi kèm core nên được tính là đã cài (`arduino-cli lib list --all`), không bao giờ cài từ index.

### 2.3 Dạng C++ của từng dòng

Placeholder `<…>` như dạng Python của contract Yolo:Bit; `<ROLE>_PIN` là `#define` sinh từ kit; dòng `setup` được viết **một lần** ở đầu `setup()`, theo thứ tự các dòng xuất hiện:

| ID | `cpp.form` (⏎ = xuống dòng) | Helper | Dòng setup |
|---|---|---|---|
| U-01 | `void setup() {⏎  <setup lines>⏎  <body>⏎}` | — | — |
| U-02 | `void loop() {⏎  <body>⏎}` | — | — |
| U-03 | `long <name> = 0L; · <name> = <expr>;` | — | — |
| U-04 | `<n>L` · variant `(-2147483647L - 1L)` (INT32_MIN, §3.1) | — | — |
| U-05 | `add32(<a>, <b>) · sub32(<a>, <b>) · mul32(<a>, <b>)` · variant `(_s<k> = <read>, … <expr>)`, `long _s<k>;`, `bool _s<k>;` (§3.5) | int32 | — |
| U-06 | `div32(<a>, <b>)` · variant như U-05 (§3.5) | int32 | — |
| U-07 | `mod32(<a>, <b>)` · variant như U-05 (§3.5) | int32 | — |
| U-08 | `neg32(<a>)` | int32 | — |
| U-09 | `(<a> < <b>) · (<a> <= <b>) · (<a> > <b>) · (<a> >= <b>) · (<a> == <b>) · (<a> != <b>)` · variant như U-05 (§3.5) | — | — |
| U-10 | `(<a> && <b>) · (<a> \|\| <b>) · !(<a>) · true · false` | — | — |
| U-11 | `if (<c>) {⏎  <body>⏎} else if (<c2>) {⏎  <body2>⏎} else {⏎  <body3>⏎}` | — | — |
| U-12 | `{ const long _n = (<count>); for (long _r = 0L; _r < _n; _r += 1L) { <body> } }` | — | — |
| U-13 | `while (<c>) {⏎  <body>⏎}` | — | — |
| U-14 | `{ const long _from = (<start>); const long _to = (<end>); for (long _c = _from; _c <= _to; _c += 1L) { <var> = _c; <body> } }` | — | — |
| U-15 | `Serial.println(<expr>);` | — | `Serial.begin(9600);` |
| U-16 | `Serial.println(F("<text>"));` | — | `Serial.begin(9600);` |
| U-17 | `Serial.print(<part>); … Serial.println(<last>);` · variant `Serial.print(F("<text>"));` (phần chữ) | — | `Serial.begin(9600);` |
| U-18 | `delay(<ms>);` | — | — |
| U-19 | `(long)millis()` | — | — |
| U-20 | `motorSet(<ROLE>_EN, <ROLE>_IN1, <ROLE>_IN2, <speed>);` | hbridge-en-in1-in2 | `pinMode(<ROLE>_EN, OUTPUT);` `pinMode(<ROLE>_IN1, OUTPUT);` `pinMode(<ROLE>_IN2, OUTPUT);` |
| U-21 | `{ const long _s = (<speed>); motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, <_s\|neg32(_s)>); motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, <_s\|neg32(_s)>); }` | hbridge-en-in1-in2, int32 | — |
| U-22 | `motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 0L); motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, 0L);` | hbridge-en-in1-in2 | — |
| U-23 | `servoSet(<role>, <angle>);` | servo-lib | `<role>.attach(<ROLE>_PIN);` `<role>.write(90);` |
| U-24 | `digitalWrite(<ROLE>_PIN, (<on>) ? HIGH : LOW);` | — | `pinMode(<ROLE>_PIN, OUTPUT);` |
| U-25 | `buzzerTone(<ROLE>_PIN, <hz>, <ms>);` · variant `(_s<k> = <read>, … buzzerTone(<ROLE>_PIN, <hz>, <ms>));` (§3.5) | buzzer-tone | — |
| U-26 | `noTone(<ROLE>_PIN);` | — | — |
| U-27 | `ultrasonicCm(<ROLE>_TRIG, <ROLE>_ECHO)` | hcsr04-pulsein | `pinMode(<ROLE>_TRIG, OUTPUT);` `pinMode(<ROLE>_ECHO, INPUT);` |
| U-28 | `(digitalRead(<ROLE>_PIN) == <LOW\|HIGH>)` | — | `pinMode(<ROLE>_PIN, INPUT);` |
| U-29 | `(long)analogRead(<ROLE>_PIN)` | — | — |
| U-30 | `(digitalRead(<ROLE>_PIN) == LOW)` | — | `pinMode(<ROLE>_PIN, INPUT_PULLUP);` |
| U-31 | `digitalWrite(<pin>, (<v>) ? HIGH : LOW);` | — | `pinMode(<pin>, OUTPUT);` |
| U-32 | `pwmWrite(<pin>, <value>);` | pwm-write | — |
| U-33 | `(digitalRead(<pin>) == HIGH)` | — | `pinMode(<pin>, <mode>);` (`<mode>` của driver module nối vào chân: nút `INPUT_PULLUP`, line/echo `INPUT`) |
| U-34 | `(long)analogRead(<pin>)` | — | — |
| U-35 | `gripperSet(<role>Claw, <angle>);` (khối mở/đóng viết literal 0/80) | gripper-servo2 | `<role>Claw.attach(<ROLE>_CLAW);` `<role>Claw.write(0);` `<role>Lift.attach(<ROLE>_LIFT);` `<role>Lift.write(90);` (global `Servo <role>Claw;` `Servo <role>Lift;`) |
| U-36 | `gripperSet(<role>Lift, <angle>);` (khối nâng/hạ viết literal 90/0) | gripper-servo2 | như U-35 |
| U-37 | `(digitalRead(<ROLE>_PIN) == <LOW\|HIGH>)` (mức theo `activeLow` của kit, mặc định LOW) | — | `pinMode(<ROLE>_PIN, INPUT);` |
| U-38 | `colorIs(<value>)` (`<value>`: chỉ số màu 0…6, literal do khối cố định) | tcs34725-wire | `colorBegin();` (global `uint16_t colorC/colorR/colorG/colorB = 0;`, `#include <Wire.h>`) |
| U-39 | `colorRaw(<value>)` (`<value>`: kênh 0 đỏ, 1 xanh lá, 2 xanh dương, 3 tổng C) | tcs34725-wire | như U-38 |

---

## 3. Mô hình số `cxx-int32` và ngôn ngữ

### 3.1 Luật (frozen)

| Luật | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Kiểu duy nhất | `long` (int32): −2 147 483 648 … 2 147 483 647 | D·A + V·E | ARD-09, EMU-10 |
| Literal | luôn có hậu tố `L` (`300L`); `int` của AVR là 16 bit: `300 * 200` = −5536 trên board | D·A + V·E | ARD-09, ARD-10, EMU-10, CC-01 (warning `-Woverflow`) |
| `INT32_MIN` literal | `(-2147483647L - 1L)`: `2147483648L` không vừa `long` nên biểu thức thành `long long` | D·X | CXX-04 |
| `+ − ×`, đổi dấu | **wrap** mod 2³² qua helper `add32`/`sub32`/`mul32`/`neg32` | D·X (+ V·E) | CXX-02, CXX-03; EMU-11, EMU-13 |
| `/` | cắt về 0 (`-7/2 = -3`); `INT32_MIN / -1 = INT32_MIN`; `x / 0 = 0` + cảnh báo `division-by-zero` | D·X (+ V·E) | CXX-01; EMU-10, EMU-13 |
| `%` | theo dấu số bị chia (`-7%2 = -1`, `7%-2 = 1`); `x % -1 = 0` (cả `INT32_MIN % -1`); `x % 0 = 0` + cảnh báo | D·X + D·A (+ V·E) | CXX-01, ARD-15; EMU-10, EMU-13 |
| So sánh, `&&` `\|\|` `!` | kết quả `bool`; `&&`/`\|\|` short-circuit | D·X | CXX-05 |
| Bool lưu vào biến / đem tính | 1 / 0 | D·X | CXX-03, CXX-06 |
| Bool in ra | `1` / `0` (Print không có overload `bool`) | D·A + D·X (+ V·E) | ARD-14, CXX-06; EMU-10 |
| Float | **không có** (Basic lẫn Advanced v0, U-40) | — | — |
| Chuỗi | chỉ để in, `F("…")` trong flash (U-16); không biến chữ (U-41) | D·A | ARD-14 |

Simulator (`valuesFor('cxx-int32')`, R2.3): `(a + b) | 0`, `(a - b) | 0`, `(-a) | 0`, và **`Math.imul(a, b)`** cho `×` (không phải `(a * b) | 0`: tích vượt 2⁵³ mất bit thấp, `(2147483647 * 2147483647) | 0` ra 0 trong khi board ra 1), `Math.trunc` cho `/`, `%` của JS (đã theo dấu số bị chia), `-0 → 0`; `b === -1` và `b === 0` theo bảng trên. Cùng kết quả với helper trên mọi cặp int32 (EMU-10/11/13 so với mô hình JS trong `run-lang.mjs`).

### 3.2 Vì sao luôn dùng helper (evidence R0.4)

Arduino tự nói: "The result of an overflow is unpredictable" (ARD-10). avr-gcc 7.3 `-Os -flto` coi tràn có dấu là không xảy ra: `x + 1L > x` với `x = INT32_MAX` ra **1**, `(h * 2L) / 2L` với `h = 2³⁰` ra **h** (EMU-10). Simulator nói 0 và −2³⁰. Nên:

- Generator **không bao giờ** viết `+ - * / %` hay `-` một ngôi thường lên giá trị của learner. Toán tử thường chỉ dùng trên biến tạm của chính generator khi chắc chắn không tràn (`_r += 1L`, `_c += 1L` trong domain, phép tính trong helper sau khi kẹp).
- Khi chương trình không có tràn có dấu nào, helper `unsigned` cho đúng wrap (EMU-11). Nếu chương trình **có** một phép tràn thường trong cùng hàm, GCC có thể gộp giá trị và cả helper cũng sai (bẫy CSE, EMU-10/11): đó là lý do luật trên tuyệt đối.
- `#pragma GCC optimize("wrapv")` cũng cho kết quả đúng (EMU-11) nhưng bị loại: "This attribute should be used for debugging purposes only. It is not suitable in production code." (CXX-08).

Helper `int32` (generator viết nguyên văn; giống hệt `contract-forms.ino`, test kiểm):

```cpp
long add32(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }
long sub32(long a, long b) { return (long)((unsigned long)a - (unsigned long)b); }
long mul32(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }
long neg32(long a) { return (long)(0UL - (unsigned long)a); }
long div32(long a, long b) { return b == -1L ? neg32(a) : (b == 0L ? 0L : a / b); }
long mod32(long a, long b) { return (b == -1L || b == 0L) ? 0L : a % b; }
```

### 3.3 Count up (U-14): thứ tự đánh giá như contract Yolo:Bit §3.3

```cpp
{ const long _from = (<start>); const long _to = (<end>); for (long _c = _from; _c <= _to; _c += 1L) { <var> = _c; <body> } }
```

- `start` được đánh giá **trước**, rồi `end`, mỗi cái **đúng một lần**, trước vòng lặp; bước 1. Hai khai báo là hai full-expression liên tiếp (CXX-07); trace: `eval=start`, `eval=end` (EMU-10, EMU-13).
- **Lệch so với dạng trong brief R0.3** (`{ const long _to = (b); for (long _c = (a); …) }`): dạng đó đánh giá `end` **trước** `start` (EMU-10 in `eval=end`, `eval=start`), trái với yêu cầu "giữ thứ tự đánh giá như contract Yolo:Bit §3.3". Contract chọn thứ tự (ngữ nghĩa quan sát được) và thêm `_from`.
- `<var>` nhận từng giá trị; sau vòng giữ giá trị cuối, hoặc giá trị cũ nếu `start > end` lúc chạy (0 vòng).
- Domain: `end ≤ 2 147 483 646` (để `_c += 1L` không bao giờ tràn): literal → lỗi compile `value-out-of-range`; tính ra → `out-of-domain` ngay sau khi đánh giá `end`. Literal `start > end` → `descending-range-not-supported` (như Yolo:Bit). `start` không bị giới hạn.
- Thân đổi biến mà `end` lấy từ đó không ảnh hưởng: `end` đã đọc một lần (EMU-10 "count (end read once)=3").
- Count up lồng nhau: mỗi cái trong block riêng, `_from`/`_to`/`_c` che nhau; biểu thức của learner không bao giờ nhắc tới tên tạm.

### 3.4 Repeat (U-12), while (U-13), if (U-11)

- `repeat N`: `{ const long _n = (<count>); for (long _r = 0L; _r < _n; _r += 1L) { <body> } }`; N đánh giá một lần; `N ≤ 0` → 0 vòng; không có domain (`_r < _n ≤ INT32_MAX`).
- `while (<c>) { … }`, `if / else if / else`: C++ thường. **Không có delay ẩn** ở đâu cả.

### 3.5 Thứ tự toán hạng và dạng tuần tự (0.1.3, C1)

**Luật.** Mọi toán hạng được đánh giá **trái sang phải, mỗi cái đúng một lần**, theo thứ tự depth-first của simulator (interpreter: trái rồi phải ở `+ − × // %` và so sánh, đối số của lời gọi module theo thứ tự).

**C++ không cố định thứ tự đó.**
- "The initialization of a parameter … is indeterminately sequenced with respect to that of any other parameter."
- "Except where noted, evaluations of operands of individual operators and of subexpressions of individual expressions are unsequenced." (CXX-10)
- avr-gcc 7.3 (`-Os -flto`, gnu++11) đánh giá đối số của lời gọi **phải sang trái**: `add32(se(1L), se(2L))` in `eval=2` rồi `eval=1`; `f3(10, se(7L), se(8L))` in 8 rồi 7. Riêng so sánh này thì trái sang phải (EMU-15).
- Biểu thức nào chỉ đọc biến và literal thì không sao: không có gì trong biểu thức ghi biến của learner. Lần đọc robot (module read, `millis`, chân thô) thì khác.

**Dạng tuần tự.** Một vùng là phần của biểu thức mà C++ để toán hạng không tuần tự: đối số của helper `add32…mod32`, hai vế của so sánh, xuyên qua `!`. Đơn vị của vùng là những gì trong vùng đọc robot: một lần đọc, hoặc một `&&` / `||` có đọc (lấy **nguyên khối**).
- Vùng có **hai đơn vị trở lên**: mỗi đơn vị được gán, theo thứ tự depth-first trái sang phải, vào biến tạm `_s<k>` bằng toán tử phẩy. Phần còn lại của biểu thức tính trên biến tạm:

  ```cpp
  Serial.println((_s1 = (long)analogRead(LINE_LEFT_PIN), _s2 = (long)analogRead(LINE_RIGHT_PIN), sub32(_s1, _s2)));
  ```

  "A pair of expressions separated by a comma is evaluated left-to-right; … The left expression is sequenced before the right expression" (CXX-09). Trace: `(_s1 = se(1L), _s2 = se(2L), add32(_s1, _s2))` in `eval=1`, `eval=2` (EMU-15).
- Biến tạm khai báo **`long _s<k>;`** (hoặc **`bool _s<k>;`** cho đơn vị bool) ở đầu `setup()` (sau các dòng setup) hoặc đầu `loop()`. Mỗi biến một lần, đánh số theo thứ tự lấy, riêng cho từng hàm. Learner không thể có tên `_s<k>` (`names.ts`).
- Vì vẫn là **một biểu thức**, dạng này được đánh giá lại đúng mỗi lần: điều kiện `while`, nhánh `else if` chỉ đánh giá khi tới (EMU-15: `while ((_s1 = se(x), _s2 = se(2L), (_s1 < _s2)))` đọc cả hai mỗi vòng).
- **`&&` và `||` giữ nguyên**: C++ tuần tự chúng trái sang phải và bỏ vế phải đúng như simulator (CXX-05, EMU-15), nên vế phải bị bỏ thì không đọc, không tốn thời gian. Không kéo lần đọc ra khỏi chúng. Mỗi vế là một vùng riêng. Khi chính `&&`/`||` nằm trong vùng có đơn vị khác, nó được gán nguyên khối: `(_s1 = (A && B), _s2 = C, (_s1 == _s2))`.
- Lời gọi có hai đối số giá trị (`buzzerTone`, U-25): hai đối số là một vùng. Khi có hai đơn vị trở lên thì bọc cả lời gọi: `(_s1 = <read>, _s2 = <read>, buzzerTone(BUZZER_PIN, _s1, _s2));`. Lời gọi một đối số (motor, servo, PWM, `const long _s` của drive) thì tuần tự bên trong đối số đó.
- Chỉ một đơn vị (hoặc không có): viết như cũ, cho dễ đọc. Phần của join (mỗi phần một `Serial.print`), bound của count up (`_from`, `_to`) và mỗi câu lệnh đã là full-expression riêng (CXX-07).
- Evidence: CC-05 (compile `--warnings all`, không warning của sketch), EMU-15 (trace). Dạng nằm trong allowlist (`cpp.variants` của U-05, U-06, U-07, U-09, U-25).

---

## 4. Chương trình và thời gian

### 4.1 `setup()` / `loop()` (U-01, U-02)

- "khi bắt đầu" → thân trong `setup()` (chạy một lần sau mỗi lần cấp nguồn/reset, ARD-11).
- "lặp mãi" → thân trong `loop()`. **Không có forever thì `loop()` rỗng**: board vẫn có nguồn, core vẫn gọi `loop()`, các output giữ nguyên như `setup()` để lại (PWM, xung servo vẫn chạy: EMU-02, EMU-06).
- `loop()` **không có delay ẩn**: vòng rỗng trên board là 5 cycle = 0,3125 µs (EMU-08). Khác Yolo:Bit (`time.sleep_ms(10)` cuối mỗi vòng).

### 4.2 Chính sách của simulator (không phải hành vi board)

| Hằng | Giá trị | Ý nghĩa |
|---|---|---|
| `LOOP_MIN_US` | **50** | Mỗi vòng `loop()` charge ít nhất 50 µs (`loopPauseUs = 0`, plan §3). Board chạy nhanh hơn ~160×: **số vòng mỗi giây không phải observable parity** (L1 ≠ L2e) |
| `NODE_US` | 1 | Mỗi node IR charge 1 µs (plan §3) |

### 4.3 `delay` và `millis`

- `delay(ms)` (U-18): domain `0 ≤ ms ≤ 60000`; board chờ `ms × 1000 µs + 5,06…13,19 µs` (trung vị +8,56, EMU-01/08); simulator charge `ms × 1000 + costsUs.delayOverhead` (8,5625).
- `millis()` (U-19, Advanced): `(long)millis()`. Board: Timer0 tràn mỗi 1024 µs, mỗi lần +1 ms và mang 3/125 ms (ISR của `wiring.c`), nên
  `millis(t) = n + floor(3n / 125)`, `n = floor(t / 1024)`, `t` = µs kể từ đầu `setup()`.
  **250/250 lần đọc khớp** (EMU-12; Timer0 bắt đầu 0–7,9 µs trước `setup()`). Simulator tính đúng công thức này (không phải `floor(t/1000)`), nên giá trị khớp board. So với thời gian thật, `millis()` chậm 0,47…2,45 ms.
- Cast `(long)`: so `long` âm với `millis()` không cast thì `long` bị đổi thành unsigned (`-1 < millis()` ra 0 trên board, EMU-10). Wrap sang âm sau 2³¹ ms (24,8 ngày), ngoài mọi run.

### 4.4 Bảng `costsUs` (µs; đo, cycles/16, ADR 0003 §4)

Virtual UNO (R1.3) `charge(costsUs[call])` cho mỗi lời gọi Arduino mà driver/IR thực hiện. Giá trị là **mẫu nhỏ nhất** của 8 mẫu trong sketch `costs` (chương trình lớn, lời gọi không bị gập), evidence `EMU-08` (+ `EMU-03`, `EMU-13` cho `pulseIn`/siêu âm):

| `ArduinoCall` | µs | Đo | Biến thể / ghi chú |
|---|---|---|---|
| `pinMode` | 4,375 | 70 cycle | OUTPUT |
| `pinModeInputPullup` | 4,75 | 76 cycle | |
| `digitalWrite` | 4,5625 | 73 cycle | LOW 71 cycle; chân không timer |
| `digitalWriteTimerPin` | 5,625 | 90 cycle | chân có timer (`turnOffPWM`; đo D5) |
| `digitalRead` | 3,9375 | 63 cycle | chân không timer (đo D4 và A1) |
| `digitalReadTimerPin` | 5,0625 | 81 cycle | chân có timer: D3, D5, D6, D9, D10, D11 (đo D11) |
| `analogRead` | 105,8125 | 1693 cycle | 13 chu kỳ ADC × 128 + overhead |
| `analogReadFirst` | 201,8125 | 3229 cycle | lần đầu của run: 25 chu kỳ ADC (DS-01) |
| `analogWrite` | 7,6875 | 123 cycle | 1..254 trên chân PWM (Timer2: 127 cycle) |
| `analogWriteDigital` | 11,875 | 190 cycle | chân không PWM; giá trị 0 / 255: 178 / 186 cycle |
| `millis` | 1,1875 | 19 cycle | |
| `delayOverhead` | 8,5625 | | thêm vào `ms × 1000` (5,06…13,19) |
| `servoWrite` | 49,5 | 792 cycle | |
| `tone` | 174,0625 | 2785 cycle | có duration (helper luôn truyền), chân đang kêu, 1000 Hz; không duration 2145 cycle. Từ 0.1.5 virtual UNO charge theo băng tần số (bảng `toneUs` dưới), khoá này chỉ cho `tone` lên chân khác khi một tone đang kêu (không có tác dụng, ARD-03) |
| `noTone` | 6,375 | 102 cycle | |
| `pulseInAfterPulse` | 3,25 | trung vị | từ khi echo hết tới khi trả (2,625…3,3125) |
| `pulseInNoPulse30000` | 20 752 | 332 032 cycle | không có xung, timeout 30000: vòng chờ 11 cycle × 30000 + ngắt (CC-04); có Servo: 20 785,44 |
| `ultrasonicCmOverhead` | 65,5625 | | cả helper trừ (chờ echo + độ rộng): trigger, `pulseIn`, chia 58 |
| `ultrasonicCmNoEcho` | 20 812 | | cả helper khi không có echo (có Servo) |
| `motorSetOverhead` (0.1.5…0.1.7) | 43,6875 | | phần tính của helper `motorSet` ngoài 3 lời gọi Arduino: `(abs(speed) · 255 + 50) / 100` bằng nhân/chia `long` của libgcc, giữa IN2 và EN; thời gian phép chia tuỳ giá trị: lâu nhất của mọi speed −100…100 (0.1.7, quét đủ; speed −75 và −97: `motorSet` 60,5 µs = 2 × 4,5625 + 7,6875 + 43,6875); speed 50: 58,875 µs (42,0625), mọi speed khác trên đường PWM 58,875…60,5 µs; 0 và ±100 (đường `digitalWrite`): 61,25 / 63,25 / 63,75 µs (EMU-17) |
| `serialWriteByte` | 4,625 | 74 cycle | 1 byte vào hàng rỗng |
| `serialQueueByte` | 6,28125 | | mỗi byte của `print(F(…))` khi hàng còn chỗ (đo 6,283) |
| `serialLineByte` | 1040 | | một khung 10 bit ở 9615 baud (UBRR0 = 207, U2X); avr8js đo 1044,17 |
| `serialPrintLongBase` + `serialPrintLongDigit` × d | 9,375 + 45,1875 × d | fit 1/5/10 chữ số | lệch ≤ 1,1 % (5 chữ số: đo 232,69, fit 235,3) |
| `serialPrintLongSign` | 6,8125 | 109 cycle | dấu trừ |
| `serialPrintln` | 17,25 | 276 cycle | `\r\n` |

**N19 (A2/A3, EMU-20; A5 đưa vào ledger):** 13 khoá của xe tay gắp, đo trong `sketches/gripper-costs` (mẫu nhỏ nhất trừ baseline, như EMU-08) và `run-gripper-timeline.ts` (chỗ bus bắt đầu trong helper):

| `ArduinoCall` | µs | Ghi chú |
|---|---|---|
| `gripperSet` | 51,625 | lâu nhất của kẹp 45, tay 45, 120 (kẹp về 90) và -5 (về 0); `Servo.write` 50,4375 trong đó |
| `colorWrite` / `colorWriteNack` | 334 / 144,9375 | một lần ghi thanh ghi (START, địa chỉ, lệnh, giá trị, STOP); không thiết bị: NACK địa chỉ |
| `colorBegin` / `colorBeginNack` | 1350,5625 / 589,4375 | đã trừ `delay(3)` và `delay(54)` như simulator charge (ms × 1000 + `delayOverhead`); tổng 58 367,6875 / 57 606,5625 |
| `colorFetch` / `colorFetchNack` | 1158,5 / 146,0625 | một lần đọc C, R, G, B (8 byte auto-increment); bus 1030 µs trong đó |
| `colorClassify` / `colorClassifyZero` | 147,25 / 12,5625 | lâu nhất theo luật khớp (vàng); tổng r + g + b = 0 thì không chia |
| `wirePhase` | 4,9375 | dịch vụ của Wire trước mỗi pha bus (ngắt TWI và lần ghi TWCR kế tiếp; 79 cycle giữa hai byte đọc) |
| `colorWriteLead`, `colorFetchLead`, `colorFetchGap` | 11,625, 9,1875, 10,5625 | câu lệnh của helper trước dịch vụ đầu tiên của Wire, và của `colorFetch` giữa lệnh ghi và lần đọc |

Bus I²C của virtual UNO có thời gian (plan N19 §4.7): mỗi pha = `wirePhase` + số chu kỳ SCL ở 100 kHz (START/STOP 1, byte 9); model TCS34725 được gọi ở thời điểm của từng sự kiện. `digitalRead(A3)` của IR là khoá `digitalRead` có sẵn (3,9375 µs, EMU-20 đo lại).

**Virtual UNO (R1.3, `src/core/hardware/virtual-uno.ts`)** charge mỗi lời gọi bằng khoá của bảng này (bản sao trong `uno-r3.board.json`, test so với contract): `digitalWrite`/`digitalRead` lấy biến thể `…TimerPin` trên D3, D5, D6, D9, D10, D11; `analogWrite` giá trị 1…254 trên chân PWM charge `analogWrite`, còn 0, 255 và chân không PWM charge `analogWriteDigital` (core gọi `digitalWrite`; đo 178/186/190 cycle); `pinMode(INPUT)` charge `pinMode` (chỉ OUTPUT được đo); `tone` charge theo băng tần số của bảng `toneUs` (0.1.5): `silentUs` trên chân không kêu, `playingUs` trên chân đang kêu; `tone` lên chân khác khi một tone đang kêu charge `tone`. Driver `hbridge-en-in1-in2` charge thêm `motorSetOverhead` giữa IN2 và EN (0.1.5). Không charge tải ngắt (§4.5, §13). Driver `hcsr04-pulsein` (R1.4): có echo thì cả helper = chờ + echo + `ultrasonicCmOverhead` (đúng 1675,5625 µs của EMU-13 ở 450 + 1160); không echo xem §13.

**Độ lệch theo chương trình:** `-flto` inline/gập hằng tuỳ cả chương trình: cùng lời gọi trong sketch nhỏ chỉ có hằng (`costs-const`, EMU-09) rẻ hơn 8…41 %, và `tone(10, 1000)` hằng chỉ còn 94 cycle. Bảng trên là của lời gọi thật; parity thời gian ±1 % chỉ hứa cho khoảng ≥ 1 ms mà `delay`/`pulseIn`/Serial chiếm phần lớn (ADR 0003 §7 điều kiện 1).

**Bảng `toneUs` (0.1.6, EMU-18, `node spikes/avr8js/run-generated-tone.mjs`):** đo trên **sketch generator sinh ra** (`buzzerTone(BUZZER_PIN, <hz>, 20L)` giữa hai lần bật/tắt LED, trừ cặp bật/tắt LED không có gì ở giữa), tần số **tính lúc chạy** (từ hai `analogRead`), 75 chỗ gọi mỗi chương trình nên `-flto` không gập lời gọi; mỗi băng lấy giá trị **lâu nhất** trong các tần số đã đo (cạnh và trong băng). Trong một băng phép chia `long` tuỳ giá trị: chân không kêu ngắn hơn tới 5,3125 µs (31…121 Hz), chân đang kêu tới 6,5 µs (31…121 Hz) và 5,375 µs (244…486 Hz); tương đối nhiều nhất 2,80 % (3892…4000 Hz, chân đang kêu: 134,625 so với 138,5). Cùng 75 chỗ gọi, tần số literal ngắn hơn tần số tính lúc chạy 0,25…6,25 µs trên chân không kêu; trên chân đang kêu từ ngắn hơn 5,6875 µs tới **dài hơn** 0,6875 µs (122, 150, 200 Hz). `tone()` thử lần lượt prescaler của Timer2 (1, 8, 32, 64, 128, 256, 1024), mỗi lần một phép chia `long`; `Tone.cpp` lấy prescaler p khi `floor(8e6 / (p · f)) ≤ 256`, nên băng của p bắt đầu từ `floor(16e6 / (514 · p)) + 1` Hz. Trên chân không kêu `tone()` còn đăng ký chân và đặt Timer2.

| Prescaler | Từ Hz | Chân không kêu (µs) | Chân đang kêu (µs) | Tần số đã đo |
|---|---|---|---|---|
| 1024 | 31 | 306,5625 | 300,5625 | 31, 60, 100, 121 |
| 256 | 122 | 298,1875 | 293,4375 | 122, 150, 200, 243 |
| 128 | 244 | 258,9375 | 254 | 244, 300, 440, 486 |
| 64 | 487 | 219,6875 | 214,625 | 487, 600, 800, 972 |
| 32 | 973 | 181,5625 | 176,5625 | 973, 1000, 1500, 2000, 3000, 3891 |
| 8 | 3892 | 143,3125 | 138,5 | 3892, 3950, 4000 |

Bản sao trong `uno-r3.board.json` (`toneUs`), test so với contract (`unoContract.toneUs`) và kiểm cạnh băng theo công thức trên. Đây là chi phí của lời gọi không bị gập. Chi phí thật của `tone()` trong một sketch tuỳ **cả chương trình** (§13, Chi phí `tone` theo chương trình): ít chỗ gọi với tần số là literal thì `-flto` gập lời gọi: với **một** chỗ gọi còn 17,625…17,75 µs ở **mọi** băng (đo ở 31, 60, 121, 122, 200, 244, 440, 487, 1000, 4000 Hz, 0.1.7), một sàn không tuỳ băng; một lời gọi tần số tính lúc chạy đo 213,375 µs.

### 4.5 Tải ngắt (đo, simulator v0 **không** charge)

| Nguồn | Tải | Evidence |
|---|---|---|
| Timer0 overflow (`millis`) | 95,44 cycle mỗi 1024 µs = **0,583 %** | EMU-08 |
| Mỗi Servo | **0,163 %** | EMU-08 |
| `tone` | ≈ 119 cycle mỗi lần đảo chân = **1,49 %** ở 1000 Hz, tuyến tính theo Hz | EMU-08 |

Ảnh hưởng: phần tính toán trên board chậm hơn simulator chừng đó (`delay`/`millis` dùng thời gian thật nên không bị); `pulseIn` đọc ngắn đúng chừng đó (§6.6).

---

## 5. Board: chân và timer

### 5.1 Chân PWM (board profile §4.1, dữ liệu)

| Chân | Timer | Chế độ (core đặt) | Tần số đo | Duty đo | Nhãn |
|---|---|---|---|---|---|
| D3 | T2 (OC2B) | phase-correct /64 | 490,196 Hz | v/255 | V·E (EMU-06) + D·A (ARD-01: "490 Hz") |
| D5 | T0 (OC0B) | fast /64 | 976,5625 Hz | v/255 ± 1/256 | V·E + D·A ("pins 5 and 6: 980 Hz") |
| D6 | T0 (OC0A) | fast /64 | 976,5625 Hz | v/255 ± 1/256 | như D5 |
| D9 | T1 (OC1A) | phase-correct 8 bit /64 | 490,196 Hz | v/255 | V·E |
| D10 | T1 (OC1B) | phase-correct 8 bit /64 | 490,196 Hz | v/255 | V·E |
| D11 | T2 (OC2A) | phase-correct /64 | 490,196 Hz | v/255 | V·E |

- **Mô hình duty của simulator: `v / 255`** (ARD-01: "between 0 (always off) and 255 (always on)"). D5/D6 trên board là (v+1)/256 theo datasheet (DS-01 "narrow spike"; ARD-01 "higher-than-expected duty cycles"), avr8js cho v/256: lệch tuyệt đối ≤ 1/256 chu kỳ, vô nghĩa với mô hình motor.
- `analogWrite(pin, 0)` → `digitalWrite LOW`, `255` → `HIGH` (không PWM).
- **Chân không PWM:** `value ≥ 128` → HIGH, ngược lại LOW, cảnh báo `not-pwm` (EMU-06: 127 → LOW, 128 → HIGH; cả A0/A1).
- `digitalRead`/`digitalWrite` lên chân đang PWM **tắt PWM** của chân đó (ARD-01 "…or a call to `digitalRead()` or `digitalWrite()`"): Advanced không cho đọc chân output (U-33).

### 5.2 Chân dành riêng và mặc định

- D0, D1 dành cho Serial khi chương trình có in (ARD-07). Kit không được đặt module lên D0/D1 khi có in; Advanced không ghi/đọc chúng (`pin-unavailable`).
- Sau reset mọi chân là INPUT ("tri-stated", DS-01; trace: trạng thái đầu INPUT). `pinMode(OUTPUT)` trong `setup()` đưa chân về LOW (EMU-01, EMU-02): motor dừng, LED tắt lúc đầu.

### 5.3 Timer bị chiếm (thay UNKNOWN của brief bằng trace R0.4)

`timerClaims`: **servo → T1**, **tone → T2**.

| Tình huống | Board (L2e) | Quyết định |
|---|---|---|
| Kit có servo, PWM D9/D10 | `Servo.attach` đặt Timer1 normal mode: PWM D10 dừng, chân giữ LOW; `analogWrite(10, 200)` khi đang attach vẫn LOW; sau `detach` **vẫn LOW** tới khi reset (EMU-04). Khớp ARD-12 | **Từ chối** `timer-claimed` lúc compile (R1.2 test `pwm on D10 with servo is refused with timer-claimed`) |
| Kit có còi (tone), PWM D3/D11 | `tone` đặt Timer2 CTC: D3/D11 dừng, LOW; `analogWrite(11, 100)` khi tone chạy **đổi tần số tone** 1000 → 2475,248 Hz (OCR2A là TOP) (EMU-05). Sau `noTone`, hoặc khi tone hết thời lượng, D3/D11 **vẫn không có PWM** cho tới khi gọi `analogWrite` mới (EMU-14): `disableTimer(2)` đặt `TCCR2A = (1 << WGM20)`, xoá bit COM (`Tone.cpp:449`, arduino:avr 1.8.8; `tone()` cũng đặt `TCCR2A = 0`, `:183`; tone tự hết thì ISR gọi `noTone`, `:554`). Sketch EMU-05 gọi lại `analogWrite` ngay sau `noTone`, nên nó không cho thấy PWM tự trở lại. Khớp ARD-03 | **Từ chối** `timer-claimed` |
| Còi D10 khi có servo | tone đảo D10 bằng ISR Timer2; Servo để `COM1B` = 0: không đụng nhau (EMU-07) | cho phép |
| Motor D5/D6 (Timer0) cùng `millis`/`delay` | chạy song song bình thường (EMU-02, EMU-07) | cho phép |

`ref-uno-rover@0` không đặt PWM nào lên timer bị chiếm (D5/D6 trên T0). Hệ quả: kit này **không còn chân PWM rảnh** cho `pwm.write` của Advanced (A3…A5 rảnh nhưng không PWM).

---

## 6. Ngữ nghĩa module (plan §4.4) và helper driver

Text helper là bản tham chiếu đã compile và trace (`contract-forms.ino`, EMU-13); driver R1.4 dùng **đúng** text này trong `Driver.cpp.helper` (test so nguyên văn). TS `sim` của driver phải cho cùng mức chân.

### 6.1 Motor H-bridge `hbridge-en-in1-in2` (U-20, U-21, U-22)

```cpp
void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {
  if (speed > 100L) speed = 100L;
  if (speed < -100L) speed = -100L;
  long magnitude = speed < 0L ? -speed : speed;
  digitalWrite(in1, speed > 0L ? HIGH : LOW);
  digitalWrite(in2, speed < 0L ? HIGH : LOW);
  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));
}
```

- `speed` −100…100, ngoài khoảng kẹp (+ cảnh báo). **duty = round(|s| × 255 / 100)**, làm tròn nửa lên = `(|s|·255 + 50) / 100`: 50 → 128, 30 → 77, 1 → 3, 60 → 153, 40 → 102 (EMU-02, EMU-13). Simulator: `Math.round(Math.abs(s) * 255 / 100)` (bằng nhau với mọi |s| ≤ 100).
- Chiều: `s > 0` IN1 HIGH IN2 LOW; `s < 0` IN1 LOW IN2 HIGH; **`stop` (s = 0) = cả hai IN LOW** và EN LOW.
- Thời gian (0.1.5…0.1.7): virtual UNO charge 2 × `digitalWrite` + `motorSetOverhead` (43,6875 µs, phần nhân/chia `long`, lâu nhất của mọi speed −100…100) + `analogWrite`, đúng thứ tự của helper: `motorSet(-75)` và `motorSet(-97)` = 60,5 µs như board; các speed khác trên đường PWM ngắn hơn tới 1,625 µs (EMU-17).
- `drive.move` (U-21): `speed` đánh giá một lần vào `_s`; tiến (+s, +s), lùi (−s, −s), xoay trái (−s, +s), xoay phải (+s, −s) cho (trái, phải); `−s` là `neg32(_s)`, rồi mỗi motor tự kẹp. Cần cả `motorLeft` và `motorRight` (`capability-unavailable` nếu thiếu). `drive.stop` (U-22): hai `motorSet(…, 0L)`.

### 6.2 Servo `servo-lib` (U-23)

```cpp
void servoSet(Servo &servo, long angle) {
  if (angle < 0L) angle = 0L;
  if (angle > 180L) angle = 180L;
  servo.write((int)angle);
}
```

- Global `Servo <role>;`, trong `setup()`: `<role>.attach(<ROLE>_PIN); <role>.write(90);` → **servo bắt đầu ở 90°** trên cả board lẫn simulator (xung 1472 µs từ xung đầu, EMU-13).
- Góc 0…180, ngoài khoảng kẹp **trước** `Servo.write` (vì `write(v)` với v ≥ 544 coi v là micro giây: 600 sẽ thành 600 µs). Xung = `544 + angle × 1856 / 180` µs (chia nguyên), chu kỳ 20 ms, do ngắt Timer1 (EMU-03).

### 6.3 Còi `buzzer-tone` (U-25, U-26)

```cpp
void buzzerTone(uint8_t pin, long hz, long ms) {
  if (hz < 31L) hz = 31L;
  if (hz > 4000L) hz = 4000L;
  if (ms < 1L) ms = 1L;
  if (ms > 60000L) ms = 60000L;
  tone(pin, (unsigned int)hz, (unsigned long)ms);
}
```

- `hz` 31…4000 (ARD-03: không dưới 31 Hz; 4000 Hz là trần contract để tải ngắt ≤ 6 %, B7 = 3951 Hz vẫn nằm trong), `ms` 1…60000 (0 sẽ phát mãi). Kẹp + cảnh báo.
- **Không chặn**: tone phát nền `ms` ms (ARD-03, EMU-05); tone mới trên cùng chân thay tone cũ (tần số và thời lượng mới, EMU-13).
- Board phát `floor(2 × hz × ms / 1000)` nửa chu kỳ của tần số timer làm được (440 → 440,141 Hz; 31 Hz × 40 ms chỉ là một xung 16 ms). Simulator phát `hz` trong `ms` (khác biệt ghi ở §13).
- Thời gian (0.1.6): `tone()` tốn theo băng tần số (bảng `toneUs`, §4.4, đo trên sketch sinh ra): 143,3125…306,5625 µs trên chân không kêu, 138,5…300,5625 µs trên chân đang kêu; board có thể gập lời gọi tuỳ chương trình (§13).
- `buzzer.stop` (U-26, Advanced): `noTone(<ROLE>_PIN);`, chân LOW ngay.

### 6.4 LED `led-digital` (U-24), nút `button-pullup` (U-30)

- LED: `pinMode(OUTPUT)` trong setup; `digitalWrite(PIN, (on) ? HIGH : LOW)`.
- Nút: `pinMode(INPUT_PULLUP)` trong setup; **pressed ⇔ chân LOW** (`(digitalRead(PIN) == LOW)`). Nhả = HIGH nhờ pull-up (ARD-16; avr8js không có pull-up nên harness lái HIGH). Không debounce (rung phím là L3).

### 6.5 Line `line-digital` (U-28) và giá trị thô (U-29)

- `line.dark`: `(digitalRead(PIN) == <mức>)` với mức = `LOW` nếu kit ghi `activeLow: true`, `HIGH` nếu không; generator viết sẵn mức theo kit (EMU-13 cả hai cực tính).
- `line.raw` (Advanced): `(long)analogRead(PIN)`, 0…1023; ADC = Vin · 1024 / Vref (DS-01). Lần đọc đầu tiên của run tốn `analogReadFirst`.

### 6.6 Siêu âm `hcsr04-pulsein` (U-27)

```cpp
long ultrasonicCm(uint8_t trig, uint8_t echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long us = (long)pulseIn(echo, HIGH, 30000UL);
  if (us == 0L) return 400L;
  long cm = us / 58L;
  if (cm < 2L) return 2L;
  if (cm > 400L) return 400L;
  return cm;
}
```

- **cm = µs / 58** (chia nguyên), kẹp 2…400; **timeout (không echo, hoặc echo dài hơn timeout) → 400**.
- Thời gian (simulator charge): trigger + chờ echo (world) + độ rộng echo (world) + phần còn lại = `ultrasonicCmOverhead` (65,5625 µs tổng ngoài chờ và echo); không echo: `ultrasonicCmNoEcho` = 20 812 µs, **không phải 30 000**: vòng chờ cạnh lên 11 cycle, vòng đếm 16 cycle, chung ngân sách 30000 vòng (CC-04, EMU-03).
- Board **đọc ngắn** 0…1,10 % (ngắt Timer0/Servo không được đếm; 2…3 % khi còi đang kêu, EMU-07): cm trên board có thể thấp hơn khoảng cách chính xác tới 1,1 % + 1 cm (3 % + 1 cm khi còi kêu; cộng 1 cm vì chia nguyên): 1160 µs → 1155 → **19** cm; 23 200 µs → 397 cm. Simulator dùng thời gian chính xác của world. Kịch bản chấm điểm phải chừa dung sai ≥ 3 % + 1 cm (R6).

### 6.7 Tay gắp `gripper-servo2` (U-35, U-36; N19)

```cpp
void gripperSet(Servo &servo, long angle) {
  if (angle < 0L) angle = 0L;
  if (angle > 90L) angle = 90L;
  servo.write((int)angle);
}
```

- Một port, hai servo trên Servo 1.3.0: kẹp ở `CLAW` (D9), tay ở `LIFT` (D10). `setup()` attach cả hai, dù chương trình dùng op nào: kẹp `write(0)` (mở), tay `write(90)` (nâng), như tay thật lúc bật.
- Góc **0…90**, kẹp trước `Servo.write` (quá 90 servo chỉ kẹt), cảnh báo `value-clamped` một lần mỗi role mỗi run (kẹp và tay là một role `gripper`). Khối mở/đóng viết **0/80** (80 = `jawsMeetDeg`, hai ngàm chạm nhau), nâng/hạ viết **90/0** (plan N19 D-G3).
- Không có tham số tốc độ (D-G4). Hai servo giữ Timer1: không PWM trên D9/D10 (U-48). Chi phí `gripperSet` 51,625 µs (EMU-20).
- Board (EMU-19): độ rộng xung đúng `map()` của Servo.h (kẹp 544 → 1368 → 1472 (120 bị kẹp) → 544; tay 1472 → 544 → 1008); hai servo trong cùng khung 20 ms, xung tay lên 10,75 µs sau xung kẹp xuống. Servo thứ hai của Timer1 (tay) có một xung ở lần tràn đầu tiên của Timer1 (32,8 ms sau `attach`, vì `Channel[]` của Servo 1.3.0 bắt đầu từ 0), xung kế tiếp sau một khung cộng xung của kẹp (§13).

### 6.8 IR giữa càng `ir-digital` (U-37; N19)

- `(digitalRead(<ROLE>_PIN) == LOW)` khi kit ghi `activeLow` (mặc định của driver: module IR thường kéo LOW khi thấy vật), `HIGH` nếu không; `pinMode(INPUT)` trong `setup()`. Chi phí một `digitalRead` (3,9375 µs trên A3, EMU-20).
- Thấy gì là của world (tia ngắn giữa hai ngàm, vật đen phản xạ quá ít): PLACEHOLDER tới khi có kit thật.

### 6.9 Cảm biến màu `tcs34725-wire` (U-38, U-39; N19)

- TCS34725 ở 0x29 trên Wire thô (không Adafruit, D-G7), SDA A4 / SCL A5 (luật kit `wrong-i2c-pin`, `i2c-address-conflict`). `setup()` gọi `colorBegin()`: `Wire.begin()` (bật pull-up SDA/SCL), `Wire.setWireTimeout(3000, true)`, ATIME 0xEB (21 chu kỳ × 2,4 ms = 50,4 ms), gain 4×, PON, 3 ms, AEN, rồi `delay(54)` cho cửa sổ đầu (RGBC Init 2,4 ms + 50,4 ms; DS-02). Cửa sổ sau kết thúc mỗi 52,8 ms.
- `colorFetch()` đọc C, R, G, B của cửa sổ gần nhất bằng một lần đọc auto-increment từ CDATAL (8 byte, 336,5625…1021,4375 µs sau khi bắt đầu); byte thấp chốt byte cao vào shadow register (DS-02), nên một cửa sổ kết thúc giữa lần đọc cho C của cửa sổ trước và R, G, B của cửa sổ sau, cả trên board và trong simulator (driver đọc từng byte ở thời điểm bus của nó).
- `colorIs(n)`: phân loại bằng bảng nguyên `COLOR_RULES` (phần nghìn r, g, b trên r + g + b, chia nguyên, luật đầu tiên khớp; ngưỡng PLACEHOLDER theo phiên bản driver): 0 đỏ, 1 xanh lá, 2 xanh dương, 3 vàng, 4 trắng, 5 đen, 6 không rõ. `colorRaw(k)`: 0 đỏ, 1 xanh lá, 2 xanh dương, 3 tổng C; **0…21 504** = 1024 × 21 ở ATIME 0xEB.
- Không có cảm biến (NACK): mọi giá trị 0, `colorIs(6)` đúng, không chờ timeout (EMU-19). Bus treo: timeout 3 ms reset TWI (ARD-18).

---

## 7. Serial

- `Serial.begin(9600);` là dòng setup đầu tiên khi chương trình có `print`; D0/D1 bị giữ.
- `print` số: chữ số ASCII; bool: `1`/`0`; text: `F("…")`, UTF-8 nguyên byte (`Xin chào` = 9 byte), escape `\"` `\\`; ghép: nhiều `Serial.print`, cuối là `Serial.println` (U-15…U-17, EMU-13).
- Thời gian (mô hình của simulator, từ EMU-08): hàng TX chứa **64 byte** tính từ rỗng; mỗi byte vào hàng tốn `serialQueueByte` (6,28 µs), số tốn thêm `serialPrintLongBase + serialPrintLongDigit × d (+ sign)`, `println` thêm `serialPrintln`; hàng xả **1 byte mỗi 1040 µs** (`SERIAL_FRAME_US`); byte gặp hàng đầy thì **chờ** tới khi có chỗ (ARD-08). Từ byte thứ 65 của một lần in dài, mỗi byte tốn ≈ 1,04 ms.
- Khác biệt avr8js: 1044,17 µs/byte và hàng 64; board dự kiến 1040 µs và 65 (shift register riêng). Ghi ở §13, L3.
- **Ghi chú cho ai nối mô hình hàng TX vào simulator (C1 fix round 1; chỉ là tài liệu, chưa đổi code):**
  - **Board:** một join (U-17) là nhiều `Serial.print` liên tiếp. Phần sau chỉ được **đánh giá** sau khi byte của phần trước **đã vào hàng TX**, vì mỗi phần là một câu lệnh riêng. Lần đọc robot trong phần sau (siêu âm, `millis`, `analogRead`) xảy ra sau thời gian đưa byte của các phần trước vào hàng. Nếu hàng đầy, thời gian đó gồm cả lúc chờ ~1,04 ms/byte.
  - **Simulator hiện nay:** đánh giá **mọi phần trước**, rồi in cả dòng một lần (`ybc-interpreter.ts`, `join`). Chữ in ra giống nhau. Thời điểm của các lần đọc thì chỉ khớp vì simulator chưa tính thời gian Serial.
  - **Khi thời gian hàng TX được mô hình hoá** (`serialQueueByte`, `serialPrintLong*`, `serialPrintln`, `SERIAL_FRAME_US`, hàng 64 byte), simulator **phải in join từng phần, theo thứ tự**: đánh giá phần k, đưa byte của nó vào hàng (charge, chờ nếu đầy), rồi mới đánh giá phần k + 1, và `println` ở phần cuối. Như vậy lần đọc và thời gian khớp sketch `Serial.print(<part>); … Serial.println(<last>);` (U-17).

---

## 8. RAM / flash

| Luật | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Flash tối đa | 32 256 B | V·C | CC-01 |
| RAM | 2048 B; arduino-cli **cảnh báo** "Low memory available, stability problems may occur." khi biến toàn cục **> 1536 B** (75 %); > 2048 B: build fail | V·C | CC-02 |
| L2 báo % | lấy từ output `arduino-cli compile` ("Sketch uses … (x%)", "Global variables use … (y%)") | V·C | CC-01 |
| Lời giải mẫu | **RAM ≤ 75 %** (≤ 1536 B toàn cục, tức không có cảnh báo; ≥ 512 B cho stack) | V·C | CC-02 |
| Tham chiếu | cả kit cùng lúc (`kit-rover`, có Servo + Serial + tone): 4752 B flash (14 %), 247 B RAM (12 %); `contract-forms`: 7474 B (23 %), 258 B (12 %) | V·C | CC-01, CC-03 |
| Tham chiếu xe tay gắp (N19) | `gripper-forms`: 7240 B flash (22 %), 456 B RAM (22 %), Wire chiếm 216 B RAM (CC-06); golden `gripper-every-op.ino` (mọi op của `ref-uno-gripper@0`): 7034 B (21,8 %), 460 B (22,46 %), `pnpm check:arduino --require` | V·C | CC-06 |

Stack thực tế (đệ quy, biến cục bộ) không đo tĩnh được: v0 không có hàm của learner (U-42), nên stack chỉ là của core và helper.

---

## 9. Advanced: chân thô

| Dòng | Dạng | Domain (compile, BoardTarget R1.2) |
|---|---|---|
| U-31 `digital.write` | `digitalWrite(<pin>, (<v>) ? HIGH : LOW);` + `pinMode(OUTPUT)` | chân kit để trống, không D0/D1 khi có in; ngược lại `pin-unavailable` |
| U-32 `pwm.write` | `pwmWrite(<pin>, <value>);` (helper kẹp 0…255) | như trên; chân PWM trên timer bị chiếm → `timer-claimed`; chân không PWM → ngưỡng 128 + `not-pwm` |
| U-33 `digital.read` | `(digitalRead(<pin>) == HIGH)` + `pinMode(<pin>, <mode>)` của driver module trong setup | chỉ chân kit nối vào module đầu vào (nút, line, echo). Chân thả nổi đọc ngẫu nhiên trên board (ARD-06) → `pin-unavailable`; chân output (nhất là PWM) cũng bị từ chối. Chân luôn được `pinMode` như driver của module đặt (nút `INPUT_PULLUP`: nhả là HIGH, ARD-16), dù program có dùng op của module hay không |
| U-34 `analogIn.read` | `(long)analogRead(<pin>)` | A0…A5, chỉ chân kit nối vào module analog |

```cpp
void pwmWrite(uint8_t pin, long value) {
  if (value < 0L) value = 0L;
  if (value > 255L) value = 255L;
  analogWrite(pin, (int)value);
}
```

---

## 10. Construct compatibility matrix

Ký hiệu §0.2. Cột field: `call import module unit range default clamp round block yield return error coord event content`. Tier: `B+A` = cả hai profile, `A` = chỉ Advanced. Cột cuối: field **emulator-dependent** (mọi nguồn của một claim là EMU; suy ra từ data).

### 10.1 Dòng được mở (ELIGIBLE / RESTRICTED)

| ID | Capability | Tier | call | imp | mod | unit | range | def | clamp | round | block | yield | ret | err | coord | event | content | Elig. | emulator-dependent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| U-01 | program start: setup() | B+A | V·C | – | – | – | – | – | – | – | D·A | – | – | – | – | – | – | ELIGIBLE | — |
| U-02 | forever: loop() | B+A | V·C | – | – | – | – | – | – | – | D·A | – | – | – | – | – | D·A | ELIGIBLE | — |
| U-03 | variable (long, int32) | B+A | V·C | – | – | – | D·A | –ᴱ | – | – | – | – | D·X | – | – | – | – | ELIGIBLE | — |
| U-04 | integer literal | B+A | V·C | – | – | – | D·A+D·X | – | – | – | – | – | – | –ᴰ | – | – | – | ELIGIBLE | — |
| U-05 | add, subtract, multiply (int32, wrap) | B+A | V·C | – | – | – | – | – | – | – | – | – | D·X | D·X | – | – | D·X | ELIGIBLE | — |
| U-06 | divide (truncating) | B+A | V·C | – | – | – | – | – | – | D·X | – | – | D·X | D·X | – | – | D·X | ELIGIBLE | — |
| U-07 | remainder (sign of the dividend) | B+A | V·C | – | – | – | – | – | – | D·X+D·A | – | – | D·X | D·X | – | – | D·X | ELIGIBLE | — |
| U-08 | negate | B+A | V·C | – | – | – | – | – | – | – | – | – | D·X | – | – | – | – | ELIGIBLE | — |
| U-09 | compare | B+A | V·C | – | – | – | – | – | – | – | – | – | D·X | – | – | – | D·X | ELIGIBLE | — |
| U-10 | and, or, not, true, false | B+A | V·C | – | – | – | – | – | – | – | – | – | D·X | – | – | – | – | ELIGIBLE | — |
| U-11 | if / else if / else | B+A | V·C | – | – | – | – | – | – | – | – | – | – | – | – | – | – | ELIGIBLE | — |
| U-12 | repeat N times | B+A | V·C | – | – | – | D·X | – | – | – | – | – | – | – | – | – | D·X | ELIGIBLE | — |
| U-13 | while | B+A | V·C | – | – | – | – | – | – | – | – | – | – | – | – | – | – | ELIGIBLE | — |
| U-14 | count up | B+A | V·C | – | – | – | –ᴰ | – | –ᴰ | – | – | – | – | –ᴰ | – | – | D·X | RESTRICTED | — |
| U-15 | print a number or a truth value | B+A | V·C | – | – | – | – | – | – | – | D·A | – | – | – | – | – | D·A+D·X | ELIGIBLE | — |
| U-16 | print text | B+A | V·C | – | – | – | –ᴰ | – | – | – | D·A | – | – | – | – | – | D·A | RESTRICTED | — |
| U-17 | print a join of text and numbers | B+A | V·C | – | – | – | – | – | – | – | D·A | – | – | – | – | – | D·A | ELIGIBLE | — |
| U-18 | wait (ms) | B+A | V·C | – | – | D·A | –ᴰ | – | –ᴰ | – | D·A | – | – | –ᴰ | – | – | – | ELIGIBLE | — |
| U-19 | time since start (millis) | A | V·C | – | – | D·A | D·A+D·X | – | – | V·E | V·E | – | V·E | – | – | – | – | ELIGIBLE | round, block, return |
| U-20 | motor speed (H-bridge EN/IN1/IN2) | B+A | V·C | – | – | D·A+V·E | V·E | V·E | V·E | V·E | V·E | V·E | – | – | – | – | V·E | ELIGIBLE | unit, range, default, clamp, round, block, yield, content |
| U-21 | drive: forward, backward, spin left, spin right | B+A | V·C | – | – | – | – | – | V·E | V·E | V·E | V·E | – | – | – | – | V·E | ELIGIBLE | clamp, round, block, yield, content |
| U-22 | stop the robot | B+A | V·C | – | – | – | – | – | – | – | V·E | – | – | – | – | – | V·E | ELIGIBLE | block, content |
| U-23 | servo angle | B+A | V·C | V·C | V·C | D·A+V·E | D·A+V·E | V·E | V·E | V·E | V·E | V·E | – | – | – | – | – | ELIGIBLE | unit, range, default, clamp, round, block, yield |
| U-24 | LED on / off | B+A | V·C | – | – | – | – | V·E | – | – | V·E | – | – | – | – | – | V·E | ELIGIBLE | default, block, content |
| U-25 | buzzer tone (Hz, ms) | B+A | V·C | – | – | D·A | D·A+V·E | – | V·E | V·E | D·A+V·E | V·E | – | – | – | – | D·A+V·E+D·X | ELIGIBLE | range, clamp, round, block, yield, content |
| U-26 | buzzer stop | A | V·C | – | – | – | – | – | – | – | V·E | – | – | – | – | – | V·E | ELIGIBLE | block, content |
| U-27 | ultrasonic distance (cm) | B+A | V·C | – | – | D·A+V·E | V·E | – | V·E | V·E | V·C+V·E | – | D·A+V·E | – | – | – | – | ELIGIBLE | unit, range, clamp, round, block, return |
| U-28 | line sensor sees dark | B+A | V·C | – | – | – | – | – | – | – | V·E | – | V·E | – | – | – | V·E | ELIGIBLE | block, return, content |
| U-29 | line sensor raw value | A | V·C | – | – | – | D·A+V·E | – | – | D·S | V·E+D·S | – | V·E | – | – | – | – | ELIGIBLE | range, block, return |
| U-30 | button pressed | B+A | V·C | – | – | – | – | D·A | – | – | V·E | – | V·E | – | – | – | – | ELIGIBLE | block, return |
| U-31 | digital write (raw pin) | A | V·C | – | – | – | –ᴰ | – | – | – | V·E | – | – | – | – | – | V·E | RESTRICTED | block, content |
| U-32 | PWM write 0..255 (raw pin) | A | V·C | – | – | D·A+V·E | V·E | – | V·E | – | V·E | V·E | – | –ᴰ | – | – | V·E | RESTRICTED | unit, range, clamp, block, yield, content |
| U-33 | digital read (raw pin) | A | V·C | – | – | – | –ᴰ | D·A+V·E | – | – | V·E | – | V·E | – | – | – | – | RESTRICTED | default, block, return |
| U-34 | analog read 0..1023 (raw pin) | A | V·C | – | – | – | D·A | – | – | D·S | V·E | – | V·E | – | – | – | – | RESTRICTED | block, return |
| U-35 | gripper claw (open, close, angle) | B+A | V·C | V·C | V·C | D·A+V·E | D·A+V·E | V·E | V·E | V·E | V·E | V·E | – | – | – | – | – | ELIGIBLE | unit, range, default, clamp, round, block, yield |
| U-36 | gripper arm (up, down, angle) | B+A | V·C | V·C | V·C | D·A+V·E | D·A+V·E | V·E | V·E | V·E | V·E | V·E | – | – | – | – | – | ELIGIBLE | unit, range, default, clamp, round, block, yield |
| U-37 | IR obstacle between the jaws | B+A | V·C | – | – | – | – | – | – | – | V·E | – | V·E | – | – | – | V·E | ELIGIBLE | block, return, content |
| U-38 | colour sensor sees a colour (TCS34725 on Wire) | B+A | V·C | V·C | V·C | D·S | D·S+V·E | D·S+V·E | – | V·E | V·E+D·A | – | V·E | V·E+D·A | – | – | D·S+V·E | ELIGIBLE | range, default, round, block, return, error, content |
| U-39 | colour sensor raw value | A | V·C | V·C | V·C | D·S | D·S+V·E | D·S+V·E | – | – | V·E | – | V·E | V·E+D·A | – | – | D·S+V·E | ELIGIBLE | range, default, block, return, error, content |

Ghi chú:
- `call` của mọi dòng là `V·C`: dạng C++ đã compile trong `contract-forms.ino` (CC-03); của U-35…U-39 (xe tay gắp, N19) trong `gripper-forms.ino` (CC-06).
- Các dòng ngôn ngữ (U-01…U-18) có field DOCUMENTED kèm corroboratedBy EMU-10/11/13: trace xác nhận thêm, field không phụ thuộc trace.
- `event`: `–` ở mọi dòng (U-43 DEFERRED). `coord`: `–` (UNO không có toạ độ).
- `yield` (`V·E`): PWM, xung servo, tone chạy nền bằng phần cứng/ngắt trong khi chương trình chạy tiếp hoặc chờ.

### 10.2 Dòng không mở

| ID | Capability | Kết luận | Lý do |
|---|---|---|---|
| U-40 | float, chia số thực | EXCLUDED | Basic không có float (R0.3); Advanced v0 cũng không: mô hình số là `cxx-int32` |
| U-41 | biến chữ, `String` | EXCLUDED | Chữ chỉ để in; `String` ăn và phân mảnh 2 KB RAM |
| U-42 | hàm của learner | DEFERRED | Chưa có trong block R2.2; domain hàm (như FN1–FN10 của Yolo:Bit) viết khi có block |
| U-43 | ngắt, sự kiện (`attachInterrupt`) | DEFERRED | Mô hình chương trình là setup + loop |
| U-44 | đọc Serial | EXCLUDED | Lab không gửi input vào chương trình ở v0 |
| U-45 | số ngẫu nhiên | EXCLUDED | Không có trong IR v0; mô hình có seed phải khớp `random()` của AVR |
| U-46 | module I²C (`Wire`) | DEFERRED | Không có khối Wire của riêng learner. Driver của cảm biến màu dùng Wire (U-38, U-39, U-M3, N19); `ref-uno-rover@0` không có module I²C |
| U-47 | `delayMicroseconds`, `pulseIn` thô, `micros` | EXCLUDED | Chỉ driver dùng; không có block |
| U-48 | PWM trên timer servo/tone giữ | EXCLUDED, **hành vi VERIFIED** | (N19: hai servo của tay gắp cũng giữ Timer1, EMU-19.) §5.3: chương trình sẽ không làm điều nó nói (chân LOW; tone đổi tần số). `content` = V·E (EMU-04, EMU-05, EMU-14) + D·A (ARD-12, ARD-03). Từ chối `timer-claimed` |
| U-49 | `Servo.detach`, `writeMicroseconds`, servo ngoài kit | EXCLUDED | `detach` để Timer1 ở normal mode, D9/D10 mất PWM tới khi reset (EMU-04); block chỉ đặt góc |
| U-50 | tone trên chân khác còi, hai tone cùng lúc | EXCLUDED | Core chỉ phát một tone mỗi lúc (ARD-03); role `buzzer` giữ nó |

---

## 11. Profile

| Profile | Dòng |
|---|---|
| **uno-basic** | U-01…U-18 (khung, biến, số học, so sánh, logic, if, repeat, while, count up, in, chờ) + U-20…U-25 (motor, robot đi/dừng, servo, đèn, còi kêu) + U-27 (siêu âm) + U-28 (line thấy vạch đen) + U-30 (nút) + U-35…U-38 (N19: kẹp, tay, IR giữa càng, màu vật) |
| **uno-advanced** | tất cả của Basic + U-19 (`millis`) + U-26 (dừng còi) + U-29 (line thô) + U-31…U-34 (chân thô) + U-39 (N19: giá trị thô cảm biến màu) |

Khối của role mà kit không có thì không hiện trong hộp khối của lab robot (`kitBlockPacks`, N19 D-G11): hộp khối của rover giống hệt trước N19. Advanced là tập cha thật sự của Basic. Một profile liệt kê dòng của target khác hoặc dòng không mở thì bị từ chối (`profileConstructViolations`, test). R2.1 test `uno-basic exposes only drive/sensor/servo/led constructs` dựa trên bảng này (cộng các dòng ngôn ngữ).

---

## 12. Ma trận L1 / L2 / L2e / L3

| Mức | Nghĩa (plan D-R11) | Evidence hợp lệ |
|---|---|---|
| **L1** sim-semantic | Simulator (IR + virtual UNO + driver TS) làm đúng ngữ nghĩa của dòng | TST: test của repo chạy dòng trên simulator (interpreter, virtual UNO, driver, world, session, conformance), ghi file và tên test (ruling L110, N18 final fix M4); dòng chưa có test nào → PENDING |
| **L2** compile-verified | Dạng C++ của dòng compile với toolchain đã pin | CC |
| **L2e** emulator-trace | HEX chạy trong avr8js cho đúng mức chân / giá trị / thời gian của contract; từ 0.1.4 thêm harness C2: HEX của sketch sinh ra, so với simulator (EMU-16) | EMU |
| **L3** physical | Board thật (M06) | không có ở v0; validator **cấm** L3 = PASS |

| ID | Capability | Elig. | L1 | L2 | L2e | L3 |
|---|---|---|---|---|---|---|
| U-01 | program start: setup() | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-02 | forever: loop() | ELIGIBLE | PASS (TST-02, TST-07) | PASS (CC-03) | PASS (EMU-08, EMU-13, EMU-16) | PENDING (M06) |
| U-03 | variable (long, int32) | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-10, EMU-13, EMU-16) | PENDING (M06) |
| U-04 | integer literal | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-10, EMU-13, EMU-16) | PENDING (M06) |
| U-05 | add, subtract, multiply (int32, wrap) | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-11, EMU-13, EMU-15, EMU-16) | PENDING (M06) |
| U-06 | divide (truncating) | ELIGIBLE | PASS (TST-01, TST-02, TST-05) | PASS (CC-03) | PASS (EMU-10, EMU-13, EMU-15, EMU-16) | PENDING (M06) |
| U-07 | remainder (sign of the dividend) | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-10, EMU-13, EMU-15, EMU-16) | PENDING (M06) |
| U-08 | negate | ELIGIBLE | PASS (TST-02, TST-03) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-09 | compare | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-13, EMU-15, EMU-16) | PENDING (M06) |
| U-10 | and, or, not, true, false | ELIGIBLE | PASS (TST-01) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-11 | if / else if / else | ELIGIBLE | PASS (TST-01) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-12 | repeat N times | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-13 | while | ELIGIBLE | PASS (TST-01) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-14 | count up | RESTRICTED | PASS (TST-01, TST-02, TST-05) | PASS (CC-03) | PASS (EMU-10, EMU-13, EMU-16) | PENDING (M06) |
| U-15 | print a number or a truth value | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-08, EMU-10, EMU-13, EMU-16) | PENDING (M06) |
| U-16 | print text | RESTRICTED | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-17 | print a join of text and numbers | ELIGIBLE | PASS (TST-01, TST-02) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-18 | wait (ms) | ELIGIBLE | PASS (TST-04, TST-05, TST-07) | PASS (CC-03) | PASS (EMU-01, EMU-08, EMU-13, EMU-16) | PENDING (M06) |
| U-19 | time since start (millis) | ELIGIBLE | PASS (TST-01, TST-03, TST-05) | PASS (CC-03) | PASS (EMU-12, EMU-13, EMU-16) | PENDING (M06) |
| U-20 | motor speed (H-bridge EN/IN1/IN2) | ELIGIBLE | PASS (TST-03, TST-05) | PASS (CC-03) | PASS (EMU-02, EMU-07, EMU-13, EMU-16) | PENDING (M06) |
| U-21 | drive: forward, backward, spin left, spin right | ELIGIBLE | PASS (TST-03, TST-04, TST-05) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-22 | stop the robot | ELIGIBLE | PASS (TST-03, TST-04, TST-05) | PASS (CC-03) | PASS (EMU-02, EMU-13, EMU-16) | PENDING (M06) |
| U-23 | servo angle | ELIGIBLE | PASS (TST-03, TST-04, TST-05) | PASS (CC-03) | PASS (EMU-03, EMU-07, EMU-13, EMU-16) | PENDING (M06) |
| U-24 | LED on / off | ELIGIBLE | PASS (TST-03, TST-04, TST-05) | PASS (CC-03) | PASS (EMU-01, EMU-13, EMU-16) | PENDING (M06) |
| U-25 | buzzer tone (Hz, ms) | ELIGIBLE | PASS (TST-03, TST-04, TST-05) | PASS (CC-03) | PASS (EMU-05, EMU-07, EMU-13, EMU-15, EMU-16) | PENDING (M06) |
| U-26 | buzzer stop | ELIGIBLE | PASS (TST-03, TST-05) | PASS (CC-03) | PASS (EMU-05, EMU-13, EMU-16) | PENDING (M06) |
| U-27 | ultrasonic distance (cm) | ELIGIBLE | PASS (TST-03, TST-04, TST-05) | PASS (CC-03) | PASS (EMU-03, EMU-07, EMU-13, EMU-16) | PENDING (M06) |
| U-28 | line sensor sees dark | ELIGIBLE | PASS (TST-03, TST-04, TST-05) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-29 | line sensor raw value | ELIGIBLE | PASS (TST-03, TST-05) | PASS (CC-03) | PASS (EMU-07, EMU-13, EMU-16) | PENDING (M06) |
| U-30 | button pressed | ELIGIBLE | PASS (TST-03, TST-04, TST-05) | PASS (CC-03) | PASS (EMU-07, EMU-13, EMU-16) | PENDING (M06) |
| U-31 | digital write (raw pin) | RESTRICTED | PASS (TST-03, TST-05) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-32 | PWM write 0..255 (raw pin) | RESTRICTED | PASS (TST-03, TST-05, TST-06) | PASS (CC-03) | PASS (EMU-06, EMU-13, EMU-16) | PENDING (M06) |
| U-33 | digital read (raw pin) | RESTRICTED | PASS (TST-03, TST-05) | PASS (CC-03) | PASS (EMU-13, EMU-16) | PENDING (M06) |
| U-34 | analog read 0..1023 (raw pin) | RESTRICTED | PASS (TST-03, TST-05) | PASS (CC-03) | PASS (EMU-07, EMU-13, EMU-16) | PENDING (M06) |
| U-35 | gripper claw (open, close, angle) | ELIGIBLE | PASS (TST-08, TST-09, TST-10) | PASS (CC-06) | PASS (EMU-19, EMU-16) | PENDING (M06) |
| U-36 | gripper arm (up, down, angle) | ELIGIBLE | PASS (TST-08, TST-09, TST-10) | PASS (CC-06) | PASS (EMU-19, EMU-16) | PENDING (M06) |
| U-37 | IR obstacle between the jaws | ELIGIBLE | PASS (TST-08, TST-09, TST-10) | PASS (CC-06) | PASS (EMU-19, EMU-16) | PENDING (M06) |
| U-38 | colour sensor sees a colour (TCS34725 on Wire) | ELIGIBLE | PASS (TST-08, TST-09, TST-10) | PASS (CC-06) | PASS (EMU-19, EMU-16) | PENDING (M06) |
| U-39 | colour sensor raw value | ELIGIBLE | PASS (TST-08, TST-09, TST-10) | PASS (CC-06) | PASS (EMU-19, EMU-16) | PENDING (M06) |
| U-40 | float numbers, real division | EXCLUDED | n/a | n/a | n/a | n/a |
| U-41 | text variables, String objects | EXCLUDED | n/a | n/a | n/a | n/a |
| U-42 | learner functions | DEFERRED | n/a | n/a | n/a | n/a |
| U-43 | interrupts and events (attachInterrupt) | DEFERRED | n/a | n/a | n/a | n/a |
| U-44 | reading the serial monitor | EXCLUDED | n/a | n/a | n/a | n/a |
| U-45 | random numbers | EXCLUDED | n/a | n/a | n/a | n/a |
| U-46 | I²C modules (Wire) | DEFERRED | n/a | n/a | n/a | n/a |
| U-47 | delayMicroseconds, raw pulseIn, micros | EXCLUDED | n/a | n/a | n/a | n/a |
| U-48 | PWM on a timer a servo or a tone holds | EXCLUDED | PASS (TST-04, TST-06) | PASS (CC-01) | PASS (EMU-04, EMU-05) | PENDING (M06) |
| U-49 | Servo.detach, writeMicroseconds, a servo on a pin outside the kit | EXCLUDED | n/a | n/a | n/a | n/a |
| U-50 | tone on a pin other than the buzzer, two tones at once | EXCLUDED | n/a | n/a | n/a | n/a |

Không bao giờ ghi "100 % tương thích". Câu trên UI về mức tương thích của một chương trình lấy mức **thấp nhất** của các dòng nó dùng.

---

## 13. Khác biệt đã biết (L1 ↔ L2e ↔ L3) và diagnostics

| Khác biệt | L1 (simulator) | L2e (avr8js) | L3 (dự kiến) | Hệ quả |
|---|---|---|---|---|
| Số vòng `loop()` mỗi giây | ≥ 50 µs/vòng | 0,3125 µs vòng rỗng | như L2e | không phải observable parity |
| Tải ngắt | không tính | 0,58 % (+0,16 %/servo, +1,49 % tone 1 kHz) | như L2e | trong ngân sách ±1 % trừ khi có tone cao |
| `pulseIn` / siêu âm **không echo** (R1) | virtual UNO charge `pulseInNoPulse30000` = 20 752 µs (số đo **không** có Servo); cả helper `ultrasonicCm` = 3 × `digitalWrite` + 2 + 10 µs trigger + 20 752 = **20 777,6875 µs** | `pulseIn` 20 785,44 µs khi có Servo (EMU-03); cả helper 20 812 µs (EMU-13, có Servo) | như L2e | virtual UNO không mô hình tải ngắt (ruling R1): lệch −34,3 µs = tải ngắt Servo trong 20,8 ms (0,163 %); `ultrasonicCmNoEcho` không được charge |
| `pulseIn` có echo dài hơn timeout | trả 0, charge đúng `timeoutUs` (30 000 µs) | 30 020,63 µs (EMU-03, chờ 450 + echo 30 500, có Servo) | như L2e | lệch 0,07 %; chưa có khoá `costsUs` riêng |
| `analogWrite` lên timer bị chiếm lúc chạy | chân LOW + cảnh báo `timer-claimed` (checkKit đã từ chối trước khi chạy) | chân LOW; `analogWrite(11, …)` khi tone đang kêu **đổi tần số tone** (EMU-05) | như L2e | simulator không mô hình đổi tần số tone: kit/program như vậy bị từ chối `timer-claimed` trước khi chạy |
| `pulseIn` đọc ngắn | độ rộng chính xác | −0…1,10 % (−2…3 % khi có tone) | như L2e + sai số cảm biến | dung sai chấm điểm ≥ 3 % + 1 cm |
| Thời lượng tone | `ms` chính xác | `floor(2·hz·ms/1000)` nửa chu kỳ | như L2e | khác rõ chỉ ở Hz thấp × ms ngắn: 31 Hz trong 40 ms là một xung, hết sớm 7,2 ms (EMU-16); harness C2: tone tự hết được sớm tới một chu kỳ (`tone-duration`) |
| Duty D5/D6 | v/255 | v/256 | (v+1)/256 (DS-01) | ≤ 1/256 chu kỳ |
| USART | 1040 µs/byte, hàng 64 | 1044,17 µs/byte, hàng 64 | 1040, hàng 65 | ≤ 0,4 % + 1 byte |
| Chi phí lệnh ngắn | bảng `costsUs` | tuỳ LTO của chương trình: −8…−41 % khi gập với hằng (EMU-09); `tone()` riêng ở dòng dưới | như L2e | parity thời gian chỉ cho khoảng ≥ 1 ms; harness C2: lời gọi ngắn hơn tới 41 % (`call-costs`) |
| Chi phí `tone` theo chương trình (0.1.6, 0.1.7) | băng `toneUs` (lời gọi không bị gập) | ở 1000 Hz, chân không kêu: tần số literal với 1, 2, 3, 5 chỗ gọi 17,6875 / 99,75 / 138,9375 / 178,5625 µs (`-flto` inline và gập); một chỗ gọi literal 17,625…17,75 µs ở mọi băng; tần số tính lúc chạy 213,375 / 187,9375 / 187,9375 / 181,5625 µs; `tone()` inline trong `sequenced-reads` ≥ 240,1 µs ở 500 Hz (EMU-18, EMU-16) | như L2e | harness C2, theo giá của băng trong contract cho lời gọi (chân không kêu hay đang kêu), không theo cái simulator đã charge: literal xuống tới sàn 17,625 µs, chậm hơn tới 0,47 %; tính lúc chạy nhanh hơn tới 2,80 %, chậm hơn tới 17,52 % (`tone-fold`) |
| Chân thả nổi / pull-up | không cho đọc (domain) | đọc LOW | ngẫu nhiên / HIGH | bị domain loại |
| Xung servo đầu tiên sau `attach` (0.1.4) | góc có ngay từ `attach` trong `setup()` | xung đầu sau **52 802 µs**: `attach` xoá Timer1 về 0 ở /8, so khớp đầu tiên khi bộ đếm tràn về 0 (65 536 × 0,5 µs = 32 768 µs), rồi một khung 20 ms (EMU-16); xung đầu đó **dài hơn** xung ổn định ngay sau nó: 3,5625 µs trên D9 (`driver-servo`), **4,5625 µs trên D10** (`rehearsal-driver-servo`, diễn tập đổi kit N18 R8a) | như L2e | servo trên board bắt đầu chậm ≈ 53 ms; đổi góc sau đó hiện trong một khung (20 ms); harness C2 (`servo-first-pulse`, `firstWidthUs`) ghép xung đầu vào run của góc khi độ rộng của nó lệch xung sau tới **6 µs** (dài hơn hoặc ngắn hơn; thời gian ngắt Timer0 5,97 µs làm tròn lên), các xung ổn định vẫn ≤ 4 µs (`waveform-jitter`). N19: servo **thứ hai** của Timer1 (tay của tay gắp) có một xung ngay ở lần tràn đầu (32 817 µs sau `attach`, `Channel[]` của Servo 1.3.0 bắt đầu từ 0), xung kế sau một khung cộng xung của servo trước (53 363 µs): harness ghép nó vào run khi chu kỳ đầu dài hơn khung tối đa một xung (`timerWrapUs`) |
| Pha của PWM, xung servo, tone (0.1.4) | đổi ngay trong lời gọi | hiện ở chu kỳ kế tiếp của timer: ≤ 1024 µs (T0), 2040 µs (T1/T2), 20 ms (servo), một chu kỳ tone (EMU-16) | như L2e | harness C2 so sự kiện waveform như một khoảng một chu kỳ |
| Thời gian Serial (0.1.4) | **chưa charge** (§7, ghi chú C1 fix round 1) | mô hình §7: 6,28 µs mỗi byte vào hàng, `print(long)` 9,375 + 45,1875 µs mỗi chữ số, `println` 17,25 µs, hàng 64 byte rồi 1044,17 µs/byte (EMU-08); `Serial.begin(9600)` 4,75 µs (EMU-17) | §7 với 1040 µs/byte, hàng 65 | giá trị in khớp (EMU-16); khoảng có in dài hơn trên board đúng chừng đó; harness C2 tính giờ từng dòng trên USART (`serial-time`) |
| Join in từng phần (0.1.5) | đánh giá mọi phần rồi in cả dòng | mỗi phần một `Serial.print`, đánh giá lần lượt: byte đầu có thể ra trước khi đọc phần sau (§7, ghi chú) | như L2e | dòng của join có thể bắt đầu ngay từ đầu câu lệnh in (`join-by-parts`) |
| Chân thành OUTPUT LOW trước (0.1.5) | INPUT → mức hay waveform ngay | `analogWrite`, `Servo.attach`, `tone` đầu tiên gọi `pinMode(OUTPUT)` trước: chân LOW rồi mới HIGH/PWM/xung (EMU-16) | như L2e | harness C2 thêm LOW đó vào trace simulator ở đầu lời gọi, trong 8,3125 µs đầu (phần lời gọi làm trước `pinMode`, lâu nhất trong các fixture), nên chính lời gọi được tính giờ từ đầu nó (`output-low-first`) |
| Rung xung servo, tone (0.1.5) | chu kỳ và độ rộng chính xác | xung servo và đảo chân tone do ngắt đặt: chu kỳ servo 20 002,8…20 005,6 µs, độ rộng ±1 µs (EMU-03); N19: trên xe tay gắp ngắt TWI (tới 20,125 µs) và Timer0 giữ ngắt Servo, xung dài thêm tới 5,1875 µs (EMU-19) | như L2e | harness C2 cho chu kỳ trong một waveform lệch ≤ 1 % (≥ 8 µs), PWM ≤ 4 µs (`waveform-jitter`); xung servo của fixture `ref-uno-gripper@0` ≤ 6 µs (`gripperHighUs`, G0.2 ruling c1), của rover vẫn 4 µs |
| Gốc thời gian của `millis()` (0.1.5) | t từ đầu `setup()` | Timer0 bắt đầu 0…7,9 µs trước `setup()` (EMU-12) | như L2e | chương trình chờ `millis()` đổi giá trị: lúc nó đổi là mốc, trên board trong khoảng 7,9 µs (`millis-origin`) |
| Tần số tone (0.1.5) | `hz` đúng như hỏi | tần số Timer2 làm được: 440 → 440,141 Hz (EMU-13) | như L2e | harness C2 so tần số ±1 % (`tone-frequency`) |

Diagnostics (`unoContract.diagnostics`):

| ID | Mức | Khi nào |
|---|---|---|
| `value-out-of-range` | error | literal ngoài domain (int32, chờ 0…60000, `end` của count up) |
| `descending-range-not-supported` | error | count up literal `start > end` |
| `out-of-domain` | error | giá trị tính ra ngoài domain lúc chạy (simulator dừng) |
| `timer-claimed` | error | PWM trên chân mà servo (T1) hoặc còi (T2) của kit giữ timer |
| `pin-unavailable` | error | chân thô kit đang dùng, chân thả nổi, D0/D1 khi có in |
| `capability-unavailable` | error | block nhắc role kit không có |
| `value-clamped` | warning | tốc độ / góc / tone / PWM ngoài khoảng, đã kẹp; một lần mỗi role (chân) mỗi run |
| `not-pwm` | warning | PWM trên chân không PWM: ≥ 128 HIGH, ngược lại LOW |
| `division-by-zero` | warning | `/` hoặc `%` cho 0 ra 0; một lần mỗi block mỗi run |
| `low-memory` | warning | L2: biến toàn cục > 1536 B |

---

## 14. Evidence references

Ngày quan sát/truy cập: **2026-10-25**. EMU: avr8js 0.21.1 trên Node 24.22.1 (Apple M4 Pro), HEX từ arduino-cli 1.5.1 / arduino:avr@1.8.8 / Servo 1.3.0; số liệu trong `spikes/avr8js/out/results.json`. Cột "Claim được đỡ" mã hoá §0.4; cột cuối là field mà entry ghi nhận quan sát (validator chỉ cho phép entry đỡ field nằm trong cột này). TST (N18 final fix M4, 2026-10-26): một file test của repo và tên các test trong đó (nguyên văn, cách nhau bằng ` · `), chạy bằng `pnpm test <file>`; chỉ là evidence của mức L1 (§12), không đỡ field nào.

| ID | Kind | Nguồn | Thao tác | Quan sát (nguyên văn với ARD/DS/CXX) | Claim được đỡ | Field |
|---|---|---|---|---|---|---|
| EMU-01 | EMU | avr8js 0.21.1 (đầu §14) | sketches/blink: D13 HIGH 500 ms, LOW 500 ms | HIGH 500008.44 / 500012.19 / 500008.94 µs; LOW 500008.06 / 500010.94 / 500010.88 µs; pinMode(13, OUTPUT) takes D13 from INPUT to LOW at 11.25 µs | emu-trace | unit, block, default, content |
| EMU-02 | EMU | avr8js 0.21.1 (đầu §14) | sketches/motor: motorSet on D5/D7/D8 and D6/D4/D2 with 50, -100, -30, 1, 0 | D5 976.563 Hz HIGH 512 µs (128), 308 µs (77); D6 HIGH (255), 12 µs (3); IN pins as the sign says; 0: all LOW; the PWM goes on while the program waits | emu-trace | unit, round, yield, default, content |
| EMU-03 | EMU | avr8js 0.21.1 (đầu §14) | sketches/servo-pulsein: Servo D9 and pulseIn on D11 against scripted echoes (450 µs after TRIG, widths 116..30500 µs, none) | servo 544 + a·1856/180 µs every 20002.8..20005.6 µs; pulseIn 0..1.10 % short; echo end to return 2.625..3.3125 µs; no echo 20785.44 µs; echo beyond the timeout 30020.63 µs; cm 19 / 10 / 400 / 397 / 2 / 49 / 400 | emu-trace | unit, range, default, clamp, round, block, yield, return, content |
| EMU-04 | EMU | avr8js 0.21.1 (đầu §14) | sketches/servo-pwm10: analogWrite(10, 200) alone, after Servo.attach(9), while attached, after detach | alone 490.196 Hz duty 200/255; attach stops it and holds D10 LOW; analogWrite(10) while attached: LOW, no PWM; after detach still LOW; servo pulses go on | emu-trace | yield, error, content |
| EMU-05 | EMU | avr8js 0.21.1 (đầu §14) | sketches/tone-pwm11: analogWrite(11/3, 100) alone, tone(10, 1000), analogWrite while the tone plays, noTone, tone with 50 ms | alone 490.196 Hz; tone stops D3/D11 PWM (LOW); analogWrite(11) while the tone plays changes it to 2475.248 Hz; noTone, then a new analogWrite(11/3, 100), gives the PWM back; tone(10, 1000, 50) plays 49.36 ms and does not block | emu-trace | block, yield, error, content |
| EMU-06 | EMU | avr8js 0.21.1 (đầu §14) | sketches/pwm-pins: analogWrite on D3 D5 D6 D9 D10 D11 at once, and on D7 D8 A0 A1 | D5/D6 976.563 Hz, D3/D9/D10/D11 490.196 Hz, duty v/255 (avr8js gives v/256 on Timer0); 127 -> LOW, 128 -> HIGH, 200 -> HIGH, 0 -> LOW on pins without PWM | emu-trace | unit, range, yield, content |
| EMU-07 | EMU | avr8js 0.21.1 (đầu §14) | sketches/kit-rover: every module of ref-uno-rover@0 at once | servo 1007..1008 µs, tone 1000 Hz, D5 duty 128, D6 duty 204, IN levels, LED, button 1/0/1, analogRead 0/512/1023 for 0/2.5/5 V; echo 1160 µs read as 1125..1134 µs while the tone plays | emu-trace | range, yield, return, content |
| EMU-08 | EMU | avr8js 0.21.1 (đầu §14) | sketches/costs: each Arduino call between port-write markers, 8 samples, shortest minus the baseline | digitalWrite 73 cycles, digitalRead 63, analogRead 1693 (first 3229), analogWrite 123, millis 19, Servo.write 792, tone 2785, Serial byte queued 6.28 µs, beyond 64 bytes 1044.17 µs each (avr8js), empty loop() 5 cycles; Timer0 interrupt 0.583 %, one Servo 0.163 %, tone 1000 Hz 1.49 % | emu-trace | block |
| EMU-09 | EMU | avr8js 0.21.1 (đầu §14) | sketches/costs-const: the same calls with constant arguments in a small program | digitalWrite 58 cycles, analogWrite 73, Servo.write 726, tone(10, 1000) 94: -flto inlines or folds per program | emu-trace | block |
| EMU-10 | EMU | avr8js 0.21.1 (đầu §14) | sketches/lang: the int32 rules with volatile inputs | 300 * 200 = -5536, 300L * 200L = 60000; plain x + 1 > x (x = INT32_MAX) = 1 and (h * 2) / 2 = h: folded; -7/2 = -3, -7%2 = -1, 7%-2 = 1; INT32_MIN / -1 = INT32_MIN; x % -1 = 0; println(true) 1, println(false) 0; -1 < millis() is 0, -1 < (long)millis() is 1 | emu-trace | range, round, return, error, content |
| EMU-11 | EMU | avr8js 0.21.1 (đầu §14) | sketches/lang-wrap and lang-wrapv: plain operators, unsigned helpers, __builtin_*_overflow, an asm barrier, noinline, #pragma GCC optimize("wrapv") | every helper wraps correctly when no plain signed overflow runs in the program; after one, unsigned and builtin helpers are merged with it (CSE); the pragma makes plain operators wrap | emu-trace | round, return, error |
| EMU-12 | EMU | avr8js 0.21.1 (đầu §14) | sketches/millis-drift: 250 reads of millis() about 4 ms apart against the cycle counter | millis = n + floor(3n / 125), n = floor((t - t0) / 1024 µs): 250 of 250 for every t0 0..7.9 µs before setup() | emu-trace | unit, range, round, return |
| EMU-13 | EMU | avr8js 0.21.1 (đầu §14) | sketches/contract-forms: every C++ form and helper of this contract, with scripted echo, line, button and ADC | 29 of 29 checks: int32 helpers, bool 1/0, repeat and count up order, if / else if / else and while, UTF-8 and escaped text, (long)millis() on the model, motorSet and drive forms, servoSet clamps, buzzerTone clamps and re-tone, noTone, ultrasonicCm 19 cm (call 1675.5625 µs) and 400 (call 20812 µs; 1675.375 and 20806.3125 in the build without the if/while section), line, button, raw pins | emu-trace | unit, range, default, clamp, round, block, yield, return, error, content |
| EMU-14 | EMU | avr8js 0.21.1 (đầu §14); `node spikes/avr8js/run-tone-notone.mjs` (R1, không có trong `results.json`) | sketches/tone-notone: analogWrite(11/3, 100), tone(10, 1000), noTone with no new analogWrite, analogWrite again, tone(10, 1000, 30) that ends by itself, analogWrite again | alone 490.196 Hz duty 0.39216; tone: D3/D11 LOW; after noTone with no new analogWrite: D3/D11 LOW; a new analogWrite: 490.196 Hz again; after the 30 ms tone ended by itself: D3/D11 LOW; a new analogWrite: 490.196 Hz again | emu-trace | content |
| EMU-15 | EMU | avr8js 0.21.1 (đầu §14); `node spikes/avr8js/run-eval-order.mjs` (C1, không có trong `results.json`) | sketches/eval-order: se(v) and sb(v) print their value when they are evaluated, in the plain forms and in the sequenced form of §3.5 | plain: add32(se(1L), se(2L)) eval=2, eval=1; sub32(se(3L), se(4L)) 4, 3; f3(10, se(7L), se(8L)) 8, 7; add32(mul32(se(9L), se(10L)), se(11L)) 11, 10, 9; (se(5L) < se(6L)) 5, 6. Sequenced: (_s1 = se(1L), _s2 = se(2L), add32(_s1, _s2)) eval=1, eval=2; sub32 3, 4; (_s1 = se(7L), _s2 = se(8L), f3(10, _s1, _s2)) 7, 8; three temporaries 9, 10, 11; while ((_s1 = se(x), _s2 = se(2L), (_s1 < _s2))) evaluates both each time (0, 2, 1, 2, 2, 2); (sb(false) && sb(true)) and (sb(true) \|\| sb(false)) evaluate the left side only; (_s4 = (sb(true) && sb(false)), _s5 = sb(true), (_s4 == _s5)) 1, 0, 1, then prints 0 | emu-trace | content |
| EMU-16 | EMU | avr8js 0.21.1 on Node 24.22.1 (Apple M4 Pro); HEX built by scripts/build-parity-hex.mjs with arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8, Servo 1.3.0, Wire 1.0), tests/__parity__; the TWI through tests/parity/twi-device.ts (each phase after its bus time) to the TCS34725 model on both sides; pnpm test tests/uno-emulator-parity.test.ts (N18 C2; N19 C2 the gripper car's) | C2 parity: the generated sketch of every C1 language golden, of the raw-pins golden, of one program per driver op of ref-uno-rover@0, of five with an LED right after tone() (literal, computed, and a loop of one literal call site at 31, 121 and 200 Hz) and of negate-drive (28 fixtures); N19: of the gripper car's claw and arm, IR sensor, colour sensor with a scripted light and with none, and of every op of ref-uno-gripper@0 at once (5 fixtures, 33 in all); its HEX on avr8js against the simulator with the same scripted inputs; pin events and Serial lines compared, each timed from the anchor it depends on | 28 of 28 agree: every Serial line and pin state (duty, angle, tone ±1 %); every interval within its waits ±1 % and the allowed differences (largest with no line printed in it 0.276 %, driver-buzzer, but for the end of a tone that ends by itself: at 31 Hz a 40 ms tone is one pulse, its end 7246 µs early, tone-duration; lines queued behind the one before ≤ 0.58 µs; an LED right after a computed tone() in driver-tone-computed ≤ 5.94 µs, after a literal one, folded, up to 87.25 µs early in driver-tone-led and 290.69 µs in the 121 Hz loop); a simulator 200 µs late after a first tone(), 950 µs inside a literal one or 2000 µs inside a first one fails; Servo 1.3.0 sends its first pulse 52802 µs after attach(); a PWM, servo or tone change shows within one timer period; tone() inlined in sequenced-reads took ≥ 240.1 µs (224.375 alone); N19: 5 of 5 gripper fixtures agree (every interval of 1 ms or more within 0.874 % with Serial in it, 0.013 % without; a gripper servo pulse within 6 µs; the lift, Timer1's second servo, pulses once at Timer1's first wrap, 32 817 µs after attach, and next a frame and the claw's 544 µs later; SDA and SCL INPUT_PULLUP from Wire.begin on both sides; a window ending between the first and the third data byte gives C from the window before and R, G, B from the next on both sides; no device: zeros and unknown) | emu-trace | block, yield, return, content |
| EMU-17 | EMU | avr8js 0.21.1 (đầu §14); `node spikes/avr8js/run-helper-costs.mjs` (N18 C2, không có trong `results.json`) | sketches/helper-costs: motorSet with run-time speeds -100..100 against its Arduino calls; tone(10, f, 100) at 31..4000 Hz on a silent pin and on a pin playing 1000 Hz; Serial.begin(9600) | motorSet(50) 58.875 µs, motorSet(-100) 63.75 µs (42.0625 / 42.75 µs beyond 2 digitalWrite + analogWrite as the simulator charges them); at every speed -100..100 on the PWM path 58.875 (50) .. 60.5 µs (-75, -97: 43.6875 beyond the calls, the longest); 0 and 100: 61.25, 63.25 µs; tone on a silent pin 308.8125 µs at 31 Hz, 307.125 at 100, 301.6875 at 200, 262.25 at 440, 224.375 at 500, 184.8125 at 1000, 184.625 at 1500, 184.4375 at 3000, 145.625 at 4000; on a playing pin 297.25, 295.5625, 290.125, 250.6875, 212.8125, 173.25, 173.0625, 172.875, 134.0625; Serial.begin(9600) 4.75 µs | emu-trace | block |
| EMU-18 | EMU | avr8js 0.21.1 (đầu §14); HEX của sketch generator sinh ra; `node spikes/avr8js/run-generated-tone.mjs` (N18 C2 fix round 2 và 3, không có trong `results.json`) | generated sketches: LED on; buzzerTone(BUZZER_PIN, <hz>, 20L); LED off, minus LED on; LED off, at 25 frequencies (the edges and inside of each Timer2 band), the frequency a literal or computed from two analogRead, on a silent pin and on a playing one, 75 call sites a program; the same at 1000 Hz in programs of 1, 2, 3 and 5 call sites; one literal call site at 10 frequencies (fix round 3) | computed, silent pin, longest per band: 306.5625 µs (31..121 Hz), 298.1875 (122..243), 258.9375 (244..486), 219.6875 (487..972), 181.5625 (973..3891), 143.3125 (3892..4000); playing pin 300.5625, 293.4375, 254, 214.625, 176.5625, 138.5; inside a band up to 5.3125 µs shorter on a silent pin, 6.5 µs (31..121 Hz) and 5.375 µs (244..486 Hz) on a playing one, 2.80 % at most (3892..4000 Hz, playing); with 75 call sites a literal frequency 0.25..6.25 µs shorter on a silent pin, -5.6875..+0.6875 µs on a playing one (longer at 122, 150, 200 Hz); at 1000 Hz with 1, 2, 3, 5 call sites: literal 17.6875, 99.75, 138.9375, 178.5625 µs (folded), computed 213.375, 187.9375, 187.9375, 181.5625; with 5 call sites at 31 Hz literal 308 µs (0.47 % over the band), computed 311; one literal call site at 31, 60, 121, 122, 200, 244, 440, 487, 1000, 4000 Hz: 17.625..17.75 µs | emu-trace | block |
| EMU-19 | EMU | avr8js 0.21.1 on Node 24.22.1 (Apple M4 Pro); HEX built by arduino-cli 1.5.1 for arduino:avr:uno (arduino:avr@1.8.8, Servo 1.3.0, Wire 1.0); the TWI through spikes/avr8js/twi-device.ts (each phase completes after its bus time from TWBR, datasheet 7810D §21.5.2) to the TS TCS34725 (src/core/hardware/devices/tcs34725.ts); node spikes/avr8js/run-gripper.ts (N19 G0.2, spikes/avr8js/out/gripper-results.json) | sketches/gripper-forms: gripperSet(gripperClaw / gripperLift) on D9 / D10 with 80, 0, 120, -10, 45, 0 after attach + write(0) / write(90); (digitalRead(A3) == LOW) with A3 scripted HIGH then LOW; colorBegin(), then colorRaw(3, 0, 1, 2) and colorIs(0..6) under seven scripted lights of 250 ms (red, green, blue, yellow, white, black, none), read 150 ms into each; ID, STATUS, ATIME, CONTROL read back; the same HEX with no device at 0x29 | every line as the TS side: C R G B red 11100 8047 1675 1377, green 8892 2165 4979 1747, blue 11150 988 4144 6017, yellow 17605 9565 6719 1320, white 21504 9717 8910 7297, black 3460 1292 1188 979, none 120 40 40 40; colorIs one 1 at the TS class of each (red, green, blue, yellow, white, black, unknown); ID 68, STATUS 1, ATIME 235, CONTROL 1; IR 0 then 1; Wire timeout flag 0; no device: every reading 0 0 0 0 and colorIs(6) only, ID 0, every transaction SLA+W NACK + STOP (85), no timeout; SCL 100000 Hz (TWBR 72, 160 cycles): every phase completes 160 × (1 START, 9 a byte, 1 STOP) cycles after its TWCR write, ≤ 5 cycles later (the instruction under way and an interrupt entry); transactions (START → STOP) against bus time + the CPU's uninterrupted service: W2 307.375 µs, W1 213, R1 213.125, R8 877.6875, NACK 118.1875 (bus 0.9457 of R8); with no other interrupt in them ≤ 0.899 % longer; with one, up to 3.081 % longer, never by more than the Servo, Timer0 and USART interrupts that ran in them; windows every 52800 µs (2.4 ms Init + 50.4 ms), the first ending 52800 µs after the ENABLE byte with AEN was written; every 8-byte read from a window wholly in its light; the eight data bytes read 336.5625…1021.4375 µs after the command write's START; servo pulses 544 / 1368 / 1472 / 544 µs (claw) and 1472 / 544 / 1008 µs (lift), 120 → 1472 and -10 → 544, each from the next frame; both on Timer1, the lift's pulse rising 10.75 µs after the claw's falls, frames 20003.0625 µs; a pulse 5.1875 µs long at most when a TWI or Timer0 interrupt held the Servo interrupt (TWI interrupt ≤ 20.125 µs: twi_stop() waits for the STOP inside it); avr8js sets TWINT after a STOP, the datasheet does not (§21.6): twi-device.ts clears it (left in place: +6.1875 µs a transaction, +12.375 µs a colorFetch) | emu-trace | range, default, clamp, round, block, yield, return, error, content |
| EMU-20 | EMU | as EMU-19 (node spikes/avr8js/run-gripper.ts, out/gripper-results.json); where each bus event of colorBegin and colorFetch falls from the call: node spikes/avr8js/run-gripper-timeline.ts (N19 A3, out/gripper-timeline.json) | sketches/gripper-costs: each helper call between port-write markers, 8 samples (colorFetch 32, colorBegin 4), shortest minus the baseline; the TCS34725 on the bus under white light, and the same HEX with no device at 0x29; for the shortest sample of colorBegin and colorFetch, every TWI phase (when the program asked for it and when it completed) and every call the bus made on the device | gripperSet 51.4375 / 51.4375 / 51.625 / 50.8125 µs (claw 45, lift 45, 120 clamped, -5 clamped; Servo.write 45 50.4375, 120 50.8125): gripperSet 51.625; digitalRead(A3) 3.9375 µs (A1 3.9375, D4 3.9375), (digitalRead(A3) == LOW) 4.1875; colorFetch 1158.5 µs (median 1159.625, max 1169.125; with both servos 1159.4375…1184.4375), NACK 146.0625; colorBegin 58367.6875 µs = 1350.5625 + delay(3) + delay(54) as the simulator charges them (its statements without the delays 1349.625); NACK 57606.5625 (589.4375); one register write (colorWrite) 334 µs (NACK 144.9375); colorClassify 128.125…147.25 µs by the rule that matches (zeros, no division: 12.5625); colorIs(4) on white 1299.75 (NACK 158.9375), colorRaw(3) 1160.4375 (NACK 148.1875); Wire's service before a bus phase 4.9375 µs (79 cycles between two bytes read: wirePhase); a helper's statements before Wire's first service: colorWrite 11.625 µs, colorFetch 9.1875; colorFetch between its command write and its read 10.5625 | emu-trace | block |
| CC-01 | CC | arduino-cli 1.5.1 (đầu §14) | Compiled the 15 spike sketches (ram-threshold 8 times) | All compile (ram-threshold refuses its 2049 B probe by design, CC-02); e.g. kit-rover 4752 B flash (14 %), 247 B RAM (12 %); 300 * 200 warns -Woverflow | compile-ok, compile-size, snapshot | call, import, module |
| CC-02 | CC | arduino-cli 1.5.1 (đầu §14) | sketches/ram-threshold with -DBIG=1000..2040 | 1536 B of globals (75.000 %): no warning; 1537 B (75.049 %) and above: "Low memory available, stability problems may occur."; 2049 B: "Not enough memory", the build fails; flash maximum 32256 B | compile-size | — |
| CC-03 | CC | arduino-cli 1.5.1 (đầu §14) | Compiled sketches/contract-forms with --warnings all | Compiles; no warning from the sketch (only from the core); 7474 B flash (23 %), 258 B RAM (12 %) | compile-ok, compile-size | call, import, module |
| CC-04 | CC | arduino-cli 1.5.1 + avr-objdump | Read countPulseASM | Wait-for-start loop 11 cycles, counting loop 16 cycles, one budget of `timeout` iterations; pulseIn returns (count · 16 + 16) / 16 µs | disassembly | block |
| CC-05 | CC | arduino-cli 1.5.1 (đầu §14) | Compiled sketches/eval-order with --warnings all | Compiles; no warning from the sketch (only from the core); 3118 B flash (9 %), 192 B RAM (9 %); long and bool temporaries at the top of setup(), the comma form in an assignment, a print, a while condition and a call statement | compile-ok, compile-size | call |
| CC-06 | CC | arduino-cli 1.5.1 compile --fqbn arduino:avr:uno --warnings all (arduino:avr@1.8.8, avr-gcc 7.3.0-atmel3.6.1-arduino7, Servo 1.3.0, Wire 1.0) | Compiled sketches/gripper-forms and sketches/gripper-costs with --warnings all; avr-nm -S of gripper-forms.ino.elf | Both compile; no warning from the sketches, Wire or Servo (only the core's new.cpp, 4); gripper-forms 7240 B flash (22 %), 456 B RAM (22 %); gripper-costs 9784 B (30 %), 491 B (23 %); Wire's RAM 216 B (five 32 B buffers, its state, the TwoWire object and vtable); COLOR_RULES in PROGMEM | compile-ok, compile-size | call, import, module |
| PKG-01 | PKG | gh api repos/arduino/ArduinoCore-avr/releases, repos/arduino-libraries/Servo/releases, repos/wokwi/avr8js/releases; arduino-cli version | Read the release dates | arduino:avr 1.8.8 2026-05-21; Servo 1.3.0 2025-11-06; avr8js v0.21.1 2026-08-31; arduino-cli 1.5.1 2026-06-05 | snapshot | — |
| ARD-01 | ARD | github.com/arduino/reference-en, Language/Functions/Analog IO/analogWrite.adoc (accessed 2026-10-25) | Read the page and quoted it | "UNO (R3 and earlier), Nano, Mini \| 3, 5, 6, 9, 10, 11 \| 490 Hz (pins 5 and 6: 980 Hz)"; "`value`: the duty cycle: between 0 (always off) and 255 (always on)"; "…until the next call to `analogWrite()` (or a call to `digitalRead()` or `digitalWrite()`) on the same pin"; "The PWM outputs generated on pins 5 and 6 will have higher-than-expected duty cycles" | documented | unit, range, content |
| ARD-02 | ARD | github.com/arduino/reference-en, Language/Functions/Analog IO/analogRead.adoc (accessed 2026-10-25) | Read the page and quoted it | "…into integer values between 0 and 1023"; "it takes about 100 microseconds (0.0001 s) to read an analog input" | documented | range, block, return |
| ARD-03 | ARD | github.com/arduino/reference-en, Language/Functions/Advanced IO/tone.adoc (accessed 2026-10-25) | Read the page and quoted it | "Only one tone can be generated at a time. … If the tone is playing on the same pin, the call will set its frequency."; "Use of the `tone()` function will interfere with PWM output on pins 3 and 11"; "It is not possible to generate tones lower than 31Hz."; "`duration`: the duration of the tone in milliseconds"; "This function is non-blocking" | documented | unit, range, block, error, content |
| ARD-04 | ARD | github.com/arduino/reference-en, Language/Functions/Advanced IO/pulseIn.adoc (accessed 2026-10-25) | Read the page and quoted it | "Returns the length of the pulse in microseconds or gives up and returns 0 if no complete pulse was received within the timeout."; "`timeout` (optional): the number of microseconds to wait for the pulse to start" | documented | unit, return |
| ARD-05 | ARD | github.com/arduino/reference-en, Language/Functions/Time/millis.adoc (accessed 2026-10-25) | Read the page and quoted it | "Number of milliseconds passed since the program started. Data type: `unsigned long`."; "This number will overflow (go back to zero), after approximately 50 days." | documented | unit, range, return |
| ARD-06 | ARD | github.com/arduino/reference-en, Language/Functions/Digital IO/digitalRead.adoc (accessed 2026-10-25) | Read the page and quoted it | "If the pin isn't connected to anything, `digitalRead()` can return either `HIGH` or `LOW` (and this can change randomly)." | documented | range |
| ARD-07 | ARD | github.com/arduino/reference-en, Language/Functions/Communication/Serial.adoc (accessed 2026-10-25) | Read the page and quoted it | "On older boards (Uno, Nano, Mini, and Mega), pins 0 and 1 are used for communication with the computer. Connecting anything to these pins can interfere with that communication" | documented | range |
| ARD-08 | ARD | github.com/arduino/reference-en, Language/Functions/Communication/Serial/write.adoc (accessed 2026-10-25) | Read the page and quoted it | "Serial transmission is asynchronous. If there is enough empty space in the transmit buffer, `Serial.write()` will return before any characters are transmitted over serial. If the transmit buffer is full then `Serial.write()` will block until there is enough space in the buffer." | documented | block |
| ARD-09 | ARD | github.com/arduino/reference-en, Language/Variables/Data Types/long.adoc (accessed 2026-10-25) | Read the page and quoted it | "…store 32 bits (4 bytes), from -2,147,483,648 to 2,147,483,647."; "…either an integer constant followed by an L or a variable of type long, forcing it to be a long." | documented | range |
| ARD-10 | ARD | github.com/arduino/reference-en, Language/Variables/Data Types/int.adoc (accessed 2026-10-25) | Read the page and quoted it | "an int stores a 16-bit (2-byte) value"; "The result of an overflow is unpredictable so this should be avoided." | documented | range, error |
| ARD-11 | ARD | github.com/arduino/reference-en, Language/Structure/Sketch/setup.adoc (accessed 2026-10-25); github.com/arduino/reference-en, Language/Structure/Sketch/loop.adoc (accessed 2026-10-25) | Read the page and quoted it | "The `setup()` function will only run once, after each powerup or reset of the Arduino board."; "the `loop()` function does precisely what its name suggests, and loops consecutively" | documented | block, content |
| ARD-12 | ARD | Servo 1.3.0 docs/readme.md (installed library; github.com/arduino-libraries/Servo) | Read the page and quoted it | "On boards other than the Mega, use of the library disables `analogWrite()` (PWM) functionality on pins 9 and 10, whether or not there is a Servo on those pins." | documented | error, content |
| ARD-13 | ARD | Servo 1.3.0 docs/api.md (installed library) | Read the page and quoted it | "_min_ (optional): the pulse width, in microseconds, corresponding to the minimum (0 degree) angle on the servo (defaults to 544)"; "…maximum (180 degree) angle on the servo (defaults to 2400)"; "_angle_: the value to write to the servo, from 0 to 180" | documented | unit, range |
| ARD-14 | ARD | github.com/arduino/reference-en, Language/Functions/Communication/Serial/print.adoc (accessed 2026-10-25) | Read the page and quoted it | "Numbers are printed using an ASCII character for each digit."; "You can pass flash-memory based strings to `_Serial_.print()` by wrapping them with F()." | documented | content |
| ARD-15 | ARD | github.com/arduino/reference-en, Language/Structure/Arithmetic Operators/remainder.adoc (accessed 2026-10-25) | Read the page and quoted it | "If the *first* operand is negative, the result is negative (or zero)." | documented | round |
| ARD-16 | ARD | github.com/arduino/reference-en, Language/Functions/Digital IO/pinMode.adoc (accessed 2026-10-25) | Read the page and quoted it | "It is possible to enable the internal pullup resistors with the mode `INPUT_PULLUP`." | documented | default |
| ARD-17 | ARD | github.com/arduino/reference-en, Language/Functions/Time/delay.adoc (accessed 2026-10-25) | Read the page and quoted it | "Pauses the program for the amount of time (in milliseconds) specified as parameter." | documented | unit, block |
| ARD-18 | ARD | Wire 1.0 of arduino:avr 1.8.8, libraries/Wire/src/Wire.cpp and utility/twi.c (installed; LGPL-2.1-or-later; sha256 in spikes/avr8js/out/gripper-results.json wire.sha256) | Read the page and quoted it | Wire.cpp setWireTimeout: "This limits the maximum time to wait for the TWI hardware. If more time passes, the bus is assumed to have locked up … and the transaction is aborted. Optionally, the TWI hardware is also reset"; "@param reset_with_timeout if true then TWI interface will be automatically reset on timeout"; twi.c twi_writeTo: "Output 0 .. success, 1 .. length to long for buffer, 2 .. address send, NACK received, 3 .. data send, NACK received, 4 .. other twi error"; twi_init sets TWBR = ((F_CPU / TWI_FREQ) - 16) / 2 with TWI_FREQ 100000L | documented | call, error, block |
| DS-01 | DS | Microchip DS40002061A, ATmega48A/PA/88A/PA/168A/PA/328/P datasheet (PDF downloaded 2026-10-25) | Read and quoted | "The port pins are tri-stated when reset condition becomes active, even if no clocks are running."; "If the OCR0A is set equal to BOTTOM, the output will be a narrow spike for each MAX+1 timer clock cycle."; "A normal conversion takes 13 ADC clock cycles. The first conversion after the ADC is switched on … takes 25 ADC clock cycles"; "For single ended conversion, the result is ADC = VIN · 1024 / VREF" | documented | default, round, block |
| DS-02 | DS | TCS3472 color light-to-digital converter with IR filter, TAOS135, ams/TAOS, August 2012 (cdn-shop.adafruit.com/datasheets/TCS34725.pdf, sha256 acf2584428f14e925436c0038c863041fd73a6a10efc87049fdd3da60e466295, downloaded 2026-10-26) | Read and quoted | Table 6 (ATIME): "Max RGBC Count = (256 − ATIME) × 1024 up to a maximum of 65535", 2.4 ms per integration cycle; Table 5 note 2: "A minimum interval of 2.4 ms must pass after PON is asserted before an RGBC can be initiated."; System Timing: "Upon completion and return to Idle, the device will automatically begin a new Wait-RGBC cycle" (each cycle runs RGBC Init 2.4 ms, Figure 9); RGBC Channel Data Registers: "when the lower byte register is read, the upper eight bits are stored into a shadow register, which is read by a subsequent read to the upper byte"; the command register's auto-increment (TYPE 01) and the TCS34725's address 0x29 and ID 0x44 (Table 12) | documented | unit, range, default, round, block, content |
| CXX-01 | CXX | eel.is/c++draft/expr.mul (accessed 2026-10-25) | Read the section and quoted it | "If the second operand of / or % is zero, the behavior is undefined. For integral operands, the / operator yields the algebraic quotient with any fractional part discarded; if the quotient a/b is representable in the type of the result, (a/b)*b + a%b is equal to a; otherwise, the behavior of both a/b and a%b is undefined." | documented, language | round, return, error |
| CXX-02 | CXX | eel.is/c++draft/basic.fundamental (accessed 2026-10-25) | Read the section and quoted it | "…arithmetic for the unsigned type is performed modulo 2N. Unsigned arithmetic does not overflow." | documented, language | return, error |
| CXX-03 | CXX | GCC 7.3 manual, "Integers implementation" (gcc.gnu.org/onlinedocs/gcc-7.3.0, accessed 2026-10-25); eel.is/c++draft/conv.integral (accessed 2026-10-25) | Read the section and quoted it | "For conversion to a type of width N, the value is reduced modulo 2^N to be within range of the type; no signal is raised."; "If the source type is bool, the value false is converted to zero and the value true is converted to one." | documented, language | range, return, content |
| CXX-04 | CXX | eel.is/c++draft/lex.icon (accessed 2026-10-25) | Read the section and quoted it | "The type of an integer-literal is the first type in the list in Table 8 corresponding to its optional integer-suffix in which its value can be represented." | documented, language | range |
| CXX-05 | CXX | eel.is/c++draft/expr.rel (accessed 2026-10-25); eel.is/c++draft/expr.eq (accessed 2026-10-25); eel.is/c++draft/expr.log.and (accessed 2026-10-25); eel.is/c++draft/expr.log.or (accessed 2026-10-25); eel.is/c++draft/expr.unary.op (accessed 2026-10-25) | Read the section and quoted it | relational: "The type of the result is bool."; equality: "…a result of type bool"; &&: "the second operand is not evaluated if the first operand is false"; \|\|: "the second operand is not evaluated if the first operand evaluates to true"; !: "The type of the result is bool." | documented, language | return |
| CXX-06 | CXX | eel.is/c++draft/conv.prom (accessed 2026-10-25) | Read the section and quoted it | "A prvalue of type bool can be converted to a prvalue of type int, with false becoming zero and true becoming one." | documented, language | return, content |
| CXX-07 | CXX | eel.is/c++draft/stmt.for (accessed 2026-10-25); eel.is/c++draft/intro.execution (accessed 2026-10-25) | Read the section and quoted it | for: "…is equivalent to { init-statement while ( condition ) { statement expression ; } }"; "Every value computation and side effect associated with a full-expression is sequenced before every value computation and side effect associated with the next full-expression to be evaluated." | documented, language | range, content |
| CXX-09 | CXX | eel.is/c++draft/expr.comma (accessed 2026-10-25) | Read the section and quoted it | "A pair of expressions separated by a comma is evaluated left-to-right; the left expression is a discarded-value expression. The left expression is sequenced before the right expression ([intro.execution]). The type and value of the result are the type and value of the right operand" | documented, language | content |
| CXX-10 | CXX | eel.is/c++draft/expr.call (accessed 2026-10-25); eel.is/c++draft/intro.execution (accessed 2026-10-25) | Read the section and quoted it | call: "The initialization of a parameter … including every associated value computation and side effect, is indeterminately sequenced with respect to that of any other parameter."; "Except where noted, evaluations of operands of individual operators and of subexpressions of individual expressions are unsequenced." | documented, language | content |
| TST-01 | TST | `src/core/codegen/arduino/generate.parity.test.ts` | "the interpreter prints what the contract says the sketch prints" · "runs the language goldens, the names golden, the deepest nesting and the sequenced reads (contract §3.5)" · "checks something: the wrap, the truncation and the zero of the board, not of JavaScript or Python" | The 14 C1 goldens that end on their own (empty-program, mul-literal, int32-wrap, division-by-zero, count-up-bounds-once, count-up-body-changes-variable, millis-compare, print-mixed, nested-control, names, deep-nesting, sequenced-reads, while-two-reads, logic-reads) run in the interpreter on the virtual clock and the virtual UNO to their end and print exactly what the arithmetic of contract §3 gives (contract-int32.ts, not the simulator's code); a division or a remainder by 0 gives 0 and warns division-by-zero | sim-semantic | — |
| TST-02 | TST | `src/core/program/ybc-uno-interpreter.test.ts` | "wraps, truncates, takes the sign of the dividend and prints a truth value as 1 / 0" · "gives INT32_MIN for INT32_MIN / -1 and 0 for x % -1" · "gives 0 for a division or a remainder by zero, goes on, and warns division-by-zero once per block in a run (U-06)" · "counts up with the start evaluated before the end, each once, and leaves the variable at the last value" · "leaves the variable as it was when the start is past the end at run time, and stops at a computed end past 2147483646" · "runs a repeat of any long count: zero or less runs none, where Python would refuse a count past a million" · "gives a uno forever no pause of its own: each iteration is one loop() call of the budget, then its step" | A cxx-int32 program: 2147483647 + 1 = -2147483648, -7 / 2 = -3, -7 % 2 = -1, 7 % -2 = 1, true and false print 1 and 0, a join prints its parts; INT32_MIN / -1 and 0 - INT32_MIN are INT32_MIN, x % -1 is 0; x / 0 = x % 0 = 0 with one warning per block per run; count up reads start then end, once each, and leaves the variable at the last value, none for a start past the end, out-of-domain past 2147483646; repeat N <= 0 runs none; forever has no pause of its own | sim-semantic | — |
| TST-03 | TST | `src/core/program/uno-modules-interpreter.test.ts` | "motor.set(motorLeft, 50) → D5 duty 128, D7 HIGH, D8 LOW; the other motor is not even set up" · "drives forward 60, spins left 40, then stops, as the contract traced it (EMU-13)" · "negates a computed drive speed of INT32_MIN as neg32 does, so both motors run full backward, each warned once" · "turns the servo (90° from setup), the LED, and plays and stops the buzzer" · "clamps a computed speed of 150 and warns once, however often and from whichever block of that role" · "clamps a buzzer tone’s Hz and ms, one warning for the buzzer" · "ultrasonic.cm returns 400 when nothing echoes, and charges 20 752 µs + the trigger" · "reads an echo of 1160 µs after 450 µs as 20 cm, in the 1675.5625 µs the contract measured (EMU-13)" · "reads the line sensors, the raw line value and the button from the pins the world drives" · "reads millis on the board’s Timer0 model: n + floor(3n / 125) with n Timer0 overflows of 1024 µs (EMU-12)" · "sets a digital-write pin OUTPUT in setup(), then HIGH; reads the button pin and an analog line pin" · "reads the button pin raw with no button block as the board does: HIGH released (its INPUT_PULLUP in setup), LOW pressed (fix round 1)" · "clamps a computed PWM value to 0..255 and warns once per pin" | Module calls on ref-uno-rover@0 through the drivers and the virtual UNO: motor 50 → D5 duty 128, D7 HIGH, D8 LOW; forward 60 [153, 153, 1, 0, 1, 0], spin left 40 [102, 102, 0, 1, 1, 0], stop all 0; a speed of INT32_MIN through neg32 clamped to -100 on both motors; a speed of 150 clamped to 100 with one warning; servo 90° from setup then 45°; LED D13 HIGH / LOW; tone 880 Hz on D10, stop: none; 9000 Hz clamped to 4000; no echo 400 cm in 20 777.6875 µs, an echo of 1160 µs 20 cm; line dark 1 / 0, line raw 900, button 1; millis 99 after a wait of 100 ms (Timer0 model); raw digital write OUTPUT HIGH, digital read 1, analog read 512, the button pin raw HIGH released (INPUT_PULLUP) and LOW pressed; PWM 300 clamped to 255 with one warning | sim-semantic | — |
| TST-04 | TST | `src/core/run/robot-run-session.test.ts` | "“drive forward 50 % for 2 s then stop” moves the rover about the distance the kit’s speed gives, into the zone; reach-zone passes" · "tells the block the program is in: the wait while it waits, none once it finished" · "the ultrasonic hears the wall ahead through pulseIn (cm·58 µs), and nothing in an open arena (400 cm)" · "a line sensor over the tape reads dark through line.dark (the LED shows it)" · "the scenario’s inputs press the button at their atS; pressButton presses it from the next tick, but not during a check" · "the servo, the LED and the buzzer reach the world, the snapshot and the goal frame" · "refuses a program whose servo takes the timer its motor needs (timer-claimed), and a program that does not compile" | The session runs the program in the world: forward 50 % for 2 s then stop travels the kit's v·(2 s - τ) within 5 % into the zone; a wait of 500 ms is the running block at 0.25 s and the program has finished at 0.6 s; the ultrasonic reads the wall as trunc(cm·58) µs and 400 cm in an open arena; a line sensor over the tape reads dark; the scenario's button presses reach the program at their tick; the servo turns the arm to 45°, the LED and a 440 Hz tone reach the world and end when the tone does; a servo on the timer its motor needs is refused with timer-claimed | sim-semantic | — |
| TST-05 | TST | `tests/uno-blockly-conformance.test.ts` | "Basic: motor, servo, LED, buzzer tone and the three sensor reads compile and run on the virtual UNO" · "Basic: the drive in each direction Blockly offers, and stop" · "Advanced: the raw line value, buzzer stop, millis and the raw pins" · "Advanced: a PWM write is pin-unavailable on ref-uno-rover@0 at the pin Blockly starts with, and drives a pin a kit leaves free" · "Basic: the UNO’s own division and count up (fix round 1): -7 / 2 is -3, the count goes by 1 and saves no step" | The robot's blocks as Blockly 13 saves them, compiled and run on the virtual UNO: motor 50 → D5 duty 128, servo 45°, LED HIGH, tone 880 Hz, ultrasonic 30 cm, line dark 1, button 1; forward, backward, spin left and right set IN1/IN2 as the contract says, stop sets both duties 0; a wait of 100 ms then millis 99, line raw 700, buzzer stop, raw digital write OUTPUT HIGH, digital read 1, analog read 300; PWM 200 on a free D10; -7 / 2 = -3 and a count up 1..3 by 1 | sim-semantic | — |
| TST-06 | TST | `src/core/hardware/virtual-uno.test.ts` | "drives a pin without PWM HIGH from 128 up and LOW below (EMU-06), warning once per pin" · "drives a duty on a PWM pin (v/255, contract §5.1), 0 LOW and 255 HIGH, and charges each its measured cost" · "clamps to 0..255 as the pwmWrite helper does (U-32), with value-clamped once per pin" · "a servo takes Timer1: PWM on D10 stays LOW and warns timer-claimed, also when the PWM came first (EMU-04)" · "a tone takes Timer2 while it plays: D3/D11 PWM stays LOW, and stays off after noTone until a new analogWrite (Tone.cpp:449)" · "a tone that ends by itself frees Timer2 the same way: no PWM on D3/D11 until a new analogWrite (contract EMU-14, phase E)" | The virtual UNO's analogWrite: on a pin without PWM HIGH from 128 and LOW below; a duty of v/255 on a PWM pin, 0 LOW and 255 HIGH; values clamped to 0..255; a servo holds Timer1 and a tone Timer2: PWM on D9/D10 and D3/D11 stays LOW with timer-claimed, also after noTone or a tone that ended, until a new analogWrite | sim-semantic | — |
| TST-07 | TST | `src/core/run/virtual-clock.program.test.ts` | "repeat 100 × wait 10 ends at exactly 1000 ms virtual" · "ends every wait on its own mark, not on the tick after it" · "charges every uno forever iteration LOOP_MIN_US plus its nodes: an empty loop() is 51 µs" | The interpreter on the virtual clock: 100 waits of 10 ms end at exactly 1000 ms, 1000.85625 ms with the delay() overhead of 8.5625 µs each (ms × 1000 + delayOverhead, U-18), 1001.15825 ms with the program's own 302 nodes, and no tick rounds a wait up; the k-th wait ends on its own mark (running time 10k ms, 10k + 1 from k = 74 as the overhead adds up); an empty uno forever charges LOOP_MIN_US + 1 node, 51 µs an iteration | sim-semantic | — |
| TST-08 | TST | `src/core/hardware/drivers/gripper-drivers.test.ts` | "attaches both servos in setup(), claw 0° (open) and lift 90° (up), whichever op the program uses, and takes Timer1" · "turns the claw on D9 and the lift on D10, each call gripperSet’s 51.625 µs; with both ops used, setup() still attaches each servo once" · "sees an object while A3 reads LOW (activeLow), sets A3 up as an INPUT, and costs one digitalRead" · "every palette colour (#d32f2f, #388e3c, #1976d2, #fbc02d, #f5f5f5, #212121) classifies the same in the TS rules and in the C++ table text" · "first integration ready 2.4 ms + 50.4 ms after the AEN byte (the 52.8 ms cycle of §11): after setup() a read has the first window" · "NACK gives zeros, which classify as không rõ (unknown): setup() and each read take their NACK times and warn wire-nack once" · "charges colorFetch (1158.5 µs) for a raw read and colorClassify for color.is: the longest rule, or the no-division path on zeros" · "a window ending mid-read gives the board’s result: C (read first) from the window before, R, G, B from the window after" | The gripper car's drivers on the virtual UNO through the module binding: both servos attached in setup() at claw 0° and lift 90°, gripperSet 51.625 µs a call; the IR sensor on A3 an INPUT, an object while it reads LOW; every palette colour classified alike by the TS rules and the C++ table; the first window 2.4 + 50.4 ms after AEN; no sensor reads zeros, unknown, at the NACK times; colorFetch 1158.5 µs and colorClassify per rule; a window ending inside the read gives C from the window before and R, G, B from the next | sim-semantic | — |
| TST-09 | TST | `src/core/program/ybc-uno-gripper.test.ts` | "claw 120 clamps to 90 and warns once" · "reads the IR sensor on A3: true while the module pulls it LOW (activeLow), false while it is HIGH" · "color.is red true for the red palette window" · "color.raw c in 0..21504: a light that saturates the window reads 21504, no sensor reads 0 and is unknown" · "a color.is read never leads the world by more than one tick: every bus event within [world.t, world.t + dt + 1123.8125 µs)" | The gripper car's ops as IR on the interpreter, the virtual clock, the module binding, the virtual UNO and the TCS34725 model: a computed claw angle of 120 clamped to 90 with one warning for the gripper (its lift too); the IR sensor true while A3 is LOW; color.is red true and green and unknown false under the red palette light; a saturating light reads 21504 on clear and red, no sensor 0 and unknown; every bus event and light integral of a color.is loop within [world.t, world.t + dt + 1123.8125 µs) | sim-semantic | — |
| TST-10 | TST | `tests/uno-blockly-conformance.test.ts` | "Basic: the gripper car’s claw, arm, IR and colour compile and run on the virtual UNO" · "Advanced: the raw colour value, 0 to 21504 (the window saturates at its ATIME)" | The gripper car's blocks as Blockly 13 saves them, compiled for ref-uno-gripper@0 and run on the virtual UNO: close → 80 and down → 0 as literals, then the claw at 40° on D9 and the arm at 45° on D10; the IR sensor 1 with A3 LOW; red 1 and green 0 under a red light; the raw clear and red values 21504 under a saturating light | sim-semantic | — |
| CXX-08 | CXX | GCC 7.3 manual, "Common Function Attributes" (optimize) and "Code Gen Options" (-fwrapv) (accessed 2026-10-25) | Read and quoted | "This attribute should be used for debugging purposes only. It is not suitable in production code."; -fstrict-overflow: "…overflow when doing arithmetic with signed numbers is undefined" | context | — |

Tái lập toàn bộ EMU/CC: `node spikes/avr8js/run-all.mjs` (≈ 20 s; cần `arduino-cli` với core và Servo như §1).

---

## 15. Bản máy đọc được (`src/core/compat/uno-contract.ts`)

- Shape: `UnoContract`, `unoContractSchema` (Zod) trong `contract-types.ts`; mở rộng **cộng thêm** so với Yolo:Bit: `ConstructContract.cpp?: { form; variants?; includes; libraries; helpers?; globals?; setup? }` (`variants`: dạng chính xác khác của cùng dòng, evidence `call` của dòng đã đỡ, C1), `ConstructContract.levels?: { L1; L2; L2e; L3 }`, `Profiles`/`Tier` gồm `uno-basic | uno-advanced`, `ModuleContract.library?`, các evidence kind và claim kind mới. Shape và test của Yolo:Bit không đổi (`yolobitContractSchema` vẫn từ chối profile UNO trong dòng Yolo:Bit).
- Luật: `rulesOf(contract)` chọn `YOLOBIT_RULES` hay `UNO_RULES` (scope evidence, field ↔ claim kind, kind cho VERIFIED/DOCUMENTED, emulator có thể bị thu hồi, loại mapping, profile). Mọi hàm của `contract-validation.ts` (`claimProblems`, `entrySemanticProblems`, `exposureViolations`, `profileConstructViolations`, `validateContract`, …) đọc luật đó.
- Data chỉ được **test** đọc (như `yolobit-contract.ts`); virtual UNO, driver, generator chép giá trị chúng dùng. Test `is read by tests only` kiểm.

**Invariant (test `uno-contract.test.ts`):**
1. Mọi dòng có đủ 15 field, mọi module đủ 2 field; schema đúng (dòng và module đều strict: một khoá lạ, viết sai hay `unverifiedFields`, bị từ chối chứ không bị bỏ qua; N18 final fix M14). Mỗi luật riêng của UNO (§15) có test từ chối của nó.
2. Mỗi claim: nguồn tồn tại, kind của nguồn cho phép kind của claim, ledger liệt kê nó trong "Claim được đỡ" và field trong cột "Field".
3. Dòng ELIGIBLE/RESTRICTED: không field UNKNOWN; không INFERRED ở bất kỳ đâu; không `unverifiedFields`/`unverifiedForms`; có `cpp`; module đều ELIGIBLE; `cpp.libraries` là library của module của dòng.
4. RESTRICTED ⇒ có domain; EXCLUDED/DEFERRED ⇒ có lý do, không `cpp`, không profile.
5. `levels`: L2 PASS cho mọi dòng mở và chỉ trích CC; L2e PASS chỉ trích EMU; L1 PASS chỉ trích TST (N18 final fix M4: mỗi entry TST ghi một file test có thật và tên các test trong file; test kiểm rằng mỗi tên là **đúng** tên của một `it` / `test` / `describe`, và file không có test nào bị `skip` / `todo`, final review 2 N3); L3 không bao giờ PASS ở v0.
6. Helper: mỗi helper được dòng dùng liệt kê, mỗi dòng nhắc helper có thật; **text giống hệt** block tương ứng trong `contract-forms.ino`.
7. `costsUs` có đúng các khoá `arduinoCalls`; số đo trích EMU.
8. RV-U1 = REJECTED (giả định): ngôn ngữ còn, mọi dòng module/chân bị loại.
9. Allowlist C++ (`cppAllowlist`) = hợp các `form` (kèm `variants`), `includes`, `libraries`, `helpers`, `globals`, `setup` của dòng mở. Generator C1 chỉ viết dạng trong allowlist (test `generate.allowlist.test.ts` của `codegen/arduino`).
10. Domain `Pred` dùng chung bộ đánh giá với Yolo:Bit (biên `end` 2147483646/2147483647, chờ −1/0/60000/60001, literal ±2³¹).

---

## 16. Quyết định, UNKNOWN còn lại, exit checklist

### 16.1 Quyết định của contract (v0)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Số học qua helper `add32…mod32`, không toán tử thường trên giá trị learner | EMU-10/11: GCC gập tràn có dấu |
| D2 | `x / 0 = x % 0 = 0` + cảnh báo (không dừng) | Board và simulator cho cùng giá trị; helper không bao giờ chạm UB |
| D3 | Count up đánh giá `start` rồi `end` (thêm `_from`) | Yêu cầu "như Yolo:Bit §3.3"; dạng trong brief đánh giá `end` trước (EMU-10) |
| D4 | `millis` của simulator = mô hình Timer0 | khớp 250/250 (EMU-12) |
| D5 | Servo `write(90)` ngay sau `attach` | Góc đầu xác định trên cả hai phía |
| D6 | Tone 31…4000 Hz, 1…60000 ms | ARD-03; tải ngắt; ms 0 = phát mãi |
| D7 | PWM trên timer bị chiếm: từ chối `timer-claimed` | EMU-04/05 |
| D8 | Siêu âm: simulator dùng thời gian chính xác; chấm điểm chừa ≥ 3 % + 1 cm | EMU-03/07 |
| D9 | Bảng chi phí từ lời gọi không bị gập | EMU-08 vs EMU-09 |
| D10 | Hai lần đọc robot trong toán hạng không tuần tự → dạng tuần tự bằng toán tử phẩy (§3.5); `&&`/`\|\|` giữ nguyên | CXX-09/10, EMU-15: avr-gcc đánh giá đối số phải sang trái; mọi chương trình chạy được trong simulator đều có C++ |

### 16.2 UNKNOWN còn lại (không chặn dòng nào được mở)

| UNKNOWN | Loại |
|---|---|
| Board thật (MCU, USB-serial, bootloader) | L3 / plan §10 câu 1 (R0.5); khác ATmega328P thì C2 không áp dụng |
| Duty D5/D6 thật ((v+1)/256 theo datasheet), hàng TX 65 byte, 1040 µs/byte | L3 (avr8js khác datasheet, §0.4) |
| Điện: motor driver, nhiễu ADC, pull-up, rung phím, đặc tính HC-SR04 và cảm biến line | L3 |
| Sai số thạch anh 16 MHz | L3 |
| Stack tối đa | không đo tĩnh; v0 không có hàm learner |

### 16.3 Exit checklist R0.3 / R0.4

| Tiêu chí | Trạng thái |
|---|---|
| R0.4: compile bằng arduino-cli, chạy HEX trong avr8js trên Node, trace có timestamp | ✓ (`spikes/avr8js/`) |
| R0.4: 4 sketch blink, motor PWM, servo + `pulseIn`, `Servo.attach(9)` + `analogWrite(10,200)` và `tone` + `analogWrite(11,…)` | ✓ (+ pwm-pins, kit-rover, costs, lang, millis, contract-forms) |
| R0.4: trace khớp ±1 % thời gian | ✓ (ADR 0003 §3; `pulseIn` đọc ngắn tới 1,10 % là hành vi của chương trình, ghi ở §6.6) |
| R0.4: hành vi timer bị chiếm vào contract thay UNKNOWN | ✓ §5.3, U-48 |
| R0.4: go/no-go C2 trong ADR | ✓ GO có điều kiện |
| R0.3: mọi dòng có id `U-xx` và nhãn | ✓ §10 |
| R0.3: không construct nào được mở còn field UNKNOWN | ✓ (test) |
| R0.3: ma trận L1/L2/L2e/L3 | ✓ §12 |
| R0.3: pin version core + Servo (≥ 2 tuần tuổi) | ✓ §1 |
| `contract-types.ts` mở rộng cộng thêm; test Yolo:Bit không đổi | ✓ |

### 16.4 Lịch sử

| Version | Ngày | Nội dung |
|---|---|---|
| 0.1.0 | 2026-10-25 | v0 (R0.3), từ evidence R0.4 |
| 0.1.0 | 2026-10-25 | R1: ghi cách virtual UNO charge (§4.4) và các dòng L1 ≠ L2e của R1 (§13: không echo, echo quá timeout, timer bị chiếm lúc chạy). Không đổi ngữ nghĩa dòng nào, nên giữ version |
| 0.1.1 | 2026-10-25 | R1 fix round 1: sửa claim của U-48 và §5.3 (sau `noTone` hay khi tone tự hết, D3/D11 không có PWM tới khi `analogWrite` mới; EMU-05 gọi lại `analogWrite` nên không chứng minh PWM tự trở lại), thêm EMU-14 (`spikes/avr8js/run-tone-notone.mjs`) |
| 0.1.2 | 2026-10-25 | R2.2 fix round 1: U-33 có dòng setup `pinMode(<pin>, <mode>);` với mode của driver module nối vào chân (nút `INPUT_PULLUP`), dù program không dùng op của module: nút nhả đọc HIGH như trên board (field `default`: ARD-16, EMU-13). Trước đó đọc thô chân nút mà không có khối nút thì chân là INPUT thả nổi |
| 0.1.2 | 2026-10-25 | C1: allowlist thêm hai dạng đã có trong `contract-forms.ino` (CC-03) và trong evidence `call` của dòng, nhưng thiếu trong data: literal INT32_MIN `(-2147483647L - 1L)` của U-04 và phần chữ `Serial.print(F("<text>"));` của U-17 (field `cpp.variants`). Không đổi ngữ nghĩa dòng nào, nên giữ version |
| 0.1.3 | 2026-10-25 | C1 fix round 1: §7 ghi chú cho mô hình hàng TX (join in từng phần khi thời gian Serial được tính). Chỉ là tài liệu, không đổi data hay ngữ nghĩa dòng nào, nên giữ version |
| 0.1.3 | 2026-10-25 | C1 (ruling của controller): §3.5 thứ tự toán hạng. Toán hạng trái sang phải, mỗi cái một lần; C++ không cố định thứ tự đối số và toán hạng (CXX-10), avr-gcc 7.3 đánh giá đối số phải sang trái (EMU-15); hai lần đọc robot trở lên trong một vùng không tuần tự → dạng tuần tự bằng toán tử phẩy với biến tạm `_s<k>` (CXX-09, CC-05, EMU-15); `&&`/`\|\|` giữ nguyên. Sửa U-05, U-06, U-07, U-09, U-25 (restriction, `cpp.variants`, field `content`, L2e); thêm EMU-15, CC-05, CXX-09, CXX-10 |
| 0.1.4 | 2026-10-25 | C2: harness parity avr8js (`tests/uno-emulator-parity.test.ts`, `scripts/build-parity-hex.mjs`, HEX trong `tests/__parity__`). L2e của U-01…U-07, U-09…U-30 (mọi dòng mở có fixture parity phủ) trích thêm EMU-16; U-08, U-31…U-34 chưa có fixture. Thêm EMU-16, EMU-17 và 5 dòng §13 (xung servo đầu tiên, pha waveform, chi phí `motorSet`, chi phí `tone` theo tần số, thời gian Serial). Không đổi ngữ nghĩa dòng nào |
| 0.1.5 | 2026-10-25 | C2 fix round 1: virtual UNO charge phần tính của `motorSet` (`costsUs.motorSetOverhead` 42,0625 µs) và `tone()` theo băng prescaler của Timer2, chân không kêu và chân đang kêu (`toneUs`, §4.4), từ EMU-17 (thêm phép đo chân đang kêu và `Serial.begin`). Bỏ hai dòng §13 tương ứng (không còn là khác biệt); thêm 5 dòng §13 (join in từng phần, OUTPUT LOW trước, rung xung servo/tone, gốc `millis()`, tần số tone) và sửa dòng chi phí lệnh ngắn (+7 % khi `tone()` inline, EMU-16). L2e của U-08 và U-31…U-34 trích thêm EMU-16 (fixture `negate-drive` và golden `raw-pins`): mọi dòng mở có parity. Đổi thời gian simulator (không đổi ngữ nghĩa giá trị nào) |
| 0.1.6 | 2026-10-25 | C2 fix round 2: `toneUs` đo lại trên sketch generator sinh ra, tần số tính lúc chạy, lâu nhất của mỗi băng (EMU-18, `node spikes/avr8js/run-generated-tone.mjs`); cạnh băng theo `Tone.cpp` (`floor(16e6 / (514 · p)) + 1`: 31, 122, 244, 487, 973, 3892 Hz, trước là 31 250 / p); `motorSetOverhead` 43,3125 µs, lâu nhất của các speed đo (EMU-17, trước 42,0625 ở speed 50). Thêm dòng §13 Chi phí `tone` theo chương trình (gập bởi `-flto`: 17,6875…213,375 µs ở 1000 Hz), dòng chi phí lệnh ngắn không còn +7 %. Đổi thời gian simulator, không đổi ngữ nghĩa giá trị |
| 0.1.7 | 2026-10-25 | C2 fix round 3: `motorSetOverhead` 43,6875 µs, lâu nhất của mọi speed −100…100 (quét đủ, speed −75 và −97: 60,5 µs; trước 43,3125 ở −70, EMU-17). EMU-18 thêm `tone()` một chỗ gọi literal ở 10 tần số (17,625…17,75 µs, mọi băng) và độ lệch trong băng theo chân (chân đang kêu 6,5 µs ở 31…121 Hz, 5,375 µs ở 244…486 Hz, nhiều nhất 2,80 %); sửa câu "literal ngắn hơn 3 µs với 75 chỗ gọi" (trên chân đang kêu có khi dài hơn 0,6875 µs). Dòng §13 Chi phí `tone` theo chương trình: sàn 17,625 µs, theo giá contract của băng; dòng OUTPUT LOW trước và Thời lượng tone ghi cách harness tính. EMU-16: 28 fixture. Đổi thời gian simulator, không đổi ngữ nghĩa giá trị |
| 0.1.7 | 2026-10-26 | N18 final fix M4 (ruling L110): cột L1 của §12 lên PASS cho mọi dòng mở và cho U-48 (sự từ chối `timer-claimed` là của simulator), mỗi dòng trích các test chạy nó trên simulator: evidence kind mới TST (TST-01…TST-07, §14; `UNO_EVIDENCE_SCOPE.TST` rỗng, chỉ đỡ `sim-semantic`), validator nhận L1 PASS chỉ khi trích TST (invariant 5). Không đổi ngữ nghĩa hay data của dòng nào, nên giữ version |
| 0.1.7 | 2026-10-27 | N19 A4 + A5 + C2 (một dispatch, ruling của controller): mở U-35…U-39 của xe tay gắp `ref-uno-gripper@0` (kẹp, tay, IR giữa càng, màu vật; giá trị thô cảm biến màu ở Advanced) và module U-M3 Wire; helper `gripper-servo2`, `tcs34725-wire`; evidence EMU-19, EMU-20 (13 khoá `costsUs` của A2/A3, `costsEvidence`), CC-06, DS-02, ARD-18, TST-08…TST-10; L2 = CC-06 và L2e = EMU-19 (sketch `gripper-forms`, không phải `contract-forms` của rover); `UNO_PARITY_ROWS` 34 → 39 (5 fixture parity mới, EMU-16 33 fixture); snapshot pin thêm Wire 1.0 của core; sửa chữ U-46, U-48; §6.7…§6.9, §13 (servo thứ hai của Timer1, rung xung 6 µs của xe tay gắp). **Giữ version 0.1.7**: không đổi ngữ nghĩa, data hay thời gian của dòng nào đã mở, và version nằm trong header của mọi sketch sinh ra (đổi version là đổi C++ của mọi bài rover) |
| 0.1.7 | 2026-10-26 | N18 final review 2 (N3): thêm TST-07 (`src/core/run/virtual-clock.program.test.ts`: 100 lần chờ 10 ms kết thúc đúng 1000 ms, 1000,85625 ms với overhead `delay()`, mỗi lần chờ kết thúc đúng mốc của nó; vòng `loop()` rỗng 51 µs) cho L1 của U-18 và U-02; kiểm tên test khớp đúng và không có `skip` / `todo`. Không đổi ngữ nghĩa hay data của dòng nào |