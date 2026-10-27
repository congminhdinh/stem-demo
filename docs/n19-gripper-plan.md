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
  - Luật servo tay nâng **có hãm**: tốc độ = min(60°/`liftSPer60Deg`, |e|/dt, √(2·a·|e|)), a = **125,2** rad/s².
    - *Sửa khi làm B1:* ADR 0004 §5.2 ghi 139,4, tức nửa của (T_s − mô-men trọng lực xấu nhất)/quán tính xấu nhất khi **chưa** tính quán tính rotor. Code spike (`liftDecelRadS2(5e-5) / 2`) và mọi số đo của G0.1 đều dùng 125,235 (có rotor 5·10⁻⁵). World production với 125,2 cho lại đúng hàng "chọn" của ADR §4.1 (sụt −0,009°, 0→90 trong 22 tick, vượt 90→40 0,045°, vượt khi giữ 50 g 1,27°). Với 139,4 thì khối 50 g lệch ngang 1 cm lún 2,154 mm, quá giới hạn 2,1 mm của test B2 (125,2: 2,065 mm). Sau khi bi đỡ được làm mới ma sát (fix round 1) thì số đó là 1,794 / 2,067 mm, nên độ lún không còn phân biệt hai giá trị; controller giữ 125,2 vì là giá trị spike đã đo (ADR 0004 §10b).
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
    2. càng chỉ dừng khi vật bị kẹp ngang (khe ≤ bề rộng + 0,05 cm), mỗi ngón dừng ở góc chạm. *Sửa khi làm B2:* ngón chỉ **dừng**, không bị mở ra. Spike còn mở một ngón đang lún vào vật thêm (độ lún / đòn bẩy 1 cm). Với khối 60 g lệch 0,25–1 cm, ngàm mở lùa khối vào và một ngón lún tới 2 mm sát bản lề; ngón đó bị mở tới chặn trong khi ngón kia xoay khối 5,7–7,4° (β +12° / −5,4°, đo được). Khi ngón chỉ dừng thì càng kẹt ở 25–28°, khối xoay 1,1–3,8°; khối nằm giữa thì như cũ (26,95°);
    3. ngón bám mặt vật đang giữ (đòn bẩy kẹp trong 1–5,5 cm);
    4. solver group như trên.
  - *Thêm khi làm B2, fix round 1* (ADR 0004 §10b):
    5. không attach khi càng < 6° (= độ trễ thả). Lệnh kẹp chỉ từ 0 tới 90, nên vật attach ở θc < 6° không bao giờ thả được. Ngàm mở kẹt được mọi hộp rộng từ khoảng 4,5 cm ở khoảng 0°, kể cả bệ 6×6×4 cm của bài 11;
    6. không attach vật có **bề rộng riêng** (`ownWidthCm`: cạnh ngang nhỏ hơn của hộp, đường kính của trụ) lớn hơn khe hai ngón khi song song + 0,3 cm (`gripWidthCm`, 4,3 cm). Vật rộng hơn thì hai ngón đều nằm trong nó lúc thỏa điều kiện 4: hộp 5 cm vẫn attach ở 9,08° với hai ngón lún 3,3 mm.
       - *Fix round 2:* phải đo bề rộng riêng chứ không đo bề rộng ngang qua ngàm. Khối 4 cm xoay 8° rộng 4,52 cm ngang qua ngàm, nên đo kiểu cũ thì không bao giờ gắp được.
       - Luật 2 cũng kẹp theo bề rộng riêng, nên càng không dừng ở góc của khối bị xoay mà đóng tiếp. Đo: khối 4 cm xoay 8° / 12° / 20° attach ở 9,86° / 9,47° / 8,98° và thả bình thường.
       - Luật 3 không bao giờ mở ngón quá góc của nó lúc attach. Nếu không, hộp 4,2 cm bị giữ giữa hai ngón mở hết cỡ, càng đọc −0,5°.
  - **Drive của kit gripper:** mỗi tick làm mới contact của hai bi đỡ (`setTranslationWrtParent` tại chỗ), để ma sát hộp số vừa đặt tới được solver. Không có bước này, Rapier giữ ma sát cũ của manifold (tới 0,97) và xe đứng yên ở duty ≤ 160. Rover không đổi (ADR 0004 §10b).
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

### 4.8 Ghi lại khi làm A4 + A5 + C2 (một dispatch; thắng §4.3 khi mâu thuẫn)

- **Một dispatch:** contract (A5) và parity (C2) đi cùng chuỗi chương trình (A4): test của contract bắt mọi dòng mở phải có parity EMU-16, mà fixture parity cần generator của A4; generator thì cần dòng contract (`unoOps`, allowlist).
- **IR:** `color.is(color1, color)` và `color.raw(color1, channel)` giữ lựa chọn của dropdown bằng **tên** (`ColorName`, `ColorChannel`), như hướng của khối robot đi; run và generator đổi ra chỉ số (`modules.read(role, op, [n])`, `colorIs(<n>L)`). Kẹp và tay cảnh báo `value-clamped` một lần cho role `gripper` (cả hai).
- **Hộp khối:** pack `uno.gripper` (kẹp, tay, IR), `uno.color`, `uno.color.advanced`, đứng cuối catalog; profile đặt "Tay gắp" ngay sau Servo. `kitBlockPacks(profile, {kit, board}, catalog)` bỏ khối có role kit không có (theo `roleOps`, như compiler báo capability-unavailable); hộp khối rover trùng byte với master (cả en và vi).
- **Tên C++ theo kit (ruling A23):** giữ role, macro chân (role của kit × tên chân của driver trong kit), tên file-scope của driver và của Wire (`twi_*` link được kiểm bằng compile). `colorRgbc` không có trong helper nên không giữ.
- **Contract:** U-35…U-39 + U-M3 Wire; L2 = CC-06, L2e = EMU-19 + EMU-16 (sketch `gripper-forms`, không phải `contract-forms` của rover, vì A4 là mốc thời gian của nó). Dạng màu là `colorIs(<value>)`, `colorRaw(<value>)`. Version **giữ 0.1.7**: version nằm trong header của mọi sketch sinh ra.
- **Parity C2:** bus TWI có thời gian ở `tests/parity/twi-device.ts` (xoá TWINT giả sau STOP); `inputs.colors.windows`; 5 fixture. Phát hiện thêm: servo thứ hai của Timer1 (tay) có một xung ở lần tràn đầu của Timer1 (32,8 ms, `Channel[]` của Servo 1.3.0 bắt đầu từ 0) → harness ghép nó vào run (`servo-first-pulse.timerWrapUs`; chỉ chân tay, chu kỳ đầu dài thêm tối đa xung rộng nhất của càng, 1472 µs). `driver-color`: cửa sổ thứ hai kết thúc giữa byte dữ liệu 1 và 3 của lần đọc **trên cả hai phía** (simulator: 34,875 µs sau C low, 155 µs trước R low; board: 155,8125 µs sau C low, 34,25 µs trước R low — board tới lần đọc sớm hơn ≈ 116 µs); test parity khẳng định cả hai (review A4 I1). `Wire.begin` bật pull-up SDA/SCL trên board → simulator cũng làm (`colorBeginSim(io, port)`, cùng 9,6875 µs nên sự kiện bus không dời).
- **Test session (§4.7):** `robot-run-session.color-lead.test.ts` chạy session thật với kit gripper truyền thẳng vào và sàn của sandbox (chưa có key `rb-grip-*`, D4); model TCS34725 gắn vào virtual UNO của session bằng mock, vì ánh sáng của world là B3.

### 4.9 Ghi lại khi làm E6/E7 (asset tay gắp và vật; thắng §3 và §7 E6/E7 khi mâu thuẫn)

- **Root N18 của GLB đóng băng.** Bake AO bằng Cycles không lặp lại được giữa hai lần chạy (đo: hai lần build cùng commit 80e089b lệch số vertex ở 13 mesh, vì màu AO 8 bit ở vài góc lệch 1/255), nên build lại part rover sẽ đổi pixel rover. `pnpm build:robot-assets` vì vậy chỉ build root N19 (`build.py … n19`) rồi nối vào sau phần N18 của file hiện có (`scripts/lib/glb-splice.ts`, đọc/ghi JSON giữ nguyên chữ số của Blender). Manifest thêm:
  - `frozen.files[*]`: layout và SHA-256 của phần N18 (bằng đúng hash file của build N18);
  - `frozen.sources`: hash các script N18 (mọi script trừ `build.py` và 3 script N19).
  - Test `tests/robot-assets-frozen.test.ts` kiểm cả hai. Đổi một script N18 thì phải `pnpm build:robot-assets --all` (pixel rover sẽ đổi, cần soát hình lại).
- **Hash kit gripper** nằm ở `kits` của manifest, không ở `sources`, để test cũ `tests/robot-assets.test.ts` giữ nguyên.
- **Một material cho cả tay gắp** (`gripper_atlas`): atlas màu 256², atlas metallic-roughness cùng bố cục, mask glow 32² cho LED. Mỗi phần chuyển động là 1 draw. Tay gắp thêm đúng 6 draw: bracket (gộp vào robot), boom, link, carriage (kèm IR và màu), 2 ngàm.
- **Hình học không có trong kit** chép từ ADR 0004 §2 và `world/robot/gripper.ts` (B1): hộp giá kẹp u ±0,5, v ±2,6, w ±0,6 cm; tấm boom dày 0,4 cm, cao 1 cm; thanh ngang tiết diện 0,6 cm.
- **Thanh nối dưới của hình bình hành** (trục cách trục boom 1 cm phía dưới) chỉ để vẽ; vật lý dùng khoá góc `AngZ` (§4.6).
- **LED cảm biến màu sáng khi `status === 'running'`.** LED trên bo TCS34725 sáng khi có điện, vì kit chỉ nối SDA và SCL. Snapshot không có tín hiệu "cảm biến đang chạy" nào khác. Có thêm quầng sáng (sprite) như đèn dò line.
- **Siêu âm của kit gripper cao hơn rover 1 cm** (z 5 so với 4). Part siêu âm vẽ theo rover, nên chân giá của nó đứng trên hai trụ đồng (`part_ultrasonic_riser`, chiều cao lấy từ hai kit).
- **Bo mạch trên kit không có tay servo** đặt sau bảng đèn dò line ở mép boong. Rover không đổi: vẫn đặt sau tay servo.
- **Vật và kệ (E7):**
  - Vùng có `name` không có cổng đích (gantry). Tag của vùng đã nêu tên vùng.
  - Tường `kho-wall` vẽ thành kệ kho, không thêm bảng hazard.
  - Vật có `noun` vẽ đúng loại, tô bằng `color`. Khối xốp có hoa văn trên mặt trên: đỏ sọc ngang, xanh lá lưới, xanh dương chấm to, vàng trơn.
  - Bệ không có màu dùng màu gỗ beech.
- **Số đo** (`e67-report.md`):
  - Tay gắp: 3 632 tam giác ở mức high, 2 060 ở mức low (chưa kể trụ đỡ siêu âm: 136 và 40; sau vòng sửa 1).
  - Vật: 1 380 tam giác ở mức high, 628 ở mức low.
  - GLB tăng: kit +99,0 KB (high), +63,9 KB (low); props +71,4 KB (high), +46,6 KB (low).
  - Pixel-diff 44 ảnh rover (7 bài × 2 mức) so với master: trùng bit. Riêng 3 pixel rail của servo-gate high lật giữa các lần chạy, cả master với master.
