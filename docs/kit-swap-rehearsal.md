# Diễn tập đổi kit (kit-swap rehearsal, N18 R8a)

**Câu hỏi:** khi nhà cung cấp gửi kit thật (chân khác, cực tính khác), có phải sửa engine không? Plan §R8 trả lời bằng một buổi diễn tập:
một kit "của nhà cung cấp khác" làm **chỉ bằng dữ liệu**, rồi chạy lại toàn bộ kiểm chứng mà **không đụng engine**.

**Kết quả:** đổi kit là thay dữ liệu. Không có thay đổi nào dưới `src/core/world/**`, `src/core/run/**`, `src/core/program/**`,
`src/core/hardware/drivers/**`, `virtual-uno.ts`, `binding.ts`, `src/core/codegen/**`. Sáu lời giải mẫu đạt **đúng** điểm như với kit tham
chiếu, sketch chỉ khác ở chân, cực tính line và thứ tự IN, sketch compile được (L2), và C2 khớp trên avr8js (cả 7 fixture driver, sau
quyết định ở §4.2). Hai phát hiện ở §4.

Test: `tests/kit-rehearsal.test.ts`.

## 1. Kit diễn tập `rehearsal-rover@0`

File: `src/core/hardware/kits/rehearsal.kit.json`. Là bản sao của `ref-uno-rover@0` với **cùng phần cơ khí** (chassis, module, `mount`,
`spec` giống hệt, test `is the reference robot` kiểm), cùng port (id, driver, thứ tự), để mọi scenario công bằng như cũ. Chỉ đổi dây:

| Port (role) | Driver | `ref-uno-rover@0` | `rehearsal-rover@0` |
|---|---|---|---|
| M1 (`motorLeft`) | `hbridge-en-in1-in2` | EN=D5, IN1=D7, IN2=D8 | EN=D6, IN1=D2, IN2=D4 |
| M2 (`motorRight`) | `hbridge-en-in1-in2` | EN=D6, IN1=D4, IN2=D2 | EN=D5, IN1=D7, IN2=D8 |
| US1 (`ultrasonic`) | `hcsr04-pulsein` | TRIG=D12, ECHO=D11 | TRIG=D11, ECHO=D12 |
| LN1–LN3 (`lineLeft`, `lineCenter`, `lineRight`) | `line-digital` | A0, A1, A2, `activeLow: false` | A3, A2, A1, **`activeLow: true`** |
| SV1 (`servo1`) | `servo-lib` | D9 | D10 |
| LED1 (`led1`) | `led-digital` | D13 | D9 |
| BZ1 (`buzzer`) | `buzzer-tone` | D10 | D3 |
| BTN1 (`button1`) | `button-pullup` (INPUT_PULLUP) | D3 | D13 |

- **Mọi chân của mọi port đều đổi** (test kiểm từng chân).
- **Cực tính IN của motor:** driver `hbridge-en-in1-in2` **không có** param đảo chiều, và không thêm param nào. Cực tính đi bằng dữ liệu:
  motor trái nằm trên chân cũ của motor phải với IN1/IN2 **đổi chỗ** (ref M2 là IN1=D4, IN2=D2; rehearsal M1 là IN1=D2, IN2=D4). Trên
  robot thật, một motor nối ngược chiều được sửa đúng như vậy: đổi IN1/IN2 trong kit. Trong mô phỏng, world đọc IN1/IN2 qua chính kit, nên
  "tiến" vẫn là tiến: mô phỏng không thể hiện được một dây nối ngược, chỉ kiểm được rằng đổi IN trong dữ liệu không cần engine.
