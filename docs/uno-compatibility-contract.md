# UNO Compatibility Contract

> **Version:** 0.1.2 (v0) · **Date:** 2026-10-25 · **Task:** N18 R0.3 · **Status:** v0: mọi construct được mở đã có evidence cho mọi field; L1 chờ R1/R2, L3 chờ M06.
> **Target snapshot (pin):** `arduino-cli 1.5.1`, FQBN `arduino:avr:uno`, core `arduino:avr@1.8.8` (2026-05-21), avr-gcc `7.3.0-atmel3.6.1-arduino7`, library `Servo 1.3.0` (2025-11-06, LGPL-2.1), emulator `avr8js@0.21.1` (2026-08-31, MIT). MCU giả định **ATmega328P, 16 MHz**. **Board chính xác: UNKNOWN** (§1).
> **Evidence:** spike R0.4 `spikes/avr8js/` (số liệu `spikes/avr8js/out/results.json`), ADR `docs/adr/0003-avr8js-parity.md`, ledger §14. **Bản máy đọc được:** `src/core/compat/uno-contract.ts` (§15).
> **Quan hệ tài liệu:** spec `docs/uno-robot-direction.md`, plan `docs/robot-3d-implementation-plan.md` (R0.3, R0.4; §4.1 board, §4.2 kit, §4.3 driver, §4.4 IR). Kỷ luật evidence theo `docs/yolobit-compatibility-contract.md` (§0, §15, §21). Từ R1, tài liệu này là **source of truth** cho hành vi của mọi block robot trong simulator và trong C++ Arduino sinh ra (C1, C2, R1, R2).

---

## 0. Status / evidence rules

### 0.1 Kết quả R0.3 (tóm tắt)

| Hạng mục | Kết quả |
|---|---|
| Construct được mở | 34 dòng (U-01…U-34): 27 dòng cho cả hai profile, 7 dòng chỉ Advanced. **Không dòng nào còn field UNKNOWN** (§10.1, test `uno-contract.test.ts`) |
| Không mở | 11 dòng (U-40…U-50): 8 EXCLUDED, 3 DEFERRED, mỗi dòng có lý do (§10.2) |
| Số học | `cxx-int32`: wrap, chia cắt về 0, `%` theo dấu số bị chia, `INT32_MIN / -1 = INT32_MIN`, `x % -1 = 0`, `x / 0 = x % 0 = 0` (+ cảnh báo). Generator **không bao giờ** viết toán tử thường lên giá trị của learner: avr-gcc gập tràn có dấu (§3) |
| Timer bị chiếm | **Đã có trace** (thay UNKNOWN): Servo làm D9/D10 mất PWM (giữ LOW, cả sau `detach`); `tone` làm D3/D11 mất PWM và `analogWrite(11)` đổi tần số tone. Quyết định: từ chối `timer-claimed` (§5.3, U-48) |
| `costsUs` | Đo bằng cycle của avr8js (§4.4) |
| Ma trận L1/L2/L2e/L3 | §12: L2 PASS và L2e PASS cho mọi dòng mở; L1 PENDING (R1/R2); L3 PENDING (M06) |
| Go/no-go C2 | **GO, có điều kiện** (ADR 0003 §7) |

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

Hệ quả:
- Field mà mọi nguồn của một claim đều là EMU là **emulator-dependent** (cột cuối §10.1, suy ra, không viết tay).
- **Nếu RV-U1 bị thu hồi** (ví dụ C2 phát hiện avr8js sai ở chỗ quan trọng): mọi dòng module/chân (U-19…U-34) mất field và bị loại; ngôn ngữ, in, chờ (U-01…U-18) vẫn đứng (test "would keep the language and drop every module and pin row").
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

Mọi version đều ≥ 2 tuần tuổi tính tới 2026-10-25 (test kiểm). Đổi bất kỳ version nào là đổi contract (version mới, chạy lại `node spikes/avr8js/run-all.mjs`).

**Tuyên bố pin:**

> The exact board (MCU, USB-serial chip, bootloader) is UNKNOWN; this contract is pinned to arduino-cli 1.5.1, arduino:avr@1.8.8, Servo 1.3.0 and avr8js 0.21.1 for an ATmega328P at 16 MHz as of 2026-10-25, and is not a timeless compatibility guarantee.

Nếu board thật không phải ATmega328P, mọi field `V·E` mất giá trị cho board đó và C2 không áp dụng (plan §10 câu 1).

