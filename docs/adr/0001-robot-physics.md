# ADR 0001 — Vật lý cho lab robot 3D (R0.1, gate G0)

- **Trạng thái:** Accepted — 2026-10-25 (task N18 R0.1).
- **Bằng chứng:** `spikes/robot-physics/` (spike, xoá sau gate) và số đo thô trong `spikes/robot-physics/results/*.json`.
- **Liên quan:** `docs/robot-3d-implementation-plan.md` D-R6, D-R12, §3 (mô hình thời gian), §4.5 (`World`), §5 (ngân sách).

## 1. Câu hỏi

1. Rapier 0.21.0 bản deterministic có cho **cùng hash pose** sau 3 000 tick giữa hai lần chạy và giữa Node / Chromium / Firefox / WebKit không?
2. Robot vi sai cỡ 15 cm nên dựng theo mô hình drive nào: (a) revolute joint + velocity motor, (b) `DynamicRayCastVehicleController`, (c) diff-drive mức vận tốc trên khung dynamic?
3. Integration parameters nào (`lengthUnit`, `numSolverIterations`, `numInternalPgsIterations`) cho vật cỡ cm?
4. Dùng gói nào: `@dimforge/rapier3d-deterministic` (file `.wasm` tách riêng) hay `@dimforge/rapier3d-deterministic-compat` (wasm nhúng base64)? Gói nào chạy được trong Vitest/Node và trong Vite production build, Vite 8 có cần `vite-plugin-wasm` không?
5. Có đạt ngân sách §5 phần vật lý không (kích thước WASM, init khi throttle 4×, ms/tick, headless 3 × 60 s)?
6. Trig (`Math.sin/cos/atan2`) có lọt vào vòng tick không (D-R12)?

## 2. Thiết lập spike

- **Đơn vị SI** (m, kg, s). Trục: +X là phía trước robot, +Y hướng lên, +Z bên phải. Yaw dương = quay trái.
- **Sa bàn:** sàn `cuboid` 2,4 × 2,4 m (mặt trên y = 0, μ = 1,0), 4 tường dày 2 cm cao 10 cm, mặt trong ở ±1,0 m (sa bàn 2 × 2 m).
- **Robot:** thân 15 × 5 × 10 cm, 0,5 kg tổng, khoảng sáng gầm 1,5 cm; bánh bán kính 3,3 cm, track 14 cm, trục bánh ở x = −2 cm; bánh tự lựa (caster) cầu bán kính 1 cm ở x = +5,5 cm, **ma sát 0** (combine rule `Min`). Giới hạn mô-men mỗi bánh 0,1 N·m (cỡ motor giảm tốc TT), μ lốp 1,0. Khối lượng/quán tính thân đặt tường minh bằng `setAdditionalMassProperties` (collider density 0) để ba mô hình có cùng khối lượng.
- **Hộp:** khối lập phương 10 cm, 100 g, μ hộp–sàn 0,4.
- **Bước:** `PHYSICS_HZ = 120`, `world.timestep = 1/120`, một `world.step()` mỗi tick.
- **Ba mô hình drive** (`spikes/robot-physics/sim.ts`):
  - **(a) joint:** hai bánh là rigid body dynamic, nối thân bằng `JointData.revolute` trục −Z; motor `configureMotorVelocity(target, 50)` với `MotorModel.ForceBased` và `setMotorMaxForce(0,1)`. Bánh dùng collider **cầu** (xem §4.2: cylinder/roundCylinder lặp quay kém hơn và tâm quay trôi 1–7 mm).
  - **(b) raycast:** `world.createVehicleController(chassis)`, 2 bánh tia + 1 tia caster không ma sát; lò xo treo 2 mm, ζ = 0,7; `setWheelEngineForce` từ bộ điều khiển P bão hoà theo tốc độ bánh (đo từ `wheelRotation`), cùng giới hạn mô-men.
  - **(c) velocity:** thân dynamic tựa trên 3 cầu **không ma sát**. Mỗi tick, trước `world.step()`, tính xung lực từng bánh để đưa thân về vận tốc động học vi sai (v = r(ωL+ωR)/2, ω = r(ωR−ωL)/track), cắt theo `min(mô-men/r, μ·N)·dt`; xung lực ngang triệt trượt ngang tại trục bánh (tâm quay là trung điểm trục). Va chạm với tường và hộp vẫn do solver xử lý.
- **Kịch bản đo** (`spikes/robot-physics/scenarios.ts`), mỗi bài nghỉ 0,5 s trước khi chạy:
  - *Đi thẳng 2 m:* từ góc sa bàn theo đường chéo (hướng −45°, quaternion dựng **chỉ bằng `Math.sqrt`**), bánh 10 rad/s (lý tưởng 0,33 m/s), dừng khi đi đủ 2 m.
  - *Quay 90° × 10:* open-loop, mỗi lần 67 tick ở ±6 rad/s (67 = round((π/2)·(track/2)/(r·ω)·120)) rồi dừng 0,25 s. Sai số lặp = max |góc_i − trung bình|.
  - *Đẩy hộp:* chạy 3 s ở 10 rad/s vào hộp cách 17,5 cm, rồi dừng 1 s.
  - *Không rung:* đứng yên, đo 2 s sau 1 s ổn định; tốc độ tính bằng **sai phân pose** (xem §7 về `linvel()` của (b)).
- **Hash tất định:** kịch bản cố định — tiến 2 s, nghỉ 0,25 s, quay 90° × 10 (mỗi lần nghỉ 15 tick), tiến 5 s (gặp hộp, đẩy hộp vào tường, kẹt), rồi đứng yên tới tick 3 000. FNV-1a 32-bit trên pose (translation xyz + quaternion xyzw) của **mọi body dynamic**, ba biến thể:
  - `finalQ6`: pose cuối, lượng tử hoá 1e-6 (đúng yêu cầu G0);
  - `trajQ6`: pose lượng tử 1e-6 ở **mọi** tick;
  - `trajBits`: bit float32 thô của pose ở mọi tick (chặt nhất: không che sai khác < 1e-6).

## 3. Máy đo

