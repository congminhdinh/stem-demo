# ADR 0004 — Tay gắp 2 bậc: vật lý gắp (G0.1) và I²C (G0.2)

- **Trạng thái:** Proposed — 2026-10-26 (task N19 G0.1). Phần I²C (G0.2) điền ở §11.
- **Bằng chứng:** `spikes/n19-grasp/` (spike, eslint bỏ qua); số đo thô ở `spikes/n19-grasp/results/*.json`. Mọi con số trong ADR này lấy từ các file đó; số ghi *(khám phá)* là từ lượt chạy tạm lúc làm spike, không còn trong `results/`.
- **Liên quan:** `docs/n19-gripper-plan.md` D-G5, D-G6, D-G8, §4.1, §4.4, §6 (bài 11), §7 G0.1; ADR 0001 §5, §7, §9 (mô hình drive (c), tay servo nhô ra làm lật xe).

## 1. Câu hỏi

1. Tay gắp 2 bậc (tay nâng hình bình hành, hai ngón đối xứng) trên xe N18 có **gắp, chở, thả** được khối 4 cm bằng mô hình *attach + hysteresis* của §4.4 không: ổn định, không NaN, không lật?
2. Có **tất định** (hash bằng nhau) trên Node, Chromium, Firefox, WebKit không?
3. Có trong ngân sách **≤ 0,5 ms/tick** (median, máy này) không?
4. Ngón là **collider thật** hay **sensor** (dự phòng D-G5)?
5. Số nào ở §4.1/§4.4 phải đổi?

## 2. Thiết lập spike

- **Dùng lại production, không sửa `src/`:** `createPhysicsWorld` (`rapier.ts`: 1/120 s, `lengthUnit` 0,1, 4 solver + 1 PGS), `buildArena`, `assembleRobot` + `stepWorld` (drive (c)), `loadKit`, `dmath`, `robot-frame`, `units`. `createWorld` (`world.ts`) giữ Rapier world riêng nên không thêm body được; spike ghép đúng các builder đó rồi thêm tay gắp vào cùng world (`spikes/n19-grasp/sim.ts`). Vì vậy spike **không** có cảm biến, contacts cho goal hay snapshot (ms/tick so sánh cùng loại, §4.5).
- **Kit:** `ref-uno-rover@0` bỏ `servo1` và `buzzer`, siêu âm ở `[7.5,0,5.0]`, chassis `comCm [-1.2,0,3.6]`. `massG 460` hiểu là **cả xe** (như quy ước của tay servo trong `assembleRobot`): body chassis = 460 − 34 g bộ gắp = **426 g**.
- **Hình học suy ra từ §4.1** (`params.ts`):
  - Tay hạ (lift 0°) thì boom chúc **−40°**: đầu boom ở x 8,33, z 1,69 = 4,5 + 5·cos α, 4,9 + 5·sin α. Góc boom = lift − 40°, nên lift 90° là +50°. Tầm xa nhất ở lift 40° như §4.1 ghi.
  - Ngón dày **0,4 cm**: khe đầu ngàm 6,08 = 2·(2,2 + 5·sin 12°) − t. Từ đó mặt trong hai ngón song song, cách nhau đúng 4,0 cm ở claw 26,97° (β = 0).
  - Ngàm cao 1,2 cm (z 1,09–2,29); giá kẹp là hộp u ±0,5, v ±2,6, w ±0,6 cm; boom là hai tấm ở y ±6,6 (ngoài thân 12 cm) cộng thanh ngang ở đầu.
  - Lực kẹp: mỗi ngón nhận T_s/(2·0,445) = 0,202 N·m, tổng lực tại nửa ngón (2,5 cm) **8,09 N**; ngưỡng tuột 2·0,6·8,09 = **9,71 N** (plan ghi "khoảng 9,6").
- **Máy trạng thái** (`grasp.ts`): đúng năm điều kiện và hành vi attach/thả/tuột của §4.4, `CONTACT_GAP_M` = 2 mm (plan chưa đặt tên giá trị). Spike phải thêm bốn luật (§5.4).
- **Ba cấu hình đo:**
  - `plan` — §4.4 nguyên văn: luật servo của `servo-arm.ts`, motor giữ `LINK_HOLD_NM` 1 trên khớp boom↔giá kẹp, +4 PGS, ngón collider ma sát 0,6.
  - `tuned-collider` — cấu hình chọn (§5): luật servo có hãm, khoá góc chassis↔giá kẹp, quán tính rotor phản ánh 5·10⁻⁵ kg·m², +8 PGS +4 solver iteration, ngón collider ma sát 0.
  - `tuned-sensor` — như trên nhưng ngón là sensor (dự phòng D-G5).
- **Kịch bản** (`scenarios.ts`, script đặt target mỗi tick, không Blockly): khối 4 cm ở trước xe 8 cm, xe tiến duty 140 tới khi tâm khối ở u ≈ 3 cm của giá kẹp, phanh, đóng 80°.
- **Đo:** pitch/roll lớn nhất; caster "rời sàn" khi đáy bi cao hơn sàn > 0,1 mm (như test tường của production); độ ngang giá kẹp; ngón/giá kẹp lún vào khối (shape query) theo pha (đang đóng, đang giữ, sau đó); jitter của khối đang giữ so với giá kẹp; ms/tick. Pitch/caster tính cả lượt (`all`) và trong cửa sổ mà dòng acceptance nhắc tới (`window`: 1,5 s từ lúc phanh, 1,5 s từ lúc chạm tường, 2,5 s ấn).

