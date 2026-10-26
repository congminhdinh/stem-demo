# N19 B3+B4: số đo kiểm "rover không đổi" và chi phí

Máy: Apple M4 Pro, macOS (Darwin 25.5.0), Node v24.22.1, Vitest 4.1.11, Rapier deterministic 0.21.0. Máy dùng chung với các agent khác.

## verify:attempt trên các bài N18 (2026-10-27 03:14–03:22, load 9–28)

`make-attempts.mjs` tạo attempt trung thực, đúng dạng STEMLearning lưu (LabAttemptDto + project), cho mọi chương trình mẫu của 6 bài N18: lời giải mẫu, lời giải mù và các exploit, tổng 23 attempt. Mỗi attempt dùng check headless của một cây mã nguồn.

```sh
git archive 6884822 | tar -x -C <scratch>/base && ln -s $PWD/node_modules <scratch>/base/node_modules
node spikes/n19-b34/make-attempts.mjs <scratch>/base <scratch>/attempts-base.json   # BASE master 6884822
node scripts/verify-attempt.mjs <scratch>/attempts-base.json --json                 # HEAD 80dd423: exit 0, 23 × "match"
node spikes/n19-b34/make-attempts.mjs . <scratch>/attempts-head.json                # HEAD
shasum -a 256 attempts-base.json attempts-head.json                                 # cùng ab16c777…caeba7a: trùng từng byte
```

| Bài | Chương trình | passed | score |
|---|---|---|---|
| rb-drive-to-zone | reference | true | 100 |
| rb-square-route | reference | true | 100 |
| rb-stop-at-wall | reference / blind / exploit 0–1 | true / false / false / false | 100 / 0 / 0 / 0 |
| rb-line-follow | reference / blind / exploit 0–2 | true / false ×4 | 100 / 60 / 0 / 40 / 60 |
| rb-servo-gate | reference / blind / exploit 0–2 | true / false ×4 | 100 / 0 / 40 / 40 / 40 |
| rb-mini-mission | reference / blind / exploit 0–4 | true / false ×6 | 96 / 0 / 45 ×5 |

## Chi phí một tick của world gripper (2026-10-27 03:19, load 11,2–15,0)

Lấy `src/core/world/world.gripper.cost.test.ts` (kịch bản 1 của spike: step, grasp, cảm biến, snapshot và goal frame mỗi tick; 3000 tick; CPU của thread; median của các lô 10 tick). Chạy xen kẽ ba lần trên mỗi cây, bằng `./node_modules/.bin/vitest run`.

| Cây | median (ms/tick) | mean | p95 |
|---|---|---|---|
| BASE 6884822 | 0,1531 / 0,1621 / 0,1526 | 0,167 / 0,180 / 0,168 | 0,217 / 0,279 / 0,223 |
| HEAD | 0,1733 / 0,1644 / 0,1778 / 0,1702 / 0,1704 / 0,1650 | 0,174–0,185 | 0,225–0,257 |

Chênh lệch khoảng +0,012 ms/tick (khoảng 7 %). Phần thêm gồm tia IR, tia màu và `restingOn` của goal frame mỗi tick. Ngân sách trên máy trường vẫn do E9 đo.