| Mục | Giá trị |
|---|---|
| Máy | MacBook Pro, Apple **M4 Pro** (12 core), 24 GiB RAM — máy **cao cấp**, không phải "tầm trung" của §5 |
| OS | macOS 26.5.2 (Darwin 25.5.0, arm64) |
| Node / pnpm | Node v24.22.1 (chạy `.ts` bằng type stripping), pnpm 12.8.1 |
| Công cụ | Vite 8.3.2, Vitest 4.1.11, `vite-plugin-wasm` 3.6.0, Playwright 1.63.0 |
| Trình duyệt (Playwright, headless) | Chromium 153.0.8010.12 (headless shell), Firefox 155.0, WebKit 26.6 (build 2359 — đã cài bằng `pnpm exec playwright install webkit` vì máy chỉ có build 2083/2287 không khớp Playwright 1.63) |
| Rapier | `@dimforge/rapier3d-deterministic@0.21.0` và `-compat@0.21.0`; hai gói chứa **cùng một** file wasm (3 105 893 B, sha256 `4e9890fd2df60072f9db06a33e4030221249c1b3687b722b2388c21f09e97551`, `cmp` trùng khớp) |
| Tải nền | Máy dùng chung với các agent khác: load average 7,7–17,3 trong lúc đo (ghi trong `results/*.json`). Số thời gian vì vậy có thể hơi bi quan |
| Phục vụ trang | Server tĩnh trong `browsers.ts`, header COOP/COEP (trang `crossOriginIsolated = true` trên cả 3 trình duyệt, để `performance.now()` có độ phân giải 5 µs Chromium, 20 µs Firefox/WebKit), `Cache-Control: no-store`, không nén. Mỗi mẫu init là một browser context mới (cache lạnh) |

## 4. Số đo

### 4.1 So sánh ba mô hình drive (Node, gói compat, integration parameters đã chọn cho từng mô hình)

Nguồn: `results/node-run1.json` → `metrics`, `hashes`. `lengthUnit = 0,1` cho cả ba; (a) 8 iteration + 2 PGS, (b) và (c) 4 iteration + 1 PGS.

| Chỉ số | (a) joint | (b) raycast | (c) velocity |
|---|---:|---:|---:|
| Thẳng 2 m: lệch ngang max (mm) | 0,171 | 10,411 | 0 |
| Thẳng 2 m: sai hướng khi tới 2 m (°) | −0,0068 | 1,1296 | 0 |
| Thẳng 2 m: thời gian (s) / tốc độ TB (m/s), lý tưởng 0,33 | 6,108 / 0,3274 | 6,083 / 0,3288 | 6,083 / 0,3288 |
| Thẳng: dao động độ cao thân (mm) / nghiêng max (°) | 0,0001 / 0,328 | 1,8523 / 1,665 | 0 / 0,08 |
| Quay 90° × 10: trung bình (°) | 89,9382 | 91,804 | 90,4862 |
| Quay: **sai số lặp max (°)** (yêu cầu ≤ 1°) | **0,0062** | **3,1811** | **0,0001** |
| Quay: sai lệch max so với 90° (°) | 0,0625 | 4,6687 | 0,4863 |
| Quay: tâm quay trôi max (mm) | 0,054 | 40,571 | 0,48 |
| Đẩy hộp 100 g: hộp đi được (mm) / lệch ngang (mm) | 819,96 / −0,06 | 724,61 / 0,24 | 811,72 / 0,58 |
| Đẩy hộp: tốc độ robot khi đẩy (m/s) / hộp max (m/s) | 0,3275 / 0,3558 | 0,2911 / 0,2945 | 0,3239 / 0,3238 |
| Đẩy hộp: hộp nghiêng max (°) / nhấc lên (mm) | 0,383 / 0 | 0,306 / 0 | 0,041 / 0,004 |
| Đứng yên: tốc độ max (mm/s) / trôi trong 2 s (µm) | 0,00469 / 8,276 | 0 / 0,001 | 0 / 0 |
| Kịch bản hash, 5 s cuối (robot kẹt hộp/tường): tốc độ max mọi body (mm/s) | 0,046 | **131,28** | 0,0004 |
| Đáp ứng bước: tới 90 % của 10 rad/s (ms) | 25 | 83,3 | 50 |
| ms/tick Node, median / p95 (lần chạy thứ 2) | 0,035 / 0,0427 | 0,006 / 0,0117 | 0,0214 / 0,0244 |
| Headless 3 biến thể × 60 s (21 600 tick), wall-clock Node (ms) | 441,8 | 125,4 | 279,5 |

Ghi chú:
- (b) trong kịch bản hash **trượt khỏi hộp** (sai số quay tích luỹ), lao vào tường và rung 131 mm/s khi kẹt. (a) và (c) đẩy hộp vào tường rồi đứng yên.
- (c) quay 90,49° thay vì 90° vì pha tăng/giảm tốc bị cắt theo mô-men; sai lệch này **lặp lại y hệt** mỗi lần (sai số lặp 0,0001°), là động lực học chứ không phải nhiễu.
- (a) đứng yên vẫn trôi 8 µm / 2 s (≈ 4 µm/s, không thấy bằng mắt): joint + velocity motor target 0 của solver không giữ tuyệt đối (lượt khám phá thấy bánh quay lùi cỡ 10⁻⁴ rad/s).

### 4.2 Tune integration parameters

Nguồn: `results/node-run1.json` → `sweep` (cùng các bài đo, thêm cột kẹt tường và ms/tick của kịch bản hash).