## 3. Máy đo

| Mục | Giá trị |
|---|---|
| Máy | MacBook Pro, Apple M4 Pro (12 core), macOS 26.5.2 (Darwin 25.5.0, arm64) — máy cao cấp, **không** phải profile máy trường |
| Node / Vite / Playwright | Node v24.22.1, Vite 8.3.2, Playwright 1.63.0, Rapier `-compat` 0.21.0 |
| Trình duyệt (headless) | Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6; trang `crossOriginIsolated = true` (COOP/COEP) |
| Tải nền | Máy dùng chung với các agent khác: load average 13–54 trong lúc đo (ghi trong từng file `results/`). Lượt đo ms/tick cuối: 22,1 → 16,8 |

## 4. Số đo

### 4.1 Tay nâng và độ ngang giá kẹp

Nguồn: `results/trace.json` (`node spikes/n19-grasp/node-run.ts trace`). "Rỗng": các lần dời 90→0, 0→90, 90→40, 40→45, 45→0. "Giữ 50 g": quét 0→90 mỗi 10°, rồi 45°, 0°.

| Biến thể | Sụt ở 90° (°) | Vượt 90→40 (°) | Lệch ngang khi đứng (°) | Lệch ngang lúc dời (°) | 0→90 (tick) | Giữ 50 g: lệch ngang đứng / lỗi góc tay / vượt (°) |
|---|---:|---:|---:|---:|---:|---|
| `plan` (servo, hold-motor, +4 PGS) | −1,105 | 8,622 | −1,186 | 7,341 | 28 | 9,757 / **67,847** / 22,847 |
| servo, chassis-lock, +4 PGS | −0,939 | 7,899 | −0,091 | 0,555 | 29 | 1,769 / 3,604 / 26,625 |
| hãm, chassis-lock, +4 PGS | −0,939 | 7,294 | −0,091 | 0,515 | 29 | 1,722 / 12,783 / 27,431 |
| hãm, chassis-lock, +16 PGS | −0,270 | 1,153 | −0,020 | 0,127 | 22 | 0,503 / 1,299 / 6,991 |
| hãm, chassis-lock, +8 PGS +4 solver | −0,267 | 1,154 | −0,012 | 0,050 | 22 | 0,229 / 1,128 / 6,617 |
| hãm, hold-motor, J 1·10⁻⁴, +4 PGS | −0,021 | 0,073 | 0 | 2,842 | 22 | 6,511 / 0,119 / 0,725 |
| hãm, chassis-lock, J 1·10⁻⁴, +4 PGS | −0,017 | 0,065 | −0,090 | 0,505 | 22 | 1,662 / 0,083 / 0,411 |
| hãm, chassis-lock, J 5·10⁻⁵, +4 PGS | −0,030 | 0,119 | −0,090 | 0,575 | 22 | 1,720 / 0,142 / 0,784 |
| hãm, chassis-lock, J 5·10⁻⁵, +8 PGS | −0,015 | 0,060 | −0,045 | 0,254 | 22 | 0,909 / 0,082 / 0,664 |
| **chọn:** hãm, chassis-lock, J 5·10⁻⁵, +8 PGS +4 solver | −0,009 | 0,045 | −0,011 | 0,091 | 22 | **0,231 / 0,049 / 1,272** |

Đọc bảng:
- **Motor giữ của §4.4 không giữ được giá kẹp ngang.** Motor đặt trên khớp boom↔giá kẹp, mạnh hơn servo tay 5,5 lần (1 so với 0,18 N·m). Khi boom phanh, solver làm giá kẹp quay theo boom thay vì dừng boom: lệch 7,3° lúc dời, 1,2–1,55° lúc đứng (rỗng). Với 50 g, giá kẹp nghiêng 9,8° và **tay không giữ nổi khối** (lỗi góc tới 67,8°; ở kịch bản 2 đáy khối chỉ lên 1,14 cm thay vì 7,0). Khoá góc chassis↔giá kẹp (generic joint, khoá `AngZ`, các trục tịnh tiến tự do) là đúng điều hình bình hành làm: lệch đứng 0,011° (rỗng).
- **Luật servo của `servo-arm.ts` (xin tốc độ đạt đích trong 1 tick) không đủ cho tay có tải.** Nó chỉ bắt đầu hãm khi còn cách đích 1 tick, trong khi 0,18 N·m không dừng được boom + giá kẹp (I ≈ 1,2·10⁻⁴, 4,4·10⁻⁴ kg·m² khi giữ 50 g) trong 1 tick: vượt 7,3–8,6°. Trước tải trọng lực, sai số tĩnh là τ·dt²/I (1°). Tay servo cờ của N18 nặng 5 g nên chưa lộ.
- **Nguyên nhân gốc là PGS hội tụ kém qua một khâu nhẹ:** chassis 426 g → boom 6 g → giá kẹp 22 g (+ khối tới 50 g). Thêm iteration cải thiện (vượt 7,3° → 1,15°) nhưng đắt (§4.5). Quán tính rotor phản ánh trên boom (servo có hộp số thật thì có, J_rotor·N²) làm boom thành khâu "nặng" theo trục quay: sụt 0,009°, vượt 0,045°.
- `setAdditionalPgsIterations` trên body bộ gắp **có** tác dụng cho cả island (đã kiểm: đọc lại 16 và kết quả đổi). *(khám phá: một lượt quét đầu không có tác dụng vì `sim.ts` quên truyền `tuning` — lỗi của spike, đã sửa.)*

