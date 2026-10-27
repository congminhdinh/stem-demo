# Spike N19 D4: soạn bốn bài xe tay gắp (đo, seed, lời giải, exploit)

Máy: Apple M4 Pro, macOS (Darwin 25.5), Node 24.22.1, pnpm 12.8.1, Playwright 1.63.0 (Chromium, Firefox, WebKit của nó).
Máy dùng chung với các agent khác: `uptime` lúc chạy cho load 5–24 (ghi cạnh từng phần). Số ở đây là **số đo**, không phải ước lượng, trên kit
**PLACEHOLDER** `ref-uno-gripper@0` tại commit `a30581d` (master có B5+B6) cộng nhánh `n19/d4-lessons`.

Mọi spike chạy bằng config riêng (Rapier alias và inline như test của repo):

```sh
SPIKE=<tên> pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts <file>
```

| File | `SPIKE=` | Làm gì | Kết quả |
|---|---|---|---|
| `measure.test.ts` | `measure` | Tốc độ, quay, tiếp cận khối với IR | `results/measure.json` |
| `capture.test.ts` | `capture` | Khối lệch trục bao nhiêu thì càng vẫn gắp; tốc độ quay khi giữ khối | `results/capture.json` |
| `seeds.test.ts` | `seeds` | Offset của seed 0–19 999 cho bốn bài, bán kính 16 cm | `results/seed-offsets.json` (4,9 MB, không commit; chạy lại để có) |
| `run.test.ts`, `programs.ts`, `check.sh` | `run` | Chạy thử một chương trình nháp (trace một lượt, hay Kiểm tra mọi lượt) | `results/trace-*.txt`, `results/check-*.json` (không commit) |
| `solutions.test.ts` | `solutions` | Mọi chương trình của bốn bài trong `src/samples/robot-solutions.ts` qua Kiểm tra thật, headless | `results/solutions.json` |
| `drives.test.ts` | `drives` | Bốn lời giải mẫu headless, 1×, 4×: điểm và hash world cuối từng lượt | `results/drives.json` |
| `golden.test.ts` | `golden` | Mọi Kiểm tra của `tests/robot-determinism.fixtures.ts` trên Node | `results/golden-checks.json` |
| `tints.test.ts` | `tints` | Tương phản mực hoa văn của mặt thảm với màu vùng ứng viên | `results/tints.txt` |
| `make-attempts.mjs` | (node) | Attempt trung thực như STEMLearning lưu (`ATTEMPT_KEYS=gripper` cho bài tay gắp) | file JSON chỉ định |

`check.sh` gọi `run.test.ts` cho nhiều cặp `key:chương trình nháp`, ví dụ `bash spikes/n19-d4/check.sh rb-grip-stack:stackLowerFully`.

## 1. Chuyển động (load 24 → 6)

`measure.test.ts`, sa bàn 400 × 200 không tường, tay hạ trừ khi ghi khác:

| | Đo |
|---|---|
| 50 % | 13,2 cm/s khi đã chạy đều (6,6 cm mỗi 0,5 s), tay hạ hay nâng như nhau |
| 60 % / 70 % / 100 % | 20,0 / 27,0 / 47,6 cm/s |
| Quay trái 50 %, 830 ms | 82,1° (tay nâng, không giữ), 81,6° khi giữ khối; tâm thân dời 2,8 cm (quay quanh trục bánh) |
| Quay 50 %, 900 ms | 91,5° (đo trong lời giải bài 9: yaw 90 → −178,5) |
| Dừng ở 50 % | dời thêm 0,28 cm |
| Tay 90° → 0° | 0,15 s; siêu âm đọc 2 cm (`#gripper`) khi tay qua 31° |
| Tiếp cận ở 50 % | siêu âm nghe khối 4 cm từ 18,98 cm (giữa thân cách tâm khối 27,8 cm), tiếng vọng cuối 3,96 cm, rồi không có tiếng vọng; IR thấy khối khi tâm khối cách giữa thân 12,55 cm; máy gắp giữ khối 0,04 s sau khi IR thấy (dừng, kẹp đóng) |
| Khối đang giữ | tâm cách giữa thân 12,27 cm ở tay 0°, 11,65 cm ở tay 90° (z tâm 9,0 cm) |

## 2. Khối lệch trục (`capture.test.ts`, load 7)

