# ADR 0003 — avr8js làm evidence L2e và harness parity C2

> **Trạng thái:** ACCEPTED (R0.4, 2026-10-25) · **Quyết định:** **GO cho C2, có điều kiện** (§7).
> **Task:** N18 R0.4 (spike avr8js), là evidence cho R0.3 (`docs/uno-compatibility-contract.md`).
> **Spike:** `spikes/avr8js/` · **Số liệu:** `spikes/avr8js/out/results.json` (mọi con số trong ADR này lấy từ file đó, không ước lượng).

## 1. Bối cảnh

Lab robot mô phỏng một board UNO ở mức chân (plan D-R5): simulator không chạy tập lệnh AVR, mà ghi chân bằng driver TS và tính thời gian bằng bảng `costsUs`. Hai câu hỏi cần evidence trước khi viết contract UNO:

1. Board thật làm gì ở những chỗ tài liệu không nói rõ: PWM trên timer mà `Servo`/`tone` đang giữ, thời gian thật của từng lệnh Arduino, ngữ nghĩa số `long` mà avr-gcc sinh ra.
2. avr8js có đủ trung thực để làm harness parity (C2) so trace của simulator với trace của HEX thật không.

avr8js mô phỏng CPU ATmega328P (đếm cycle theo tập lệnh) và các ngoại vi Timer0/1/2, GPIO, USART, ADC. Nó **không** phải board vật lý: điện, cảm biến, động cơ, sai số thạch anh là việc của L3 (M06).

## 2. Phương pháp

| Mục | Giá trị |
|---|---|
| Compile | `arduino-cli 1.5.1` (Homebrew, 2026-06-05), `--fqbn arduino:avr:uno`, core `arduino:avr@1.8.8` (phát hành 2026-05-21), avr-gcc `7.3.0-atmel3.6.1-arduino7`, cờ của core: `-Os -flto -std=gnu++11 -fpermissive -fno-exceptions …` |
| Library | `Servo 1.3.0` (phát hành 2025-11-06, LGPL-2.1), thư mục user |
| Emulator | `avr8js@0.21.1` (phát hành 2026-08-31, MIT): `CPU` + `AVRTimer` (timer0/1/2Config) + `AVRIOPort` (B, C, D) + `AVRUSART` (usart0Config, 16 MHz) + `AVRADC` (adcConfig). Nạp HEX bằng parser Intel HEX tự viết (`spikes/avr8js/lib/uno.mjs`) |
| Vòng chạy | `while (cpu.cycles < end) { avrInstruction(cpu); cpu.tick(); }`; mọi thay đổi trạng thái chân (`AVRIOPort.pinState`) và mọi byte USART được ghi kèm `cpu.cycles`; µs = cycles / 16 |
| Input kịch bản | Echo HC-SR04: bắt cạnh xuống của TRIG, `cpu.addClockEvent` đặt ECHO HIGH sau 450 µs trong `W` µs; ADC: điện áp kênh qua `onADCRead`; nút: `setPin` (avr8js không mô phỏng pull-up của chân thả nổi, harness lái mức) |
| Đo chi phí | Marker bằng ghi port trực tiếp (`PORTB |= _BV(PB0)` / `&= ~`, `sbi`/`cbi` 2 cycle) quanh lời gọi; 8 mẫu, cách nhau 300 µs; lấy **mẫu nhỏ nhất** (mẫu không bị ngắt Timer0 chen vào) trừ baseline (2 cycle). Serial: `flush()` ngoài marker giữa các mẫu |
| Máy | Apple M4 Pro (12 core), macOS 26.5.2, Node v24.22.1 |
| Ngày | 2026-10-25 (`takenOn` trong `results.json`) |

**Tái lập:**

```sh
cd stem-demo
node spikes/avr8js/run-all.mjs        # ≈ 20 s: compile 15 sketch (ram-threshold 8 lần) + chạy, ghi out/results.json và out/traces/*.txt
node spikes/avr8js/run-servo-pulsein.mjs   # hoặc từng sketch: run-blink, run-motor, run-timer-conflict, run-costs, …
```