### 4.2 Tám kịch bản (`tuned-collider`; `results/node-run1.json`)

| # | Kịch bản | Kết quả | Số đo |
|---|---|---|---|
| 1 | Gắp 15 g ở lift 0°, đóng, nâng 90°, chạy 50 cm, hạ, thả, lùi (3000 tick) | attach 1,208 s (θc 19,94°), release 4,617 s, không còn joint, khối đứng thẳng (0°) | jitter 0,002 mm / 0°; lún ngón 0 (đóng) / 0,034 (giữ) mm; giá kẹp lệch tối đa 0,446°; cả lượt pitch ≤ 1,897°, caster rời sàn 19 tick (≤ 2,33 mm) khi tay nâng/hạ hết tốc |
| 2 | Như 1, 50 g | như 1 | jitter 0,005 mm / 0,011°; lún 0 / 0,034 mm; lệch ngang tối đa 1,185° (lúc dời); pitch ≤ 2,663°, caster rời 20 tick (≤ 3,34 mm) |
| 3 | 60 g | **không bao giờ attach**; ngàm dừng ở 26,04° (kẹt trên khối); ở lift 90° đáy khối −0,007 cm (vẫn trên sàn) | lún lúc đóng 1,16 mm; ngón ma sát 0,6: cũng không attach, đáy khối cao nhất 0,157 cm |
| 4 | Phanh từ tốc tối đa giữ 50 g | 0,476 m/s → dừng sau 1,66 cm (lift 90°) / 1,64 cm (45°), vẫn giữ | trong cửa sổ phanh: pitch +0,034 / −0,054° (90°), +0,019 / −0,057° (45°); caster luôn chịu tải (≥ 1,64 N), đáy bi ≤ −0,09 mm. Thả trôi: dừng sau 3,95 cm, pitch +0,034 / −0,026° |
| 5a | Đâm tường 0,398 m/s, khối nhô 0,5 cm khỏi đầu ngón, **motor vẫn đẩy** | tuột đúng: 24,92 N (lift 45°), 17,31 N (90°) > 9,71 N | **pitch 17,16° (45°) / 15,69° (90°)**, đứng nghiêng ~15,6°, caster cao 20–24 mm: xe chổng đầu |
| 5b | Như 5a, **motor thả trôi khi chạm** | tuột như 5a | pitch 1,00° (45°) / 2,39° (90°), ổn định sau 0,083 / 0,175 s; caster rời 7 tick ≤ 1,15 mm / 19 tick ≤ 2,97 mm |
| 5c | Đâm tường, đầu ngón chạm trước (gắp ở u 3), motor đẩy | không tuột (ngón đỡ va chạm, lực ngoài lên khối 0,16 N) | pitch 16,58° như 5a |
| 6 | Gắp ở lift 10° (w −0,41), lệnh lift 0°: khối chạm sàn trước | **không tuột**; tay vẫn tới 0,023° vì **đầu xe nhấc lên** | lực ngoài lớn nhất 4,51 N (lúc chạm); pitch 3,85°, caster cao 4,92 mm suốt 2,5 s |
| 7 | Thả cách sàn 1 cm (lift 14°) | đáy khối 1,007 cm trước khi thả; tiếp đất **nghiêng 0°** | |
| 8 | Lift **45°**, đặt lên bệ 6×6×4 cm 40 g | **trượt**: đáy khối đang giữ ở 3,634 cm < mặt bệ 4 cm, khối đẩy bệ đi 4,656 cm, rơi cạnh bệ | |
| 8' | Lift **55°** | trên bệ: lệch tâm **0,301 cm**, nghiêng 0,025°, bệ xê 0,004 cm | đáy khối đang giữ 4,493 cm, rơi 0,49 cm |

Mọi kịch bản: không NaN, bộ gắp không bao giờ chạm thân xe (0 tick).

`tuned-sensor` cho cùng kết quả ở 1–8 (lún lúc giữ ≤ 0,108 mm, jitter ≤ 0,004 mm), trừ hai điều: ngón sensor **đi xuyên tường** (không collider nào chặn), và không tự căn giữa khối lệch (§4.3).

`plan`: kịch bản 2 không nâng nổi 50 g (đáy khối 1,14 cm), giá kẹp nghiêng tới 10,2°. Ở 5a lift 45°, giá kẹp gập 10,9° thay vì truyền lực, pitch 8,42°.

### 4.3 Độ bền: khối đặt lệch (`robustness` trong `node-run1.json`)

Kịch bản 1 với khối lệch dx ±1, ±2 cm (dọc đường tiến) và dy ±0,5, ±1 cm (ngang), 15 g và 50 g: 16 lượt mỗi cấu hình.

| Cấu hình | Attach + thả | Lún lúc đóng (mm) | Lún lúc giữ (mm) |
|---|---|---:|---:|
| `tuned-collider` | 16/16 | ≤ 1,864 (50 g, dy ±1) | ≤ 2,060 (50 g, dy ±1); dx: ≤ 0,104 |
| `tuned-sensor` | 16/16 | **7,7 (dy ±0,5) – 17,7 (dy ±1)** | **9,4 – 19,3** |

