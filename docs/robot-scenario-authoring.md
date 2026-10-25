# Soạn kịch bản robot (`rb-*.json`)

Tài liệu cho người soạn và người sửa kịch bản của lab robot (N18 R5.3, phần 6h). Nó nói một kịch bản gồm những gì, các luật bắt buộc,
cách thiết kế biến thể để "chạy mù" bị bắt, và cách kiểm tra trên máy trước khi commit. Ví dụ lấy từ sáu kịch bản của khóa pilot
(R5.2a) trong `src/samples/robot-scenarios/`.

Đọc kèm: plan `docs/robot-3d-implementation-plan.md` §4.6 (schema), §R6.1 (ý nghĩa từng goal), `src/core/scenario/scenario-schema.ts`
(luật schema, thông báo lỗi), `src/core/hardware/kits/README.md` (kit tham chiếu và số cơ khí PLACEHOLDER).

## 1. Một kịch bản nằm ở đâu và ai đọc nó

| Nơi | Vai trò |
|---|---|
| `src/samples/robot-scenarios/<key>.json` | **Nguồn duy nhất** của kịch bản. Tên file đúng bằng `key`. |
| `src/samples/robot-scenarios/index.ts` | Catalog: nạp và validate mọi file bằng `loadScenario` khi module được import; file sai là lỗi ngay. |
| `src/samples/robot-scenarios/ready-fields.ts` | Đọc `version`, `goals[].points`, `scoring` của từng file cho message `ready` (không qua schema, để bundle chính không kéo `src/core/world`). Test giữ nó khớp catalog. |
| `docs/fixtures/robot-scenarios.v1.json` | Manifest cho STEMLearning (key, version, title, goal ids, maxScore). Sinh bằng `pnpm export:robot-manifest`, **phải commit** cùng thay đổi. |
| `src/samples/robot-solutions.ts` | Lời giải chuẩn (`reference`), lời giải chạy mù (`blind`, bài 3–6) và ghi chú (`notes`) của mỗi kịch bản có điểm. |
| `tests/robot-scenarios.test.ts` | Kiểm tra tĩnh: luật, biến thể, toolbox, compile, Blockly, golden. |
| `tests/robot-solutions/<key>.ino` | Sketch Arduino của lời giải chuẩn (golden); `pnpm check:arduino --require` compile nó bằng arduino-cli. |

Key `rb-*` là hợp đồng công khai (khóa học lưu nó): **không bao giờ đổi tên hay dùng lại**. Danh sách key ở `src/samples/robot-keys.ts`.
Đổi hành vi của kịch bản (sa bàn, goal, điểm, biến thể, thời gian, starter, toolbox) thì **tăng `version`**, chạy lại
`pnpm export:robot-manifest` và commit manifest.

## 2. Các trường

| Trường | Ý nghĩa |
|---|---|
| `key`, `version`, `title {vi, en}` | `title` trùng với `robot.scenario.<key>` trong `src/ui/i18n/messages.ts` (test kiểm). |
| `profile`, `kit` | Profile mà key cần (`robot-keys.ts`, hiện là `uno-basic`) và kit `ref-uno-rover`. |
| `arena` | Sa bàn: `ground`, `paint.lines`, `paint.zones`, `walls`, `boxes`, `cylinders`, `objects` (mục 3). |
| `start` | `{ xCm, yCm, yawDeg }`: điểm trên sàn dưới **giữa thân** robot và hướng (độ, ngược chiều kim đồng hồ từ +x). |
| `variants` | `{ count, seed, startJitterCm, startJitterAlongCm?, yawJitterDeg, obstacleJitterCm? }` (mục 6). |
| `inputs` | Kịch bản nhấn/nhả nút (`button1`) theo thời gian; bỏ trống nếu không cần. |
| `timeLimitS` | Thời gian chạy tối đa (0, 600] giây. Mỗi biến thể chạy tới mốc này khi Kiểm tra. |
| `goals` | Danh sách mục tiêu (mục 4). |
| `scoring` | `{ timeBonusMax? }`. Luôn ghi (kể cả `{}`), vì `ready-fields.ts` đọc nó. |
| `starter` | Workspace Blockly mà bài mở ra (JSON như `Blockly.serialization.workspaces.save`). |
| `toolbox` | Danh sách block type được dùng; bỏ trống = mọi block (chỉ `rb-sandbox`). |
| `endOnContact` | Các tag (hay loại collider) mà lần chạm đầu tiên **kết thúc lượt chạy**, như đâm xe trong thi robot (mục 4). Bỏ trống: chạm không dừng gì. |

