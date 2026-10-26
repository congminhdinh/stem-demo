# N19 — Xe robot tay gắp 2 bậc (gắp, chở, phân loại, xếp chồng) trong lab 3D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (khuyến nghị) hoặc superpowers:executing-plans. Đây là **master plan**. Bước đầu của mỗi phase là viết sub-plan TDD chi tiết vào `stem-demo/docs/superpowers/plans/2026-10-2x-n19-<phase>.md`, giữ đúng tên, interface, test và acceptance đã chốt ở đây. Bước dùng checkbox (`- [ ]`).

**Goal:** Thêm cho lab robot 3D (N18) một xe UNO có **tay gắp 2 bậc**: kẹp mở/đóng và tay nâng/hạ, cùng cảm biến hồng ngoại giữa càng và cảm biến màu TCS34725. Thêm 4 bài học chấm tự động trong LMS: *Tìm và gắp*, *Giao hàng theo vạch*, *Phân loại theo màu*, *Xếp chồng*.

**Architecture:**
- Dữ liệu một nguồn như N18: *Block → IR op → role → port → driver (TS + C++) → VirtualUno → model → world*.
- Kit mới `ref-uno-gripper@0` tách khỏi `ref-uno-rover@0`, nên 6 bài cũ không đổi một bit (hash, `verify:attempt`).
- Có ba loại module mới: `gripper` (một port, hai servo), `ir-obstacle`, `color-sensor` (I²C, Wire thô).
- Cách gắp là **attach + hysteresis**: khi các điều kiện kẹp đủ thì tạo một fixed `ImpulseJoint` giữa giá kẹp và vật, theo mẫu grasp-fix của Gazebo. Không dùng ma sát thuần.
- LMS thêm module 4 "Tay gắp" với 4 bài.

**Tech Stack:** giữ nguyên N18:
- TS 6, React 19, Vite 8, Vitest 4, Blockly 13, Zod 4;
- three 0.186.1 + R3F 9.8.1, Rapier deterministic 0.21.0;
- avr8js 0.21.1 (test), arduino-cli 1.5.1 (dev), Blender 5.2.3 (asset);
- STEMLearning .NET 10 và Next.js.

**Không thêm dependency mới.**

**Spec:**
- Yêu cầu của chủ dự án ngày 2026-10-26: "có gắp đồ chưa, kiểu xe gắp đồ" và "lên plan… nghiên cứu các ứng dụng khác và video". Các lựa chọn đã chốt:
  - tay gắp **2 bậc**;
  - **cả 4 bài**;
  - **có cảm biến hồng ngoại giữa càng**.
- Nền: plan N18 `stem-demo/docs/robot-3d-implementation-plan.md` (D-R1…D-R12, hợp đồng §4).
- Bước G0.0 chép spec và plan này vào `stem-demo/docs/n19-gripper-direction.md` và `stem-demo/docs/n19-gripper-plan.md`.

---

## 0. Context

### Vì sao làm

Lab robot N18 (M04) đã xong: 6 bài cộng sân tập, tất định trên 4 engine, chấm và lưu vào LMS. Robot hiện chỉ có servo **cờ** (bài 5). Nó chưa gắp được vật, dù vật lý đã có vật đẩy được và đã có goal `object-in-zone`.

Gắp, chở và phân loại vật là dạng bài phổ biến nhất ở các nơi sau:
- sân chơi ảo: VEX VR, CoderZ, GEARS, CS2N;
- cuộc thi cho lứa 11–15 tuổi: WRO RoboMission, Robocon ORC của OhStem, Robotacon WRO Việt Nam;
- kit UNO thật: Keyestudio KS0523, "Tay gắp 2 bậc" của OhStem, Hshop G1.

### Nghiên cứu (tóm tắt; nguồn ở Phụ lục A)

- **Ứng dụng khác:**
  - **VEX VR:**
    - Robot miễn phí dùng **nam châm điện**: khối `energize [boost|drop]`. Khi bật, đĩa nằm dưới nam châm được hút lên ngay; không mô phỏng ma sát.
    - Bài *Disk Mover*: 9 đĩa 3 màu đưa về vùng cùng màu, lời giải mẫu là "đi tới khi Down Eye thấy vật rồi boost".
    - Robot IQ trả phí có càng và tay nâng thật: `spin ClawMotor/LiftMotor to position`.
  - **CS2N:** bài *Advanced Automatic Pickup* bắt chương trình hạ tay và mở càng **trước** khi tiến tới. Bài *Cube Disposal* đưa khối về vùng màu trong 60 s.
  - **GEARS:** không có càng, chỉ có tay 1 trục và nam châm kéo bằng lực. Bài *Fire Rescue*: tâm khối phải nằm trong vùng và khối phải chạm sàn; sai màu được 0 điểm.
  - **OhStem:** không thấy có trình mô phỏng gắp. Phần cứng gồm "Tay gắp 2 bậc" (2×MG90S, mở 0°, đóng 60–80°, nâng 0–90°) và sa bàn *Robot cơ bản*: 5 khối xốp, mỗi khối giao được 25 điểm, nhiệm vụ dò line + gắp.
- **Mô phỏng gắp:** gắp bằng ma sát rất mong manh (vật trượt, ngàm xuyên vật, nhạy với tỉ lệ khối lượng). Chuẩn chung là **attach khi đủ điều kiện + hysteresis**, như Gazebo grasp_fix và Isaac Surface Gripper. Rapier có `JointData.fixed` và `createImpulseJoint`/`removeImpulseJoint`, thêm bớt joint rẻ.
- **Kit thật:**
  - Ngàm mở khoảng 5,5–6 cm. Vật là khối xốp 2–6 cm, nặng tới khoảng 60 g.
  - Code dùng `Servo.h`, `write(angle)`.
  - Lỗi hay gặp: sụt áp, kẹp quá chặt, servo rung khi giữ vật, đặt lệch, xe lật.
- **Chấm điểm thi đấu (WRO):** vật nằm gọn trong vùng và đứng thẳng được trọn điểm; nằm một phần hoặc đổ được ít hơn. Có thưởng khi không xê dịch vật cố định. Thời gian khoảng 120 s.

### Hiện trạng code liên quan (đã khảo sát)

- **Kit:**
  - `kit.ts`: `moduleKinds` và `driverIds`, chỉ có role `servo1`.
  - Kit được ghi cứng ở `robot-keys.ts:29`, `scenario-schema.ts:206`, `verify-attempt.ts:125`, `GltfRobot.tsx:20`.
  - Chân trống trên rover: **A3, A4, A5**.
- **Đường đi của servo:** `ybc-ir` op `servo.set` → `uno.run.ts:80` → `binding.ts:100` → `drivers/servo-lib.ts` → `virtual-uno.ts:409` → `robot-modules.ts` → `servo-arm.ts`, là một revolute ImpulseJoint với motor vận tốc.
- **Vật thể:**
  - Arena `objects` là vật động: `build-arena.ts:118`, có trong snapshot.
  - Chưa bài nào dùng vật, và vật chưa có jitter theo biến thể.
  - Trong `src` chỉ có duy nhất một joint (khớp servo).
- **Chống lật:** ADR 0001 §9 cấm mọi phần nhô ra ngoài thân, vì cần servo nhô ra từng làm xe chổng đầu 15,85°. `ROBOT_FOOTPRINT_RADIUS_CM = 11`.
- **LMS:** thêm kịch bản chỉ là **dữ liệu** cộng các pin test. Thứ tự key phải giống nhau ở manifest, `LAB_TEMPLATES.robot`, `DefaultRobotScenarios`, appsettings và seed. Seed bỏ qua khóa đã xuất bản.

## 1. Phạm vi

| Trong N19 | Ngoài N19 |
|---|---|
| Kit `ref-uno-gripper@0`; module `gripper` (2 servo), `ir-obstacle`, `color-sensor` (TCS34725 qua Wire) | Nam châm điện, hút chân không, tay robot nhiều bậc, robot builder |
| Hỗ trợ nhiều kit (theo từng key) | Camera AI, nhiều robot, sửa C++ dạng text |
| 5 hàng hợp đồng U-35…U-39, kèm parity avr8js cả I²C | L3 trên bo thật và upload (M06); hiệu chỉnh theo kit nhà cung cấp (VG) |
| Vật lý tay nâng, ngàm, gắp/thả/tuột; cảm biến IR và màu | Biến thể "tay xuất phát nâng/hạ": không trung thực (xem D-G9) |
| 4 goal mới; biến thể vị trí và màu vật; 4 bài + lời giải + phản lời giải | Sân tập riêng cho tay gắp, khối hàm, penalty |
| UI: chip "Đang giữ", Inspector, phím teleop, bản đồ 2D, overlay, tag, thông báo | Âm thanh |
| Asset Blender: tay gắp, cảm biến, khối xốp, kiện hàng, bệ, kệ kho | |
| LMS: module 4 (bài 8–11), thumbnail, catalog, seed, runbook cập nhật DB live | |