Ngón collider đẩy khối lệch vào giữa ngàm (ngàm mở chỉ hở 1 mm ở gốc với khối 4 cm, nên trong các lượt đo khung |v| ≤ 1,5 của điều kiện 2 không lần nào là điều kiện chặn). Ngón sensor không đẩy được nên một ngón đi vào trong khối, gần bằng độ lệch.

### 4.4 Tất định

Hash của kịch bản 1 (3000 tick): FNV-1a trên bit float32 của pose mọi body động ở mọi tick cộng cờ "đang giữ" (`trajBits`), và pose cuối lượng tử 1e-6 (`finalQ6`), như `spikes/robot-physics/`.

| Cấu hình | `trajBits` | `finalQ6` |
|---|---|---|
| `plan` | `ff863a35` | `1bbda434` |
| `tuned-collider` | `aaeace5c` | `e4f99d6a` |
| `tuned-sensor` | `c194c0a8` | `8f3329e8` |

Giống hệt ở: Node v24.22.1 process 1 (`node-run1.json`, 2 lần trong process) và process 2 (`node-run2.json`, 2 lần); Chromium 153, Firefox 155, WebKit 26.6 (`browsers.json`, mỗi trình duyệt 2 lần; trang build bằng Vite, `vite preview` cổng 5401, gói `-compat`). Đường tick chỉ dùng + − × ÷, `Math.sqrt/abs/min/max` và `dmath` (`atan2`, `sin`, `cos`).

### 4.5 ms/tick

Kịch bản 1, 3000 tick, chỉ đo bước (điều khiển bộ gắp + `stepWorld` + máy trạng thái), sau một lượt làm nóng. Node: 5 lần lặp, median của các median (`results/node-cost.json`, load 22,1 → 16,8). Trình duyệt: 1 lần lặp (`results/browsers.json`, load 12,5 → 18,4).

| Cấu hình | Node median / p95 | Chromium | Firefox | WebKit |
|---|---:|---:|---:|---:|
| `plan` | 0,066 / 0,112 | 0,090 | 0,100 | 0,100 |
| **`tuned-collider`** | **0,194** / 0,230 | 0,265 | 0,180 | 0,280 |
| `tuned-sensor` | 0,190 / 0,226 | 0,205 | 0,160 | 0,220 |
| tuned, +8 PGS, không +solver | 0,113 / 0,131 | — | — | — |
| tuned, +4 PGS, không +solver | 0,090 / 0,101 | — | — | — |
| rover, chỉ vật lý (cùng builder, có tay servo) | 0,045 / 0,060 | 0,080 | 0,060 | 0,100 |
| rover, `createWorld` production đầy đủ | 0,073 / 0,094 | — | — | — |

- `tuned-collider` đắt hơn rover chỉ vật lý ~4,3 lần (Node). Phần lớn là +4 solver iteration: island của xe chạy 8 thay vì 4 substep.
- **Ước tính (không đo):** world production có gripper ≈ 0,073 + (0,194 − 0,045) ≈ **0,22 ms/tick** trên máy này. Profile máy trường chưa đo: việc của E9 (`bench:robot3d`).
- Độ phân giải timer: 5 µs Chromium, 20 µs Firefox/WebKit (nên số trình duyệt có bước 0,005/0,02).

## 5. Quyết định

1. **Giữ attach + hysteresis (D-G5) với ngón collider thật**, không chuyển sang sensor.
   - Collider: lún ≤ 2,06 mm cả khi khối lệch 1 cm, jitter ≤ 0,005 mm / 0,011°, tất định.
   - Sensor: lún 7,7–19,3 mm với khối lệch 0,5–1 cm, ngón đi xuyên tường.
   - Ngưỡng dự phòng của brief (lún > 2 mm, jitter > 0,5 mm, pitch quá ngân sách, lệch hash): collider chỉ chạm đúng 2,06 mm ở trường hợp xấu nhất (50 g lệch ngang 1 cm). Pitch quá ngân sách ở 5a là do xe chổng đầu (§5.3), không do joint, và xảy ra y hệt với sensor.
2. **Mô hình tay gắp cho B1** (đổi so với §4.4):
   - **Hình bình hành = khoá góc chassis↔giá kẹp** (`JointData.generic`, khoá `AngZ`), không dùng motor giữ `LINK_HOLD_NM`. Khớp boom↔giá kẹp là revolute không motor.
   - **Luật servo tay nâng có hãm:** tốc độ = min(60°/sPer60Deg, |e|/dt, √(2·a·|e|)). a = 0,5·(T_s − mô-men trọng lực xấu nhất) / quán tính xấu nhất, với maxPayloadG ở u 3 cm, boom nằm ngang: 0,5 × 278,8 = 139,4 rad/s². Ngón giữ luật của `servo-arm.ts`.
   - **Quán tính rotor phản ánh của servo tay:** 5·10⁻⁵ kg·m² về trục boom (**PLACEHOLDER**, hỏi/đo theo servo thật). Chỉ đặt quán tính, khối lượng ≈ 0.
   - **Iteration cho island của xe:** +8 PGS và +4 solver iteration trên mọi body bộ gắp (thay vì +4 PGS).
   - Ngón **ma sát 0** (luật `Min`); `jawFriction` chỉ dùng cho ngưỡng tuột. Joint giữ vật, không cần ma sát. *(khám phá: trước khi có luật kẹt §5.4, ngón ma sát 0,6 nhấc khối 60 g lên 1,08 cm chỉ bằng ma sát, tức vật "được giữ" mà máy trạng thái không biết.)*
