# Định hướng phần cứng UNO và phạm vi M04 (spec của N18)

> Nguồn: văn bản định hướng phần cứng do owner gửi ngày 2026-10-25 (giữ nguyên nội dung), và dòng M04 của
> `STEMLearning - Dự toán.xlsx`, sheet "GĐ1 - Báo giá". Plan thực hiện: `docs/robot-3d-implementation-plan.md`.

## M04 — Mô phỏng 3D trên Web (720 man-hour)

> Môi trường mô phỏng 3D tích hợp Blockly, robot/thiết bị ảo, cảm biến, sa bàn và các tình huống thực hành; lưu kết
> quả bài lab về LMS. *(Ghi chú: Chạy trực tiếp trên Web.)*

Các dòng liên quan cùng sheet: M05 Thử thách / thi nhỏ trong lớp (140h); M06 Lập trình & kết nối thiết bị cơ bản
(210h): sinh chương trình từ bài lab, nạp chương trình từ trình duyệt xuống bo/robot tham chiếu, theo dõi trạng
thái và kiểm chứng trên thiết bị thật; M07 Gói khóa học thí điểm (80h): 01 khóa pilot gồm 06 bài để kiểm chứng
đầy đủ luồng học, bài lab 3D và phần cứng.

## 1. Thay đổi định hướng phần cứng

Phương án ban đầu của dự án sử dụng *Yolo:Bit* làm mạch điều khiển trung tâm cho robot/thiết bị STEM.

Phương án mới bỏ phụ thuộc Yolo:Bit và chuyển sang:

*Mạch UNO-compatible + Arduino Core + mạch mở rộng/control board + các module cảm biến/động cơ.*

Cấu trúc robot về cơ bản vẫn giống nhau:

*Phần mềm lập trình → mạch UNO (bộ não) → mạch mở rộng/control board → cảm biến, motor, servo và các module khác.*

Do đó các thành phần cơ khí, cảm biến, motor... không nhất thiết phải thay đổi toàn bộ. Phần thay đổi lớn nhất nằm ở
*mạch điều khiển và software stack dùng để lập trình/nạp chương trình xuống mạch*.

## 2. Khác biệt chính so với Yolo:Bit

Với Yolo:Bit, định hướng trước đây thiên về Blockly sinh *MicroPython* và chạy trên hệ firmware/library tương ứng với
Yolo:Bit.

Khi chuyển sang UNO, baseline phần mềm chuyển sang hệ sinh thái *Arduino*:

**Blockly trên STEMLearning → sinh Arduino C/C++ → compile chương trình → tạo firmware → upload xuống mạch UNO qua
USB → Arduino Core/library điều khiển các module.**

Như vậy phần Blockly không chỉ đổi tên thiết bị. Ta phải thay hoặc bổ sung *code generator từ Blockly sang Arduino
C/C++*.

Các block như: chạy motor; điều khiển servo; đọc cảm biến; ultrasonic; line sensor; LED; button — sẽ phải map sang
API/library của hệ UNO mới.

## 3. Những phần phần mềm bị ảnh hưởng

### Blockly / Code Generator

Các block mang tính logic chung như vòng lặp, điều kiện, biến, toán học... có thể tái sử dụng.

Nhưng phần sinh code liên quan phần cứng phải chuyển sang Arduino C/C++, ví dụ: `pinMode()`, `digitalWrite()`,
`digitalRead()`, `analogRead()` và các library điều khiển thiết bị.

Các block đặc thù Yolo:Bit/MicroPython sẽ không thể sử dụng nguyên trạng.

### Hardware abstraction

Cần xây dựng lại mapping: *Block → API → pin/cổng → module vật lý.*

Ví dụ cùng block "Motor trái chạy 50%" nhưng phía dưới phải biết motor trái nằm ở cổng nào, dùng driver nào và
library nào. Đây là phần phụ thuộc trực tiếp vào thiết kế mạch của nhà cung cấp mới.

### Compile

MicroPython có thể chạy source tương đối trực tiếp trên runtime của board. Arduino lại theo flow: *C/C++ source →
compiler → firmware binary/HEX → upload vào MCU.* Do đó STEMLearning phải có thêm bước build/compile.

### Upload từ Web

Cần nghiên cứu và triển khai cơ chế: *STEMLearning Web → USB/Serial → mạch UNO.* Nếu browser không thể trực tiếp thực
hiện toàn bộ quy trình compile/upload một cách phù hợp, có thể cần một uploader/agent cục bộ hoặc một kiến trúc upload
khác. Vì vậy đây là một đầu việc cần khảo sát kỹ trước khi chốt implementation.