Tốc độ: 3,1 s ảo của blink chạy trong 490 ms wall (≈ 6,3× thời gian thực) trên máy trên; cả bộ spike 20,4 s, phần lớn là compile (riêng thăm dò RAM 11,3 s).

## 3. Trace đo được

Tiêu chí R0.4: trace khớp kỳ vọng **±1 % thời gian**. Kết quả từng sketch (`results.json` → khoá cùng tên).

### 3.1 Blink (`blink`)

D13 HIGH 500 ms, LOW 500 ms. Đo: HIGH 500 008,44 / 500 012,19 / 500 008,94 µs; LOW 500 008,06 / 500 010,94 / 500 010,88 µs; chu kỳ 1 000 016,5 … 1 000 023,1 µs. **PASS** (lệch 0,002 %). `delay(500)` dài hơn 500 ms khoảng 8–12 µs (§4).

### 3.2 Motor PWM (`motor`)

Driver `hbridge-en-in1-in2`, chân `ref-uno-rover@0` (M1 EN=D5 IN1=D7 IN2=D8, M2 EN=D6 IN1=D4 IN2=D2), duty = `round(|s| × 255 / 100)`:

| Pha | Lệnh | D5 (Timer0) | D6 (Timer0) | IN |
|---|---|---|---|---|
| A | M1 = 50, M2 = −100 | 976,563 Hz, HIGH 512 µs / 1024 µs (duty 0,5000; contract 128/255 = 0,50196) | HIGH liên tục (255 → `digitalWrite`) | D7 H, D8 L, D4 L, D2 H |
| B | M1 = −30, M2 = 1 | duty 77: HIGH 308 µs (0,30078; contract 0,30196) | duty 3: HIGH 12 µs (0,01172; contract 0,01176) | D7 L, D8 H, D4 H, D2 L |
| C | cả hai 0 | LOW | LOW | tất cả LOW |

**PASS** (chu kỳ đúng tới 0,02 %, duty trong ±1 % của v/255). Ghi chú độ trung thực ở §6.1: avr8js cho Timer0 fast PWM duty v/256, datasheet cho (v+1)/256.

### 3.3 Servo + `pulseIn` (`servoPulseIn`)

Servo D9; HC-SR04 TRIG=D12, ECHO=D11; `pulseIn(ECHO, HIGH, 30000UL)`; cm = µs/58, cắt về [2, 400], 0 → 400. Marker D13 quanh `pulseIn`.

| Echo kịch bản | `pulseIn` trả | Lệch | cm board | cm chính xác | Thời gian gọi |
|---|---|---|---|---|---|
| 1160 µs (20 cm) | 1155 | −5 µs (−0,43 %) | 19 | 20 | 1612,81 µs |
| 580 µs | 580 | 0 | 10 | 10 | 1032,31 µs |
| không có | 0 | — | 400 | 400 | **20 785,44 µs** |
| 23 200 µs | 23 034 | −166 µs (−0,72 %) | 397 | 400 | 23 652,94 µs |
| 116 µs | 111 | −5 µs | 2 | 2 | 568,81 µs |
| 2900 µs | 2868 | −32 µs (−1,10 %) | 49 | 50 | 3352,31 µs |
| 30 500 µs (dài hơn timeout) | 0 | — | 400 | 400 | 30 020,63 µs |

- Cạnh echo đúng giờ kịch bản (449,56 µs sau khi gọi; trigger rơi ≈ 0,44 µs trước lời gọi). Từ lúc echo hết tới lúc `pulseIn` trả: 2,625–3,3125 µs (trung vị 3,25).
- `pulseIn` **đọc ngắn**, không bao giờ dài: `countPulseASM` đếm vòng lặp, thời gian nằm trong ngắt (Timer0 của `millis`, Timer1 của `Servo`) không được đếm. Lệch 0–1,10 % (tối đa 32 µs ở 2900 µs). Cùng code chạy trên board thật cũng vậy: số cycle là của chương trình, không phải của emulator.
- **Timeout không phải 30 ms khi không có echo.** `avr-objdump` của HEX: vòng chờ cạnh lên là **11 cycle**, vòng đếm là **16 cycle**, cả hai trừ chung một ngân sách `timeout` vòng. Không echo: 30000 × 11 / 16 = 20 625 µs + ngắt → đo 20 785,44 µs (có Servo), 20 752 µs (chỉ Timer0, sketch `costs`). Echo dài hơn timeout: 30 020,63 µs.
- Servo: `write(a)` cho xung `544 + a × 1856 / 180` µs (map của Servo 1.3.0): 90° → 1471,4–1472,3 µs, 0° → 543–544, 180° → 2399–2400, 45° → 1007–1008, 135° → 1935–1936; chu kỳ 20 002,8–20 005,6 µs. **PASS**.
- Khi còi kêu 1000 Hz cùng lúc (sketch `kitRover`), echo 1160 µs đọc thành 1125–1134 µs (−2,2 … −3,0 %): ngắt `tone` (≈ 119 cycle mỗi lần đảo chân) cũng bị trừ.