---

## 2. Cấu trúc sketch, include, module

### 2.1 Thứ tự (C1, frozen)

header comment (scenario, kit@version) → `#include` → `#define` chân từ kit (`MOTOR_LEFT_EN 5`, …) → global (`long` của learner, `Servo <role>;`) → helper (§3.2, §6, chỉ những cái được dùng, mỗi cái một lần) → hàm của learner (DEFERRED, U-42) → `setup()` → `loop()`. `spikes/avr8js/sketches/contract-forms/contract-forms.ino` là một sketch đúng thứ tự này (CC-03, EMU-13).

### 2.2 Module (tách khả dụng khỏi cú pháp include)

| ID | Module | Include | Library | `import` | `module` | Eligibility |
|---|---|---|---|---|---|---|
| U-M1 | Arduino AVR core | không (build `.ino` tự include `Arduino.h`) | `arduino:avr@1.8.8`, LGPL-2.1 | – | V·C (CC-03, corroborated CC-01) | ELIGIBLE |
| U-M2 | Servo | `#include <Servo.h>` | `Servo@1.3.0`, LGPL-2.1 | V·C (CC-03) | V·C (CC-03, CC-01) | ELIGIBLE |

Không có library GPL. `scripts/check-arduino.mjs` (C1) cài đúng `name@version` từ `cpp.libraries` của các dòng được dùng.

### 2.3 Dạng C++ của từng dòng

Placeholder `<…>` như dạng Python của contract Yolo:Bit; `<ROLE>_PIN` là `#define` sinh từ kit; dòng `setup` được viết **một lần** ở đầu `setup()`, theo thứ tự các dòng xuất hiện:

| ID | `cpp.form` (⏎ = xuống dòng) | Helper | Dòng setup |
|---|---|---|---|
| U-01 | `void setup() {⏎  <setup lines>⏎  <body>⏎}` | — | — |
| U-02 | `void loop() {⏎  <body>⏎}` | — | — |
| U-03 | `long <name> = 0L; · <name> = <expr>;` | — | — |
| U-04 | `<n>L` · variant `(-2147483647L - 1L)` (INT32_MIN, §3.1) | — | — |
| U-05 | `add32(<a>, <b>) · sub32(<a>, <b>) · mul32(<a>, <b>)` | int32 | — |
| U-06 | `div32(<a>, <b>)` | int32 | — |
| U-07 | `mod32(<a>, <b>)` | int32 | — |
| U-08 | `neg32(<a>)` | int32 | — |
| U-09 | `(<a> < <b>) · (<a> <= <b>) · (<a> > <b>) · (<a> >= <b>) · (<a> == <b>) · (<a> != <b>)` | — | — |
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
| U-25 | `buzzerTone(<ROLE>_PIN, <hz>, <ms>);` | buzzer-tone | — |
| U-26 | `noTone(<ROLE>_PIN);` | — | — |
| U-27 | `ultrasonicCm(<ROLE>_TRIG, <ROLE>_ECHO)` | hcsr04-pulsein | `pinMode(<ROLE>_TRIG, OUTPUT);` `pinMode(<ROLE>_ECHO, INPUT);` |
| U-28 | `(digitalRead(<ROLE>_PIN) == <LOW\|HIGH>)` | — | `pinMode(<ROLE>_PIN, INPUT);` |
| U-29 | `(long)analogRead(<ROLE>_PIN)` | — | — |
| U-30 | `(digitalRead(<ROLE>_PIN) == LOW)` | — | `pinMode(<ROLE>_PIN, INPUT_PULLUP);` |
| U-31 | `digitalWrite(<pin>, (<v>) ? HIGH : LOW);` | — | `pinMode(<pin>, OUTPUT);` |
| U-32 | `pwmWrite(<pin>, <value>);` | pwm-write | — |
| U-33 | `(digitalRead(<pin>) == HIGH)` | — | `pinMode(<pin>, <mode>);` (`<mode>` của driver module nối vào chân: nút `INPUT_PULLUP`, line/echo `INPUT`) |
| U-34 | `(long)analogRead(<pin>)` | — | — |

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
| `tone` | 174,0625 | 2785 cycle | có duration (helper luôn truyền); không duration 2145 cycle |
| `noTone` | 6,375 | 102 cycle | |
| `pulseInAfterPulse` | 3,25 | trung vị | từ khi echo hết tới khi trả (2,625…3,3125) |
| `pulseInNoPulse30000` | 20 752 | 332 032 cycle | không có xung, timeout 30000: vòng chờ 11 cycle × 30000 + ngắt (CC-04); có Servo: 20 785,44 |
| `ultrasonicCmOverhead` | 65,5625 | | cả helper trừ (chờ echo + độ rộng): trigger, `pulseIn`, chia 58 |
| `ultrasonicCmNoEcho` | 20 812 | | cả helper khi không có echo (có Servo) |
| `serialWriteByte` | 4,625 | 74 cycle | 1 byte vào hàng rỗng |
| `serialQueueByte` | 6,28125 | | mỗi byte của `print(F(…))` khi hàng còn chỗ (đo 6,283) |
| `serialLineByte` | 1040 | | một khung 10 bit ở 9615 baud (UBRR0 = 207, U2X); avr8js đo 1044,17 |
| `serialPrintLongBase` + `serialPrintLongDigit` × d | 9,375 + 45,1875 × d | fit 1/5/10 chữ số | lệch ≤ 1,1 % (5 chữ số: đo 232,69, fit 235,3) |
| `serialPrintLongSign` | 6,8125 | 109 cycle | dấu trừ |
| `serialPrintln` | 17,25 | 276 cycle | `\r\n` |

