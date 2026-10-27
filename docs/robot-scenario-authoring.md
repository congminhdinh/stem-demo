# Soạn kịch bản robot (`rb-*.json`)

Tài liệu cho người soạn và người sửa kịch bản của lab robot (N18 R5.3). Nó nói một kịch bản gồm những gì, các luật bắt buộc, cách
Kiểm tra chấm điểm (R6.2), cách thiết kế biến thể để "chạy mù" bị bắt, cách kiểm tra trên máy trước khi commit, và cách in sa bàn ra
kích thước thật để thử trên robot thật (mục 10). Ví dụ lấy từ sáu kịch bản của khóa pilot (R5.2a) trong `src/samples/robot-scenarios/`.

Đọc kèm: plan `docs/robot-3d-implementation-plan.md` §4.6 (schema), §R6.1 (ý nghĩa từng goal), §R6.2 (chấm điểm và Kiểm tra),
`docs/lab-embed-contract.md` §3 (kết quả `check-result` gửi host), `src/core/scenario/scenario-schema.ts` (luật schema, thông báo lỗi),
`src/core/hardware/kits/README.md` (kit tham chiếu và số cơ khí PLACEHOLDER).

## 1. Một kịch bản nằm ở đâu và ai đọc nó

| Nơi | Vai trò |
|---|---|
| `src/samples/robot-scenarios/<key>.json` | **Nguồn duy nhất** của kịch bản. Tên file đúng bằng `key`. |
| `src/samples/robot-scenarios/index.ts` | Catalog: nạp và validate mọi file bằng `loadScenario` khi module được import; file sai là lỗi ngay. |
| `src/samples/robot-scenarios/ready-fields.ts` | Đọc `version`, `goals[].points`, `scoring` của từng file cho message `ready` (không qua schema, để bundle chính không kéo `src/core/world`). Test giữ nó khớp catalog. |
| `docs/fixtures/robot-scenarios.v1.json` | Manifest cho STEMLearning (key, version, title, goal ids, maxScore). Sinh bằng `pnpm export:robot-manifest`, **phải commit** cùng thay đổi. |
| `src/samples/robot-solutions.ts` | Lời giải chuẩn (`reference`), lời giải chạy mù (`blind`, bài 3–6 và bài tay gắp 8, 9, 11) và ghi chú (`notes`) của mỗi kịch bản có điểm. |
| `tests/robot-scenarios.test.ts` | Kiểm tra tĩnh: luật, biến thể, toolbox, compile, Blockly, golden. |
| `tests/robot-solutions/<key>.ino` | Sketch Arduino của lời giải chuẩn (golden); `pnpm check:arduino --require` compile nó bằng arduino-cli. |
| `src/core/scenario/{scoring,check-robot}.ts` | Chấm điểm và Kiểm tra thật (R6.2): mục 4 nói luật chấm, mục 8 nói cách chạy sáu bài pilot qua nó. Là **cổng** của mọi thay đổi kịch bản. |
| `src/core/scenario/arena-mat.ts`, `scripts/export-arena-mat.mjs` | In sa bàn ra kích thước thật (mục 10). Đọc sa bàn từ chính kịch bản, không có bản sao hình học. |

Key `rb-*` là hợp đồng công khai (khóa học lưu nó): **không bao giờ đổi tên hay dùng lại**. Danh sách key ở `src/samples/robot-keys.ts`.
Đổi hành vi của kịch bản (sa bàn, goal, điểm, biến thể, thời gian, starter, toolbox) thì **tăng `version`**, chạy lại
`pnpm export:robot-manifest` và commit manifest.

## 2. Các trường

| Trường | Ý nghĩa |
|---|---|
| `key`, `version`, `title {vi, en}` | `title` trùng với `robot.scenario.<key>` trong `src/ui/i18n/messages.ts` (test kiểm). |
| `profile`, `kit` | Profile mà key cần (`robot-keys.ts`, hiện là `uno-basic`) và kit của key: `ref-uno-rover` (bài 1–6, sân tập) hay `ref-uno-gripper` (bài 8–11, mục 11). |
| `arena` | Sa bàn: `ground`, `paint.lines`, `paint.zones`, `walls`, `boxes`, `cylinders`, `objects` (mục 3). |
| `start` | `{ xCm, yCm, yawDeg }`: điểm trên sàn dưới **giữa thân** robot và hướng (độ, ngược chiều kim đồng hồ từ +x). |
| `variants` | `{ count, seed, startJitterCm, startJitterAlongCm?, yawJitterDeg, obstacleJitterCm?, objectJitter?, objectColors? }` (mục 6; hai trường cuối của N19: mục 11.3). |
| `inputs` | Kịch bản nhấn/nhả nút (`button1`) theo thời gian; bỏ trống nếu không cần. |
| `timeLimitS` | Thời gian chạy tối đa (0, 600] giây. Mỗi biến thể chạy tới mốc này khi Kiểm tra. |
| `goals` | Danh sách mục tiêu (mục 4). |
| `scoring` | `{ timeBonusMax? }`. Luôn ghi (kể cả `{}`), vì `ready-fields.ts` đọc nó. |
| `starter` | Workspace Blockly mà bài mở ra (JSON như `Blockly.serialization.workspaces.save`). |
| `toolbox` | Danh sách block type được dùng; bỏ trống = mọi block (chỉ `rb-sandbox`). |
| `endOnContact` | Các tag (hay loại collider) mà lần chạm đầu tiên **kết thúc lượt chạy**, như đâm xe trong thi robot (mục 4). Bỏ trống: chạm không dừng gì. |

Khoá lạ bị từ chối (không bị bỏ qua), nên gõ sai tên khoá là lỗi ngay khi nạp.

**Giới hạn của schema** (`scenario-schema.ts`; vượt thì kịch bản không nạp được, lỗi nói rõ đường dẫn tới giá trị sai). Hai giới hạn đầu là của
LMS (STEMLearning lưu kết quả Kiểm tra), không phải của mô phỏng:

| Trường | Giới hạn |
|---|---|
| `goals` | **tối đa 20** (`GOALS_MAX`; `LabAttemptRules.MaxGoals` của LearningService lưu 20 goal một lượt) |
| `version` | số nguyên từ 1 tới **2 147 483 647** (`SCENARIO_VERSION_MAX`; `scenarioVersion` của kết quả Kiểm tra là int 32 bit) |
| `goals[].id` | `[a-z0-9-]`, ≤ 50 ký tự, không trùng; `label.vi`/`label.en` ≤ 200 ký tự, không rỗng, không có ký tự điều khiển hay định dạng (xem dưới) |
| `title.vi`/`title.en` | ≤ 120 ký tự, không rỗng, không có ký tự điều khiển hay định dạng |