- **Vòng sửa 1 (review E6/E7):**
  - **Vẽ lại khi tay gắp đổi.** `sameCasters` so cả `robot.gripper`: kẹp và tay trong 0,05°, và `heldId`. `sameView` so đèn LED màu theo `status`, nhưng chỉ ở snapshot có tay gắp. Rover so như cũ.
  - **Vỏ servo kẹp là dữ liệu kit** (PLACEHOLDER): `clawServoCenter{U,V,W}Cm` `[-0.13, 0, 1.535]` và `clawServoSize{U,V,W}Cm` `1.22 × 2.28 × 2.27`, trong khung giá kẹp.
    - Asset và view đọc hộp này; test giữ phần vẽ bằng hộp trong 0,5 mm.
    - World chưa đọc. **B5 thêm collider này** và siêu âm phải nghe thấy nó: servo nâng lên trước HC-SR04 thật thì chắn tia, là một lỗi đáng để học.
  - **Bo mạch trên xe không có tay servo** đặt đúng chỗ của rover, che phần AO đã bake dưới bo. Ở mức low còn một vệt rất nhạt tại chỗ buzzer của rover (−5, 3); không thêm vật che. (E8 đã sửa trong view, không đổi asset: §4.15.)
  - **Không vẽ gì quá ±6,8 cm** (thanh ngang của vật lý), trừ hai đầu vít trục boom nhô 0,5 mm. Review E6/E7 lần 2 (N1) đo đầu trục boom bên trái nhô 1 mm (−6,897 cm). E8 cắt trục về đúng mặt ngoài tay boom, dưới đầu vít: boom nay ±6,848 cm ở cả hai mức (§4.15).
    - Thanh nối dưới và tai giá kẹp nằm giữa giá bên và tay boom.
    - Hai đầu tròn của tay boom vẫn quá hộp tấm 0,5 cm ở hai đầu, dọc theo boom.
  - **Kệ kho** dựng cho tường 40 × 4 × 12 cm. View kéo giãn kệ theo tường, còn biển co đều theo chiều cao tường. D4 nên chọn tường gần kích thước đó.
  - **Kit có kích thước khác** chỉ co boom, link và ngàm. Giá kẹp (vị trí chốt ngón), giá bên và hai bo giữ kích thước tham chiếu. Đây là giới hạn đã biết khi chỉ có một kit PLACEHOLDER.
  - **Kẹp lệch tâm:** `clawDeg` là trung bình hai ngón. Khối bị kẹp lệch thì hai ngàm vẽ ở cùng góc trung bình, một ngàm lấn vào khối, một ngàm hở. Ghi cho B4/E8; nếu thấy rõ thì thêm góc từng ngón vào snapshot.
  - **`build.py`** là bản N18 cộng hai khối `# N19 >>>…<<<`. Code N19 nằm ở `build_n19.py`. Hash của `build.py` bỏ hai khối đó (`scripts/lib/frozen-sources.ts`) bằng đúng hash N18, và cùng giữ root N18 đóng băng.

### 4.10 Ghi lại khi làm E1 + E2 + E3 (chip HUD, inspector, teleop; thắng §7 E1–E3 khi mâu thuẫn)

- **Chip HUD (`HeldChip.tsx`):** đọc đúng một giá trị từ store là `heldId` (và số lượt đang xem) nên chỉ render khi `heldId` đổi. Tên vật là `objectName` của D3 (không có hàm đặt tên thứ hai); màu lấy qua `objectColorName` (cùng `roundColors` với tên). Hoa văn là `body-marks.ts`: đỏ sọc ngang, xanh lá lưới, xanh dương chấm to, vàng không (như atlas khối xốp của E7). Chip không phải live region.
- **Thông báo "Đã gắp / Đã thả" (`createGripAnnouncer`):** tối đa một câu mỗi 1,5 s theo kiểu **trailing**: một thay đổi rơi vào cửa sổ thì chờ hết cửa sổ rồi mới nói nếu vẫn còn đúng; gắp lại trước khi hết cửa sổ thì không nói gì (người nghe đã biết đúng trạng thái). Một lượt chạy mới, thế giới bắt đầu lại (thời gian lùi), Dừng, Đặt lại và Kiểm tra đều **không** là sự kiện gắp (reset im lặng). Câu có dấu chấm cuối, như các câu thông báo khác.
- **Teleop:** lệnh `{op:'gripper', part, deg}` (deg nguyên 0..90) đi qua `modules.call('gripper', 'gripper.claw'|'gripper.lift', [deg])`, ghi log theo tick như lệnh lái; lệnh lặp lại giá trị cuối của **cùng bộ phận** bị bỏ qua. `TELEOP_USES` giữ nguyên cho rover (test cũ); `teleopUses(kit, board)` thêm hai op của tay gắp cho kit có tay gắp (setup() gắn cả hai servo, claw 0°, lift 90°) và **`color.is`** cho kit có cảm biến màu, để setup() chạy `colorBegin` và màu hiện ra khi lái tay (coordinator đã chốt, chấp nhận 58 ms setup; lệnh ở tick 0 vẫn áp dụng ở tick 0). Phím khớp theo `code`: Q mở (0°), E đóng (`jawsMeetDeg`, 80°), R/F ±15° từ **góc đã ra lệnh** gần nhất (không phải góc vật lý, nên hai lần bấm nhanh là hai bước), kẹp 0..90. **Giữ R/F bước 10 lần mỗi giây** (bước ngay, sau 0,4 s mỗi 0,1 s, `createRepeater`), bằng nút, bất kể tốc độ lặp phím của hệ điều hành: các sự kiện `repeat` của hệ điều hành bị bỏ qua (một `repeat` không có lịch phía sau, vì phím được giữ qua lúc mất focus, tính là bấm lại). Khoảng 0..90 và góc setup() (`GRIPPER_ANGLE`, `GRIPPER_START`) chỉ viết ở `drivers/gripper-servo2.ts`; teleop, kho công cụ UI và world (`world/robot/gripper.ts` re-export) đọc từ đó. Mỗi world teleop mới (cạnh lên của `starting`) quay về góc setup(). Bốn nút nằm cạnh D-pad (không nằm trong `.robot-pad`, nên DOM của rover không đổi); nút tay nâng dùng cùng lịch lặp với phím và nhả khi mất focus.
- **Inspector:** thẻ Tay gắp có hai đồng hồ (kẹp: góc + mở/đóng, mở khi < 6° vì dưới đó không attach, §4.6 luật 5; tay nâng: góc), lấy từ `robot.gripper`. IR đọc **chân A3** + `activeLow` của kit (cái chương trình đọc được): "LOW · có vật" / "HIGH · không". Màu: tên màu = `classifyColor` (cùng `COLOR_RULES` với `color.is`), số thô R G B C, và dây SDA/SCL.
- **Việc còn lại cho B3/B4 (số thô của cảm biến màu):** snapshot hiện không mang RGBC của TCS34725 (model nằm trong virtual UNO của session). Inspector đọc `rgbc?: {c,r,g,b}` **tùy chọn** trong mục `color-sensor` của `sensors[]`, chỉ khi có; chưa có thì thẻ ghi "chưa có số đọc". B4 điền từ `peek(now).data` của model (số mà `color.raw` đọc được lúc đó). Teleop đã gọi `colorBegin` (xem trên), nên số đọc là thật khi B4 gắn model vào virtual UNO của session. Chỉ số của `sensors[]` ở `pin-map.ts` và `robot-model.ts` khớp nhau với mọi thứ tự module của kit (test dùng 4 thứ tự).

### 4.11 Ghi lại khi làm B3 + B4 (thắng §4.4 khi mâu thuẫn)

- **Cảm biến trên giá kẹp** (`world/sensors/ir.ts`, `color.ts`): hàm thuần trên pose như cảm biến N18. Tia đi từ mount (khung giá kẹp u, v, w) theo trục tới của giá kẹp, gặp body đầu tiên mà `sensedBodies` gọi tên: mọi collider của arena kèm màu của nó, và các phần của bộ gắp (id `#gripper`, màu đệm cao su `#2b2e33`). Thân xe không được gọi tên nên không cảm biến nào thấy.
  - Tia bỏ qua **giá kẹp và cả boom**, không chỉ giá kẹp: mount u 0,3 nằm trong hộp giá kẹp (u ±0,5) và trong thanh ngang của boom ở bản lề (nửa cạnh 0,3 cm xoay theo boom, ở tay 0° dài 0,39 cm theo u). Tia bắt đầu trong vật rắn thì chạm ngay ở 0, nên nếu chỉ bỏ giá kẹp thì IR luôn "thấy" `#gripper` (đã đo). Ngón tay vẫn được tính.
  - **IR:** đo được: không có vật thì không bao giờ thấy ngón, ở mọi tổ hợp kẹp × tay bước 5° (19 × 19); thấy mặt gần của khối khi mặt đó ở u 2,28 (≤ 0,3 + 2); khối đen `#212121` (luma 0,129) không thấy, kể cả khi đang giữ; khối đang giữ thì thấy. Sàn là collider của arena (màu `ground.color`); ở tay 0° tia IR nằm ngang ở khoảng 1,69 cm (đáy ngàm 1,09 cm) nên thực tế không bao giờ gặp sàn.
  - **Mount trong dữ liệu kit (A2, cho VG/L3):** IR và cảm biến màu ở u 0,3, tức nằm sâu 0,2 cm bên trong hộp giá kẹp (mặt trước ở u 0,5). Tầm 2 cm của IR và độ suy giảm ánh sáng của cảm biến màu vì vậy tính từ điểm sau mặt giá kẹp 0,2 cm, và tầm hiệu dụng của IR tính từ mặt giá kẹp là 1,8 cm. Khi đo module thật thì đặt lại mount.
  - **Màu:** bức xạ mỗi kênh = floor(1000 · (white_k · (c_k/255) / (1 + (d/h)²) + ambient)) đếm/s ở gain 1×, C = R + G + B (cách ánh xạ của spike G0.2). Bỏ qua sàn. Càng đóng 80° mà không có vật thì tia gặp ngón phải ở 3,3627 cm (đọc "đen"). Đi trọn chuỗi world → lịch sử → model → `colorIs`: cả 4 màu bảng màu đọc đúng ở 1 cm và 3 cm; khối đen ở 1 cm đọc "đen", không có gì đọc "không rõ". Cho D4: khối trắng `#ffffff` đọc "trắng" ở 1 cm nhưng "không rõ" ở 3 cm (tính: C 5282 < 12000 và r‰ 374 < 380, nên không khớp luật trắng cũng không khớp luật vàng).
  - **Màu là dữ liệu:** `ArenaColliderInfo.color` là màu riêng của body (có mặt chỉ khi có màu; sàn luôn có `ground.color`). Không có thì dùng màu theo loại, đúng màu renderer đang vẽ (`bodyKindColors`, có test giữ cho bằng `robot3dColors`).
- **Siêu âm (riêng kit gripper):** lookup là `sensedBodies`, chỉ bỏ collider của thân xe; nghe được bộ gắp như HC-SR04 thật (`hitId` `#gripper`). Ở tay 0° và 90°, mọi góc kẹp: nghe đúng tường cách 60 cm. Ở tay 45° giá kẹp đứng ngay trước cảm biến nên đọc 2 cm. Rover vẫn gọi `measureUltrasonic` với lookup của arena và `robot.ownsCollider` như cũ.
  - "Khối 4 cm giữa ngàm đọc khoảng 3,8 cm" là **lần cuối** nón còn nghe khối khi xe tiến vào: đo được 3,9355 cm, mặt gần của khối ở u 2,97, giữa hai ngàm. Khi khối nằm giữa ngàm (u ≈ 3) thì tia thấp nhất gặp mặt trên khối ở góc tới 75° (> 60°) nên không có tiếng vọng: đó là vùng mù gần của nón.
- **Lịch sử bức xạ** (`run/light-history.ts`, 80 tick): mục của tick k là bức xạ world đo ở tick k, đóng dấu k·1000/120 ms, đại diện cho khoảng [k·dt, (k+1)·dt). Một cửa sổ tích phân lấy **trung bình các tick nằm trọn trong cửa sổ** nhân độ dài; cửa sổ không chứa trọn tick nào (ngắn hơn 2 tick) đọc tick chứa điểm đầu.
  - Lý do: bus đi trước world tối đa world.t + dt + 1123,8 µs (§4.7). Các tick nằm trọn trong một cửa sổ kết thúc trước mốc đó đều đã kết thúc trước world.t + dt, nên session đã ghi. `decidedBeforeUs` = world.t + dt + 2,4 ms.
  - Nếu lấy các mục có dấu thời gian nằm trong cửa sổ thì cửa sổ đóng trong 1,1 ms sau khi tick kết thúc cần mục world.t + dt, mà world chỉ đo ở bước sau. Khi đó đọc sớm và đọc muộn cho số khác nhau. Mutation này làm trượt cả test đơn vị lẫn hai test session.
  - Session ghi tick 0 khi tạo run, rồi ghi mỗi bước. Session test so mọi lần model hỏi với log bức xạ của world (bức xạ đổi mỗi tick): đều khớp, có lần hỏi nằm trong khoảng sau khi tick kết thúc. Một chương trình đọc liên tục và một chương trình 37 ms mới đọc một lần cho cùng số đếm ở mọi cửa sổ cả hai cùng đọc.
