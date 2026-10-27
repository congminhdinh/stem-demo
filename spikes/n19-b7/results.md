# N19 B7: xe tay gắp quay chậm khi đứng yên (spike, số đo)

Máy: Apple M4 Pro (12 core, 24 GB), Darwin 25.5.0, Node 24.22.1, Vitest 4.1.11, Rapier deterministic 0.21.0, Playwright 1.63.0
(Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6). Ngày 2026-10-27. Load là `uptime` (trung bình 1 phút) lúc chạy.

**Cây nào.** Spike đo code production qua `getRapier()` (vá prototype của Rapier, `lib.ts`). Các số "trước fix" (mục 1–5) chạy trên cây
worktree khi chưa sửa gì (09:57–10:15, đúng master 7758ec9), hoặc trên một bản xuất của master:

```
git archive 7758ec9 | tar -x -C <scratch>/b7-base && ln -s $PWD/node_modules <scratch>/b7-base/node_modules
cp -R spikes/n19-b7 <scratch>/b7-base/spikes/ && cd <scratch>/b7-base && ./node_modules/.bin/vitest run --config spikes/n19-b7/vitest.config.ts <file>
```

Các số "sau fix" (mục 6) chạy trên HEAD của nhánh `n19/b7-rest-creep`.

| File | Đo gì | Lệnh |
|---|---|---|
| `lib.ts` | chạy bài qua run session (Chạy, headless) tới hết chương trình, lắng, rồi đo cửa sổ với các "gỡ bỏ" | |
| `creep.test.ts` | tốc độ quay và trôi khi đứng yên cuối mỗi bài | `OUT=<tên> CASES='[...]' pnpm exec vitest run --config spikes/n19-b7/vitest.config.ts creep` |
| `sweep.test.ts` | xe dừng trên sàn phẳng, quét lift × claw (không lịch sử) | `OUT=… LIFTS='[…]' CLAWS='[…]' [PRE=…] [PICK=1\|hold] [HOLD=1] … sweep` |
| `timeline.test.ts` | tốc độ quay theo thời gian trong lượt chạy | `KEY=rb-grip-stack UNTIL=20 … timeline` |
| `contacts.test.ts`, `push.test.ts` | manifold của bi đỡ; Rapier JS có báo xung lực ma sát không | `… contacts`, `… push` |
| `holdprobe.test.ts`, `holdjump.test.ts` | điều kiện giữ khi đang giữ khối; ảnh đổi bao nhiêu lúc giữ | `… holdprobe`, `LIFT=90 MASS=15 … holdjump` |
| `golden.test.ts` | mọi giá trị của golden xác định trên Node | `OUT=head … golden` |
| `record-pins.ts`, `vitest.pins.config.ts`, `pins.mjs` | mọi số mà matcher số nhận được trong `src/core/world`, BASE so với HEAD | `PINS_OUT=<f> pnpm exec vitest run --config spikes/n19-b7/vitest.pins.config.ts`; `node spikes/n19-b7/pins.mjs <base> <head>` |
| `rest-draws.mjs` | bản sao probe trình duyệt của E9 (số frame vẽ khi đứng yên) | `node spikes/n19-b7/rest-draws.mjs <key>` (dev server cổng 5572) |

## 1. Tái hiện (trước fix, load 4,5–10,8)

Chạy bài bằng run session như nút Chạy, headless; đo 10 s bắt đầu 2 s sau khi chương trình xong. Yaw lấy từ quaternion của chassis (float64).
`results/stack-pose.json`, `results/programs-base.json`, `results/stack-remove-one.json`.

| Bài (lời giải mẫu) | xong lúc | yaw (°/s) | trôi (cm/s) | tay lúc cuối |
|---|---:|---:|---:|---|
| rb-grip-stack biến thể 0 / 1 / 2 | 11,1 s | −1,015e-2 / −1,016e-2 / −1,017e-2 | 2,13e-4 | lift 54,986°, claw 0° |
| rb-grip-pick | 8,5 s | 2,08e-7 | 0 | lift 0° |
| rb-grip-deliver | 28,5 s | 1,69e-11 | 0 | lift 0° |
| rb-grip-sort | 6,2 s | 3,60e-5 | 5,96e-7 | lift 0° |
| rb-square-route (rover) | 21,4 s | −1,035e-4 | 1,08e-6 | |