3. **Chống lật (D-G8):** phanh hết cỡ khi giữ 50 g đạt (|pitch| ≤ 0,057°, caster luôn chịu tải, dư ×1,5 như §4.4 tính). Còn hai giới hạn:
   - **Càng đâm tường mà motor vẫn đẩy thì xe chổng đầu 15,7–17,2°**, cả khi đầu ngón chạm trước. Đây là đúng hiện tượng tay servo của ADR 0001 §9 (15,85°): điểm chạm tường ở cao 5–9 cm, lực đẩy ở sàn. Thả trôi khi chạm thì 1,0° / 2,39°, ổn định trong 0,08–0,18 s. Vì vậy kịch bản kit gripper phải `endOnContact` khi càng chạm tường, hoặc để tường ngoài đường đi của càng (rủi ro đã ghi ở plan §11).
   - **Hạ tay lên vật (hay sàn) thì đầu xe nhấc lên, không "ấn 3,6 N".** Servo 0,18 N·m thắng mô-men giữ của trọng lượng (≈ 4,5 N × 0,8 cm ≈ 0,036 N·m): kịch bản 6 pitch 3,85°, caster cao 4,9 mm. Lực ấn bị giới hạn bởi trọng lượng xe, chỉ đỉnh 4,51 N lúc chạm; không tuột.
4. **Bốn luật máy trạng thái spike phải thêm** (đưa vào B2):
   1. **Chốt sau khi tuột:** không attach lại tới khi lệnh kẹp ≤ θc − 6°. Không có chốt thì càng còn đóng sẽ attach lại ngay tick sau.
   2. **Kẹt khi kẹp:** khi không giữ vật, càng chỉ dừng khi vật bị kẹp ngang (cả hai ngón trong `CONTACT_GAP_M` và khe ngàm ≤ bề rộng + 0,05 cm); mỗi ngón dừng ở góc chạm.
      - Không có luật này: ngón đóng hết sức vào khối 60 g lún 15,6 mm.
      - Dừng từng ngón ngay khi chạm: ngón kia xô khối 15 g lệch 0,5 cm sang ngang, không attach.
      - Dừng khi "cả hai chạm": dừng lúc một ngón còn mở dựa vào khối (khe 4,48 cm), không attach.
   3. **Ngón bám mặt vật đang giữ:** mỗi tick đặt đích ngón ở góc chạm, ước tính bằng khoảng cách chia đòn bẩy, đòn bẩy kẹp trong 1–5,5 cm. Lý do: attach xảy ra sớm tới 2 mm (ngón còn hở 1,4 mm), và đòn bẩy tới điểm gần nhất có thể gần bằng 0 (góc khối sát bản lề) làm đầu ngón cắm sâu 4–9 mm.
   4. **Collision group:** ngoài `GRIPPER_GROUP` (0x0004) cho collision, solver group của mọi collider bộ gắp cũng chỉ là thành viên `GRIPPER_GROUP`. Nếu không, "vật đang giữ bỏ solver group của bộ gắp" không có tác dụng: collider mặc định là thành viên của mọi group.
5. **Tất định đạt, chi phí đạt trên máy này** (§4.4, §4.5).

## 6. G0 phần vật lý — kết luận theo dòng acceptance

| Dòng (brief G0.1) | Kết quả | Bằng chứng |
|---|---|---|
| Kịch bản 1–8 đúng như mô tả, không NaN | **PASS**, với hai ngoại lệ đã giải thích: 8 ở lift 45° trượt do hình học (đổi sang 55°, §7); 5 chỉ đạt khi motor dừng lúc chạm | §4.2 |
| Phanh: pitch < 3° | **PASS**: +0,034 / −0,057° | §4.2 dòng 4 |
| Đâm tường: < 8°, ổn định trong 0,5 s | **PASS khi thả trôi lúc chạm** (1,0° / 2,39°; 0,083 / 0,175 s). **FAIL khi motor vẫn đẩy** (15,7–17,2°) | §4.2 dòng 5, §5.3 |
| Caster luôn chịu tải | **PASS khi phanh**. **FAIL ngắn** khi đâm tường lift 90° (19 tick, ≤ 2,97 mm), khi tay nâng/hạ hết tốc (≤ 20 tick, ≤ 3,34 mm, vật lý: động lượng boom > mô-men giữ của caster), và khi ấn xuống sàn (kịch bản 6) | §4.2 |
| Hash bằng nhau 4 runtime | **PASS** (3 cấu hình, 2 process Node, 3 trình duyệt) | §4.4 |
| ≤ 0,5 ms/tick median, máy này | **PASS**: 0,194 Node, 0,18–0,28 trình duyệt | §4.5 |
| Khuyến nghị collider / sensor, có số | **Collider** | §5.1, §4.3 |

**Kết luận G0 (phần vật lý): PASS có điều kiện.** Điều kiện là các đổi ở §7, cộng luật dừng khi chạm tường cho kit gripper. Ngoài vùng đã đo:
- chưa đo trên máy trường;
- chưa đo khối xoay lệch yaw;
- chưa đo vật không phải hộp.

## 7. Số cần đổi trong plan (đề xuất, chưa sửa plan: brief giới hạn task này ở spike + ADR)