- **Chọn chân để `checkKit` sạch** (đúng các giá trị ví dụ của brief, không phải đổi): EN cần PWM và nằm trên D5/D6 (Timer0, không ai
  giữ). Servo (Timer1) ở D10, LED ở D9 cũng thuộc Timer1 nhưng `led-digital` chỉ cần `digital`, nên không vướng `timer-claimed`. Tone
  (Timer2) ở D3, TRIG ở D11 cũng thuộc Timer2 nhưng chỉ cần `digital`. Không dùng D0/D1. Nút ở D13 giữ quy tắc pull-up (`button-pullup`,
  INPUT_PULLUP). Ghi chú phần cứng thật: trên UNO R3, LED "L" ở D13 đi qua op-amp đệm nên INPUT_PULLUP ở D13 vẫn đọc đúng; board clone
  không có đệm thì không nên đặt nút ở D13.
- **Không phải kit sản phẩm.** Schema kit là `strictObject` và không có trường `notes`/`rehearsal`, nên nó chỉ được đánh dấu ở đây và trong
  code: kit được đăng ký đúng cách của kit sản phẩm (`createKitCatalog`, kiểm khi module nạp) nhưng trong một catalog riêng,
  `rehearsalKits` (`src/core/hardware/rehearsal-kits.ts`: kit tham chiếu và kit diễn tập), **không** nằm trong `productionKits`, và không file
  nào của app import module đó. Một document ghi `kit: { id: "rehearsal-rover", version: "0" }` compile được với catalog này.

## 2. Đã chạy gì, kết quả

| Kiểm | Kết quả |
|---|---|
| `checkKit(rehearsal, uno-r3, usage)` với cả 8 tổ hợp servo / tone / Serial | không có diagnostic nào |
| `kitBoardTarget` | cùng `roles` (10 role, thứ tự từ vựng), cùng `ops`, cùng `claimers` như kit tham chiếu |
| 6 lời giải mẫu qua `checkRobot` headless, kit đổi trong document và trong scenario | **cùng** `RobotCheckResult` (điểm, `passed`, variant, `simTimeMs`, `programHash`, goal), cùng kết quả từng goal, cùng cách kết thúc, cùng hash world cuối của từng variant (bỏ phần `pins` của snapshot, vốn ghi tên chân) |
| Sketch C1 (`generateUnoSketch`) của 6 lời giải, so từng dòng với sketch của kit tham chiếu | chỉ khác: dòng 1 (tên kit), các `#define` chân, và `digitalRead(LINE_…) == HIGH` thành `== LOW` (line-follow, mini-mission: 3 dòng mỗi bài). Thứ tự IN nằm trong giá trị `#define` |
| L2: `pnpm check:arduino` (golden ở `tests/kit-rehearsal/rehearsal-rb-*.ino`) | xem §3 |
| C2: 7 fixture driver chạy trên kit diễn tập (`tests/__parity-rehearsal__`) | motor, servo, ultrasonic, line, LED, button, buzzer: simulator và board khớp (harness không báo vấn đề nào), in **cùng** dòng Serial như trên kit tham chiếu (cả hai phía), và trên simulator mỗi chân của kit đi qua **cùng** chuỗi trạng thái như chân tương ứng của kit tham chiếu; servo khớp nhờ luật xung đầu sau `attach()` (§4.2) |

Điểm của 6 bài (giống hệt trên hai kit): `rb-drive-to-zone` 100 (1 variant, 15 000 ms), `rb-square-route` 100 (1, 40 000 ms),
`rb-stop-at-wall` 100 (3, 20 000 ms), `rb-line-follow` 100 (3, 120 000 ms), `rb-servo-gate` 100 (3, 20 000 ms), `rb-mini-mission` 96
(3 variant: 96, 96, 97; 45 000 ms).

Chân trên timer làm `digitalWrite` đắt hơn trong bảng chi phí của board (`costsUs.digitalWriteTimerPin` 5,625 µs so với 4,5625 µs): với
TRIG ở D11, mỗi lần đo siêu âm chậm hơn vài µs. Không kết quả nào đổi: world chấm theo tick 1/120 s.