**Ước lượng:** khoảng **310 giờ** cộng vòng review/fix (khoảng 10 %), tức khoảng **340 giờ**. Con số này nằm ngoài 720 giờ của M04. Plan N18 §8 VG tính mỗi loại module mới 16–24 giờ; ở đây có 3 loại cộng 4 bài, asset và LMS.

Với 2–3 người làm song song, mất khoảng 5–6 tuần lịch.

## 2. Quyết định kiến trúc

| # | Quyết định | Lý do |
|---|---|---|
| D-G1 | **Kit mới `ref-uno-gripper@0`**, không sửa `ref-uno-rover@0`. `robot-keys.ts` có `robotKits = { 'ref-uno-rover':'0', 'ref-uno-gripper':'0' }` + `robotKitVersionOf(id)`; `RobotTemplate.kit` gán theo từng key. Các chỗ ghi cứng kit ở `scenario-schema.ts:206`, `verify-attempt.ts:125`, `RobotLab.tsx:177` đọc kit theo scenario (A1: `robotTemplates[key].kit`, `scenarioKitRef`). `GltfRobot.tsx:20` **không** đọc theo scenario: đó là kit tham chiếu mà các part GLB được dựng theo (hash của `ref-uno-rover.kit.json` nằm trong manifest asset), nên giữ `referenceKitRef`; kit gripper có part riêng thì thêm tham chiếu riêng ở task asset | File kit rover giữ nguyên byte, nên hash asset, 6 bài cũ và các attempt đã lưu không đổi |
| D-G2 | **Một module `gripper` trên một port, hai chân servo** (`CLAW=D9`, `LIFT=D10`, driver `gripper-servo2`, claims `servo`). IR và cảm biến màu là module riêng gắn lên giá kẹp (`mount.on: 'gripper'`) | Càng gắn trên tay nâng nên là một cơ cấu chung. Không đụng `servo-arm.ts` và goal `servo-angle`. Servo.h vốn đã tắt PWM D9/D10 nên không mất chân PWM |
| D-G3 | Góc 0…90 cho cả kẹp và tay (driver kẹp kẹp giá trị vào miền này). Kẹp: **0° mở**, **80° đóng** (`jawsMeetDeg` là giới hạn khớp ngón). Tay: **0° hạ**, **90° nâng**. `setup()` ghi kẹp 0°, tay 90° | Khớp với Tay gắp 2 bậc của OhStem và kit Keyestudio. Quá 90° chỉ làm servo kẹt |
| D-G4 | **Không có tham số tốc độ quét chậm.** World đã giới hạn tốc độ servo 60° mỗi 0,1 s như MG90S thật. Học sinh muốn quét chậm thì tự viết vòng lặp + `wait` | Một op chặn sẽ tính thời gian một cục mà world không thấy các góc giữa chừng. Ghi góc tức thì là trung thực |
| D-G5 | **Gắp = attach + hysteresis** (`world/robot/grasp.ts`). Điều kiện, ngưỡng và trường hợp đặc biệt ở §4.4. Dự phòng: biến collider ngón thành sensor, giữ nguyên máy trạng thái | Ổn định và tất định. Đã kiểm chứng trong ngành (Gazebo, Isaac) |
| D-G6 | **Tay nâng kiểu hình bình hành**: giá kẹp luôn nằm ngang nhờ motor giữ khớp tương đối | Có vậy bài xếp chồng mới đặt khối đứng thẳng được. Phải hỏi nhà cung cấp loại tay gắp của họ (§10) |
| D-G7 | **Cảm biến màu đọc bằng Wire thô, không dùng Adafruit.** Thanh ghi TCS3472 (ATIME `0xEB` 50,4 ms, gain 4×). `Wire.setWireTimeout(3000,true)`. Phân loại màu bằng **một bảng số nguyên** `COLOR_RULES` dùng chung cho TS và C++ | Wire có sẵn trong core (LGPL-2.1, chỉ là tool/core), RAM 216 B (đo ở G0.2, CC-06), không chặn chờ. Một chuỗi thanh ghi dùng chung cho sim, C++ và parity |
| D-G8 | Chống lật **theo từng kit**: `chassis.footprintRadiusCm` (gripper 16, rover giữ 11), quét toàn bộ góc tay, có test phanh và đâm tường. Quy tắc "không nhô ra ngoài thân" của ADR 0001 §9 được miễn cho kit gripper, ghi trong một addendum, đổi lại bằng các test có giới hạn | Tay gắp phía trước buộc phải nhô ra. Ngân sách khối tâm ở §4.4 |
| D-G9 | **Bỏ biến thể "tay xuất phát nâng/hạ"** (ý tưởng từ CS2N). Lượt kiểm tra thay đổi vị trí xuất phát và vị trí, màu của vật | `setup()` thật luôn ghi góc đầu. Một servo chưa có xung giữ được tay chống trọng lực hay không là UNKNOWN, không được đoán. Thói quen "hạ, mở trước khi tiến" vẫn được chấm tự nhiên, vì không hạ tay thì không gắp được |
| D-G10 | `ROBOT_ENGINE_VERSION` **giữ 1**: không kết quả cũ nào thay đổi. Field mới đều tùy chọn và không có default; code chỉ chạy khi kit có module tương ứng; `snapshotText` bỏ qua field undefined. Có test chặn cho việc này | Tránh làm `verify:attempt` báo các attempt thí điểm đã lưu là không kiểm được |
| D-G11 | Bốn bài đều dùng **uno-basic**. `color.raw` chỉ có ở Advanced. `kitBlockPacks(profile, kit)` ẩn khối của role mà kit không có (sân tập rover không đổi) | Pin test LMS (`ADVANCED_ROBOT_SCENARIOS` rỗng) vẫn đúng |
| D-G12 | LMS: **module 4 "Tay gắp"** (bài 8–11) nối sau module 3; sân tập vẫn là bài 7. Thứ tự key trong manifest: 6 key cũ → 4 key `rb-grip-*` → `rb-sandbox`. DB đang chạy cập nhật bằng **gỡ xuất bản + seed lại** | Seed chỉ nối thêm. Nội dung đã test được ghi chính xác, tránh gõ tay |

## 3. Global Constraints

Toàn bộ §5 của plan N18 vẫn áp dụng: B1, Rapier chỉ ở `src/core/world/**`, chuỗi UI ở `messages.ts` vi+en, không logo, không GPL, commit không có `Co-Authored-By`, mỗi task push ff-only lên `origin master`. Ngoài ra:
- **Đồ họa và tính năng hiện có giữ nguyên.** Pixel-diff các bài rover phải trùng. Asset mới phải đẹp theo tiêu chuẩn R4.7 (PBR, ánh sáng studio, bóng mềm) và được một agent độc lập soát hình.
- **Ngân sách hiệu năng không đổi**, đo trên profile máy trường. Tăng GLB tối đa: kit +120 KB (high) / +70 KB (low), props +80 / +50 KB. Tay gắp tối đa 6 k tam giác ở mức high, 2,5 k ở mức low.
- **Đáp ứng LMS:** tối đa 20 goal mỗi kịch bản, id ≤ 50 ký tự `[a-z0-9-]`, maxScore = 100. Nhãn goal không chứa ký tự Cc/Cf.
- **Key `rb-grip-*`** không bao giờ đổi tên hay tái dùng. Đổi hành vi thì tăng `version`.
- **RAM của sketch** ≤ 75 %. Thư viện khai báo kèm phiên bản và license (Servo 1.3.0, Wire 1.0 của arduino:avr@1.8.8).
- **Kit gripper là dữ liệu PLACEHOLDER**, chờ kit thật (VG).

## 4. Hợp đồng chính (tên chốt)

### 4.1 Kit `src/core/hardware/kits/ref-uno-gripper.kit.json`