### 3.4 Timer1: `Servo.attach(9)` + `analogWrite(10, 200)` (`servoPwm10`)

| Pha | Lệnh | D10 | D9 |
|---|---|---|---|
| A | `analogWrite(10, 200)` một mình | 490,196 Hz, HIGH 1600 µs / 2040 µs, duty 0,78431 = 200/255 | INPUT |
| B | `servo1.attach(9); write(90)` | PWM **dừng**, giữ LOW (cạnh cuối 100 063,6 µs) | xung servo 1472 µs / 20 ms |
| C | `analogWrite(10, 200)` khi Servo giữ Timer1 | **LOW liên tục, không có PWM** | servo vẫn chạy |
| D | `servo1.detach(); analogWrite(10, 200)` | **vẫn LOW**: Servo để Timer1 ở normal mode, PWM không trở lại tới khi reset | LOW |
| E | `analogWrite(9, 100)` sau detach | — | LOW, không có PWM |

`Servo` đặt `TCCR1A = 0` (normal mode, /8, ngắt OCR1A). `analogWrite` chỉ bật bit `COM1B1`; ở normal mode đó là "xoá OC1B khi so khớp", nên chân giữ LOW. Khớp tài liệu Servo: "use of the library disables `analogWrite()` (PWM) functionality on pins 9 and 10, whether or not there is a Servo on those pins".

### 3.5 Timer2: `tone(10, …)` + `analogWrite(11, …)` (`tonePwm11`)

| Pha | Lệnh | D10 (còi) | D11 (OC2A) | D3 (OC2B) |
|---|---|---|---|---|
| A | `analogWrite(11, 100); analogWrite(3, 100)` | — | 490,196 Hz, duty 0,39216 = 100/255 | như D11 |
| B | `tone(10, 1000)` | 1000,000 Hz, duty 0,5 | PWM **dừng**, LOW | PWM **dừng**, LOW |
| C | `analogWrite(11, 100)` khi tone chạy | **tần số đổi thành 2475,248 Hz** (OCR2A = 100 là TOP của CTC) | LOW | LOW |
| D | `analogWrite(3, 100)` khi tone chạy | 2475,248 Hz | LOW | LOW |
| E | `noTone(10); analogWrite(11/3, 100)` | LOW | PWM trở lại 490,196 Hz | PWM trở lại |
| F | `tone(10, 1000, 50)` | 1000 Hz trong 49,36 ms rồi dừng; **không chặn** | LOW | LOW |

Khác Timer1: `noTone` đặt lại Timer2 về phase-correct /64, nên một `analogWrite` **mới** sau `noTone` cho lại PWM trên D3/D11 (pha E gọi lại `analogWrite`). PWM không tự trở lại: `disableTimer(2)` xoá bit COM (`TCCR2A = (1 << WGM20)`, `Tone.cpp:449`), và R1 trace thêm điều đó (contract EMU-14, `node spikes/avr8js/run-tone-notone.mjs`: sau `noTone` hay tone tự hết mà không có `analogWrite` mới, D3/D11 LOW). Khớp tài liệu `tone`: "Use of the `tone()` function will interfere with PWM output on pins 3 and 11".

### 3.6 Sáu chân PWM và ngưỡng 128 (`pwmPins`)