Tiến 50 % với tay hạ, càng mở, tới khi IR thấy, rồi kẹp và nâng. Khối đặt trước 60 cm theo hướng xe, lệch ngang dy, xe quay 0°, ±2°, ±3°: **65/65
lần đều gắp được**, nhưng:

Khối dời (từ chỗ nằm tới chỗ được giữ sau khi nâng, gồm 0,6 cm của lúc nâng) và xe đổi hướng:

- |dy| ≤ 1 cm (25 lần): khối dời 0,6–2,4 cm, xe đổi hướng 0–2,8°;
- |dy| = 1,5 cm (10 lần): khối dời 4,8–6,6 cm, xe đổi hướng 2,9–4,2°;
- |dy| = 2–3 cm (30 lần): khối dời 8,5–32,8 cm, xe đổi hướng 3,8–9,4°.

Vì vậy bài 8 đặt khối theo khoảng cách tới tường xa, bài 10 đặt khối gần (19 cm), bài 9 và 11 bám vạch.

## 3. Seed (`seeds.test.ts`, load 6)

| Bài | Ghim của §6 | Ứng viên đạt (trên 20 000) | Seed chọn | Lượt 1 | Lượt 2 |
|---|---|---|---|---|---|
| 8 | khối một lượt ≥ +7, một lượt ≤ −7 | 855 | **23** | khối +9,282; xuất phát (0,621; −0,717), +1,305° | khối −9,974; (0,105; −0,425), −1,890° |
| 9 | quay ≥ 4°; xuất phát dọc vạch ≥ 4 và ≤ −4 cm | 357 | **430** | dọc −5,410, −4,868°; kiện +3,263 / −3,168 / −2,570 | dọc +5,141, +3,517°; kiện −1,707 / +2,202 / +0,454 |
| 10 | không dời vị trí, ±3° | (mọi seed) | **8** | −2,307° | +2,946° |
| 11 | xuất phát dọc ≥ +9 và ≤ −9 cm | 583 | **217** | dọc −11,959; khối +3,481 | dọc +9,400; khối −3,745 |

Lý do chọn:
- Seed 23 có cả hai hướng quay. Seed 430 và 217 dời cả xuất phát lẫn vật theo hai chiều.
- Bài 10 có quay ở cả hai phía.
- Không chọn seed nào để tránh jitter cho lời giải mẫu: lời giải qua được nhờ thiết kế sa bàn (mục 2).
- **Ghi chú bài 9:** lúc đầu xuất phát ở y 22, các lần bốc dọc dưới −4 cm bị loại (vòng 16 cm chạm tường nam), nên không seed nào đạt. Dời xuất phát lên y 26 thì đạt.

## 4. Bốn lời giải mẫu (`solutions.test.ts`, `drives.test.ts`; load 5–14)

| Bài | Điểm | Từng lượt | programHash | Hash world cuối (headless = 1× = 4×) | Vật ở cuối |
|---|---|---|---|---|---|
| 8 | 100 | 100 / 100 / 100 | `810d030630f07c96…` | `d8b9f15d` `72464d2f` `96810539` | khối (137,31; 45,01), (137,32; 44,89), (137,48; 47,76); vùng thả x 108–148, y 25–65 (sau fix round 1, mục 8) |
| 9 | 97 | 97 / 97 / 97 (thưởng 7) | `12b1f432f405eb4a…` | `4139d036` `b5779bbe` `02ab692c` | kiện x 75,6–77,9, y 54,7–111,3; kho x 62–100, y 40–125 |
| 10 | 100 | 100 / 100 / 100 | `fe8b83b33e9c63aa…` | `8c60c9a1` `0e3bbe2f` `bd401fe3` | xanh lá (88,00; 75,00), đỏ (33,91; 128,71), xanh dương (33,84; 21,42): giữa vùng |
| 11 | 97 | 97 / 97 / 97 (thưởng 7) | `9243bbc3916beacb…` | `14603576` `60686846` `3ca8a6ec` | khối z 5,95 trên bệ, lệch 0,11–0,19 cm; bệ không dời |

Ba cách chạy (headless, realtime 1×, realtime 4×) cho cùng điểm, `programHash` và hash từng lượt (`results/drives.json`). Bài 11 dừng ở cuối
vạch với giữa thân x 144,5 và khối đang giữ ở x 157,8, đáy 4,46 cm: vì vậy bệ ở x 158.

## 5. Lời giải mù và exploit (`solutions.test.ts`, load 5)

