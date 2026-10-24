# Câu hỏi bắt buộc gửi nhà cung cấp bộ UNO (N18 R0.5)

> Mục đích: các thông tin dưới đây quyết định effort thật của phần kết nối thiết bị (spec `docs/uno-robot-direction.md`
> §6–§7). Đến khi có câu trả lời, lab robot dùng kit tham chiếu `ref-uno-rover@0` (pin PLACEHOLDER). Khi có, chỉ cần thay
> dữ liệu kit (`src/core/hardware/kits/<vendor>.kit.json`) — trừ khi xuất hiện **loại module mới** hoặc **giao thức điều
> khiển lạ**, khi đó có việc engine riêng (≈16–24h mỗi loại, ngoài 720h của M04). Plan: `docs/robot-3d-implementation-plan.md` §10.

## 1. MCU và bản mạch
- MCU chính xác (ATmega328P? LGT8F328P? ESP32 dạng UNO? khác?), tần số thạch anh, điện áp logic (5 V / 3,3 V).
- Chip USB-serial (CH340 / ATmega16U2 / CP2102…), bootloader (Optiboot?), baud nạp chương trình.
- **Hệ quả:** không phải ATmega328P thì không dùng được kiểm chứng bằng giả lập avr8js (L2e) và phải viết board profile mới.

## 2. Schematic và pin mapping
- Schematic mạch UNO và **control board / shield** (PDF hoặc KiCad).
- Bảng **cổng → chân** (vd. M1 = EN D5 / IN1 D7 / IN2 D8; S1 = D9; cổng cảm biến…).
- Driver motor: IC nào (L298N, TB6612FNG, L9110S, DRV8833, PCA9685…), kiểu điều khiển (EN+IN, PWM+DIR, I²C, hay vi điều
  khiển phụ có protocol riêng — nếu có, xin tài liệu protocol).

## 3. Thông số linh kiện
- Motor: RPM theo điện áp, tỉ số truyền, encoder (có/không, số xung/vòng).
- Bánh xe: đường kính, bề rộng, khoảng cách hai bánh; bánh tự do/caster.
- Nguồn: loại pin, điện áp danh định, mức sụt áp khi chạy motor.
- Servo: model (SG90/MG90S…), góc, tốc độ.
- Cảm biến siêu âm: model (HC-SR04 / tương đương), dải đo.
- Cảm biến dò line: số mắt, analog/digital, cực tính (vạch đen = HIGH hay LOW), khoảng cách tới mặt sàn.
- Module khác đi kèm kit (LED, còi, nút, màn hình, Bluetooth…).

## 4. Cơ khí và mô hình 3D
- Bản vẽ cơ khí hoặc **CAD 3D** của robot (kích thước thân, vị trí gắn từng cảm biến/motor), định dạng (STEP/STL/GLB).
- **Quyền sử dụng** các bản vẽ/CAD để dựng mô hình 3D trong phần mềm thương mại (có ghi công không?).

## 5. Phần mềm nhà cung cấp đang có
Với **từng** thành phần: library motor, library cảm biến, firmware riêng, control-board protocol, Blockly block, code
generator, uploader/app:
- Ai sở hữu? Có cung cấp **source** không?
- License là gì (MIT/BSD/LGPL/GPL/độc quyền)? Có cho phép **tích hợp, chỉnh sửa và dùng thương mại** không?
- Phiên bản hiện tại, kênh cập nhật, cam kết hỗ trợ.

## 6. Sa bàn
- Có sa bàn/mat in chuẩn không: kích thước, độ rộng vạch, màu nền/vạch, chất liệu (ảnh hưởng cảm biến line).

## 7. Mẫu thử
- Số bộ kit mẫu có thể gửi cho đội phần mềm để kiểm chứng L3 (M06) và hiệu chỉnh tham số mô phỏng (RPM, lệch motor,
  dải đo cảm biến).