**Virtual UNO (R1.3, `src/core/hardware/virtual-uno.ts`)** charge mỗi lời gọi bằng khoá của bảng này (bản sao trong `uno-r3.board.json`, test so với contract): `digitalWrite`/`digitalRead` lấy biến thể `…TimerPin` trên D3, D5, D6, D9, D10, D11; `analogWrite` giá trị 1…254 trên chân PWM charge `analogWrite`, còn 0, 255 và chân không PWM charge `analogWriteDigital` (core gọi `digitalWrite`; đo 178/186/190 cycle); `pinMode(INPUT)` charge `pinMode` (chỉ OUTPUT được đo); `tone` không duration (2145 cycle) cũng charge `tone`, nhưng helper luôn truyền duration. Không charge tải ngắt (§4.5, §13). Driver `hcsr04-pulsein` (R1.4): có echo thì cả helper = chờ + echo + `ultrasonicCmOverhead` (đúng 1675,5625 µs của EMU-13 ở 450 + 1160); không echo xem §13.

**Độ lệch theo chương trình:** `-flto` inline/gập hằng tuỳ cả chương trình: cùng lời gọi trong sketch nhỏ chỉ có hằng (`costs-const`, EMU-09) rẻ hơn 8…41 %, và `tone(10, 1000)` hằng chỉ còn 94 cycle. Bảng trên là của lời gọi thật; parity thời gian ±1 % chỉ hứa cho khoảng ≥ 1 ms mà `delay`/`pulseIn`/Serial chiếm phần lớn (ADR 0003 §7 điều kiện 1).

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

---

## 7. Serial

- `Serial.begin(9600);` là dòng setup đầu tiên khi chương trình có `print`; D0/D1 bị giữ.
- `print` số: chữ số ASCII; bool: `1`/`0`; text: `F("…")`, UTF-8 nguyên byte (`Xin chào` = 9 byte), escape `\"` `\\`; ghép: nhiều `Serial.print`, cuối là `Serial.println` (U-15…U-17, EMU-13).
- Thời gian (mô hình của simulator, từ EMU-08): hàng TX chứa **64 byte** tính từ rỗng; mỗi byte vào hàng tốn `serialQueueByte` (6,28 µs), số tốn thêm `serialPrintLongBase + serialPrintLongDigit × d (+ sign)`, `println` thêm `serialPrintln`; hàng xả **1 byte mỗi 1040 µs** (`SERIAL_FRAME_US`); byte gặp hàng đầy thì **chờ** tới khi có chỗ (ARD-08). Từ byte thứ 65 của một lần in dài, mỗi byte tốn ≈ 1,04 ms.
- Khác biệt avr8js: 1044,17 µs/byte và hàng 64; board dự kiến 1040 µs và 65 (shift register riêng). Ghi ở §13, L3.

---

## 8. RAM / flash

