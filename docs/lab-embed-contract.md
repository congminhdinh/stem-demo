# Lab embed contract (`stem-lab/v1`)

Hợp đồng **duy nhất** giữa STEM Studio (repo này, một sản phẩm độc lập) và trang nhúng nó (hiện tại là app `learn`
của STEMLearning: `BlocklyLab`, `YolobitLab`, và từ N18 lab robot 3D). Hai bên không import code của nhau, không dùng chung package, token
hay font. Mọi thứ đi qua **launch URL** và **message `stem-lab/v1`** dưới đây. Code: `src/ui/app/launch.ts`
(URL), `src/ui/app/host-bridge.ts` (message), `src/ui/app/lab-host.ts` (nối store với bridge),
`src/samples/templates.ts` + `src/samples/challenges.ts` (template và mục tiêu), `src/samples/robot-templates.ts` (scenario của lab
robot, N18 R4.1). Phía host:
`STEMLearning/Web/apps/learn/src/features/player/activities/lab/` (`lab-launch.ts`, `lab-protocol.ts`,
`useLabBridge.ts`).

## 1. Launch URL

| URL | Kết quả |
|---|---|
| không có `embed`, `template`, `lab` | Editor standalone, như trước. Tham số khác bị bỏ qua |
| `?embed=1&template=<key>` | Lab S1 (legacy, cho `StemLab` cũ): mọi key, tiếng Anh, có nút New, **không** bridge, **không** Kiểm tra. `profile`, `origin` bị bỏ qua |
| `?embed=1&lab=blockly&template=<key>[&origin=<o>]` | Lab "Lập trình khối": chỉ key generic |
| `?embed=1&lab=yolobit&template=<key>[&profile=<p>][&origin=<o>]` | Lab "Mạch Yolo:Bit": chỉ key `ybc-*`; `profile` = `ybc-basic` \| `ybc-advanced`, **không thấp hơn mức template cần** (bảng dưới); thiếu thì dùng mức template cần |
| `?embed=1&lab=robot&template=rb-<key>[&profile=<p>][&origin=<o>]` | Lab "Robot 3D" (N18 R4.1): chỉ key `rb-*`; `profile` = `uno-basic` \| `uno-advanced`, **không thấp hơn mức scenario cần** (hiện mọi scenario cần `uno-basic`, mức thấp nhất, nên chưa có launch nào bị từ chối vì mức); thiếu thì dùng mức scenario cần. Lab này tải **riêng** (chunk `RobotLab`, `React.lazy`): lab Blockly, lab Yolo:Bit và editor standalone không tải chunk đó, không tải `three` hay physics. Chunk không tải được (mạng, bản build mới thay chunk cũ) thì lab hiện thông báo kèm nút **Tải lại**, không để iframe trống |

- **Key** (so khớp chính xác, phân biệt hoa thường; không bao giờ đổi tên hay tái dùng):
  - Blockly: `blink`, `led-on`, `button-direct`, `button-led`, `empty`.
  - Yolo:Bit: `ybc-heart`, `ybc-button-ab`, `ybc-night-light`, `ybc-melody`, `ybc-empty`, và (N17 B6) `ybc-rainbow`,
    `ybc-thermometer`, `ybc-dice`, `ybc-servo-gate`.
  - Robot (N18 R4.1; `robotTemplateKeys`, không bao giờ đổi tên): `rb-drive-to-zone`, `rb-square-route`, `rb-stop-at-wall`,
    `rb-line-follow`, `rb-servo-gate`, `rb-mini-mission`, và `rb-sandbox` (không có mục tiêu, không có điểm).
  - Khớp với `LabTemplateCatalog.DefaultBlockly` / `DefaultYolobit` của CourseService (bốn key N17 B6: task B7 bên STEMLearning).