Khoá lạ bị từ chối (không bị bỏ qua), nên gõ sai tên khoá là lỗi ngay khi nạp.

## 3. Sa bàn (`arena`)

- **Đơn vị và hệ trục:** cm và độ. x sang phải, y ra xa người nhìn, gốc ở góc dưới trái của `ground`. Mọi điểm phải nằm trên `ground`.
- **`ground`:** `sizeCm [rộng, sâu]`, `color` sáng (`#f2f2f2`). Khung nhúng chính 1100×640 nên sa bàn khoảng 130–200 cm là vừa.
- **Tường bao:** pilot dùng 4 tường dày 2 cm sát mép (`[0,1]→[W,1]`, `[0,D−1]→[W,D−1]`, `[1,0]→[1,D]`, `[W−1,0]→[W−1,D]`), để robot
  không rơi khỏi bàn. Đặt `id` cho tường mà goal hay lời giải nói tới (`front-wall`, `dock-wall`).
- **Vạch (`paint.lines`):** băng keo đen (reflectance 0), polyline, đầu và khớp tròn; lặp điểm đầu để khép vòng. Pilot dùng
  `widthCm: 2.5`. Ba cảm biến vạch của `ref-uno-rover@0` cách nhau 1,5 cm, nằm 7 cm trước giữa thân, nên vạch 2,5 cm được "thấy"
  khi thanh cảm biến lệch tới ±2,75 cm. Khúc gấp 45° thì bám được; gấp 90° nên bo bằng hai khúc 45°.
- **Vùng (`paint.zones`):** đa giác (even-odd). `kind` (`start`, `target`, `checkpoint`, `area`) chỉ để vẽ. **Màu phải sáng**
  (luma > 0,75, test kiểm): cảm biến vạch đọc vùng như sàn, vùng tối sẽ bị đọc nhầm là vạch. Màu pilot: start `#cfe2f3`, target
  `#d9ead3`, checkpoint `#fff2cc`, area `#f4cccc`. Không vẽ đa giác tự cắt (hình nơ, "bow-tie"): phép kiểm chồng vùng không tin
  được với chúng.
- **Vật (`boxes`, `cylinders`):** `fixed` (mặc định) hoặc `dynamic` (cần `massG`). `tags` cho goal `avoid-contact` (loại `wall`,
  `box`, `cylinder`, `object` tự có). Tag `jitter` cho phép biến thể dời vật (mục 5).
- **`objects`:** vật để đẩy (goal `object-in-zone`). Pilot chưa dùng. Tay servo **chỉ là cờ báo hiệu**: từ R3.5 nó nằm trong thân
  robot ở mọi góc, không đẩy được gì; muốn đẩy vật thì dùng thân robot.

## 4. Mục tiêu (`goals`) và điểm

Mỗi goal có `id` (`[a-z0-9-]`, ≤ 50 ký tự, không trùng), `label {vi, en}` (≤ 200 ký tự) và `points` (số nguyên ≥ 0).
**Điểm là tất cả hoặc không:** goal qua thì được đủ `points`, không qua thì 0 (R6.1). Ý nghĩa từng loại (chi tiết ở plan §R6.1):