Nhãn và tên bài theo đúng luật goal của LMS (`LabAttemptRules.IsGoalText`, N18 final fix M5, `src/core/scenario/goal-text.ts`): cắt hai đầu
như `string.Trim()` của .NET, đếm theo đơn vị UTF-16, và **không** có code point Unicode loại Cc (xuống dòng, tab…) hay Cf (zero-width,
bidi, BOM, soft hyphen, ZWJ nối các emoji ghép, ký tự tag của cờ vùng). LearningService từ chối mọi lần chấm mang một nhãn như vậy,
nên schema từ chối nó ngay khi nạp scenario. Dấu kết hợp (tiếng Việt dạng tách), variation selector, emoji đơn và khoảng trắng bên trong vẫn được.
| `variants.count` | số nguyên 1–10 (`VARIANTS_MAX`); `seed` số nguyên 0–4 294 967 295 |
| `timeLimitS` | trên 0 và ≤ 600 s; `finish-within.seconds` và `stop-in-zone.holdS` không quá `timeLimitS` |
| `inputs` | ≤ 100 lần nhấn/nhả, mỗi lần trong `[0, timeLimitS)`, mỗi nút xen kẽ nhấn–nhả bắt đầu từ nhả, một lần một thời điểm |
| `endOnContact` | mỗi tag phải có trong sa bàn (`wall`, `box`, `cylinder`, `object` hay tag của vật), không trùng, không rỗng |
| `startJitterAlongCm` | số ≥ 0; có thì dời dọc hướng xuất phát bằng nó và ngang hướng bằng `startJitterCm`; bỏ trống thì dời `startJitterCm` theo x và y |
| `scoring.penalties` | chỉ nhận mảng rỗng: chưa có loại phạt nào |

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
- **`objects`:** vật để đẩy (goal `object-in-zone`) hay để gắp (bốn goal gắp–đặt của N19). Pilot (bài 1–6) chưa dùng; bốn bài tay gắp dùng
  (mục 11: vật phải vuông nhìn từ trên). Tay servo **chỉ là cờ báo hiệu**: từ R3.5 nó nằm trong thân robot ở mọi góc, không đẩy được gì;
  muốn đẩy vật thì dùng thân robot.

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

### Điểm của một biến thể và của một Kiểm tra (R6.2)

Phép chấm nằm ở `src/core/scenario/scoring.ts` và `check-robot.ts`; Kiểm tra tạo **một** `RobotRunSession` của riêng nó (tách khỏi phiên của nút Chạy,
cùng loại phiên) và chạy lần lượt từng biến thể bằng `start(project, index, { check: true })`, mỗi biến thể có một scorer mới, chấm bằng các goal ở trên. Mọi con số dưới đây lấy từ thời gian mô phỏng, không từ đồng hồ thật, nên giống hệt ở
headless, 1× và 4×.

- **Điểm một biến thể:** tổng `points` của các goal **qua** (tất cả hoặc không, R6.1) cộng thưởng thời gian, kẹp vào `[0, 100]`.
- **Thưởng thời gian** (`scoring.timeBonusMax`) chỉ có khi **mọi** goal của biến thể đó qua (kể cả `finish-within`), và giảm tuyến tính theo
  `tFinish`, lúc mà mọi goal bắt đầu cùng qua và giữ qua tới hết run:
  `thưởng = floor(timeBonusMax × max(0, 1 − tFinish / timeLimitS))`, điểm nguyên. Ví dụ tính: `timeBonusMax 10`, `timeLimitS 45`, `tFinish 20 s`
  cho `floor(10 × 25/45) = floor(5,56) = 5`. `tFinish` là **đầu chuỗi liên tục cuối cùng** mà mọi goal cùng qua, không phải lần đầu: một goal qua
  rồi trượt lại (vật bị đẩy ra khỏi vùng, goal canh gác bị chạm) làm chuỗi bắt đầu lại. `finish-within` đo cùng thời điểm đó nhưng chỉ trên các goal
  *khác* nó: qua khi thời điểm ấy ≤ `seconds` (gồm đúng bằng); một kịch bản chỉ có `finish-within` thì qua từ t = 0.
- **Biến thể kết thúc vì lỗi chương trình** (một lỗi của chương trình, ví dụ `out-of-domain`, hay lỗi của chính mô phỏng; trạng thái run `error`) được
  **0 điểm**, trượt, mọi goal trượt với lý do `program-error`, không thưởng: world đứng yên lúc lỗi, nên chấm cảnh bị đóng băng đó sẽ cho điểm
  một chương trình cố ý lỗi ngay khi goal vừa qua.
- **Một Kiểm tra** (`checkResultOf`, kết quả gửi host theo `docs/lab-embed-contract.md` §3): `passed` = mọi goal qua ở **mọi** biến thể;
  `goal.passed` = qua ở mọi biến thể; **`score` = điểm thấp nhất** trong các biến thể (không phải trung bình: một biến thể may mắn không làm điểm
  cao, nhất quán với `passed`); `simTimeMs` = của biến thể dài nhất; mỗi biến thể có `{ seed, passed, score, simTimeMs }`.
- **Run kết thúc** khi chạm `timeLimitS` hay khi `endOnContact` (xem trên); hai trường hợp này áp cho cả nút Chạy, nên Chạy giống hệt
  biến thể 0 của Kiểm tra.
- Điểm các goal, `timeBonusMax` và giới hạn thời gian là dữ liệu của kịch bản; **đổi bất kỳ số nào trong chúng đổi điểm của người học**, nên tăng
  `version` (mục 1).

## 5. Luật bắt buộc (checklist)

1. **Điểm = 100:** `Σ points + (timeBonusMax ?? 0) = 100`, số nguyên. `rb-sandbox` không có goal, không có `timeBonusMax`.
2. **Goal phải thưởng một hành động:** mỗi goal canh gác (`avoid-contact`, `stay-on-line`, N19: `object-unmoved`) phải đi cùng ít nhất một goal
   "đạt tới" (`reach-zone`, `checkpoints-in-order`, `stop-in-zone`, `servo-angle`, `object-in-zone`, N19: `object-held`, `object-placed`,
   `object-on-object`). Robot ở mọi biến thể **không được bắt đầu trong** (hay sát, trong 13 cm) vùng mà
   một goal gửi nó tới; vật không được bắt đầu trong vùng đích của nó. Starter không được giải bài (mục 7).
3. **Vùng checkpoint của một goal không chồng nhau**, không vẽ đa giác tự cắt.
4. **Chỗ xuất phát:** footprint của robot là hình tròn 11 cm (`ROBOT_FOOTPRINT_RADIUS_CM`; góc bánh của `ref-uno-rover@0` cách giữa thân
   10,27 cm). Pilot giữ thêm **2 cm** trống quanh mọi chỗ xuất phát của mọi biến thể (13 cm tới tường, vật, mép sàn). `createWorld`
   từ chối chỗ xuất phát mà bất kỳ phần nào của robot (thân, bánh, bánh tự lựa, tay servo ở mọi góc) đè lên vật.
5. **Tốc độ trong lời giải ≥ 40 %:** kit placeholder không chạy dưới duty khoảng 80 (31 %) và rất chậm ngay trên đó. Xe tay gắp: **≥ 50 %**
   (ruling G0 start duty: xe giữ 50 g khởi động được từ duty 128; ngưỡng khoảng 95).
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
12. **Đâm là hết lượt** khi bài coi đâm là hỏng: đặt `endOnContact` bằng tag của `avoid-contact` (mục 4). Xe tay gắp: **mọi** bài có
    `endOnContact: ["wall"]`, có goal canh gác hay không (ruling G0 wall, mục 11.3).

## 6. Biến thể (`variants`)