### Simulator

Phần mô phỏng 3D, vật lý và logic robot không nhất thiết phải viết lại. Tuy nhiên lớp liên kết: *Simulator ↔ Blockly ↔
code thật ↔ thiết bị thật* phải được cập nhật để phản ánh đúng mạch UNO, pin mapping và library của hardware mới.

## 4. Open-source software có thể sử dụng với UNO

Nếu board được chốt là *UNO R3-compatible sử dụng ATmega328P*, nền tảng tiêu chuẩn có thể dùng là *ArduinoCore-avr*.
ArduinoCore-avr là open source; phần core chính như Arduino.h được phát hành theo *GNU LGPL 2.1 hoặc mới hơn*. Đây là
license cho phép sử dụng trong sản phẩm thương mại, với các nghĩa vụ LGPL cần được tuân thủ nếu chỉnh sửa/phân phối
phần library đó.

| Thành phần | Vai trò | License |
|---|---|---|
| ArduinoCore-avr | API/runtime cho UNO AVR | LGPL 2.1+ |
| avr-gcc / AVR toolchain | Compile C/C++ | Open source / GNU licenses |
| AVRDUDE | Nạp firmware xuống AVR MCU | GPL |
| Arduino CLI | Compile, board/library manager, upload | GPL-3.0 |
| Arduino IDE 2.x | IDE tham khảo/phát triển | AGPLv3 |

Arduino CLI chính thức là GPL-3.0. Arduino cũng công bố commercial license cho các trường hợp thương mại không muốn chịu
các yêu cầu GPL tương ứng. Arduino IDE 2.x cũng open source nhưng dùng *AGPLv3*. AVRDUDE là công cụ open-source dùng để
program các AVR microcontroller và có thể upload firmware cho Arduino UNO/ATmega328P.

## 5. Ý nghĩa về license đối với STEMLearning

Việc Arduino Core là open source *không có nghĩa chúng ta phải open-source toàn bộ STEMLearning*. Hướng an toàn là giữ
ranh giới rõ ràng: **STEMLearning proprietary code → sinh Arduino source code → sử dụng toolchain/open-source tooling để
compile/upload → firmware chạy trên UNO.**

ArduinoCore-avr với LGPL nhìn chung phù hợp cho mục đích thương mại. Tuy nhiên cần đặc biệt xem xét cách sử dụng các
thành phần GPL/AGPL như *Arduino CLI, Arduino IDE hoặc AVRDUDE* nếu chúng được nhúng, sửa đổi hoặc phân phối như một
phần trực tiếp của sản phẩm thương mại. Không nên mặc định rằng "open source = không có nghĩa vụ license". Do đó trước
khi chốt kiến trúc compile/upload chính thức cần review license theo cách chúng ta thực sự tích hợp các tool này.

## 6. Phần quan trọng nhất cần làm rõ với nhà cung cấp UNO

Open-source stack của Arduino không phải vấn đề lớn nhất. Phần cần kiểm tra là *software do nhà cung cấp tự viết trên
nền UNO*, gồm: library điều khiển motor; library cảm biến; firmware riêng; control board protocol; pin mapping;
Blockly block nếu có; code generator; uploader/app hiện tại.

Cần biết rõ các phần này: *do ai sở hữu → source có được cung cấp không → license gì → có cho phép tích hợp, chỉnh sửa
và sử dụng thương mại không.*

Nếu nhà cung cấp chỉ sản xuất hardware UNO-compatible và chúng ta *tự xây library + Blockly + uploader*, thì dự án sẽ
chủ động hơn rất nhiều và giảm phụ thuộc vào nhà cung cấp.

## 7. Vấn đề phát sinh do thay Yolo:Bit bằng UNO

Thay đổi này không làm phải viết lại toàn bộ STEMLearning, nhưng sẽ phát sinh một workstream kỹ thuật mới ở phần
Hardware Programming: *Cần thay code generation MicroPython/Yolo:Bit bằng Arduino C/C++, xây hardware abstraction cho
board mới, tích hợp library của robot, xây hoặc tích hợp quy trình compile/upload và kiểm tra license của toàn bộ
software stack liên quan.*

Do đó trước khi bắt đầu implementation cần chốt ít nhất: *MCU/phiên bản UNO cụ thể → schematic/pin mapping → control
board → module → library → phương án compile → phương án upload → license của từng thành phần.* Đây là những thông tin
quyết định effort thực tế của phần kết nối thiết bị trong dự án.