| Bài | Chương trình | Trần §6 | Điểm (thấp nhất) | Từng lượt |
|---|---|---|---|---|
| 8 | mù (3300 ms, chở 2300 ms ở 60 %) | — | 15 | 100 / 15 / 15 |
| 8 | `never-lower-arm` | 15 | 0 | 0 / 0 / 0 (đầu ngón chạm tường xa, hết lượt) |
| 8 | `push-in` | 15 | 15 | 15 / 15 / 15 |
| 8 | `hold-in-zone` | 55 | 55 | 55 / 55 / 55 |
| 8 | `push-closed-then-lift` (fix round 1, M1) | 55 | 0 | 55 / 55 / 0 (lượt 3: kẹp đóng mất khối, xe chạm tường xa) |
| 9 | mù (chặng 2800, 1900, 1900 ms) | — | 40 | 97 / 40 / 40 |
| 9 | `push-north` | 15 | 15 | 15 / 15 / 15 |
| 9 | `open-jaw-sweep-lift` (kẹp 10°) | 15 | 0 | 15 / 0 / 15 (lượt 2 đẩy kiện 3 vào tường bắc) |
| 10 | `always-turn-left` | 40 | 40 | 40 / 100 / 40 |
| 10 | `only-check-red` | 40 | 40 | 100 / 100 / 40 |
| 11 | mù (3700 ms, chở 4700 ms) | — | 15 | 97 / 15 / 75 |
| 11 | `place-beside-base` | 35 | 35 | 35 / 35 / 35 |
| 11 | `hold-over-base` | 35 | 35 | 35 / 35 / 35 |
| 11 | `arm-too-low` (chở ở 45°) | 20 | 20 | 20 / 20 / 20 |

**Quét bằng ngàm mở (D2 review N1):** spike thử kẹp ở 0°, 8°, 10°, 12°, 15°.
- Ở 0°, vòng quay trái hất kiện ra ngoài.
- Từ 8° trở lên, vòng quay ép kiện vào một ngón, máy gắp attach nó ở tay 0° (kéo lê trên sàn).
- Ở 10°: kiện 1 và kiện 3 vào kho, được nâng 1 cm tại chỗ (z 1,99 → 3,0) rồi thả. Kiện nào cũng tính là bị đẩy.

**"Hạ hết tay (≤ 20)" theo nghĩa đen** (`programs.ts` `stackLowerFully`, nay là exploit `lower-arm-fully` với trần 35 theo ruling D4 item B). Ở cuối
vạch hạ tay 0° rồi mới mở kẹp:
- khối nằm trên bệ, lệch 1,81 / 1,76 / 1,71 cm (cho phép 1,5);
- bệ dời tối đa 0,051 / 0,051 / 0,040 cm (cho phép 2);
- điểm 35 / 35 / 35 (`stack-off-centre`, `base-still` qua).

Nghĩa thứ hai (chở ở tay 0°): `stackCarryLow` với `LIFT=0` cho 0 / 0 / 0 (khối không được nâng, bệ bị đẩy). Chở ở 45°: 20 / 20 / 20.

## 6. Tất định trên bốn engine và verify:attempt (load 7–10)

- `tests/robot-determinism.test.ts` (Node, bản split): 17/17. Hai Kiểm tra của rover vẫn đúng golden. Bốn Kiểm tra mới được nối sau chúng.
- `e2e/robot-determinism.spec.ts` qua config tạm (dev 5530, không có lesson host): 6/6 trên Chromium, Firefox và WebKit của Playwright 1.63.0. Kiểm tra: Chromium 17,9 s, WebKit 19,7 s, Firefox 27,3 s.
- **Rover không đổi:** attempt trung thực của 23 chương trình rover, làm bằng `make-attempts.mjs` trên BASE (`git archive a30581d`) và trên HEAD:
  - hai file trùng từng byte, sha256 `ab16c777…caeba7a`, bằng B3/B4 và B5/B6;
  - `node scripts/verify-attempt.mjs <base.json> --json` trên HEAD: exit 0, 23 × `match`.
- **Bài tay gắp:** `ATTEMPT_KEYS=gripper node spikes/n19-d4/make-attempts.mjs . <out>` cho 17 attempt (4 lời giải mẫu, 3 lời giải mù, 10 exploit). `verify-attempt.mjs` cho exit 0, 17 × `match`.

## 7. Màu vùng (`tints.test.ts`)

