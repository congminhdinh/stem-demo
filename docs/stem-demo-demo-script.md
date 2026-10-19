# STEM Studio PoC — Demo script

> Kịch bản ngắn cho người chạy thử PoC (plan POC-11, POC-13 và POC-14, §8.2). Mỗi demo mất khoảng 1–2 phút. Phần **Nhận xét (L8)** ở cuối dùng để ghi cảm nhận sau khi chạy thử.

## Chuẩn bị

```bash
pnpm install
pnpm dev
```

Mở `http://localhost:5173` bằng Chrome. Bên trái là canvas mạch, bên phải là Blockly; toolbar nằm ở trên cùng.

## Demo M1 — Blink trên mạch mẫu

1. App mở sẵn mạch mẫu **Blink**: Board, Resistor, LED, nối D13 → R → LED → GND. Program là `forever`: bật D13, chờ 1 s, tắt D13, chờ 1 s.
2. Bấm **Run**. LED nhấp nháy khoảng 1 lần/giây và status là `Running`.
3. Bấm **Stop** trong lúc LED đang sáng. LED tắt ngay và status về `Idle`.
4. Trong Blockly, đổi `HIGH` của lệnh ghi đầu tiên thành `LOW`, rồi bấm **Run** ngay. LED không sáng nữa.
5. Bấm **Stop**.

## Demo M2 — Tự dựng mạch

1. Bấm **New**. Canvas trống; Blockly có hai khối `on start` và `forever`, cả hai đều rỗng.
2. Bấm **+ STEM Board**, **+ Resistor**, **+ LED** trên palette. Mỗi device xuất hiện ở giữa canvas; kéo thân của nó ra chỗ trống (dây và port đi theo, khi thả thì vị trí bám lưới).
3. Nối dây, mỗi dây gồm hai click: click port đầu, rồi click port cuối. Trong lúc nối có đường nét đứt đi theo chuột; huỷ bằng Esc hoặc click ra vùng trống.
   - D13 (board) → chân trái của Resistor
   - chân phải của Resistor → chân trái (anode) của LED
   - chân phải (cathode) của LED → GND (board)
4. Trong Blockly, mở **Pins** và kéo khối `digital write D13 HIGH` vào trong `on start`.
5. Bấm **Run**. LED sáng, status là `Running`. Trong lúc chạy, palette và **New** bị mờ, không kéo hay nối dây được.
6. Bấm **Stop**. Click vào dây D13 → Resistor để chọn nó (dây đổi sang màu xanh), rồi nhấn **Delete**.
7. Bấm **Run**. LED không sáng, vì mạch đã hở. Bấm **Stop**.

Muốn thử thêm: nối lại dây vừa xoá rồi Run (LED sáng lại); nối trùng một dây đã có (hiện thông báo, mạch không đổi); xoá một component (các dây của nó cũng mất).

## Demo M3 — Nút nhấn

App chưa có menu chọn mạch mẫu. Ở `pnpm dev`, mở DevTools (F12) → Console và nạp mạch mẫu bằng lệnh dưới đây; thay `button-led` bằng `button-direct` cho phần A:

```js
await fetch('/src/samples/button-led.project.json').then((r) => r.json()).then((p) => __stem.loadProject(p))
```

Cũng có thể tự dựng hai mạch này như ở Demo M2, vì palette đã có **+ Push Button**.

**A. Không cần program** (`button-direct`: 3V3 → nút → R → LED → GND, program rỗng)
1. Bấm **Run**. LED tắt.
2. Nhấn giữ nút (cap tròn màu xanh). Cap lún xuống và LED sáng. Nhả thì LED tắt, kể cả khi nhả chuột ở ngoài canvas.
3. Bấm **Stop**. Khi không chạy, click vào nút chỉ chọn nó như mọi component.

**B. Vòng kín qua program** (`button-led`: 3V3 → nút → D2; D13 → R → LED → GND)
1. Program trong Blockly là `forever`: `if digital read D2` → `digital write D13 HIGH`, `else` → `digital write D13 LOW`.
2. Bấm **Run**. Nhấn giữ nút: LED sáng; nhả: LED tắt.
3. Bấm **Stop**. Đổi `LOW` trong nhánh `else` thành `HIGH` và `HIGH` trong nhánh đầu thành `LOW`, rồi **Run**. Nút giờ bị đảo: nhả thì sáng, giữ thì tắt.
4. Muốn thử thêm:
   - mở **Logic** và kéo thêm `not` vào điều kiện;
   - rút `digital read` ra khỏi `if` rồi Run. Toolbar báo `"if" needs a condition.` và program không chạy.

## Demo M4 — Giữ project qua reload

