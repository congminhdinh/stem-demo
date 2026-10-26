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
và khoá lạ bị từ chối. Ngoại lệ duy nhất là `chassis.footprintRadiusCm` (N19 D-G8): tùy chọn, và schema **không** điền giá trị mặc định.

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
| | `footprintRadiusCm` (tùy chọn) | bán kính vòng tròn quanh điểm của tư thế mà các biến thể kịch bản giữ trống ở chỗ xuất phát (`kitFootprintRadiusCm`, `scenario/variants.ts`). Bỏ qua thì là 11 cm (`ROBOT_FOOTPRINT_RADIUS_CM`, như rover); kit nhô xa hơn thân (tay gắp) ghi số lớn hơn. Phải ≥ tầm với của kit (`robotFootprint(kit).radiusCm`), có test cho mọi kit trong catalog |
| `dc-motor` | `maxRpm`, `tauS`, `stallTorqueNm`, `gearFrictionNm` | ω₀ của đường mô-men (duty 255, không tải, chưa trừ ma sát hộp số), hằng số thời gian bậc 1, mô-men kẹt T_s, ma sát Coulomb của hộp số T_f (< T_s); đường mô-men T = T_s·(u − ω/ω₀) |
| | `wheelRadiusCm`, `wheelWidthCm` | bánh trên trục motor; `mount` là tâm bánh, z = bán kính, `yawDeg` = 0 |
| `servo` | `sPer60Deg`, `minDeg`, `maxDeg`, `restDeg`, `stallTorqueNm` | tốc độ (s cho 60°), dải góc, góc lúc dựng world (để tay nằm trong khung thân), mô-men giữ tối đa |
| | `armLengthCm`, `armWidthCm`, `armHeightCm`, `armMassG` | tay servo: thanh quay trong mặt phẳng ngang quanh trục z của `mount`; góc 0 chỉ theo `yawDeg`, tăng ngược chiều kim đồng hồ |
| `ultrasonic` | `coneHalfDeg`, `minCm`, `maxCm` | nửa góc chùm, khoảng đo (R3.4 dùng) |
| `line-sensor` | `heightCm`, `spotRadiusCm`, `darkBelow` | độ cao so với sàn (phải bằng z của `mount`), bán kính vùng đọc, ngưỡng phản xạ coi là "tối" (R3.4 dùng) |
| `led`, `buzzer`, `button` | (không có) | `spec` là `{}` |

`loadKit` còn kiểm hình học: đủ `motorLeft` và `motorRight` khi có `chassis`, hai bánh chung một trục (cùng x) cách nhau
`trackCm`, bánh và caster chạm sàn, tâm khối lượng nằm giữa trục bánh và caster (không thì robot lật), `heightCm` của cảm
biến line bằng độ cao gắn, dải góc servo hợp lệ và tay servo không chạm sàn.

**Mọi số cơ khí của `ref-uno-rover@0` là PLACEHOLDER** cho một rover UNO nhỏ, tới khi nhà cung cấp gửi số đo (§3, §4 của
`docs/uno-vendor-questions.md`): thân 15 × 12 × 5 cm, 400 g, bánh 6,6 cm, motor giảm tốc TT 1:48 với ω₀ = 200 rpm,
T_s = 0,08 N·m (0,8 kgf·cm), T_f = 0,025 N·m, τ = 0,05 s; servo cỡ SG90 (0,1 s/60°, 0–180°, 0,18 N·m), tay nghỉ ở 0° (gập sang phải dọc mặt
trên). Trục servo đặt 1,5 cm trước tâm thân, tay dài 5,5 cm (rộng 0,8 cm): xa nhất √(5,5² + 0,4²) = 5,51 cm từ trục, nên tay
nằm trong khung thân 15 × 12 cm nhìn từ trên ở **mọi** góc 0–180° (7,01 cm phía trước, 5,51 cm sang hai bên; R3.5). Lý do:
thư viện Servo bắt đầu ở 90° (`SERVO_START_DEG`), tức là tay chĩa ra trước ngay khi chương trình dùng servo, và một tay nhô ra
trước chạm tường trước, làm robot chúi ngửa (ADR 0001 §9). Servo vì thế là cờ hay thanh chắn trên nóc robot, không phải tay đẩy;
đẩy vật là việc của thân robot. Kit của nhà cung cấp nên giữ đúng điều này (kiểm bằng test `stays inside the body's footprint at
every angle` của `assembly.test.ts`). `mount` của LED, còi, nút chỉ để vẽ.