- **Snapshot:** `sensors[]` thêm `{kind:'ir-obstacle', detected, hitId}` (hitId là body đầu tiên tia gặp, kể cả khi không thấy, ví dụ khối đen) và `{kind:'color-sensor', hitId, distanceCm}`. Snapshot session đăng thêm `rgbc` (yêu cầu của E2): số đếm của cửa sổ đã xong gần nhất trong model TCS34725, đúng thứ `color.raw` sẽ đọc. Không có `rgbc` trước khi cửa sổ đầu xong. Model được peek ở thời gian bus, nhưng không bao giờ quá world.t + dt + `colorReadLastEventUs`, vì setup() chạy trước world 58 ms. Chân A3 lấy mức của IR mỗi tick, active low.
  - Hai kiểu readout mới khai báo `dark?: never; spotCm?: never` để `sameSensorView` (`src/ui/robot3d/sensor-overlay-math.ts`, đang phân biệt line và ultrasonic bằng cách loại trừ) vẫn biên dịch. E5 vẽ hai cảm biến này thì bỏ chỗ này đi.
  - **Việc của E5 (review B3/B4 M1):** khi chạy thì `sameSensorView` rơi vào nhánh line cho hai kiểu mới và luôn trả về "khác", nên overlay 3D (`SensorOverlay.tsx`, `invalidate(2)`) và lớp 2D (`TopViewSensors.tsx`, `batchDraw`) vẽ lại ở mọi lần publish của kit gripper.
    - Đo trong session thật (realtime 1×, 60 frame/s, lượt đã xong và xe nằm yên, t 3–10 s): cả rover lẫn gripper đều publish 70 lần trong 6,9 s (10 lần/s, nhịp `REST_CLOCK_S` của đồng hồ HUD). Rover: overlay đổi 0 lần, 2D vẽ lại 0 lần. Gripper: overlay đổi 69/69 lần, 2D vẽ lại 69/69 lần, tức khoảng 20 frame WebGL/s (2 frame mỗi `invalidate(2)`) và 10 lần vẽ 2D/s khi đáng lẽ là 0.
    - Ngân sách N18 "draws per second at rest ≤ 0" vì vậy trượt với kit gripper. Mỗi frame trên profile máy trường tốn khoảng 3,2–3,4 ms main thread cho lệnh render (bench E6/E7, `spikes/n19-e67/results/bench`, load khoảng 25).
    - E5 phải so `detected`/`hitId` của IR và `hitId`/`distanceCm` (cùng `rgbc` nếu overlay vẽ nó) của cảm biến màu, rồi bỏ `NotALineSensor`. Việc này phải xong trước D4 và trước khi E9 đo bench cho các bài gripper.
- **Goal frame** (chỉ kit có gripper; rover không có field nào, có test ghim text theo master):
  - `gripper` lấy góc snap 0,001° rồi kẹp vào 0..90.
  - Mỗi object có `zCm` (tâm), `tiltDeg` = atan2(√(1 − m²), m) qua dmath, m là |trục·up| lớn nhất của hộp (nằm trên mặt nào cũng là 0), là |trục·up| với trụ. `held` lấy theo `heldId`.
  - `restingOn` (`world/sensors/resting.ts`): ứng viên là các cặp tiếp xúc của narrow phase. Khoảng cách (≤ 1 mm) và pháp tuyến của mặt đỡ (y ≥ 0,7) **đo ở vị trí hiện tại** bằng `contactCollider`, không đọc từ manifold, vì manifold trễ một bước và đứng yên khi body ngủ (contacts.ts). Danh sách có cả `#ground` và sắp theo id.
  - Đo được: khối đang giữ ở tay 90° thì `held` true, `zCm` cao hơn lúc nằm > 6,5 cm, `tiltDeg` < 0,5, `restingOn` rỗng. Khối được chở ở tay 55° rồi thả lên bệ 6×6×4 thì `restingOn` = ['base'], z 6 ± 0,1.
- **Chi phí** (Apple M4 Pro, Node 24.22.1, load 11–15, `world.gripper.cost.test.ts` chạy xen kẽ BASE 6884822 / HEAD): median 0,153–0,162 → 0,164–0,178 ms/tick, tức khoảng +0,012 ms cho 2 tia, `restingOn` và goal frame mỗi tick.

### 4.12 Ghi lại khi làm B5 + B6 (thắng §4.4, §4.6 và §7 B5/B6 khi mâu thuẫn)

Số đo và lệnh tái lập: `spikes/n19-b56/results.md`. Test: `world/robot/gripper.stability.test.ts`, `sensors/ultrasonic.claw-servo.test.ts`, `world/robot/footprint.test.ts`, `tests/robot-determinism.*`.

- **Vỏ servo kẹp là collider** (ruling E67 I4, visual = collider). Hộp `clawServo*` của kit gắn vào body giá kẹp.
  - Không có khối lượng: 22 g của giá kẹp đã gồm servo.
  - Chỉ `setDensity(0)` thì chưa đủ. Rapier cộng mass properties của mọi collider vào body, nên vẫn dựng lại ma trận quán tính rồi chéo hoá lại. Đo được: trục chính của giá kẹp bị hoán vị, các bit cuối lệch, và góc càng khi giữ khối lệch 26,473° → 26,626°.
  - Vì vậy collider mang mass properties **đúng bằng 0** sau khi dời theo offset của nó (khối lượng 0, quán tính 0, tâm khối ở gốc giá kẹp). Rapier bỏ qua phần cộng đó, nên mass properties của giá kẹp trùng từng bit với lúc chưa có vỏ.
  - Tạo sau hai ngón, nên mọi collider khác giữ nguyên handle.
  - IR và cảm biến màu bỏ qua mọi collider của giá kẹp. Vỏ servo nằm trên tia của chúng (w từ 0,4; tia ở w 0).
  - Kết quả: mọi số đã pin của B1–B4 giữ nguyên. Chỉ bốn số đếm collider của test gripper tăng đúng 1 (xem báo cáo B5/B6).
- **Siêu âm bị chắn ở góc tay nào (cho D4).** Tường cách 60 cm, mọi góc kẹp:
  - lift 0–7°: nghe tường;
  - **8–40°: nghe vỏ servo**, đọc 2 cm (mặt sau vỏ cách cảm biến 0,5–1,7 cm, gần hơn 2 cm);
  - **41–52°: nghe giá kẹp**, 2 cm;
  - 53–90°: nghe tường.
  - Cả nón 5 tia sạch bộ gắp ở 0–3° và 56–90°. Ở 4–7° tia thấp nhất chạm nóc vỏ servo ở góc tới > 60°, không có tiếng vọng.
  - **Khi giữ khối 4 cm, chính khối chắn siêu âm ở lift 55–70°** (đọc 3,35–3,74 cm). Sạch ở 0° và ở 80–90°.
  - Vì vậy lời giải mẫu đọc khoảng cách ở tay 0°, hoặc ở 80–90° khi đang giữ. Bài 11 chở ở 55° thì không dùng được siêu âm lúc chở: đi theo vạch hoặc theo thời gian, như §6 đã viết.
- **Ổn định:** các test có giới hạn thay cho quy tắc "không nhô ra ngoài thân" (ADR 0001 §9 addendum).
  - Phanh từ tốc độ tối đa khi giữ 50 g: |pitch| ≤ 0,056°, caster luôn chịu tải (≥ 1,667 N).
  - **Càng đâm tường rồi thả trôi khi chạm: < 8° chỉ đúng ở tốc độ bài học** (duty ≤ 160, mọi tay/tải/kiểu kẹp, lớn nhất 7,71°) **và khi khối chạm trước** (trường hợp của spike: 0,17° / 2,31°).
  - Từ 0,33 m/s, đầu ngón (ma sát 0, trượt lên tường) hoặc càng rỗng chạm trước ở tay 45–90° làm xe ngóc 8,35–17,16°. Xe vẫn hữu hạn và ổn định trong ≤ 0,39 s.
  - Vậy luật `endOnContact` cho tường trên đường càng (ruling G0 wall) là cần thiết. Khi lái tay hoặc chạy bài không có luật đó, học sinh thấy xe ngóc.
  - Motor vẫn đẩy (duty 255): 15,8–18,8°, hữu hạn. Thả trôi thì xe **đứng tựa tường ở 11–16°**, vì ma sát hộp số giữ bánh (như tay servo ở ADR 0001 §9). Lùi ra thì xe về đứng trên bánh và caster (≤ 0,08°).
  - Nâng/hạ tay hết tốc: caster hở ≤ 3,336 mm trong ≤ 11 tick (0,092 s), khi hạ 90 → 0 lúc giữ 50 g.
  - Ruling G0 caster ("tay 90° đâm tường ≤ 3 mm; tay ≤ 45° thì caster chịu tải") chỉ đúng khi khối chạm trước. Đầu ngón chạm trước thì caster hở 5–24 mm.
- **Khởi động** (mục Open của B1/B2): giữ 50 g ở tay 0°, năm sa bàn, trong 0,5 s:
  - duty 102 (40 %) đi 1,37 cm, 128 (50 %) đi 4,43 cm, 160 đi 8,20 cm;
  - ngưỡng khoảng duty 95 (90: 0,009 cm);
  - không cần chỉnh placeholder.
- **Footprint** (`footprint.ts`, D-G8): quét tay ở mọi độ nâng 0..90 (bước 1°) và mọi β của ngón (bước 1°).
  - Mỗi mẫu là các mảnh của `gripper.ts`: hai tấm boom, thanh ngang, giá kẹp, vỏ servo, hai ngón.
  - Mỗi mẫu được nới để phủ các góc ở giữa hai mẫu (cung đầu boom 2·5·sin ¼° = 0,44 mm; ngón như `armSample`; +0,1 mm), và có đáy riêng theo góc nâng đó.
  - Tầm với: collider với xa nhất 15,24 cm, ở tay 40° càng mở; footprint 15,30 cm; kit 16 cm.
  - Test đối chiếu với chính collider của world: ở các góc nằm giữa hai mẫu, mọi góc của mọi collider bộ gắp đều nằm trong một mẫu có đáy không cao hơn nó (2 800 điểm).
  - **Quyết định cần controller xem:** tường, hộp và trụ gặp toàn bộ vùng quét, như tay servo. **Vật (`objects`) chỉ gặp tay gắp ở tư thế setup()** (tay 90°, càng mở), là tư thế world dựng.
    - Lý do: vật là thứ để gắp. Tay servo của rover thì thư viện Servo tự quay tới 90° khi chương trình bắt đầu, còn tay gắp chỉ chuyển động khi chương trình hoặc học sinh ra lệnh.
    - Nhờ vậy xe có thể xuất phát với khối nằm giữa hai ngàm mở, như sandbox teleop của E3 (`robot-run-session.teleop-gripper.test.ts`, `e2e/robot-lab-gripper-ui.entry.ts`). Nếu quét toàn bộ cả với vật thì phải viết lại test đó và 5 e2e.
  - Chi phí (M4 Pro): tính một lần mỗi kit 13,9 ms. Kiểm chỗ đứng trống 0,005 ms. Kiểm một thứ nằm trong vùng quét 0,755 ms.
    - Lần tính 13,9 ms đó chạy **trên main thread khi lab tay gắp mở**: chỉ cần outline (`robotOutlineCm` ở `robot-tools-store.ts`, `TopViewTools`, `FloorPicker`) là đã gọi `robotFootprint`, và hàm này dựng cả 7 189 mẫu. Sau đó cache theo object kit.
    - Chưa đo trên profile máy trường. Controller chuyển số này cho bench của E9 (review B5/B6 M4: giữ code như hiện tại). **E9 đã đo: 55 ms ở CPU 6× và đã bỏ khỏi lúc mở lab (§4.16).**
- **Golden (B6):** thêm 3 fixture world-level vào sau 3 fixture của rover trong `determinismFixtures`: `gripper-pick-place`, `gripper-stack` và `gripper-sensors`. Fixture thứ ba có nhiễu siêu âm ±1 cm theo seed.
  - Hash giống nhau trên Node (bản split và `-compat`, 2 process) và trên Chromium 153, Firefox 155, WebKit 26.6.
  - `engineVersion` vẫn 1. Hash của rover không đổi.
  - Danh sách tên mà test giữ là `determinismFixtures` (đọc từ file fixture, không có list chữ ở `robot-determinism.test.ts:73`). Một test mới pin cả 6 tên.