Cùng lúc: D3 = 64, D5 = 64, D6 = 191, D9 = 64, D10 = 191, D11 = 128. D5/D6: 976,563 Hz (duty avr8js 0,25 / 0,74609); D3/D9/D10/D11: 490,196 Hz, duty đúng v/255 (0,25098 / 0,74902 / 0,50196). Chân không PWM: `analogWrite(7, 127)` → LOW, `analogWrite(8, 128)` → HIGH, `analogWrite(A0, 200)` → HIGH, `analogWrite(A1, 0)` → LOW. **PASS**.

### 3.7 Cả kit `ref-uno-rover@0` cùng lúc (`kitRover`)

Servo D9 (45° → 1007–1008 µs), còi D10 1000 Hz, motor D5 duty 128 / D6 duty 204 (976,563 Hz), IN D7 H D8 L D4 H D2 L, LED D13 HIGH, nút D3 (1 → 0 → 1 theo kịch bản), line A0/A1/A2 = 0 V / 2,5 V / 5 V → `analogRead` 0 / 512 / 1023. Các module **không** đụng nhau trên timer. **PASS**.

### 3.8 Các dạng C++ của contract (`contractForms`)

Sketch `contract-forms.ino` viết đúng các dạng C++ và helper của contract theo thứ tự C1 (header → `#include` → `#define` chân → global → helper → `setup()` → `loop()`). Compile với `--warnings all`: không có warning nào từ sketch. Chạy với echo/line/nút/ADC kịch bản. **29/29 kiểm tra PASS**, gồm:

- số học `add32…mod32`, bool in `1/0`, `if / else if / else`, `while`, `repeat` đánh giá N một lần, count up start → end mỗi cái một lần, biến giữ giá trị cuối, in chữ UTF-8 (`Xin chào` = 9 byte), escape `"` và `\`;
- `(long)millis()` khớp mô hình §3.9;
- `motorSet` (50, −100, tiến 60, xoay trái 40, 150 → kẹp 100, dừng), `servoSet` (90 lúc setup → 1472 µs; 600 → kẹp 180 → 2400 µs; −5 → 0 → 544 µs);
- `buzzerTone` (440 Hz → 440,141 Hz; gọi lại cùng chân → 880,282 Hz trong 30,22 ms; 10 Hz → kẹp 31 Hz; 9000 → kẹp 4000 Hz; 0 ms → kẹp 1 ms), `noTone`;
- `ultrasonicCm` (echo 1160 µs → 19 cm, gọi 1675,5625 µs; không echo → 400, gọi 20 812 µs; bản build trước khi thêm phần `if`/`while` đo 1675,375 và 20 806,3125 µs: pha ngắt lệch vài µs giữa hai chương trình), line digital hai cực tính, `analogRead` 512, nút pull-up, chân thô A3 (`pwmWrite(A3, 100)` → LOW, `300` → kẹp 255 → HIGH).

Lượng tử hoá thời lượng tone (quan sát): `tone(pin, f, ms)` đảo chân đúng `floor(2 × f × ms / 1000)` lần rồi giữ LOW. 31 Hz × 40 ms → 2 lần đảo: một xung HIGH 16 ms rồi tắt.

### 3.9 `millis()` (`millis`)

250 lần đọc cách nhau ≈ 4 ms, so với thời gian ảo. `millis()` chậm hơn thời gian thật 0,47–2,45 ms (so từ reset). **Mô hình chính xác:** `n = floor((t − t0) / 1024)`, `millis = n + floor(3n / 125)` (ISR overflow Timer0 của `wiring.c`: +1 ms mỗi 1024 µs, mang 3/125 ms). **250/250 khớp** với mọi `t0` trong [459,1; 467,4] µs, tức Timer0 bắt đầu 0–7,9 µs trước câu lệnh đầu của `setup()` (C runtime xoá `.bss` trước `init()`, nên t0 so với reset tuỳ chương trình). Simulator dùng được mô hình này với `t` tính từ đầu `setup()`.

## 4. Chi phí đo được (µs, cycles/16)

Sketch `costs` (chương trình lớn, gọi với cả giá trị hằng và giá trị lúc chạy). Mẫu nhỏ nhất trừ baseline.

| Lời gọi | cycles | µs | Ghi chú |
|---|---|---|---|
| `digitalWrite` (chân không timer) | 73 | **4,5625** | LOW: 71 (4,4375) |
| `digitalWrite` (chân có timer, D5) | 90 | 5,625 | `turnOffPWM` |
| `digitalRead` (chân không timer, D4, A1) | 63 | **3,9375** | |
| `digitalRead` (chân có timer, D11) | 81 | 5,0625 | D3 cũng là chân timer (OC2B) |
| `analogRead` | 1693 | **105,8125** | lần đầu 3229 (201,8125): 25 chu kỳ ADC thay vì 13 |
| `analogWrite` 1..254 (Timer0/1) | 123 | **7,6875** | Timer2: 127 (7,9375); giá trị lúc chạy: 125 (7,8125) |
| `analogWrite` 0 / 255 | 178 / 186 | 11,125 / 11,625 | đi qua `digitalWrite` |
| `analogWrite` chân không PWM | 190 | 11,875 | |
| `pinMode` OUTPUT / INPUT_PULLUP | 70 / 76 | 4,375 / 4,75 | |
| `millis` | 19 | **1,1875** | |
| `delay(ms)` | — | ms × 1000 + 5,06 … 13,19 | trung vị +8,56 (delay 10), +8,94 (delay 1) |
| `Servo.write` | 792 | **49,5** | `map()` chia 32-bit |
| `tone(pin, f, ms)` / `tone(pin, f)` | 2785 / 2145 | 174,0625 / 134,0625 | |
| `noTone` | 102 | 6,375 | |
| `pulseIn` sau khi echo hết | — | **3,25** (2,625–3,3125) | |
| `pulseIn` không echo, timeout 30000 | 332 032 | **20 752** | 20 785,44 khi có Servo; timeout 10000 → 6923,69 |
| `Serial.write` 1 byte (hàng rỗng) | 74 | 4,625 | |
| `Serial.print(F(...))` mỗi byte vào hàng | — | **6,28** | 64 byte: 402,125 µs |
| byte thứ 65 trở đi | — | **1040** mỗi byte (USART); avr8js 1044,17 | UBRR0 = 207, U2X: 9615 baud, khung 10 bit |
| `Serial.print(long)` | 873 / 3723 / 7376 | 54,56 / 232,69 / 461 | 1 / 5 / 10 chữ số; dấu trừ +109 cycle |
| `Serial.println()` | 276 | 17,25 | `\r\n` |
| `Serial.println(true)` | 1158 | 72,375 | in `1` |
| vòng `loop()` rỗng | 5 | **0,3125** | không có delay ẩn |

**Tải ngắt** (100 ms cycle cố định, bật/tắt ngắt): ISR overflow Timer0 = 95,44 cycle mỗi 1024 µs (**0,583 %**); một Servo **0,163 %**; `tone` 1000 Hz **1,49 %** (≈ 119 cycle mỗi lần đảo, tăng tuyến tính theo tần số). Simulator v0 không tính tải này (contract §6).

**Độ lệch giữa hai chương trình** (sketch `costs-const`: cùng lời gọi, chỉ đối số hằng, chương trình nhỏ): `digitalWrite` 58 cycle (−21 %), `analogWrite` 73 (−41 %), `Servo.write` 726 (−8 %), `tone(10, 1000)` **94 cycle (5,875 µs, −96 %)**: avr-gcc `-flto` inline hoặc gập hằng tuỳ cả chương trình. Bảng chi phí là của lời gọi thật (không gập); với chương trình dày lệnh ngắn, thời gian board có thể ngắn hơn simulator tới ≈ 40 % phần chi phí lệnh (không tính `delay`/`pulseIn`).

## 5. Ngôn ngữ: `long` int32 trên avr-gcc 7.3 `-Os -flto`

Sketch `lang`, `lang-wrap`, `lang-wrapv`, mọi input là `volatile`:

| Biểu thức | Board | Ngữ nghĩa wrap (simulator) |
|---|---|---|
| `300 * 200` (int, không hậu tố) | −5536 (+ warning `-Woverflow`) | — |
| `300L * 200L` | 60000 | 60000 |
| `x + 1L > x`, x = INT32_MAX, toán tử thường | **1** (GCC gập: tràn có dấu là UB) | 0 |
| `(h * 2L) / 2L`, h = 2^30, toán tử thường | **1073741824** (gập thành h) | −1073741824 |
| như trên với helper `add32`/`mul32` (số học `unsigned long`, ép về `long`) | 0 / −1073741824 | 0 / −1073741824 |
| như trên với `__builtin_*_overflow`, asm barrier, `noinline` | đều đúng | |
| `#pragma GCC optimize("wrapv")` + toán tử thường | đúng | |
| `-7/2`, `-7%2`, `7/-2`, `7%-2`, `-7/-2`, `-7%-2` | −3, −1, −3, 1, 3, −1 | như board |
| `INT32_MIN / -1`, `INT32_MIN % -1`, `x % -1` (toán tử thường) | −2147483648, 0, 0 | như board |
| `7/0`, `-7/0`, `7%0`, `-7%0` (toán tử thường) | −1, 1, 7, −7 (libgcc) | — |
| `println(true)`, `println(false)`, `println(7 > 2)` | `1`, `0`, `1` | |
| `-1L < millis()` / `-1L < (long)millis()` | 0 / 1 | |
| `(long)2147483648UL` | −2147483648 | |