| Port | Driver | Chân | Ghi chú |
|---|---|---|---|
| M1 / M2 | `hbridge-en-in1-in2` | như rover (D5,D7,D8 / D6,D4,D2) | |
| US1 | `hcsr04-pulsein` | TRIG D12, ECHO D11 | mount `[7.5,0,5.0]` |
| LN1–3 | `line-digital` | A0, A1, A2 | |
| LED1, BTN1 | như rover | D13, D3 | bỏ `servo1` (cờ) và `buzzer` |
| GR1 | `gripper-servo2` | CLAW **D9**, LIFT **D10** | mount `[4.5,0,4.9]` |
| IR1 | `ir-digital` (`activeLow`) | **A3** | `on:'gripper'` `[0.3,0.6,0]` |
| CS1 | `tcs34725-wire` | SDA **A4**, SCL **A5**, addr `0x29` | `on:'gripper'` `[0.3,-0.6,0]` |

- **Board:** A4/A5 có thêm cap `i2c`; thêm `"i2c":{sda:"A4",scl:"A5",sclHz:100000}`.
- **Luật kit:** port I²C phải nối đúng chân SDA/SCL của board; không trùng địa chỉ.
- **`checkKit`** sạch: không trùng chân, không PWM trên T1, không dùng D0/D1.
- **Chassis:** `massG 460`, `comCm [-1.2,0,3.6]`, `footprintRadiusCm 16`. Caster và trục giữ như rover.

**Thông số (placeholder):**
- `GripperSpec`:
  - `liftSPer60Deg 0.1`, `liftStallTorqueNm 0.18`, `boomLengthCm 5`, `boomHalfSpanCm 6.6`, `boomMassG 6`, `carriageMassG 22`;
  - `clawSPer60Deg 0.1`, `clawStallTorqueNm 0.18`, `jawsMeetDeg 80`, `fingerOpenDeg 12`, `fingerDegPerServoDeg 0.445`, `fingerLengthCm 5`, `fingerMassG 3`;
  - `jawFriction 0.6`, `maxPayloadG 50`.
- Hình học suy ra:
  - tay hạ: ngàm ở x 8,83–13,83 cm, z 1,09–2,29 cm, đầu ngàm mở **6,08 cm**;
  - tầm với xa nhất 15,3 cm, tại tay 40°.
- `IrObstacleSpec {rangeCm 2.0, minReflectance 0.15}`.
- `ColorSensorSpec {rangeCm 4, halfLightCm 1.5, whiteR/G/BPerMs 48/44/36, ambientPerMs 0.2}`.

### 4.2 Module, role, driver (`kit.ts`)

- `moduleKinds` thêm `gripper`, `ir-obstacle`, `color-sensor`.
- `driverIds` thêm `gripper-servo2`, `ir-digital`, `tcs34725-wire`.
- `robotRoles` thêm `gripper`, `irClaw`, `color1`.
- `DriverOp.claims?` khai báo theo từng op; `uno-uses.ts` đọc giá trị này thay cho tên op.
- `SetupStep`: `servoAttach.object?: 'Claw'|'Lift'` và `{kind:'helper', name:'colorBegin'}`.
- `RobotMechanics` thêm `gripper | null`, `irSensors`, `colorSensors`.
- `ModuleIO.read(role, op, args?)`.

### 4.3 IR op, khối, C++

| Hàng | IR op | Khối (Basic, trừ khi ghi khác) | C++ |
|---|---|---|---|
| U-35 | `gripper.claw(angle 0..90)` | `uno_gripper_claw` [mở▾/đóng▾] → 0/80; `uno_gripper_claw_angle` (n)° | `gripperSet(gripperClaw, a);` |
| U-36 | `gripper.lift(angle 0..90)` | `uno_gripper_lift` [nâng▾/hạ▾] → 90/0; `uno_gripper_lift_angle` (n)° | `gripperSet(gripperLift, a);` |
| U-37 | đọc `ir.detect(irClaw)` → bool | `uno_ir_detect` "có vật giữa càng?" | `(digitalRead(IR_CLAW_PIN)==LOW)` |
| U-38 | đọc `color.is(color1, name)` → bool | `uno_color_is` "màu vật là [đỏ▾]?" | `colorIs(n)` |
| U-39 | đọc `color.raw(color1, r/g/b/c)` → 0..21504 | `uno_color_raw` (**Advanced**) | `colorRaw(k)` |

- **Chỉ số màu:** 0 đỏ, 1 xanh lá, 2 xanh dương, 3 vàng, 4 trắng, 5 đen, 6 không rõ.
- **`COLOR_RULES`:** phần nghìn `r*1000/(r+g+b)`, khớp luật đầu tiên. Các luật theo thứ tự:
  1. C < 300 → không rõ;
  2. đỏ: r‰ ≥ 500 và g‰ < 300;
  3. xanh lá: g‰ ≥ 420 và r‰ < 330;
  4. xanh dương: b‰ ≥ 420 và r‰ < 300;
  5. trắng: C ≥ 12000, b‰ ≥ 230 và r‰ < 420;
  6. vàng: r‰ ≥ 380, g‰ ≥ 330 và b‰ < 230;
  7. đen: C < 4000;
  8. còn lại → không rõ.
- **Helper C++** được sinh từ chính bảng này; có test so hai bản.
- **Không có cảm biến hoặc bị NACK** → giá trị 0 → không rõ.

### 4.4 World (`world/robot/gripper.ts`, `world/robot/grasp.ts`)

**Lắp ráp:**
- Boom: revolute theo trục y tại mount.
- Giá kẹp: revolute ở đầu boom, motor giữ cho nằm ngang (`LINK_HOLD_NM = 1`).
- Hai ngón đối xứng: khớp ở (0.5, ±2.2), góc β = 12 − 0.445·θ, giới hạn [−23.6°, 12°].
- Mỗi thân bộ gắp có `setAdditionalPgsIterations(4)` và không ngủ.
- Nhóm va chạm `GRIPPER_GROUP` (0x0004): các phần của bộ gắp không va nhau.

**Máy trạng thái gắp** (chạy sau mỗi `stepWorld`, duyệt vật theo id, giữ tối đa 1 vật):
- **Attach** khi đủ cả năm điều kiện:
  - lệnh kẹp ≥ góc hiện tại − 0.5°;
  - tâm vật trong khung giá kẹp có u ∈ [1.0, 5.5], |v| ≤ 1.5, |w| ≤ nửa chiều cao vật;
  - cả hai ngón cách vật ≤ `CONTACT_GAP_M`;
  - khe ngàm ≤ bề rộng vật + 0,3 cm;
  - `massG ≤ maxPayloadG`.
- **Khi attach:** ghi góc tiếp xúc θc, đóng băng mục tiêu của ngón, tạo `JointData.fixed` giữa giá kẹp và vật (tắt va chạm giữa cặp này), đổi solver group của vật.
- **Thả:** khi lệnh kẹp ≤ θc − 6°.
- **Tuột:** khi tổng xung lực từ các collider không thuộc bộ gắp chia `dt` vượt `2·jawFriction·lực kẹp` (khoảng 9,6 N). Ấn khối xuống sàn với lực tối đa của tay (3,6 N) thì không tuột; đâm tường ở 0,4 m/s thì tuột.
- `placeAt` thả vật trước khi đặt lại xe.
- Xe dừng hoặc rơi khỏi sa bàn thì vẫn giữ vật, vì servo vẫn nhận xung.
- **Vật đang giữ coi như một phần của xe:** va chạm của nó với tường hoặc vật khác tính là va chạm của xe (`avoid-contact`, `endOnContact`).

**Snapshot và frame:**
- `robot.gripper? {clawDeg, liftDeg, heldId}`.
- `sensors[]` thêm `{kind:'ir-obstacle', detected, hitId}` và `{kind:'color-sensor', hitId, distanceCm}`.
- `GoalFrame.gripper?`.
- Mỗi object có thêm `zCm`, `tiltDeg` (dmath `atan2`; khối nằm trên mặt nào cũng tính là thẳng), `held`, `restingOn[]`.