Kiểm tra (R6.2) chạy `count` biến thể và chỉ qua khi mọi goal qua ở **mọi** biến thể; điểm là **điểm thấp nhất** trong các biến thể (ruling
cho R6.2: một biến thể may mắn không làm điểm cao). Biến thể 0 là chỗ xuất phát đúng như soạn. Biến thể ≥ 1 dời chỗ xuất phát `±startJitterCm`
theo x và y (hoặc, có `startJitterAlongCm`, ±giá trị đó dọc hướng xuất phát và ±`startJitterCm` ngang hướng), quay `±yawJitterDeg`, và dời mỗi vật có tag `jitter`
`±obstacleJitterCm`, tất cả từ `seed` (`variants.ts`, tất định trên mọi engine). Lần bốc không vừa (ra mép, đè vật) thì bốc lại, tối
đa 20 lần, rồi giữ vị trí đã soạn: thiết kế sao cho không lần nào phải bốc lại (test kiểm rằng mỗi biến thể ≥ 1 đều dời thật, trừ kịch bản
không dời vị trí: bài 10 chỉ quay).

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
  không qua và không quá điểm tối đa) do hai file test của Kiểm tra thật giữ (mục 8).

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
  học sinh dựng chương trình, nên starter không qua goal nào. `rb-sandbox` mở với "on start" và "forever" trống. Bốn bài tay gắp mở với
  "khi bắt đầu" và một khối **"tay hạ"** rời (`uno_gripper_lift` `DOWN`), bước đầu tiên của bài gắp (review 1 M6).
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

Hai tầng. **Tĩnh** (vài giây): luật, biến thể, toolbox, golden, manifest. **Thật** (cổng): lời giải chạy qua đúng code của nút Kiểm tra
(`checkRobot`, R6.2), nên điểm, verdict và lý do trượt là của người học thấy, không phải ước lượng.

```sh
# Tĩnh: luật, biến thể (kể cả createScenarioWorld dựng được mọi biến thể), toolbox, compile, Blockly, golden, manifest
pnpm exec vitest run tests/robot-scenarios.test.ts src/samples

# Thật (cổng của mọi thay đổi kịch bản, lời giải hay kit): sáu lời giải chuẩn, mọi lời giải mù và exploit qua Kiểm tra thật
pnpm exec vitest run src/core/scenario/check-robot.pilots.test.ts src/core/scenario/check-robot.pilot-challenges.test.ts

# Manifest cho STEMLearning: sinh lại rồi commit; --check chỉ kiểm
pnpm export:robot-manifest
pnpm export:robot-manifest --check

# Sau khi cố ý đổi lời giải chuẩn: cập nhật golden, xem diff, rồi compile bằng arduino-cli (RAM ≤ 75 %)
pnpm exec vitest run tests/robot-scenarios.test.ts -u
pnpm check:arduino --require

# Xem sa bàn ra kích thước thật (mục 10)
pnpm export:arena-mat rb-line-follow

# Trước khi commit
pnpm verify
```

Hai file test của tầng thật:

- **`check-robot.pilots.test.ts`:** lời giải chuẩn (`reference`) của mỗi kịch bản có điểm chạy qua Kiểm tra headless, ở 1× và ở 4×. Phải **qua mọi goal ở
  mọi biến thể**, và ba cách chạy phải cho cùng điểm, verdict, goal, `programHash` và hash của world cuối. Điểm hiện tại: 100, 100, 100, 100, 100,
  96 cho bài 1–6 (bài 6 có biến thể 97, nên điểm check là 96).
- **`check-robot.pilot-challenges.test.ts`:** lời giải mù (`blind`, bài 3–6) và mọi `exploits` chạy headless. Mỗi chương trình phải **trượt** (≥ 1 biến thể
  không qua mọi goal). Hai loại khác nhau ở điểm: một **lời giải mù không có `maxScore`** (`check-cases.ts` chỉ đòi nó `passed: false`), còn mỗi **`exploit` phải
  trượt *và* có điểm check không quá `maxScore`** ghi cho nó trong `robot-solutions.ts` (luật 10 của mục 5; `maxScore` ≤ 60). Điểm exploit đo được tới nay:
  `rb-stop-at-wall` 0 / 0, `rb-line-follow` 0 / 40 / 60, `rb-servo-gate` 40 / 40 / 40, `rb-mini-mission` 45 cho cả năm. Điểm check đo được của các lời giải mù (bài 3–6): 0, 60, 0, 0;
  đó là giá trị quan sát, không có test nào ghim chúng.

Cả hai đọc chương trình từ `src/samples/robot-solutions.ts` qua `src/core/scenario/__fixtures__/check-cases.ts`: thêm một `exploit` hay một kịch bản
có lời giải vào `robot-solutions.ts` là hai file test tự chạy nó, không phải thêm test. Một `exploit` được điểm cao hơn `maxScore` đã ghi nghĩa là
kịch bản (hay kit) đã đổi và để hở: sửa sa bàn, biến thể hay goal cho tới khi nó trượt lại, **đừng nâng `maxScore` để test xanh** (nâng chỉ khi
controller ra ruling, như điểm 45 của `timed-follower` sau C2).

Giá (đo ở R5.3: Apple M4 Pro, Node 24.22.1, máy đang chạy nhiều tiến trình khác): hai file mất **65 s** (25 test), trong đó bài 4 (120 s × 3 biến thể) khoảng
13 s một lần headless. Chạy chúng khi đổi kịch bản, lời giải hay kit, không phải sau mỗi lần sửa chữ.

**Spike `spikes/r52-scenario-sim` vẫn dùng được như công cụ soạn, không phải cổng.** Nó chạy lời giải trên world và goal thật của R3/R6.1 nhưng không qua
run session, scorer hay Kiểm tra (nối pin tới actuator và thưởng thời gian của nó đơn giản hơn), và có các phép quét thời gian, seed, tốc độ
mà test không có. Dùng nó để *tìm* con số (vùng, thời gian, seed), rồi để Kiểm tra thật *xác nhận*: khi hai bên khác nhau thì Kiểm tra thật đúng.
Kết quả ở `spikes/r52-scenario-sim/results/`.

```sh
pnpm exec vitest run --config spikes/r52-scenario-sim/vitest.config.ts run
SPIKE_ONLY=rb-line-follow SPIKE_PROGRAM=reference,blind pnpm exec vitest run --config spikes/r52-scenario-sim/vitest.config.ts run
```

Các bước sửa hay thêm một kịch bản:

1. Sửa `src/samples/robot-scenarios/<key>.json` (một kịch bản mới cần key mới trong `robot-keys.ts`, title trong `messages.ts`, một
   dòng import trong `ready-fields.ts`, và lời giải trong `robot-solutions.ts`).
2. Tăng `version` nếu hành vi đổi.
3. Dùng spike để chỉnh vùng, thời gian, seed cho tới khi lời giải chuẩn qua mọi biến thể có biên, lời giải mù qua biến thể 0 và
   trượt ≥ 1 biến thể; ghi số đo vào `notes`.
