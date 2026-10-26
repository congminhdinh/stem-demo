# N19 B5 + B6: số đo ổn định, servo kẹp, rover không đổi

Máy: Apple M4 Pro (12 core), macOS 26.5.2 (Darwin 25.5.0), Node v24.22.1, Vitest 4.1.11, Rapier deterministic 0.21.0, Playwright 1.63.0.
Máy dùng chung với các agent khác. Ngày 2026-10-27. Mọi số dưới đây là số đo, không phải ước tính.

## Quét ổn định (`stability-sweep.test.ts`, 04:51, load 5,5)

```sh
pnpm exec vitest run --config spikes/n19-b56/vitest.config.ts
```

Harness của B1/B2 (`src/core/world/__fixtures__/gripper-scene.ts`): xe gắp trong physics world riêng, chạy như `world.ts`. Pitch dương là
đầu xe ngóc lên. Caster "rời sàn" khi đáy bi cao hơn sàn > 0,1 mm. "Ổn định" theo cách của spike G0.1: từ lúc đó tới hết cửa sổ, pitch
không lệch quá 0,2° so với giá trị cuối, và chassis quay không quá 0,05 rad/s.

### Phanh từ tốc độ tối đa, giữ 50 g (cửa sổ 1,5 s)

| Tay | Dừng | Quãng dừng | Pitch | Caster | Tải caster ít nhất |
|---|---|---:|---|---|---:|
| 90° | phanh | 1,67 cm | −0,053 … +0,034° | luôn chạm sàn | 1,677 N |
| 45° | phanh | 1,65 cm | −0,056 … +0,019° | luôn chạm sàn | 1,851 N |
| 90° | thả trôi | 3,92 cm | −0,026 … +0,034° | luôn chạm sàn | 1,667 N |
| 45° | thả trôi | 3,91 cm | −0,033 … +0,019° | luôn chạm sàn | 1,878 N |

Tốc độ tối đa 0,476 m/s (duty 255). Spike: 1,66 / 1,64 / 3,95 cm, −0,054 … +0,034°.

### Càng đâm tường, motor thả trôi đúng tick chạm (cửa sổ 1,5 s)

Chạm tính như `world.ts` (`touchingBodies`): va chạm của xe, hoặc của vật đang giữ trong tick đó, đọc giữa bước vật lý và lần cập nhật
của máy gắp. Như vậy khối chạm tường trước và tuột ngay trong tick đó vẫn được tính. Chạy lấy đà 60 cm. "u 4": khối nhô 0,5 cm qua đầu
ngón (khối chạm trước, kịch bản 5b của spike). "u 3": đầu ngón chạm trước.

Pitch lớn nhất (°) / thời gian ổn định (s):

| Duty (m/s) | Tay 0°, rỗng | 45° rỗng | 45° 15 g u3 | 45° 15 g u4 | 45° 50 g u3 | 45° 50 g u4 | 90° rỗng | 90° 15 g u3 | 90° 15 g u4 | 90° 50 g u3 | 90° 50 g u4 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 128 (0,132) | 0,10 / 0,03 | 0,70 / 0,06 | 0,16 / 0,03 | 0,07 / 0 | 0,06 / 0,03 | 0,04 / 0,01 | 0,67 / 0,06 | 0,73 / 0,07 | 0,65 / 0,06 | 0,49 / 0,06 | 0,09 / 0,02 |
| 160 (0,219) | 0,54 / 0,06 | **7,71** / 0,23 | 1,08 / 0,08 | 0,08 / 0,03 | 0,21 / 0,06 | 0,07 / 0,03 | 3,85 / 0,18 | 3,33 / 0,17 | 1,11 / 0,07 | 4,58 / 0,17 | 0,94 / 0,06 |
| 200 (0,327) | 0,65 / 0,09 | 5,57 / 0,21 | 3,96 / 0,14 | 0,77 / 0,06 | 1,23 / 0,08 | 0,54 / 0,05 | 7,80 / 0,26 | **8,54** / 0,31 | 2,41 / 0,11 | 3,33 / 0,14 | 0,66 / 0,05 |
| 226 (0,398) | 2,37 / 0,13 | **8,35** / 0,24 | 3,95 / 0,18 | 0,17 / 0,06 | 1,92 / 0,11 | 0,77 / 0,06 | **14,22** / 0,39 | **11,44** / 0,38 | 2,31 / 0,13 | 4,89 / 0,13 | 0,66 / 0,03 |
| 255 (0,476) | 4,83 / 0,20 | **11,75** / 0,32 | **12,47** / 0,32 | 0,25 / 0,03 | 4,32 / 0,18 | 0,07 / 0,03 | **15,70** / 0,34 | **17,16** / 0,37 | 4,65 / 0,16 | **9,42** / 0,24 | 4,22 / 0,14 |