**Cảm biến:**
- **IR:** một tia dài 2 cm. Thấy vật có độ phản xạ ≥ 0,15, nên khối đen không thấy (đúng với IR thật). Không có vật thì không bao giờ thấy ngón của chính nó.
- **Màu:**
  - Một tia dài 4 cm, nhìn về phía trước giá kẹp; không nhìn xuống thảm.
  - Bức xạ chỉ tính bằng + × / floor.
  - Model thanh ghi `hardware/devices/tcs34725.ts`: ENABLE, ATIME, CONTROL, ID `0x44`, STATUS, CRGB. Mỗi chu kỳ có RGBC Init 2,4 ms rồi mới tích phân (datasheet TAOS135 Figure 9), nên với ATIME `0xEB` cửa sổ 50,4 ms kết thúc mỗi 52,8 ms; cửa sổ đầu xong 2,4 + 50,4 ms sau AEN (G0.2, EMU-19).
  - Cửa sổ tích phân lấy trung bình lịch sử bức xạ theo tick, nên kết quả không phụ thuộc lúc chương trình đọc.
  - Nhiễu tắt mặc định, nếu bật thì dùng luồng seed riêng.
- **Siêu âm** (riêng kit gripper): bỏ qua collider thân xe nhưng **thấy ngàm**, như HC-SR04 thật.
  - Khối 4 cm nằm giữa ngàm đọc khoảng 3,8 cm.
  - Lúc tay hạ, tia nón đi cách đầu ngàm 0,9 cm.

**Màu là dữ liệu:** `color` tùy chọn cho objects, boxes, cylinders, walls; `arena/body-colors.ts` là nguồn chung cho renderer và cảm biến. Bảng màu: `#d32f2f` đỏ, `#388e3c` xanh lá, `#1976d2` xanh dương, `#fbc02d` vàng.

**Ngân sách lật** (tải 50 g):
- tay nâng: khối tâm tại x 0,8, z 4,5;
- ngưỡng lật về phía trước 1,04 g, so với lực phanh tối đa do bánh 0,63 g, tức dư ×1,65.

### 4.5 Scenario, goal, biến thể

- **Schema:**
  - `zones[].name?` (pickup | drop | warehouse | red | green | blue | stack);
  - `objects[].noun?` (cube | parcel | base);
  - `variants.objectJitter?: [{objects, dxCm, dyCm}]`;
  - `variants.objectColors?: {id: color[count]}` (phần tử 0 bằng màu trong arena).
  - Số ngẫu nhiên mới rút **sau** các số hiện có, nên biến thể của 6 bài cũ không đổi.
  - Bán kính chân đế lấy theo kit.
- **Goal mới** (`src/core/scenario/goals/`):

| Kind | Spec | Luật |
|---|---|---|
| `object-held` | `{object, holdS=0.5, minLiftCm=0}` | Qua (và giữ nguyên trạng thái qua) khi giữ vật liên tục `holdS`, đáy vật cao hơn vị trí nghỉ ≥ `minLiftCm` |
| `object-placed` | `{object, zone \| zoneByColor, fully=true, maxTiltDeg=15, restS=0.5, carried=true, maxSlideCm=3, minCarryLiftCm=1, minCarryCm=5}` | Xét ở cuối lượt: không còn bị giữ, nằm gọn trong vùng (hoặc vùng cùng màu của lượt đó), thẳng, nằm yên, không chạm xe, đã được gắp **và nâng** ≥ `minCarryLiftCm` so với chỗ nằm lúc gắp, **chở** ≥ `minCarryCm` trên sàn trong lúc nâng (từ chỗ đầu tiên tới chỗ cuối cùng vật ở độ cao đó) rồi thả (`carried`), và trượt ≤ 3 cm từ chỗ thả. Lần gắp không đủ hai điều kiện (kẹp tại chỗ, nâng tại chỗ) coi như không có: lần đẩy trước đó vẫn tính là đẩy (D2 fix round 1–2, I1, N1) |
| `object-on-object` | `{top, bottom, maxOffsetCm, maxTiltDeg, restS, carried=true, minCarryLiftCm=1, minCarryCm=5}` | z của khối trên = mặt trên khối dưới + nửa chiều cao (sai số ±0,8), lệch ngang ≤ `maxOffsetCm`, thẳng, yên, không bị giữ; khối trên được chở như `object-placed` (`carried`, trượt ≤ 3 cm) |
| `object-unmoved` | `{object, maxMoveCm, maxTiltDeg=20}` | Guard: trượt ngay khi vật bị xê dịch quá `maxMoveCm` hoặc bị đổ |

- **Thứ tự lý do của `object-placed`:** `out-of-arena` → `object-still-held` → `object-pushed` / `object-never-held` → `object-wrong-zone` → `object-dropped` → `object-moved-out` → `object-partly-in-zone` → `object-tipped` → `object-not-at-rest`.
- **Các lý do khác:** `object-not-reached`, `object-not-grasped`, `object-not-lifted`, `object-not-stacked`, `stack-off-centre`, `object-moved`.
- **Câu báo trên thẻ kết quả:** "Xe làm rơi kiện hàng 2 lúc 8,2 s ở lượt 2", "Khối đỏ nằm ở vùng xanh dương ở lượt 3", "Xe vẫn còn giữ khối khi hết giờ", "Khối bị đẩy chứ không được gắp"…
- `GoalResult.detail?: {zoneId}`.
- **Đẩy vật vào vùng mà không gắp = 0 điểm** ở cả 4 bài. Bài đẩy vật thì dùng `object-in-zone` với kit rover.

### 4.6 Sửa sau Gate G0 (ADR 0004 §5 và §7; khi mâu thuẫn với §4.1/§4.4 thì mục này thắng)

- **Khung tay nâng:**
  - Hình bình hành = **khoá góc chassis↔giá kẹp** (`JointData.generic`, khoá `AngZ`), không dùng motor giữ `LINK_HOLD_NM`. Khớp boom↔giá kẹp là revolute không motor.
  - Luật servo tay nâng **có hãm**: tốc độ = min(60°/`liftSPer60Deg`, |e|/dt, √(2·a·|e|)), a = 139,4 rad/s².
  - Thêm `GripperSpec.liftRotorInertiaKgM2 = 5e-5` (PLACEHOLDER).
- **Solver và ngón:**
  - Mỗi body bộ gắp có +8 PGS và +4 solver iteration.
  - Ngón là collider thật với **ma sát 0**; `jawFriction` chỉ dùng cho ngưỡng tuột. Không dùng ngón-sensor: lún 7,7–19,3 mm và đi xuyên tường.
  - Solver group của mọi collider bộ gắp chỉ là thành viên `GRIPPER_GROUP`.
- **Máy trạng thái gắp:**
  - `CONTACT_GAP_M = 2 mm`; "chạm" nghĩa là `contactImpulse > 0` hoặc khoảng cách ≤ 0,5 mm.
  - Lực kẹp 8,09 N; ngưỡng tuột 9,71 N.
  - Thêm bốn luật:
    1. chốt sau khi tuột: không attach lại tới khi lệnh kẹp ≤ θc − 6°;
    2. càng chỉ dừng khi vật bị kẹp ngang (khe ≤ bề rộng + 0,05 cm), mỗi ngón dừng ở góc chạm;
    3. ngón bám mặt vật đang giữ (đòn bẩy kẹp trong 1–5,5 cm);
    4. solver group như trên.
- **Khối lượng:** `massG 460` là cả xe; body chassis = 426 g.
- **Chống lật:**
  - Càng đâm tường mà motor vẫn đẩy thì xe chổng đầu 15,7–17,2°. Đây là vật lý thật, giống tay servo ở ADR 0001 §9. Vì vậy **mọi kịch bản kit gripper `endOnContact` với tường nằm trên đường đi của càng**.
  - Teleop đẩy tường vẫn chổng đầu như xe thật; chỉ cần không có NaN và xe trở lại đứng trên bánh.
  - Hạ tay lên vật hay sàn thì đầu xe nhấc (3,85°): lực ấn bị giới hạn bởi trọng lượng xe.
- **Hiệu năng:** chi phí khoảng 0,19–0,28 ms/tick (gấp khoảng 4 lần rover). E9 đo trên profile máy trường; nếu vượt ngân sách thì bỏ +4 solver iteration (giá kẹp lệch 0,91° khi giữ 50 g).

### 4.7 Ghi lại khi làm A2/A3 (thắng §4.1–§4.3 khi mâu thuẫn)