- **Mức mỗi template Yolo:Bit cần** (N17 B6, `ybcTemplateProfiles` trong `src/samples/ybc-templates.ts`). `profile=` thấp hơn
  mức cần → màn hình lỗi, tiếng Việt: *Mẫu bài "ybc-thermometer" cần mức Nâng cao (profile=ybc-advanced): bài dùng khối hoặc
  linh kiện mà mức Cơ bản không có.* Thiếu `profile=` thì template mở ở mức nó cần.

  | Key | Mức cần | Bài | Mục tiêu (`id`: nhãn tiếng Việt) |
  |---|---|---|---|
  | `ybc-heart` | `ybc-basic` | Trái tim | `shows-heart`: Màn hình hiện hình trái tim |
  | `ybc-button-ab` | `ybc-basic` | Nút A/B | `a-shows-check`, `b-shows-cross` |
  | `ybc-night-light` | `ybc-basic` | Đèn ngủ | `dark-lights-up`, `bright-goes-off` |
  | `ybc-melody` | `ybc-basic` | Giai điệu | `a-plays-notes` |
  | `ybc-empty` | `ybc-basic` | (trống) | — (không có mục tiêu) |
  | `ybc-rainbow` | `ybc-basic` | Cầu vồng: mỗi lần bấm A, cả màn hình đổi màu (đỏ → lục → lam) | `a-changes-colour`: Bấm A hai lần thì cả màn hình sáng hai màu khác nhau |
  | `ybc-thermometer` | `ybc-advanced` | Nhiệt kế: bấm B thì chạy chữ nhiệt độ | `b-scrolls-30`: Ở 30 °C, bấm B thì màn hình chạy chữ 30; `uses-temperature`: Dùng khối nhiệt độ |
  | `ybc-dice` | `ybc-advanced` | Xúc xắc: lắc thì hiện số ngẫu nhiên 1–6 | `shake-shows-number`: Lắc mạch thì màn hình hiện số; `uses-random`: Dùng khối số ngẫu nhiên |
  | `ybc-servo-gate` | `ybc-advanced` | Cổng servo: tối thì servo về 0°, sáng thì 90° (servo nối P0, 3V3, GND) | `dark-closes`: Trời tối (ánh sáng dưới 30) thì servo quay về 0°; `bright-opens`: Trời sáng thì servo quay tới 90° |
- **Scenario của lab robot** (N18 R4.1, `robotTemplates` trong `src/samples/robot-templates.ts`): mọi scenario cần `uno-basic`, dùng
  kit `ref-uno-rover@0`, và mở ra một project theo plan §4.0: đúng một component `uno-r3`, không có dây, `profile`, `kit:
  { id: 'ref-uno-rover', version: '0' }`, `program.blocks` rỗng (`{}`, đúng thứ Blockly lưu cho workspace trống nên mở lab không
  gửi `project-changed`) cho tới khi khối uno của R2.2 có mặt. Tên bài (tiếng Việt, hiện ở đầu lab): `rb-drive-to-zone` Chạy tới vùng
  đích, `rb-square-route` Đi theo hình vuông, `rb-stop-at-wall` Dừng trước tường, `rb-line-follow` Bám theo vạch kẻ,
  `rb-servo-gate` Mở cổng bằng servo, `rb-mini-mission` Nhiệm vụ tổng hợp, `rb-sandbox` Sân tập tự do. Cảnh 3D, thế giới vật lý và
  kiểm tra đến sau (R4.2, R3.x, R6): bây giờ lab robot là khung (tên lab, tên bài, vùng nhìn, trình soạn khối) và `ready`
  có `goals: []`. Một `profile=` thấp hơn mức scenario cần là launch hỏng, giống Yolo:Bit (câu lỗi cùng khuôn:
  *Mẫu bài "…" cần mức … (profile=…): bài dùng khối hoặc linh kiện mà mức … không có.*).
- **`origin`**: origin của trang nhúng, viết đúng như trình duyệt serialize (`scheme://host[:port]`, không path,
  không `/` cuối; vd. `http://localhost:3000`). Lab chỉ nói chuyện với origin này. Thiếu `origin` thì lab vẫn chạy
  (mở ở tab mới), chỉ là không gửi message nào.