| Kind | Qua khi | Lưu ý cho người soạn |
|---|---|---|
| `reach-zone` | giữa thân robot vào vùng một lần | Giữ nguyên kể cả khi rời đi. |
| `checkpoints-in-order` | vào lần lượt từng vùng theo thứ tự | Chỉ tính **lần vào**; vào sai thứ tự không tính nhưng không hỏng lộ trình. Các vùng của **một** goal không được chồng nhau (chỉ chạm cạnh thì được). |
| `stop-in-zone` | **ở cuối run**, tâm robot đã ở trong vùng với tốc độ ≤ `maxSpeedCmS` liên tục `holdS` giây gần nhất | Chấm ở frame cuối, không giữ khi đã qua: dừng rồi chạy tiếp là trượt (R5.2a fix round 3). Tốc độ là tốc độ giữa trục bánh (R3.5): quay tại chỗ tính là đứng yên. Pilot dùng `maxSpeedCmS 0,5` (ngưỡng đứng yên của R6.2, dưới tốc độ bò chậm nhất của kit placeholder: 1,0–1,5 cm/s ở duty 32–33 %), `holdS 1`, nên bò chậm qua vùng không tính là dừng. |
| `servo-angle` | góc trong `[minDeg, maxDeg]` liên tục **0,5 s** (và trong vùng `whenInZone` nếu có) | Servo **bắt đầu ở 90°** khi chương trình dùng servo (thư viện Servo ghi 90 lúc attach), và ở `restDeg` (0°) khi không dùng: khoảng của goal không được chứa 90° hay 0°, nếu không robot "qua" mà chẳng làm gì. **`whenInZone` không đòi dừng:** robot chạy ngang qua vùng với cờ đã giơ (0,5 s trong vùng) là qua; muốn đòi dừng thì thêm `stop-in-zone`. |
| `stay-on-line` (canh gác) | tỉ lệ **quãng đường** có ≥ 1 điểm cảm biến trên băng keo ≥ `minRatio`: `Σ(tốc độ·dt khi trên vạch) / Σ(tốc độ·dt)` | Mỗi tick tính theo quãng nó đi, nên bò chậm trên vạch rồi phóng ngoài vạch không mua được tỉ lệ; đứng yên hay quay tại chỗ không cộng gì. |
| `avoid-contact` (canh gác) | không chạm collider có `tag` suốt run | Rời sa bàn cũng là trượt. |
| `object-in-zone` | tâm vật trong vùng ở frame cuối | |
| `finish-within` | các goal khác cùng qua trước `seconds` | Đi cùng `scoring.timeBonusMax` (cách tính thưởng do R6.2). |
| `uses-block` | chương trình có khối `blockType` đang chạy | Khối phải có trong `toolbox`. Khối rời hay bị tắt không tính. |

**`endOnContact`:** ở tick đầu tiên robot chạm collider có một trong các tag này, lượt chạy kết thúc; goal chấm trên các frame tới hết tick
đó. Goal cần giữ hay dừng (`stop-in-zone`, `servo-angle`) mà chưa đạt thì trượt với lý do `run-ended-contact` ("Lượt chạy kết thúc khi robot
đâm vào vật, trước khi đạt mục tiêu này"); `stop-in-zone` chỉ qua nếu robot đã dừng đủ `holdS` trong vùng trước tick đó. Mỗi tag phải có trong sa bàn. Đặt nó cho tag của `avoid-contact` khi đâm là hỏng bài (bài 3: `wall`,
bài 5: `gate`, bài 6: `obstacle`): không có nó, chạy thẳng vào tường rồi lùi một thời gian cố định sẽ đỗ đúng vùng ở mọi biến thể, vì tường
không dời theo biến thể.

Goal canh gác (`avoid-contact`, `stay-on-line`) thoả được bằng cách *không làm gì*, nên chúng **chỉ qua khi robot đã có lúc cách chỗ
xuất phát ≥ 20 cm** (`MIN_GUARD_TRAVEL_CM`, tầm xa ròng: khoảng cách lớn nhất của giữa thân tới chỗ xuất phát), xét ở cuối run. Không phải
độ dài quãng đường: quay lệch hay đi tới đi lui tại chỗ cho quãng đường dài mà không đi đâu cả.

## 5. Luật bắt buộc (checklist)

1. **Điểm = 100:** `Σ points + (timeBonusMax ?? 0) = 100`, số nguyên. `rb-sandbox` không có goal, không có `timeBonusMax`.
2. **Goal phải thưởng một hành động:** mỗi goal canh gác phải đi cùng ít nhất một goal "đạt tới" (`reach-zone`, `checkpoints-in-order`,
   `stop-in-zone`, `servo-angle`, `object-in-zone`). Robot ở mọi biến thể **không được bắt đầu trong** (hay sát, trong 13 cm) vùng mà
   một goal gửi nó tới; vật không được bắt đầu trong vùng đích của nó. Starter không được giải bài (mục 7).