- **`GripperSpec` thêm 5 khoá hình học** (PLACEHOLDER, ADR 0004 §2 đã suy ra): `boomElevationAtLift0Deg -40` (−90…0, nên tay 0° là thấp nhất), `fingerHingeUCm 0.5`, `fingerHingeVCm 2.2`, `fingerThicknessCm 0.4`, `jawHeightCm 1.2`. Không có chúng thì không kiểm được "ngàm cao hơn sàn ở tay 0°" và không ra được số §4.1 (ngàm x 8,83–13,83, z 1,09–2,29, đầu ngàm mở 6,08 cm; `gripperJawsCm`, có test).
- **`costsUs` mới** (thêm khoá, giá trị cũ không đổi; cũng nối vào `arduinoCalls` và `costsUs` của contract, A5 thêm EMU-20 vào ledger và `costsEvidence`): `gripperSet 51.625`, `colorWrite 334` / `colorWriteNack 144.9375`, `colorBegin 1350.5625` / `colorBeginNack 589.4375` (đã trừ hai delay như simulator charge), `colorFetch 1158.5` / `colorFetchNack 146.0625`, `colorClassify 147.25` (lâu nhất), `colorClassifyZero 12.5625` (tổng 0: không chia, nên `colorIs` lúc NACK là 158,6 chứ không 293 µs), `wirePhase 4.9375`, và chỗ bus bắt đầu trong helper: `colorWriteLead 11.625`, `colorFetchLead 9.1875`, `colorFetchGap 10.5625` (13 khoá, cùng bằng chứng EMU-20).
- **Bus I²C có thời gian ở virtual UNO:** mỗi pha = `wirePhase` (dịch vụ của Wire) + số chu kỳ SCL ở `i2c.sclHz` (START/STOP 1, byte 9). Thiết bị bus-level (`I2cDevice`, model TCS34725) được gọi ở thời điểm của từng sự kiện, như adapter TWI phía board. Driver tính phần lệnh của helper quanh bus theo timeline đo (`spikes/avr8js/run-gripper-timeline.ts` → `out/gripper-timeline.json`; khoá `colorWriteLead 11.625`, `colorFetchLead 9.1875`, `colorFetchGap 10.5625` của `costsUs`): trong `colorFetch` mọi sự kiện lệch board ≤ 1 µs, trong `colorBegin` 2,125…4,9375 µs sớm hơn (test ghi đúng từng số); tổng thời gian đúng số đo. Thiết bị ACK địa chỉ rồi NACK một byte thì chưa đo: bus tính đúng phần đã gửi, phần lệnh sau đó lấy của NACK địa chỉ.
- **Bus đi trước world tối đa bao xa (hợp đồng cho B3):** op module bắt đầu trong tick của nó (`atHardware`), và sự kiện cuối của một lần đọc màu (STOP) đến 1123,8125 µs sau khi op bắt đầu (`colorReadLastEventUs`), ít hơn một tick. Vậy model không bao giờ hỏi ánh sáng quá `world.t + dt + 1124 µs`: lịch sử bức xạ của B3/B4 phải phủ tới đó. `colorBegin`: mọi sự kiện bus trong 4346,5625 µs đầu của setup() (tick 0); setup() kết thúc ở 58367,6875 µs nên câu lệnh đầu tiên chạy ở tick 7. Có test ở mức driver; khi A4 có IR op cho `color.is`, thêm test session như `pulseIn loop never leads world by more than dt` (mọi lời gọi thiết bị trong `[world.t, world.t + dt + 1123,8125 µs)`).
- **Luật kit là issue của `loadKit`** có mã (`DataIssue.code`): `wrong-i2c-pin`, `i2c-address-conflict`. Địa chỉ I²C là của driver (`driverPortSpecs[…].i2cAddress`, TCS34725 cố định 0x29), không phải param của kit. Các thiết bị một bus dùng chung SDA/SCL nên `checkKit` không báo `pin-conflict` cho chúng.
- **`ir-digital`:** param `activeLow` mặc định `true` (module IR thường kéo LOW khi thấy vật); kit vẫn ghi rõ.

## 5. Review Focus

1. **Vật đang giữ đâm tường hoặc vật khác, hoặc bị ép xuống sàn.** Tuột đúng ngưỡng, va chạm tính cho xe, không có NaN, xe không lật. *Test (B3):* `held cube hitting a wall at 0.4 m/s breaks the grasp and counts as robot contact`; `pressing a held cube on the floor at lift stall keeps the grasp`.
2. **Dừng, Đặt lại, Xem lại hoặc teleop giữa lúc đang gắp.** Không còn joint mồ côi; replay cho cùng hash; kết quả giống nhau ở 1×, 4× và Nhanh. *Test (B4, D5):* `stop while holding leaves no impulse joint after dispose`; `grip scenario same score/passed/hash for 1×, 4× and headless`.
3. **Bài rover cũ đổi dù rất nhỏ.** *Test (A1, B6):* `rover world creates the same bodies, colliders and joints as before` cùng golden hash không đổi; `verify:attempt` khớp các attempt thí điểm đã lưu.
4. **Gian lận:** đẩy vật, giữ vật tới hết giờ, vật còn trượt hoặc bị xe ép lúc hết giờ, nằm vắt ngang hai vùng. *Test (D2, D4):* mỗi exploit có điểm trần (§6), và `pushed cube scores 0 on place goals`.
5. **Máy trường yếu hoặc không có WebGL.** Joint và tia cảm biến thêm vào vẫn trong ngân sách; bản đồ 2D vẫn vẽ tay gắp và vật đang giữ. *Test (E9):* `bench:robot3d` cho bài rb-grip-deliver và rb-grip-stack trên profile máy trường, ngân sách giữ nguyên; e2e `webgl off → 2D shows held object and jaws`.

## 6. Bốn bài học (chung: khối xốp 4 cm nặng 15 g; vùng nhạt, luma > 0,75; 3 lượt, score = lượt thấp nhất)

| Key / bài | Sa bàn | Biến thể | Thời gian | Goal (điểm) | Phải trượt |
|---|---|---|---|---|---|
| `rb-grip-pick` **8. Tìm và gắp** | 170×90 cm. Khu lấy hàng x70–100; "Vùng thả" x108–148; khối vàng ở (85,45) | Khối dx ±10 (pin: một lượt ≥ +7, một lượt ≤ −7); xuất phát ±1 cm, ±2° | 30 s | `grab-cube` object-held {minLift 2} **40** · `place-cube` object-placed {drop} **45** · `no-crash` **15** | đi mù theo thời gian; không bao giờ hạ tay (≤ 15); đẩy vào (≤ 15); giữ trong vùng (≤ 55) |
| `rb-grip-deliver` **9. Giao hàng theo vạch** | 180×150 cm. Vạch dọc x=120; 3 điểm lấy hàng; "Kho" x62–100; kệ kho tag `kho-wall`; 3 kiện hàng | Kiện hàng dy ±5; xuất phát ±6 cm dọc vạch, ±5° (pin ≥ 4°) | 90 s | `deliver-1..3` object-placed {kho} **25 ×3** · `no-crash` kệ kho **15** · thưởng thời gian **10** | đi mù; đẩy lên phía bắc (≤ 15); quét bằng ngàm mở (≤ 15) |
| `rb-grip-sort` **10. Phân loại theo màu** | 170×150 cm. Vùng xuất phát xám; vùng đỏ ở bắc, xanh lá thẳng trước mặt, xanh dương ở nam | `objectColors.cube = [green, red, blue]`; **không jitter vị trí** (chỉ ±3°), để chương trình phải đọc màu | 30 s | `grab-cube` **25** · `sort-cube` object-placed {zoneByColor} **60** · `no-crash` **15** | luôn rẽ một hướng (≤ 40); chỉ kiểm màu đỏ (≤ 40) |
| `rb-grip-stack` **11. Xếp chồng** (nâng cao) | 200×80 cm. Vạch tới x=150 rồi hết; khối đỏ ở x≈95; bệ vàng 6×6×4 cm, 40 g | Xuất phát ±12 dọc (pin ±9), khối đỏ dx ±5 | 45 s | `grab-cube` {minLift 3} **20** · `stack-cube` object-on-object {lệch ≤ 1,5, nghiêng ≤ 10°} **55** · `base-still` object-unmoved **15** · thưởng **10** | đi mù; đặt cạnh bệ (≤ 35); giữ trên bệ không thả (≤ 35); hạ hết tay (≤ 20) |