- **Launch hỏng** → màn hình lỗi (tiếng Việt với `lab=`), không mở project nào: `lab` lạ hoặc lặp; key lạ, thiếu,
  lặp; key không thuộc `lab` (vd. `lab=blockly&template=ybc-heart`, `lab=robot&template=blink`, `lab=blockly&template=rb-sandbox`);
  một key `rb-*` **không có `lab=robot`** (lab S1 legacy không có robot; một key `rb-*` lạ là key lạ, không bao giờ là project
  standalone); `profile` lặp, lạ (mỗi lab có hai mức riêng: `lab=yolobit` → `ybc-*`, `lab=robot` → `uno-*`; mức của họ khác là lạ),
  có với `lab=blockly`, hoặc thấp hơn mức template cần (N17 B6, N18 R4.1);
  `origin` lặp hoặc không phải một page origin (`*`, `null`, có path, có `/` cuối, port mặc định viết ra…).
  Lý do (theo ngôn ngữ của lab; với `lab=` là tiếng Việt, nguyên văn tiếng Anh cho người viết URL nằm dưới
  "Chi tiết kỹ thuật") và danh sách key của lab đó được hiện ra.
- **Ngôn ngữ**: `lab=` → tiếng Việt; standalone và lab S1 → tiếng Anh. `lang=vi|en` ghi đè. Với tiếng Việt, cả
  thông báo của core (lỗi biên dịch, lỗi khi chạy, lỗi mạch) và nhãn vẽ trên bo mạch cũng tiếng Việt (N8s).
- **Lab không lưu gì** trong trình duyệt (như S1): mỗi lần mở là template mới. Bài làm được giữ bởi host (xem
  `project-changed` / `load-project`).

## 2. Message

Mọi message là object JSON có `protocol: "stem-lab/v1"` và `type`. Lab gửi bằng
`window.parent.postMessage(msg, origin)`, **không bao giờ** `'*'`. Lab chỉ nhận message có `event.origin === origin`
**và** `event.source === window.parent`; mọi thứ khác bị bỏ qua. Bridge chỉ bật khi launch có `lab=`, có `origin`
hợp lệ và lab nằm trong một frame.

### Lab → host

| `type` | Trường | Khi nào |
|---|---|---|
| `ready` | `template: string`, `profile: string \| null`, `goals: { id, label }[]`; lab robot thêm `lab: "robot"`, `scenarioVersion?`, `maxScore?` | Một lần, khi lab đã mở template. `profile` là profile của project (null với lab Blockly). `goals` rỗng khi template không có challenge (`empty`, `ybc-empty`; lab robot: chưa có mục tiêu tới R6). Lab robot: `scenarioVersion: 1`, và `maxScore: 100` cho scenario có điểm; `rb-sandbox` **bỏ** `maxScore` (không `null`) |
| `run-started` | — | Một lượt chạy bắt đầu (Chạy, hoặc lượt chạy của Kiểm tra) |
| `run-stopped` | — | Lượt chạy kết thúc (Dừng, Đặt lại, hoặc Kiểm tra xong) |
| `check-result` | `passed: boolean`, `goals: { id, label, passed }[]` | Mỗi lần Kiểm tra xong. `passed` = mọi mục tiêu đạt. Đến **sau** `run-stopped` của lượt chạy đó. Kiểm tra bị huỷ (Dừng giữa chừng) hoặc **bị gián đoạn** (N17 B6: tab bị ẩn, máy chậm; xem §3) thì không gửi |
| `project-changed` | `document` (project document, schema v1) | Sau mỗi thay đổi của project, debounce 1 giây (thay đổi cuối thắng); gửi ngay khi trang `pagehide`. Mở template không gửi gì |

- **Lab robot** (N18 R4.1, plan §4.7): **mọi** message của lab robot (`ready`, `run-started`, `run-stopped`, `check-result`,
  `project-changed`) mang `lab: "robot"`; host chỉ đọc các trường robot khi message nói vậy. Trường tuỳ chọn vắng thì **bỏ
  hẳn**, không gửi `null`. Message của lab Blockly và lab Yolo:Bit **không đổi một byte** (không có trường `lab`). Lab robot
  chưa gửi `check-result` (R6/R7.1 thêm `score`, `maxScore`, `simTimeMs`, `variants`, `engine`, `scenarioVersion`,
  `programHash`; hình dạng `goals[]` giữ `{ id, label, passed }`). `ready` mà host đọc được hay bỏ cả message do một fixture
  JSON chung hai repo kiểm (plan §4.7, R7.1).