| Chỗ | Hiện tại | Đề xuất | Vì sao |
|---|---|---|---|
| §4.4 giá kẹp | motor giữ `LINK_HOLD_NM = 1` trên khớp boom↔giá kẹp | khoá `AngZ` chassis↔giá kẹp (generic joint) | §4.1: lệch 9,8° và mất 50 g với motor; 0,23° với khoá |
| §4.4 luật tay nâng | luật `servo-arm.ts` | + giới hạn hãm √(2·a·|e|), a = 139,4 rad/s² | vượt 7–8,6° |
| §4.1 `GripperSpec` | — | thêm `liftRotorInertiaKgM2: 5e-5` (PLACEHOLDER) | sụt 0,27° → 0,009°, vượt 1,15° → 0,045° (rỗng) |
| §4.4 iteration | +4 PGS | +8 PGS, +4 solver iteration | §4.1; chi phí §4.5 |
| §4.4 `CONTACT_GAP_M` | không có giá trị | 2 mm | 1 tick ngón ở đầu ngàm ≈ 1,9 mm |
| §4.4 lực kẹp / tuột | "khoảng 9,6 N" | 8,09 N / 9,71 N (công thức §2) | |
| §4.1 ma sát ngón | `jawFriction 0.6` cho collider | collider ma sát 0; 0,6 chỉ cho ngưỡng tuột | §5.2 |
| §4.4 máy trạng thái | 5 điều kiện, thả, tuột | + chốt sau tuột, kẹt khi kẹp ngang, ngón bám mặt vật, solver group của bộ gắp | §5.4 |
| §4.4 "ấn khối xuống sàn với lực tối đa (3,6 N)" | giả định ấn 3,6 N | lực ấn bị giới hạn bởi trọng lượng xe; đầu xe nhấc (3,85°) | §5.3 |
| §6 bài 11 / lời giải mẫu | tay **45°** đặt lên bệ 4 cm | tay **55°** (đáy khối 4,49 cm, rơi 0,49 cm), hoặc bệ cao 3 cm | §4.2 dòng 8: ở 45° đáy khối 3,63 cm < 4 cm, đẩy bệ 4,66 cm |
| B1 test "lift 0→90° in 0.15 s ±2 ticks" | 18 ± 2 tick | **22 ± 2 tick** (0→90 đo 22, 90→0 đo 21) với luật hãm | §4.1 |
| B5 test "claw into a wall tips < 8°" | đâm tường | "đâm tường rồi thả trôi khi chạm"; kèm test "motor vẫn đẩy thì kịch bản phải kết thúc khi chạm" | §5.3 |
| B5 "caster always loaded" | mọi lúc | khi phanh và đâm tường lift ≤ 45°; nâng/hạ hết tốc cho phép caster rời ≤ 4 mm trong ≤ 0,2 s | §4.2, vật lý |
| §4.1 `massG 460` | không nói rõ | là cả xe; body chassis = 460 − 34 = 426 g | §2 |

## 8. Hệ quả cho các task sau

- **B1/B2:** dựng theo §5.2 và §5.4. Code spike (`gripper.ts`, `grasp.ts`) đã có các luật, viết lại theo TDD trong `src/core/world/robot/`.
  - Tránh lỗi spike gặp: `contactDist ≤ 0` bỏ sót contact dự đoán (Rapier phanh vật trước khi khoảng cách về 0). Kiểm "chạm" bằng `contactImpulse > 0` hoặc khoảng cách ≤ 0,5 mm.
- **B5:**
  - Thêm test cho các giới hạn ở §5.3.
  - Kiểm khởi động ở duty thấp nhất mà lời giải dùng, với tay hạ và khối 50 g. *(khám phá: boom thử nặng 30 g ở lift 0° thì xe không khởi động ở duty ≤ 140 (0,05 cm trong 0,5 s); spec 6 g thì chạy từ duty 120. Một lượt duty 110 đứng yên ở một cấu hình khác: duty 110 sát ngưỡng khởi động của xe 460 g.)*
  - Addendum cho ADR 0001 §9 như D-G8.
- **B6:** golden hash mới cho kịch bản gripper. Rover không đổi: spike không sửa `src/`.
- **D4:** lời giải bài 11 dùng tay 55° (§7). Bài 9 và 10 không có tường trên đường càng, hoặc dùng `endOnContact`.
- **E9:** chi phí gripper ước 0,22 ms/tick trên máy này. Phải đo trên profile máy trường. Nếu quá ngân sách thì bỏ +4 solver (0,113 ms, đổi lại giá kẹp lệch 0,91° khi giữ 50 g, §4.1).

## 9. Cách tái lập

Từ thư mục gốc `stem-demo`, sau `pnpm install`:

```sh
node spikes/n19-grasp/node-run.ts run1          # 8 kịch bản × 3 cấu hình, quét độ ngang, độ bền, hash -> results/node-run1.json
node spikes/n19-grasp/node-run.ts run2 --quick  # process thứ hai: hash -> results/node-run2.json
node spikes/n19-grasp/node-run.ts trace         # các biến thể luật / khoá / iteration (§4.1) -> results/trace.json
node spikes/n19-grasp/node-run.ts cost          # ms/tick, 5 lần lặp (§4.5) -> results/node-cost.json
node spikes/n19-grasp/browsers.ts               # build trang, vite preview :5401, Chromium/Firefox/WebKit -> results/browsers.json
pnpm exec tsc -p spikes/n19-grasp/tsconfig.json # typecheck code spike
```