3. **Vùng checkpoint của một goal không chồng nhau**, không vẽ đa giác tự cắt.
4. **Chỗ xuất phát:** footprint của robot là hình tròn 11 cm (`ROBOT_FOOTPRINT_RADIUS_CM`; góc bánh của `ref-uno-rover@0` cách giữa thân
   10,27 cm). Pilot giữ thêm **2 cm** trống quanh mọi chỗ xuất phát của mọi biến thể (13 cm tới tường, vật, mép sàn). `createWorld`
   từ chối chỗ xuất phát mà bất kỳ phần nào của robot (thân, bánh, bánh tự lựa, tay servo ở mọi góc) đè lên vật.
5. **Tốc độ trong lời giải ≥ 40 %:** kit placeholder không chạy dưới duty khoảng 80 (31 %) và rất chậm ngay trên đó.
6. **Kit placeholder:** mọi thời gian và khoảng cách dưới đây đo trên `ref-uno-rover@0`, mà số cơ khí là PLACEHOLDER. Khi có số đo
   của nhà cung cấp (plan VG), phải đo lại thời gian của lời giải mở (bài 1–2) và mọi lời giải mù, kiểm lại vùng và vật cản (robot rộng
   hơn cần vật cản xa hơn), rồi tăng `version`.
7. **Toolbox:** các khối mà bài dạy cộng các khối cơ bản (`stem_on_start`, `stem_forever`, `math_number`, `ybc_wait_ms`, các khối
   chạy). Mọi khối của starter, lời giải chuẩn và lời giải mù phải có trong toolbox; mọi khối của toolbox phải thuộc profile.
8. **Key và version:** xem mục 1.
9. **Điểm goal canh gác ≤ điểm goal "đạt tới":** tổng `points` của `avoid-contact` và `stay-on-line` không lớn hơn tổng của `reach-zone`,
   `checkpoints-in-order`, `stop-in-zone`, `servo-angle`, `object-in-zone` (test kiểm). Một đoạn chạy ngắn trên vạch đã qua goal bám vạch.
10. **Chương trình mở không được qua check.** Thử các cách lấy điểm mà không làm bài, mỗi goal một: chạy thẳng một đoạn, chạy thẳng tới
    đích, lộ trình canh giờ, bò chậm rồi phóng, phóng rồi bò chậm qua vùng, đâm tường rồi lùi một thời gian cố định, đặt servo rồi chạy không
    dừng, bám vạch mà không đo khoảng cách, bám vạch rồi dừng (hay bò) sau một thời gian cố định, bám vạch rồi lùi khi mất vạch. Không cách nào được qua check; ghi điểm cao nhất của mỗi cách (điểm check, tức
    điểm thấp nhất trong các biến thể) vào `exploits` của lời giải (mục 7); điểm đó nên **≤ 60**.
11. **`whenInZone` không đòi dừng** (mục 4): goal cờ ở cổng phải đi cùng `stop-in-zone` nếu bài muốn robot dừng.
12. **Đâm là hết lượt** khi bài coi đâm là hỏng: đặt `endOnContact` bằng tag của `avoid-contact` (mục 4).

## 6. Biến thể (`variants`)

Kiểm tra (R6.2) chạy `count` biến thể và chỉ qua khi mọi goal qua ở **mọi** biến thể; điểm là **điểm thấp nhất** trong các biến thể (ruling
cho R6.2: một biến thể may mắn không làm điểm cao). Biến thể 0 là chỗ xuất phát đúng như soạn. Biến thể ≥ 1 dời chỗ xuất phát `±startJitterCm`
theo x và y (hoặc, có `startJitterAlongCm`, ±giá trị đó dọc hướng xuất phát và ±`startJitterCm` ngang hướng), quay `±yawJitterDeg`, và dời mỗi vật có tag `jitter`
`±obstacleJitterCm`, tất cả từ `seed` (`variants.ts`, tất định trên mọi engine). Lần bốc không vừa (ra mép, đè vật) thì bốc lại, tối
đa 20 lần, rồi giữ vị trí đã soạn: thiết kế sao cho không lần nào phải bốc lại (test kiểm rằng mỗi biến thể ≥ 1 đều dời thật).