- Bánh xe quay ngược nhau ±4,03e-4 rad/s: xe xoay quanh điểm giữa trục bánh, đúng như E9 đo trên trình duyệt (0,0101 °/s).
- Cuối bài stack, xe chỉ chạm sàn (bi đỡ, caster, mép bánh): không chạm bệ hay khối.

Mọi chương trình của bốn bài (`results/programs-base.json`). Ngoài stack, chỉ hai chương trình có tay ở giữa hai chặn:
- stack exploit `hold-over-base` (giữ khối ở 55°): −1,96e-2 °/s;
- stack exploit `arm-too-low` (45°): −1,06e-2 °/s.

Các chương trình khác kết thúc ở lift 0° và có |yaw| ≤ 1,1e-4 °/s. Trong đó có hai trường hợp vượt nhẹ 1e-4:
- stack `place-beside-base`: 1,11e-4 °/s;
- pick `hold-in-zone` (giữ khối trên sàn): 4,9e-4 °/s.

## 2. Các nghi phạm của brief, từng cái và theo ma trận (trước fix)

"Gỡ" một nghi phạm nghĩa là tắt nó từ đầu cửa sổ đo. Thanh ghi trạng thái cuối bài giống nhau ở mọi trường hợp.
`results/stack-remove-one.json`, `results/stack-matrix.json`.

| Nghi phạm | Gỡ cái đó (°/s) | Chỉ còn cái đó, gỡ 4 cái kia (°/s) |
|---|---:|---:|
| không cho ngủ | −1,015e-2 | −1,168e-2 |
| làm mới contact bi đỡ mỗi tick | −1,002e-2 | −1,168e-2 |
| `LINK_HOLD_NM`: không có trong production. §4.6 thay bằng khoá AngZ; đo bằng cách gỡ khoá | −1,205e-2 | −9,846e-3 |
| chạm bệ/khối: không chạm; dời hai vật đi 1 m | −1,015e-2 | −1,168e-2 |
| ma sát khi thả trôi: đóng băng `setFriction` theo tải và gỡ lực drive (lực ngang) | −9,94e-3 / −9,97e-3 | −1,185e-2 |
| gỡ cả năm | | −1,168e-2 |

- **Về ngủ.** Chassis của **cả hai kit** đều `setCanSleep(false)` (assembly.ts:165), tay servo của rover cũng vậy. Nên rover không đứng yên nhờ ngủ: nó đứng yên vì không có tay gắp giữ tải.
- Cho mọi body ngủ (setCanSleep true lúc dựng, `addForce`/`addTorque` không đánh thức) vẫn không làm body nào của xe ngủ: chỉ hai vật ngủ.
- **Kết luận:** không nghi phạm nào trong năm cái tạo ra tốc độ quay này.

## 3. Nguồn thật: motor của servo nâng giữ boom (trước fix)

`results/stack-perturb*.json`, `results/stack-motoron.json` (cây BASE).

| Thay đổi lúc đứng yên (từ đầu cửa sổ) | yaw (°/s) |
|---|---:|
| không đổi | −1,015e-2 |
| boom giữ bằng giới hạn của khớp, đóng lại ở góc hiện tại, motor tắt (`liftLimit`) | **6,509e-6** (trôi 3,6e-6 cm/s) |
| giới hạn đóng lại ở góc hiện tại, motor vẫn chạy | −5,105e-6 |
| motor vị trí (k 200, d 1) thay motor vận tốc | −1,035e-2 |
| motor vận tốc mục tiêu 0, giảm chấn thuần (tay sụt 55 → 51,5° trong 2 s) | −1,030e-2 |
| tắt motor của hai ngón | −1,014e-2 |
| đặt vận tốc mọi body của xe về 0 (một lần) | −1,017e-2: quay lại ngay trong tick sau, nên nguồn sinh ra ở từng bước chứ không phải động lượng còn tồn |
| solver 8 / 16 vòng (thay 4) | −6,45e-3 / −3,60e-3 |
| PGS nội 4 (thay 1) | −6,05e-3 |
| bỏ vòng lặp thêm của bộ gắp (+4 solver, +8 PGS) | **−3,17e-1** (gấp 31 lần) |