- **M7 (B2 review 3):** test kẹp ngang ghi đúng trạng thái dừng. Khối 60 g lệch tâm giữ một ngón lún 2,11–2,99 mm khi càng còn được lệnh đóng. Test assert dải đó, ngoài đỉnh 3,82 mm.

### 4.13 Ghi lại khi làm E4 + E5 (bản đồ 2D, overlay 3D, tag; thắng §7 E4/E5 khi mâu thuẫn)

- **Vẽ lại lúc nằm yên (việc của E5 từ review B3/B4 M1):**
  - `sameSensorView` so theo từng kiểu readout. IR so `detected` và `hitId`. Cảm biến màu so `hitId`, `distanceCm` (trong 0,05 cm), có `rgbc` hay chưa, và **tên màu** đọc được (`shownColor` = `classifyColor`, cùng `COLOR_RULES` với `color.is`). Số đếm đổi mà vẫn cùng màu thì không vẽ lại.
  - Đã bỏ shim `NotALineSensor` ở `snapshot.ts`; không chỗ nào khác cần nó.
  - Đo bằng `spikes/n19-b34/redraw-at-rest.test.ts` (đúng lệnh ở đầu file; M4 Pro, load 6–9):
    - kit gripper: overlay 3D đổi 69/70 lần publish → 0, lớp 2D vẽ lại 69 → 0;
    - rover: 0/0 như cũ.
    - Trước khi sửa: khoảng 20 frame WebGL/s và 10 lần vẽ 2D/s lúc nằm yên.
  - Test giữ việc này: `overlays-at-rest.test.ts` (session thật, xe gắp giữ khối đỏ, IR thấy, màu đọc được, 50 publish: 0 lần đổi ở cả 3 view); e2e đếm frame WebGL lúc xe giữ khối nằm yên (như P2 đếm cho rover).
- **Tầm với "theo cos(lift)" (§7 E4)** là cos của **góc boom** = `boomElevationAtLift0Deg` + lift: −40° lúc hạ (3,83 cm), 0° ở tay 40° (5 cm, xa nhất), 50° lúc nâng (3,21 cm). Đây đúng là hình học của world và của view 3D (`gripper-pose.ts`). Lấy cos(lift) theo nghĩa đen thì ở tay 90° ngàm sẽ vẽ dính vào trục, sai.
- **Hoa văn theo màu:**
  - Vùng có `name` red/green/blue dùng hoa văn của màu đó (đỏ sọc ngang, xanh lá lưới, xanh dương chấm to; `zonePatternOf`), thay cho hoa văn theo kind, ở cả thảm 3D ('mat', luma > 0,5) lẫn bản đồ 2D ('screen', ≥ 3:1).
  - Vật cùng màu trên bản đồ 2D có cùng hoa văn ở cỡ vật (khối 4 cm: 3 sọc, lưới 3 × 3, 7 chấm), như mặt trên khối xốp của E7. Vàng không có hoa văn.
  - Chấm to to gấp đôi chấm nhỏ của vùng xuất phát. Vùng khác giữ hoa văn theo kind; rover không có vùng nào có tên nên không đổi.
- **Tag:**
  - Vùng có tên có tag tiếng Việt **bất kể kind**: "Kho", "Vùng thả", "Khu lấy hàng", "Vùng đỏ", "Vùng xanh lá", "Vùng xanh dương", "Vùng xếp" (`robot.zone.tag.*`, vi + en). Bộ `robot.zone.name.*` viết thường vẫn dùng cho câu báo. `zoneLabelOf` dùng chung cho RobotLab, bản đồ 2D và trang gallery E6/E7.
  - Điểm kiểm tra có tên thì hiện cả tên lẫn số.
  - Vật mà goal nêu tên (`object-held`, `object-placed`, `object-on-object` cả trên lẫn dưới, `object-unmoved`, `object-in-zone`) có tag nhỏ hơn (0,8 lần) trên đỉnh vật ("Khối đỏ" kèm chấm màu). Tag đi theo vật, ẩn khi đang giữ và ở "Theo xe". Tên đọc theo lượt đang xem, như chip HUD.
  - Tag vật nằm ngay mũi xe thường bị layout giấu, vì luật R4.7 không cho tag che xe. Đo trong e2e: khối trong càng không có tag lúc đầu, khối ở xa thì có.
- **Overlay 3D của tay gắp:**
  - Một mesh: tia IR dài 2 cm từ mount trên giá kẹp, mờ, sáng lên kèm chấm cuối khi thấy vật; tia màu tới vật (hoặc 4 cm nếu không gặp gì); đốm tô màu đọc được, có viền tối (`#0f172a`, ≥ 3,5:1 với mọi màu bảng màu), chỉ còn viền khi "không rõ".
  - Thêm một tag hai dòng "IR: có vật" / "Màu: đỏ" trên ngàm. Tag tránh HUD, công cụ và tag siêu âm, và ghi vào `labelBoxes` để tag vùng tránh nó; chỉ vẽ lại khi chữ đổi.
  - Thêm 2 draw call, cùng shader program của overlay.
  - Cấp phát mỗi frame trong trường hợp xấu nhất (mọi số đọc đổi mỗi frame): 65,5–67,9 byte/update; rover khoảng 60; giới hạn 96. Trước khi sửa là 722 byte, vì:
    - `classifyColor` khoảng 1,5 KB/lần (object + destructuring `for…of`). Đã viết lại không cấp phát, kết quả giống hệt: test so với bản cũ ở mọi biên của luật và trên 20 000 mẫu;
    - pose của `gripper-pose.ts` 265 byte/lần (double trong field). Overlay tự tính chỗ giá kẹp, chỉ khi tay đổi góc. `poseGripper` của E6 vẫn gọi hàm này mỗi frame có vẽ; ghi cho E9;
    - truyền màu dạng số khi vẽ lại đốm: 48 byte.
- **Bản đồ 2D:** boom, giá kẹp, hai ngàm có viền tối và đệm cao su, vẽ theo `robot.gripper`; vòng tím quanh vật đang giữ; vật tô màu riêng kèm hoa văn; tia IR, đốm màu và tag giống overlay 3D. Rover không có node nào mới.
- **Màu vật theo lượt đang xem** (phán quyết 8, vòng 2):
  - Snapshot của lượt chạy (`RobotRunSnapshot.objectColors`) mang màu từng vật trong arena của chính world lượt đó (`applyVariant`), tức đúng màu cảm biến màu đọc. Field này không thuộc world nên hash không đổi, là cùng một object đông cứng cho mọi lần publish của lượt, và chỉ có khi kịch bản có `variants.objectColors`; rover không có.
  - Các view đọc nó qua `shownObjectColors` (`round-colors.ts`): Chạy, mọi lượt Kiểm tra 1×/4×, lượt mà check để lại trên màn hình, và "Xem lại lượt N". Không chạy gì thì dùng màu của arena (lượt 1). UI không tự tính lại biến thể.
  - Bản đồ 2D tô màu và hoa văn theo nó. View 3D dựng sẵn, cho mỗi vật được biến thể đổi màu, một prop cho mỗi màu nó có (khối của bài phân loại: 3), rồi `paint` chỉ hiện prop của lượt; không dựng lại, không vẽ thêm frame nào lúc nằm yên. Scene dự phòng (hình đơn giản) cũng tô theo nó.
  - Mỗi lượt chỉ có một lần render React. Chip HUD và tag vật vẫn đặt tên theo chỉ số lượt (`variantObjectColors`, cùng hàm mà `applyVariant` dùng), nên khớp với màu tô.
- **Vòng sửa 1 (review E4/E5):**
  - **Mực 2D có lót** (I1, M3). Tia IR màu fuchsia nằm trên chính khối nó thấy, chỉ được khoảng 1:1 trên đỏ, xanh lá, xanh dương. Lót trắng không đủ trên khối vàng (tia 2,81:1, trắng 1,68:1). Vì vậy:
    - tia IR có lót tối `#0f172a`; lúc không thấy gì thì vẽ nét đứt chứ không làm mờ; chấm cuối có viền tối;
    - tia màu, viền đốm và vòng giữ vật có lót trắng; vòng dùng violet-800 `#5b21b6`, vì violet-700 chỉ được 2,53:1 trên thân xe màu cam;
    - test ghép từng mực với lót của nó, trên mọi nền nó có thể gặp: thảm, mọi vùng, băng đen, 5 khối, các phần của xe.
  - **`sameReadout` chỉ so những gì được vẽ** (M1): IR có thấy hay không; tia màu có gặp vật hay không, chứ không so là vật nào.
  - **Chữ của overlay:** "IR: không có vật" (vi), "IR: no object" (en) (M6). Tab chân vẫn dùng chữ ngắn của nó.
  - **Overlay 3D trông gọn hơn:** tia IR bán kính 1,3 mm, chấm 3 mm, tia màu 0,9 mm, đốm 5,5 mm trong vòng 7,2 mm.
  - **Tag hai dòng tránh vùng của ngàm trên màn hình:** từ trên nhìn xuống, mọi chỗ ngay trên ngàm đều che tia và đốm, nên tag thử thêm hai chỗ hai bên.
- **Vòng nhỏ (review E4/E5 lần 2):**
  - **Lót 2D ít nhất 1 px mỗi bên trên màn hình** (N1). Phần lót rộng hơn mực `casingExtraCm(scale)` = `max(0,3 cm, 2 / scale)` (vòng giữ vật: `max(0,4 cm, 2 / scale)`), giống độ rộng tối thiểu theo pixel của hoa văn vật. Áp cho tia IR, tia màu, quầng đốm và vòng giữ vật. Ở 1× trên máy trường, 0,15 cm chỉ khoảng nửa pixel. Test đo trên bản đồ 300 × 200 px (1,6 px/cm) và 1600 × 1000 px.
  - **Kiểm tra frame của overlay 3D dùng đúng màu overlay tô vùng đích** (N2): `overlay.sameView(a, b)` gọi `sameSensorView` với màu của lượt, không có lượt thì màu arena. Trước đó, khi không có lượt, check so vùng đích không có màu, nên một mục tiêu đặt theo màu qua mà không xin frame.
  - Test heap của overlay xe kẹp lấy số nhỏ nhất của 3 lượt đo. Phần cấp phát của chính update như nhau mỗi lượt; worker cấp phát thêm khi máy tải nặng thì chỉ cộng vào.
  - Tia và đốm nằm giữa giá kẹp và khối, dưới servo kẹp, giữa hai ngón. Vì vậy chỉ thấy được khi nhìn từ cao xuống: từ 3/4 phía trước thì khối che, từ bên hông thì ngón che.
- **Cho D4 (đo trong e2e của E4/E5):** hạ tay lên khối 4 cm có tâm cách gốc giá kẹp ≤ 3 cm thì giá kẹp đè lên khối làm khối nghiêng (z 2,34–2,48). Ở 3,5–4,5 cm thì gắp được; ở 3,5 và 4 cm IR thấy khối, ở 4,5 cm thì không (mặt gần ở u 2,5 > 2,3).
- **Pixel rover** (`spikes/n19-e45/results/rover-pixels.txt`): 44 ảnh 3D và 14 ảnh bản đồ 2D có lớp cảm biến, so BASE 0a7a479 với HEAD: trùng bit. Riêng sandbox-high lật giữa hai trạng thái giữa các lần chạy ở cả hai bản; mỗi ảnh HEAD trùng bit một ảnh BASE.
- **Vùng của goal tiếp theo** (concern 3, vòng 2): `nextGoalZoneId` biết `object-placed`. Nó trả về `zone` của goal, hoặc với `zoneByColor` thì trả về vùng ứng với màu của vật trong lượt đang xem. Nhờ đó bài gắp làm sáng vùng thả như bài rover làm sáng vùng đích.
  - `goalZoneIds` là bộ vùng dùng chung cho hai overlay.
  - Vùng theo màu được nhớ theo cặp goal × màu, nên frame callback của overlay 3D không tạo rác: đo 63,9–65,9 byte/update, như trước.
  - Kết quả của rover được ghim bằng bản N18 của hàm, trên mọi bài và mọi trạng thái điểm.