Mục đích là bắt chương trình **chạy mù** (chỉ motor và wait, canh giờ cho biến thể 0). Cách thiết kế:

- **Bài 1–2 (mở, chưa có cảm biến):** `count 1`, không jitter. Lời giải chuẩn chính là motor + wait.
- **Bài dừng theo siêu âm (3, 5):** jitter lớn theo hướng chạy (pilot: 18 cm), vùng dừng dài khoảng 20 cm quanh chỗ lời giải chuẩn dừng.
  Lời giải chuẩn dừng ở cùng một chỗ dù xuất phát ở đâu; chạy mù thì dừng lệch đúng bằng độ dời. Chọn `seed` sao cho **một biến thể dời
  tới trước và một biến thể dời lùi**, mỗi cái đủ xa để chạy mù dừng ngoài vùng ≥ 4 cm: một biến thể đâm tường, một biến thể dừng ngắn
  (pilot: dời khoảng ±17 cm). Bài lý thuyết dùng ngưỡng **15 cm** (đo: 10 cm và 20 cm cũng dừng trong vùng, 25 cm dừng ngắn).
- **Bài bám vạch (4, 6):** jitter vị trí nhỏ (1,5 cm, để thanh cảm biến vẫn thấy vạch lúc xuất phát) nhưng jitter hướng ±5°. Lệch 4°
  là robot chạy mù ra khỏi vạch (2,75 cm) sau khoảng 40 cm. Chọn `seed` sao cho có biến thể quay ≥ 4°. Khi bài đòi dừng ở một vùng cuối
  vạch (bài 6), cho chỗ xuất phát dời xa **dọc** đường thẳng xuất phát (`startJitterAlongCm`, pilot: ±15 cm, seed có một biến thể ≥ 12 cm
  tới trước và một ≥ 12 cm lùi): bộ bám vạch dừng sau một thời gian cố định dừng ở cùng quãng đường kể từ chỗ xuất phát, nên các chỗ dừng cách
  nhau xa hơn chiều dài vùng đỗ và một biến thể trượt, với mọi thời gian (spike quét số vòng lặp: không giá trị nào qua). Bài 4 phải dạy **bộ bám vạch
  dùng cảm biến giữa** (giữa thấy vạch thì chạy, chỉ cảm biến bên thấy thì quay về phía đó, không cái nào thấy thì dừng): bộ bám chỉ dùng
  hai cảm biến bên (chạy khi không cái nào thấy) kẹt ở góc 45° đầu tiên với khoảng cách cảm biến 1,5 cm của kit placeholder (đo bằng spike).
- **Đích không ra được bằng một cú chạy thẳng:** bài 4 đặt đích trong một gara có miệng quay về hướng vạch đi tới, nên mọi đường thẳng
  từ chỗ xuất phát vào gara đều cắt tường gara. Một lộ trình mở canh giờ cho biến thể 0 vẫn vào được gara ở biến thể khác (quay chỗ xuất
  phát làm đầu lộ trình lệch dọc hành lang nhiều hơn là ngang), nhưng trượt goal bám vạch, nên không qua check và được 60 (điểm thấp nhất
  trong các biến thể); một lộ trình ba đoạn tránh xa vạch cũng vậy. Bài 4 có `timeLimitS` 120: bộ bám đúng ở 35 % (vừa trên vùng chết) vào
  gara lúc khoảng 94 s, ở 40 % lúc khoảng 41 s.
- Test tĩnh trong `tests/robot-scenarios.test.ts` giữ các tính chất này (bài 3, 5: một biến thể tới trước, một biến thể lùi, mỗi cái
  ≥ 4 cm ra ngoài vùng; bài 4, 6: có biến thể quay ≥ 4°; bài 6: chỗ xuất phát dời ≥ 12 cm tới và lùi dọc đường thẳng; điểm canh gác ≤ điểm
  đạt tới; `endOnContact` bằng tag của `avoid-contact`). Kết quả thật (lời giải chuẩn qua mọi biến thể, lời giải mù trượt ≥ 1, `exploits`
  không qua và không quá điểm tối đa) do R5.2b chạy qua run session và check.