| Mô hình | `lengthUnit` | iter | PGS | Lệch ngang 2 m (mm) | Lặp quay (°) | Trôi tâm quay (mm) | Đứng yên v max (mm/s) | Trôi 2 s (µm) | Kẹt tường v max (mm/s) | ms/tick median |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| joint | 1 | 1 | 1 | 202,867 | 2,3232 | 7,308 | 108,48384 | 5995,771 | 32,9088 | 0,01 |
| joint | 1 | 2 | 1 | 4,643 | 0,2564 | 1,288 | 11,03369 | 400,477 | 0,3147 | 0,0128 |
| joint | 1 | 4 | 1 | 5,069 | 0,0138 | 0,196 | 0,1866 | 190,371 | 0,0923 | 0,022 |
| joint | 1 | 8 | 1 | 1,394 | 0,0137 | 0,079 | 0,09941 | 97,227 | 0,0712 | 0,0362 |
| joint | 1 | 8 | 2 | 0,095 | 0,0079 | 0,048 | 0,00669 | 11,368 | 0,0672 | 0,0417 |
| joint | 0,1 | 1 | 1 | 283,492 | 2,3186 | 7,191 | 108,26347 | 6743,116 | 35,3402 | 0,0073 |
| joint | 0,1 | 2 | 1 | 4,699 | 0,272 | 1,289 | 10,83866 | 399,528 | 0,234 | 0,0091 |
| joint | 0,1 | 4 | 1 | 5,113 | 0,0128 | 0,192 | 0,09735 | 192,363 | 0,0502 | 0,0201 |
| joint | 0,1 | 8 | 1 | 1,201 | 0,0093 | 0,08 | 0,04906 | 96,09 | 0,051 | 0,0334 |
| joint | 0,1 | 8 | 2 | 0,171 | 0,0062 | 0,054 | 0,00469 | 8,276 | 0,046 | 0,0378 |
| raycast | 1 | 1 | 1 | 29,688 | 3,1427 | 39,198 | 0,00045 | 0 | 78,3365 | 0,0095 |
| raycast | 1 | 2 | 1 | 16,812 | 2,7356 | 40,123 | 0 | 0 | 88,6757 | 0,0093 |
| raycast | 1 | 4 | 1 | 10,411 | 3,1811 | 40,571 | 0 | 0,001 | 129,457 | 0,0129 |
| raycast | 1 | 8 | 1 | 20,896 | 4,0592 | 55,675 | 0 | 0,001 | 154,1876 | 0,014 |
| raycast | 1 | 8 | 2 | 20,896 | 4,0592 | 55,675 | 0 | 0,001 | 134,1518 | 0,0155 |
| raycast | 0,1 | 1 | 1 | 29,688 | 3,1427 | 39,198 | 0,00045 | 0 | 82,361 | 0,0044 |
| raycast | 0,1 | 2 | 1 | 16,812 | 2,7356 | 40,123 | 0 | 0 | 94,8343 | 0,0062 |
| raycast | 0,1 | 4 | 1 | 10,411 | 3,1811 | 40,571 | 0 | 0,001 | 131,2844 | 0,0046 |
| raycast | 0,1 | 8 | 1 | 20,896 | 4,0592 | 55,675 | 0 | 0,001 | 142,499 | 0,005 |
| raycast | 0,1 | 8 | 2 | 20,896 | 4,0592 | 55,675 | 0 | 0,001 | 175,9681 | 0,0053 |
| velocity | 1 | 1 | 1 | 0,005 | 0 | 0,48 | 0 | 0 | 0 | 0,0135 |
| velocity | 1 | 2 | 1 | 0 | 0 | 0,48 | 0 | 0 | 0,0001 | 0,0179 |
| velocity | 1 | 4 | 1 | 0 | 0 | 0,48 | 0 | 0 | 0,0004 | 0,0267 |
| velocity | 1 | 8 | 1 | 0 | 0,0001 | 0,48 | 0 | 0 | 0,0008 | 0,0438 |
| velocity | 1 | 8 | 2 | 0 | 0,0001 | 0,48 | 0 | 0 | 0,0004 | 0,047 |
| velocity | 0,1 | 1 | 1 | 0,005 | 0 | 0,48 | 0 | 0 | 0 | 0,011 |
| velocity | 0,1 | 2 | 1 | 0 | 0 | 0,48 | 0 | 0 | 0,0001 | 0,014 |
| velocity | 0,1 | 4 | 1 | 0 | 0,0001 | 0,48 | 0 | 0 | 0,0004 | 0,0203 |
| velocity | 0,1 | 8 | 1 | 0 | 0,0001 | 0,48 | 0 | 0 | 0,0008 | 0,0363 |
| velocity | 0,1 | 8 | 2 | 0 | 0,0001 | 0,48 | 0 | 0 | 0,0009 | 0,0408 |

Kết luận tune:
- `lengthUnit` (1 so với 0,1) gần như không đổi kết quả ở cỡ robot này; chọn **0,1** vì vật dynamic điển hình ~10 cm (tolerance penetration 0,1 mm thay vì 1 mm, prediction distance 2 mm thay vì 2 cm).
- (a) cần ≥ 4 iteration; 8 iteration + 2 PGS mới gần hết trôi khi đứng yên (8,3 µm / 2 s với `lengthUnit` 0,1, so với 192 µm ở 4 + 1). 1 iteration thì đi thẳng lệch 20–28 cm.
- (b) không cải thiện ở bất kỳ cấu hình solver nào (sai số lặp 2,7–4,1°). 12 biến thể lốp (`frictionSlip` 1/3/10,5 × `sideFrictionStiffness` 1/5 × Kp 0,05/0,2): sai số lặp 2,85–7,44°, tâm quay trôi 38,7–53,6 mm, đi thẳng lệch 10,4–54,0 mm. 6 biến thể treo (sag 0,5/2 mm × ζ 0,7/1/2): chỉ sag 2 mm, ζ 0,7 là ổn định. Các tổ hợp sag 0,5 mm / ζ 0,7, sag 0,5 mm / ζ 1, sag 0,5 mm / ζ 2, sag 2,0 mm / ζ 1, sag 2,0 mm / ζ 2 đều **lật** (nghiêng 180°), vì lò xo treo của controller được tích phân hiện ở dt = 1/120.
- (c) không nhạy với iteration (1–8 đều cho sai số lặp ≤ 0,0001°). Giữ mặc định 4 + 1 để hộp và tường xếp chồng ổn định khi có nhiều vật hơn; chi phí vẫn ~0,02 ms/tick.
- Biến thể của (a) ở 8 + 2 iteration (`results/node-run1.json` → `variants`):

  | Bánh | Motor model | factor | Lệch ngang 2 m (mm) | Quay TB (°) | Lặp quay (°) | Trôi tâm quay (mm) | Đứng yên v max (mm/s) | Trôi 2 s (µm) | Đáp ứng 90 % (ms) |
  |---|---|---:|---:|---:|---:|---:|---:|---:|---:|
  | cylinder | acceleration | 50 | 3,682 | 0,0066 | 0,0279 | 153,843 | 19,11906 | 35848,623 | 833,3 |
  | cylinder | acceleration | 500 | 2,712 | 71,2455 | 0,9651 | 3,963 | 3,45067 | 2861,732 | 108,3 |
  | cylinder | acceleration | 5000 | 2,077 | 87,5861 | 0,3426 | 6,94 | 0,39534 | 252,267 | 25 |
  | cylinder | force | 50 | 3,283 | 89,3732 | 0,5696 | 7,317 | 0,01049 | 13,979 | 25 |
  | cylinder | force | 500 | 5,913 | 89,458 | 0,79 | 7,051 | 0,01006 | 13,735 | 25 |
  | cylinder | force | 5000 | 4,297 | 89,2875 | 0,2286 | 7,286 | 0,00973 | 13,67 | 25 |
  | roundCylinder | acceleration | 50 | 25,759 | 0,0609 | 0,0424 | 199,752 | 25,59313 | 46816,007 | 1016,7 |
  | roundCylinder | acceleration | 500 | 23,734 | 74,4241 | 0,7631 | 1,138 | 4,53049 | 4948,445 | 100 |
  | roundCylinder | acceleration | 5000 | 22,687 | 88,6563 | 0,6706 | 4,74 | 0,99095 | 310,912 | 25 |
  | roundCylinder | force | 50 | 19,325 | 90,2143 | 0,5947 | 4,322 | 0,28584 | 9,019 | 16,7 |
  | roundCylinder | force | 500 | 19,779 | 90,2639 | 0,6496 | 4,365 | 0,28478 | 8,375 | 16,7 |
  | roundCylinder | force | 5000 | 19,144 | 90,1989 | 0,6828 | 4,305 | 0,28493 | 8,355 | 16,7 |
  | ball | acceleration | 50 | 0,013 | 84,8014 | 13,9446 | 24,473 | 0,05523 | 24,48 | 1008,3 |
  | ball | acceleration | 500 | 0,064 | 89,7672 | 0,0247 | 3,964 | 0,00155 | 2,636 | 100 |
  | ball | acceleration | 5000 | 0,156 | 89,9362 | 0,0056 | 0,567 | 0,00395 | 6,899 | 25 |
  | ball | force | 50 | 0,171 | 89,9382 | 0,0062 | 0,054 | 0,00469 | 8,276 | 25 |
  | ball | force | 500 | 0,167 | 89,9383 | 0,0061 | 0,054 | 0,00479 | 8,275 | 25 |
  | ball | force | 5000 | 0,167 | 89,9383 | 0,0061 | 0,054 | 0,00468 | 8,276 | 25 |

  `AccelerationBased` factor 50 gần như không quay được bánh (quay 0,0066°–84,8° thay vì 90°, đáp ứng 0,8–1 s). `ForceBased` + `setMotorMaxForce` cho motor giới hạn mô-men đúng nghĩa và không nhạy với factor. Bánh **cầu** tốt nhất (lặp 0,006°, tâm quay trôi 0,05 mm). Bánh cylinder/roundCylinder lặp 0,23–0,97°, tâm quay trôi 1–7 mm, đi thẳng lệch 2–26 mm: tiếp xúc cạnh trụ với sàn hộp kém ổn định hơn. Ở lượt khám phá đầu (4 iteration, đo bằng `linvel()`, không lưu trong `results/`), cylinder còn rung 17–30 mm/s khi đứng yên. Ở 8 + 2 iteration với `ForceBased`, cylinder đứng yên được (0,01 mm/s); điểm yếu còn lại là quay và đi thẳng.