### 4.14 Ghi lại khi làm D4–D8 (bốn bài; thắng §6 và §7 D4–D8 khi mâu thuẫn)

Số đo và lệnh tái lập: `spikes/n19-d4/results.md`. Test: `tests/robot-scenarios.test.ts` (khối "N19 D4"), `check-robot.gripper-lessons.test.ts`,
`check-robot.gripper-challenges.test.ts`, `scoring.hold-kinds.test.ts`, `tests/robot-determinism.test.ts`, `tests/verify-attempt.test.ts`,
e2e `robot-lab-check.spec.ts` (Gate G1). Hướng dẫn soạn: `docs/robot-scenario-authoring.md` mục 11.

- **Số của xe tay gắp placeholder** (khác rover, nên khác chữ của §6): 50 % chạy 13,2 cm/s, 60 % 20,0, 70 % 27,0; quay 50 % khoảng 103°/s, nên
  **830 ms chỉ quay 82°**, lời giải dùng **900 ms (91,5°)**. IR thấy khối khi tâm khối cách giữa thân 12,55 cm; khối đang giữ cách 12,3 cm (tay 0°)
  và 11,65 cm (tay 90°); ở tay 55° đáy khối cao 4,46 cm, trên bệ 4 cm.
- **Khối lệch trục:** lệch ≥ 1,5 cm thì ngón đẩy khối đi 4,8–33 cm và xe đổi hướng tới 9,4° rồi mới gắp được (đo 65 trường hợp, lần nào cũng gắp được). Vì vậy:
  - bài 8 chở theo **khoảng cách tới tường xa** (tay 90° đang giữ: nón sạch), không theo thời gian;
    - **review 1 I1:** bài 8 tiến **50 %** (trước là 70 %) và đặt xuống ở **35 cm** cách tường (trước là 45 cm). Biến thể đặt khối lệch đường
      đi tới 3,3 cm. Ở mức đó siêu âm không nghe thấy khối, và ngón đẩy khối tới x 127 trước khi IR thấy (xe ở x 115). Đặt ở 45 cm thì quãng
      chở dưới 5 cm, bị chấm là đẩy;
    - đo được:
      - 16 góc của khoảng biến thể đều 100 (test Kiểm tra `pickCorners`; một ghim tĩnh giữ độ lệch lớn nhất của khoảng biến thể bằng các góc đó, 3,30 cm);
      - 77 lượt bốc khác (seed 100–159, 1000–8000) đều 100;
      - ba lượt của seed 23 đặt khối ở x 137,3–137,5;
  - bài 10 đặt khối **19 cm** trước giữa thân (lệch 3° còn 1 cm). Ở 32 cm, lượt lệch 2,9° đẩy khối 15,8 cm và lời giải chở thẳng đặt khối ra ngoài vùng xanh lá.
- **Sa bàn đã chốt** (§6 không nói hết):
  - bài 8: vùng y 25–65;
  - bài 9: ba kiện ở y 70, 95, 120 trên vạch y 10–135, kho y 40–125 (kiện rơi khoảng 15 cm phía nam chỗ nó nằm), kệ kho x = 58, y 62,5–102,5, xuất phát y 26 (để lượt dời −6 cm còn vừa tường nam);
  - bài 10: vùng 30 × 30 quanh chỗ khối rơi, vùng đỏ `#fce4e4` (mực hoa văn 3,27 : 1; `#f4cccc` chỉ 2,68 : 1, dưới sàn 2,9 của `zone-pattern.test.ts`), xuất phát xám `#e0e0e0`;
  - bài 11: bệ ở (158, 40), chỗ khối tới khi xe dừng ở cuối vạch (giữa thân x 144,5).
- **Seed** (spike `seeds`, 20 000 seed mỗi bài ở bán kính 16 cm):
  - bài 8 seed 23 (khối +9,3 / −10,0; quay +1,3° / −1,9°);
  - bài 9 seed 430 (dọc vạch −5,4 / +5,1; quay −4,9° / +3,5°);
  - bài 10 seed 8 (−2,3° / +2,9°);
  - bài 11 seed 217 (dọc vạch −12,0 / +9,4; khối +3,5 / −3,7).
  Không seed nào được chọn để né jitter của lời giải mẫu: lời giải qua mọi biến thể nhờ thiết kế ở trên.
- **Guard `no-crash` dùng tag `wall`** ở bài 8, 9, 10, và mọi bài có `endOnContact: ["wall"]`, kể cả bài 11 không có goal canh gác (ruling G0 wall: mọi tường trên đường càng). Ở bài 9 tag `wall` gồm cả kệ kho (tường có tag `kho-wall`) lẫn bốn tường bao, vì một lần chở quá tay ở hàng y 55 hay y 105 đi qua kệ 40 cm và gặp tường tây.
- **Lời giải mù:** bài 8, 9, 11 (bài 10 không có: biến thể là màu). Điểm và trần của mọi exploit: authoring guide mục 11.5; trần = §6, trừ `lower-arm-fully` (35, ruling D4 item B).
  - `open-jaw-sweep-lift` (D2 review N1) không quét được bằng càng mở hẳn: vòng quay hất kiện ra. Càng 10° thì vòng quay ép kiện vào một ngón và ngón gắp nó ở tay 0° (kéo lê), rồi tới kho mới kẹp và nâng 1 cm tại chỗ: 15 / 0 / 15.
- **Review 1 M1, đường đã biết:** đẩy khối vào vùng thả rồi gắp, nâng và chở khoảng 8 cm trong vùng được 100, vì luật chở của §4.5 cho qua (ruling: chấp nhận, vẫn cần gắp, nâng và chở). Có exploit `push-closed-then-lift` (đẩy bằng kẹp đóng rồi nâng tại chỗ, trần 55, đo 55 / 55 / 0). Bài 9 cũng hở như vậy về nguyên tắc. Lựa chọn D2 về sau: lần chở phải bắt đầu ngoài vùng đích.
- **Review 1 M3, cửa sổ nhạy với kit placeholder (VG đo lại):**
  - bài 10: lần quay qua ở 800–1000 ms (±10°);
  - bài 9: lần quay qua ở 800–1000 ms; lần chở qua ở 1200 ms, chở 3200 ms (+1 s) thì đâm kệ.
- **Review 1 M2, M6:** lý do `object-still-held` nói "khi lượt chạy kết thúc", vì nó cũng hiện sau khi lượt kết thúc do chạm. Bốn bài mở với một khối "tay hạ" rời thay cho "robot đi tới 50" của rover.
- **`HOLD_KINDS` (D2 review M8):** `object-held` vào (là một lần giữ); `object-placed` và `object-on-object` chỉ đổi lý do `object-not-at-rest` thành `run-ended-contact`, các lý do khác giữ nguyên. Điểm không đổi. Rover không dùng các kind này.
- **Ruling D4 item B, "hạ hết tay" của bài 11: trần đổi từ 20 thành 35 cho một trong hai cách hiểu.** Plan §6 ghi "hạ hết tay (≤ 20)". Nay là hai exploit:
  - `arm-too-low`: chở ở tay 45°, khối quệt và đẩy bệ. Trần 20, đo được 20.
  - `lower-arm-fully`: hạ tay 0° ở cuối vạch rồi mới mở kẹp. Khối nằm trên bệ, lệch 1,71–1,81 cm (cho phép 1,5); bệ dời 0,04–0,05 cm. Đây là một lần xếp suýt đạt, không xô bệ, nên trần là **35**, bằng `place-beside-base`. Đo được 35 / 35 / 35, test ghim.
  - Không giữ được ở 20 nếu không đổi goal: một `maxMoveCm` < 0,04 cm thì vô nghĩa. Chở ở 0° được 0.
- **Test N18:** các test đếm key được nối thêm bốn key. Test và fixture chỉ dành cho N18 (n19-neutral, golden khung nhìn R4.7, hộp bao của prop pilot, case của pilot, kit rehearsal, hai guard của E5) giữ đúng sáu bài rover. Chín assertion có luật "mọi bài là rover / không có vật" đọc kit của từng key (ruling D4 item A, P1–P9).

### 4.15 Ghi lại khi làm E8 (gallery trên bốn bài thật, nit hình, pixel rover; thắng §7 E8 khi mâu thuẫn)

Lệnh tái lập gallery (một lệnh, tự mở dev server và lesson host trên `--port` và `--port + 1`): `node spikes/n19-e8/gallery.mjs --out=<dir> --port=5542`.
Test: `e2e/robot-lab-gripper-look.spec.ts` (chromium-robot), `tests/color-vision.test.ts`, `TopView2D.tags.test.tsx`, `top-view-tag-layout.test.ts`,
`ground-paint.named-zones.test.ts`, `zone-pattern.lessons.test.ts`, `parts/robot-assembly.deck.test.ts`, `parts/sensor-overlay.quiet-ray.test.ts`.

- **Mốc chụp** (`e2e/gripper-moments.ts`): lời giải mẫu chạy bằng Bước (0,1 s mô phỏng mỗi lần, run tạm dừng, không chờ theo đồng hồ) tới start,
  approach (bài 9, 11: đi theo vạch, chưa thấy vật), grasp (bước đầu tiên kẹp đã đóng trên vật, tay còn hạ), carry, release (bài 11). Thời điểm lấy
  từ trace 0,1 s của chính lời giải (`spikes/n19-e8/moments.test.ts`). Bài 8 sau fix round D4 (tiếp cận 50 %, thả cách tường 35 cm): grasp 3,7 s,
  carry 5,0 s. Mỗi ảnh được kiểm với world của mốc (vật giữ, góc tay, góc kẹp, vị trí vật trong 0,05 cm, hướng xe trong 1°).
- **Lượt 2 và 3 của bài 10** (khối đỏ, xanh dương) xem như lab xem một lượt Kiểm tra: Kiểm tra (Nhanh) lời giải mẫu giữ kẹp tới hết
  (`holdAtEnd`: khối `put-open` đổi thành "kẹp đóng", để lượt nào cũng trượt và có "Xem lại"), Xem lại, Tạm dừng, Đặt lại robot, rồi Bước. Mọi
  khối trước đó là của lời giải mẫu, nên world tới 5,7 s là của lời giải mẫu (spec so với trace).
- **Camera của gallery:** dev server chạy StrictMode, `useMemo` của CameraRig tạo RigControls hai lần, và cái bị bỏ vẫn nối với canvas. Kéo chuột
  để pan vì vậy bị áp hai lần quanh hai target và xoay camera (đo: 1,85° azimuth cho 25 px ở 2,1 m; `_pan` của một controls gọi riêng giữ nguyên
  góc). Production chỉ có một. Close-up "Tự do" vì vậy dịch camera và target của chính controls của rig (đúng như một lần pan). Xoay và zoom
  bằng phím camera của rig, chờ 2 frame sau mỗi phím. Hai lần chạy cho ảnh trùng từng bit.
- **Mù màu:** ma trận Machado, Oliveira, Fernandes 2009, severity 1.0, trên linear RGB (`e2e/color-vision.ts`).
  - Test nhận ra mark của khối trên bản đồ 2D ở DPR 3. Chỉ đọc hai layer đầu (thảm và vật), vì overlay cảm biến (cạnh nón siêu âm, đốm màu)
    nằm đè lên khối. Mask Otsu 33 × 33 ô, mỗi ô 1 mm, trên mặt khối, so với hình riêng của ba mark (geometry `markPattern`, nét
    `max(width, 1,5 px)` như bản đồ vẽ), không phụ thuộc lớp nào là mực.
  - Đo trên chromium-robot (như nhau ở thường, deuteranopia, protanopia ± 0,004): xanh lá → lưới 0,871 (mark kế 0,588), đỏ → sọc 0,787
    (0,524), xanh dương → chấm 0,857 (0,591). Test đòi ≥ 0,75, cách mark kế ≥ 0,15, và ba mark khác nhau.
  - Đột biến (xanh lá = sọc): khối xanh lá đọc ra sọc 0,907, test trượt ("3 mark", nhận 2).
  - Fill đỏ và xanh lá dưới deuteranopia là (139, 124, 40) và (134, 122, 66), tương phản 1,03:1: màu không đủ, mark thì đủ.