Số của kit placeholder dùng để thiết kế (đo bằng spike `spikes/r52-scenario-sim`, máy M4 Pro, Node 24.22.1):

| Đại lượng | Giá trị |
|---|---|
| Tốc độ ở 50 % | 13,4 cm/s (5000 ms đi 66,8 cm, kể cả lúc khởi động) |
| Quay tại chỗ ở 50 % | khoảng 108°/s (830 ms sau khi chạy thẳng: 90,4°; 410 ms: khoảng 45°) |
| Dừng (thả trôi) từ 13,4 cm/s | dưới 1 cm |
| Siêu âm | 7,5 cm trước giữa thân; "< 15 cm" dừng giữa thân cách tường 22,2 cm |
| Cảm biến vạch | 7 cm trước giữa thân, cách nhau 1,5 cm |
| Bề ngang | bánh ngoài cách trục giữa 8,8 cm (thân rộng 12 cm) |

## 7. Starter và lời giải

- **Starter** (trong JSON): hat của bài (`stem_on_start` cho bài mở, `stem_forever` cho bài cảm biến) và **một khối chạy rời**
  (`uno_drive_move` forward 50, `disabledReasons: ["ORPHANED_BLOCK"]`) để học sinh kéo vào. Robot không chạy được gì cho tới khi
  học sinh dựng chương trình, nên starter không qua goal nào. `rb-sandbox` mở với "on start" và "forever" trống.
- **Lời giải** (`src/samples/robot-solutions.ts`): `reference` viết bằng đúng toolbox của bài; `blind` (bài 3–6) chỉ motor và wait
  trong "on start"; `exploits` (bài 3–6) là các chương trình cố lấy điểm mà không làm bài, mỗi cái kèm `maxScore`, điểm check cao nhất của nó
  (điểm thấp nhất trong các biến thể, ≤ 60), và không cái nào được qua check; `notes` ghi thời gian đo được và chỗ lời giải phụ thuộc kit
  placeholder. Số dùng trong khối là shadow như
  toolbox đưa. Test nạp mọi chương trình vào Blockly thật và lưu lại, phải ra đúng JSON.

  | Kịch bản | Exploit | Điểm tối đa |
  |---|---|---|
  | `rb-stop-at-wall` | `crash-and-back-off`: chạy tới đâm tường, lùi 1,1 s, dừng (lượt chạy kết thúc ở cú đâm) | 0 |
  | `rb-stop-at-wall` | `dash-then-creep`: chạy 50 % 6070 ms rồi bò 33 % tới hết lượt | 0 |
  | `rb-line-follow` | `crawl-and-dash`: chạy 33 % 12 s, quay trái 830 ms, chạy 100 % 1,8 s, dừng | 0 |
  | `rb-line-follow` | `short-drive`: chạy 50 % 1,8 s rồi dừng | 40 |
  | `rb-line-follow` | `three-leg-route`: đông, quay, bắc, quay, tây vào gara, canh giờ cho biến thể 0 | 60 |
  | `rb-servo-gate` | `flag-and-crash`: servo 160°, chạy tới không dừng | 40 |
  | `rb-servo-gate` | `flag-crash-and-back-off`: servo 160°, chạy tới đâm cổng, lùi 1,1 s, dừng | 40 |
  | `rb-servo-gate` | `flag-dash-then-creep`: servo 160°, chạy 50 % 5300 ms rồi bò 33 % tới hết lượt | 40 |
  | `rb-mini-mission` | `follower-without-distance`: bộ bám vạch có "else dừng", không đo khoảng cách | 45 |
  | `rb-mini-mission` | `timed-follower`: lặp bộ bám vạch 300 000 lần rồi dừng (không số lần nào qua) | 45 (trước C2 là 35: contract 0.1.7 tính motorSet 43,6875 µs nên vòng đếm dài hơn và đâm vật cản ở mọi biến thể) |
  | `rb-mini-mission` | `timed-follower-creep`: như trên, rồi bò 33 % 6 s và dừng | 45 |
  | `rb-mini-mission` | `timed-follower-creep-forever`: như trên, rồi bò 33 % tới hết lượt | 45 |
  | `rb-mini-mission` | `follower-bump-and-back`: bộ bám vạch 40 %, mất vạch thì lùi 500 ms và dừng | 45 |