- Mọi trường hợp: hữu hạn (không NaN), ổn định trong ≤ 0,392 s.
- Trường hợp của spike (226, khối 15 g u 4): 0,17° (45°) và 2,31° (90°). Spike đo 1,00° và 2,39°. Khối tuột ngay khi chạm (cube → null).
- **< 8° chỉ đúng** ở duty ≤ 160 với mọi tay, mọi tải, mọi kiểu kẹp, và ở mọi tốc độ khi khối chạm trước. Từ 0,33 m/s, khi đầu ngón
  (không ma sát, trượt lên tường) hoặc càng rỗng chạm trước ở tay 45–90°, xe ngóc 8,35–17,16°.
- Sau đó vài trường hợp đứng tựa tường, đầu ngóc 0,3–4,9°, caster hở cả cửa sổ. Ma sát hộp số của motor thả trôi giữ bánh, như tay
  servo ở ADR 0001 §9.
- Caster: ruling G0 caster ghi "≤ 3 mm khi tay 90° đâm tường; tay ≤ 45° thì caster vẫn chịu tải". Chỉ đúng với trường hợp của spike
  (khối chạm trước): 2,86 mm ở 90°, 0,08 mm ở 45°. Đầu ngón chạm trước thì caster hở 5–24 mm.

### Motor vẫn đẩy vào tường (duty 255 trong 3 s, rồi thả trôi 2 s, rồi lùi duty 128 trong 1 s)

Xem `gripper.stability.test.ts` (số đo in ở test): pitch lớn nhất 17,78 / 15,81 / 17,19 / 17,32 / 18,80° (45° 50 g u4, 90° 50 g u4,
90° 50 g u3, 45° rỗng, 90° rỗng). Thả trôi thì xe đứng tựa tường ở 15,93 / 11,26 / 16,31 / 15,71 / 15,28°. Lùi ra thì xe về 0,03–0,08°,
caster chạm sàn và chịu tải. Khi chổng đầu, bi đỡ dưới bánh (cách trục 2 cm) nhấc lên tới 2,8 mm: xe đứng trên vành bánh.

### Nâng/hạ tay hết tốc (cửa sổ 0,8 s mỗi lần)

| Tải | Caster cao nhất | Lâu nhất (tick) | Lần đó |
|---|---:|---:|---|
| rỗng | 1,706 mm | 9 | 90 → 0 |
| 15 g | 2,332 mm | 10 | 90 → 0 |
| 50 g | 3,336 mm | 11 (0,092 s) | 90 → 0 |

Nâng lên không bao giờ làm caster hở (≤ 0,07 mm). Spike: ≤ 3,34 mm, 20 tick.

### Khởi động từ đứng yên, giữ 50 g ở tay 0° (0,5 s)

Năm sa bàn/chỗ đứng (300 × 300 tại (40, 50); 400 × 400; 200 × 100; 300 × 300 tại (150, 150) hướng 90°; 180 × 150 tại (30, 75)) cho
cùng số:

| Duty | 90 | 100 | 102 | 110 | 120 | 128 | 160 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Quãng (cm) | 0,008–0,009 | 1,134–1,136 | 1,369–1,371 | 2,313–2,314 | 3,490–3,492 | 4,431–4,434 | 8,199–8,203 |

Ngưỡng khởi động khoảng duty 95 (37 %). Không cần chỉnh placeholder của kit gripper: duty 128 (50 %) và 102 (40 %) đều chạy chắc chắn.

### Ấn khối đang giữ xuống sàn khi tay kẹt (Review Focus 1)

Gắp ở tay 10° và 15°, rồi ra lệnh tay 0° trong 2,5 s:

| Khối | Gắp ở | Lực ngoài lớn nhất | Pitch lớn nhất | Tay | Nâng lại 90° |
|---|---|---:|---:|---:|---|
| 15 g | 10° | 2,600 N | 3,703° | 0,023° | pitch 0,065°, caster chịu 1,14 N |
| 15 g | 15° | 2,920 N | 5,756° | 0,022° | như trên |
| 50 g | 10° | 3,330 N | 3,700° | 0,033° | pitch 0,033°, caster chịu 1,72 N |
| 50 g | 15° | 3,736 N | 5,670° | 0,030° | như trên |

Ngưỡng tuột 9,71 N. Lúc nào cũng còn giữ.

## Rover không đổi

### Chuỗi lời gọi Rapier (`trace-rover.mjs`, 04:50, load 6,1)

```sh
git archive 0a7a479 | tar -x -C <scratch>/base && ln -s $PWD/node_modules <scratch>/base/node_modules
node spikes/n19-b56/trace-rover.mjs <scratch>/base
node spikes/n19-b56/trace-rover.mjs .
```

Kịch bản all-goals, `ref-uno-rover@0`, biến thể 1, 600 tick. Mỗi tick đọc snapshot, goal frame, frame extras và siêu âm. Sau đó chạy
`startFootprintIssues` của sa bàn.

| Cây | Lời gọi Rapier | Hash chuỗi lời gọi (tên + tham số) | Hash snapshot | Lỗi chỗ đứng |
|---|---:|---|---|---|
| BASE 0a7a479 | 137 450 | `cc380608c8cf55d9` | `9d88c7f8e50b1b35` | không |
| HEAD | 137 450 | `cc380608c8cf55d9` | `9d88c7f8e50b1b35` | không |

### verify:attempt (04:49, load 6–9)

```sh
node spikes/n19-b34/make-attempts.mjs <scratch>/base <scratch>/attempts-base.json
node spikes/n19-b34/make-attempts.mjs . <scratch>/attempts-head.json
shasum -a 256 attempts-base.json attempts-head.json
node scripts/verify-attempt.mjs <scratch>/attempts-base.json --json
```

- 23 attempt (mọi chương trình mẫu của 6 bài N18).
- Hai file trùng từng byte: sha256 `ab16c777…caeba7a`, bằng đúng số của B3/B4.
- HEAD: exit 0, 23 × `match`.

## Chi phí một tick của world gripper (04:52–04:53, load 4,8–4,9)

`src/core/world/world.gripper.cost.test.ts`, xen kẽ ba lần mỗi cây, bằng
`./node_modules/.bin/vitest run src/core/world/world.gripper.cost.test.ts --silent=false --reporter=verbose`.

| Cây | median (ms/tick) | mean | p95 |
|---|---|---|---|
| BASE 0a7a479 | 0,1577 / 0,1631 / 0,1630 | 0,1687 / 0,1698 / 0,1749 | 0,2144 / 0,2090 / 0,2219 |
| HEAD | 0,1686 / 0,1682 / 0,1642 | 0,1780 / 0,1749 / 0,1764 | 0,2210 / 0,2136 / 0,2253 |

Vỏ servo thêm khoảng +0,005 ms/tick: một collider trong broad phase và trong 5 tia siêu âm.

## Footprint (một lần đo trong test tạm, 04:33–04:34, load 4,3–5,2)

- `robotFootprint(ref-uno-gripper@0)` lần đầu: 13,9 ms (7 189 mẫu, tính một lần cho mỗi object kit).
- `startFootprintIssues`, trung bình 200 lần gọi, 20 tường:
  - chỗ đứng trống: 0,005 ms;
  - một hộp 5 cm ngoài vòng bao của tay gắp: 0,005 ms;
  - một hộp nằm trong vùng tay gắp quét: 0,755 ms (đặt mọi mẫu rồi kiểm từng mẫu);
  - rover: 0,10–0,11 ms.

## Chạy tất định trên trình duyệt (04:47, load 7,6)

`e2e/robot-determinism.spec.ts` với một config Playwright tạm (dev server cổng 5510, không có lesson host, ba project chromium, firefox,
webkit, `--workers 3`). Kết quả: 6 / 6 qua trong 17,3 s. Chromium 153.0.8010.12, Firefox 155.0 và WebKit 26.6 cho đúng 6 hash fixture
của golden:
- `gripper-pick-place` `b3414f0e` / `abafe587`;
- `gripper-stack` `9378dcbe` / `60ce8067`;
- `gripper-sensors` `f3b0127d` / `22615357`;
- ba fixture của rover không đổi.