- **Lời giải mẫu** (`robot-solutions.ts`), viết thành mã khối:
  - bài 8: hạ, mở → tiến khi siêu âm > 15 cm → tiến chậm tới khi IR thấy vật → dừng, đóng, nâng → chở → hạ, mở, lùi;
  - bài 9: `repeat 3` gồm dò line tới khi IR thấy vật → gắp → xoay trái 830 ms → tiến → thả → lùi → xoay phải tới khi gặp vạch;
  - bài 10: gắp → `if màu đỏ` rẽ trái / `else if xanh dương` rẽ phải / còn lại đi thẳng;
  - bài 11: dò line tới khi IR thấy vật → gắp → tay **55°** (ở 45° khối đẩy bệ 4,66 cm, ADR 0004 §4.2) → dò line tới cuối vạch → thả nhẹ.
- **Starter:** khối mũ `stem_on_start` cộng một khối gợi ý chưa nối.
- **Thời gian tham khảo** đo trên kit placeholder; đổi kit thì phải đo lại (VG).

## 7. Phase và task

Thứ tự: **G0 → A ∥ (D1–D3) → B → C ∥ E(asset) → D4–D8 → E(UX) → F → G**. Mỗi lúc chạy 2–3 implementer, mỗi người một worktree.

### G0 — Spike, gỡ rủi ro trước (18h) → Gate G0
- **G0.0 (1h):** đưa spec và plan vào repo. Thêm dòng N19 vào `docs/stem-demo-implementation-plan.md` §9.2.
- **G0.1 Spike gắp (8h)**, trong `spikes/n19-grasp/`:
  - Dựng tay nâng hình bình hành + ngón + fixed joint trên Rapier với `lengthUnit` hiện có.
  - Gắp, chở, thả khối 15 g và 50 g; phanh hết cỡ; đâm tường.
  - Đo: hash bằng nhau trên 4 runtime; giá kẹp nằm ngang trong 0,5°; ms/tick.
  - Thất bại thì dùng dự phòng ngón-sensor (D-G5).
- **G0.2 Spike I²C (9h):** `spikes/avr8js/sketches/gripper-forms` cùng `gripper-costs`.
  - Adapter `AVRTWI` có tính thời gian bus (TWBR=72, khoảng 90 µs/byte) gọi chung model TS của TCS34725.
  - Chốt bằng chứng EMU-19 (forms), EMU-20 (chi phí) và CC-06 (compile, kích thước).
  - Điền `costsUs` mới: `gripperSet`, `colorFetch`, `colorBegin`.
  - Thất bại thì U-38/U-39 để DEFERRED, bài 10 hoãn; tay gắp và IR vẫn ship.
- **Gate G0:**
  - gắp tất định trên 4 runtime, không lật, ≤ 0,5 ms/tick;
  - quyết định go/no-go cho I²C ghi vào ADR `docs/adr/0003-gripper.md`.

### A — Phần cứng ảo và chương trình (44h)
- **A1 Hỗ trợ nhiều kit (6h):** `robot-keys.ts`, `scenario-schema.ts:206`, `verify-attempt.ts`, `catalog.ts`, `variants.ts` (bán kính theo kit). *Test:* `rover hashes unchanged`; `grip key with rover kit is refused`; `kitFootprintRadiusCm(rover) = 11`.
- **A2 Kiểu và dữ liệu kit (8h):** `kit.ts`, `kit-schema.ts`, `kit-mechanics.ts`, `uno-r3.board.json`, `ref-uno-gripper.kit.json`, `kits/README.md`. *Test:* `ref-uno-gripper has no diagnostics`; `i2c port on non-SDA pin → wrong-i2c-pin`; `two devices at 0x29 → i2c-address-conflict`; `on:gripper only for ir/color`.
  - Khi kit gripper đã đăng ký, đổi tham số `radiusCm` của `variantOffsets` (`variants.ts`, A1 để mặc định 11 cm) thành **bắt buộc**, để một chỗ gọi quên bán kính của kit là lỗi biên dịch; sửa các chỗ gọi (`world.ts`, `verify-attempt.ts` đã dùng `variantSeed`, test) và chạy lại guard `tests/robot-world-counts.test.ts`.
- **A3 Driver + thiết bị (12h):** `drivers/gripper-servo2.ts`, `ir-digital.ts`, `tcs34725.ts`; `hardware/devices/tcs34725.ts`; golden `drivers/__golden__/*.cpp`. *Test:* `every palette colour classifies the same in TS and the C++ table`; `first integration ready 2.4 ms + 50.4 ms after AEN`; `NACK → zeros → không rõ`.
- **A4 Chuỗi chương trình (12h):** `ybc-ir.ts`, `constructs/uno.gripper.ts`, `uno.color.ts`, `uno.roles.ts`, `compile-uno-modules.ts`, `uno-uses.ts`, `uno.run.ts`, `binding.ts`, `capabilities/io.ts`, `block-packs.ts` (`kitBlockPacks`), `profiles/uno-basic.json`, `uno-advanced.json`, `codegen/arduino/sections.ts`, `names.ts`, i18n `blocks.ts`/`core-text.ts`/`messages.ts`. *Test:* danh sách op đúng ở `uno.test.ts:73`; conformance; `rover sandbox toolbox unchanged`; `claw 120 clamps to 90 and warns once`.
- **A5 Hợp đồng (6h):** U-35…U-39, `U-M3 wire`, chỉnh U-46/U-48, `UNO_PARITY_ROWS` 34 → 39, bằng chứng CC-06/EMU-19/EMU-20/DS-02/ARD-18/TST-08…10; `docs/uno-compatibility-contract.md`. *Test:* `uno-contract.test.ts`: tên test khớp chính xác, không có `.skip`.

### B — World (56h)
- **B1 Lắp ráp tay gắp (14h):** `world/robot/gripper.ts`, `assembly.ts`, `run/robot-modules.ts`. *Test:* `lift 0→90° in 22 ±2 ticks` (luật hãm §4.6); `carriage level within 0.5° at every lift angle, 50 g held`; `jaws stop at 80°`.
- **B2 Máy trạng thái gắp (10h):** `world/robot/grasp.ts`, `world.ts`. *Test:* `attach needs all five conditions`; `release at θc−6° not at θc−3°`; `no re-attach after a break until the claw opens past θc−6°`; `claw stops only on a sideways clamp`; `payload 60 g never attaches`; `released cube lands within 5° of upright`; `off-centre cube (≤ 1 cm) penetrates ≤ 2.1 mm`.
- **B3 Cảm biến + màu (8h):** IR và màu bằng tia, màu trong arena, `body-colors.ts`, loại trừ trong siêu âm. *Test:* `ultrasonic clear of jaws at lift 0° and 90°`; `IR sees nothing without an object`; `black cube not seen by IR`; Review Focus 1.
- **B4 Session + frame (8h):** `robot-run-session.ts` (lịch sử bức xạ 80 tick), `snapshot.ts`, `goal-frame.ts`, `goals/frame.ts`. *Test:* TST-09; Review Focus 2.
- **B5 Ổn định (10h):** `footprint.ts` quét toàn bộ góc tay; `gripper.test.ts`; addendum cho ADR 0001 §9. *Test:* `brake from top speed with 50 g held tips < 3°, caster loaded`; `claw into a wall with the drive released on contact tips < 8° and settles within 0.5 s`; `drive still pushing into a wall noses up but stays finite and lands back on its wheels`; `full-speed lift moves lift the caster ≤ 4 mm for ≤ 0.2 s`; `starts from rest at the lowest duty the lesson solutions use (≥ 50 %), 50 g held at lift 0°` (tune the gripper kit placeholder, never the rover, if not).
- **B6 Golden (6h):** fixture `gripper-pick-place`, `gripper-stack`, `gripper-sensors` trên 4 engine; guard đếm bodies/colliders/joints của rover; sửa danh sách tên ở `robot-determinism.test.ts:73`.

### C — Codegen (14h)
- **C1 (4h):** `pnpm check:arduino` có golden kit-gripper, RAM ≤ 75 % (ước khoảng 23 %).
- **C2 (10h):** `tests/parity/emulated-uno.ts` có `AVRTWI`; `twi-device.ts`, `inputs.ts` (`colors.windows`), `fixtures.ts`; `scripts/build-parity-hex.mjs`. Thêm fixture `driver-gripper`, `driver-ir`, `driver-color`, `driver-color-nack`, `kit-gripper-all`. Lệch thời gian ≤ 1 %.