- Tối đa 50 mục tiêu, nhãn 1–200 ký tự (host bỏ qua nguyên message nếu vượt). Nhãn theo ngôn ngữ của lab.
- Lab không có khái niệm XP, lớp, tiến độ hay hoàn thành: host tự quyết `requiresCheck` và lúc nào activity xong.
- Lượt chạy của Kiểm tra dùng **seed cố định** cho số ngẫu nhiên (N17 B4, khối "số ngẫu nhiên"): cùng chương trình cho cùng `check-result`. Chạy thường thì ngẫu nhiên thật.

### Host → lab

| `type` | Trường | Lab làm gì |
|---|---|---|
| `load-project` | `document` | Mở project này thay template, nếu: editor mở được nó (schema, device, profile, program Blockly nạp được), đúng family của lab theo bảng lab → family (`blockly`→generic, `yolobit`→ybc, `robot`→uno; `labFamilies` ở `src/ui/app/lab-host.ts`, N18 R2.1; lab `robot` mở được từ R4.1, kèm `kit` của project) và không có lượt chạy nào. Lab `yolobit` và lab `robot` có `profile=` thì project mở với profile đó (N18 R4.1). Không hợp lệ → bỏ qua, không báo lỗi |

## 3. Kiểm tra (challenge)

- Mỗi template (trừ `empty`, `ybc-empty`) có một challenge: danh sách mục tiêu, thời lượng chạy (≤ 5 s) và kịch bản
  input (bấm nút A/B, kéo cảm biến ánh sáng, giữ nút bấm của mạch generic). Nút **Kiểm tra** chạy chương trình
  với kịch bản đó, chấm từng mục tiêu, rồi dừng. Chạy được cả khi không có host (mở ở tab mới).
- Loại mục tiêu (`src/core/challenge`): `display-shows` (màn hình 5×5 hiện một hình, có thể từ một thời điểm; N17 B1:
  có `colour` `'#rrggbb'` thì mọi đèn sáng của hình phải đúng màu đó, không có thì chỉ so sáng/tắt như trước),
  `led-lit`, `led-blinks` (số lần đổi sáng/tắt), `buzzer-played` (số nốt), `console-contains`, `uses-block` (khối
  có trong chương trình và được chạy). N17 B6 thêm bốn loại; loại "tại thời điểm" (`atMs`) đọc cái đang hiện lúc đó
  (snapshot cuối cùng tại hoặc trước thời điểm):
  - `display-colours-differ` (`atMs[]`): tại mỗi thời điểm cả màn hình sáng **một** màu, và các màu khác nhau;
  - `display-scrolls` (`text`, `fromMs`): từ `fromMs`, màn hình lần lượt hiện trọn từng ký tự của `text` (như chạy chữ);
  - `display-lit` (`atMs`): tại thời điểm đó có ít nhất một đèn sáng (con số bất kỳ của xúc xắc);
  - `servo-angle` (`componentId`, `angle`, `atMs`): tại thời điểm đó servo đứng ở góc `angle`.
- Kịch bản input của Kiểm tra có thêm (N17 B2): nhiệt độ (`temperature`, slider), nghiêng và lắc (`accelerometer`).
  Kiểm tra dùng **seed cố định** cho số ngẫu nhiên; mục tiêu của `ybc-dice` không phụ thuộc con số nào.
- **Kiểm tra bị gián đoạn** (N17 B6): nếu tab bị ẩn trong lúc kiểm tra (trình duyệt chỉ chạy timer khoảng một lần mỗi giây),
  hoặc một input / điểm kết thúc của kịch bản đến trễ hơn 250 ms (`CHECK_LATE_LIMIT_MS`, máy bị treo), lần kiểm tra dừng
  ngay, **không có kết quả**: lab hiện "Chưa đạt: lần kiểm tra bị gián đoạn (tab bị ẩn hoặc máy chạy chậm). Hãy để tab này
  mở và bấm Kiểm tra lại.", không đánh dấu mục tiêu nào, và **không gửi `check-result`**. Không bao giờ có "đạt giả".
