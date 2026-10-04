# STEM Studio PoC — Thuyết minh video demo

> Lời thuyết minh tiếng Việt cho video demo final, dùng làm voice-over, speaker notes, hoặc làm nguồn để tạo subtitle sau này.
> **Video:** `artifacts/demo/stem-demo-poc.mp4` (bản để chia sẻ; H.264), convert từ bản quay gốc `artifacts/demo/stem-demo-poc.webm`. Dài 3:49, 1440×900, 30 fps, không có âm thanh. Quay ngày 2026-10-05.
> **Nguồn:** timestamp và nội dung lấy từ chính video final. Trình tự theo [`stem-demo-demo-script.md`](stem-demo-demo-script.md); chỗ nào video khác script thì note này theo video (xem [Khác với demo script](#khác-với-demo-script)).

## Tổng quan

| Time | Section | Key proof |
|---|---|---|
| 0:00–0:20 | M1 — Blink trên mạch mẫu | Run làm LED trên canvas nhấp nháy theo chương trình; sửa một khối lệnh là hành vi đổi theo. Khối lệnh → chương trình → runtime → mô phỏng → canvas đã chạy thông. |
| 0:21–1:09 | M2 — Tự dựng mạch | Mạch dựng bằng chuột chạy được như mạch mẫu. Xoá một dây thì LED tắt dù chương trình không đổi: mô phỏng theo cả chương trình lẫn cách nối mạch. |
| 1:10–1:44 | M3A — Nút nhấn, không cần chương trình | Giữ nút trên canvas lúc đang chạy thì LED sáng, nhả thì tắt, kể cả khi nhả chuột ngoài canvas. |
| 1:45–2:49 | M3B — Nút → chương trình → LED | Vòng kín: nút → D2 → `if/else` → D13 → LED. Đảo HIGH/LOW thì hành vi đảo theo. |
| 2:50–3:49 | M4 — Giữ project qua reload | Reload giữ nguyên mạch và chương trình, New cũng được nhớ; trạng thái chạy thì không được lưu. |

Video không có cảnh intro hay outro: 0:00 là app đã mở sẵn mạch Blink, và từ 3:45 hình đứng yên tới hết. Phần [Intro](#intro--trước-000) và [Outro](#outro--sau-349) được đọc trước khi bấm play và sau khi video dừng (xem [Presenter Notes](#presenter-notes)).

## Cách dùng note này

- Mỗi đoạn có khung giờ, phần **Hình** (trên màn hình đang có gì) và phần **Lời đọc**. Chỉ phần Lời đọc là để đọc thành tiếng.
- Lời đọc được viết cho tốc độ khoảng 2–2,5 từ mỗi giây (120–150 từ/phút); số từ ghi kèm mỗi đoạn. Bắt đầu đọc ở đầu khung giờ; đọc xong sớm thì để hình tự nói.
- Khung giờ của một đoạn là khung để đọc. Vài đoạn cố ý lấn 2–4 giây sang cảnh kế bên khi cảnh đó chỉ là thao tác không cần lời, ví dụ kéo khối lệnh vào thùng rác ở 1:10–1:13.
- `[Pause …]`: đoạn thao tác không cần lời.
- Cách đọc: D13 là "đê mười ba", D2 là "đê hai", 3V3 là "ba vê ba", GND là "ground".

## Intro — trước 0:00

*Hình:* frame đầu của video (mạch Blink, Idle).

**Lời đọc** (≈47 từ, ~20 s):
> "Đây là PoC kỹ thuật của STEM Studio: một môi trường học điện tử và lập trình chạy hoàn toàn trên trình duyệt. Học sinh dựng mạch, lập trình bằng khối lệnh, bấm Run là thấy mạch mô phỏng phản ứng; project được lưu ngay trên máy."

## 0:00–0:20 — M1: Chương trình điều khiển mạch

### 0:00–0:09 · Mạch mẫu Blink, Run

*Hình:* app mở sẵn mạch Blink: Board, Resistor, LED, nối D13 → R → LED → GND. Program là `forever`: ghi D13 HIGH, chờ 1 s, ghi LOW, chờ 1 s. Bấm Run lúc ~0:04, status `Running`, LED nhấp nháy khoảng 1 lần/giây.

**Lời đọc** (≈20 từ):
> "Mạch mẫu Blink: board, điện trở và LED nối vào chân D13. Bấm Run, LED nhấp nháy theo chương trình."

### 0:09–0:20 · Stop, sửa khối, chạy lại

*Hình:* Stop lúc ~0:09 khi LED đang sáng: LED tắt ngay, status `Idle`. Từ 0:11 đến 0:14, đổi `HIGH` của lệnh ghi đầu tiên thành `LOW`. Run lúc ~0:15: `Running` nhưng LED không sáng. Stop lúc ~0:19.

**Lời đọc** (≈27 từ):
> "Stop: LED tắt ngay. Đổi khối đầu tiên từ HIGH sang LOW rồi chạy lại: LED không sáng nữa — mạch làm đúng theo chương trình vừa sửa."

## 0:21–1:09 — M2: Tự dựng mạch

### 0:20–0:36 · New, thêm và sắp xếp linh kiện

*Hình:* New lúc ~0:21: canvas trống, Blockly còn `on start` và `forever` rỗng. Từ 0:24 đến 0:36, bấm **+ STEM Board**, **+ Resistor**, **+ LED**; mỗi linh kiện hiện ở giữa canvas rồi được kéo vào chỗ.

**Lời đọc** (≈36 từ):
> "Vậy là cả chuỗi đã thông: từ khối lệnh, qua chương trình đang chạy, tới mô phỏng và hình trên canvas. Giờ tự dựng từ project trống: thêm board, điện trở, LED rồi kéo vào chỗ."

### 0:37–0:45 · Nối dây

*Hình:* mỗi dây là hai click, có đường nét đứt đi theo chuột. Nối D13 → chân trái Resistor, chân phải Resistor → anode LED, cathode LED → GND.

**Lời đọc** (≈17 từ):
> "Mỗi dây là hai cú click: D13 sang điện trở, điện trở sang LED, LED về GND."

### 0:46–0:51 · Lập trình

*Hình:* Blockly → **Pins** → kéo `digital write D13 HIGH` vào `on start`.

**Lời đọc** (≈11 từ):
> "Trong Blockly, kéo lệnh ghi D13 mức HIGH vào on start."

### 0:52–0:58 · Run: LED sáng, editor bị khoá

*Hình:* Run lúc ~0:52: LED sáng, status `Running`, palette và New bị mờ. Từ 0:54 đến 0:56 thử kéo LED nhưng LED không di chuyển. Stop lúc ~0:58.

**Lời đọc** (≈13 từ):
> "Run: LED sáng. Khi đang chạy, editor bị khoá — không kéo được LED."

### 0:58–1:03 · Stop, xoá một dây

*Hình:* `Idle`. Click vào dây D13 → Resistor lúc ~1:01 (dây chuyển sang màu xanh), nhấn Delete lúc ~1:02.

**Lời đọc** (≈9 từ):
> "Stop, rồi chọn dây từ D13 và xoá nó."

### 1:03–1:13 · Chạy lại: mạch hở

*Hình:* Run lúc ~1:04: `Running` nhưng LED tắt. Stop lúc ~1:08. Từ 1:10 đến 1:13, khối lệnh ở `on start` được kéo vào thùng rác; đây là bước mở đầu M3A, không cần lời riêng.

**Lời đọc** (≈23 từ):
> "Chạy lại: chương trình vẫn ghi HIGH, nhưng mạch hở nên LED không sáng. Mô phỏng theo cả chương trình lẫn dây nối."

## 1:10–1:44 — M3A: Nút nhấn, không cần chương trình

### 1:13–1:24 · Thêm nút nhấn

*Hình:* program giờ chỉ còn `on start` và `forever` rỗng. **+ Push Button** lúc ~1:15, đặt nút dưới board lúc ~1:17. Nối 3V3 → chân trái của nút (1:18–1:20), rồi chân phải của nút → Resistor (1:21–1:23).

**Lời đọc** (≈22 từ):
> "Phần ba là đầu vào. Chương trình giờ để trống. Thêm một nút nhấn, nối 3V3 qua nút rồi sang điện trở."

### 1:24–1:32 · Run, giữ nút

*Hình:* Run lúc ~1:25, LED tắt. Giữ nút lúc ~1:28: cap tròn lún xuống, LED sáng. Nhả lúc ~1:31, LED tắt.

**Lời đọc** (≈12 từ):
> "Run. Giữ nút: tiếp điểm đóng, LED sáng. Nhả ra, LED tắt."

### 1:32–1:37 · Nhả chuột ngoài canvas

*Hình:* giữ nút lại lúc ~1:33, kéo chuột sang vùng Blockly và nhả ở đó lúc ~1:36: LED vẫn tắt đúng.

**Lời đọc** (≈12 từ):
> "Kéo chuột ra ngoài canvas rồi mới nhả, nút vẫn nhả đúng."

### 1:37–1:47 · Stop: nút lại là linh kiện thường

*Hình:* Stop lúc ~1:38, `Idle`. Click vào nút lúc ~1:40: nút chỉ được chọn (viền nét đứt), LED vẫn tắt. Click chỗ trống để bỏ chọn lúc ~1:43.

**Lời đọc** (≈22 từ):
> "Stop xong, click nút chỉ để chọn nó. Mạch nhận tương tác ngay lúc đang chạy, không chỉ lệnh từ chương trình."

## 1:45–2:49 — M3B: Nút → chương trình → LED

### 1:45–1:54 · Nối nút vào D2

*Hình:* chọn và xoá dây nút → Resistor (1:45–1:47). Nối nút → D2 (1:48–1:50), rồi D13 → Resistor (1:51–1:53). Mạch giờ giống mẫu `button-led`.

**Lời đọc** (bắt đầu ~1:47, ≈17 từ):
> "Giờ cho nút đi qua chương trình: nút nối vào chân D2, còn D13 điều khiển LED."

### 1:54–2:07 · Dựng `if/else` và điều kiện

*Hình:* **Logic** → kéo khối `if / else` vào `forever` (1:55–1:57). **Pins** → kéo `digital read` vào ô điều kiện (1:59–2:02). Đổi chân từ D13 sang D2; menu phải cuộn xuống mới thấy D2 (2:03–2:06).

**Lời đọc** (≈21 từ):
> "Trong Blockly, đặt khối if/else vào forever. Điều kiện là đọc chân D2: nút có đang được nhấn hay không."

`[Pause khi chọn D2 trong menu]`

### 2:07–2:19 · Hai nhánh ghi D13

*Hình:* kéo `digital write` vào `do` (2:07–2:10), rồi vào `else` (2:11–2:14). Đổi `HIGH` của nhánh `else` thành `LOW` (2:15–2:17). Program hoàn chỉnh: `forever` → `if digital read D2` → `digital write D13 HIGH`, `else` → `digital write D13 LOW`.

**Lời đọc** (≈10 từ):
> "Nhánh đúng ghi D13 mức HIGH, nhánh else ghi LOW."

`[Pause cho người xem đọc program]`

### 2:19–2:31 · Run: nút → chương trình → LED

*Hình:* Run lúc ~2:19, LED tắt khi chưa nhấn. Giữ nút lúc ~2:22: LED sáng; nhả lúc ~2:25: LED tắt. Nhấn lại thêm một lần (2:27–2:28).

**Lời đọc** (≈20 từ):
> "Run. Nhấn nút: D2 lên mức cao, if chọn nhánh đúng, D13 bật và LED sáng. Nhả nút, LED tắt."

### 2:31–2:38 · Đảo mức

*Hình:* Stop lúc ~2:30, `Idle`. Đổi `LOW` của `else` thành `HIGH` (2:32–2:34), rồi `HIGH` của nhánh đầu thành `LOW` (2:35–2:37).

**Lời đọc** (≈12 từ):
> "Stop, rồi đảo hai mức: else thành HIGH, nhánh đúng thành LOW."

### 2:38–2:49 · Chạy lại: hành vi đảo ngược

*Hình:* Run lúc ~2:39: không nhấn mà LED vẫn sáng. Giữ nút lúc ~2:42: LED tắt; nhả lúc ~2:45: LED sáng lại. Stop lúc ~2:47.

**Lời đọc** (≈25 từ):
> "Chạy lại: không nhấn thì LED sáng, nhấn thì tắt. Mạch và phần hiển thị không đổi gì — hành vi đến từ chính chương trình."

## 2:50–3:49 — M4: Giữ project qua reload

### 2:50–3:03 · Sửa mạch và chương trình, rồi reload

*Hình:* **+ LED** rồi kéo nó xuống góc dưới bên phải (2:50–2:54). Chọn và xoá dây nút → D2 (2:55–2:56). Đổi `HIGH` còn lại (nhánh `else`) thành `LOW` (2:57–3:00). Chờ khoảng 1,5 s rồi reload lúc ~3:03.

**Lời đọc** (≈24 từ):
> "Cuối cùng là lưu trữ. Thêm một LED, xoá dây từ nút sang D2, đổi HIGH còn lại thành LOW. Rồi reload trình duyệt."

### 3:03–3:07 · Mọi thứ còn nguyên

*Hình:* màn trắng khoảng 0,2 s lúc reload (~3:03). App mở lại đúng project vừa sửa: có LED mới, dây đã xoá vẫn không còn, cả hai lệnh ghi đều `LOW`, status `Idle`.

**Lời đọc** (≈8 từ):
> "Mạch và chương trình còn nguyên như trước."

### 3:07–3:12 · New rồi reload

*Hình:* New lúc ~3:07, project trống. Reload lúc ~3:09 (màn trắng khoảng 0,13 s): app mở lại đúng project trống đó.

**Lời đọc** (≈11 từ):
> "New, chờ một giây, reload: app mở lại đúng project mới."

### 3:12–3:39 · Dựng nhanh một mạch nút nhấn

*Hình:* **+ STEM Board**, **+ Push Button**, **+ Resistor**, **+ LED** (3:12–3:27). Nối 3V3 → nút → Resistor → LED → GND (3:28–3:37). Program để trống.

**Lời đọc** (≈27 từ):
> "Dựng nhanh một mạch nút nhấn không cần chương trình. Project được tự lưu vào IndexedDB của trình duyệt sau mỗi lần sửa, không cần nút Save."

`[Pause while wiring]`

### 3:39–3:45 · Reload khi đang giữ nút

*Hình:* Run lúc ~3:40. Giữ nút, LED sáng lúc ~3:43. Reload ngay khi đang giữ, lúc ~3:44 (màn trắng khoảng 0,13 s).

**Lời đọc** (≈12 từ):
> "Run, giữ nút cho LED sáng, rồi reload ngay lúc đang giữ."

### 3:45–3:49 · Sau reload

*Hình:* status `Idle`, LED tắt, nút không còn bị nhấn; mạch vẫn còn nguyên. Hình đứng yên tới hết video.

**Lời đọc** (≈10 từ):
> "App về Idle, LED tắt, nút không còn bị nhấn."

## Outro — sau 3:49

*Hình:* frame cuối (mạch nút nhấn, `Idle`).

**Lời đọc** (≈49 từ, ~20 s):
> "Project được lưu, còn trạng thái chạy thì không. PoC kỹ thuật này cho thấy: dựng mạch trực quan, lập trình bằng Blockly, chạy mô phỏng, tương tác lúc đang chạy, và lưu project trên máy. Trải nghiệm với người học thật sẽ là một bước đánh giá riêng."

## Khác với demo script

Video final đi đúng trình tự M1–M4 của demo script, với các khác biệt sau:

- **M3 không nạp mạch mẫu.** Script nạp `button-direct` / `button-led` bằng Console. Video không dùng Console hay dev hook; cả hai mạch được dựng bằng UI:
  - M3A thêm nút vào mạch của M2 (khối lệnh ở `on start` được kéo vào thùng rác để program trống), nên layout khác sample `button-direct`.
  - M3B đi lại dây thành nút → D2 và D13 → R, rồi tự dựng `if/else` trong Blockly. Kết quả giống sample `button-led`.
- **M2** có thêm một lần thử kéo LED trong lúc chạy, để thấy editor bị khoá.
- **M4:** bước 1 sửa mạch còn lại từ M3B. Sau New (bước 3), mạch nút cho bước 4 được dựng lại bằng UI, cùng layout với `button-direct` và program trống.
- **Reload** là reload của trình duyệt. Video chỉ quay vùng trang, nên không thấy thanh địa chỉ hay F5, chỉ thấy một màn trắng ngắn.
- Các mục "Muốn thử thêm" của script không có trong video.

## Presenter Notes

- **Intro và outro:** video vào thẳng app ở 0:00 và đứng hình từ 3:45. Khi trình bày trực tiếp, đọc Intro trước khi bấm play và Outro sau khi video dừng. Khi làm voice-over, giữ frame đầu và frame cuối thêm khoảng 20 s mỗi đầu.
- **Chỗ nên dừng hình** khi trình bày trực tiếp:
  - 0:09: Stop, LED tắt;
  - 0:53: LED sáng, editor bị khoá;
  - 1:05: mạch hở, LED tắt;
  - 1:29: đang giữ nút;
  - 2:18: program `if/else` hoàn chỉnh;
  - 2:23: nhấn nút qua chương trình;
  - 2:40: đã đảo mức;
  - 3:05: sau reload;
  - 3:46: sau reload khi đang giữ nút.
- **Màn trắng 0,13–0,2 s** ở ~3:03, ~3:09 và ~3:44 là reload của trình duyệt, không phải lỗi.
- **Khoảng 2:12:** khi khối `digital write` thứ hai được kéo ngang qua nhánh `do` để xuống `else`, Blockly thoáng hiện vị trí chèn tạm ở `do`. Đó là preview bình thường của Blockly; khối được thả đúng vào `else`.
- **Thao tác:** M1–M4 đều đi qua UI, không dùng Console, dev hook hay nạp mạch mẫu. Mũi tên chuột trong video được vẽ thêm lúc quay, vì cách quay này không ghi con trỏ của hệ điều hành; nó không ảnh hưởng tới app.
- **Người thao tác:** video do script điều khiển một trình duyệt thật, không phải người dùng thật. Đánh giá usability (L8) vẫn cần một người chạy thử.
- **File:** chia sẻ `artifacts/demo/stem-demo-poc.mp4`; `stem-demo-poc.webm` là bản quay gốc. Video không có âm thanh.