Fixture C2 trên kit diễn tập là chính chương trình của fixture driver (`tests/parity/fixtures.ts`, `rehearsalParityFixtures`), với input
dời sang chân của kit diễn tập (`inputsOnKit`): mỗi chân đi theo port và tên chân; cảm biến line có `activeLow` khác thì đọc mức ngược lại
(kể cả mức mặc định lúc 0 µs), để thế giới vẫn là một. HEX build bằng `pnpm build:parity-hex --rehearsal` (thêm tuỳ chọn này vào
`scripts/build-parity-hex.mjs`; bộ HEX của kit tham chiếu không đổi).

## 3. L2: compile bằng arduino-cli

`pnpm check:arduino` compile mọi `.ino` trong `src` và `tests`, nên 6 sketch diễn tập (`tests/kit-rehearsal/`) vào cùng cơ chế với golden
của C1 và sketch lời giải mẫu (`tests/robot-solutions/`). Tên file có tiền tố `rehearsal-` để không trùng tên sketch của lời giải mẫu trong
thư mục build tạm của script.

Kết quả (2026-10-25, máy dev macOS, arduino-cli 1.5.1, arduino:avr@1.8.8, `pnpm check:arduino`): `L2 = PASS`, 29 sketch (17 golden C1,
6 lời giải mẫu, 6 sketch diễn tập), không cảnh báo nào của sketch. Sketch diễn tập dùng **đúng** bộ nhớ như sketch của kit tham chiếu:

| Sketch | Flash | RAM |
|---|---|---|
| `rehearsal-rb-drive-to-zone.ino` | 1462 B (4,5 %) | 9 B |
| `rehearsal-rb-square-route.ino` | 1594 B (4,9 %) | 9 B |
| `rehearsal-rb-stop-at-wall.ino` | 1668 B (5,2 %) | 9 B |
| `rehearsal-rb-line-follow.ino` | 1594 B (4,9 %) | 9 B |
| `rehearsal-rb-servo-gate.ino` | 2700 B (8,4 %) | 50 B (Servo@1.3.0) |
| `rehearsal-rb-mini-mission.ino` | 1896 B (5,9 %) | 9 B |

## 4. Phát hiện

### 4.1 Scenario gắn chặt với kit tham chiếu (dữ liệu, không phải engine)

Schema scenario buộc mỗi key `rb-*` dùng `robotKitId` của `src/samples/robot-keys.ts` (`ref-uno-rover`), và run session từ chối kit khác
`scenario.kit`. Nên một file scenario **không thể** ghi `kit: "rehearsal-rover"`. Test đổi `kit` trên scenario đã nạp (`{ ...scenario,
kit: "rehearsal-rover" }`), đúng như việc một kit thật thay `robotKitId`. Với kit thật của nhà cung cấp, đây là thay **dữ liệu**:
`robotKitId`/`robotKitVersion` trong `robot-keys.ts`, `kit` của mọi `rb-*.json`, và tăng `version` của từng scenario (kits/README.md bước 5).

### 4.2 C2: servo trên D10, xung đầu tiên sau `attach()` dài hơn (đã xử lý ở harness)

Board (avr8js chạy HEX thật) gửi đúng góc mà simulator có: xung 90° hai lần rồi 45°… (Servo 1.3.0: 544 + góc · 1856 / 180 µs). Nhưng
xung **đầu tiên** sau `attach()` dài hơn xung ổn định ngay sau nó: **4,5625 µs** trên D10 (`rehearsal-driver-servo`), 3,5625 µs trên D9
của kit tham chiếu (`driver-servo`). Allowed difference `waveform-jitter` cho độ rộng xung servo trong một run lệch **4 µs**, nên lúc đầu
bộ đọc trace của board không ghép xung đầu vào run 90° trên D10: nó đọc thành HIGH rồi LOW, và so sánh báo
`D10: the simulator went INPUT, LOW, servo 90°, …; the board INPUT, LOW, HIGH, LOW, servo 45°, …`.