4. Chạy hai file test của Kiểm tra thật (trên); xem `pnpm export:arena-mat <key>` để chắc sa bàn đúng như định.
5. `pnpm export:robot-manifest`, cập nhật golden nếu lời giải chuẩn đổi, `pnpm check:arduino --require`, `pnpm verify`.
6. **Phía STEMLearning, cùng đợt phát hành** (N18 final fix M9; như `docs/lab-embed-contract.md` §1, mục manifest). Thiếu bước này thì
   CourseService từ chối key mới, còn LearningService từ chối mọi lần chấm của kịch bản đã đổi:
   - Chép `docs/fixtures/robot-scenarios.v1.json` mới, giống từng byte, sang `STEMLearning/Web/packages/api/src/lab/__fixtures__/robot-scenarios.v1.json`
     và sửa sha256 ghim nó trong `Web/packages/api/src/lab/lab-templates.test.ts`.
   - Mỗi kịch bản có key mới, `version` mới hay `goals` khác: chép `version` và `goalIds` (đúng thứ tự của manifest) vào
     `Services/CourseService/Config/appsettings.json` `CourseService:LabTemplates:Robot` (mỗi mục `{ "Key", "Version", "GoalIds" }`, theo
     thứ tự manifest; `rb-sandbox` có `[]`) và vào `LabTemplateCatalog.DefaultRobotScenarios`
     (`Services/CourseService/Features/Activities/LabTemplateCatalog.cs`). LearningService từ chối lần chấm robot có goal id khác hay sai thứ
     tự, hoặc `templateVersion` mới hơn `version` này; test ghim trong `lab-templates.test.ts` so cả hai với manifest, nên chúng đỏ tới khi
     ba bản khớp nhau. CourseService và LearningService deploy cùng nhau.
   - Một key mới còn cần: `LAB_TEMPLATES.robot` (`Web/packages/api/src/lab/lab-templates.ts`, đúng thứ tự manifest; thêm vào
     `ADVANCED_ROBOT_SCENARIOS` nếu kịch bản cần `uno-advanced`), tên và tóm tắt trong `Web/packages/i18n/messages/vi/admin.json`
     (`builder.labs.templates.<key>.title` và `.summary`), và hình nhỏ trong `ScenarioThumbnail.tsx` của admin (test đòi mỗi kịch bản robot có
     một hình).

**Engine version (N18 final fix M6).** Lần chấm của thí điểm đã được lưu (từ browser test R8). Từ nay mọi thay đổi world, cảm biến hay chi
phí (`costsUs`, `toneUs`, mô hình motor…) làm một chương trình chạy khác đi phải tăng `ROBOT_ENGINE_VERSION` (`src/core/world/snapshot.ts`)
cùng `ROBOT_ENGINE` (`src/core/scenario/check-result.ts`; test ghim `ROBOT_ENGINE` = `robot-engine@<ROBOT_ENGINE_VERSION>`) và golden
tất định (`tests/__snapshots__/robot-determinism.json`). Không tăng thì `verify:attempt` gọi lần chấm trung thực cũ là `mismatch`; tăng
thì nó báo `unverifiable` `engine` (chạy lại bằng bản build cũ). Đổi một kịch bản là việc của `version` của kịch bản đó (bước 2).

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

## 10. In sa bàn

Để thử một bài trên robot thật cần một tấm sa bàn thật đúng kích thước. Script đọc kịch bản và in sa bàn của nó ra kích thước thật:

```sh
pnpm export:arena-mat rb-line-follow            # một kịch bản
pnpm export:arena-mat all --out ~/Desktop/mats  # cả bảy, vào thư mục chỉ định
```

`--out` mặc định là `./arena-mat` (đã nằm trong `.gitignore`); thư mục được tạo nếu chưa có. Cần Chromium của Playwright
(`pnpm exec playwright install chromium` nếu máy chưa có). **`pnpm verify` và `pnpm test` cũng cần nó**: `tests/export-arena-mat.test.ts` chạy cả script, nên máy hay CI chưa cài
Chromium sẽ đỏ ở test đó. Mỗi sa bàn mất 3–7 s (`all`: 28 s, đo trên Apple M4 Pro). Mã thoát: 0 xong; 1 một thứ
không làm được (kịch bản không hợp lệ, thiếu Chromium, một file ra sai kích thước); 2 gõ sai lệnh (khoá không có, thiếu khoá, tuỳ chọn lạ).

**Bốn file cho mỗi sa bàn** (`<key>` là khoá, ví dụ `rb-line-follow`):

| File | Là gì | Dùng để |
|---|---|---|
| `<key>.svg` | Vector, `width="170cm" height="140cm"`, `viewBox="0 0 170 140"` (1 đơn vị = 1 cm). Chỉ có sa bàn, không có gì ngoài mép | Gửi tiệm in bạt/decal; mở bằng Inkscape/Illustrator để sửa |
| `<key>.pdf` | **Một trang đúng bằng kích thước sa bàn** (170 × 140 cm = 4818,9 × 3968,5 pt), vector | Gửi tiệm in khổ lớn |
| `<key>-a4.pdf` | Các trang A4 dọc, mỗi trang một cửa sổ 18,6 × 26,7 cm của sa bàn ở 100 %, chồng nhau 1 cm, có dấu cắt và dấu căn, "hàng/cột", và dải chú thích | In ở nhà rồi dán |
| `<key>.png` | 150 dpi (chunk `pHYs` = 5906 px/m): 170 × 140 cm là **10039 × 8268 px** | Phần mềm không đọc vector |

| Khoá | Kích thước (cm) | PNG 150 dpi (px) | Số trang A4 (cột × hàng) |
|---|---|---|---|
| `rb-drive-to-zone` | 160 × 80 | 9449 × 4724 | 40 (10 × 4) |
| `rb-square-route` | 130 × 130 | 7677 × 7677 | 48 (8 × 6) |
| `rb-stop-at-wall` | 160 × 100 | 9449 × 5906 | 40 (10 × 4) |
| `rb-line-follow` | 170 × 140 | 10039 × 8268 | 60 (10 × 6) |
| `rb-servo-gate` | 160 × 100 | 9449 × 5906 | 40 (10 × 4) |
| `rb-mini-mission` | 180 × 140 | 10630 × 8268 | 66 (11 × 6) |
| `rb-sandbox` | 200 × 150 | 11811 × 8858 | 72 (12 × 6) |

**Hình học là của kịch bản, không có bản sao thứ hai.** Script nạp kịch bản bằng đúng `loadScenario` của lab (nên kịch bản sai không in được), rồi
`buildArenaMat` (`src/core/scenario/arena-mat.ts`, thuần chuỗi, có test) đọc `arena` đã validate: vạch là polyline dày đúng `widthCm` với đầu và khớp
tròn (đúng hình mà `ground-paint.ts` đọc: một điểm ở trên vạch khi cách một đoạn không quá nửa bề rộng), vùng là đa giác even-odd theo thứ tự
của sa bàn (vùng sau đè vùng trước, vạch đè lên vùng), sàn là `ground.color`. Trục: y của sa bàn hướng lên trên tờ in.

**Cái gì được vẽ:**