- **Nit từ review E6/E7 lần 2:**
  - **Vệt buzzer ở mức low (N3).** AO trên mặt deck dưới bo buzzer 2 cm của rover là 0,50 ở mọi đỉnh (sàn của bake). Mặt deck trống là 1,00, ở cả
    hai mức (`spikes/n19-e8/deck-ao.test.ts`). Kit không có buzzer ở chỗ đó thì `unshadeDeck` đặt bóng của deck trống (1) trên bản sao geometry.
    Asset N18 không đổi, rover không đổi.
  - **Trục boom (N1).** Đã cắt: xem §4.9. Build lại root N19: robot-kit −44 B, robot-kit-low −24 B, props trùng byte, root N18 vẫn đóng băng.
- **Nit từ review E4/E5:**
  - **Tag 2D "IR/Màu" (M4).** `top-view-tag-layout.ts` thử bốn phía của đầu ngàm: phía trước ngàm (gần hướng xe nhất trên màn hình), bên phải
    xe, bên trái, phía sau. Lấy phía đầu tiên mà tag không đè hộp xe (thân và ngón), vòng giữ vật, tag khoảng cách, và còn trong bản đồ. Bên
    hông ngàm, tag đứng ngoài hộp xe 3 px.
    - Lỗi E4 kèm theo: `offsetX(width / 2)` trên Konva Label (gốc của Label là đầu pointer) làm tag lệch nửa tag sang trái, nằm trên xe. Tag
      khoảng cách của N18 lệch giống vậy và giữ nguyên, vì pixel rover phải trùng.
  - **Chữ vùng trên bản đồ 2D.** Không bao giờ vẽ đè vật, vòng hay xe: chữ được vẽ vào ảnh thảm ở layer 1, còn vật, vòng và xe ở layer 2 (có
    test). M5: tên vùng có `name` chuyển ra mép ngoài, bên trong vùng: mép trên hay mép dưới, mép nào xa giữa sa bàn hơn (bằng nhau thì mép trên), vì xe vào
    vùng từ phía giữa sa bàn. Vùng xanh dương của bài 10 vì vậy ghi tên ở mép dưới: xe và tag của nó vào từ mép trên. Vùng không tên (mọi bài rover)
    giữ chữ ở giữa.
  - **M6.** Không bài nào có cả cross-hatch của `area` và lưới (có test). Bài 8 có area mà không có xanh lá; bài 10 có xanh lá mà không có area.
    Bài 11 có hatch 45° (vùng xếp) cạnh khối đỏ sọc 0°, nhưng không có việc nào cần phân màu, nên không đổi.
  - **Tia màu 3D khi không gặp gì.** Trước đó là slate đậm ở 30 %: 1,02:1 trên băng đen. Nay là slate-500 `#64748b` ở 90 %: ≥ 3:1 trên băng,
    thảm và mọi vùng của các bài.
  - **Tia IR 3D nhìn từ trên.** Vỏ servo chỉ che 1,8 mm đầu của tia 2 cm. Phần còn lại bị tia trục siêu âm che: tia này ở trên đường giữa
    ngàm, cao hơn 4 cm. Khi IR "quiet" (alpha 0,35, test E5 ghim), tia mờ theo thiết kế. Khi IR thấy vật (0,95), tia và đốm màu đều thấy rõ
    (ảnh `*-grasp-above-close`). Không đổi.
- **Thêm: tag 3D của tay gắp và tag khoảng cách.** Ở "Theo xe" lúc chở, tag hai dòng nằm dưới tag khoảng cách hoặc dưới HUD (E5 đặt tag tay
  gắp sau cùng, và nó chỉ có vài chỗ quanh ngàm). Nay tag tay gắp được đặt trước. Tag khoảng cách tránh nó, và có thêm 4 chỗ trên và hai bên
  echo (một echo ngắn, như khối đang giữ ở 3,8 cm, đặt mọi chỗ dọc tia ngay bên ngàm). Rover không có tag tay gắp, nên tag khoảng cách của nó đặt
  như cũ.
- **Bản đồ 2D: HUD che góc trên bên trái.** Ở bài 10 lượt 2, lúc 3,9 s, xe và khối đỏ ở góc đó nên bị HUD che. Fit của bản đồ là của rover
  (pixel rover phải trùng) nên không đổi. Ghi lại cho owner (học sinh thu "Mục tiêu" lại được). Gallery cắt ảnh quanh xe từ chính layer của bản
  đồ, không có HUD; ảnh cả bản đồ thì vẫn như học sinh thấy.
- **Pixel rover:** BASE df7c327 so với HEAD, build production. 44 ảnh 3D và 14 ảnh 2D trùng bit; lần này sandbox-high cùng trạng thái ở cả hai
  bản (`spikes/n19-e8/results/rover-pixels.txt`).
- **Fix round 1 (review `e8-review-1.md`):**
  - **F1, tag 3D "IR/Màu" che ngàm ở "Theo xe".** Hộp của ngàm dừng ở +2,6 cm, chưa có vỏ servo kẹp. Nay tag tránh ba hộp trên màn hình, mỗi
    hộp thêm 6 px: hộp ngàm (có vỏ servo kẹp), vật đang giữ (hoặc vật IR hay cảm biến màu đang thấy), và vật gần đầu ngàm nhất (trong
    10 cm). Tag có thêm 4 chỗ cao hơn và xa hơn. Không chỗ nào sạch thì tag ẩn (`gripperTagLayout` cho E2E đọc). Mốc approach thêm cho bài 8
    (3,2 s) và bài 10 (0,6 s). Spec kiểm ở camera của lab ("Tự do" lúc start, "Theo xe" mặc định ở mốc khác, không xoay lại): hộp tag không
    chạm hộp nào. Gallery chụp thêm "Theo xe" mặc định ở approach và grasp của cả bốn bài, hai mức. Bảng index ghi, cho mỗi ảnh 3D, tag nào
    đã tránh được.
  - **Tag khoảng cách của xe gắp (minor).** Tag nay cao 2,5 cm trên echo, thay cho 7 cm (siêu âm gắn trên deck, nên 7 cm nổi cao hơn ngàm
    nhiều). Tag cũng tránh ba hộp trên, rồi thử thêm 3 chỗ xa hơn. Không chỗ nào sạch thì tag đứng ở đầu tia, chỉ gặp ở close-up nhìn thẳng
    từ trên lúc approach của bài 8 và 10. Rover giữ 7 cm và cách đặt cũ.
  - **F2, 2D vẽ khối chồng dưới bệ.** Vật trên bản đồ vẽ theo đáy của nó (cm, làm tròn), cùng độ cao thì giữ thứ tự sa bàn.
    `zIndex` chỉ đổi khi thứ tự đổi, không cấp phát, mảng làm sẵn. Mọi vật của rover nằm trên sàn, nên thứ tự như cũ.
  - **F3, chữ "Kho" dưới HUD (bài 9).** Bản đồ đo HUD như view 3D (`hud-corner.ts`). Tên vùng có `name` đứng ở mép ngoài, mép kia nếu mép
    ngoài bị che, giữa vùng nếu cả hai bị che. `paintGround` nhận vùng bị che, và trả lại tên đã vẽ (`readTopViewMat`). Bài không có vùng tên
    (rover) vẽ thảm như cũ. Vùng đỏ của bài 10 bị HUD che hết, nên tên ở giữa (đã trong danh sách của owner).
  - **F4, tag 3D của vùng tên đâm vào vật ở giữa vùng.** Vùng có `name` và có vật đứng trong lúc đầu: chân dây của tag ra mép ngoài, cùng
    quy tắc với 2D (`outerEdgeIsBottom`). Chân dây vào trong max(3 cm, 15 % chiều sâu vùng) và cách mọi footprint ít nhất 1 cm. Nếu chỗ đó
    vẫn chạm vật thì dùng mép kia. Vùng không có vật vẫn để tag ở giữa: test E5 ghim [45, 4]. Khung "Tự do" vẫn tính chỗ cho tag ở giữa vùng
    (`camera-studio.ts`). Chân dây mới vẫn nằm trong vùng, nên khung không đổi.
  - **Swatch kiện hàng (minor).** Kiện hàng không có màu vẫn có viền không fill. Bên trong vẽ thêm thùng carton (`#c49a68`) và băng keo
    (`#9a6a35`) như prop 3D. Kiện hàng không có màu và không có mark mù màu.
  - **Mù màu (minor, M2).** Trên bản đồ, phần của tay gắp nằm trên khối đang giữ (một dải xanh giữa mặt khối) là màu thứ ba. Ngưỡng hai lớp
    lúc thì lấy dải đó làm mực, lúc thì không. Vì vậy gallery (GPU) đọc ra một dải dưới protanopia, còn spec (SwiftShader) đọc ra ba sọc.
    - Nay chỉ đọc những ô là của mặt khối (`faceCells`): fill, mực và màu pha giữa hai màu đó. Đo mới: lưới 0,871, sọc 0,874–0,884, chấm 0,917.
      Mark kế kém hơn 0,28–0,35. Ô của mặt khối chiếm 85–100 %.
    - Đột biến (xanh lá = sọc) vẫn làm test trượt.
    - Fill dưới deuteranopia lấy từ màu bản đồ đã vẽ (màu của mặt khối mà node gọi là fill), không lấy hằng số palette.
    - Gallery đọc đúng 33 × 33 ô như spec, trên bản đồ DPR 3 cùng cỡ 1280 × 720 như spec, nên kết quả khớp với test.
- **Fix round 2 (review `e8-review-2.md`, phán quyết của controller):**
  - **Sửa lại review 1.** Ở grasp, trong "Theo xe", chính deck của xe che ngàm và vật trong khoảng 12 cm trước đầu ngàm. Tag ở grasp vì vậy
    không che hành động.
  - **R1, tag cảm biến che vật mà xe đang tới.** Cả hai view dùng một luật: tag không đè vật nào.
    - 3D: tránh mọi vật đang trong khung hình, mỗi vật thêm 6 px. Fix round 1 chỉ tránh vật đang giữ hoặc đang thấy, và vật trong 10 cm
      quanh đầu ngàm, mà deck đã che mất.
    - 2D: tránh mọi vật trên bản đồ. Riêng vật đang giữ thì đã có vòng giữ tránh rồi.
    - Tag khoảng cách của xe gắp cũng tránh các vật đó. Nó luôn có các chỗ hai bên và phía trên echo, kể cả khi tag cảm biến bị ẩn. Không chỗ
      nào sạch thì ẩn, như tag cảm biến. Rover vẫn đặt tag ở echo như N18.
    - Probe đưa hộp của mọi vật. Spec kiểm ở mọi mốc, cả hai view, rằng tag cảm biến không chạm hộp nào. Trên code fix round 1, kiểm này
      trượt ở approach của bài 11, cả 3D high, 3D low và 2D (`spikes/n19-e8/results/r1-before.txt`).
    - Layout tag 2D không còn cấp phát (M1). Riêng hộp của tag khoảng cách vẫn do Konva tạo.
  - **R2, tag "Bệ vàng" mọc ra từ khối chồng.** Tag của một vật ẩn khi có vật khác nằm trên nó: đáy vật trên cách đỉnh vật dưới không quá
    0,5 cm, và hai footprint chạm nhau (`restedOn`, không cấp phát). Khi một vật vừa nằm lên vật khác, layout tag chạy lại.
  - **Concern 2, luật vùng.** Mọi vùng có `name` đều đặt chân dây ở mép ngoài, như 2D, inset không quá nửa chiều sâu vùng, và vẫn kiểm
    footprint. Controller cho đổi pin [45, 4] của E5 (vùng tên tổng hợp, chỉ của tay gắp) thành [45, 3]. Mốc release mới ở lượt 1 của bài
    10 (6,1 s): khối nằm ở giữa vùng xanh lá, dây của tag vùng không còn rơi lên khối. Vùng của rover không có tên, nên không đổi.

### 4.16 Ghi lại khi làm E9 + E10 (bench máy trường, hai sửa hiệu năng, e2e trên bài thật; thắng §7 E9/E10 khi mâu thuẫn)

Số đo, lệnh và tải máy: `spikes/n19-e9/results.md` và `results/`. M4 Pro 12 nhân, Chromium 153, nhánh trên master 7758ec9 (D4 sau vòng sửa 1). Test: `parts/robot-assembly.gripper.allocation.test.ts`, `parts/robot-assembly.gripper.rest.test.ts`, `gripper-pose.test.ts`, `world/robot/footprint.outline.test.ts`, `tests/bench-robot.test.ts` (một `it` mới), e2e `robot-lab-gripper.spec.ts`.