### 4.3 Tất định: hash sau 3 000 tick

Kịch bản hash (§2), 3 000 tick, `MODEL_TUNING` của từng mô hình. Nguồn: `results/node-run1.json`, `results/node-run2.json`, `results/browsers.json`, `results/vitest.txt`.

| Mô hình | `finalQ6` | `trajQ6` | `trajBits` |
|---|---|---|---|
| (a) joint | `b92bef5e` | `e30909cd` | `276c062b` |
| (b) raycast | `489cfc46` | `fdd8062e` | `9b7b80f1` |
| (c) velocity | `37676c78` | `e9c955ec` | `656334f0` |

Ba hash trên **giống hệt** ở mọi lần chạy sau (không có ngoại lệ):

| Runtime | Gói / build | Lần 1 = lần 2 | Bằng bảng trên |
|---|---|---|---|
| Node v24.22.1, process 1 (`run1`) | compat | có | có |
| Node v24.22.1, process 2 (`run2`) | compat | có | có |
| Vitest 4.1.11 (Node) | compat; split (alias + `server.deps.inline`, có/không plugin) | — | có (test so với `node-run1.json`, 6/6 pass) |
| Chromium 153 | split (build có plugin), compat, split (build **không** plugin) | có | có |
| Chromium 153, CPU throttle 4× | split, compat | có | có |
| Firefox 155 | split, compat, split không plugin | có | có |
| WebKit 26.6 | split, compat, split không plugin | có | có |

`trajBits` bằng nhau nghĩa là **từng bit float32** của mọi pose ở **mọi** tick trùng nhau, chặt hơn yêu cầu (pose cuối lượng tử 1e-6).

### 4.4 Gói `.wasm` tách riêng so với `-compat`

**Kích thước những gì trình duyệt tải** (build production Vite 8.3.2, đo bằng `zlib`: gzip level 9, brotli quality 11; nguồn `results/browsers.json` → `sizes.plugin`; 1 MB = 10⁶ B):

| Gói | File | Raw | gzip | brotli |
|---|---|---:|---:|---:|
| split | `rapier_wasm3d_bg-*.wasm` | 3 105 893 | **1 179 524** | 855 167 |
| split | `rapier-*.js` (JS glue) | 295 764 | 51 672 | 38 421 |
| split | **tổng** | 3 401 657 | **1 231 196** | **893 588** |
| compat | `rapier-*.js` (wasm base64 trong JS) | 4 366 824 | **1 650 101** | **1 201 709** |

Build split **không** `vite-plugin-wasm`: wasm giống hệt, JS glue 295 951 B (gzip 51 866) — chênh vài trăm byte do helper.

**Init** (median 5 mẫu, cache lạnh; `import()` + `init()`; "từ navigation" = `performance.now()` khi xong init, gồm tải từ localhost; nguồn `results/browsers.json`):

| Trình duyệt | split: import+init (ms) | compat: import+init (ms) | split: từ navigation (ms) | compat: từ navigation (ms) | tạo world + robot + hộp (ms) |
|---|---:|---:|---:|---:|---:|
| Chromium 153 | 18,04 | 42,67 | 49,89 | 74,20 | 2,42 / 2,29 |
| Chromium 153, **throttle 4×** | **72,03** | **121,63** | 124,08 | 169,87 | 10,49 / 9,99 |
| Firefox 155 | 38,20 | 54,98 | 109,42 | 125,16 | 0,56 / 0,54 |
| WebKit 26.6 | 23,78 | 30,24 | 147,14 | 152,92 | 2,46 / 2,30 |
| Node v24.22.1 (chỉ compat chạy được) | — | 58,48 (import 19,79 + init 38,69) | — | — | 2,58 |

Mẫu thô (ms) — Chromium split `[18,04 18,13 18,52 17,45 17,35]`, compat `[42,93 42,26 42,62 44,03 42,67]`; 4×: split `[72,03 75,36 67,52 73,16 71,09]`, compat `[122,86 119,32 122,85 121,63 119,54]`.