1. Sửa mạch đang mở: thêm một device, kéo nó đi, xoá một dây. Sửa program: đổi một `HIGH` thành `LOW`.
2. Chờ khoảng một giây, rồi reload trang (F5). Mạch và program còn nguyên như trước khi reload.
3. Bấm **New**, chờ một giây, rồi reload. App mở lại đúng project mới (canvas trống).
4. Bấm **Run** trên một mạch có nút, giữ nút để LED sáng, rồi reload ngay khi đang giữ. App mở lại ở trạng thái thiết kế: `Idle`, LED tắt, nút không bị nhấn.

Project được tự lưu khoảng 0,3 s sau mỗi thay đổi; một lần sửa trong Blockly cần thêm khoảng 0,3 s để vào project. Vì vậy reload ngay sau khi sửa có thể mất lần sửa cuối.

## Demo Yolo:Bit — 3 phút cho Sở GD&ĐT (N17 B6)

> Người xem: lãnh đạo và chuyên viên Sở/Phòng GD&ĐT, giáo viên tin học. Thông điệp: **học sinh lập trình bo mạch Yolo:Bit
> thật mà không cần có mạch**; mỗi bài có mục tiêu và tự chấm; code Python sinh ra đúng dạng API Yolo:Bit. Mỗi bước ghi
> thời gian nói gợi ý. Lab mở bằng đúng URL mà LMS nhúng (tiếng Việt).

**Chuẩn bị (trước giờ trình bày):** `pnpm dev` đang chạy ở cổng 5173; Chrome mở sẵn hai tab:
- Tab 1: `http://localhost:5173/?embed=1&lab=yolobit&template=ybc-rainbow&profile=ybc-basic`
- Tab 2: `http://localhost:5173/?embed=1&lab=yolobit&template=ybc-thermometer&profile=ybc-advanced`

Bật loa máy chiếu. Màn hình rộng từ 800 px để thấy mạch và chương trình cạnh nhau. Đóng các tab khác: một lần **Kiểm tra**
mà tab bị ẩn sẽ báo "bị gián đoạn" chứ không chấm (cố ý, để không bao giờ báo đạt sai).

**0:00–0:40 — Bài "Cầu vồng", mức Cơ bản (tab 1).**
1. Nói: "Đây là bài học sinh nhận từ LMS: bo mạch Yolo:Bit ảo bên trái, chương trình khối bên phải, mục tiêu ở trên."
   Chỉ mục tiêu: *Bấm A hai lần thì cả màn hình sáng hai màu khác nhau*.
2. Chương trình gần xong, thiếu một khối nằm rời bên phải: `cho mau bằng mau + 1`. Kéo nó vào trong
   `nếu số lần nhấn nút A > 0`.
3. Bấm **Chạy**. Cả màn hình 5×5 sáng **đỏ**.

**0:40–1:10 — Bấm A ngay trên hình bo mạch.**
4. Bấm chuột vào nút **A vẽ trên bo mạch** (không phải nút ở bảng điều khiển): màn hình chuyển **lục**; bấm lần nữa: **lam**;
   lần nữa: lại đỏ. Nói: "Nút trên hình bấm được như mạch thật; học sinh nhà không có mạch vẫn học được."
5. Bấm **Dừng**.

**1:10–1:40 — Xem Python.**
6. Mở khung **Python** (thanh tiêu đề "Python" dưới khối, bấm **Hiện**). Chỉ các dòng:
   `if button_a.get_presses() > 0:`, `mau = mau + 1`, `display.set_all('#ff0000')`.
   Nói: "Cùng chương trình đó, viết bằng MicroPython theo đúng API Yolo:Bit (`display`, `button_a`), bấm **Sao chép** là
   nạp được lên mạch thật." Nếu được hỏi: dạng code nào đã đối chiếu với editor OhStem thì ghi VERIFIED, còn lại ghi rõ
   UNVERIFIED (bảng ở `docs/yolobit-compatibility-contract.md` §28); bài này chỉ dùng dạng VERIFIED.

**1:40–2:20 — Mức Nâng cao: "Nhiệt kế" (tab 2).**
7. Chuyển sang tab 2. Nói: "Mức Nâng cao có thêm cảm biến nhiệt độ, gia tốc, lắc, giai điệu, servo." Chỉ bảng điều khiển
   dưới mạch: thanh **Nhiệt độ**, tấm nghiêng, nút **Lắc**.
8. Kéo khối rời `chạy số (nhiệt độ (°C))` vào trong `nếu nút B đang được nhấn`. Bấm **Chạy**.
9. Kéo thanh **Nhiệt độ** lên **30 °C**: dòng số đo dưới màn hình của bo mạch ghi `30 °C`. Bấm nút **B** trên hình bo mạch:
   màn hình chạy chữ **30**.
10. Bấm **Dừng**.