### D — Kịch bản và chấm (74h)
- **D1 Schema + biến thể (6h):** `scenario-schema.ts`, `variants.ts`, `arena-schema.ts`, `arena-mat.ts`. *Test:* `existing scenarios keep their variant offsets`; `objectColors[0] equals arena colour`; `a 16 cm kit's start ring and label keep-off are drawn at 16`; `rover mat output byte-identical`.
  - **Bán kính theo kit trong `arena-mat.ts`** (A1 chỉ làm phần world): vòng xuất phát in ra (`:473`), vị trí nhãn của điểm xuất phát (`:461`, `:466`) và vùng cấm nhãn (`:141`) đang dùng hằng `ROBOT_FOOTPRINT_RADIUS_CM` (11 cm) và `MatScenario` không có kit. Truyền `kitFootprintRadiusCm(kit)` vào (kit của scenario) để mặt thảm in và thảm 3D của bài gripper vẽ vòng 16 cm; kit rover giữ 11 nên thảm rover không đổi byte (`tests/arena-mat*.test.ts`).
- **D2 Bốn goal mới (12h):** các file goal, `index.ts`, `reasons.ts`, `goal.ts` (detail). *Test:* mọi trường hợp biên ở §4.5; Review Focus 4.
- **D3 Câu báo (5h):** `messages.ts` (`robot.goal.reason.*`, `robot.check.why.*`), tên vật trong `check-report.ts` ("khối đỏ", "kiện hàng 2", viết hoa đầu câu bằng `toLocaleUpperCase('vi')`).
- **D4 Bốn kịch bản (35h):** pick 8h, deliver 10h, sort 7h, stack 10h. Gồm `src/samples/robot-scenarios/rb-grip-*.json`, lời giải mẫu, lời giải mù và exploit trong `robot-solutions.ts`, golden `.ino`. *Test:* lời giải mẫu qua mọi lượt; lời giải mù và exploit trượt, không vượt điểm trần §6.
- **D5 Key + manifest (5h):** `robot-keys.ts`, `ready-fields.ts`, `messages.ts` (`robot.scenario.*`), `pnpm export:robot-manifest`; test tĩnh và test check (`same result 1×/4×/headless`).
- **D6 (4h):** cập nhật determinism của cả check trên 4 engine cho 4 lời giải mẫu.
- **D7 (3h):** `verify:attempt` cho attempt gắp: trung thực → match; bị sửa → mismatch.
- **D8 (4h):** `docs/robot-scenario-authoring.md` (vật thể đã dùng, goal mới, số đo tay gắp, các bước bên LMS).

### E — UX và 3D (71h)
- **E1 Chip HUD + thông báo (4h):** "Đang giữ: khối đỏ" kèm mẫu màu; `lab-announcements.ts` báo "Đã gắp / Đã thả khối đỏ" tối đa 1 lần mỗi 1,5 s, im lặng khi đang Kiểm tra.
- **E2 Inspector (5h):** ModuleCards, PinInspector, pin-map gồm Kẹp, Tay nâng, IR, Màu (A4/A5, R G B C, tên màu).
- **E3 Teleop (5h):**
  - Phím `Q` mở, `E` đóng, `R` nâng +15°, `F` hạ −15° (khớp theo `code`), thêm 4 nút.
  - Lệnh teleop `{op:'gripper', …}` đi qua binding.
  - Không trùng phím camera hay phím lái.
- **E4 Bản đồ 2D (8h):**
  - Vẽ ngàm theo `clawDeg`, tầm với theo cos(lift), vật đang giữ có vòng tròn.
  - Hoa văn cho người mù màu theo `patternInk`: đỏ sọc ngang, xanh lá lưới, xanh dương chấm to.
  - Overlay IR và màu.
- **E5 Overlay 3D + tag (7h):** tia IR, điểm đọc màu; tag cho vùng có tên và cho vật (ẩn khi đang giữ).
- **E6 Asset tay gắp (14h):**
  - `assets-src/robot3d/parts/gripper.py`: MG90S, giá chữ U, ngàm có đệm cao su, bảng IR, bảng TCS34725 có LED.
  - `build.py` đọc cả hai kit; `robot-assembly.ts`, `GltfRobot.tsx`; `neededParts(kit)` thay cho `NEEDED_PARTS`.
  - `reference` trong `GltfRobot.tsx` **vẫn là kit rover** (các part chassis, bánh, caster được dựng theo rover và co giãn sang kích thước của kit, A1 đã ghi ở D-G1). Part chỉ có ở gripper cần kích thước tham chiếu riêng, và manifest asset phải băm cả `ref-uno-gripper.kit.json` (`scripts/build-robot-assets.mjs:43-46` hiện chỉ băm file kit rover).
  - Kích thước lấy từ file kit (hình = collider).
- **E7 Asset vật (8h):** khối xốp (khoảng 200 tam giác, atlas 256² cho hoa văn), kiện hàng có băng keo, bệ gỗ, `prop_kho_shelf`; `arena-assembly.ts`.
- **E8 Gallery + soát hình độc lập + 1 vòng sửa (8h):**
  - Ảnh tham chiếu đặt ở `.superpowers/sdd/n19-gripper/ref/`.
  - `e2e/robot-lab-gripper-look.spec.ts` chụp: lúc bắt đầu, cận cảnh lúc gắp, chở và xếp, ở cả hai mức đồ họa, có mô phỏng mù màu.
  - Pixel-diff các bài rover: phải trùng.
- **E9 Bench (4h):** `bench:robot3d` trên profile máy trường cho grip-deliver và grip-stack, cộng lượt Kiểm tra 4×.
- **E10 e2e (8h):** `e2e/robot-lab-gripper.spec.ts` gồm Chạy, Kiểm tra Nhanh, câu báo, Xem lại, chip, Q/E/R/F, hoa văn 2D, thông báo; WebGL tắt (Review Focus 5).

### F — LMS (18h)
- **F1 (4h):** chép manifest sang STEMLearning và cập nhật sha256 + độ dài; `LAB_TEMPLATES.robot`; `DefaultRobotScenarios` + appsettings (`{Key, Version, GoalIds}`); test C# `LabTemplateCatalogTests` và `RobotLabRulesTests`.
- **F2 (4h):** `ScenarioThumbnail.tsx` (helper `GripperRobot`, `Cube`, 4 hình); `admin.json` có tiêu đề bằng `title.vi` và 4 câu tóm tắt; `LabEditor.robot.test.tsx`.
- **F3 (8h):** seed module 4 "Tay gắp": 4 bài, mỗi bài là lý thuyết ≤ 2000 ký tự rồi RobotLab, theo đúng văn phong hiện có.
  - Lý thuyết:
    - bài 8: thứ tự hạ → mở → tiến → có vật → đóng → nâng; vùng chết 2 cm của siêu âm;
    - bài 9: `repeat 3`;
    - bài 10: TCS34725 + if/else-if;
    - bài 11: bảng góc tay ↔ độ cao (đặt lên bệ ở tay 55°).
  - Hướng dẫn ghi "<goal> (N điểm)", thời gian và các lượt.
  - `passScore` để null cho cả 4 bài.
  - Viết lại `robot-course.test.ts`: tra theo `scenarioKey` thay cho index; sân tập là bài cuối của module 3.
- **F4 (2h):** `docs/demo-runbook.md` ghi "10 bài" và quy trình cập nhật DB đang chạy:
  1. deploy stem-demo;
  2. deploy CourseService và LearningService cùng lúc;
  3. deploy web;
  4. gỡ xuất bản khóa;
  5. chạy `pnpm seed`;
  6. kiểm tra bài 7 và bài 8–11.

  Cập nhật `docs/architecture.md` và `CHANGELOG.md`.

### G — Nghiệm thu (16h)
- **G1 Browser test một lần trên LMS** (database mới), qua Playwright MCP:
  - học sinh làm bài 8–11;
  - điểm còn sau khi tải lại;
  - heatmap của giáo viên có 4 cột mới;
  - admin thấy 11 thẻ kịch bản và xem trước được;
  - chạy `verify:attempt` trên một attempt gắp.
  - Báo cáo ghi vào `STEMLearning/.superpowers/sdd/browser-test/n19-gripper.md`.
- **G2 Final whole-branch review (opus)** → một đợt sửa → re-review có giới hạn.

## 8. Gate