Lưu ý khi đọc số init: CDP `Emulation.setCPUThrottlingRate` làm chậm thread chính của renderer. Việc compile wasm của split (streaming compile) có thể chạy ở thread nền, phần đó có thể **không** bị throttle; spike không kiểm chứng điều này. Compat phải decode base64 trên thread chính nên bị throttle rõ hơn (init 23 → 88 ms). Thời gian tải mạng không có trong số đo (localhost).

**Tương thích công cụ:**

| Môi trường | split (`@dimforge/rapier3d-deterministic`) | compat (`-compat`) |
|---|---|---|
| Node thuần (`node file.ts`) | **Không chạy**: package không có `main`/`exports` (chỉ `module`) → `Cannot find package …/index.js`; import thẳng `rapier.js` thì lỗi `ERR_MODULE_NOT_FOUND` vì import không đuôi (`./exports`). Riêng `rapier_wasm3d.js` thì Node 24 nạp được (Wasm ESM integration, có ExperimentalWarning) nhưng đó chỉ là binding thô | Chạy (import 19,8 ms + init 38,7 ms) |
| Vitest 4, config như app hiện tại | **Fail**: `Failed to resolve entry for package` | Pass |
| Vitest + `resolve.alias` → `rapier.js` | **Fail** lúc chạy (`Cannot read properties of undefined (reading '__wbindgen_export')`): module bị externalize, wasm không được nạp | Pass |
| Vitest + alias + `server.deps.inline` | **Pass** (wasm qua xử lý wasm có sẵn của Vite 8) | Pass |
| Vitest + alias + inline + `vite-plugin-wasm` | Pass | Pass |
| Vite 8.3.2 production build | Pass, **có hoặc không** `vite-plugin-wasm`; chạy đúng trên 3 trình duyệt, hash bằng nhau | Pass |
| Vite 8.3.2 dev server | Pass, có hoặc không plugin (Chromium; import+init 71,3 / 41,4 ms) | Pass |

Vite 8.3.2 đã có sẵn Wasm ESM integration (`node_modules/vite/dist/node/chunks/node.js`, region `src/node/plugins/wasm.ts`: `wasmDirectRE = /\.wasm$/`, sinh glue + `instantiateStreaming`). Vì vậy **`vite-plugin-wasm` không cần nữa** cho Vite 8.3.

### 4.5 ms/tick và init trên trình duyệt

Đo trong kịch bản hash: mỗi mẫu = `setWheelTargets` (khi lệnh đổi) + bước drive + `world.step()`. "b10" = trung bình theo lô 10 tick (tránh giới hạn độ phân giải timer). Lần chạy thứ hai (warm). Đơn vị ms. Nguồn `results/browsers.json`, `results/node-run1.json`.

| Runtime | (a) joint median / p95 / b10 p95 | (b) raycast median / p95 / b10 p95 | (c) velocity median / p95 / b10 p95 | Độ phân giải timer |
|---|---|---|---|---|
| Node v24.22.1 | 0,035 / 0,0427 / 0,0467 | 0,006 / 0,0117 / 0,0134 | 0,0214 / 0,0244 / 0,0266 | < 0,001 |
| Chromium 153 (split) | 0,035 / 0,045 / 0,0435 | 0,005 / 0,015 / 0,013 | 0,015 / 0,025 / 0,0225 | 0,005 |
| Chromium 153 (compat) | 0,035 / 0,045 / 0,0435 | 0,005 / 0,015 / 0,013 | 0,015 / 0,025 / 0,0225 | 0,005 |
| Firefox 155 (split) | 0,04 / 0,06 / 0,094 | < 0,02 / 0,02 / 0,014 | 0,02 / 0,04 / 0,028 | 0,02 |
| WebKit 26.6 (split) | 0,04 / 0,04 / 0,044 | < 0,02 / 0,02 / 0,012 | 0,02 / 0,04 / 0,026 | 0,02 |
| Chromium 153, **throttle 4×** (split) | 0,035 / 0,625 / 0,198 (mean 0,113) | 0,005 / 0,065 / 0,086 (mean 0,026) | 0,015 / **0,505** / 0,1245 (**mean 0,0665**) | 0,005 |
| Chromium 153, throttle 4× (compat) | 0,035 / 0,625 / 0,1915 (mean 0,1125) | 0,005 / 0,015 / 0,0805 (mean 0,024) | 0,015 / 0,48 / 0,1205 (mean 0,064) | 0,005 |

Khi throttle 4×, median mỗi tick **không đổi** (0,015 ms cho (c)), trong khi mean tăng 3,2–4,2× (c: 0,0158 → 0,0665 ms) và median theo lô 10 tick tăng 1,8–3,9×. Điều đó cho thấy throttle được áp dưới dạng những lần dừng thread định kỳ: tick nào trúng lần dừng thì rơi vào p95. Vì vậy p95 theo từng tick khi throttle (0,48–0,625 ms) phản ánh cơ chế throttle hơn là chi phí của một tick; mean và b10 là số đáng tin hơn để so ngân sách.

Headless 3 biến thể × 60 s (3 × 7 200 tick, chỉ vật lý, không có interpreter), Node, máy này: (a) 441,8 ms · (b) 125,4 ms · (c) **279,5 ms**. Ước tính (không phải đo) cho Chromium throttle 4× từ mean đo được: (c) 0,0665 ms × 21 600 ≈ 1,4 s.

### 4.6 Trig và hàm `Math` không chính xác tuyệt đối (D-R12)

Probe `trigProbe()` (`scenarios.ts`): 20 000 cặp input giả ngẫu nhiên trong [−10, 10], hash FNV-1a trên bit float64 của kết quả. Nguồn `results/node-run1.json` → `trig`, `results/browsers.json`.

| Hàm | Node v24.22.1 | Chromium 153 | Firefox 155 | WebKit 26.6 | Kết luận |
|---|---|---|---|---|---|
| `Math.sin` | `efaa4295` | `c814347f` | `a5a3a08e` | `60bf26dd` | **4 kết quả khác nhau** |
| `Math.cos` | `73eafc1e` | `fad53ca2` | `a11826ac` | `df41f9f6` | 4 kết quả khác nhau |
| `Math.atan2` | `127a0356` | `bb70bccb` | `682cc98c` | `edce921b` | 4 kết quả khác nhau |
| `Math.exp` | `8354e1cf` | `131f8b0a` | `c5aa20a3` | `de0e5f35` | 4 kết quả khác nhau |
| `Math.hypot` | `9ee4fe2a` | `9ee4fe2a` | `f43ccdfe` | `76626f5e` | Node = Chromium, hai cái kia khác |
| `Math.pow` | `a16b6268` | `a16b6268` | `a16b6268` | `a16b6268` | trùng trên tập input này, nhưng spec không bảo đảm |
| `Math.sqrt` | `6c9e1eb3` | `6c9e1eb3` | `6c9e1eb3` | `6c9e1eb3` | trùng (IEEE 754 làm tròn đúng) |