**2:20–3:00 — Tự chấm bằng Kiểm tra.**
11. Bấm **Kiểm tra**. Nói trong lúc thanh tiến độ chạy: "Hệ thống tự đặt nhiệt độ 30 °C, tự bấm B, rồi xem màn hình có chạy
    chữ 30 không; học sinh nhìn thấy từng thao tác trên bo mạch."
12. Kết quả: **Đạt! Bạn đã hoàn thành mọi mục tiêu.**, hai mục tiêu có dấu ✓. Nói: "Trong LMS, kết quả này được gửi về bài
    học; bài mà giáo viên đặt 'cần Kiểm tra đạt' chỉ hoàn thành khi đạt."

**Nếu có sự cố:**
- Kéo khối hụt: bấm **Đặt lại** hai lần để mở lại bài, hoặc kéo lại.
- Không nghe tiếng: âm thanh bật khi bấm Chạy/Kiểm tra; nút loa dưới mạch là công tắc tắt/bật.
- Mở nhầm `profile=ybc-basic` cho bài Nhiệt kế: lab báo bằng tiếng Việt rằng bài cần mức Nâng cao, sửa URL thành
  `profile=ybc-advanced`.
- Hai bài Nâng cao khác để hỏi đáp: `ybc-dice` (lắc thì hiện số 1–6) và `ybc-servo-gate` (trời tối thì servo về 0°).

## Nhận xét (L8)

L8: *Flow có cảm giác giống một sản phẩm STEM thực tế không?*

### Lần chạy của coding agent (2026-10-03)

Agent chạy demo M1 và M2 bằng trình duyệt điều khiển bằng script (Playwright, Chromium 1280×720) và chụp ảnh từng bước. **Đây không phải người dùng thật**: nhận xét dưới đây là quan sát của agent, không thay thế được một lần chạy thử bởi người.

- **Chạy được trọn vẹn.** Cả hai demo đi hết từ đầu tới cuối, không có lỗi console. Dựng mạch M2 bằng script mất khoảng 1,2 s, tức số thao tác ít: 3 lần thêm, 3 lần kéo, 6 click nối dây, 1 lần kéo khối.
- **Phản hồi rõ.** LED sáng có quầng đỏ dễ thấy. Status `Running`/`Idle` và việc palette bị mờ khi chạy cho thấy trạng thái chạy. Thông báo "These ports are already connected." xuất hiện ngay khi nối trùng.
- **Chỗ còn vấp:**
  1. Mọi device mới đều xuất hiện ở giữa canvas, nên lần nào cũng phải kéo chúng ra.
  2. Palette mờ khi chạy nhưng không nói lý do (ví dụ "Stop để sửa mạch").
  3. Một program chỉ có `on start` vẫn hiện `Running` mãi, vì `forever` rỗng của program mặc định vẫn lặp. Người mới có thể chờ chữ "finished".
  4. Chưa có undo: xoá nhầm dây phải nối lại.
  5. Dây thẳng có thể vắt ngang thân device.
  6. Port của LED nhỏ và hai chân cách nhau chỉ 20; vùng bắt 12 px giúp nhiều, nhưng vẫn phải nhìn kỹ đâu là anode.

### Lần chạy M3 của coding agent (2026-10-03)

Cũng bằng Playwright, cũng không phải người dùng thật.

- **Chạy được trọn vẹn**, không có lỗi console. Từ lúc nhấn tới khi LED sáng mất khoảng 37 ms qua program và khoảng 14 ms khi không có program; agent không đánh giá được cảm giác thật.
- **Chỗ còn vấp:**
  1. Phải dùng Console để nạp mạch mẫu.
  2. Không có gì cho biết nút chỉ nhấn được khi đang chạy; con trỏ không đổi khi rê lên nút.
  3. Category **Pins** và **Logic** cùng màu.
  4. Program đọc nút theo vòng `forever`, nên một lần nhấn ngắn hơn khoảng 10 ms có thể bị bỏ qua. Với click của người thì khó gặp.
  5. Dây từ nút lên D2 trong `button-led` cắt qua góc của board, vì dây là đường thẳng.

### Lần chạy M4 của coding agent (2026-10-03)

Bằng Playwright, không phải người dùng thật. Reload mở lại project trong khoảng 0,1 s và không có lỗi console. Chỗ còn vấp:
1. **New** không hỏi lại, mà project cũ không còn cách nào mở lại từ UI.
2. Thay đổi trong khoảng 0,6 s cuối trước khi reload có thể mất.
3. Mở app ở hai tab thì tab nào lưu sau sẽ thắng.

### Người chạy thử

*(Chưa có. Điền tên/vai trò, ngày, và nhận xét sau khi một người chạy thử hai demo ở trên.)*