- **Hai sửa hiệu năng, hình và kết quả không đổi** (mười ảnh 3D ở cả hai tier trùng từng bit với D4: `results/pose-pixels.txt`):
  - **`poseGripper`** (E4/E5 concern 2). Số 265 B/lần là của interpreter lúc code còn nguội. Khi V8 đã tối ưu thì `gripperPoseInto` vẫn cấp 33 B/lần, vì `const [px, py, pz] = gripper.position` lấy iterator của mảng: đọc theo chỉ số thì còn 0,5–1,8 B (sàn của phép đo 1,1). Cộng thêm: tay và kẹp đứng yên so với frame trước (`posedFor`) thì không tính gì và không ghi node nào, nên lúc nằm yên không có số học nào để bị box, ở tầng JIT nào cũng vậy (lúc nguội mất 150–265 B/lần). Khi tay đang chạy, việc có cấp phát hay không (0 hoặc 16–32 B/lần) tuỳ V8 có inline setter của three hay không, đổi theo từng lần chạy; test chặn ở 96 B như overlay. `RobotView.tsx` (cảnh dự phòng) cũng bỏ destructuring mảng.
  - **Outline của lab** (B5/B6 M4). `robotOutlineCm` gọi `robotFootprint(kit)` nên lúc mở lab bài gắp phải quét 7 189 mẫu: **55,2 ms (52,7–59,0) ở CPU 6×**, một long task trước first paint (rover 7,1 ms). Nay `robotOutline(kit)` chỉ tính bao lồi của thân và bánh: **1,8 ms (0,7–3,3)**, đúng cùng mảng (`robotFootprint(kit).outlineCm` là chính nó). Cú quét (55,0 ms) **dời chứ chưa bỏ**, vẫn là một task: nó rơi vào lần `createScenarioWorld` đầu tiên, tức `preparePhysics` lúc rảnh (sau khi lab được dùng và view đã lên, `RobotLab.tsx`), hoặc vào Chạy / Kiểm tra đầu tiên nếu học sinh bấm trước khi `preparePhysics` kịp chạy, hoặc vào lần kiểm chỗ đặt đầu tiên. Bench không thấy task nào > 100 ms và Chạy lần đầu → chuyển động chỉ 126–131 ms (≤ 300), nên ngân sách giữ; bench chỉ đếm task > 100 ms, nên chưa biết task đó còn ≥ 50 ms trên máy trường thật hay không. Nếu sau này cần “không task nào từ 50 ms” lúc mở lab thì cắt cú quét thành từng lát hoặc dựng trong idle callback.
- **Bench trường học** (`bench:robot3d --profile=school`: SwiftShader, tier thấp, CPU 6×, 1366×768; 4 bài + Kiểm tra 4× bài phân loại, 3 lượt; rover chạy xen kẽ master/nhánh hai lần, 2 lượt mỗi lần; tải trước mỗi lần chạy 5,7–6,5):

| chỉ số | ngân sách / mục tiêu | rover master 7758ec9 | rover nhánh E9 | bốn bài gắp, phase A (7758ec9) | **bốn bài gắp, phase B (8760350, bản cuối)** |
|---|---|---|---|---|---|
| fps (trung vị khung), school | ≥ 50 ở gpu-high (school chỉ để biết) | 59,9–60,2 | 59,9–60,2 | 59,5–60,2 | 59,5–60,2 |
| **fps trung vị, gpu-high** | **≥ 50** | — | — | chưa đo | **59,9–60,2 (đạt)**; p95 khung 17,3–18,5 ms (mục tiêu ≤ 20) |
| p95 khung khi chạy, school | ≤ 33 ms (mục tiêu) | 19,0–20,7 | 19,2–20,6 | 19,8–20,5 (fps), 20,4–21,4 (profile) | 19,4–19,9 (fps), 19,9–21,1 (profile) |
| long task > 100 ms | 0 | 0 | 0 | 0 | 0 (cả ba profile) |
| Chạy → robot chuyển động (đã ấm), school | ≤ 300 ms | 43–44 | 42–44 | 77–83 (tính cả khi boom quay) | 71–75 |
| Chạy lần đầu → chuyển động, school | để biết | 83–85 | 80–85 | 126–131 | 118–128 |
| khung đầu, school | ≤ 2,5 s (mục tiêu, chưa đạt từ N18) | 2,56–2,62 s | 2,54–2,62 s | 2,54–2,59 s (lượt nguội đầu 4,09 s) | 2,48–2,66 s (lượt nguội đầu 4,08 s) |
| sim ms/khung (2 tick/khung, CPU 6×) | physics ≤ 0,5 ms/tick | 1,69–1,96 | 1,69–1,96 | 3,43–3,63 | 3,29–3,45 (≈ 0,28 ms/tick sau khi chia 6; rover ≈ 0,15) |
| cấp phát JS (KB/khung) | — | 120–170 | 121–170 | 227–235 | 223–236 |
| khung vẽ/giây lúc rảnh và lúc nằm yên, cả ba profile | 0 | 0 / 0 | 0 / 0 | 0 / 0, 0, 0 và **10 (bài xếp chồng)** | **0 / 0 ở cả bốn bài** (B7; 27 giá trị mỗi profile đều 0) |
| Kiểm tra 4×, school: p95 khung, p5 fps | ≤ 33 ms (mục tiêu) | 20,4–21,0 ms, 47,6–49,0 | 20,5–20,7 ms, 48,3–48,8 | 30,9–34,5 ms, 29,0–32,4 (tải 8–13) | **30,8–31,8 ms, 31,4–32,5 (đạt 33 ms; tải trước lượt chạy 4,1, trong lượt 6,3–8,2)** |
| Kiểm tra 4×: task dài ≥ 50 ms (số task, dài nhất; không có task > 100 ms) | 0 task > 100 ms | school fps pass: 0; có profiler: 3–4 task, 79–86 ms | fps pass: 0; có profiler: 3–4 task, 81–85 ms | school fps pass: 2–3 task, 68–79 ms; có profiler: 3–4 task, 80–93 ms | school fps pass: 2 task, 64–78 ms; có profiler: 2–3 task, 76–83 ms; ss-low-4x: fps pass 0, có profiler 1 task, 50–60 ms; gpu-high: 0 |
| **ss-low-4x: p5 fps mỗi bài** | **≥ 30** (CPU 4×, tier thấp) | — | — | chưa đo | **51,5–54,3 (đạt)** |
| **ss-low-4x: Chạy lần đầu → chuyển động** | **≤ 1 500 ms** | — | — | chưa đo | **tối đa 87 ms (đạt)**; Chạy đã ấm tối đa 51 ms (≤ 300) |
| **ss-low-4x: p5 fps của Kiểm tra 4× (`rb-grip-check-4x`)** | **≥ 30** (CPU 4×) | — | — | chưa đo | **37,5–44,1 (đạt)**; p95 khung 22,7–26,7 ms |
| Kiểm tra headless (`bench:robot`, CPU) | 10 s mỗi 3 × 60 s mô phỏng | — | — | nhặt 2,03 s (≤ 5), giao 6,09 (≤ 15), phân loại 1,82 (≤ 5), xếp 2,94 (≤ 7,5) | nhặt 1,95 s, giao 5,84, phân loại 1,80, xếp 2,79: đạt cả bốn |
| tick avoider / line follower, trung vị | ≤ 0,5 ms | 0,090 / 0,119–0,120 | 0,088–0,090 / 0,123–0,125 | — | 0,088 / 0,117 (tải 3,5; tính cùng bản cuối) |

  - **Phase B** (bench cuối của fix round 1, master 8760350 = N19 cuối, sau E8 và B7; bản dựng production một lần, dùng chung cho ba profile; mỗi lần chạy bắt đầu ở tải 1 phút 3,2 / 3,9 / 4,1, đều ≤ 6; `uptime` trong `results/phase-b-driver-log.txt`): `ss-low-4x`, `gpu-high` và `school`, bài gắp + Kiểm tra 4× bài phân loại, 3 lượt, cả hai pass. **Mọi dòng ngân sách đều đạt, cả ba lần chạy thoát với mã 0.** Dòng mục tiêu duy nhất chưa đạt là khung đầu ≤ 2,5 s (như từ N18).
  - Rover chạy lại trên bản cuối ở school (idle, drive-to-zone, line-follow, mini-mission, check-4x, teleop, 2 lượt): trong khoảng nhiễu và nhỉnh hơn một chút so với phase A (fps 59,9–60,2, p95 khung 18,8–20,4, Chạy → chuyển động 41, sim 1,59–1,66 ms/khung, cấp phát 133–171 KB/khung): `results/phase-b-rover-compare.txt`.

  - Rover trong khoảng nhiễu ở mọi dòng: khác biệt duy nhất đều đặn là trung vị tick của line follower trong `bench:robot` cao hơn 0,004 ms (3 %) ở cả hai vòng xen kẽ, không đường nào của tick bị đụng tới.
  - `bench:robot --gripper` thêm bốn dòng kiểm tra headless (mặc định vẫn đúng 19 dòng của rover, vì `tests/bench-robot.test.ts` ghim bảng đó và dòng usage). `bench:robot3d` thêm `rb-grip-pick|deliver|sort|stack`, `rb-grip-check-4x`, `--scenarios=gripper`, `--profile`; "Chạy → chuyển động" của xe gắp tính cả lúc boom bắt đầu quay (chương trình hạ tay ngay rồi chờ 300 ms mới chạy), rover không có boom nên số không đổi.
- **GLB so với §3** (byte thô, trước N19 = 3025a0a^): kit +101 416 (≤ 120 000), kit thấp +65 448 (≤ 70 000), props +73 068 (≤ 80 000), props thấp +47 700 (≤ 50 000). Chunk RobotLab 414,6 kB gzip (≤ 600), wasm 1,18 MB gzip (≤ 1,3 MB).
- **Còn mở, cần controller quyết:**
  - **Bài xếp chồng nằm yên vẽ 10 khung/giây (phase A): đã đóng bởi B7** (§4.17). Phase B đo lại ở cả ba profile: 0 khung/giây lúc nằm yên ở cả bốn bài, dòng ngân sách `draws per second at rest` đạt. Chẩn đoán gốc (xe còn quay 0,01°/s, session coi là nằm yên, `SAME_QUAT` 1e-5 bị vượt ở mỗi lần publish) giữ ở `results/rest-draws.txt`.
  - **Xe giữ khối trong lái tay vẽ một cặp khung mỗi 4,55 s** (0,44 khung/giây), do xe trôi yaw vài phần triệu rad/s qua cùng ngưỡng. Nhỏ, ghi để biết (`results/gripper-ui-pass-rates.txt`).
  - **Kiểm tra 4× của bài gắp nặng hơn rover** (đã đo lại ở phase B, máy yên): p95 khung ở school 30,8–31,8 ms (mục tiêu ≤ 33: đạt; ở phase A, tải 8–13, là 30,9–34,5), p5 fps 31,4–32,5; ở ss-low-4x p5 fps 37,5–44,1 (≥ 30: đạt). Rover: 20,5 ms. Lý do vẫn nặng hơn: mỗi khung chạy 8 tick của world có khớp và 3 cảm biến thêm (sim 8,2 ms/khung ở CPU 6×, rover 3,4). Nó có 2 task dài 64–78 ms ở school (rover: 0 ở fps pass). **Nguyên nhân đã chứng minh** bằng `spikes/n19-e9/check-long-tasks.mjs` (`results/check-long-tasks.txt`, bản production, CPU 6×): sau khi engine đã lên, đúng một task 57–68 ms nằm ngay trước lúc nhãn "Lượt 2/3" đổi (lúc bắt đầu lượt 2: một world gripper dựng 7–8 ms, khoảng 42–49 ms ở CPU 6×, cộng biên dịch chương trình và virtual UNO); rover không có task nào ở lượt 2 và 3; ở CPU 4× bài gắp cũng không (≈ 28–33 ms, dưới 50). Lượt đầu thêm các task nạp engine lần đầu (270–490 ms) khi chưa ai làm ấm nó; bench làm ấm engine từ trước. Không task nào > 100 ms trong bench. Lượt 3 không có task ≥ 50 ms (code đã nóng).