- **Cơ chế.** Motor của khớp là ràng buộc vận tốc mềm. Ở đây nó gánh trọng lượng boom, nhưng không bao giờ thoả khi đứng yên: luật hãm đòi error/dt, khoảng 0,03 rad/s ở 55°, trong khi boom đứng im.
- Phần lời giải PGS còn sót mỗi bước lọt vào yaw của chassis, mà yaw chỉ được ma sát của hai bi đỡ giữ.
- Càng nhiều vòng lặp, phần sót càng nhỏ.
- Giới hạn của khớp là ràng buộc cứng của cùng khớp đó, nên không gây ra phần sót này.
- Ở lift 0° và 90°, boom tựa vào chặn của khớp. Ba bài còn lại kết thúc ở 0°, nên chúng không quay.

**Sàn phẳng, không lịch sử.** Xe đặt tay, lùi 1 s ở duty 128, thả trôi, lắng 3 s, đo 10 s (`sweep.test.ts`; `results/sweep-hold-0.json`, `results/sweep-hold-1.json`; load 4–6):

| lift \ claw | 0° motor / giữ | 40° motor / giữ | 80° motor / giữ |
|---|---|---|---|
| 0° | 4,9e-7 / 1,9e-7 | −1,3e-5 / −1,3e-5 | 2,8e-7 / −4,6e-6 |
| 10° | −2,49e-4 / −4,2e-6 | −2,27e-4 / −1,8e-5 | −1,86e-4 / −7,4e-6 |
| 30° | −2,07e-4 / −5,4e-8 | −1,98e-4 / −2,5e-5 | −1,89e-4 / −2,8e-6 |
| 55° | −1,50e-4 / 3,1e-6 | −1,67e-4 / 6,2e-6 | −1,85e-4 / 7,1e-6 |
| 70° | −7,8e-5 / 1,2e-5 | −1,16e-4 / 1,2e-5 | −1,47e-4 / 1,6e-5 |
| 90° | −1,1e-6 / 1,1e-5 | −3,5e-5 / 6,7e-6 | −1,01e-4 / 8,0e-6 |

- Trôi ≤ 4,9e-6 cm/s ở mọi ô.
- **Lịch sử.** Cùng tư thế cuối bài stack và cùng chặng cuối đó trên sàn phẳng (`results/sweep-*.json`): −1,5e-4 đến −1,8e-4 °/s, nhỏ hơn bài stack khoảng 60 lần.
- Gắp, nâng 55°, thả rồi lùi: −8,4e-8 / −8,5e-5 °/s.
- Timeline (`results/timeline-stack.json`): tốc độ −1e-2 đã có khi xe đứng ở cuối vạch (9,5–10 s), trước khi lùi.
- Sai số khớp như nhau, cỡ micromet (`results/stack-joints.json`, `results/sweep-joints.json`).
- Vậy độ lớn phụ thuộc trạng thái solver mà lượt chạy để lại (warm start, thứ tự ràng buộc). Cái này chưa xác định được khi không có source Rust; với fix thì không cần biết.

**Ma sát.** Rapier JS báo `contactTangentImpulseX/Y` = 0 cả khi ma sát rõ ràng đang làm việc (`results/push.txt`): đẩy ngang 0,3 N, xe chỉ dịch 1 µm. Vì vậy không đọc được ma sát từ manifold.

## 4. Thiết kế fix: những gì đã thử (cây đang sửa, load 6–17)