Điểm mới so với D-R12: **Node 24 và Chromium 153 cũng khác nhau** ở `sin/cos/atan2/exp`, dù cùng là V8. Vậy "chỉ kiểm Node + Chromium là chưa đủ" vẫn đúng, nhưng còn mạnh hơn: kể cả Node vs Chromium cũng không được giả định trùng.

Trong spike:
- **Vòng tick không có trig.** Đường tick (`Sim.step()` của cả 3 mô hình, `hashQ6`, `hashBits`) chỉ dùng + − × ÷, `Math.sqrt`, `Math.abs`, `Math.min/max`, `Math.round`, `Math.imul`. Hướng trước của robot lấy từ quaternion bằng phép quay vector (nhân/cộng), không qua góc.
- **Điều kiện đầu:** hướng −45° của bài đi thẳng và quaternion xoay 90° của collider bánh được dựng **chỉ bằng `Math.sqrt`** (`yawMinus45()`, `ROT_X_90`). Một hướng tuỳ ý (vd. scenario ghi `headingDeg: 30`) sẽ cần `sin/cos(θ/2)` → **trig lọt vào điều kiện đầu**, phải đi qua `dmath.ts` hoặc scenario lưu thẳng quaternion.
- `SPIN_TICKS` dùng hằng `Math.PI` và `Math.round`: chính xác, tính một lần lúc nạp module.
- Trig chỉ có trong hàm đo (`yawOf` dùng `atan2`, `tiltDegOf` dùng `acos`, sai số so với 90°). Các hàm này không bao giờ ghi ngược vào world hay vào hash.
- Rapier tự dùng trig bên trong Rust/wasm, nhưng bản deterministic cho bit trùng nhau trên 4 runtime (`trajBits` §4.3), nên phần đó an toàn.

## 5. Quyết định

1. **Engine:** giữ **Rapier deterministic 0.21.0** (D-R6). G0 phần vật lý đạt (§6), **không** chuyển sang engine 2.5D.
2. **Gói:** **`@dimforge/rapier3d-deterministic`** (file `.wasm` tách riêng) cho app.
   - Lý do: đây là bản duy nhất đạt ngân sách WASM (1,18 MB gzip so với 1,65 MB của compat). Init nhanh hơn (Chromium 18 so với 43 ms; khi throttle 4× là 72 so với 122 ms). File `.wasm` có hash trong tên nên cache riêng được, JS glue chỉ 52 KB gzip.
   - **Không dùng `vite-plugin-wasm`**: Vite 8.3.2 tự xử lý (build, dev, chạy đúng trên 3 trình duyệt, hash bằng nhau). Gói `vite-plugin-wasm@3.6.0` đã cài thành thừa; gỡ hay giữ là quyết định của controller (task này không được sửa dependency).
   - Vitest: thêm vào config test `resolve.alias` `/^@dimforge\/rapier3d-deterministic$/` → `…/rapier3d-deterministic/rapier.js` và `test.server.deps.inline` cho gói đó (xem `spikes/robot-physics/vitest.config.ts`, mode `inline`).
   - Script Node thuần (vd. verifier phía server ở D-R9) không nạp được bản split. Khi đó dùng `-compat`: cùng wasm, cùng hash, đã chứng minh ở §4.3.
3. **Mô hình drive: (c) diff-drive mức vận tốc trên khung dynamic.**
   - Sai số lặp khi quay 0,0001°, đi thẳng lệch 0 mm, đứng yên và kẹt tường không rung (≤ 0,0004 mm/s).
   - Không nhạy với số iteration. Chi phí thấp (0,015–0,024 ms/tick).
   - Giới hạn mô-men và độ bám được viết tường minh bằng TS (map thẳng sang `dc-motor.ts`). Va chạm với tường và hộp vẫn là vật lý thật.
   - (a) joint là phương án dự phòng nếu sau này cần tiếp xúc bánh–sàn thật (dốc, gờ): đạt chất lượng (lặp 0,0062°) nhưng cần 8 iteration + 2 PGS, bánh cầu, đắt hơn 1,6–2,3× và vẫn trôi ~4 µm/s khi đứng yên.
   - **(b) `DynamicRayCastVehicleController` bị loại**: lặp 3,18° (> 1°), tâm quay trôi 4 cm, rung 131 mm/s khi kẹt tường, và mất ổn định khi treo cứng hơn.
4. **Integration parameters cho (c):** `world.timestep = 1/120`, `lengthUnit = 0.1` (SI, vật điển hình 10 cm), `numSolverIterations = 4`, `numInternalPgsIterations = 1` (mặc định). Thân robot `setCanSleep(false)`; khối lượng/quán tính đặt tường minh.
5. **`PHYSICS_HZ = 120` giữ nguyên.** Chi phí mỗi tick nhỏ hơn ngân sách khoảng 20 lần ở máy này, và ~7 lần (mean) khi throttle 4×. Bước 8,33 ms cho đáp ứng bước bánh 50 ms và quay 90° hết 67 tick. Không có số đo nào cho thấy cần đổi.

## 6. G0 — kết luận theo từng dòng acceptance