| Luật | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Flash tối đa | 32 256 B | V·C | CC-01 |
| RAM | 2048 B; arduino-cli **cảnh báo** "Low memory available, stability problems may occur." khi biến toàn cục **> 1536 B** (75 %); > 2048 B: build fail | V·C | CC-02 |
| L2 báo % | lấy từ output `arduino-cli compile` ("Sketch uses … (x%)", "Global variables use … (y%)") | V·C | CC-01 |
| Lời giải mẫu | **RAM ≤ 75 %** (≤ 1536 B toàn cục, tức không có cảnh báo; ≥ 512 B cho stack) | V·C | CC-02 |
| Tham chiếu | cả kit cùng lúc (`kit-rover`, có Servo + Serial + tone): 4752 B flash (14 %), 247 B RAM (12 %); `contract-forms`: 7474 B (23 %), 258 B (12 %) | V·C | CC-01, CC-03 |

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
| U-05 | add, subtract, multiply (int32, wrap) | B+A | V·C | – | – | – | – | – | – | – | – | – | D·X | D·X | – | – | – | ELIGIBLE | — |
| U-06 | divide (truncating) | B+A | V·C | – | – | – | – | – | – | D·X | – | – | D·X | D·X | – | – | – | ELIGIBLE | — |
| U-07 | remainder (sign of the dividend) | B+A | V·C | – | – | – | – | – | – | D·X+D·A | – | – | D·X | D·X | – | – | – | ELIGIBLE | — |
| U-08 | negate | B+A | V·C | – | – | – | – | – | – | – | – | – | D·X | – | – | – | – | ELIGIBLE | — |
| U-09 | compare | B+A | V·C | – | – | – | – | – | – | – | – | – | D·X | – | – | – | – | ELIGIBLE | — |
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
| U-25 | buzzer tone (Hz, ms) | B+A | V·C | – | – | D·A | D·A+V·E | – | V·E | V·E | D·A+V·E | V·E | – | – | – | – | D·A+V·E | ELIGIBLE | range, clamp, round, block, yield, content |
| U-26 | buzzer stop | A | V·C | – | – | – | – | – | – | – | V·E | – | – | – | – | – | V·E | ELIGIBLE | block, content |
| U-27 | ultrasonic distance (cm) | B+A | V·C | – | – | D·A+V·E | V·E | – | V·E | V·E | V·C+V·E | – | D·A+V·E | – | – | – | – | ELIGIBLE | unit, range, clamp, round, block, return |
| U-28 | line sensor sees dark | B+A | V·C | – | – | – | – | – | – | – | V·E | – | V·E | – | – | – | V·E | ELIGIBLE | block, return, content |
| U-29 | line sensor raw value | A | V·C | – | – | – | D·A+V·E | – | – | D·S | V·E+D·S | – | V·E | – | – | – | – | ELIGIBLE | range, block, return |
| U-30 | button pressed | B+A | V·C | – | – | – | – | D·A | – | – | V·E | – | V·E | – | – | – | – | ELIGIBLE | block, return |
| U-31 | digital write (raw pin) | A | V·C | – | – | – | –ᴰ | – | – | – | V·E | – | – | – | – | – | V·E | RESTRICTED | block, content |
| U-32 | PWM write 0..255 (raw pin) | A | V·C | – | – | D·A+V·E | V·E | – | V·E | – | V·E | V·E | – | –ᴰ | – | – | V·E | RESTRICTED | unit, range, clamp, block, yield, content |
| U-33 | digital read (raw pin) | A | V·C | – | – | – | –ᴰ | D·A+V·E | – | – | V·E | – | V·E | – | – | – | – | RESTRICTED | default, block, return |
| U-34 | analog read 0..1023 (raw pin) | A | V·C | – | – | – | D·A | – | – | D·S | V·E | – | V·E | – | – | – | – | RESTRICTED | block, return |

Ghi chú:
- `call` của mọi dòng là `V·C`: dạng C++ đã compile trong `contract-forms.ino` (CC-03).
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
| U-46 | module I²C (`Wire`) | DEFERRED | `WireIO` có trong interface driver, nhưng `ref-uno-rover@0` không có module I²C |
| U-47 | `delayMicroseconds`, `pulseIn` thô, `micros` | EXCLUDED | Chỉ driver dùng; không có block |
| U-48 | PWM trên timer servo/tone giữ | EXCLUDED, **hành vi VERIFIED** | §5.3: chương trình sẽ không làm điều nó nói (chân LOW; tone đổi tần số). `content` = V·E (EMU-04, EMU-05, EMU-14) + D·A (ARD-12, ARD-03). Từ chối `timer-claimed` |
| U-49 | `Servo.detach`, `writeMicroseconds`, servo ngoài kit | EXCLUDED | `detach` để Timer1 ở normal mode, D9/D10 mất PWM tới khi reset (EMU-04); block chỉ đặt góc |
| U-50 | tone trên chân khác còi, hai tone cùng lúc | EXCLUDED | Core chỉ phát một tone mỗi lúc (ARD-03); role `buzzer` giữ nó |