**Bẫy CSE:** trong `lang.ino`, helper `add32(x, 1L) > x` cũng ra 1, vì hai dòng trên đó có `x + 1L` thường *thực thi* tràn có dấu (UB) trong cùng hàm, và GCC gộp hai giá trị. `lang-wrap.ino` tách từng dạng vào một hàm có cùng bẫy: helper `unsigned` và `__builtin` sai khi có bẫy, asm barrier và `noinline` vẫn đúng; không có UB ở đâu thì mọi helper đều đúng. Kết luận cho generator: **không bao giờ viết `+ - * / %` hay `-` một ngôi thường trên giá trị của learner**; chỉ dùng helper. Khi đó chương trình không có tràn có dấu nào, và helper `unsigned` là đủ (định nghĩa theo C++ và GCC, §contract U-05). `#pragma GCC optimize` bị loại vì tài liệu GCC ghi "should be used for debugging purposes only. It is not suitable in production code."

## 6. Độ trung thực của avr8js (khác biệt đã thấy)

1. **Timer0 fast PWM** (D5, D6): avr8js cho HIGH = v/256 chu kỳ (128 → 512 µs). Datasheet: "If the OCR0A is set equal to BOTTOM, the output will be a narrow spike for each MAX+1 timer clock cycle", tức HIGH = (v+1)/256; tài liệu `analogWrite` cũng nói D5/D6 "will have higher-than-expected duty cycles". Lệch ≤ 1/256 chu kỳ (4 µs). Phase-correct (Timer1/2) đúng v/255.
2. **USART**: avr8js gộp UDR và shift register làm một, đặt UDRE sau đúng một khung, nên khung kế tiếp chậm thêm độ trễ ISR: **1044,17 µs/byte** thay vì 1040 (+0,40 %), và hàng chứa 64 byte trước khi chặn (board thật có thêm shift register: dự kiến 65; L3).
3. **Pull-up**: chân `INPUT_PULLUP` thả nổi đọc LOW trong avr8js; board đọc HIGH. Harness phải lái mức (nút "nhả" = HIGH).
4. USART không lái chân D1, nên trace không thấy chân TX; D0/D1 bị chiếm khi có Serial chỉ là DOCUMENTED.
5. Không có điện, nhiễu, sai số thạch anh, đặc tính cảm biến/động cơ: tất cả là L3.

## 7. Quyết định: GO cho C2, có điều kiện

**Lý do GO:**
- HEX từ toolchain đã pin chạy trên avr8js trong Node, không cần tool ngoài lúc test (HEX fixture commit kèm hash của `.ino`, như plan C2).
- Mọi kỳ vọng ở mức trace khớp ±1 %: blink, chu kỳ/duty PWM (v/255), xung servo, tần số tone, cạnh echo, `delay`; 29/29 kiểm tra trên các dạng C++ của contract đúng ngữ nghĩa.
- Hành vi chưa có tài liệu đầy đủ (PWM trên timer bị chiếm, timeout thật của `pulseIn`, tải ngắt, `millis()` lệch) quan sát được và tái lập được: contract thay UNKNOWN bằng VERIFIED.
- Đủ nhanh: ≈ 6× thời gian thực trên Node; 60 s ảo ≈ 10 s, nằm trong ngân sách CI nếu chọn fixture ngắn.