**Ma sát hộp số** (`gearFrictionNm`): giữ robot đứng yên khi bị đẩy và là lực cản lăn khi chạy. Đo với số trên (lực đẩy
tác dụng trong bước, 2 s): robot phanh hay thả trôi giữ **sạch tới khoảng 1,1 N** (lệch < 0,1 mm); 1,2 N làm nó nhích
khoảng 1 mm, 1,5 N đẩy robot thả trôi đi 20 cm. Con số danh nghĩa 2·T_f/r = 1,52 N cao hơn vì ma sát tĩnh của solver
không giữ trọn. Bánh chạy tự do ở ω₀·(1 − T_f/T_s), không phải ω₀: với số trên là 69 % (0,48 m/s ở duty 255). Khởi động
không có ngưỡng cứng: duty ≤ 75 đứng yên (< 0,2 mm trong 2 s), 78 bò khoảng 2 mm, từ T_f/T_s · 255 ≈ 80 thì chạy, lúc đầu
rất chậm (1 cm trong 2 s ở duty 80, 3,6 cm ở 85, 11 cm ở 100), như motor TT thật ở PWM thấp. Dừng theo contract (IN1, IN2,
EN đều LOW) là **thả trôi**: motor hở mạch, chỉ ma sát hộp số giữ và hãm; phanh (IN1 = IN2, EN HIGH) thêm mô-men hãm tỉ lệ
tốc độ. Khi nhà cung cấp cho tốc độ không
tải đo được n₀ (đã gồm ma sát), đặt `maxRpm = n₀ / (1 − T_f/T_s)`.

## `ref-uno-gripper@0`: xe tay gắp 2 bậc, chân và số đều là PLACEHOLDER (N19)

Kit thứ hai của catalog (`productionKits`, `robot-keys.ts` `robotKits`), theo plan `docs/n19-gripper-plan.md` §4.1, §4.2, §4.6 và
ADR 0004. File kit rover giữ nguyên từng byte; kịch bản chọn kit theo key (D-G1). Chưa có key `rb-grip-*` nào dùng kit này (task D).

| Role | Port | Driver | Chân | Gắn |
|---|---|---|---|---|
| `motorLeft`, `motorRight` | M1, M2 | `hbridge-en-in1-in2` | như rover | như rover |
| `ultrasonic` | US1 | `hcsr04-pulsein` | TRIG=D12, ECHO=D11 | `[7.5, 0, 5.0]` |
| `lineLeft`, `lineCenter`, `lineRight` | LN1–LN3 | `line-digital` (`activeLow: false`) | A0, A1, A2 | như rover |
| `led1`, `button1` | LED1, BTN1 | `led-digital`, `button-pullup` | D13, D3 | như rover |
| `gripper` | GR1 | `gripper-servo2` | CLAW=D9, LIFT=D10 | `[4.5, 0, 4.9]` |
| `irClaw` | IR1 | `ir-digital` (`activeLow: true`) | A3 | `on: 'gripper'`, `[0.3, 0.6, 0]` |
| `color1` | CS1 | `tcs34725-wire` (địa chỉ 0x29 cố định) | SDA=A4, SCL=A5 | `on: 'gripper'`, `[0.3, -0.6, 0]` |

Không có `servo1` (cờ) và `buzzer`. Hai servo của tay gắp dùng thư viện Servo (giữ Timer1 như `servo-lib`, U-48); `setup()` gắn cả
hai, ghi kẹp 0° (mở) và tay 90° (nâng), dù chương trình dùng op nào (D-G3). Góc 0…90 được kẹp trong `gripperSet`.

**Chassis:** như rover, trừ `massG 460` (**cả xe**, gồm phần động của tay gắp: boom 6 + giá kẹp 22 + 2 ngón × 3 = 34 g, nên thân
chassis còn 426 g, §4.6), `comCm [-1.2, 0, 3.6]` và `footprintRadiusCm 16` (tay gắp nhô trước thân, D-G8).

**Spec mới** (mọi khoá bắt buộc, khoá lạ bị từ chối):