---

## 11. Profile

| Profile | Dòng |
|---|---|
| **uno-basic** | U-01…U-18 (khung, biến, số học, so sánh, logic, if, repeat, while, count up, in, chờ) + U-20…U-25 (motor, robot đi/dừng, servo, đèn, còi kêu) + U-27 (siêu âm) + U-28 (line thấy vạch đen) + U-30 (nút) |
| **uno-advanced** | tất cả của Basic + U-19 (`millis`) + U-26 (dừng còi) + U-29 (line thô) + U-31…U-34 (chân thô) |

Advanced là tập cha thật sự của Basic. Một profile liệt kê dòng của target khác hoặc dòng không mở thì bị từ chối (`profileConstructViolations`, test). R2.1 test `uno-basic exposes only drive/sensor/servo/led constructs` dựa trên bảng này (cộng các dòng ngôn ngữ).

---

## 12. Ma trận L1 / L2 / L2e / L3

| Mức | Nghĩa (plan D-R11) | Evidence hợp lệ |
|---|---|---|
| **L1** sim-semantic | Simulator (IR + virtual UNO + driver TS) làm đúng ngữ nghĩa của dòng | Test của R1.3/R1.4/R2.3 (chưa có ở v0 → PENDING) |
| **L2** compile-verified | Dạng C++ của dòng compile với toolchain đã pin | CC |
| **L2e** emulator-trace | HEX chạy trong avr8js cho đúng mức chân / giá trị / thời gian của contract | EMU |
| **L3** physical | Board thật (M06) | không có ở v0; validator **cấm** L3 = PASS |