Tương phản của mực hoa văn mặt thảm (`patternInk(fill, 'mat')`) với màu vùng; test đòi ≥ 2,9 : 1:

| Màu | Tương phản | Luma |
|---|---|---|
| `#cfe2f3` | 2,958 | 0,875 |
| `#d9ead3` | 3,131 | 0,897 |
| `#fff2cc` | 3,529 | 0,949 |
| `#f4cccc` | **2,678** | 0,833 |
| `#e0e0e0` | 2,992 | 0,878 |
| `#fce4e4` | 3,269 | 0,914 |

Vì vậy vùng đỏ bài 10 dùng `#fce4e4`, vùng xuất phát dùng `#e0e0e0`.

## 8. Fix round 1 (review 1 I1): lời giải bài 8 trên toàn khoảng biến thể (load 4–7)

Review 1 đo lời giải cũ (tiến 70 %, đặt ở 45 cm) trên 61 lượt bốc khác. Hai lượt trượt (15), và lượt 2002 được 55. Đó là các lượt mà đường
đi của xe lệch khối 2,6–2,9 cm.

**Góc của khoảng biến thể** (`corners.test.ts`, `SPIKE=corners FAST=<v> DROP=<cm>`). Mười sáu tổ hợp: xuất phát ±1 cm theo x và y, quay ±2°,
khối dx ±10. Độ lệch ngang của khối so với đường đi tuyến tính theo độ dời và đơn điệu theo góc quay, nên lớn nhất ở góc: ±3,30 cm. Kết quả
(mỗi góc một lượt), theo tốc độ tiến / khoảng cách đặt:

| Tốc độ tiến / khoảng cách đặt | Điểm của 16 góc | File |
|---|---|---|
| 70 % / 45 cm (trước) | 15 ở bốn góc xa nhất (khối ở x 95, lệch 3,23–3,30 cm), 100 ở các góc khác | `results/corners-70-45.json` |
| 50 % / 45 cm | 15, 15, 55, 55 ở bốn góc đó | `results/corners-50-45.json` |
| **50 % / 35 cm (đã chọn)** | **16 × 100** | `results/corners-50-35.json` |
| 50 % / 30 cm | 16 × 100 | `results/corners-50-30.json` |

**Cơ chế** (vết của góc start (29, 44), −2°, khối ở 95):
- siêu âm không bao giờ nghe thấy khối;
- ngón đẩy khối từ x 95 tới x 127,4 (xe đổi hướng 9°);
- IR chỉ thấy khối khi xe đã ở x 115, đúng chỗ dừng khi đặt ở 45 cm;
- vì vậy quãng chở dưới 5 cm (`object-pushed`), và khối được nâng chưa tới 0,5 s (`object-not-lifted`).

Đặt ở 35 cm thì quãng chở còn 10 cm. Chọn 35 vì khối rơi ở x 137,3–137,5, cách mép vùng 8,5 cm. Ở 30 cm khối rơi ở khoảng x 142,8, chỉ cách mép 3,2 cm.

**Các seed khác** (`pickmap.test.ts`, lời giải đã sửa trong `robot-solutions.ts`): seed 100–159 và 1000, 2000, …, 8000, tức 77 lượt bốc riêng
biệt, lệch tới 2,86 cm. Kết quả: **77 / 77 được 100** (`results/pickmap.json`). Seed 23 vẫn 100 / 100 / 100.

**Test:** check-robot.gripper-lessons.test.ts chạy 16 góc (`pickCorners`, `check-cases.ts`). tests/robot-scenarios.test.ts giữ độ lệch lớn nhất
của khoảng biến thể (lưới 9⁴) bằng độ lệch của các góc đó (3,30 cm). Độ lệch của các lượt đã giao: 0, 0,73, 1,91 cm.

**Exploit `push-closed-then-lift`** (review 1 M1; `programs.ts` `pickPushClosed`, `T=<ms>`). Kẹp đóng, đẩy T ms, mở kẹp, tiến tới khi IR thấy,
gắp, nâng tại chỗ, đặt xuống:
- T 4400: khối ở x 102 và 104 khi gắp, trước vùng thả;
- T 5000: x 110 và 128;
- **T 5600: x 117 và 138, trong vùng (đã chọn)**;
- T 6300: lượt 2 đẩy khối tới x 162,8.
Ở mọi T, lượt 3 mất khối và chạm tường xa (0).