| Thành phần | Cách vẽ | Nhóm trong SVG |
|---|---|---|
| Sàn | hình chữ nhật `ground.color` | `mat-ground` |
| Vùng | đa giác tô `color`, viền mảnh bằng bản tối hơn 20 % của màu đó, nhãn 2 dòng: `id` và loại (`vùng xuất phát`, `vùng đích`, `điểm kiểm tra n`, `vùng`); vùng nằm trong lộ trình dài nhất của một goal `checkpoints-in-order` có thêm thứ tự | `mat-zones`, `mat-zone-labels` |
| Vạch | polyline đen đúng `widthCm`, đầu và khớp tròn | `mat-tape` |
| Tường, hộp, trụ, vật đẩy | **dấu chân** (footprint) gạch chéo với viền nét đứt, nhãn `tường`, `vật cản`, `vật đẩy` (cùng `id` nếu có): đây là vật thật phải đặt lên, không phải mực sơn | `mat-obstacles`, `mat-labels` |
| Chỗ robot xuất phát | vòng tròn bán kính chân đế của kit (`kitFootprintRadiusCm`, chỗ trống mà các biến thể giữ: 11 cm cho `ref-uno-rover@0`, kit nhô xa hơn như tay gắp thì lớn hơn; N19 D1), dấu cộng ở giữa thân, mũi tên theo hướng, và `xuất phát · x 50, y 30 cm · 0°` | `mat-start` |

Nhãn của vùng tự né vạch và chỗ robot đứng (thu nhỏ chữ, tới 40 %, nếu vùng chật) và nằm **dưới** vạch: không gì được vẽ chồng lên vạch.

**Làm tấm sa bàn thật:**

1. **Tiệm in:** gửi `<key>.pdf` (hay `.svg`) và nói in 100 %, không co giãn. Hỏi chất liệu: sàn `#f2f2f2` là xám rất nhạt, nên chọn bạt hay decal trắng mờ, không bóng
   (bề mặt bóng dễ làm cảm biến hồng ngoại đọc loá).
2. **In A4 ở nhà:** mở `<key>-a4.pdf`, in với **Actual size / 100 %**, tắt "Fit to page" và "Scale to fit". **Đặt thước lên thanh 10 cm ở chân trang**: đúng 10 cm
   thì mới tiếp tục (in co giãn sẽ ra sa bàn sai kích thước). Bốn dấu cộng-vòng ở góc giấy cũng cách nhau đúng 19,8 × 28,5 cm. Cắt bỏ lề theo dấu cắt ở bốn góc cửa sổ,
   xếp trang theo "hàng/cột" (hàng 1 ở trên, cột 1 ở bên trái) chồng 1 cm lên nhau cho khớp nội dung, dán. Đường đứt đỏ ở trang rìa là mép sa bàn.
3. **Vạch đen:** vạch đã in sẵn là đường đi của băng keo; dán băng keo đen đúng `widthCm` (2,5 cm cho sáu bài pilot) lên trên, hoặc dùng luôn vạch in nếu mực đen đủ tối.
4. **Vật cản và tường:** đặt hộp, trụ, tường thật đúng chỗ dấu chân gạch chéo, đúng kích thước ghi trong `arena` (`sizeCm`, `radiusCm`, `heightCm`, `thicknessCm`).
5. **Robot:** đặt giữa thân tại dấu cộng của vòng xuất phát, mũi hướng theo mũi tên.

**Giới hạn cần biết:**

- Sa bàn in **đúng hình học và tỉ lệ**, không bảo đảm độ phản xạ hồng ngoại. Trong mô phỏng sàn và vùng có `reflectance` hay độ sáng (luma) của màu và vạch là 0; mực in và
  giấy thật khác, nên ngưỡng "thấy vạch" của cảm biến thật phải hiệu chỉnh lại trên tấm sa bàn thật (plan VG, số đo của kit nhà cung cấp).
- **Mọi thứ in ra đều là mực mà cảm biến đọc được:** viền vùng, nhãn, vòng xuất phát và gạch chéo. Viền vùng chỉ tối hơn màu vùng 20 % (màu vùng sáng, luma > 0,75, nên viền
  vẫn trên 0,6 và cảm biến đọc như sàn); nhãn nằm ngoài vạch. Nếu cảm biến thật vẫn đọc nhầm, mở `.svg` trong Inkscape hay Illustrator và **tắt các nhóm "dấu"**
  (`mat-zone-labels`, `mat-obstacles`, `mat-labels`, `mat-start`), chỉ in `mat-ground`, `mat-zones`, `mat-tape`.
- **Kích thước trang PDF:** Chromium làm tròn khổ trang tới cỡ một điểm (1 pt = 0,35 mm) và `page.pdf` của Playwright đọc `1 cm` là 37,8 px thay vì 37,795; nội dung vẫn đúng tỉ lệ
  (1 cm = 28,3465 pt), chỉ có khung trang lệch. Script đặt lại `MediaBox` đúng kích thước (`scripts/lib/pdf-page-box.ts`, giữ mép trái và mép trên của trang) rồi **đọc lại từ file**
  để kiểm; sai quá 0,005 pt hay sai số trang thì script báo lỗi, không ghi file sai.
- **PNG ghép từ các ô 2048 × 2048 px** (`scripts/lib/png.ts`, chỉ dùng `node:zlib`, không thêm thư viện), nên kích thước ảnh không phụ thuộc giới hạn chụp của Chromium và ảnh không bao giờ
  nằm trọn trong bộ nhớ. Trên Chromium 153 chụp một lần cả trang cũng được (đo tới 30 000 px bề ngang, 10039 × 8268 px mất 1 s) và cho cùng ảnh, trừ 0,015 % điểm ảnh
  (12 701 trên 83 triệu): rìa chéo của vạch, vòng nét đứt và gạch chéo, không dồn ở chỗ giáp ô (ở cột và hàng giáp ô có 0–9 điểm khác, trung bình 1,3 một cột); vạch thẳng
  2,5 cm rộng 147,5 px ở cả hai (đúng 147,6), kể cả chỗ giáp ô.
- Chữ trên bản in là Be Vietnam Pro (`@fontsource`, đã có sẵn trong dependencies), nhúng thẳng vào trang nên giống nhau trên mọi máy. File `.svg` chỉ ghi tên font: máy mở nó mà không có font
  này dùng font hệ thống.
- Một kịch bản mới không cần làm gì thêm: script đọc catalog, nên `pnpm export:arena-mat <key mới>` chạy ngay khi kịch bản nạp được.
- Test: `src/core/scenario/arena-mat.test.ts` (SVG, viewBox, bề rộng vạch, id vùng, thanh 10 cm, kế hoạch lát trang, và với mỗi kịch bản: tại 20 000 điểm rải đều, độ phản xạ của `ground-paint.ts` bằng cái SVG vẽ, nên sai bề rộng vạch hay lật trục y là test đỏ), `tests/arena-mat-png.test.ts` (PNG: IHDR, pHYs, đọc lại bằng `node:zlib`),
  `tests/arena-mat-pdf.test.ts` (khung trang), `tests/export-arena-mat.test.ts` (chạy cả script cho `rb-drive-to-zone`, kiểm bốn file, MediaBox ± 0,5 pt và vài điểm ảnh).

## 11. Xe tay gắp: vật, goal gắp–đặt và bốn bài 8–11 (N19 D4–D8)

Bốn bài `rb-grip-pick`, `rb-grip-deliver`, `rb-grip-sort`, `rb-grip-stack` chạy trên kit `ref-uno-gripper@0`: xe UNO của rover cộng tay gắp
2 bậc (kẹp `claw` và tay nâng `lift`, servo D9 và D10), cảm biến hồng ngoại giữa càng (`irClaw`, A3, active low) và cảm biến màu TCS34725
(`color1`, I²C A4/A5). Plan: `docs/n19-gripper-plan.md` §4.4–§4.12 (world và cảm biến), §4.14 (ghi lại khi làm D4–D8), §6 (bốn bài). Các số
dưới đây đo bằng spike `spikes/n19-d4/` (kết quả và lệnh ở `spikes/n19-d4/results.md`) trên kit **PLACEHOLDER**: đổi sang tay gắp của nhà
cung cấp (plan VG) thì phải đo lại mọi thời gian (quay, chở, mọi lời giải mù), kiểm lại vị trí vật và vùng, rồi tăng `version`.