| Loại | Khoá | Ý nghĩa |
|---|---|---|
| `gripper` | `liftSPer60Deg`, `liftStallTorqueNm`, `liftRotorInertiaKgM2` | servo tay nâng: tốc độ, mô-men kẹt, quán tính rotor phản ánh về trục boom (§4.6) |
| | `boomLengthCm`, `boomHalfSpanCm`, `boomMassG`, `boomElevationAtLift0Deg` | boom: dài (trục → khớp giá kẹp), hai tấm ở y = ±, khối lượng, góc ngẩng ở tay 0° (−40: chúc xuống; −90…0 để tay 0° là thấp nhất) |
| | `carriageMassG` | giá kẹp (luôn nằm ngang, hình bình hành) |
| | `clawSPer60Deg`, `clawStallTorqueNm`, `jawsMeetDeg` | servo kẹp; góc kẹp mà hai ngón chạm nhau (≤ 90) |
| | `fingerOpenDeg`, `fingerDegPerServoDeg`, `fingerHingeUCm`, `fingerHingeVCm`, `fingerLengthCm`, `fingerThicknessCm`, `jawHeightCm`, `fingerMassG` | ngón: góc mở ở kẹp 0°, độ quay mỗi độ servo, khớp ngón trong khung giá kẹp (u, ±v), dài, dày, cao (chiều cao ngàm), khối lượng |
| | `jawFriction`, `maxPayloadG` | hệ số bám chỉ dùng cho ngưỡng tuột (collider ngón ma sát 0, §4.6); khối lượng vật lớn nhất |
| | `clawServoCenterUCm`, `clawServoCenterVCm`, `clawServoCenterWCm`, `clawServoSizeUCm`, `clawServoSizeVCm`, `clawServoSizeWCm` | vỏ servo kẹp trên giá kẹp: tâm và kích thước hộp trong khung giá kẹp (PLACEHOLDER, `[-0.13, 0, 1.535]`, `1.22 × 2.28 × 2.27`). Asset 3D vẽ đúng hộp này (E6); từ task B5 nó là collider mà siêu âm nghe thấy. World chưa đọc |
| `ir-obstacle` | `rangeCm`, `minReflectance` | tầm nhìn; độ phản xạ nhỏ nhất thấy được (0…1] |
| `color-sensor` | `rangeCm`, `halfLightCm`, `whiteRPerMs`, `whiteGPerMs`, `whiteBPerMs`, `ambientPerMs` | tầm nhìn; khoảng cách ánh sáng còn một nửa; số đếm mỗi ms ở gain 1× trước vật trắng, và khi không có gì (world dùng ở task B3) |

Khung giá kẹp (cho `mount` của module `on: 'gripper'`): u phía trước, v bên trái, w hướng lên, gốc ở đầu boom (khớp giá kẹp), trùng
trục chassis khi giá kẹp nằm ngang. Hình học suy ra (`gripperJawsCm`, có test): tay hạ thì ngàm ở x 8,83–13,83 cm, z 1,09–2,29 cm,
đầu ngàm mở cách nhau 6,08 cm.

**Luật kit mới** (`loadKit`):
- `wrong-i2c-pin`: chân SDA/SCL của port I²C phải đúng chân `i2c` của board (`uno-r3`: SDA A4, SCL A5), không chỉ là chân có cap `i2c`.
- `i2c-address-conflict`: hai port có thiết bị cùng địa chỉ I²C (hai TCS34725 cùng 0x29). Các thiết bị của một bus dùng chung SDA/SCL,
  `checkKit` không coi đó là `pin-conflict`.
- `mount.on: 'gripper'` chỉ cho cảm biến hồng ngoại và cảm biến màu, và kit phải có tay gắp.
- Ngàm phải cao hơn sàn ở tay 0°; `massG` phải lớn hơn tay servo cộng phần động của tay gắp.

Board `uno-r3` thêm cap `i2c` cho A4/A5 và mục `"i2c": { "sda": "A4", "scl": "A5", "sclHz": 100000 }`; virtual UNO tính thời gian
từng pha bus từ đó (`virtual-uno.ts`).

## `rehearsal.kit.json` là kit DIỄN TẬP, không phải kit sản phẩm

`rehearsal-rover@0` (N18 R8a) là `ref-uno-rover@0` với mọi chân đổi chỗ, line `activeLow: true` và IN1/IN2 của motor trái đổi chỗ, để
chứng minh đổi kit chỉ là thay dữ liệu (`docs/kit-swap-rehearsal.md`). Nó ở catalog riêng `rehearsalKits`
(`src/core/hardware/rehearsal-kits.ts`), không ở `productionKits`, và app không nạp nó. Schema kit không có trường ghi chú, nên điều này chỉ
được ghi ở đây và trong code.

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