## 8. Kiểm tra trên máy

```sh
# Luật, biến thể (kể cả createScenarioWorld dựng được mọi biến thể), toolbox, compile, Blockly, golden, manifest
pnpm exec vitest run tests/robot-scenarios.test.ts src/samples

# Manifest cho STEMLearning: sinh lại rồi commit; --check chỉ kiểm
pnpm export:robot-manifest
pnpm export:robot-manifest --check

# Sau khi cố ý đổi lời giải chuẩn: cập nhật golden, xem diff, rồi compile bằng arduino-cli (RAM ≤ 75 %)
pnpm exec vitest run tests/robot-scenarios.test.ts -u
pnpm check:arduino --require

# Chạy thử lời giải trên world thật (spike, thay cho Kiểm tra cho tới khi R3.6/R6.2 có): kết quả ở spikes/r52-scenario-sim/results/
pnpm exec vitest run --config spikes/r52-scenario-sim/vitest.config.ts run
SPIKE_ONLY=rb-line-follow SPIKE_PROGRAM=reference,blind pnpm exec vitest run --config spikes/r52-scenario-sim/vitest.config.ts run

# Trước khi commit
pnpm verify
```

Các bước sửa hay thêm một kịch bản:

1. Sửa `src/samples/robot-scenarios/<key>.json` (một kịch bản mới cần key mới trong `robot-keys.ts`, title trong `messages.ts`, một
   dòng import trong `ready-fields.ts`, và lời giải trong `robot-solutions.ts`).
2. Tăng `version` nếu hành vi đổi.
3. Chạy spike để chỉnh vùng, thời gian, seed cho tới khi lời giải chuẩn qua mọi biến thể có biên, lời giải mù qua biến thể 0 và
   trượt ≥ 1 biến thể; ghi số đo vào `notes`.
4. `pnpm export:robot-manifest`, cập nhật golden nếu lời giải chuẩn đổi, `pnpm check:arduino --require`, `pnpm verify`.

## 9. Sáu kịch bản của khóa pilot

| Key | Bài | Sa bàn | Goal (điểm) | Biến thể |
|---|---|---|---|---|
| `rb-drive-to-zone` | 1. Làm quen | 160×80, vùng đích x 76–106 | reach-zone 30, stop-in-zone 70 | 1 |
| `rb-square-route` | 2. Lộ trình | 130×130, hình vuông cạnh 60, checkpoint giữa mỗi cạnh | nửa vòng 30, cả vòng 50, uses-block repeat 20 | 1 |
| `rb-stop-at-wall` | 3. Siêu âm | 160×100, vùng dừng x 126–146 trước tường; chạm tường là hết lượt | stop-in-zone 70, avoid-contact wall 30 | 3, seed 3004, 18 cm, 5° |
| `rb-line-follow` | 4. Dò line | 170×140, vạch mở 2,5 cm vòng qua sa bàn vào gara (miệng quay về hướng vạch tới), 120 s | stay-on-line ≥ 0,85: 40, reach-zone "Vào gara" 60 | 3, seed 485, 1,5 cm, 5° |
| `rb-servo-gate` | 5. Servo ("Giơ cờ ở cổng") | 160×100, cổng x 140, vùng x 108–128; chạm cổng là hết lượt | servo-angle 150–180° trong vùng 40, stop-in-zone 40, avoid-contact gate 20 | 3, seed 1409, 18 cm, 5° |
| `rb-mini-mission` | 6. Tổng hợp | 180×140, vạch gấp 45° chạy tới sát tường bến (y 137), 2 cọc; chạm cọc hay tường bến là hết lượt | checkpoints 25, stay-on-line ≥ 0,85: 20, avoid-contact 15, stop-in-zone 20, finish-within 35 s: 10, thưởng thời gian 10 | 3, seed 3225, 1,5 cm ngang, 15 cm dọc, 5° |
| `rb-sandbox` | Sân tập | 200×150, vòng vạch, hộp, cọc | không goal | 1 |