### 11.1 Số của xe tay gắp (PLACEHOLDER)

| Đại lượng | Giá trị (đo) |
|---|---|
| Tốc độ ở 50 % / 60 % / 70 % | 13,2 / 20,0 / 27,0 cm/s (đã chạy đều; 100 %: 47,6) |
| Quay tại chỗ ở 50 % | khoảng 103°/s: 830 ms quay **82°** (rover: 90°), **900 ms quay 91,5°**; tâm thân dời 2,8 cm (quay quanh trục bánh, 2 cm sau giữa thân) |
| Dừng (thả trôi) ở 50 % | trong 0,3 cm |
| Tay 90° → 0° | 0,15 s; kẹp giữ khối 4 cm 0,04 s sau lệnh "kẹp đóng" |
| IR thấy khối | khi tâm khối cách giữa thân 12,55 cm (mặt gần cách cảm biến 2 cm) |
| Khối đang giữ | tâm cách giữa thân 12,3 cm ở tay 0°, 11,65 cm ở tay 90°; ở tay 55° đáy khối cao 4,46 cm |
| Footprint | bán kính 16 cm của kit (biến thể giữ trống); tầm với của tay ở mọi góc 15,30 cm |
| Vật gắp được | bề rộng riêng ≤ 4,3 cm (`gripWidthCm`); tải tối đa 50 g; bệ 6 × 6 cm không gắp được, đúng ý đồ |

### 11.2 Cảm biến: điều chương trình phải biết

- **Siêu âm bị chắn** (plan §4.12): vỏ servo kẹp ở tay 8–40°, giá kẹp ở 41–52° (đọc 2 cm), khối 4 cm đang giữ ở 55–70° (đọc 3,35–3,74 cm). Sạch ở
  0–3° và 56–90° khi không giữ, ở 0° và 80–90° khi giữ. **Chỉ đọc khoảng cách ở tay 0°, hoặc ở 80–90° khi đang giữ.** Sau "tay hạ" phải chờ
  tay xuống hẳn (0,15 s; lời giải mẫu chờ 300 ms): đọc ngay thì gặp tay đang đi qua 8–52° và đọc 2 cm.
- **Siêu âm và khối 4 cm:** cảm biến ở cao 5 cm, nên chỉ tia dưới của nón (−15°) nghe khối, từ khoảng 18,7 cm (đọc khoảng 19 cm). Tiếng
  vọng cuối cùng khi khối vào giữa càng là 3,94 cm; khối nằm giữa càng ở trong **vùng mù** của nón (siêu âm đọc qua nó tới tường xa). Ở tay 45° nó đọc 2 cm (chính giá kẹp).
- **IR:** tầm 2 cm tính từ mount (0,2 cm sau mặt giá kẹp). Không có vật thì không bao giờ thấy ngón; vật đen (`#212121`) không thấy.
- **Màu:** khối đang giữ cách cảm biến khoảng 1,7 cm; bốn màu bảng màu đọc đúng ở 1–3 cm; khối trắng đọc "trắng" ở 1 cm nhưng "không rõ" ở
  3 cm; kẹp đóng mà không có vật thì cảm biến thấy ngón của chính nó và đọc "đen". Đọc màu **sau khi** đã gắp và nâng (cửa sổ đo 52,8 ms).
- **Khối lệch trục:** khối lệch trục xe ≥ 1,5 cm bị một ngón đẩy đi 4,8–33 cm và làm xe đổi hướng tới 9,4° trước khi IR thấy và càng ôm được
  (spike `capture`, 65 lần đều gắp được). Giữ khối trong 1 cm quanh trục: tiếp cận ngắn (bài 10: khối cách 19 cm, lệch 3° chỉ còn 1 cm) hay bám vạch
  (bài 9, 11). Bài 8 không giữ được: biến thể đặt khối lệch tới 3,3 cm. Đặt vật theo khoảng cách tới tường thì chỗ đặt không phụ thuộc chỗ gắp,
  nhưng chưa đủ. Khối lệch từ khoảng 2,5 cm thì siêu âm không bao giờ nghe thấy, và ngón đẩy nó vào sâu trong vùng thả (tới x 127, xe ở x 115)
  trước khi IR thấy. Nếu đặt xuống ở 45 cm cách tường thì quãng chở dưới 5 cm, bị chấm là đẩy. Vì vậy bài 8 tiến 50 % và đặt xuống ở **35 cm**
  (quãng chở còn 10 cm). Test Kiểm tra chạy lời giải ở cả 16 góc của khoảng biến thể (review 1 I1).

### 11.3 Vật, vùng, tường cho xe tay gắp

- **Vật phải vuông nhìn từ trên** (review B1/B2 M6): hộp có `sizeCm[0] = sizeCm[1]`, `yawDeg` 0, hoặc trụ. Không dùng hình chữ nhật: luật 6 của
  máy gắp đo bề rộng riêng là cạnh ngắn, nên hình chữ nhật gặp càng theo cạnh dài có thể bị gắp với hai ngón lún vào vật.