| Gate | Gồm | Điều kiện qua |
|---|---|---|
| G0 | G0.x | Gắp tất định trên 4 runtime, ổn định, ≤ 0,5 ms/tick; quyết định go/no-go cho I²C |
| G1 | A1–A4, B1–B2 | Chương trình viết tay trên kit gripper gắp được khối và thả vào vùng, trong iframe e2e |
| G2 | + A5, B3–B6, C, D1–D5 | 4 lời giải mẫu qua; phản lời giải trượt; tất định trên 4 engine; golden 6 bài cũ giữ nguyên |
| G3 | + E | Soát hình độc lập đạt; pixel-diff bài cũ trùng; bench trong ngân sách |
| G4 | + F, G | Browser test không Blocker/Major; final review "Ready" |

## 9. Verification

1. **stem-demo:**
   - `pnpm verify`: typecheck, lint B1, unit gồm robot-determinism, robot-scenarios, uno-emulator-parity, uno-contract.
   - `pnpm check:arduino --require`.
   - `pnpm e2e` trên mọi project (chromium, chromium-robot, firefox, webkit), gồm `robot-lab-gripper*` và determinism trên 3 trình duyệt.
   - Bộ e2e giữ low-tier chain ở trạng thái tắt.
2. **Hiệu năng:** `pnpm build && pnpm bench:robot3d --profile=school --scenarios=rb-grip-deliver,rb-grip-stack`. Ngân sách N18 không đổi; GLB trong giới hạn §3.
3. **Bài cũ không đổi:** golden hash, pixel-diff các bài rover, `verify:attempt` trên attempt thí điểm đã lưu trong DB (attempt 1–27).
4. **STEMLearning:** `dotnet test` (CourseService, LearningService); `pnpm verify` ở `Web/`; chạy AppHost trên DB mới với seed rồi làm browser test (G1).

## 10. Câu hỏi bổ sung cho nhà cung cấp (thêm vào `docs/uno-vendor-questions.md`)

1. Kit có tay gắp không? Loại nào: 1 hay 2 bậc, servo gì (SG90, MG90S, MG996R), góc mở và đóng, độ mở ngàm, tải tối đa.
2. Tay nâng có giữ giá kẹp **nằm ngang** khi nâng (hình bình hành) không, hay giá kẹp nghiêng theo tay? Nếu nghiêng thì phải chỉnh lại bài xếp chồng.
3. Cảm biến vật trong càng: có không, loại nào, chân nào, mức logic khi thấy vật.
4. Cảm biến màu: có không, loại nào (TCS34725, TCS3200…), có LED không, gắn ở đâu.
5. Nguồn cho servo: có tách nguồn và mass chung với bo không. Nguy cơ sụt áp với MG996R.

## 11. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Joint giữa ngón và vật làm solver mất ổn định (tỉ lệ khối lượng khoảng 15:1) | Joint nối vào giá kẹp; tăng số vòng PGS; chia solver group; dự phòng ngón-sensor (G0.1) |
| Xe lật khi đâm tường hoặc phanh lúc đang giữ vật | Ngân sách khối tâm §4.4; test B5; sa bàn để tường ngoài đường đi của càng hoặc dừng lượt khi chạm |
| Parity I²C không làm được | G0.2 quyết định. No-go thì bài 10 hoãn, U-38/U-39 để DEFERRED, các phần khác vẫn ship |
| Một sửa đổi vô tình làm đổi hash bài cũ | Code mới nằm ở file mới; mọi task đều chạy determinism, robot-scenarios, verify-attempt và guard đếm |
| Ngưỡng màu, IR và thông số cơ khí là số tạm | Ghi rõ là PLACEHOLDER; ngưỡng đi kèm phiên bản driver; chỉnh lại khi có kit thật (VG/L3) |
| Bán kính chân đế 16 cm làm khó rút biến thể | Sa bàn bài gắp rộng hơn; test tĩnh pin tính chất của từng bài |
| Tay gắp của nhà cung cấp làm giá kẹp nghiêng khi nâng | Câu hỏi §10.2; bài xếp chồng có thể chỉnh (nhả khi tay ở góc thấp) |

## 12. Ghi chú thực thi

- **Cách chạy:** tự động như N18. Ledger mới `stem-demo/.superpowers/sdd/n19-gripper-plan/progress.md`. Mỗi task: test xanh → commit (không trailer) → `integrate.sh` (verify-gated, ff-only `origin master`). Mỗi lúc chạy 2–3 implementer song song (mỗi người một worktree, mỗi người một dải cổng riêng). Browser test chỉ chạy một lần ở G1.
- **Model:** sonnet cho task cơ học (A2, A5, D3, D5, E1–E3, F); opus cho G0, B, C2, D2, D4, E6–E8 và final review.
- **Sau khi duyệt:** lưu memory `n19-gripper-plan` (trạng thái, đường dẫn plan, gate hiện tại) và thêm dòng vào `MEMORY.md`.

## Phụ lục A — Nguồn nghiên cứu chính

- **Ứng dụng:**
  - VEX VR: [magnet API](https://api.vex.com/vr/home/blocks/magnet.html), [Disk Mover](http://education.vex.com/stemlabs/cs/cs-level-1-vexcode-vr-blocks/moving-disks-with-loops/lesson-5-disk-mover-challenge), [Coral Reef](https://api.vex.com/vr/home/playgrounds/coral_reef_cleanup.html).
  - CS2N: [Advanced Auto Pickup](https://cs2n.org/curriculum/iq-advance-auto-pickup), [Cube Disposal](https://cs2n.org/curriculum/iq-cube-disposal1).
  - GEARS (GPL, chỉ tham khảo): [Electro-Magnet](https://github.com/QuirkyCort/gears/wiki/Electro-Magnet), [Fire Rescue](https://github.com/QuirkyCort/gears/wiki/Fire-Rescue-Challenges).
  - OhStem: [Tay gắp 2 bậc](https://docs.ohstem.vn/en/latest/robot_rover/gap_hai_bac.html), [Sa bàn robot cơ bản](https://docs.ohstem.vn/en/latest/sa_ban/robot_co_ban/gioi_thieu.html).
  - LEGO SPIKE: [Training Camp 2](https://education.lego.com/en-us/lessons/prime-competition-ready/training-camp-2-playing-with-objects/).
- **Mô phỏng gắp:** [Gazebo grasp fix](https://github.com/JenniferBuehler/gazebo-pkgs/wiki/The-Gazebo-grasp-fix-plugin), [Isaac Surface Gripper](https://docs.isaacsim.omniverse.nvidia.com/6.0.0/robot_simulation/ext_isaacsim_robot_surface_gripper.html), Rapier [joints](https://rapier.rs/docs/user_guides/javascript/joints) và [determinism](https://rapier.rs/docs/user_guides/javascript/determinism).
- **Kit thật:** [Keyestudio KS0523](https://docs.keyestudio.com/projects/KS0523/en/latest/KS0523.html), [OhStem Tay gắp 2 bậc](https://ohstem.vn/product/tay-gap-2-bac/), [Hshop G1](https://hshop.vn/bo-tay-gap-robot-g1-gripper-kem-khoi-nang-ha-tuy-chon).
- **Video:**
  - Circuit Digest, "Arduino Pick and Place Robot Car" (youtu.be/EY_JZ2MEF84);
  - HowToMechatronics, "Robotic Arm & Mecanum" (LBNRGBY5zN8);
  - Keyestudio KS0520 (r0PTyl7WgV0);
  - VEX VR Electromagnet (TWbEOKou5j8, Byfdxwl_EEk);
  - Disk Mover L1–3 (eZO01npwzRQ, G402GPJ0SgU, 2Hxs_YN7k2U);
  - VEX IQ "Opening the Claw" (d8gI02Ecig0), "Claw Design" (2DNQQKckmLk);
  - OhStem: lắp Tay gắp 2 bậc trên xBot (uOPOyPPHzdc), xBot + Gripper (AZ90lZmgdP0), tập huấn ORC (ybbULq97J6M, DWdS1PGlFK0, mhcwxlbWz94);
  - WRO 2026 Basic Robot Test (HPBj3QQ2UQw);
  - mBot2 Pick & Place (shorts/5qAuAlfYolE).
- **Thi đấu:** [WRO scoring sheet](https://scoring.wro-association.org/en/regular2019/sheet/show/28848/1/3), [Robocon ORC](https://www.orc.vn/robocon-orc-2025-2026/), [Robotacon WRO 2025](https://tapchicongthuong.vn/robotacon-wro-2025--toa-sang-tai-nang-robot-viet-nam-huong-den-chung-ket-quoc-te-tai-singapore-171936.htm).