| Dòng acceptance (brief R0.1 / §5) | Kết quả | Bằng chứng |
|---|---|---|
| Hash pose sau 3 000 tick **bằng nhau giữa 2 lần chạy** | **PASS** | §4.3: run1 = run2 trong cùng process, giữa 2 process Node, và trong mỗi trình duyệt; 3 mô hình × 3 loại hash |
| Hash **bằng nhau giữa Node / Chromium / Firefox / WebKit** | **PASS** | §4.3: `finalQ6`, `trajQ6`, `trajBits` trùng trên Node 24.22.1, Vitest 4.1.11, Chromium 153 (cả khi throttle 4×), Firefox 155, WebKit 26.6; cả split lẫn compat, build có và không plugin |
| §5: physics WASM ≤ 1,3 MB gzip | **PASS** với split (wasm 1,180 MB; cả JS glue 1,231 MB). **FAIL** với compat (1,650 MB), nên chọn split | §4.4 bảng kích thước |
| §5: init physics ≤ 1,5 s khi CPU throttle 4× | **PASS** (split 72 ms import+init, 124 ms từ navigation; compat 122 / 170 ms) | §4.4 bảng init; lưu ý về compile ở thread nền và không tính mạng |
| §5: physics ≤ 0,5 ms/tick trên máy tầm trung | **PASS** cho (c): máy này median 0,015–0,024, p95 0,024–0,04 ms. Throttle 4× (giả lập máy yếu hơn tầm trung): mean 0,066, b10 p95 0,12 ms. p95 từng tick khi throttle là 0,48–0,505 ms, sát ngưỡng vì cơ chế dừng thread của throttle | §4.5. Máy đo là M4 Pro (cao cấp), **chưa đo trên máy tầm trung thật** |
| §5: headless 3 biến thể × 60 s ≤ 10 s (tầm trung) / ≤ 30 s (yếu) | **PASS phần vật lý**: (c) 280 ms trên Node máy này; ước tính ~1,4 s khi throttle 4× (tính từ mean, không đo trực tiếp). Chi phí interpreter/scheduler chưa có, đo lại ở R-sau | §4.5 |
| §5: Chạy → robot chuyển động ≤ 300 ms (sau init) | **PASS phần vật lý**: tạo world 0,5–2,6 ms (10–10,5 ms khi 4×); bánh đạt 90 % tốc độ sau 50 ms. Toàn chuỗi (compile program, session) đo ở task sau | §4.1, §4.4 |
| §5: JS chunk 3D ≤ 0,6 MB gzip; FPS | Ngoài phạm vi R0.1 (thuộc R0.2). Đầu vào cho R0.2: JS glue Rapier = 51,7 KB gzip, wasm nằm riêng | §4.4 |
| Đo: quay 90° × 10, sai số lặp ≤ 1° | **PASS** với (c) 0,0001° và (a) 0,0062°; **FAIL** với (b) 3,18° | §4.1 |
| Đo: đi thẳng 2 m, đẩy hộp 100 g, không rung, ms/tick, kích thước + init | Đã đo đủ | §4.1, §4.2, §4.4, §4.5 |

**Kết luận G0 (phần vật lý): PASS.** Rapier deterministic tất định bit-exact trên cả 4 runtime và đạt các ngân sách vật lý của §5. Phương án dự phòng 2.5D **không** được kích hoạt. Hai điều chưa có bằng chứng, ghi rõ để không bị hiểu nhầm:
- chưa đo trên máy tầm trung hay máy yếu thật, chỉ có throttle 4× của Chromium;
- Firefox/WebKit không có throttle CPU tương đương.

## 7. Hệ quả cho các task sau

- **R-sau (`src/core/world`)**:
  - Import duy nhất là `@dimforge/rapier3d-deterministic`, nạp lazy bằng `import()` (B1: chỉ trong `src/core/world/**`).
  - Thêm alias + `server.deps.inline` vào config test của app (§5, mục 2).
  - Nếu có script Node thuần thì dùng `-compat` qua cùng một interface (spike truyền module Rapier vào `createSim(R, …)`; `createWorld` có thể làm tương tự).
- **Mô hình (c) khi vào production cần thêm**:
  1. Kiểm tra *grounded*: chỉ áp xung lực drive khi cầu đỡ chạm sàn (contact/narrow-phase query). Nếu không, robot bị nhấc lên vẫn "chạy".
  2. Đặt pose ban đầu ở độ cao nghỉ (39,879 mm với hình học này) hoặc chạy N tick ổn định trước t = 0. Ở một lượt thử khám phá trước khi thêm pha nghỉ 0,5 s (không lưu trong `results/`), lần quay đầu tiên của (c) lệch 1,35° so với 9 lần sau vì robot còn đang lắng.
  3. Giới hạn xung lực mỗi bánh lấy từ model motor (`dc-motor.ts`). Đường cong T = T_s·(u − ω/ω₀) thay cho hằng số 0,1 N·m. Với (a) thì tương đương `ForceBased` + factor = T_s/ω₀, target = u·ω₀.
  4. `wheelRad` trong `RobotSnapshot` tích phân ω·dt, không cần `atan2`.
- **D-R12** được củng cố: trong vòng tick cấm cả `Math.sin/cos/tan/atan2/exp/log/pow/hypot` (không chỉ trig). ECMAScript chỉ đòi các hàm này xấp xỉ; spike đo được khác bit ở `sin/cos/atan2/exp/hypot` (§4.6). Được dùng: + − × ÷, `sqrt`, `abs`, `min/max`, `round/floor/ceil`, `imul`.
  - Nơi trig sẽ xuất hiện ở production: góc ban đầu trong scenario, hướng tia cảm biến siêu âm (±15°), góc servo nếu tính pose bằng JS, goal "quay về hướng X".
  - Mỗi chỗ phải dùng `dmath.ts`, hoặc chuyển sang so sánh bằng vector/quaternion (vd. |q.w| ≤ √0,5 nghĩa là đã quay ≥ 90°).
- **Kiểm hash ở CI/e2e**: chạy cùng kịch bản trên Node (Vitest) và Chromium/Firefox/WebKit (Playwright); so `trajBits` (chặt hơn `finalQ6`).
- **Đo hiệu năng trên trình duyệt** cần COOP/COEP để timer đủ mịn. Runtime **không** cần COOP/COEP, vì Rapier đơn luồng, không dùng SharedArrayBuffer (D-R6 vẫn đúng).
- **`linvel()` của chassis dùng `DynamicRayCastVehicleController`** không phản ánh vận tốc mà vị trí thực sự di chuyển: khi đứng yên vẫn báo vy = −30,7 mm/s trong khi y không đổi. Không còn ảnh hưởng vì đã loại (b), nhưng cần biết nếu ai thử lại.
- **Plan**: dòng Tech Stack và D-R6 trong `docs/robot-3d-implementation-plan.md` ghi theo ADR này: chọn bản tách `.wasm`, không cần `vite-plugin-wasm` với Vite 8.3, drive (c).
- Spike `spikes/robot-physics/` xoá sau gate như plan đã ghi; số đo thô nằm trong `results/` và được trích ở ADR này.

## 8. Cách tái lập

Từ thư mục gốc repo `stem-demo`, sau `pnpm install`:

```sh
# (một lần) WebKit build mà Playwright 1.63 cần
pnpm exec playwright install webkit

# Node: bảng 3 mô hình, sweep tune, hash 2 lần, trig probe, headless 3 x 60 s
node spikes/robot-physics/node-run.ts run1          # -> spikes/robot-physics/results/node-run1.json
node spikes/robot-physics/node-run.ts run2 --quick  # process thứ hai: hash + trig -> node-run2.json

# Trình duyệt: 2 build (có/không vite-plugin-wasm), kích thước gzip/brotli, Chromium/Firefox/WebKit,
# init cache lạnh x5, Chromium throttle 4x qua CDP, dev server có/không plugin (~45 s)
node spikes/robot-physics/browsers.ts               # -> spikes/robot-physics/results/browsers.json

# Vitest: ma trận cấu hình cho split/compat (so hash với node-run1.json)
for m in plain alias inline plugin; do
  SPIKE_VITEST=$m pnpm exec vitest run --config spikes/robot-physics/vitest.config.ts
done                                                # tóm tắt: spikes/robot-physics/results/vitest.txt

# Xem robot chạy kịch bản hash theo thời gian thực (top view)
pnpm exec vite --config spikes/robot-physics/vite.config.ts
#   http://localhost:5211/?pkg=split&mode=view&model=velocity   (model = velocity | joint | raycast)
#   http://localhost:5211/?pkg=compat&mode=all                  (hash + ms/tick trên trang)
```

Tài liệu đã dựa vào: type definitions đã cài trong `node_modules/@dimforge/rapier3d-deterministic-compat/dist/**/*.d.ts` (`World`, `IntegrationParameters`, `JointData.revolute`, `UnitImpulseJoint.configureMotorVelocity/setMotorMaxForce/configureMotorModel`, `DynamicRayCastVehicleController`); mã nguồn đã cài của `vite-plugin-wasm@3.6.0` (`dist/index.js`, `dist/wasm-helper.js`), của Vite 8.3.2 (`dist/node/chunks/node.js`, plugin wasm có sẵn) và type của Vitest 4.1.11 (`ServerDepsOptions.inline`). Không dùng tài liệu web.

## 9. Bổ sung khi làm R3.3 (production, `src/core/world/robot/`)

Mô hình (c) đã vào production với các điểm §7 yêu cầu (kiểm *grounded*, lắng trước t = 0, đường mô-men T = T_s·(u − ω/ω₀), `wheelRad` tích phân ω·dt). Số đo dưới đây lấy trên cùng máy §3 (M4 Pro, Node v24.22.1, Vitest 4.1.11), robot `ref-uno-rover@0` (thân 15 × 12 × 5 cm, 400 g, bánh 6,6 cm, track 15 cm). Số có test thì tái lập bằng `pnpm exec vitest run src/core/world/robot src/core/world/rapier.test.ts` (dòng ms/tick in ra từ test). Số ghi *(khám phá)* đến từ test tạm lúc làm task, **không giữ trong repo**: chúng là lý do chọn, còn hành vi đã chọn thì có test.

- **Hình dạng chân đỡ bánh.** Spike dùng cầu bán kính bằng bánh; cầu đó rộng hơn bánh thật (robot rộng thêm khoảng 4 cm). Thử cylinder không ma sát làm chân đỡ, đi thẳng 1 m ở 10 rad/s: **lệch ngang 90 mm, sai hướng 5,1°**, trong khi cầu bằng bánh và cầu nhỏ đều 0 mm / 0,0001° *(khám phá: thân 15 × 5 × 12 cm, 395 g, track 15 cm)*. Production dùng **cầu nhỏ** (bán kính nửa bề rộng bánh) dưới mỗi bánh làm chân đỡ, cộng một cylinder không ma sát hình bánh cách sàn 1 mm chỉ để va chạm cạnh bên. Kết quả: quay 90° × 10 lặp ±0,0001° (89,5256°); đi thẳng 1 m ở duty 128 lệch < 2 cm (test).
- **Grounded:** một chân đỡ chạm đất khi narrow phase có contact với collider không thuộc robot, khoảng cách ≤ 1 mm, pháp tuyến hướng lên (n_y ≥ 0,7). Pháp tuyến của manifold đi từ collider thứ nhất sang thứ hai của manifold; `flipped` cho biết collider thứ nhất có phải là collider ta truyền vào thứ hai không.
- **`refreshQueries` cần hai bước timestep 0** cho body bị dời bằng tay (reset, teleport). Sau `setTranslation` + `propagateModifiedBodyPositionsToColliders()` + một bước 0, ray không thấy body ở cả chỗ cũ lẫn chỗ mới khi world có 0–10 collider khác; với 100–1000 collider thì một bước là đủ *(khám phá)*. Hai bước luôn đủ (khám phá: 0/10/100/1000 collider, body dynamic, kinematic và collider fixed; test: 0/3/10/100 collider). Collider **mới tạo** thì một bước đã đủ (R3.1). `refreshQueries` nay chạy hai bước; test ở `rapier.test.ts`.
- **Tay servo** là body dynamic nhẹ (5 g) trên revolute joint, motor vận tốc `ForceBased` (max force = mô-men kẹt của servo), mỗi tick xin tốc độ tới đích trong một tick, kẹp ở 60°/`sPer60Deg`. Với 4 + 1 iteration của world, joint trễ motor: 0 → 90° đạt 87,8° ở 0,15 s rồi vượt 1,3°. Thêm 4 PGS iteration cho island của tay (`setAdditionalPgsIterations(4)`): 89,6° ở 0,15 s, vượt 0,3° *(khám phá; test: tới 90 ± 0,5° trong 18–20 tick, không quá 90,5°)*. (+4 solver iteration: 88,9° / 0,8°; +8: 89,3° / 0,6°; +4 và +4: 89,8° / 0,2°, *khám phá*.) Motor vị trí (`configureMotorPosition`) trễ khoảng một tick (85,8° ở 0,15 s); motor vị trí + vận tốc feed-forward thì vượt trước 2–3° *(khám phá)*. Giới hạn góc của joint sửa vi phạm chậm (mềm), nên target được kẹp trong `minDeg..maxDeg` trước.
- **Chi phí:** robot (chassis + tay) trong sa bàn `boxes.json` (3 vật dynamic), kịch bản 3 000 tick, đo trong test (`-t budget` in dòng ms/tick): **0,045–0,051 ms/tick median, 0,056–0,091 ms p95** qua 3 lần chạy (load average 3,4–3,9; số thấp nhất khi test chạy sau các test hash, đã "ấm"). Ngân sách 0,5 ms; máy này là máy cao cấp, chưa đo máy tầm trung.
- **Tất định:** kịch bản 3 000 tick (chạy, quay, quét tay, lùi, phanh, đẩy hộp, kẹt tường), FNV-1a trên bit float32 của pose mọi body dynamic và bit float64 của góc bánh/servo ở mọi tick: hai lần chạy bằng nhau, bằng golden `05272a85`, và bản `-compat` cũng ra `05272a85`.

