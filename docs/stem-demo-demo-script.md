# STEM Studio PoC — Demo script

> Kịch bản ngắn cho người chạy thử PoC (plan POC-11, §8.2). Mỗi demo mất khoảng 1–2 phút. Phần **Nhận xét (L8)** ở cuối dùng để ghi cảm nhận sau khi chạy thử.

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

### Người chạy thử

*(Chưa có. Điền tên/vai trò, ngày, và nhận xét sau khi một người chạy thử hai demo ở trên.)*