| Thử | Kết quả |
|---|---|
| giữ bằng giới hạn, motor tắt, sau 0,25 s đứng yên | 8 test B5 trượt; một cái vượt bound: lift 45°, 50 g u 4 lắng 0,61 s > 0,5 s |
| giữ bằng giới hạn, motor vẫn chạy, 0,25 s | lúc giữ khối vẫn quay 3,4e-4–9,4e-4 °/s; một cú đâm tường 8,016° > 8° |
| motor tắt, 1 s | còn một test trượt: xe dựa tường 11° (tay 90°, 50 g) đổi góc nghiêng 0,54° > 0,5° |
| + bắt buộc đứng trên ba điểm tựa (hai bi đỡ và caster chạm sàn) | mọi test world qua |
| ngón tay phải đứng yên | khi giữ khối, ngón tự chỉnh theo mặt khối tới 0,013°/tick (`results/holdprobe.txt`), nên giữ không bao giờ vào. Thay bằng: lệnh claw không đổi trong cả 1 s |
| 0,6 s thay vì 1 s | 4 test B5 trượt, vì giữ vào trong lúc pick gắp khối (0,3 s + attach + 0,2 s, lệnh không đổi) |
| giữ cả ngón, với mọi claw | một cú đâm tường càng rỗng lắng 1,09 s > 0,5 s |
| giữ ngón **chỉ khi đang giữ vật** | mọi test qua |

- **Vì sao giữ ngón khi đang giữ vật.** Chỉ giữ tay nâng thì khối 15 g ở 90° (sau 1 s tiến) vẫn quay −1,30e-4 °/s. Tắt motor ngón: 1,3e-6 (`results/held-fingers-off-*.json`).
- Khi giữ vật, motor ngón chỉ chỉnh ngón theo mặt vật mỗi tick (luật 3 của grasp). Khớp ngón quay quanh trục đứng, nên phần sót đi thẳng vào yaw.
- Claw rỗng chỉ giữ tay nâng: còn ≤ 2,5e-5 °/s.

**Chọn.** Giữ khi đủ mọi điều kiện:
- 1 s (120 tick), ba điểm tựa chạm sàn, drive dừng;
- chassis chậm hơn 0,1 cm/s và 0,57 °/s;
- lệnh lift và claw không đổi;
- boom tới lệnh trong 0,1° và quay chậm hơn 0,01 rad/s.

Khi giữ: boom và (nếu đang giữ vật) hai ngón khoá bằng giới hạn khớp ở góc hiện tại, motor tắt.

## 5. Ảnh đổi bao nhiêu lúc bắt đầu giữ (HEAD, chỉ tay nâng; `results/holdjump-*.txt`)

So từ tick trước lúc giữ tới 1 s sau, với ngưỡng của view (scene-math.ts):
- chassis và vật dời ≤ 2,4e-4 cm (ngưỡng 0,01 cm);
- quaternion đổi ≤ 7,7e-6 (ngưỡng 1e-5);
- bánh đổi ≤ 2,6e-5 rad (ngưỡng 1e-3);
- lift đổi ≤ 7,1e-4° (ngưỡng 0,05°).

Mỗi số đều dưới ngưỡng. Nhưng cộng với độ quay đã dồn từ frame vẽ cuối, quaternion có thể vượt 1e-5 **một lần**: một cặp frame cuối cùng, khoảng 1 s sau khi xe dừng, rồi không vẽ nữa.

## 6. Sau fix (HEAD, code cuối)

**Tests mới:**
- `src/core/world/robot/gripper.rest.test.ts`: đo cho từng tư thế, giữ vật, chạm bệ, và các luật giữ;
- `src/core/run/robot-run-session.gripper-rest.test.ts`: trạng thái cuối của bốn bài, |yaw| < 1e-4 °/s và trôi < 1e-4 cm/s trong 10 s;
- `src/ui/robot3d/stack-at-rest.test.ts`: 0 lần đổi ảnh trong 10 s. Trước fix: 49 lần vẽ lại scene trong cùng cửa sổ.

