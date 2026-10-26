# N19 — Định hướng: xe robot tay gắp (spec)

Tài liệu này chép yêu cầu và các lựa chọn của chủ dự án ngày 2026-10-26. Plan thực hiện nằm ở
`docs/n19-gripper-plan.md`. Khi plan và tài liệu này lệch nhau, tài liệu này thắng.

## 1. Yêu cầu

Sau khi lab robot 3D của N18 (M04) xong, chủ dự án hỏi: "có gắp đồ chưa, kiểu xe gắp đồ ý". Sau đó yêu cầu: "lên plan làm cho
tôi, nhớ nghiên cứu các ứng dụng khác nhé và video liên quan đến robot gắp đồ".

Yêu cầu chung vẫn như N18:
- làm đến chất lượng production;
- 3D phải thật đẹp và tối ưu hiệu năng cho máy trường;
- giữ nguyên đồ họa và tính năng hiện có.

## 2. Lựa chọn đã chốt (2026-10-26)

| Câu hỏi | Lựa chọn |
|---|---|
| Loại tay gắp | **2 bậc**: một servo mở/đóng càng (0° mở, khoảng 80° đóng) và một servo nâng/hạ tay (0° hạ, 90° nâng), servo loại MG90S. Giống "Tay gắp 2 bậc" của OhStem và kit Keyestudio |
| Bài học | **Cả bốn bài**: Tìm và gắp (siêu âm, hạ tay, mở càng, gắp, thả vào vùng); Giao hàng theo vạch (dò line tới điểm lấy hàng, chở nhiều kiện về kho); Phân loại theo màu (khối đỏ/xanh lá/xanh dương về vùng cùng màu); Xếp chồng (nâng cao, đặt khối lên khối, đứng thẳng) |
| Cảm biến "vật trong càng" | **Có**: cảm biến hồng ngoại vật cản (mức số) gắn giữa hai ngàm. Xe thật lắp được, code sinh ra chạy được trên bo thật |

Hai hệ quả của các lựa chọn trên:
- **Phân loại theo màu** cần thêm một module mới là cảm biến màu (TCS34725, I²C).
- Ba loại module mới (tay gắp, hồng ngoại, cảm biến màu) nằm ngoài 720 giờ của M04. Theo plan N18 §8, mỗi loại module mới là
  phần VG (khoảng 16–24 giờ).

## 3. Ràng buộc kế thừa từ N18

- Chuỗi *Block → API → chân/cổng → module* là một nguồn dữ liệu chung cho simulator, code Arduino C/C++ và thiết bị thật. Không
  có phép đọc nào mà bo UNO thật không đọc được.
- Kết quả tất định, kiểm trên 4 runtime. Các attempt đã lưu trong LMS (`verify:attempt`) phải được kiểm lại y như trước.
- Không thư viện GPL trong code sinh ra. Không logo của Arduino, OhStem hay nhà cung cấp.
- Kit của nhà cung cấp chưa chốt. Mọi thông số là dữ liệu PLACEHOLDER, sẽ hiệu chỉnh khi có kit thật (VG).