Đây là dung sai của harness, không phải lỗi của simulator hay của kit. **Quyết định của controller** (R8a fix round 1): harness có một luật
riêng, có ghi lại, cho xung đầu sau `attach()`: allowed difference `servo-first-pulse` thêm `firstWidthUs: 6` (thời gian ngắt Timer0
5,97 µs làm tròn lên). Xung đầu được ghép vào run của góc khi độ rộng lệch xung sau nó ≤ 6 µs; các xung ổn định vẫn giữ 4 µs
(`tests/parity/board-trace.ts` `findRuns`, test `joins the first servo pulse after attach…` của `board-trace.test.ts`). Số đo 4,5625 µs
trên D10 được ghi làm evidence ở dòng "Xung servo đầu tiên sau attach" của contract §13. Với luật đó `rehearsal-driver-servo` khớp, và bộ
fixture của kit tham chiếu vẫn khớp như trước.

## 5. Thêm kit thật của nhà cung cấp

1. Lấy câu trả lời của `docs/uno-vendor-questions.md` (MCU phải là ATmega328P để giữ board `uno-r3` và C2; bảng cổng → chân; IC driver
   motor và kiểu điều khiển; cực tính cảm biến line; số đo motor, servo, siêu âm; vị trí gắn module, kích thước, khối lượng).
2. **Chỉ dữ liệu**, khi mọi module là loại đã có và driver motor là EN + IN1/IN2: tạo `src/core/hardware/kits/<vendor>.kit.json` từ
   `ref-uno-rover.kit.json` (id, version mới; `pins` theo tên chân của driver; `activeLow` theo cực tính line; motor nối ngược thì đổi
   IN1/IN2), thêm vào `productionKits` (`catalog.ts`). `loadKit` từ chối dữ liệu sai và chỉ đường dẫn của lỗi.
3. Chạy `checkKit` với cả 8 tổ hợp servo / tone / Serial: phải không có diagnostic (chọn chân như §1: PWM của EN không nằm trên timer servo
   T1 = D9/D10 hay tone T2 = D3/D11; không dùng D0/D1).
4. Đổi `robotKitId`/`robotKitVersion` trong `src/samples/robot-keys.ts` và `kit` của mọi `rb-*.json`; tăng `version` scenario. Phần cơ khí
   đổi thì đo lại thời gian của lời giải open-loop (lesson 1–2, blind program) theo `docs/robot-scenario-authoring.md`.
5. Chạy lại như buổi diễn tập: copy `tests/kit-rehearsal.test.ts` cho kit mới (checkKit, board target, 6 lời giải mẫu, diff sketch, golden),
   `pnpm build:parity-hex` cho fixture C2 trên kit mới, `pnpm check:arduino`, `pnpm verify`.
6. **Cần driver mới (engine)** chỉ khi protocol mới: driver motor không phải EN + IN1/IN2 (PWM + DIR, I²C như PCA9685, vi điều khiển phụ),
   loại module mới (cảm biến màu, màn hình…), hoặc MCU khác ATmega328P (board profile mới, C2 không áp dụng). Khi đó thêm `DriverId`,
   driver TS + C++ có dòng contract, evidence và test (kits/README.md, plan VG).

## 6. Chạy lại

```sh
pnpm vitest run tests/kit-rehearsal.test.ts      # kit, 6 lời giải, sketch, C2
node scripts/build-parity-hex.mjs --rehearsal    # build lại HEX của C2 diễn tập (arduino-cli 1.5.1, arduino:avr@1.8.8, Servo 1.3.0)
pnpm check:arduino                               # L2, gồm tests/kit-rehearsal/*.ino
git diff --stat master -- src/core/world src/core/run src/core/program src/core/hardware/drivers src/core/hardware/virtual-uno.ts src/core/hardware/binding.ts src/core/codegen   # rỗng
```