Tài liệu đã dựa vào: type definitions đã cài trong `node_modules/@dimforge/rapier3d-deterministic-compat/dist/**/*.d.ts`:
- `JointData.fixed`, `JointData.generic`, `JointAxesMask`;
- `RevoluteImpulseJoint` motor/limits, `ImpulseJoint.setContactsEnabled`, `World.createImpulseJoint/removeImpulseJoint/contactPairsWith/contactPair`;
- `TempContactManifold.contactImpulse/contactTangentImpulseX/Y/contactDist`, `Collider.contactCollider/setCollisionGroups/setSolverGroups/setSensor`;
- `InteractionGroups` (16 bit thành viên | 16 bit lọc), `RigidBodyDesc.setAdditionalPgsIterations/setAdditionalSolverIterations`, `RigidBody.setAdditionalMassProperties`;
- `MultibodyJoint`: bản JS 0.21 không có motor hay set limits, nên bị loại;
- `IntegrationParameters`: không có tham số độ mềm joint.

Không dùng tài liệu web.

## 10. Code spike

`spikes/n19-grasp/`:

| File | Nội dung |
|---|---|
| `params.ts` | số §4.1 (PLACEHOLDER) và hình học suy ra |
| `gripper.ts` | thân, joint, luật servo, khoá, kẹt |
| `grasp.ts` | máy trạng thái |
| `sim.ts` | ghép builder production, đo, hash |
| `scenarios.ts` | 8 kịch bản, quét, độ bền, đo thời gian |
| `trace.ts`, `cost.ts` | khám phá §4.1, chi phí §4.5 |
| `node-run.ts` | runner Node qua Vite SSR loader, như `scripts/verify-attempt.mjs` |
| `browsers.ts`, `main.ts`, `index.html`, `vite.config.ts` | trang và harness trình duyệt |

Spike giữ tới khi B1/B2 có test tương đương, rồi xoá như `spikes/robot-physics/`.

## 10b. Bổ sung khi làm B1/B2 (production, `src/core/world/robot/gripper.ts`, `grasp.ts`)

Đo trên cùng máy §3 (Apple M4 Pro, Node v24.22.1, Vitest 4.1.11); test ở `src/core/world/robot/gripper.test.ts`, `grasp.test.ts`, `src/core/world/world.gripper.test.ts`.

- **Gia tốc hãm của tay nâng là 125,2 rad/s², không phải 139,4.** Con số 139,4 ở §5.2 là nửa của 278,8 = (T_s − τ_g)/I với I chưa có quán tính rotor. Code spike tính `liftDecelRadS2(rotor 5e-5) = 250,47`, nửa là 125,235, và mọi số đo ở §4 đều chạy với giá trị đó. Ngoài ra, "quán tính riêng của boom" 2,22·10⁻⁵ trong công thức là quán tính chính quanh trục **đứng** của boom (đọc từ engine). Quanh trục nâng nó chỉ là 1,71·10⁻⁶ kg·m², cộng 5·10⁻⁵ của rotor. World production với 125,2 cho lại đúng các số của §4.1 và §4.2:
  - hàng "chọn": sụt −0,009°, 0→90 trong 22 tick, vượt 0,045°;
  - giữ 50 g: lệch ngang đứng −0,231°, lỗi góc 0,049°, vượt 1,273°;
  - kịch bản 1: attach ở 1,208 s, θc 19,94°.

  Với 139,4 thì 0→90 trong 21 tick, vượt khi giữ 50 g 1,67°, và khối 50 g lệch 1 cm lún 2,154 mm, quá 2,1 mm của test B2.
- **Luật kẹt (§5.4 luật 2): ngón dừng, không bị mở ra.** Spike đặt giới hạn của mỗi ngón ở góc chạm ước tính, nên một ngón đang lún vào vật bị mở ra theo độ lún / đòn bẩy (tối thiểu 1 cm). Kết quả đo với khối 60 g (không bao giờ attach), lệch ngang 0,25–1 cm:
  - ngàm mở lùa khối vào giữa, một ngón lún 1,3–2,1 mm sát bản lề;
  - ngón đó bị mở tới chặn (β 12°), ngón kia đẩy khối xoay 5,7–7,4° (β −5,4°).

  Production lấy min(góc chạm, góc hiện tại): càng kẹt ở 25–28°, khối xoay 1,1–3,8°. Lấy trung bình hai góc chạm cho cả hai ngón (như một servo qua bánh răng) thì tệ hơn: càng ở 9–17°, khối xoay 3,3–3,6°. Khối 15/50 g không đổi kết quả, vì attach (khe ≤ bề rộng + 0,3) luôn đến trước kẹt (+ 0,05).
- **Xe gắp đứng yên từ trạng thái nghỉ thì có khi không khởi động được ở duty ≤ 160** (việc của B5, ghi lại để B5 biết). Đo: duty 140 trong 1 s đi 0,001–0,005 cm ở sa bàn 300 × 300 hoặc 400 × 400 với tay 0° hoặc 45°. Ở sa bàn 200 × 100, điểm (40, 50), tay 45° cũng vậy. Các trường hợp khác đi 15,4–15,6 cm. Từ duty 200 thì luôn đi. Builder của spike (`spikes/n19-grasp/sim.ts`, cấu hình `tuned-collider`) cho đúng các số này, nên đây là tính chất của mô hình đã đo, không phải của bản viết lại; bỏ +4 solver iteration cũng không hết. Rover khởi động ở mọi trường hợp đó (duty 120: 10,7 cm). Test B1/B2 dùng sa bàn 200 × 100 và điểm (40, 50), nơi duty 140 khởi động được.