- Khối xốp 4 cm nặng 15 g; bệ 6 × 6 × 4 cm nặng 40 g. `noun` (`cube`, `parcel`, `base`) cho tên trong báo cáo và hình 3D; `color` lấy từ bảng
  màu (`body-colors.ts`: đỏ `#d32f2f`, xanh lá `#388e3c`, xanh dương `#1976d2`, vàng `#fbc02d`) để cảm biến màu và báo cáo gọi đúng ("khối
  đỏ"). Vật không có `color` mang màu theo loại (`#f2c14e`).
- **Vùng:** `name` (`pickup`, `drop`, `warehouse`, `red`, `green`, `blue`, `stack`) cho câu báo ("Khối đỏ nằm ở vùng xanh dương"). Vẫn phải sáng
  (luma > 0,75), và mực hoa văn của mặt thảm phải có tương phản ≥ 2,9 : 1 với màu vùng (`zone-pattern.test.ts`): `#fce4e4` được 3,27 : 1,
  `#f4cccc` chỉ 2,68 : 1. Vùng xuất phát của bài 10 xám `#e0e0e0` (2,99 : 1) để không lẫn với vùng xanh dương.
- **Biến thể của vật:** `objectJitter` dời vật (mỗi mục một lần bốc, các vật trong mục dời cùng nhau), `objectColors` đổi màu theo lượt (phần tử
  0 bằng màu trong sa bàn). Số bốc mới đi **sau** mọi số cũ, nên biến thể của các bài rover không đổi.
- **Chỗ xuất phát và tay gắp:** ở mọi biến thể, mọi vật phải nằm ngoài **toàn bộ** vùng quét của tay gắp (mọi góc nâng và góc kẹp; ruling
  B5/B6). `createWorld` chỉ kiểm vật với tay ở tư thế setup() (90°, càng mở); test tĩnh kiểm thêm vùng quét đầy đủ bằng chính `footprint.ts`.
- **Tường:** mọi bài xe tay gắp đặt `endOnContact: ["wall"]` (ruling G0 wall): đầu ngón hay càng rỗng đâm tường từ 0,33 m/s làm xe ngóc
  8,35–17,16°. Goal canh gác (nếu có) cũng gọi tag `wall`, kể cả kệ kho (tường có tag `kho-wall`, vẽ thành kệ; dựng cho tường 40 × 4 × 12 cm).

### 11.4 Bốn goal gắp–đặt (D2)

| Kind | Qua khi | Mặc định |
|---|---|---|
| `object-held` | giữ vật liên tục `holdS`, đáy vật cao hơn chỗ vật nằm lúc gắp ≥ `minLiftCm`; qua rồi thì giữ nguyên | `holdS 0,5`, `minLiftCm 0` (bài 8, 10: 2; bài 11: 3) |
| `object-placed` | ở cuối lượt: không còn bị giữ, nằm gọn trong vùng (`zone`, hay vùng cùng màu của lượt: `zoneByColor`), thẳng, nằm yên `restS`, **đã được chở**: lần gắp cuối nâng vật ≥ `minCarryLiftCm` và đưa nó đi ≥ `minCarryCm` trên sàn trong lúc nâng, rồi trượt ≤ `maxSlideCm` từ chỗ thả | `fully`, `maxTiltDeg 15`, `restS 0,5`, `carried`, `maxSlideCm 3`, `minCarryLiftCm 1`, `minCarryCm 5` |
| `object-on-object` | ở cuối lượt: khối trên nằm trên khối dưới (z đúng ±0,8 cm), lệch ngang ≤ `maxOffsetCm`, thẳng, yên, không bị giữ, đã được chở như trên | `carried`, `minCarryLiftCm 1`, `minCarryCm 5` |
| `object-unmoved` (canh gác) | vật không bị xê dịch quá `maxMoveCm` và không đổ suốt lượt | `maxTiltDeg 20` |

- **Đẩy vật vào vùng = 0 điểm** ở cả bốn bài: một lần gắp không nâng (kẹp tại chỗ) hay nâng mà không chở 5 cm (nâng tại chỗ) không tính là chở,
  lần đẩy trước đó vẫn là đẩy (`object-pushed`).
- **Hết lượt vì chạm** (`endOnContact`, D2 review M8, quyết định ở D4): `object-held` là một lần giữ như `stop-in-zone`, nên lần gắp bị cú chạm
  cắt ngang trượt với `run-ended-contact`. Với `object-placed` và `object-on-object` chỉ phần **nằm yên** (`object-not-at-rest`) đổi thành
  `run-ended-contact`; các lý do khác (còn giữ, bị đẩy, sai vùng, rơi ngoài vùng, chưa xếp lên bệ) nói vật đang ở đâu và giữ nguyên. Điểm
  và verdict không đổi, chỉ câu lý do (`scoring.hold-kinds.test.ts`).

### 11.5 Bốn bài

| Key | Bài | Sa bàn | Goal (điểm) | Biến thể | Thời gian |
|---|---|---|---|---|---|
| `rb-grip-pick` | 8. Tìm và gắp | 170 × 90; khu lấy hàng x 70–100, vùng thả x 108–148 (y 25–65); khối vàng ở (85, 45) | `grab-cube` object-held minLift 2: 40, `place-cube` object-placed `drop`: 45, `no-crash` wall: 15 | 3, seed 23; xuất phát ±1 cm, ±2°; khối dx ±10 (+9,3 và −10,0) | 30 s |
| `rb-grip-deliver` | 9. Giao hàng theo vạch | 180 × 150; vạch x = 120 từ y 10 tới 135; ba kiện hàng trên vạch ở y 70, 95, 120; kho x 62–100, y 40–125; kệ kho x = 58, y 62,5–102,5 | `deliver-1..3` object-placed `kho`: 25 × 3, `no-crash` wall (kệ kho và tường): 15, thưởng 10 | 3, seed 430; xuất phát ±6 cm dọc vạch (−5,4 và +5,1), ±5° (−4,9° và +3,5°); mỗi kiện dy ±5 | 90 s |
| `rb-grip-sort` | 10. Phân loại theo màu | 170 × 150; xuất phát xám; khối ở (49, 75), 19 cm trước giữa thân; vùng đỏ phía bắc (x 18–48, y 112–142), xanh lá phía trước (x 73–103, y 60–90), xanh dương phía nam (x 18–48, y 8–38) | `grab-cube` minLift 2: 25, `sort-cube` object-placed `zoneByColor`: 60, `no-crash` wall: 15 | 3, seed 8; **không dời vị trí**, chỉ ±3° (−2,3° và +2,9°); màu khối lần lượt xanh lá, đỏ, xanh dương | 30 s |
| `rb-grip-stack` | 11. Xếp chồng (nâng cao) | 200 × 80; vạch từ x 14 tới x 150 rồi hết; khối đỏ ở x 95; bệ vàng 6 × 6 × 4 cm, 40 g ở (158, 40), chỗ khối tới khi xe dừng ở cuối vạch | `grab-cube` minLift 3: 20, `stack-cube` object-on-object lệch ≤ 1,5, nghiêng ≤ 10°: 55, `base-still` object-unmoved ≤ 2 cm: 15, thưởng 10 | 3, seed 217; xuất phát ±12 cm dọc vạch (−12,0 và +9,4); khối dx ±5 (+3,5 và −3,7) | 45 s |

Lời giải mẫu (`robot-solutions.ts`, đều trong "khi bắt đầu", tốc độ ≥ 50 %):

- **Bài 8:** tay hạ, kẹp mở, chờ 300 ms; tiến 50 % khi siêu âm > 15 cm, rồi tới khi IR thấy khối; dừng, kẹp đóng, tay nâng; tiến 60 % khi
  siêu âm > **35 cm** (tường xa, tay 90° đang giữ: nón sạch); hạ, mở, lùi 1 s.
  - Ba lượt của seed 23: khối rơi ở x 137,3–137,5.
  - Ở 16 góc của khoảng biến thể (khối lệch tới 3,3 cm, test Kiểm tra) và 77 lượt bốc khác (seed 100–159 và 1000–8000, lệch tới 2,86 cm):
    đều 100 điểm.
  - Trước review 1, lời giải tiến 70 % và đặt ở 45 cm. Ba trong 77 lượt bốc trượt (lệch 2,6–2,9 cm), và cả bốn góc xa nhất cũng trượt.
- **Bài 9:** lặp 3 lần: bám vạch tới khi IR thấy kiện, gắp và nâng, quay trái **900 ms**, tiến 2200 ms, đặt xuống, lùi 2200 ms, quay phải tới khi
  cảm biến giữa thấy vạch. Kiện rơi ở x 75,6–77,9, khoảng 15 cm phía nam chỗ nó nằm. 97 điểm (thưởng 7).
- **Bài 10:** tiến tới khi IR thấy khối, gắp và nâng; nếu màu đỏ quay trái 900 ms, nếu xanh dương quay phải 900 ms, còn lại đi thẳng; tiến 3000 ms,
  đặt xuống, lùi. Khối rơi ở giữa vùng cùng màu.
- **Bài 11:** bám vạch tới khi IR thấy khối đỏ, gắp, tay **55°**; bám vạch tới khi không cảm biến nào thấy vạch; dừng, mở. Khối nằm trên bệ, lệch
  0,11–0,19 cm. 97 điểm (thưởng 7).

Lời giải mù (bài 8, 9, 11, chỉ motor, tay gắp và chờ, canh giờ cho biến thể 0) qua biến thể 0 và trượt biến thể khác. Exploit của plan §6, mỗi cái có
trần điểm (`maxScore`) và điểm đo được (test ghim từng biến thể):

| Kịch bản | Exploit | Trần | Đo |
|---|---|---|---|
| `rb-grip-pick` | mù (`blind`) | — | 15 (100 / 15 / 15) |
| `rb-grip-pick` | `never-lower-arm`: không hạ tay; thân xe đẩy khối, đầu ngón chạm tường xa, hết lượt | 15 | 0 |
| `rb-grip-pick` | `push-in`: tay hạ, càng mở, đẩy khối 6600 ms vào vùng thả | 15 | 15 |
| `rb-grip-pick` | `hold-in-zone`: chở tới vùng thả, hạ tay nhưng không mở kẹp | 55 | 55 |
| `rb-grip-pick` | `push-closed-then-lift` (review 1 M1): kẹp đóng, đẩy khối 5600 ms vào vùng thả, mở kẹp, tiến tới khi IR thấy, gắp, nâng tại chỗ rồi đặt xuống | 55 | 0 (55 / 55 / 0: lượt 3 mất khối, chạm tường xa) |
| `rb-grip-deliver` | mù | — | 40 (97 / 40 / 40) |
| `rb-grip-deliver` | `push-north`: bám vạch với càng mở, đẩy kiện lên phía bắc | 15 | 15 |
| `rb-grip-deliver` | `open-jaw-sweep-lift` (D2 review N1): kẹp chỉ 10°, quay và quét kiện vào kho, tới kho mới kẹp và nâng 1 cm tại chỗ (tay 14°) | 15 | 0 (15 / 0 / 15) |
| `rb-grip-sort` | `always-turn-left`: luôn quay trái | 40 | 40 |
| `rb-grip-sort` | `only-check-red`: đỏ thì trái, còn lại đi thẳng | 40 | 40 |
| `rb-grip-stack` | mù | — | 15 (97 / 15 / 75) |
| `rb-grip-stack` | `place-beside-base`: chở 3000 ms rồi đặt xuống sàn trước bệ | 35 | 35 |
| `rb-grip-stack` | `hold-over-base`: tới cuối vạch nhưng không mở kẹp | 35 | 35 |
| `rb-grip-stack` | `arm-too-low`: chở ở tay 45°: khối quệt bệ và đẩy nó đi | 20 | 20 |
| `rb-grip-stack` | `lower-arm-fully`: hạ hết tay (0°) ở cuối vạch rồi mới mở kẹp: khối nằm trên bệ, lệch 1,71–1,81 cm; bệ không bị xô | 35 | 35 |

**Một đường đã biết, chấp nhận theo ruling (review 1 M1):** đẩy khối vào vùng thả rồi gắp, nâng và **chở khoảng 8 cm ngay trong vùng** thì
được 100. Luật chở (nâng ≥ 1 cm, chở ≥ 5 cm, plan §4.5) cho qua, vì vẫn cần gắp, nâng và chở thật. Bài 9 cũng hở như vậy về nguyên tắc. Một
lựa chọn D2 về sau là đòi lần chở phải bắt đầu ngoài vùng đích.

**Cửa sổ thời gian nhạy với kit PLACEHOLDER (review 1 M3; VG phải đo lại):**
- **Bài 10:** lần quay chỉ qua ở 800–1000 ms (±10° quanh 900 ms; trượt ở 750 và 1050 ms). Đây là phần canh giờ hẹp nhất của bốn bài.
- **Bài 9:** lần quay qua ở 800–1000 ms. Lần chở qua ở 1200 ms; chở 3200 ms (+1 s) thì đâm kệ.

"Hạ hết tay (≤ 20)" của plan §6 là hai exploit (ruling D4 item B, plan §4.14). Chở quá thấp (`arm-too-low`) giữ trần 20. Hạ hết tay lên
bệ (`lower-arm-fully`) là một lần xếp suýt đạt, không xô bệ: trần **đổi từ 20 thành 35**, bằng đặt cạnh bệ.

### 11.6 Kiểm tra trên máy

```sh
# Tĩnh: các luật của mục 5 cho mọi bài, và các ghim của bài tay gắp (khối "N19 D4" trong file)
pnpm exec vitest run tests/robot-scenarios.test.ts

# Thật: bốn lời giải mẫu qua Kiểm tra headless, 1× và 4× (cùng điểm và hash); mọi lời giải mù và exploit trượt, điểm đúng từng biến thể
pnpm exec vitest run src/core/scenario/check-robot.gripper-lessons.test.ts src/core/scenario/check-robot.gripper-challenges.test.ts

# Tất định cả Kiểm tra trên Node; e2e/robot-determinism.spec.ts so cùng golden trên Chromium, Firefox, WebKit
pnpm exec vitest run tests/robot-determinism.test.ts

# Spike soạn bài: đo, dò seed, chạy thử một chương trình (xem spikes/n19-d4/results.md)
SPIKE=solutions pnpm exec vitest run --config spikes/n19-d4/vitest.config.ts solutions
```

Đổi một bài tay gắp thì chạy lại các lệnh trên, `pnpm export:robot-manifest`, `pnpm check:arduino --require` (sketch bài 10 dùng Wire: 6038 B
flash, 277 B RAM) và cập nhật hash của Kiểm tra trong `tests/__snapshots__/robot-determinism.json` (chạy `SPIKE=golden` của spike rồi chép
bốn mục `rb-grip-*-reference`; hash của rover không được đổi).

### 11.7 Phía STEMLearning cho bốn key này

Theo các bước 6 của mục 8, cùng một đợt phát hành (việc F của plan N19):

- Chép `docs/fixtures/robot-scenarios.v1.json` (11 kịch bản) sang `Web/packages/api/src/lab/__fixtures__/robot-scenarios.v1.json`, sửa sha256 ghim nó.
- `CourseService:LabTemplates:Robot` và `LabTemplateCatalog.DefaultRobotScenarios`: thứ tự 6 key cũ → 4 key `rb-grip-*` → `rb-sandbox` (D-G12), mỗi key mới
  `Version` 1 và `GoalIds`: `rb-grip-pick` `["grab-cube", "place-cube", "no-crash"]`; `rb-grip-deliver` `["deliver-1", "deliver-2", "deliver-3", "no-crash"]`;
  `rb-grip-sort` `["grab-cube", "sort-cube", "no-crash"]`; `rb-grip-stack` `["grab-cube", "stack-cube", "base-still"]`.
- `LAB_TEMPLATES.robot` cùng thứ tự (cả bốn cần `uno-basic`, không vào `ADVANCED_ROBOT_SCENARIOS`); tên và tóm tắt trong `admin.json`
  (`builder.labs.templates.rb-grip-*`); hình nhỏ trong `ScenarioThumbnail.tsx`; module 4 "Tay gắp" (bài 8–11) nối sau module 3, sân tập vẫn là bài 7
  (D-G12). DB đang chạy cập nhật bằng gỡ xuất bản rồi seed lại.
