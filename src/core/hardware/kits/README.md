# Kit robot (`*.kit.json`)

Một kit mô tả robot dưới dạng **dữ liệu**: role → port → driver → chân của board (plan `docs/robot-3d-implementation-plan.md`
§4.2). Program chỉ gọi role (`motorLeft`, `ultrasonic`…); kit nói role đó cắm ở port nào, port đó chạy driver nào và nối vào
chân nào của board. Driver là code TS/C++ đã review, tham chiếu bằng id (`src/core/hardware/drivers/`), nên **đổi kit không
đổi code**.

## `ref-uno-rover@0` là kit tham chiếu, chân là PLACEHOLDER

Đến khi nhà cung cấp trả lời bộ câu hỏi `docs/uno-vendor-questions.md`, mọi project robot không ghi `kit` đều dùng
`ref-uno-rover@0` (`catalog.ts`, `referenceKitRef`). Chân của nó lấy nguyên văn từ plan §4.2:

| Role | Port | Driver | Chân |
|---|---|---|---|
| `motorLeft` | M1 | `hbridge-en-in1-in2` | EN=D5, IN1=D7, IN2=D8 |
| `motorRight` | M2 | `hbridge-en-in1-in2` | EN=D6, IN1=D4, IN2=D2 |
| `ultrasonic` | US1 | `hcsr04-pulsein` | TRIG=D12, ECHO=D11 |
| `lineLeft`, `lineCenter`, `lineRight` | LN1–LN3 | `line-digital` (`activeLow: false`) | A0, A1, A2 |
| `led1` | LED1 | `led-digital` | D13 |
| `button1` | BTN1 | `button-pullup` (INPUT_PULLUP) | D3 |
| `servo1` | SV1 | `servo-lib` | D9 |
| `buzzer` | BZ1 | `buzzer-tone` | D10 |

Thứ tự `ports` là thứ tự sketch sinh ra viết `setup()` (sau `Serial.begin` khi program có in), nên kit này giữ đúng thứ tự
của `spikes/avr8js/sketches/contract-forms/contract-forms.ino`.

## Phần cơ khí: `chassis`, `mount`, `spec` (N18 R3.3)

World (`src/core/world/robot/assembly.ts`) dựng robot từ phần này; `loadKit` kiểm nó bằng `kit-mechanics.ts` và chỉ đường
dẫn của từng lỗi (`modules.0.spec.maxRpm: …`, `chassis.comCm.0: …`). Mọi khoá đều **bắt buộc**, không có giá trị mặc định,
và khoá lạ bị từ chối.

**Khung robot** (cho `mount.posCm`, `chassis.comCm`, `chassis.casterCm`): lấy tâm chassis làm gốc, gốc nằm **trên mặt sàn**,
ngay dưới tâm của hộp thân (`bodyCm`) khi robot đứng yên trên sàn phẳng. **x phía trước, y bên trái, z hướng lên**, đơn vị cm.
Vì vậy z là độ cao so với sàn. `mount.yawDeg` quay module quanh z, ngược chiều kim đồng hồ (về phía +y) tính từ phía trước.

| Phần | Khoá | Ý nghĩa |
|---|---|---|
| `chassis` | `bodyCm` [dài x, rộng y, cao z], `clearanceCm` | hộp thân, đáy hộp cao `clearanceCm` so với sàn |
| | `massG`, `comCm` | khối lượng cả robot (gồm tay servo), tâm khối lượng (không gồm tay servo) |
| | `trackCm` | khoảng cách hai tâm bánh; bánh trái ở y = +trackCm/2 |
| | `casterCm`, `casterRadiusCm` | tâm và bán kính bánh tự lựa (bi cầu), chạm sàn: z = bán kính |
| | `frictionWheel` | hệ số ma sát lốp–sàn: độ bám giới hạn lực đẩy của bánh |
| `dc-motor` | `maxRpm`, `tauS`, `stallTorqueNm`, `gearFrictionNm` | ω₀ của đường mô-men (duty 255, không tải, chưa trừ ma sát hộp số), hằng số thời gian bậc 1, mô-men kẹt T_s, ma sát Coulomb của hộp số T_f (< T_s); đường mô-men T = T_s·(u − ω/ω₀) |
| | `wheelRadiusCm`, `wheelWidthCm` | bánh trên trục motor; `mount` là tâm bánh, z = bán kính, `yawDeg` = 0 |
| `servo` | `sPer60Deg`, `minDeg`, `maxDeg`, `restDeg`, `stallTorqueNm` | tốc độ (s cho 60°), dải góc, góc lúc dựng world, mô-men giữ tối đa |
| | `armLengthCm`, `armWidthCm`, `armHeightCm`, `armMassG` | tay servo: thanh quay trong mặt phẳng ngang quanh trục z của `mount`; góc 0 chỉ theo `yawDeg`, tăng ngược chiều kim đồng hồ |
| `ultrasonic` | `coneHalfDeg`, `minCm`, `maxCm` | nửa góc chùm, khoảng đo (R3.4 dùng) |
| `line-sensor` | `heightCm`, `spotRadiusCm`, `darkBelow` | độ cao so với sàn (phải bằng z của `mount`), bán kính vùng đọc, ngưỡng phản xạ coi là "tối" (R3.4 dùng) |
| `led`, `buzzer`, `button` | (không có) | `spec` là `{}` |