- Template Yolo:Bit là **bài khởi đầu**: board và chương trình, cùng một khối (hoặc chuỗi khối) đặt rời, bị vô hiệu
  hoá; học sinh kéo nó vào đúng chỗ thì đạt. Template generic là chương trình hoàn chỉnh (như S1): Kiểm tra đạt ngay.
- Kiểm tra chạy **trên bo mạch học sinh đang nhìn** (N8s): đó chính là lượt chạy được chấm. Các lần bấm nút A/B,
  kéo ánh sáng, giữ nút bấm của kịch bản được vẽ lên bo mạch và lên nút điều khiển; có thanh tiến độ trong lúc chạy;
  xong thì bo mạch giữ khung hình cuối (có ghi chú) tới lần chạy hoặc lần sửa tiếp theo. Message không đổi.
- **Người soạn bài**: với `empty`/`ybc-empty` (không có mục tiêu), để `requiresCheck = false`.

## 4. Khung nhúng

- iframe của host: `sandbox="allow-scripts allow-same-origin allow-downloads"`. Không có `allow-modals`, nên lab
  không dùng `confirm()`: **Đặt lại** cần bấm hai lần.
- Host và lab phải cùng không gian địa chỉ (cùng localhost hoặc cùng public; Chromium Local Network Access).
- Lab tự host font (Be Vietnam Pro, OFL) và media Blockly; không tải gì từ trang nhúng hay CDN. Media Blockly và
  favicon đi theo base path của bản build (`vite build --base /lab/` cũng chạy).
- **Bố cục theo khung** (N8s, chỉ launch `lab=`): khung rộng từ 800 px: mạch | chương trình, chương trình rộng hơn
  (62 %), có thanh kéo đổi độ rộng và nút thu gọn mạch; mạch được thu nhỏ cho vừa khung, khối khởi đầu luôn nằm
  trong tầm nhìn. Khung hẹp hơn 800 px: hai tab "Chương trình" / "Mạch"; Chạy và Kiểm tra tự chuyển sang tab Mạch.
  Trang không cuộn khi khung cao từ khoảng 600 px. Host không phải làm gì: iframe hiện tại
  (`h-[min(78dvh,56rem)] min-h-[32rem]`) vừa. Lab không lưu bố cục (mỗi lần mở là mặc định).

## 5. Phiên bản

`stem-lab/v1` chỉ được **thêm** trường hoặc `type` mới (bên nhận bỏ qua cái không biết). Đổi nghĩa hay bỏ trường
→ `stem-lab/v2`, và lab phải nói được cả hai trong thời gian chuyển tiếp.

N8s (2026-10-17) không đổi URL hay message nào: chỉ bố cục, Kiểm tra nhìn thấy được và tiếng Việt bên trong lab.

N17 B6 (2026-10-19) chỉ **thêm**: bốn template key, mức mỗi template cần (launch thấp hơn bị từ chối), bốn loại mục tiêu
bên trong lab, và lần kiểm tra bị gián đoạn không gửi `check-result` (như kiểm tra bị huỷ). Message không đổi.

N18 R4.1 (2026-10-25) chỉ **thêm**: `lab=robot` (launch, bảy key `rb-*`, mức `uno-basic` \| `uno-advanced`), trường `lab: "robot"` trên mọi message
của lab robot và `scenarioVersion` / `maxScore` trên `ready` của nó, và lỗi launch cho key `rb-*` không có `lab=robot`. Lab robot hiện là
khung: cảnh 3D, thế giới và kiểm tra (R4.2, R3.x, R6) chưa có, nên chưa có `check-result` robot. Message của lab Blockly và lab Yolo:Bit
không đổi.

**Hook dev** (`window.__stem.robot`, chỉ bản dev, như `__stem`; N18 R4.1): `getSnapshot()` trả `null` cho tới khi có một lượt chạy (R3.6 định
nghĩa `RobotSnapshot`, R4.2 phục vụ nó), `setSpeed(n)` lưu hệ số tốc độ (số hữu hạn > 0; đọc lại bằng `getSpeed()`, mặc định 1) và
`snapshotHash()` trả `null` cho tới khi có lượt chạy (R3.6 định nghĩa hash, R4.2 phục vụ). Không phải một phần của `stem-lab/v1`.