## 11. I²C (G0.2): parity cảm biến màu TCS34725 trên avr8js — **GO**

**Bối cảnh.** Bài 10 (Phân loại theo màu) và U-38/U-39 cần cảm biến TCS34725 đọc qua Wire thô (D-G7). Câu hỏi: harness C2 của N18 có so được trace của simulator với HEX thật trên avr8js 0.21.1 khi chương trình nói chuyện I²C hay không, và mỗi lời gọi tốn bao nhiêu µs.

**Đã làm** (`spikes/avr8js/`, `node spikes/avr8js/run-gripper.ts`, kết quả `out/gripper-results.json`):
- `tcs34725-model.ts`: model thanh ghi TS thuần (không import, chỉ + × / floor), dùng chung cho cả hai phía; A3 chuyển nguyên file sang `src/core/hardware/devices/tcs34725.ts`.
- `twi-device.ts`: `TWIEventHandler` cho avr8js, hoàn tất mỗi pha sau đúng thời gian bus tính từ TWBR (datasheet 7810D §21.5.2: SCL = 16 MHz / (16 + 2·TWBR·prescaler); TWBR = 72 → 160 cycle, 100 kHz; byte 9 SCL, START/STOP 1 SCL mỗi cái — PLACEHOLDER đến L3).
- Sketch `gripper-forms` (servo, IR, cảm biến màu dưới 7 vùng sáng, và chạy lại không có thiết bị → NACK), `gripper-costs` (µs mỗi lời gọi, như EMU-08).

**Kết quả** (Apple M4 Pro, Node 24.22.1, arduino-cli 1.5.1, arduino:avr 1.8.8, Servo 1.3.0, Wire 1.0; số đo bằng cycle nên không phụ thuộc tải máy):
- Mọi dòng Serial khớp phía TS: C R G B của từng màu và lớp màu (đỏ, xanh lá, xanh dương, vàng, trắng, đen, không rõ); NACK → 0 0 0 0, "không rõ", không timeout.
- Thời gian bus của từng pha đúng datasheet (trễ ≤ 5 cycle: lệnh đang chạy + vào ngắt). Mỗi transaction (START → STOP) so với model = thời gian bus + phần CPU không bị ngắt: không có ngắt khác chen vào thì ≤ +0,9 %; có ngắt khác (Servo, Timer0, USART) thì dài thêm tối đa 3,08 % nhưng không bao giờ quá thời gian các ngắt đó chạy (`isr-load` của harness).
- Cửa sổ tích phân kết thúc mỗi 52,8 ms (RGBC Init 2,4 ms mỗi chu kỳ, datasheet TAOS135 Figure 9), cửa sổ đầu 52,8 ms sau khi ghi AEN.
- Servo: độ rộng xung đúng Servo.h (kẹp 544 → 1368 → 1472 (120 bị kẹp) → 544; tay 1472 → 544 → 1008), cả hai trên Timer1 trong cùng khung 20 ms (xung tay lên 10,75 µs sau khi xung kẹp xuống).
- Chi phí (EMU-20, µs): `gripperSet` 51,625; `colorFetch` 1158,5 (NACK 146,0625); `colorBegin` 1350,5625 + delay(3) + delay(54) (NACK 589,4375); `colorClassify` 128,1…147,25; `digitalRead(A3)` 3,9375 (bằng khoá `digitalRead` hiện có).
- Biên dịch (CC-06): gripper-forms 7240 B flash (22 %), 456 B RAM (22 %); Wire chiếm 216 B RAM; không cảnh báo nào từ sketch, Wire hay Servo.

**Một khác biệt của avr8js đã sửa trong adapter:** `completeStop()` bật TWINT sau STOP, datasheet thì không (§21.6). Để nguyên thì mỗi transaction chạy thêm một ngắt TWI (+6,19 µs; +12,4 µs mỗi colorFetch, tức +1,07 %). `twi-device.ts` xoá cờ đó.

**Quyết định: GO.** U-38/U-39 và bài 10 giữ trong N19. Điều kiện cho C2/A3:
1. `tests/parity/emulated-uno.ts` gắn `AVRTWI` + `TimedTwiBus` (có sửa TWINT sau STOP); model TS là một, phía board gọi ở thời gian bus, phía simulator ở thời gian chương trình.
2. Dung sai độ rộng xung servo của kit gripper phải rộng hơn 4 µs của N18 (đo được +5,19 µs do Timer0, ngắt TWI dài tới 20,1 µs vì `twi_stop()` chờ STOP ngay trong ngắt) — theo kit, để assertion của rover không đổi.
3. Board đọc 8 byte dữ liệu trải trong 336…1021 µs; simulator đọc một lúc. Driver đọc từng byte ở offset bus của nó, hoặc fixture giữ ánh sáng không đổi quanh lúc đọc.
4. `costsUs` mới: `gripperSet`, `colorFetch`, `colorFetchNack`, `colorBegin`, `colorBeginNack`, `colorClassify` (số ở trên); evidence EMU-19, EMU-20, CC-06.

**Nếu sau này no-go** (chưa xảy ra): U-38/U-39 DEFERRED, bài 10 hoãn; tay gắp và IR vẫn ship.