**Mọi chương trình** (`results/programs-head.json`, so với `programs-base.json`):
- bài stack: mẫu −1,02e-2 → −4,6e-8, mù −1,02e-2 → −5,9e-7, exploit 45° −1,06e-2 → −3,3e-7 °/s;
- mọi chương trình kết thúc không giữ vật: |yaw| ≤ 3,9e-5 °/s;
- **còn hai exploit đang giữ khối vượt 1e-4:**
  - stack `hold-over-base` (khối lơ lửng trên bệ ở 55°): −1,96e-2 → −1,66e-4 °/s;
  - pick `hold-in-zone` (giữ khối đang nằm trên sàn ở 0°): −4,9e-4 → −3,7e-4 °/s;
  - cả hai đều đã vào trạng thái giữ (giới hạn khớp đóng). Phần còn lại là sai số của chuỗi khớp, khuếch đại theo lịch sử như mục 3. Chưa tìm ra nó, khi chưa có source Rapier.

**Sàn phẳng, giữ vật 15/50 g ở lift 10–90°, sau ba kiểu chặng cuối** (`results/held-flat-*.json`): |yaw| ≤ 7,4e-5 °/s, trôi ≤ 1,2e-6 cm/s.

**Trình duyệt** (`results/rest-draws.txt`, probe của E9, Chromium SwiftShader):
- rb-grip-stack vẽ **0 frame** trong 5 s đứng yên (E9 đo 50);
- yaw đổi 8,2e-7° trong 5 s, tức 1,6e-7 °/s;
- pick, sort, deliver: 0.

**Rover** (`results/trace-rover.txt`):
- 137 450 lời gọi Rapier, hash chuỗi lời gọi `cc380608c8cf55d9`, hash snapshot `9d88c7f8e50b1b35`;
- giống hệt BASE (và giống số B5/B6 ghi lại);
- ba golden fixture và hai check của rover không đổi (`results/golden-base.json`, `results/golden-head.json`).

**verify:attempt** (`results/attempts.txt`): attempt tạo trên BASE, kiểm trên HEAD. 23/23 attempt rover và 19/19 attempt tay gắp (mẫu, mù, exploit) đều `match`, tức mọi điểm bài học giữ nguyên.

**Golden đổi:**
- `gripper-stack` `9378dcbe`/`60ce8067` → `42a76f26`/`ac6f2b46`;
- `final` của bốn check bài tay gắp;
- `gripper-pick-place`, `gripper-sensors` không đổi.

**Số đã pin của B1–B6** (`results/pins-diff.txt`, `results/b56-sweep-diff.txt`): 63/2 303 lần gọi matcher nhận số khác, đều trong pin và bound của nó. Trong đó:
- quãng phanh 1,66858 → 1,66850 cm;
- khe caster khi hạ tay hết tốc 3,33648 → 3,33638 mm (pin 3,336 ± 0,005);
- claw kẹt ở 26,9375 → 26,9383°;
- góc claw kẹt một khối bị latch sau nhiều giây đứng ở tường 26,69 → 27,90° (bound < 40);
- còn lại là thời gian của các test chi phí.

**e2e** (`results/e2e.txt`):
- xác định trên Chromium, Firefox và WebKit: 6/6;
- G1 qua với hash mới;
- mọi spec robot: 131 qua, 1 trượt. Cái trượt là `robot-lab-gripper-ui.spec.ts:339` bản của master:
  - trên master nó qua 3/3; trên HEAD trượt 3/3 (load 5–9) và 2/3 (load 18), vì cặp frame của mục 5 rơi vào cửa sổ 1,5 s tính theo giờ tường của nó;
  - bản viết lại của E10 (nhánh `n19/e910-bench-e2e`) đo theo đồng hồ world từ sau cặp frame cuối và qua 3/3 + 3/3 trên HEAD.

**Chi phí** (`results/cost.txt`): không phân biệt được BASE với HEAD ở load 10–13. Tick của chính rover, code giống hệt nhau ở hai cây, đã dao động 0,083–0,217 ms median.