| ID | Capability | Elig. | L1 | L2 | L2e | L3 |
|---|---|---|---|---|---|---|
| U-01 | program start: setup() | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-02 | forever: loop() | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-08, EMU-13) | PENDING (M06) |
| U-03 | variable (long, int32) | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-10, EMU-13) | PENDING (M06) |
| U-04 | integer literal | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-10, EMU-13) | PENDING (M06) |
| U-05 | add, subtract, multiply (int32, wrap) | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-11, EMU-13) | PENDING (M06) |
| U-06 | divide (truncating) | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-10, EMU-13) | PENDING (M06) |
| U-07 | remainder (sign of the dividend) | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-10, EMU-13) | PENDING (M06) |
| U-08 | negate | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-09 | compare | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-10 | and, or, not, true, false | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-11 | if / else if / else | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-12 | repeat N times | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-13 | while | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-14 | count up | RESTRICTED | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-10, EMU-13) | PENDING (M06) |
| U-15 | print a number or a truth value | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-08, EMU-10, EMU-13) | PENDING (M06) |
| U-16 | print text | RESTRICTED | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-17 | print a join of text and numbers | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-18 | wait (ms) | ELIGIBLE | PENDING (R2.3) | PASS (CC-03) | PASS (EMU-01, EMU-08, EMU-13) | PENDING (M06) |
| U-19 | time since start (millis) | ELIGIBLE | PENDING (R1.3, R2.3) | PASS (CC-03) | PASS (EMU-12, EMU-13) | PENDING (M06) |
| U-20 | motor speed (H-bridge EN/IN1/IN2) | ELIGIBLE | PENDING (R1.4) | PASS (CC-03) | PASS (EMU-02, EMU-07, EMU-13) | PENDING (M06) |
| U-21 | drive: forward, backward, spin left, spin right | ELIGIBLE | PENDING (R1.4) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-22 | stop the robot | ELIGIBLE | PENDING (R1.4) | PASS (CC-03) | PASS (EMU-02, EMU-13) | PENDING (M06) |
| U-23 | servo angle | ELIGIBLE | PENDING (R1.4) | PASS (CC-03) | PASS (EMU-03, EMU-07, EMU-13) | PENDING (M06) |
| U-24 | LED on / off | ELIGIBLE | PENDING (R1.4) | PASS (CC-03) | PASS (EMU-01, EMU-13) | PENDING (M06) |
| U-25 | buzzer tone (Hz, ms) | ELIGIBLE | PENDING (R1.4) | PASS (CC-03) | PASS (EMU-05, EMU-07, EMU-13) | PENDING (M06) |
| U-26 | buzzer stop | ELIGIBLE | PENDING (R1.4) | PASS (CC-03) | PASS (EMU-05, EMU-13) | PENDING (M06) |
| U-27 | ultrasonic distance (cm) | ELIGIBLE | PENDING (R1.4, R3) | PASS (CC-03) | PASS (EMU-03, EMU-07, EMU-13) | PENDING (M06) |
| U-28 | line sensor sees dark | ELIGIBLE | PENDING (R1.4, R3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-29 | line sensor raw value | ELIGIBLE | PENDING (R1.4, R3) | PASS (CC-03) | PASS (EMU-07, EMU-13) | PENDING (M06) |
| U-30 | button pressed | ELIGIBLE | PENDING (R1.4) | PASS (CC-03) | PASS (EMU-07, EMU-13) | PENDING (M06) |
| U-31 | digital write (raw pin) | RESTRICTED | PENDING (R1.2, R1.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-32 | PWM write 0..255 (raw pin) | RESTRICTED | PENDING (R1.2, R1.3) | PASS (CC-03) | PASS (EMU-06, EMU-13) | PENDING (M06) |
| U-33 | digital read (raw pin) | RESTRICTED | PENDING (R1.2, R1.3) | PASS (CC-03) | PASS (EMU-13) | PENDING (M06) |
| U-34 | analog read 0..1023 (raw pin) | RESTRICTED | PENDING (R1.2, R1.3) | PASS (CC-03) | PASS (EMU-07, EMU-13) | PENDING (M06) |
| U-40 | float numbers, real division | EXCLUDED | n/a | n/a | n/a | n/a |
| U-41 | text variables, String objects | EXCLUDED | n/a | n/a | n/a | n/a |
| U-42 | learner functions | DEFERRED | n/a | n/a | n/a | n/a |
| U-43 | interrupts and events (attachInterrupt) | DEFERRED | n/a | n/a | n/a | n/a |
| U-44 | reading the serial monitor | EXCLUDED | n/a | n/a | n/a | n/a |
| U-45 | random numbers | EXCLUDED | n/a | n/a | n/a | n/a |
| U-46 | I²C modules (Wire) | DEFERRED | n/a | n/a | n/a | n/a |
| U-47 | delayMicroseconds, raw pulseIn, micros | EXCLUDED | n/a | n/a | n/a | n/a |
| U-48 | PWM on a timer a servo or a tone holds | EXCLUDED | PENDING (R1.2: timer-claimed) | PASS (CC-01) | PASS (EMU-04, EMU-05) | PENDING (M06) |
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
| Thời lượng tone | `ms` chính xác | `floor(2·hz·ms/1000)` nửa chu kỳ | như L2e | khác rõ chỉ ở Hz thấp × ms ngắn |
| Duty D5/D6 | v/255 | v/256 | (v+1)/256 (DS-01) | ≤ 1/256 chu kỳ |
| USART | 1040 µs/byte, hàng 64 | 1044,17 µs/byte, hàng 64 | 1040, hàng 65 | ≤ 0,4 % + 1 byte |
| Chi phí lệnh ngắn | bảng `costsUs` | tuỳ LTO của chương trình (−8…−41 %, `tone` hằng −96 %) | như L2e | parity thời gian chỉ cho khoảng ≥ 1 ms |
| Chân thả nổi / pull-up | không cho đọc (domain) | đọc LOW | ngẫu nhiên / HIGH | bị domain loại |

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

Ngày quan sát/truy cập: **2026-10-25**. EMU: avr8js 0.21.1 trên Node 24.22.1 (Apple M4 Pro), HEX từ arduino-cli 1.5.1 / arduino:avr@1.8.8 / Servo 1.3.0; số liệu trong `spikes/avr8js/out/results.json`. Cột "Claim được đỡ" mã hoá §0.4; cột cuối là field mà entry ghi nhận quan sát (validator chỉ cho phép entry đỡ field nằm trong cột này).

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
| CC-01 | CC | arduino-cli 1.5.1 (đầu §14) | Compiled the 15 spike sketches (ram-threshold 8 times) | All compile (ram-threshold refuses its 2049 B probe by design, CC-02); e.g. kit-rover 4752 B flash (14 %), 247 B RAM (12 %); 300 * 200 warns -Woverflow | compile-ok, compile-size, snapshot | call, import, module |
| CC-02 | CC | arduino-cli 1.5.1 (đầu §14) | sketches/ram-threshold with -DBIG=1000..2040 | 1536 B of globals (75.000 %): no warning; 1537 B (75.049 %) and above: "Low memory available, stability problems may occur."; 2049 B: "Not enough memory", the build fails; flash maximum 32256 B | compile-size | — |
| CC-03 | CC | arduino-cli 1.5.1 (đầu §14) | Compiled sketches/contract-forms with --warnings all | Compiles; no warning from the sketch (only from the core); 7474 B flash (23 %), 258 B RAM (12 %) | compile-ok, compile-size | call, import, module |
| CC-04 | CC | arduino-cli 1.5.1 + avr-objdump | Read countPulseASM | Wait-for-start loop 11 cycles, counting loop 16 cycles, one budget of `timeout` iterations; pulseIn returns (count · 16 + 16) / 16 µs | disassembly | block |
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
| DS-01 | DS | Microchip DS40002061A, ATmega48A/PA/88A/PA/168A/PA/328/P datasheet (PDF downloaded 2026-10-25) | Read and quoted | "The port pins are tri-stated when reset condition becomes active, even if no clocks are running."; "If the OCR0A is set equal to BOTTOM, the output will be a narrow spike for each MAX+1 timer clock cycle."; "A normal conversion takes 13 ADC clock cycles. The first conversion after the ADC is switched on … takes 25 ADC clock cycles"; "For single ended conversion, the result is ADC = VIN · 1024 / VREF" | documented | default, round, block |
| CXX-01 | CXX | eel.is/c++draft/expr.mul (accessed 2026-10-25) | Read the section and quoted it | "If the second operand of / or % is zero, the behavior is undefined. For integral operands, the / operator yields the algebraic quotient with any fractional part discarded; if the quotient a/b is representable in the type of the result, (a/b)*b + a%b is equal to a; otherwise, the behavior of both a/b and a%b is undefined." | documented, language | round, return, error |
| CXX-02 | CXX | eel.is/c++draft/basic.fundamental (accessed 2026-10-25) | Read the section and quoted it | "…arithmetic for the unsigned type is performed modulo 2N. Unsigned arithmetic does not overflow." | documented, language | return, error |
| CXX-03 | CXX | GCC 7.3 manual, "Integers implementation" (gcc.gnu.org/onlinedocs/gcc-7.3.0, accessed 2026-10-25); eel.is/c++draft/conv.integral (accessed 2026-10-25) | Read the section and quoted it | "For conversion to a type of width N, the value is reduced modulo 2^N to be within range of the type; no signal is raised."; "If the source type is bool, the value false is converted to zero and the value true is converted to one." | documented, language | range, return, content |
| CXX-04 | CXX | eel.is/c++draft/lex.icon (accessed 2026-10-25) | Read the section and quoted it | "The type of an integer-literal is the first type in the list in Table 8 corresponding to its optional integer-suffix in which its value can be represented." | documented, language | range |
| CXX-05 | CXX | eel.is/c++draft/expr.rel (accessed 2026-10-25); eel.is/c++draft/expr.eq (accessed 2026-10-25); eel.is/c++draft/expr.log.and (accessed 2026-10-25); eel.is/c++draft/expr.log.or (accessed 2026-10-25); eel.is/c++draft/expr.unary.op (accessed 2026-10-25) | Read the section and quoted it | relational: "The type of the result is bool."; equality: "…a result of type bool"; &&: "the second operand is not evaluated if the first operand is false"; \|\|: "the second operand is not evaluated if the first operand evaluates to true"; !: "The type of the result is bool." | documented, language | return |
| CXX-06 | CXX | eel.is/c++draft/conv.prom (accessed 2026-10-25) | Read the section and quoted it | "A prvalue of type bool can be converted to a prvalue of type int, with false becoming zero and true becoming one." | documented, language | return, content |
| CXX-07 | CXX | eel.is/c++draft/stmt.for (accessed 2026-10-25); eel.is/c++draft/intro.execution (accessed 2026-10-25) | Read the section and quoted it | for: "…is equivalent to { init-statement while ( condition ) { statement expression ; } }"; "Every value computation and side effect associated with a full-expression is sequenced before every value computation and side effect associated with the next full-expression to be evaluated." | documented, language | range, content |
| CXX-08 | CXX | GCC 7.3 manual, "Common Function Attributes" (optimize) and "Code Gen Options" (-fwrapv) (accessed 2026-10-25) | Read and quoted | "This attribute should be used for debugging purposes only. It is not suitable in production code."; -fstrict-overflow: "…overflow when doing arithmetic with signed numbers is undefined" | context | — |

Tái lập toàn bộ EMU/CC: `node spikes/avr8js/run-all.mjs` (≈ 20 s; cần `arduino-cli` với core và Servo như §1).

---

## 15. Bản máy đọc được (`src/core/compat/uno-contract.ts`)

- Shape: `UnoContract`, `unoContractSchema` (Zod) trong `contract-types.ts`; mở rộng **cộng thêm** so với Yolo:Bit: `ConstructContract.cpp?: { form; variants?; includes; libraries; helpers?; globals?; setup? }` (`variants`: dạng chính xác khác của cùng dòng, evidence `call` của dòng đã đỡ, C1), `ConstructContract.levels?: { L1; L2; L2e; L3 }`, `Profiles`/`Tier` gồm `uno-basic | uno-advanced`, `ModuleContract.library?`, các evidence kind và claim kind mới. Shape và test của Yolo:Bit không đổi (`yolobitContractSchema` vẫn từ chối profile UNO trong dòng Yolo:Bit).
- Luật: `rulesOf(contract)` chọn `YOLOBIT_RULES` hay `UNO_RULES` (scope evidence, field ↔ claim kind, kind cho VERIFIED/DOCUMENTED, emulator có thể bị thu hồi, loại mapping, profile). Mọi hàm của `contract-validation.ts` (`claimProblems`, `entrySemanticProblems`, `exposureViolations`, `profileConstructViolations`, `validateContract`, …) đọc luật đó.
- Data chỉ được **test** đọc (như `yolobit-contract.ts`); virtual UNO, driver, generator chép giá trị chúng dùng. Test `is read by tests only` kiểm.

**Invariant (test `uno-contract.test.ts`):**
1. Mọi dòng có đủ 15 field, mọi module đủ 2 field; schema đúng.
2. Mỗi claim: nguồn tồn tại, kind của nguồn cho phép kind của claim, ledger liệt kê nó trong "Claim được đỡ" và field trong cột "Field".
3. Dòng ELIGIBLE/RESTRICTED: không field UNKNOWN; không INFERRED ở bất kỳ đâu; không `unverifiedFields`/`unverifiedForms`; có `cpp`; module đều ELIGIBLE; `cpp.libraries` là library của module của dòng.
4. RESTRICTED ⇒ có domain; EXCLUDED/DEFERRED ⇒ có lý do, không `cpp`, không profile.
5. `levels`: L2 PASS cho mọi dòng mở và chỉ trích CC; L2e PASS chỉ trích EMU; L1, L3 không bao giờ PASS ở v0.
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
| 0.1.2 | 2026-10-25 | R2.2 fix round 1: U-33 có dòng setup `pinMode(<pin>, <mode>);` với mode của driver module nối vào chân (nút `INPUT_PULLUP`), dù program không dùng op của module: nút nhả đọc HIGH như trên board (field `default`: ARD-16, EMU-13). Trước đó đọc thô chân nút mà không có khối nút thì chân là INPUT thả nổi |
| 0.1.2 | 2026-10-25 | C1: allowlist thêm hai dạng đã có trong `contract-forms.ino` (CC-03) và trong evidence `call` của dòng, nhưng thiếu trong data: literal INT32_MIN `(-2147483647L - 1L)` của U-04 và phần chữ `Serial.print(F("<text>"));` của U-17 (field `cpp.variants`). Không đổi ngữ nghĩa dòng nào, nên giữ version |
| 0.1.1 | 2026-10-25 | R1 fix round 1: sửa claim của U-48 và §5.3 (sau `noTone` hay khi tone tự hết, D3/D11 không có PWM tới khi `analogWrite` mới; EMU-05 gọi lại `analogWrite` nên không chứng minh PWM tự trở lại), thêm EMU-14 (`spikes/avr8js/run-tone-notone.mjs`) |