- **E10** (`e2e/robot-lab-gripper.spec.ts`, bài thật qua `?template=<key>`, đọc chương trình từ `robotSolutions`, không ghim hash): Chạy bài nhặt (chip "Đang giữ: khối vàng" lên rồi mất; câu báo "Đã gắp"/"Đã thả"; khối vào vùng thả), Kiểm tra Nhanh (100/100 và ba dòng mục tiêu; `push-in` được 15/100 với "Khối vàng bị đẩy chứ không được gắp lúc …"), Kiểm tra 4× (không câu báo gắp/thả, không Lái tay, phím không làm gì: hash thế giới từng lượt bằng Kiểm tra không phím), Q/E/R/F, Xem lại lượt 2 và 3 của bài phân loại (chương trình mẫu đổi trái/phải: bản đồ 2D, prop 3D, tag, chip, vùng sáng đều theo màu lượt; sọc/lưới/chấm), không WebGL (Chromium và Firefox). Prop 3D đọc từ trạng thái scene qua reader mới `arena-props-state.ts` (cùng kiểu `zone-tags-state.ts`). Hai ghi chú: câu "Đã thả" có thể đến sau "Chương trình đã chạy xong" ở 4× (cửa sổ 1,5 s của `GRIP_INTERVAL_MS`); một "Xem lại" gập thẻ kết quả nên phải mở lại để bấm lượt tiếp.
- **Spec `robot-lab-gripper-ui.spec.ts` hết chập chờn khi tải** (không đổi giá trị assertion nào; `--repeat-each` trước/sau ở `results/gripper-ui-pass-rates.txt`): thử đợi tay hạ tới 60° bằng cách chờ `> 59,5` khi tay đi từ 90 xuống (đúng ngay từ đầu; nay chờ `< 60,5` rồi kiểm `> 59,5`); thẻ khối xanh đọc một lần ngay sau khi gắp (nay chờ); và cửa sổ "nằm yên không vẽ" tính theo giây thật (nay theo đồng hồ thế giới, bắt đầu 0,3 s sau cặp khung trôi yaw). Trước: 47/50 ở 4 worker, 97/100 và 98/100 ở 5–6 worker; sau: 100/100 hai lần ở tải 7–32.
- **Test cấp phát của `poseGripper` (fix round 1, phase B).** Một lần đọc 128 B dưới `pnpm verify` đầy tải (ba lượt đo đều đọc cao: tầng JIT đến muộn), qua 5/5 khi chạy riêng. `least(work, bound)` nay lấy lượt nhỏ nhất của tối đa tám lượt 20 000 lần gọi, dừng ở lượt đầu nằm trong ngưỡng (mỗi lượt sau là 20 000 lần khởi động thêm); ngưỡng vẫn 8 B (nằm yên, `gripperPoseInto`) và 96 B (tay đang chạy). Cấp phát thật vẫn trượt: tiêm ba mảng ba số mỗi lần gọi vào `poseGripper` (288 B) làm trượt cả hai test của nó ở cả hai tier (trên đường nằm yên và trên đường tay chạy), và một test đối chứng mới ("the measure sees a real allocation") giữ rằng phép đo đọc > 96 B ở mọi lượt cho một cấp phát như vậy.

### 4.17 Ghi lại khi làm B7 (xe tay gắp không quay khi đứng yên; thắng §4.4 và §4.6 khi mâu thuẫn)

Số đo và lệnh tái lập: `spikes/n19-b7/results.md`. Code: `world/robot/gripper.ts` (đầu file), `assembly.ts` (`carStill`). Test: `world/robot/gripper.rest.test.ts`, `run/robot-run-session.gripper-rest.test.ts`, `ui/robot3d/stack-at-rest.test.ts`.

- **Triệu chứng (E9, e910-report concern 1).**
  - Sau `stop` của lời giải mẫu rb-grip-stack, xe quay 0,0102 °/s.
  - Mỗi lần publish đổi quaternion khoảng 9e-6, vượt `SAME_QUAT` 1e-5, nên scene 3D vẽ 10 frame/s khi nhìn như đứng yên.
  - Đo lại ở world (run session, headless): −1,015e-2 °/s ở cả ba biến thể. Xe chỉ chạm sàn.
- **Không phải năm nghi phạm của brief.** Gỡ từng cái, hay chỉ giữ một cái và gỡ bốn cái kia: vẫn −0,98e-2 đến −1,21e-2 °/s.
  - Không cho ngủ: chassis của **cả hai kit** đều `setCanSleep(false)`, nên rover không đứng yên nhờ ngủ.
  - Làm mới contact bi đỡ mỗi tick.
  - `LINK_HOLD_NM`: không có trong production; khoá AngZ của §4.6 thay cho nó.
  - Chạm bệ/khối: không có lúc cuối.
  - Ma sát và lực drive khi thả trôi.
- **Nguyên nhân: motor của servo nâng gánh trọng lượng boom khi đứng yên.**
  - Motor khớp là ràng buộc vận tốc mềm. Khi đứng yên nó không bao giờ thoả: luật hãm đòi error/dt, khoảng 0,03 rad/s ở 55°, trong khi boom đứng im.
  - Phần lời giải PGS còn sót mỗi bước lọt vào yaw của chassis, mà yaw chỉ được ma sát hai bi đỡ giữ.
  - Đo trên cùng trạng thái cuối bài, đổi chỗ boom được giữ:

    | Thay đổi | yaw (°/s) |
    |---|---:|
    | boom giữ bằng giới hạn khớp đóng ở góc hiện tại, motor tắt | **6,5e-6** |
    | motor vị trí thay motor vận tốc | −1,035e-2 (như cũ) |
    | motor vận tốc mục tiêu 0 (giảm chấn thuần) | −1,030e-2 (như cũ) |
    | đặt vận tốc mọi body về 0 | quay lại ngay trong tick sau |
    | solver 8 / 16 vòng | ×0,64 / ×0,35 |
    | bỏ vòng lặp thêm của bộ gắp | ×31 |

  - Ba bài kia kết thúc ở lift 0°, boom tựa chặn của khớp, nên không quay.
  - Trên sàn phẳng không có lịch sử, tay ở 10–70° quay 1,2e-4–2,5e-4 °/s. Cuối bài stack lớn hơn khoảng 60 lần: phụ thuộc trạng thái solver của lượt chạy. Phần này chưa giải thích được khi không có source Rapier.
- **Sửa: servo giữ khi xe nằm yên (chỉ kit gripper).**
  - **Khi nào giữ.** Khi đủ mọi điều kiện, liên tục 1 s (`LIFT_HOLD_TICKS` 120):
    - xe đứng trên ba điểm tựa (hai bi đỡ và caster chạm sàn);
    - drive dừng (thả trôi hoặc phanh);
    - chassis chậm hơn 0,1 cm/s và 0,57 °/s;
    - lệnh lift và claw không đổi;
    - boom ở lệnh trong 0,1° và quay chậm hơn 0,01 rad/s.
  - **Giữ thế nào.** Giới hạn của khớp boom đóng lại ở góc nó đang đứng, motor tắt: servo đứng ở đích với tải dưới mô-men kẹt thì không chạy.
    - Đang giữ vật thì hai ngón cũng giữ như vậy. Motor ngón lúc đó chỉ chỉnh ngón theo mặt vật mỗi tick (luật 3), và rò thẳng vào yaw qua khớp quay quanh trục đứng: 1,3e-4 °/s, còn 1,3e-6 khi tắt motor ngón.
    - Claw rỗng, hoặc kẹt trên vật chưa giữ (luật 2), giữ motor của nó.
  - **Khi nào thả.** Motor chạy tiếp từ chỗ đó khi có một trong các điều sau:
    - lệnh lift hoặc claw mới (cùng góc ra lệnh lại thì không: servo thật cũng không làm gì);
    - xe chạy hoặc drive bật;
    - trạng thái gắp đổi trong lúc giữ: mất vật (detach khi tuột) hoặc vừa giữ vật (review 1 M2; nếu không, ngón sẽ bị khoá ở bề rộng của khối đã mất);
    - đặt lại bằng tay (`placeAt`).
  - **Giữ không kiểm tải (review 1 M1).** Đã giữ thì tay chịu mọi tải tới khi chassis chuyển động, một điểm tựa nhấc lên, hoặc có lệnh.
    - Tải đặt đột ngột từ 2,5 N trở lên lên giá kẹp làm chassis chúi quá `CAR_STILL_TURN_RAD_S`, nên giữ thả ra sau 1 tick (test ghim). Sau đó motor gánh như khi không giữ: bước 4,5 N đẩy tay về chặn.
    - Tải tăng chậm thì không bao giờ thả: review 1 đo 6 N (1,7 lần mức kẹt) tăng dần trong 3–10 s, tay vẫn đứng ở 54,98°.
    - Không bài nào có tải gần mức kẹt lúc đứng yên. Vật nặng nhất là bệ 40 g của bài 11 (0,39 N); mọi vật của một bài cộng lại nặng nhiều nhất 0,54 N. Mức kẹt ở đầu tay là 3,6 N (0,18 N·m trên boom 5 cm của `ref-uno-gripper@0`).
  - **Vì sao 1 s.** Kết quả của các test B5 sau một quãng dừng nhạy tới bit cuối với trạng thái tay.
    - Giữ sau 0,25 s: một cú đâm tường lắng 0,61 s, quá bound 0,5 s.
    - Giữ sau 0,6 s (giữa lúc pick gắp khối): bốn test trượt.
    - Giữ cả ngón của claw rỗng: một test lắng 1,09 s.
  - **Vì sao phải đứng trên ba điểm tựa.** Xe dựa tường hay ngóc đầu trên tay đang ấn thì chỗ nó nằm yên phụ thuộc lực servo. Giữ một xe dựa tường đổi góc nghiêng 0,54°, quá bound 0,5°. Servo ấn vật thì vẫn ấn bằng motor, như cũ.
  - **Rover không đổi.** Rover không gọi Rapier thêm lần nào: `carStill` chỉ đọc khi có gripper. 137 450 lời gọi, cùng hash với master.
- **Kết quả.**
  - **Bốn bài, trạng thái cuối:** |yaw| ≤ 2,9e-5 °/s, trôi ≤ 6e-7 cm/s. rb-grip-stack −4,6e-8 °/s.
  - **Sàn phẳng:** không giữ vật ≤ 2,5e-5 °/s; giữ 15/50 g ≤ 7,4e-5 °/s.
  - **Trình duyệt:** rb-grip-stack vẽ 0 frame trong 5 s đứng yên (trước 50).
  - **Lúc bắt đầu giữ, ảnh đổi** ≤ 2,4e-4 cm và ≤ 7,7e-6 ở quaternion. Cộng với phần quay đã dồn, nó có thể cho **một** cặp frame cuối, khoảng 1 s sau khi xe dừng.
  - **Điểm bài học không đổi:** 100/97/100/97, mọi exploit và lời giải mù như cũ. `verify:attempt` 23/23 rover và 19/19 gripper `match`.
  - **Golden đổi:**
    - `gripper-stack` `42a76f26`/`ac6f2b46`;
    - `final` của bốn check bài tay gắp (và G1 e2e);
    - hai fixture gripper kia và mọi thứ của rover giữ nguyên;
    - `ROBOT_ENGINE_VERSION` vẫn 1.
- **Còn mở.**
  - Hai exploit kết thúc khi đang giữ khối vẫn quay trên 1e-4 °/s, dù trạng thái giữ đã vào. Đó là sai số của chuỗi khớp, khuếch đại theo lịch sử.
    - stack `hold-over-base`: 1,66e-4 °/s (trước 1,96e-2), khoảng một cặp frame mỗi 6 s;
    - pick `hold-in-zone` (khối nằm trên sàn): 3,7e-4 °/s (trước 4,9e-4).
  - Test 3D "đứng yên không vẽ" của `robot-lab-gripper-ui.spec.ts`, bản trước E10, bắt được cặp frame lúc bắt đầu giữ, vì nó đo cửa sổ 1,5 s theo giờ tường.
    - Bản viết lại của E10 đo theo đồng hồ world. B7 đã rebase lên master dabc023 (có E9 + E10), và test đó qua 1 + 3 lần.
    - Còn lại một điều kiện: B7 không được merge trước E9 + E10.

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