**Điều kiện (C2 phải làm đúng, nếu không thì quay về NO-GO):**
1. So trace ở mức **sự kiện chân** và **giá trị Serial**, không so từng cycle. Khoảng thời gian ≥ 1 ms: dung sai ±1 %. Khoảng ngắn hơn (chuỗi lệnh dày): dung sai theo độ lệch LTO đo ở §4, hoặc C2 so với HEX của **chính** chương trình sinh ra, không với bảng `costsUs`.
2. Danh sách khác biệt được phép là dữ liệu, lấy từ §6 (Timer0 duty, 1044 vs 1040 µs/byte, hàng 64 byte, pull-up) và từ các mục ghi "L2e ≠ L1" của contract (ISR làm `pulseIn` đọc ngắn; tải ngắt; `LOOP_MIN_US`).
3. HEX dựng bằng `scripts/build-parity-hex.mjs` với đúng `arduino-cli 1.5.1`, `arduino:avr@1.8.8`, `Servo 1.3.0`; đổi bất kỳ version nào là đổi contract (R0.3 §1).
4. Chân đầu vào luôn do harness lái (không dựa vào pull-up của avr8js).

**Không chọn:**
- NO-GO (chỉ L2 compile): bỏ mất evidence về timer, `pulseIn`, wrap, vốn chỉ thấy được khi chạy.
- Dùng avr8js trong lab (thay simulator mức chân): trái D-R5, chậm hơn cho 3D realtime, và không cho `RobotSnapshot` tất định ở mức module.

## 8. Hệ quả cho plan (đã sửa trong cùng thay đổi)

| Chỗ trong plan | Trước | Theo evidence |
|---|---|---|
| R1.3 test `analogRead … charges 112 µs` | 112 µs | **105,8125 µs** (lần đầu 201,8125) |
| R1.3 test `pulseIn returns 0 on timeout and charges timeoutUs` | timeout | không echo: **20 752 µs** với timeout 30000 (mô hình 11/16 cycle, contract U-27) |
| §3 "`pulseIn` charge đúng thời gian echo hoặc timeout" | | chờ + độ rộng + 3,25 µs; không echo theo mô hình |
| C1 golden `300*200 literal emits 300L*200L`, `INT32 wrap` | toán tử thường | `mul32(300L, 200L)`: toán tử thường làm GCC gập sai (§5) |
| Review Focus 4 | "cho tới khi C2 có trace" | đã có trace (§3.4, §3.5); quyết định vẫn là **từ chối** với `timer-claimed` |

## 9. Tham chiếu

- avr8js 0.21.1: type trong `node_modules/avr8js/dist/esm/**/*.d.ts` (đã đọc trước khi dùng); repo `github.com/wokwi/avr8js`.
- Arduino reference (nguồn `github.com/arduino/reference-en`, truy cập 2026-10-25): `analogWrite`, `analogRead`, `tone`, `pulseIn`, `millis`, `digitalRead`, `Serial`, `Serial.write`, `long`, `int`; Servo `docs/readme.md`, `docs/api.md` (bản 1.3.0 đã cài).
- Microchip DS40002061A (ATmega48A/PA/88A/PA/168A/PA/328/P), bản PDF tải 2026-10-25.
- GCC 7.3 manual: "Integers implementation", "Integer Overflow Builtins", "Common Function Attributes" (`optimize`), "Code Gen Options" (`-fwrapv`).
- C++ working draft `eel.is/c++draft/expr.mul`, `conv.integral` (truy cập 2026-10-25).
- Release: `gh api repos/arduino/ArduinoCore-avr/releases` (1.8.8: 2026-05-21), `repos/arduino-libraries/Servo/releases` (1.3.0: 2025-11-06), `repos/wokwi/avr8js/releases` (v0.21.1: 2026-08-31).