`loadKit` còn kiểm hình học: đủ `motorLeft` và `motorRight` khi có `chassis`, hai bánh chung một trục (cùng x) cách nhau
`trackCm`, bánh và caster chạm sàn, tâm khối lượng nằm giữa trục bánh và caster (không thì robot lật), `heightCm` của cảm
biến line bằng độ cao gắn, dải góc servo hợp lệ và tay servo không chạm sàn.

**Mọi số cơ khí của `ref-uno-rover@0` là PLACEHOLDER** cho một rover UNO nhỏ, tới khi nhà cung cấp gửi số đo (§3, §4 của
`docs/uno-vendor-questions.md`): thân 15 × 12 × 5 cm, 400 g, bánh 6,6 cm, motor giảm tốc TT 1:48 với ω₀ = 200 rpm,
T_s = 0,08 N·m (0,8 kgf·cm), T_f = 0,025 N·m, τ = 0,05 s; servo cỡ SG90 (0,1 s/60°, 0–180°, 0,18 N·m). `mount` của LED,
còi, nút chỉ để vẽ.

**Ma sát hộp số** (`gearFrictionNm`): giữ robot đứng yên khi bị đẩy (hai bánh giữ tới 2·T_f/r ≈ 1,5 N với số trên) và là
lực cản lăn khi chạy. Bánh chạy tự do ở ω₀·(1 − T_f/T_s), không phải ω₀: với số trên là 69 % (0,48 m/s ở duty 255), và
duty dưới T_f/T_s · 255 ≈ 80 không khởi động được robot (như motor TT thật ở PWM thấp). Khi nhà cung cấp cho tốc độ không
tải đo được n₀ (đã gồm ma sát), đặt `maxRpm = n₀ / (1 − T_f/T_s)`.

## Thay bằng kit của nhà cung cấp

1. Lấy câu trả lời của `docs/uno-vendor-questions.md`: §1 (MCU, phải là ATmega328P để giữ board `uno-r3` và kiểm chứng
   avr8js), §2 (schematic, bảng **cổng → chân**, IC driver motor và kiểu điều khiển), §3 (cực tính cảm biến line, thông số
   motor/servo/siêu âm: điền vào `spec` theo bảng ở trên), §4 (vị trí gắn module theo khung robot, kích thước và khối lượng
   thân: điền `chassis`).
2. Tạo `src/core/hardware/kits/<vendor-kit>.kit.json`, bản sao của `ref-uno-rover.kit.json`, với `id`, `version` mới và
   `board: "uno-r3"`. Mỗi port: `id` theo nhãn trên robot, `driver` là một id có sẵn, `pins` dùng đúng tên chân của driver
   (`EN`/`IN1`/`IN2`, `TRIG`/`ECHO`, `PIN`), `params` nếu driver có (`activeLow` của `line-digital`: vạch đen là LOW thì
   `true`). Mỗi module: một role của từ vựng chuẩn, đúng loại (`kind`) của role, một port.
3. Thêm file vào `productionKits` trong `src/core/hardware/catalog.ts`. `loadKit` từ chối kit sai và chỉ đường dẫn của lỗi
   (`ports.0.pins.EN: D7 has no pwm`): driver không có, chân không có trên board, chân thiếu capability (EN phải là PWM),
   role ngoài từ vựng, loại module không khớp port, hai module một port.
4. Chạy `checkKit(kit, board, usage)` với `usage` có servo, tone và in: phải không có diagnostic. Nó báo `pin-conflict`
   (hai port một chân), `pin-reserved` (D0/D1 khi có in) và `timer-claimed` (driver cần PWM trên timer mà servo giữ: T1 =
   D9, D10; hoặc tone giữ: T2 = D3, D11 — trace R0.4 cho thấy chân giữ LOW, contract U-48).
5. Viết test như `kit.test.ts` cho chân của kit mới, rồi chạy `pnpm verify`. Kịch bản (`rb-*`) ghi `kit` mới thì tăng
   `version` của kịch bản.

**Cần việc engine** (ngoài việc thay dữ liệu, plan VG, khoảng 16–24h mỗi loại) khi kit có: loại module mới (cảm biến màu,
màn hình…), driver motor điều khiển khác EN+IN1/IN2 (PWM+DIR, I²C như PCA9685, vi điều khiển phụ có protocol riêng), hoặc
MCU không phải ATmega328P (board profile mới, C2 không áp dụng). Khi đó cần thêm `DriverId`, driver TS + C++ có dòng
contract và evidence, và test.
