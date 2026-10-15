# Yolo:Bit Compatibility Contract

> **Version:** 1.0-draft (r3) · **Date:** 2026-10-14 · **Status:** DRAFT, chờ **cùng reviewer** làm final freeze check.
> - r2 sửa các finding của review độc lập (verdict *CHANGES REQUIRED*: R1–R3, N1–N3; §22.6).
> - r3 áp dụng hai quyết định cuối của owner: **OQ-E APPROVED**, **C-Q6 = Option A** (§22.2).
> - Chưa phải căn cứ implement cho tới khi freeze.
> **Target snapshot:** editor public `app.ohstem.vn/#!/codes/yolobit`, build marker `?v=20261007130057`, Blockly `8.0.1`; simulator public (Thiết bị ảo → Project Builder, `static/gears/index.html?…&build=658a5…`); trang firmware public `fw.ohstem.vn` liệt kê **"Yolo:Bit v1.12"** và **"Yolo:Bit S3 v1.14"** (đọc 2026-10-14). Ngày quan sát: **2026-10-14**.
> **Firmware chính xác: UNKNOWN. MicroPython version: UNKNOWN.** Contract này được **pin vào snapshot evidence public ở trên**, không phải bảo đảm tương thích vô thời hạn (§1).
> **Evidence methodology:** §0.3–§0.4. **Evidence ledger:** §20. **Đặc tả bản máy đọc được (cho YB-1):** §21.
> **Quan hệ tài liệu:** plan `docs/yolobit-compatible-board-implementation-plan.md` (v0.4, các mục YB-0 đã cập nhật theo contract này). Từ YB-1, tài liệu này là **source of truth** cho API Python Yolo:Bit và ngữ nghĩa quan sát được (plan §0). Tài liệu tiếng Việt, giữ thuật ngữ tiếng Anh.

---

## 0. Status / version / evidence rules

### 0.1 Kết quả YB-0 (tóm tắt, r2)

| Hạng mục | Kết quả |
|---|---|
| Kỹ thuật YB-0 | Self-audit (§22.1): không construct nào được mở còn field bắt buộc UNKNOWN/INFERRED. **Không còn quyết định owner nào đang chờ** (OQ-E, C-Q6 đã quyết, §22.2) |
| Display model | **OQ-E APPROVED (owner, 2026-10-14):** **5×5 RGB**, toạ độ 0-based, gốc trên-trái, x = cột, y = hàng, màu hex, mặc định đỏ (§4.3) |
| C-Q6 (owner decision) | **Option A (owner, 2026-10-14):** analog read dùng thang native **0–4095** (tài liệu OhStem, §10); UI 0–100 %; không chuẩn hoá về 0–1023. PWM vẫn EXCLUDED (§10.2) |
| RV-1 | **ACCEPT WITH RESTRICTIONS** (quyết định của reviewer). Ranh giới evidence ở §0.4, được mã hoá theo **từng claim** trong ledger (§20) và bản máy đọc được (§21) |
| Thay đổi eligibility ở r2 | C-19 thời gian chạy → **EXCLUDED** (R3). C-40 `random.randint` → **EXCLUDED** (self-audit N2: không có evidence chấp nhận được rằng firmware có `randint`). C-39 count up: **thứ tự đánh giá tường minh** + domain không âm có quan hệ (R1, R2) |
| Events | **DEFERRED** (§13) |
| Asset dựng sẵn | Hình, giai điệu dựng sẵn **EXCLUDED**; dùng hình/nốt **tự viết** (§14) |

### 0.2 Nhãn độ tin cậy

Chỉ dùng năm nhãn **VERIFIED, DOCUMENTED, INFERRED, UNKNOWN, n/a**. Mỗi nhãn VERIFIED/DOCUMENTED kèm **nguồn**, và mỗi nguồn chỉ được đỡ những **loại claim** cho phép ở §0.4.

| Ký hiệu | Nhãn | Nguồn |
|---|---|---|
| `V·G` | VERIFIED | Python mà **editor public** sinh ra từ **program của mình**. Chỉ chứng minh **dạng text**: dạng gọi, cú pháp import, text preamble, mã hoá (vd. chữ số trong `Image`). **Không** chứng minh API/module tồn tại hay chạy đúng |
| `V·S` | VERIFIED | Hành vi quan sát trên **simulator public** của OhStem với program của mình. Chỉ cho các loại claim ở §0.4 |
| `D·U` | DOCUMENTED | Text công khai trong UI editor (tooltip, nhãn block) **cùng snapshot**, mô tả block sinh ra đúng lời gọi đó |
| `D·W` | DOCUMENTED | Trang web public của OhStem (product page, bài học, wiki `docs.ohstem.vn`), có URL + ngày truy cập |
| `D·M` | DOCUMENTED | Tài liệu MicroPython chính thức (`docs.micropython.org/en/latest`, "Last updated on 13 Oct 2026"), và ngữ nghĩa Python mà MicroPython tuyên bố hỗ trợ |
| `I` | INFERRED | Hợp lý nhưng chưa xác lập. **Tính như UNKNOWN** ở EG |
| `U` | UNKNOWN | Chưa xác lập |
| `–` | n/a | Field không áp dụng (lý do ở mục chi tiết) |
| `–ᴰ` | n/a do domain | Field **UNKNOWN** nhưng bị **loại khỏi domain**: literal ngoài khoảng → lỗi compile; giá trị động → `out-of-domain` (plan §6.2 "thu hẹp"). Không phải đoán hành vi |
| `–ᴱ` | n/a do explicit-parameter | Generator luôn truyền/thiết lập/chuyển đổi tường minh, nên giá trị UNKNOWN không ảnh hưởng tới code sinh ra lẫn simulator (plan §6.2) |

Không có nhãn nào được nâng từ INFERRED lên VERIFIED/DOCUMENTED vì "trông hiển nhiên". Chuỗi suy luận kiểu "bài học năm 2021 cho thấy block chạy trên board + editor 2026 sinh lệnh X cho block đó ⇒ firmware có X" là **INFERRED**: tài liệu không nêu X, và mapping của block có thể đã đổi.

### 0.3 Phương pháp evidence

| Được dùng | Không dùng (tuân thủ R3 của plan) |
|---|---|
| Editor public, không đăng nhập: dựng **179 program tối thiểu** + 12 program chuẩn **của mình**, đọc Python qua công tắc Block→Python (đọc programmatic = text Ace của toggle, EVD-04) | Source firmware/thư viện (`yolobit.py`, `display.py`, `machine.py`, `/static/gears/firmware/**`, `/override/**`) |
| Toolbox, tên field, **dropdown option và tooltip** mà learner thấy (EVD-02) | Hàm định nghĩa block / generator JS của OhStem; bundle app |
| Simulator public (Project Builder → Stem Kit Shield, board con của Yolo:Bit): chạy program của mình, ghi **timestamp** console, khung LED đang hiển thị, chỉ báo âm thanh, widget; bấm nút ảo | Hình, icon, font, giai điệu, model 3D, artwork; endpoint private; token; trang cần đăng nhập (khoá học LMS bị redirect sang trang login → không dùng) |
| Trang public ohstem.vn, docs.ohstem.vn, docs.micropython.org (fetch raw, trích nguyên văn); `fw.ohstem.vn` chỉ đọc **text danh sách** | Ghi pixel của hình dựng sẵn, glyph font, nốt của giai điệu dựng sẵn vào repo |

- Evidence nằm **ngoài repo**: `%TEMP%\yb0-compat-evidence\` (`scripts/`, `out/`, `shots/`, `docs/`, `docs/crawl/`, `README.md`). Hình minh hoạ bài học OhStem chỉ được **xem** để đọc quy ước toạ độ rồi xoá.
- Repo chỉ chứa contract này và đoạn Python **ngắn** là output của program của mình (§2, §18).
- Traceback trên console simulator có lúc lộ tên file của thư viện OhStem. Contract chỉ ghi **loại lỗi** quan sát được; tên file/traceback **không bao giờ** là evidence.
- Main agent tự fetch và trích nguyên văn mọi DOCUMENTED (DOC-W1…W7, DOC-M1…M10). Mọi `V·G`/`V·S` do main agent tự chạy.

### 0.4 RV-1 — ACCEPT WITH RESTRICTIONS: ranh giới evidence của simulator

Simulator public chạy thư viện Python Yolo:Bit của OhStem trên **Pyodide (CPython 3.13)** với HAL giả. Reviewer chấp nhận `V·S` **có giới hạn**. Ranh giới dưới đây là **luật**, được mã hoá theo claim ở §20 (cột "Claim được đỡ") và §21 (`ClaimKind`, `EVIDENCE_SCOPE`).

| `V·S` **được** đỡ claim loại | `V·S` **không được** đỡ claim loại |
|---|---|
| `blocking`: lời gọi chặn hay trả về ngay; thứ tự statement | `physical-range`: khoảng cảm biến/analog vật lý suy từ giới hạn widget |
| `return-reset`: giá trị/kiểu trả về và hành vi reset của hàm thư viện (không phải số đo vật lý) | `language`: ngữ nghĩa ngôn ngữ MicroPython, kể cả module stdlib do CPython cung cấp (`random`, `time` trong simulator là CPython) |
| `display-transition`: nội dung khung LED và chuyển khung | `electrical`: mức điện, đọc lại chân đã ghi, chân hở, nhiễu analog, xung |
| `sound-indicator`: nội dung (nốt, Hz) và timing của chỉ báo âm thanh | `physical-timing`: timing của phần cứng thật |
| `yield-observed`: hoạt động song song khi **quan sát trực tiếp** (contract hiện không dùng) | `firmware-identity`: thư viện simulator ≡ firmware trên board |
| `sim-module`: module/API của thư viện OhStem **có trong snapshot simulator**, thấy được bằng import + lời gọi chạy được | `firmware-module`: module có trên firmware vật lý (đặc biệt **không** suy từ traceback/tên file) |

Hệ quả bắt buộc:
- Mọi field chỉ đỡ bởi `V·S` là **simDependent** (§15 cột cuối, §21). Nếu RV-1 bị thu hồi, các field đó thành UNKNOWN và construct phải bị loại (§22.3).
- Mọi timing có nguồn `V·S` (≈200 ms/cột, 6 cột/ký tự, 125 ms/tick) là **"vendor public simulator observation, NOT physical timing verification"**. Khớp với board thật là việc của **L3** (§22.4).
- Module `yolobit` và `music` có `OF-module` = `sim-module` (simDependent). Có trên firmware vật lý hay không: L3.

### 0.5 Luật áp dụng (nhắc lại, frozen ở plan)

- **EG (plan §6.2):** construct learner thấy được chỉ được mở khi **mọi field OF-\* liên quan** là VERIFIED/DOCUMENTED, với nguồn **được phép** cho loại claim đó (§0.4). Field UNKNOWN cần thiết → **RESTRICTED** (tập con có evidence) hoặc **EXCLUDED**.
- **Domain guard:** giá trị động ra ngoài domain → simulator dừng với `out-of-domain` (có `blockId`). Đây là từ chối mô phỏng, không phải ngữ nghĩa.
- **Domain số học chung không đổi:** safe integer của JS (plan §6.4). Các domain hẹp hơn ở contract này (§3.2) chỉ áp dụng cho **API cụ thể** cần an toàn machine-word phía MicroPython.
- **Asset parity (§6.8):** identifier ≠ nội dung ≠ provenance.
- **Eligibility:** `ELIGIBLE` / `RESTRICTED` / `EXCLUDED`; riêng event dùng `DEFERRED` (plan §6.6).

---

## 1. Target firmware / public-app snapshot

| Mục | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Editor | `app.ohstem.vn/#!/codes/yolobit`, asset marker `?v=20261007130057` | V·G | EVD-01 |
| Blockly | `8.0.1` | V·G | EVD-01 |
| Simulator | Project Builder iframe `static/gears/index.html?lang=vi&renderActive=0&build=658a5…`; board "Stem Kit Shield" (board con của YOLOBIT) | V·S | EVD-06 |
| Firmware công khai | `fw.ohstem.vn`, dropdown "Chọn firmware": **"Yolo:Bit v1.12"**, **"Yolo:Bit S3 v1.14"** | D·W | EVD-18 |
| Ngôn ngữ của board | "Nền tảng lập trình cho Yolo:Bit chính là OhStem App, có hỗ trợ 2 ngôn ngữ lập trình là kéo thả khối lệnh và MicroPython." | D·W | DOC-W5 |
| Phần cứng | ESP32 ("Vi điều khiển ESP32 của Espressif (160-240 MHz)"; "Dual-core 32bit Xtensa LX6, up to 240MHz") và biến thể ESP32-S3 (tên firmware "S3"; kiến trúc S3 chưa trích tài liệu) | D·W | DOC-W2, DOC-W3, EVD-18 |
| Firmware trên board đích | **UNKNOWN** | U | — |
| MicroPython version | **UNKNOWN** | U | — |
| Tài liệu MicroPython dùng làm DOCUMENTED | `docs.micropython.org/en/latest`, "Last updated on 13 Oct 2026" | D·M | DOC-M1…M10 |
| `main.py` | Không có tài liệu public | U | — |

**Tuyên bố pin:**

> Exact firmware version UNKNOWN; compatibility contract is pinned to this public evidence snapshot (editor `?v=20261007130057`, simulator build `658a5…`, firmware listing "Yolo:Bit v1.12" / "Yolo:Bit S3 v1.14" as of 2026-10-14) and is not a timeless compatibility guarantee.

Hệ quả: mọi câu L2/L3 trích snapshot này (plan §7.7); `main.py` UNKNOWN → Download dùng **`program.py`** (plan §13.7); khác biệt ESP32 / ESP32-S3 là rủi ro L3.

---

## 2. Imports and file/preamble structure

### 2.1 Quan sát (V·G, EVD-03)

| Program của mình | Output editor (rút gọn) |
|---|---|
| Workspace mặc định | `import time` · `while True:` / `  time.sleep_ms(100)` |
| `bắt đầu` có lệnh, `lặp lại mãi` rỗng | `import time` · `if True:` + lệnh · `while True:` / `  time.sleep_ms(100)` |
| `lặp lại mãi` có lệnh | `while True:` + lệnh + `  time.sleep_ms(10)` |
| Dùng tên bất kỳ của module `yolobit` | sau `import time`: `from yolobit import *` + **ba dòng preamble** |
| Dùng nhạc / random | `import music` / `import random`, theo thứ tự dùng lần đầu |

Preamble (nguyên văn, V·G):

```python
button_a.on_pressed = None
button_b.on_pressed = None
button_a.on_pressed_ab = button_b.on_pressed_ab = -1
```

### 2.2 Import và khả dụng module, **tách theo từng module** (N2)

`OF-import` = cú pháp/text import (V·G đỡ được). `OF-module` = module **có** và cung cấp API cần dùng (V·G **không** đỡ được).

| ID | Module | `OF-import` | `OF-module` | Nguồn `OF-module` | simDependent | Kết luận |
|---|---|---|---|---|---|---|
| C-03a | `time` (`time.sleep_ms`) | `import time` · V·G | DOCUMENTED | D·M DOC-M10 (ESP32 port: "Use the time module: … time.sleep_ms(500)") + D·W DOC-W5 (Yolo:Bit lập trình bằng MicroPython) | **không** | ELIGIBLE |
| C-03b | `yolobit` (+ preamble) | `from yolobit import *` + 3 dòng preamble · V·G | VERIFIED (`sim-module`) | V·S EVD-06…EVD-17: import, preamble và các API dùng ở §4–§11 chạy được trong snapshot simulator | **có** | ELIGIBLE (sim-scoped) |
| C-03c | `music` | `import music` · V·G | VERIFIED (`sim-module`) | V·S EVD-08/20/21 | **có** | ELIGIBLE (sim-scoped) |
| C-03d | `random` (`random.randint`) | `import random` · V·G | **INFERRED** | D·M DOC-M2: "`randint()` … only available if the MICROPY_PY_RANDOM_EXTRA_FUNCS configuration option is enabled"; không trang public nào của OhStem cho thấy `random.randint` trên Yolo:Bit (khoá MicroPython của OhStem cần đăng nhập); `random` trong simulator là CPython → claim `language`, không được dùng. Chuỗi "bài học 2021 + generator 2026" là INFERRED (§0.2) | — | **EXCLUDED** (kéo theo C-40) |
| C-03e | builtin `print`, `range`, `str`, `int`, `len` | — | DOCUMENTED | D·M (builtin của lõi ngôn ngữ, DOC-M8) | không | ELIGIBLE |

### 2.3 Contract cho generator của mình

| ID | Luật | Nhãn |
|---|---|---|
| IM-1 | Dòng đầu tiên sau comment cố định: `import time` (luôn có) | V·G (text) |
| IM-2 | Khi program dùng construct thuộc `yolobit`: `from yolobit import *` + **đúng ba dòng preamble**, ngay sau `import time` | V·G (text) |
| IM-3 | `import music` khi dùng C-50/C-51. Thứ tự cố định: `time`, `yolobit`+preamble, `music`. (`import random`: không sinh, C-40 EXCLUDED) | V·G (text) |
| IM-4 | Khi dùng C-50/C-51: thêm `music.set_tempo(4, 120)` sau import, trước code của learner (explicit-parameter, §8) | V·G (text), V·S (`sound-indicator`) |
| IM-5 | `on start` sinh ở top level (editor bọc `if True:`; tương đương ngữ nghĩa Python) | V·G, D·M |
| IM-6 | `forever`: `while True:` + thân + `time.sleep_ms(10)`. Không có `forever`: vòng chờ rảnh `while True:` + `time.sleep_ms(10)` (plan §13.3; editor dùng 100 ms: khác biệt không quan sát được khi không có event) | V·G |
| IM-7 | `None` chỉ xuất hiện trong preamble IM-2 (plan §6.4) | V·G |
| IM-8 | Tên file tải về: `program.py` | quyết định an toàn của plan §13.7 |
| IM-9 | Builtin được phép trong output: `print`, `range`, `str`, `int`, `len` (allowlist, plan §13.9) | D·M |
| IM-10 | Tên tạm của generator bắt đầu bằng `_` (plan §13.5); không bao giờ xuất hiện trong `global`; dùng cho bộ đếm `repeat` và cận count up (C-39) | — |

---

## 3. Supported MicroPython language assumptions

### 3.1 Lõi ngôn ngữ

MicroPython version UNKNOWN (§1). Contract chỉ dựa vào **lõi ngôn ngữ**: "MicroPython implements Python 3.4 and some select features of Python 3.5 and above." (DOC-M8), cộng danh sách khác biệt. **Không** dùng `V·S` cho ngôn ngữ (claim `language` bị cấm, §0.4).

| Construct | Python sinh ra | Editor sinh gì (V·G) | Ngữ nghĩa | Nhãn | Domain |
|---|---|---|---|---|---|
| Biến `int` | `x = 0`; `x = x + 1` | `x = 0` khi gán | Gán/đọc toàn cục | D·M | safe-int (plan §6.4) |
| `+ − ×` | `a + b` … | đủ | Số nguyên chính xác tuỳ ý | D·M | safe-int |
| `//`, `%` | `a // b`, `a % b` | `%` có; `//` không có block | Floor semantics; chia 0 → `ZeroDivisionError` | D·M | safe-int; danh sách khác biệt không có mục cho `//`/`%` trên int |
| So sánh, `and/or/not`, `True/False` | | đủ | Python; short-circuit | D·M | kiểu tĩnh |
| `if/elif/else`, `pass` | | đủ | | D·M | |
| `repeat N` | `for _r1 in range(N):` | `for count in range(3):` | `N ≤ 0` → 0 vòng | D·M | **`abs(N) ≤ MAX_REPEAT_ABS`** (§3.2) |
| `while` | `while c:` | `while c:` | | D·M | |
| count up | §3.3 | literal: `range(1, 11)`; cận không literal: tạm `i_end = float(...)` + helper `upRange/downRange` | §3.3 | D·M | §3.2 |
| `print(x)` | `print(x)` | `print(x)` | `str(x)` + `\n` ra serial (D·U "In ra cửa sổ Serial") | D·M + D·U | |
| text, nối, `str()` | `'a' + str(n)` | `'n=' + str(5)`; ≥ 3 phần: comprehension | | D·M | plan §6.7 |
| `len(s)` | `len(s)` | `len('abc')` | Số ký tự | D·M (ASCII) | chỉ chuỗi ASCII (`–ᴰ`) |
| Hàm | `def` / `global` / `return` | `def`, `global` cho **mọi** biến workspace, `return expr` | Python 3.4 | D·M | FN1–FN10 (§3.4) |
| `random.randint` | — | `import random` + `random.randint(1, 6)` | `[a, b]` (DOC-M3) | `OF-module` **INFERRED** | **EXCLUDED** (C-40, §3.5) |
| `/`, `**`, `round`, float | — | có | Float | — | EXCLUDED (plan §6.4) |
| `break`/`continue`, list, `_thread`, `lambda` | — | có | — | — | EXCLUDED |

### 3.2 Domain API-specific (machine-word) — R2

**Evidence:**
- DOC-M9: "Range arguments must fit in a machine word; large start or stop values misbehave."
- DOC-M3: "randint method can only return an integer that is at most the native word size."; getrandbits "can only return a maximum of 32 bits at a time".
- DOC-W3: ESP32 "32bit".

Tài liệu **không** nói ngưỡng chính xác ("large … misbehave"; số bit thực dùng của word không được nêu). Vì vậy contract chọn một cận **rất bảo thủ**, có biên an toàn lớn:

| Hằng số | Giá trị | Dùng cho |
|---|---|---|
| `MAX_RANGE_VALUE` | **1 000 000** | count up: `start`, `end`, `step` |
| `MAX_REPEAT_ABS` | **1 000 000** | `repeat N`: `abs(N)` |
| `MAX_RANDOM_ABS`, `MAX_RANDOM_SPAN` | 1 000 000, 1 000 000 | **Đặc tả sẵn** cho C-40, **không hoạt động** khi C-40 bị loại (§3.5) |

**Lập luận cận:**
- Với các domain dưới đây, **mọi** giá trị và kết quả trung gian mà MicroPython có thể phải biểu diễn (đối số, `end + 1`, giá trị kế tiếp `i + step`, độ dài dãy, độ rộng khoảng random) đều ≤ **2 000 001 < 2^21**.
- 2^21 cách 2^31 (signed 32-bit) một hệ số **1024**, và nhỏ hơn mọi biểu diễn "small int" hợp lý trên MCU 32-bit.
- Không có giá trị nào phải dựa vào số học big-int hay vào ngưỡng chưa được tài liệu hoá.

Domain số học chung (safe-int) **không đổi**. Learner vẫn tính được với số âm và số lớn. Chỉ **đối số** của các API ở trên bị thu hẹp.

### 3.3 Count up (C-39) — thứ tự đánh giá tường minh (R1) và domain (R2)

**Thứ tự (frozen):**
1. đánh giá **`start`** trước;
2. rồi **`end`**;
3. mỗi cái **đúng một lần**, trước khi vào vòng lặp;
4. `step` là **literal lúc compile** (≥ 1), không đánh giá lúc chạy.

Generator **không** dựa vào thứ tự đánh giá đối số của Python/MicroPython (`range(a, b + 1, s)`). Simulator dùng đúng thứ tự này.

**Python sinh ra:**

| Trường hợp | Python |
|---|---|
| `start` **và** `end` đều là literal nguyên | `for i in range(a, b+1):` (hằng `b+1` gập lúc generate; thêm `, s` khi `s ≠ 1`). Không có đánh giá lúc chạy nên thứ tự không quan sát được. Khớp editor: `range(1, 11)` |
| Mọi trường hợp khác | `_cu_start_k = <start>` · `_cu_end_k = <end>` · `for i in range(_cu_start_k, _cu_end_k + 1[, s]):` |

- `k` = số thứ tự (từ 1) của node count up theo thứ tự duyệt khi generate (xác định).
- Tên tạm theo IM-10. Trong thân hàm (Advanced), tên tạm là biến cục bộ của Python, không bao giờ vào `global`, learner không thấy.
- Editor OhStem cũng tách cận không literal ra biến tạm (`i_end = float(button_a.get_presses())`, EVD-23); mình làm điều đó cho **cả hai** cận, không dùng `float`.

**Domain (frozen, relational):**

| Ràng buộc | Literal | Giá trị lúc chạy |
|---|---|---|
| `0 ≤ start ≤ MAX_RANGE_VALUE` | lỗi compile `value-out-of-range` | `out-of-domain`, kiểm **ngay sau khi đánh giá `start`** (trước khi đánh giá `end`) |
| `0 ≤ end ≤ MAX_RANGE_VALUE` | lỗi compile | `out-of-domain`, kiểm ngay sau khi đánh giá `end` |
| `1 ≤ step ≤ MAX_RANGE_VALUE` | literal bắt buộc; ngoài khoảng → lỗi compile | — |
| `start > end` khi cả hai là literal | lỗi compile `descending-range-not-supported` (plan §6.5) | — |
| `start > end` lúc chạy (trong domain) | — | **0 vòng**, `i` giữ giá trị cũ (Python `range`, D·M) |

Hệ quả (cận trung gian):
- `end + 1 ≤ 1 000 001`;
- mọi `i` thuộc `[start, end]`;
- giá trị kế tiếp `≤ end + step ≤ 2 000 000`;
- số vòng `≤ 1 000 001`.

Không có vòng nào wrap. **Không có count up âm** trong milestone này: không cần cho giáo trình, và không mở thêm domain chỉ để linh hoạt. Learner đếm ngược dùng `repeat` + biến (plan §6.5).

**Sau vòng:** `i` = giá trị của vòng cuối (hoặc không đổi nếu 0 vòng). D·M.

### 3.4 Function domain (gate FN, plan §6.10)

FN1–FN10 chỉ dùng `def`, tham số vị trí, `global`, `return <expr>` ở cuối, gọi hàm: lõi Python 3.4, không có mục nào trong danh sách khác biệt của MicroPython (DOC-M8). Editor sinh đúng các dạng này (V·G, EVD-03, EVD-23). → **FN1–FN10 = DOCUMENTED (D·M)**. Test §18.3b của plan vẫn bắt buộc ở YB-7. Biến tạm của generator (IM-10) không vi phạm FN4: chúng không phải tên của learner.

### 3.5 `random.randint` (C-40) — EXCLUDED, domain đặc tả sẵn

- **Lý do loại:** `OF-module` INFERRED (C-03d). MicroPython tài liệu hoá `randint` là tuỳ chọn khi build; không có evidence chấp nhận được rằng firmware Yolo:Bit bật nó.
- **Cách mở lại:** một trang public của OhStem cho thấy `random.randint` trên Yolo:Bit, **hoặc** kiểm chứng vật lý (YB-P). Khi đó domain đã đặc tả sẵn sau đây có hiệu lực, không cần thiết kế lại:

  `−MAX_RANDOM_ABS ≤ a ≤ b ≤ MAX_RANDOM_ABS` **và** `b − a ≤ MAX_RANDOM_SPAN` (độ rộng `b − a + 1 ≤ 1 000 001 < 2^20`, dưới giới hạn 32 bit của `getrandbits`, DOC-M3). Literal vi phạm → lỗi compile. Động → `out-of-domain`, kiểm sau khi đánh giá `a` rồi `b`.

- Không có construct nào được mở phụ thuộc vào `random`.

---

## 4. Display model

### 4.1 Model logic (owner đã duyệt, OQ-E)

| Field | Giá trị | Nhãn | Evidence (claim) |
|---|---|---|---|
| Kích thước logic | **5 cột × 5 hàng** | D·W + V·G + V·S | DOC-W1 ("25 đèn LED đa màu, được sắp xếp theo ma trận vuông 5 x 5"); EVD-05 (`Image` 5 × 5 chữ số, text); EVD-06 (`display-transition`) |
| Gốc toạ độ | **Trên-trái** (mặt trước, USB ở trên) | D·W + V·S | DOC-W4 (hình quy ước); EVD-06 (`set_pixel(0,0)` → ô trên-trái, `display-transition`) |
| Chỉ số | **0-based**, x, y ∈ 0..4 | D·W | DOC-W4: "quy ước cột đầu tiên là cột số 0, tiếp theo là cột số 1, 2, 3, 4. Tương tự, ta có hàng số 0, 1, 2, 3, 4" |
| Trục | **x = cột**, **y = hàng** | D·U + V·G + V·S | nhãn block "đổi màu đèn led tại vị trí cột [X] hàng [Y]" → `display.set_pixel(X, Y, …)`; `set_pixel(3, 1)` → hàng 1 cột 3 |
| Dạng API | `display.set_pixel(x, y, '#rrggbb')`, `display.clear_pixel(x, y)` | V·G | EVD-03 |
| Màu | RGB, chuỗi `'#rrggbb'` | V·G | EVD-03 |
| Màu mặc định (chữ chạy, chữ số `1` của `Image`) | **đỏ** | V·S + V·G | EVD-07 (`display-transition`), EVD-05 (`#FF0000` → `1`, mã hoá) |
| Tắt | off | V·S + D·U | `clear()`: "tắt tất cả các led" |
| Độ sáng | `display.set_brightness(n)`, 0..100 (D·U) | — | Không quan sát được (EVD-13) → **EXCLUDED** |
| Ghi đè khung | `show(Image)` và chạy chữ thay **toàn bộ** khung; `set_pixel`/`clear_pixel` đổi một ô | V·S | EVD-06/13/17 (`display-transition`) |
| Toạ độ ngoài 0..4 | Phần cứng: UNKNOWN (simulator bỏ qua, không dùng làm claim vật lý) | U | → `–ᴰ` |
| Hình tự định nghĩa | `Image("r0:r1:r2:r3:r4")`, hàng trên→dưới, mỗi hàng 5 chữ số trái→phải | V·G | EVD-05 |
| Chữ số trong `Image` | Chỉ số bảng màu editor: `0` tắt, `1` `#FF0000`, `2` `#FFA500`, `3` `#FFFF00`, `4` `#00FF00`, `5` `#0000FF`, `6` `#4B0082`, `7` `#800080`, `8` `#FFFFFF`; màu ngoài bảng → `undefined` | V·G | EVD-05 |
| Chữ số `2`, `6`, `7` khi hiển thị | Simulator vẽ khác ô màu editor → **UNKNOWN** | V·S | EVD-13 → chỉ dùng `0`/`1` (C-70 EXCLUDED) |

### 4.2 Chạy chữ (text / number)

> Mọi timing dưới đây là **vendor public simulator observation, NOT physical timing verification** (§0.4).

| Field | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Dạng gọi | `display.scroll('…')`; số: `display.scroll(n)` | V·G | EVD-03 |
| Độ dài 0 | Không đổi khung, trả về ngay | V·S | EVD-17 |
| Độ dài 1 | Hiện tĩnh ngay, không chặn, giữ tới thao tác display kế tiếp | V·S + D·U | EVD-06/17; tooltip: "Nếu chỉ có 1 chữ thì hiện ra luôn mà không cần chạy." |
| n ≥ 2: khung đầu | Ký tự đầu sát cột 0 | V·S | EVD-06/07 |
| Bước | Dịch trái 1 cột mỗi ≈ **200 ms** | V·S | EVD-06/07 |
| Ô ký tự | **6 cột/ký tự** cố định | V·S | EVD-07: `HI` 2398, `ABC` 3596, `HELLO` 6001, `A B` 3602, `ab` 2405, `42` 2401, `-7` 2400, `100` 3602 ms |
| Thời gian chặn | **1200 ms × n** | V·S | như trên |
| Kết thúc | Khung trống rồi trả về | V·S | EVD-06/07/17 |
| Số | như `str(n)` | V·S + D·M | EVD-11 |
| Màu chữ | đỏ | V·S | EVD-07 |
| Charset | ASCII `0x20`–`0x7E` (94/94 hiện, không lỗi) | V·S | EVD-12 |
| Ngoài ASCII | Không nhất quán (`'à'` → `KeyError`; `'aà'` → ô trống) → `out-of-domain` / lỗi compile | V·S | EVD-11 |
| Glyph | Font OhStem không ghi; simulator dùng font 5×5 **của mình** (`presentation`, plan §6.8) | — | — |

### 4.3 Model display cuối — **OWNER APPROVED (OQ-E, 2026-10-14)**

> **Final logical display model (owner đã duyệt):**
> - ma trận **5×5 RGB**;
> - toạ độ **0-based**, gốc **trên-trái**;
> - **`x` = cột** 0..4 trái→phải, **`y` = hàng** 0..4 trên→dưới;
> - màu là chuỗi **hex** `'#rrggbb'`;
> - màu mặc định của chữ và hình tự vẽ là **đỏ**.
>
> **Virtual model của `ybc-board`:** display ảo = đúng model trên.
> - **Basic:** hình tự vẽ bật/tắt (`0`/`1` = tắt/đỏ), xoá, chạy chữ ASCII; render đỏ.
> - **Advanced:** thêm `set_pixel`/`clear_pixel`/`set_all` với **8 màu** bảng editor (§4.4).
> - **Không** có độ sáng, hình/giai điệu dựng sẵn, biểu đồ.
> - 8×8 không dùng cho board family này.
>
> Timing chạy chữ là quan sát simulator, chưa kiểm vật lý (L3).
>
> **Trạng thái:** OQ-E đã đóng. Capability display (YB-3a, YB-7a) được implement theo model này, trong phạm vi các construct ELIGIBLE/RESTRICTED của §15.

### 4.4 Bảng màu Advanced (RESTRICTED)

`#FF0000`, `#FFA500`, `#FFFF00`, `#00FF00`, `#0000FF`, `#4B0082`, `#800080`, `#FFFFFF` (8 ô màu colour picker editor, EVD-05). Generator truyền chuỗi hex này (V·G). Màu logic là chuỗi hex; cách LED thật/màn hình hiển thị là `presentation`. Màu ngoài bảng **không** mở.

---

## 5. Buttons

| Field | Giá trị | Nhãn | Evidence (claim) |
|---|---|---|---|
| Dạng gọi | `button_a.is_pressed()`, `button_b.is_pressed()` | V·G | EVD-03 |
| `OF-return` `is_pressed` | `True` khi nút **đang được giữ lúc gọi**, ngược lại `False`; **không chốt**; A, B độc lập | V·S + D·U | EVD-09 (`return-reset`). Tooltip: "Kiểm tra xem nút nhấn có được nhấn hay không." |
| A+B | `button_a.is_pressed_ab()` (editor sinh). **A+B unsupported in the accepted simulator-backed contract snapshot**: thư viện trong simulator ném `AttributeError`. **Không** có claim nào về khả năng nhấn A+B của board vật lý | V·G / V·S | EVD-19 → **EXCLUDED** (C-47) |
| `get_presses()` | Trả về số lần nhấn kể từ lần đọc trước (hoặc từ đầu program), rồi **đếm lại từ 0**; trong simulator đếm ở **cạnh nhấn xuống**, nhấn trong lúc `sleep` vẫn được đếm | D·U (reset) + V·S (`return-reset`) | Tooltip: "Đếm số lần mà nút nhấn được nhấn, và đếm lại từ 0."; EVD-09, EVD-17. Debounce/cạnh trên board thật: L3 |
| Event `on_pressed` | `button_a.on_pressed = on_button_a_pressed` | V·G | §13: **DEFERRED** |

---

## 6. Light / temperature / motion sensors

| Sensor | Dạng gọi (V·G) | Đơn vị | Khoảng | Kiểu / làm tròn | Kết luận |
|---|---|---|---|---|---|
| Ánh sáng (C-15) | `light_level()` | mức tương đối (D·U) | **0..100**, **D·U** tooltip: "Lấy mức độ sáng tối của ánh sáng (0: tối nhất, 100: sáng nhất)." (không dựa vào widget) | `int` (V·S `return-reset`: in `78`, `82`, …) | **ELIGIBLE**. Slider UI 0–100 % → giá trị đồng nhất (plan §18.2, N = 100) |
| Nhiệt độ (C-16) | `temperature()` | **°C** (D·U: "Lấy nhiệt độ hiện tại theo độ C.") | Khoảng vật lý **UNKNOWN, không tuyên bố**. **Domain hỗ trợ của contract:** slider số nguyên **0..50 °C** (`–ᴰ`) | float 1 chữ số (V·S `return-reset`) → generator sinh **`int(temperature())`** (`–ᴱ`, truncation D·M) | **RESTRICTED** |
| Gia tốc (C-17) | `accelerometer.get_x()`… | mg (D·U) | UNKNOWN (giá trị simulator `0, 0, -50` không phải claim) | — | **EXCLUDED** |
| Cử chỉ / lắc (C-18) | `accelerometer.is_gesture("shake")`, `accelerometer.sensor.shake(15)` | — | — | — | **EXCLUDED** |
| Chạm chân (C-48) | `pin0.is_touched()` | — | — | — | **EXCLUDED** |

Mỗi lần gọi đọc giá trị hiện tại; không chặn (V·S `blocking`). Nhiễu cảm biến của simulator OhStem không thuộc contract.

---

## 7. Time/runtime APIs

| Construct | Dạng gọi | Ngữ nghĩa | Nhãn | Kết luận |
|---|---|---|---|---|
| Chờ (C-04) | `time.sleep_ms(n)` | Chặn **ít nhất** `n` ms (DOC-M1: "This function will delay for at least the given number of milliseconds, but may take longer…"); đơn vị ms (D·U); "should be positive or 0" | V·G + D·M + D·U (V·S 993–1002 ms chỉ bổ trợ) | **ELIGIBLE**, `int` 0..60000 |
| Nhường cuối `forever` | `time.sleep_ms(10)` | như trên | V·G + D·M | ELIGIBLE |
| **Thời gian chạy (C-19)** | `running_time()` | Tooltip: "tổng thời gian milli giây kể từ khi chương trình bắt đầu chạy" (gốc + đơn vị). **Không** có tài liệu public về wrap, reset, điều chỉnh, hay khoảng hợp lệ của phép trừ. Simulator trả giá trị kiểu epoch, mâu thuẫn với gốc trong tooltip. Không thể dùng `ticks_diff()` (DOC-M4): code sinh ra của Yolo:Bit không dùng `ticks_*`, và không tài liệu nào nối `running_time()` với chúng | V·G + D·U; wrap/khoảng **UNKNOWN** | **EXCLUDED** (R3, phương án C). LATER |
| Timer (C-49) | `timer.reset()`, `timer.get()` | Editor sinh không kèm import | V·G | **EXCLUDED** |

---

## 8. Music / tone

> Timing và Hz dưới đây có nguồn `V·S` loại `sound-indicator`: **vendor public simulator observation, NOT physical timing verification**.

### 8.1 Quan sát

| Field | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Nốt | `music.play(['C4:4'], wait=True)`; giáng: `'DB4:1'` | V·G | EVD-03 |
| Nghỉ | `music.play(['R:1'], wait=True)` | V·G | EVD-03 |
| `wait=True` | Chặn tới khi phát xong | V·S (`blocking`) + D·U | EVD-08; tooltip: "Chờ đến khi hết bài" |
| Tempo | `music.set_tempo(ticks, bpm)`: tick/nhịp, nhịp/phút (D·U). Mặc định `(4, 60)`; `music.reset()` → `(4, 60)` | D·U + V·S | EVD-08 |
| Đơn vị độ dài | **tick**: `ticks × 60000 / (bpm × ticks_per_beat)` ms. Ở `(4, 120)`: `:1` ≈ 130, `:2` ≈ 250, `:4` ≈ 500 ms | V·S + D·U | EVD-08, EVD-20 |
| `:8` | ≈ 500 ms (không phải 1000) → không nhất quán | V·S | EVD-20 → loại |
| Phân số tick (`0.5`, `0.25`), chuỗi tần số số (`'440:4'` không phát) | — | V·G / V·S | loại |
| Nốt → Hz | C3 131, D3 147, E3 165, F3 175, G3 196, A3 220, B3 247, C4 262, D4 294, E4 330, F4 349, G4 392, A4 440, B4 494, C5 523 (chỉ báo simulator); C#4/`DB4` 277 | V·S | EVD-08, EVD-21 |
| `music.pitch(f, d)` | Không chặn; kết thúc tone, `stop`, chồng tone **không quan sát được** | V·G + V·S + D·U | → EXCLUDED |
| Giai điệu dựng sẵn | 14 identifier | V·G | asset → EXCLUDED |

### 8.2 Contract

| ID | Construct | Python | Domain | Kết luận |
|---|---|---|---|---|
| C-50 | Phát nốt (chặn) | `music.play(['<N>:<t>'], wait=True)` | `N` ∈ 15 nốt tự nhiên C3…C5; `t` ∈ {1, 2, 4}; tempo cố định bằng IM-4 → 125 / 250 / 500 ms | **RESTRICTED** |
| C-51 | Nghỉ (chặn) | `music.play(['R:<t>'], wait=True)` | `t` ∈ {1, 2, 4} | **RESTRICTED** |
| C-21, C-22, C-20, C-52 | `pitch`, `stop`, giai điệu dựng sẵn, tempo cho learner | — | — | **EXCLUDED** |

Simulator cho C-50: âm `hz(N)` bắt đầu khi gọi, kéo dài `t × 125` ms, statement chặn đúng khoảng đó. Giai điệu tự viết = chuỗi C-50/C-51 (mỗi lệnh một nốt). Âm sắc, âm lượng: `presentation`.

---

## 9. Header pins

| Field | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Tên chân UI | `P0`…`P16`, `P19`, `P20` | V·G | EVD-02 |
| Tên trong Python | `pin0` … `pin20` | V·G (text); khả dụng: `sim-module` | EVD-03, C-03b |
| Chân cho kẹp cá sấu | **P0, P1, P2**: "đa chức năng, có thể bật tắt (gọi là chế độ digital) và đọc tín hiệu truyền vào (chế độ analog)" | D·W | DOC-W2, DOC-W3 |
| Cảm biến analog trên P0–P2 | "có thể kết nối với các chân P0, P1, P2 trên mạch mở rộng" | D·W | DOC-W6 |
| Dropdown digital read / write / analog read | 0–16, 19, 20 / 0–4, 6–16, 19, 20 / 0–7, 10–12 | V·G | EVD-02 |
| Pull | editor sinh `set_pull` không kèm import | V·G | **EXCLUDED** |
| Chân reserved P3–P20 | **UNKNOWN** | U | — |

**Contract:** `ybc-board` chỉ mở **P0, P1, P2**.

| ID | Construct | Python | Ngữ nghĩa | Domain | Kết luận |
|---|---|---|---|---|---|
| C-23 | Digital write | `pinN.write_digital(v)` | `1` = bật (mức cao), `0` = tắt (D·U: "Đổi trạng thái bật tắt"; block BẬT=`1`/TẮT=`0`); không chặn (V·S `blocking`). **Không** dùng việc "ghi rồi đọc lại" của simulator làm evidence (claim `electrical` bị cấm) | `N` ∈ {0,1,2}; `v` ∈ {0,1} | **RESTRICTED** |
| C-24 | Digital read | `(pinN.read_digital() == 1)` | `1`/bật = mức cao (D·U "Đọc giá trị bật tắt"). Generator luôn so `== 1`, nên dù API trả `int` 0/1 (V·S) hay `bool` thì biểu thức vẫn là `bool` xác định (D·M: `True == 1`) | `N` ∈ {0,1,2}; net `floating`/`conflict` → `out-of-domain` | **RESTRICTED** |

---

## 10. Analog / PWM

### 10.1 Thứ bậc evidence (N1)

| Lớp | Nội dung | Nhãn | Evidence | Vai trò |
|---|---|---|---|---|
| 1. Dạng gọi (editor) | `pinN.read_analog()`; dropdown analog read 0–7, 10–12 | V·G | EVD-03, EVD-02 | `OF-call` |
| 2. **Tài liệu OhStem cho Yolo:Bit** | Cảm biến góc xoay: "Kiểu tính hiệu: tín hiệu analog (0~4095)"; "có thể kết nối với các chân P0, P1, P2 trên mạch mở rộng"; chương trình dùng khối CHÂN CẮM, chuyển "giá trị analog 0- 4095 thành 0 - 100%". Rotary: "Giá trị đọc được là dạng analog (từ 0 đến 4095 đối với Yolo:Bit)" | **D·W** | DOC-W6, DOC-W7 | **`OF-range` (0–4095), chân P0–P2: nguồn xác lập** |
| 3. Quan sát Project Builder | Widget "Rotary Analog" 0–4095; P0 đọc `0`/`4095` ở hai đầu, giá trị float có nhiễu | V·S | EVD-14 | **Bổ trợ**: không xác lập khoảng (claim `physical-range`/`electrical` bị cấm) |
| 4. Tài liệu chung ESP32 | `ADC.read()` "0-4095 for 12-bit resolution" | D·M | DOC-M5 | **Ngữ cảnh**: không chứng minh wrapper của Yolo:Bit |
| 5. Chuyển kiểu | Generator sinh `int(pinN.read_analog())`: `int()` của MicroPython (D·M) cho ra kiểu nguyên dù API trả `int` hay `float` | D·M | DOC-M8 | `OF-round` = `–ᴱ`, **tách khỏi** khoảng raw |

Analog write: `pinN.write_analog(v)` (V·G); **khoảng UNKNOWN** (không tài liệu; widget LED của simulator chỉ bật/tắt, EVD-15).

| ID | Construct | Python | Domain | Kết luận |
|---|---|---|---|---|
| C-25 | Analog read | `int(pinN.read_analog())` | `N` ∈ {0,1,2}; giá trị native **0..4095** (learner dùng đúng thang này, C-Q6 = A); net `high` → 4095, `low` → 0, analog-source → `percentToNative(p, 4095)`; `floating`/`conflict` → `out-of-domain` | **RESTRICTED** |
| C-26 | Analog write / PWM | — | khoảng UNKNOWN | **EXCLUDED** (owner xác nhận ở C-Q6) |

### 10.2 OWNER DECISION — C-Q6 = Option A (2026-10-14)

| | |
|---|---|
| Giả định gốc của owner (Q6, 2026-10-13) | Giá trị analog mà learner lập trình: 0–1023; UI cảm biến onboard 0–100 % |
| Evidence YB-0 | Tài liệu OhStem: analog read native của Yolo:Bit là **0–4095** (DOC-W6, DOC-W7) |
| **Quyết định của owner** | **Option A:** analog read dùng **thang native 0–4095**; UI control vẫn **0–100 %**; **không** chuẩn hoá về 0–1023 |
| Ngữ nghĩa áp dụng | Generator: `int(pinN.read_analog())`, learner thấy giá trị 0..4095. Simulator: slider p ∈ 0..100 → `percentToNative(p, 4095) = floor(p × 4095 / 100 + 0.5)`; net `high` → 4095, `low` → 0; hở/xung đột → `out-of-domain` |
| PWM / analog write | Vẫn **EXCLUDED** (C-26): quyết định của owner không tạo ra được ngữ nghĩa PWM đang UNKNOWN |
| Trạng thái | C-Q6 đã đóng. C-25 RESTRICTED, không còn bị chặn. Plan §3 Q6 và §11.3 đã cập nhật |

---

## 11. Servo

| Field | Giá trị | Nhãn | Evidence |
|---|---|---|---|
| Dạng gọi | `pinN.servo_write(angle)` | V·G | EVD-03 |
| Đơn vị / khoảng | độ, **0–180** ("quay đến một góc trong khoảng 0-180 độ") | D·U | EVD-02 |
| Chân | P0–P2 có trong dropdown servo (V·G); contract chỉ mở P0–P2 | V·G | EVD-02 |
| Chặn | Không (≈ 0 ms) | V·S (`blocking`) | EVD-16 |
| Ngoài khoảng | UNKNOWN → `–ᴰ` | U | — |
| Chuyển động vật lý | `presentation`; kiểm L3 | – | — |

**C-27 Servo: RESTRICTED** (180°, `int` 0..180, P0–P2). Biến thể 270/360/release: EXCLUDED.

---

## 12. Pulse / ultrasonic prerequisites

`pinN.pulse_in(1|0)` (V·G), đơn vị µs (D·U). Timeout/lỗi: simulator trả `0` ngay. Đây là claim `electrical`, không dùng. MicroPython `time_pulse_us` trả −1/−2 (DOC-M7), nhưng wrapper của Yolo:Bit **UNKNOWN**. Không có API phát trigger µs.

**C-28 EXCLUDED. C-69 siêu âm: EXCLUDED / LATER.**

---

## 13. Events

| Field EV (plan §6.6) | Trạng thái |
|---|---|
| Dạng đăng ký `button_a.on_pressed = f` | V·G |
| EV1, EV2, EV4, EV5, EV6, EV7, EV9, EV10 | UNKNOWN (không tài liệu OhStem; lập lịch trong simulator thuộc HAL giả + Pyodide, ngoài phạm vi RV-1) |

> **Events: DEFERRED.** Không event block nào ở Basic hay Advanced. Polling là mô hình giáo trình.

Preamble IM-2 vẫn được sinh (editor luôn sinh); nó không đăng ký handler.

---

## 14. Assets / provenance

| Asset | Identifier | Nội dung | Provenance dùng được | Quyết định |
|---|---|---|---|---|
| 13 hình dựng sẵn (`HEART`, `HEART_SMALL`, `HAPPY`, `SMILE`, `SAD`, `CONFUSED`, `ANGRY`, `ASLEEP`, `SURPRISED`, `SILLY`, `FABULOUS`, `YES`, `NO`) | V·G | asset OhStem, không ghi | Không | **EXCLUDED** → `Image("…")` tự vẽ (C-06) |
| 14 giai điệu (`DADADADUM`, `ENTERTAINER`, `PRELUDE`, `ODE`, `NYAN`, `RINGTONE`, `BIRTHDAY`, `WEDDING`, `PYTHON`, `CHASE`, `JUMP_UP`, `JUMP_DOWN`, `POWER_UP`, `POWER_DOWN`) | V·G | asset, không ghi | Không | **EXCLUDED** → chuỗi C-50/C-51 tự viết |
| Font chạy chữ | — | không ghi | Không | Font 5×5 tự vẽ (presentation) |
| Bảng 8 màu | V·G | mã hex chuẩn | Không phải tác phẩm | Dùng (§4.4) |
| Bảng nốt → Hz | V·S | 12-TET chuẩn (A4 = 440 Hz) | Kiến thức chung | Dùng (§8) |

Provenance của mình (plan §6.8): hình, font, giai điệu mẫu trong template `ybc-*` **tự làm** (hoặc MIT/BSD/Apache-2.0/CC0 có attribution tại đây). Hiện **không có** asset bên thứ ba.

| Asset của mình | Tác giả | License |
|---|---|---|
| Hình mẫu P1–P11 (`RING`, `CROSS`, `DOT`, `FULL`), giai điệu P5 | STEM Studio (YB-0) | Của dự án |
| Font 5×5 của display, ASCII 0x20–0x7E, 95 glyph (YB-3a, `src/core/simulation/peripherals/font.ts`) | STEM Studio (YB-3) | Của dự án |

---

## 15. Construct compatibility matrix

Ký hiệu: §0.2. Cột field: `call import module unit range default clamp round block yield return error coord event content`. Cột cuối liệt kê field **simDependent** (nguồn duy nhất là `V·S`).

### 15.1 Construct được mở (ELIGIBLE / RESTRICTED)

| ID | Capability | Tier | call | imp | mod | unit | range | def | clamp | round | block | yield | ret | err | coord | event | content | Elig. | simDependent fields |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C-01 | on start | B MUST | V·G | – | – | – | – | – | – | – | D·M | – | – | – | – | – | – | ELIGIBLE | — |
| C-02 | forever | B MUST | V·G | V·G | D·M+D·W | D·M | – | – | – | – | D·M | – | – | – | – | – | – | ELIGIBLE | — |
| C-03a | `import time` | all | V·G | V·G | D·M+D·W | – | – | – | – | – | – | – | – | – | – | – | – | ELIGIBLE | — |
| C-03b | `from yolobit import *` + preamble | all | V·G | V·G | V·S | – | – | – | – | – | – | – | – | – | – | – | – | ELIGIBLE | module |
| C-03c | `import music` + tempo preamble | all | V·G | V·G | V·S | – | – | –ᴱ | – | – | – | – | – | – | – | – | – | ELIGIBLE | module |
| C-04 | wait ms | B MUST | V·G | V·G | D·M+D·W | D·U+D·M | D·M | – | –ᴰ | – | D·M | – | – | –ᴰ | – | – | – | ELIGIBLE | — |
| C-06 | hình tự vẽ (0/1) | B MUST | V·G | V·G | V·S | – | V·G | – | – | – | V·S | – | – | – | D·W+V·S | – | V·G+V·S | RESTRICTED | module, block, content (hiển thị) |
| C-07 | chạy chữ | B MUST | V·G | V·G | V·S | V·S | V·S | – | – | – | V·S+D·U | – | – | –ᴰ | V·S | – | V·S | RESTRICTED | module, unit, range (charset), block (n ≥ 2), coord, content |
| C-08 | chạy số | B MUST | V·G | V·G | V·S | V·S | V·S | – | – | D·M | V·S+D·U | – | – | – | V·S | – | V·S | RESTRICTED | module, unit, range, block (n ≥ 2), coord, content |
| C-09 | xoá display | B MUST | V·G | V·G | V·S | – | – | – | – | – | V·S | – | – | – | – | – | D·U+V·S | ELIGIBLE | module, block |
| C-10 | đặt điểm | A MUST | V·G | V·G | V·S | – | D·W+V·S | – | –ᴰ | – | V·S | – | – | –ᴰ | D·W+V·S | – | V·G+V·S | RESTRICTED | module, block |
| C-42 | tắt điểm | A MUST | V·G | V·G | V·S | – | D·W+V·S | – | –ᴰ | – | V·S | – | – | –ᴰ | D·W+V·S | – | D·U+V·S | RESTRICTED | module, block |
| C-43 | đặt tất cả (8 màu) | A | V·G | V·G | V·S | – | V·G | – | –ᴰ | – | V·S | – | – | – | – | – | D·U+V·S | RESTRICTED | module, block |
| C-12 | nút A/B đang giữ | B MUST | V·G | V·G | V·S | – | – | – | – | – | V·S | – | V·S+D·U | – | – | – | – | RESTRICTED | module, block, return (giữ-lúc-gọi, không chốt) |
| C-13 | số lần nhấn A/B | B NICE | V·G | V·G | V·S | – | – | – | – | – | V·S | – | D·U+V·S | – | – | – | – | RESTRICTED | module, block, return (cạnh nhấn) |
| C-15 | ánh sáng | B MUST | V·G | V·G | V·S | D·U | D·U | – | – | V·S | V·S | – | D·U | – | – | – | – | ELIGIBLE | module, round, block |
| C-16 | nhiệt độ (`int(...)`) | A MUST | V·G+D·M | V·G | V·S | D·U | –ᴰ | – | – | –ᴱ | V·S | – | D·U | – | – | – | – | RESTRICTED | module, block |
| C-50 | phát nốt (chặn) | B MUST / A | V·G | V·G | V·S | V·S+D·U | V·S | –ᴱ | –ᴰ | – | V·S+D·U | – | – | –ᴰ | – | – | V·S | RESTRICTED | module, unit (tick→ms), range, content (Hz) |
| C-51 | nghỉ (chặn) | B NICE / A | V·G | V·G | V·S | V·S+D·U | V·S | –ᴱ | –ᴰ | – | V·S | – | – | –ᴰ | – | – | – | RESTRICTED | module, unit, range, block |
| C-23 | digital write | B MUST | V·G | V·G | V·S | – | V·G+D·U | – | –ᴰ | – | V·S | – | – | –ᴰ | – | – | D·U | RESTRICTED (P0–P2) | module, block |
| C-24 | digital read | B MUST | V·G | V·G | V·S | – | D·U | – | – | – | V·S | – | D·U+D·M | –ᴰ | – | – | – | RESTRICTED (P0–P2, guard) | module, block |
| C-25 | analog read | B MUST | V·G | V·G | V·S | – | D·W | – | – | –ᴱ | V·S | – | D·W | –ᴰ | – | – | – | RESTRICTED | module, block |
| C-27 | servo 180° | A MUST | V·G | V·G | V·S | D·U | D·U | – | –ᴰ | – | V·S | – | – | –ᴰ | – | – | D·U | RESTRICTED (P0–P2) | module, block |
| C-29 | print | B MUST | V·G | – | D·M | – | – | – | – | – | – | – | – | – | – | – | D·M+D·U | ELIGIBLE | — |
| C-30 | biến int | B MUST | V·G | – | – | – | D·M | – | – | – | – | – | – | – | – | – | – | ELIGIBLE | — |
| C-31 | `+ − ×` | B MUST | V·G | – | – | – | D·M | – | – | – | – | – | D·M | D·M | – | – | – | ELIGIBLE | — |
| C-32 | `//` | B MUST | D·M | – | – | – | D·M | – | – | D·M | – | – | D·M | D·M | – | – | – | ELIGIBLE | — |
| C-33 | `%` | B MUST | V·G | – | – | – | D·M | – | – | D·M | – | – | D·M | D·M | – | – | – | ELIGIBLE | — |
| C-34 | so sánh | B MUST | V·G | – | – | – | – | – | – | – | – | – | D·M | – | – | – | – | ELIGIBLE | — |
| C-35 | and/or/not, bool | B MUST | V·G | – | – | – | – | – | – | – | – | – | D·M | – | – | – | – | ELIGIBLE | — |
| C-36 | if/elif/else | B MUST | V·G | – | – | – | – | – | – | – | – | – | – | – | – | – | – | ELIGIBLE | — |
| C-37 | repeat | B MUST | V·G | – | – | – | D·M | – | –ᴰ | – | – | – | – | – | – | – | – | RESTRICTED (`abs(N)` ≤ 10⁶) | — |
| C-38 | while | B MUST | V·G | – | – | – | – | – | – | – | – | – | – | – | – | – | – | ELIGIBLE | — |
| C-39 | count up | B MUST | V·G+D·M | – | – | – | D·M | – | –ᴰ | – | – | – | – | –ᴰ | – | – | D·M | RESTRICTED (§3.3) | — |
| C-56 | text, nối, `str()` | B MUST | V·G | – | – | – | – | – | – | – | – | – | D·M | – | – | – | – | ELIGIBLE | — |
| C-57 | biến `str` | A MUST | V·G | – | – | – | – | – | – | – | – | – | D·M | – | – | – | – | ELIGIBLE | — |
| C-58 | `len()` | A | V·G | – | – | – | D·M | – | – | – | – | – | D·M | –ᴰ | – | – | – | RESTRICTED (ASCII) | — |
| C-59 | hàm (FN) | A MUST | V·G | – | – | – | – | – | – | – | – | – | D·M | D·M | – | – | – | RESTRICTED (FN1–FN10) | — |

Ghi chú:
- `yield`: `–` ở mọi dòng. Trong tập con hỗ trợ không có hoạt động learner thấy được chạy song song: events DEFERRED, âm thanh chỉ dạng chặn, `wait=False` không mở.
- `event`: `–` (§13).
- `default`: `–` khi generator truyền đủ đối số; C-03c/C-50/C-51 phụ thuộc tempo → `–ᴱ` (IM-4).
- C-39 `content` (D·M) = thứ tự đánh giá và giá trị biến đếm theo §3.3, do generator tường minh hoá, không dựa vào thứ tự đối số của MicroPython.
- Mọi construct thuộc `yolobit`/`music` kế thừa simDependent của C-03b/C-03c.

### 15.2 Construct bị loại / hoãn

| ID | Capability | Python (V·G) | Field thiếu / lý do | Kết luận |
|---|---|---|---|---|
| C-03d / C-40 | `random` / `random.randint` | `import random`, `random.randint(1, 6)` | `OF-module` INFERRED (§2.2, §3.5) | **EXCLUDED** (domain đặc tả sẵn để mở lại) |
| C-19 | thời gian chạy | `running_time()` | wrap/reset/khoảng phép trừ UNKNOWN; gốc mâu thuẫn | **EXCLUDED** (LATER) |
| C-05 | hình dựng sẵn | `display.show(Image.HEART)` | provenance | EXCLUDED → C-06 |
| C-70 | chữ số màu 2–8 trong `Image` | `Image("2…")` | `OF-content` mâu thuẫn | EXCLUDED |
| C-11 | độ sáng | `display.set_brightness(n)` | không quan sát được | EXCLUDED |
| C-44 | biểu đồ | `display.show_graph(v, max)` | `OF-content` | EXCLUDED |
| C-45 | tạo màu RGB | helper `colour_rgb` + `round` | float | EXCLUDED |
| C-46 | "hiện thông tin" | `say('Hello')` không import | code không tự đủ | EXCLUDED |
| C-47 | nút A+B | `button_a.is_pressed_ab()` | không được hỗ trợ trong snapshot simulator đã chấp nhận | EXCLUDED |
| C-14 | event nhấn nút | `button_a.on_pressed = f` | gate EV | **DEFERRED** |
| C-17, C-18, C-48 | gia tốc; cử chỉ/lắc; chạm | `accelerometer.get_x()`, `is_gesture`, `is_touched()` | range/trục/tiêu chí | EXCLUDED |
| C-49 | timer | `timer.reset()` không import | code không tự đủ | EXCLUDED |
| C-20, C-21, C-22, C-52, C-60 | giai điệu dựng sẵn; `pitch`; `stop`; tempo learner; tick ≥ 8 / lẻ / tần số số | `music.play(music.ODE)`, `music.pitch(440, 1000)` … | provenance / kết thúc tone / không nhất quán | EXCLUDED |
| C-26 | analog write / PWM | `pin0.write_analog(512)` | `OF-range` | EXCLUDED |
| C-53, C-54 | servo 270/360/release; pull | `servo_write(a, max=270)`, `set_pull` | ngoài tier / thiếu import | EXCLUDED |
| C-28, C-69 | pulse in; siêu âm | `pin0.pulse_in(1)` | `OF-error`, `OF-block` | EXCLUDED / LATER |
| C-55, C-61…C-66 | serial block, float/toán mở rộng, map/constrain/to-number, chờ-đến-khi, break/list, chạy nền, Bluetooth/game/thiết bị | — | domain / non-goal / code không tự đủ | EXCLUDED |
| C-41 | kết thúc program | — | né bằng IM-6 | n/a |

---

## 16. Basic profile eligibility

| Capability | Tier intent | Eligibility | Restriction | Evidence confidence |
|---|---|---|---|---|
| on start | MUST | ELIGIBLE | top level | V·G + D·M |
| forever | MUST | ELIGIBLE | `time.sleep_ms(10)` cuối vòng | V·G + D·M + D·W |
| wait (ms) | MUST | ELIGIBLE | `int` 0..60000 | V·G + D·U + D·M |
| biến (`int`) | MUST | ELIGIBLE | | V·G + D·M |
| số học nguyên `+ − × // %` | MUST | ELIGIBLE | safe-int; chia 0 → lỗi | D·M |
| so sánh | MUST | ELIGIBLE | | V·G + D·M |
| if / elif / else | MUST | ELIGIBLE | | V·G + D·M |
| repeat | MUST | RESTRICTED | `−10⁶ ≤ N ≤ 10⁶` | D·M |
| while | MUST | ELIGIBLE | | V·G + D·M |
| count up | MUST | RESTRICTED | start rồi end, mỗi cái một lần; `0 ≤ start, end ≤ 10⁶`; step literal 1..10⁶ (§3.3) | D·M (+ V·G parity) |
| random int | MUST | **EXCLUDED** | `random.randint` không có evidence trên firmware (§3.5) | — |
| print | MUST | ELIGIBLE | | V·G + D·M + D·U |
| text literal / nối | MUST | ELIGIBLE | chạy chữ: ASCII | V·G + D·M |
| display: hình | MUST | RESTRICTED | hình tự vẽ `0`/`1` | V·G + D·W + V·S |
| display: chạy chữ / số | MUST | RESTRICTED | ASCII; 1 ký tự tĩnh; n ≥ 2: 1200 ms × n (simulator) | V·S + D·U |
| display: xoá | MUST | ELIGIBLE | | V·G + D·U + V·S |
| nút A/B đang giữ | MUST | RESTRICTED | A, B; không A+B | V·G + V·S + D·U |
| số lần nhấn A/B | NICE | RESTRICTED | A, B; reset khi đọc | D·U + V·S |
| âm thanh | MUST | RESTRICTED | nốt chặn C3…C5, 1/2/4 tick @ (4,120); nghỉ; không `pitch`/`stop` | V·G + V·S + D·U |
| ánh sáng | MUST | ELIGIBLE | `int` 0..100 (tooltip) | V·G + D·U + V·S |
| thời gian chạy | NICE | **EXCLUDED** | §7 | — |
| chân digital | MUST | RESTRICTED | P0–P2; ghi 0/1; đọc `== 1`; net hở/xung đột → `out-of-domain` | V·G + D·W + D·U |
| chân analog (đọc) | MUST | RESTRICTED | P0–P2; native 0..4095 (tài liệu OhStem; C-Q6 = A); slider 0–100 %; `int(...)` | V·G + D·W + D·M |
| PWM / analog write | MUST | **EXCLUDED** | khoảng UNKNOWN | — |
| event nút | → Advanced | **DEFERRED** | gate EV | — |

Sẵn sàng theo phase:
- **YB-1:** `ybc-board` (display 5×5 khung renderer, nút A/B, buzzer, ánh sáng, chân P0–P2); contract máy đọc được.
- **YB-2:** ngôn ngữ + `MAX_RANGE_VALUE` / `MAX_REPEAT_ABS` + thứ tự count up.
- **YB-3a:** display theo model đã duyệt (OQ-E).
- **YB-3b:** nút, âm thanh, ánh sáng.
- **YB-4:** digital P0–P2; analog read 0..4095 (C-Q6 = A).

---

## 17. Advanced profile eligibility

| Capability | Tier intent | Eligibility | Restriction | Evidence confidence |
|---|---|---|---|---|
| đặt / tắt điểm, vẽ hình tự do | MUST | RESTRICTED | x, y ∈ 0..4; 8 màu; `Image` `0`/`1` | V·G + D·W + V·S |
| màu | MUST nếu EG đạt | RESTRICTED | 8 màu bảng; `set_all` | V·G + V·S |
| độ sáng | MUST nếu EG đạt | EXCLUDED | không quan sát được | — |
| gia tốc, nghiêng, lắc | MUST | EXCLUDED | range/trục/tiêu chí UNKNOWN | — |
| nhiệt độ | MUST | RESTRICTED | `int(temperature())`, °C; domain hỗ trợ 0..50 (không phải khoảng vật lý) | V·G + D·U + V·S + D·M |
| thời gian chạy / timer | MUST | **EXCLUDED** | §7 (R3) | — |
| biến `str`, nối, `str()` | MUST | ELIGIBLE | plan §6.7 | V·G + D·M |
| độ dài text | MUST | RESTRICTED | chỉ ASCII | D·M |
| hàm | MUST sau gate FN | RESTRICTED | FN1–FN10 DOCUMENTED; test §18.3b ở YB-7 | V·G + D·M |
| event | có điều kiện | **DEFERRED** | gate EV | — |
| nốt, giai điệu | MUST | RESTRICTED | chuỗi C-50/C-51 tự viết | V·G + V·S + D·U |
| servo | MUST | RESTRICTED | 180°, 0..180, P0–P2 | V·G + D·U + V·S |
| random (cho xúc xắc, trò chơi) | (từ Basic) | **EXCLUDED** | §3.5 | — |
| siêu âm / pulse | MUST nếu đo được | EXCLUDED / LATER | — | — |
| chạm, list, biểu đồ | NICE | EXCLUDED | — | — |

---

## 18. Canonical-program parity records

Phiên bản P1–P11 sau YB-0 r2, chỉ dùng construct ELIGIBLE/RESTRICTED. Output OhStem lấy từ block public của editor (EVD-22, EVD-23). Phần `import time` / `from yolobit import *` + preamble được lược. Hình tự đặt: `RING = "11111:10001:10001:10001:11111"`, `CROSS = "10001:01010:00100:01010:10001"`, `DOT = "00000:00000:00100:00000:00000"`, `FULL = "11111:11111:11111:11111:11111"`.

| ID | Program (sau YB-0 r2) | Trạng thái | Construct chặn |
|---|---|---|---|
| P1 | hình `RING`, chờ 1000, chạy chữ `Hi` | SUPPORTED WITH REWRITE | — |
| P2 | A → `CROSS`, B → `RING` (polling) | SUPPORTED WITH REWRITE | — |
| P3 | `DOT` / xoá, mỗi pha 500 ms | SUPPORTED AS PLANNED | — |
| P4 | ánh sáng < 30 → `FULL`, ngược lại xoá | SUPPORTED AS PLANNED | — |
| P5 | nốt chặn `C4 E4 G4`, nghỉ, `C5` (4 tick) | SUPPORTED WITH REWRITE | — |
| P6 | đếm cạnh nhấn A, `print`, chạy số; count up **1..3** (literal, trong domain); `repeat 2` | SUPPORTED AS PLANNED (không dùng random) | — |
| P7 | biến trở P1 > 2048 (thang native 0..4095) → LED P0 bật/tắt | SUPPORTED WITH REWRITE | — |
| P8 | xúc xắc khi lắc, thước thuỷ | **DEFERRED** | gia tốc, lắc, random EXCLUDED |
| P9 | servo P0, count up `angle` 0..180 bước 30 | SUPPORTED WITH REWRITE | — |
| P10 | **viết lại r2:** trò phản xạ **hai người**: procedure `countdown()` (3-2-1 rồi `FULL`), function `winner()` trả `1`/`2` bằng polling A/B; hiện người thắng. Không thời gian chạy, không random | SUPPORTED WITH REWRITE | — |
| P11 | `t = int(temperature())`, chạy số, `t > 30` → `FULL` | SUPPORTED WITH REWRITE | — |

### 18.1 Output OhStem (V·G) và khác biệt dự kiến

**P1–P9, P11:** như r1 (EVD-22), tóm tắt:
- **P1:** `display.show(Image("11111:10001:10001:10001:11111"))`, `time.sleep_ms(1000)`, `display.scroll('Hi')`.
- **P2:** `if button_a.is_pressed(): display.show(Image("10001:…"))` / `elif button_b.is_pressed(): …`.
- **P3, P4:** thân `forever` với `Image`, `display.clear()`, `light_level() < 30`.
- **P5:** `music.play(['C4:4'], wait=True)` … `music.play(['R:4'], wait=True)` … Mình thêm `music.set_tempo(4, 120)` (IM-4), nên mỗi nốt dài 500 ms thay vì 1000 ms ở tempo mặc định `(4,60)` của OhStem. Đây là khác biệt **của program**, không phải lệch ngữ nghĩa.
- **P6:** OhStem `for i in range(1, 4):` và `for count2 in range(2):`. Mình: `range(1, 4)` (cận literal, gập hằng), bộ đếm `repeat` tên `_r1`, biến khởi tạo ở đầu file.
- **P7:** OhStem `pin1.read_analog() > 2048`; mình `int(pin1.read_analog()) > 2048` (thang native 0–4095, C-Q6 = A).
- **P9:** OhStem `for angle in range(0, 181, 30):`. Mình giống hệt (cận literal).
- **P11:** OhStem không nối được block "to number" với nhiệt độ; mình `t = int(temperature())`.

**P10 (r2, EVD-23):**
```python
# Mô tả hàm này...
def countdown():
  global w, result
  display.scroll(3)
  time.sleep_ms(1000)
  display.scroll(2)
  time.sleep_ms(1000)
  display.scroll(1)
  time.sleep_ms(1000)
  display.show(Image("11111:11111:11111:11111:11111"))

# Mô tả hàm này...
def winner():
  global w, result
  w = 0
  while w == 0:
    if button_a.is_pressed():
      w = 1
    elif button_b.is_pressed():
      w = 2
    time.sleep_ms(10)
  return w

while True:
  countdown()
  result = winner()
  if result == 1:
    display.scroll('A')
  else:
    display.scroll('B')
  print(result)
  time.sleep_ms(2000)
  time.sleep_ms(10)
```
Khác biệt: mình chỉ khai báo `global` cho biến toàn cục **bị gán** trong thân (FN4). Vì vậy `countdown` không có `global`, còn `winner` có `global w`. Không có comment tiếng Việt. Hành vi giống nhau.

**Count up có cận side effect (EVD-23):** OhStem sinh `i_end = float(button_a.get_presses())` rồi helper `upRange/downRange` với `float`. Mình sinh `_cu_start_1 = 1`, `_cu_end_1 = button_a.get_presses()`, `for i in range(_cu_start_1, _cu_end_1 + 1):` (§3.3). Cả hai đánh giá cận động đúng một lần. Mình không dùng float và không dùng generator helper.

---

## 19. Known exclusions / restrictions

**Thu hẹp domain (YB-2 trở đi):**
- `MAX_RANGE_VALUE = 10⁶` cho count up: `0 ≤ start`, `end ≤ 10⁶`; `1 ≤ step ≤ 10⁶`. Thứ tự start → end, mỗi cái một lần (§3.3).
- `MAX_REPEAT_ABS = 10⁶`.
- `random` không mở; domain đặc tả sẵn (§3.5).
- Charset chạy chữ ASCII `0x20`–`0x7E`; `len()` chỉ chuỗi ASCII.
- Chân P0–P2; đọc chân hở/xung đột → `out-of-domain`.
- Toạ độ 0..4; 8 màu.
- 15 nốt × {1, 2, 4} tick.
- Servo 0..180.
- Nhiệt độ: domain hỗ trợ 0..50 °C.

**Loại (owner được báo, không cần duyệt từng mục):** random; thời gian chạy và timer; hình/giai điệu dựng sẵn; độ sáng; biểu đồ; A+B; event; gia tốc, cử chỉ, lắc; chạm; `pitch`/`stop`; tempo cho learner; PWM; servo 270/360; `pulse_in`; siêu âm; pull; float và block toán/text mở rộng; list; chạy nền; Bluetooth; game; block thiết bị.

**Lỗi editor OhStem quan sát được** (để không bắt chước): `say()`, `timer.*`, `set_pull` thiếu import; `translate()` không định nghĩa; `is_pressed_ab()` lỗi trong simulator; số trong ô nốt sinh chuỗi không phát; màu ngoài bảng → `undefined`.

---

## 20. Evidence references

Ngày quan sát/truy cập: **2026-10-14**. Vị trí: `%TEMP%\yb0-compat-evidence\out\<file>` (+ `shots/`, `docs/`, `docs/crawl/`). "Editor" = `app.ohstem.vn/#!/codes/yolobit` `?v=20261007130057`. "Sim" = Project Builder → Stem Kit Shield, build `658a5…`.

Cột **"Claim được đỡ"** mã hoá RV-1 (§0.4) và kind của evidence (§21 `EVIDENCE_SCOPE`). Quan sát nằm ngoài cột này **không** được dùng làm nguồn cho bất kỳ field nào.

| ID | Kind | Nguồn / thao tác | Kết quả quan sát | Claim được đỡ | Contract ID |
|---|---|---|---|---|---|
| EVD-01 | GEN | Editor: marker asset, `Blockly.VERSION`, block mặc định (`s01-markers.json`) | `?v=20261007130057`; 8.0.1 | `snapshot` | §1 |
| EVD-02 | GEN + UI | Toolbox: field, dropdown, tooltip (`s01-toolbox.json`, `s02-blocks.json`) | dropdown chân; tooltip đơn vị/khoảng | GEN: `call-shape`; UI: `ui-statement` (đơn vị, khoảng, reset như text nêu) | §5–§12 |
| EVD-03 | GEN | 179 program tối thiểu (`s03-python.json`) | Dạng gọi/import/preamble | `call-shape`, `import-syntax`, `preamble-text` | mọi C-xx |
| EVD-04 | GEN | So text Ace của toggle với đọc programmatic (`s04-image-toggle.json`) | Giống hệt | `method` | §0.3 |
| EVD-05 | GEN | Block hình tự vẽ, từng ô, từng màu (`s04`, `s05-palette.json`) | `Image("r0:…:r4")`; chữ số = chỉ số bảng màu | `encoding` | C-06, §4.4 |
| EVD-06 | SIM | Mốc `print` quanh sleep / show / `pitch` / scroll / clear / `set_pixel` (`s13-vr-timing.json`) | show ≈5 ms; `pitch` ≈1 ms; `HI` 2398 ms; `(0,0)` trên-trái; `(3,1)` hàng 1 cột 3 | `blocking`, `display-transition`, `sim-module` | C-03b, C-06…C-10, C-42 |
| EVD-07 | SIM | Chạy chữ `ABC`, `HELLO`, `A B`, `ab` (`s14-vr-batch-AB.json`) | 3596 / 6001 / 3602 / 2405 ms; 1 cột / ≈200 ms; ô 6 cột | `blocking`, `display-transition` | C-07, C-08 |
| EVD-08 | SIM | Tempo, nốt, nghỉ, `reset`, `get_tempo`, `pitch`+`stop`, giai điệu (`s14` B, `s15` G) | `(4,120)` `:4` ≈500; mặc định `(4,60)`; `'440:4'` không phát; `DB4` 277 Hz | `blocking`, `sound-indicator`, `return-reset`, `sim-module` | C-03c, C-50, C-51 |
| EVD-09 | SIM | Giữ A/B khi polling; 3 click trong sleep; click rồi `is_pressed` (`s15` E, `s14` C2) | đúng lúc giữ; `3` rồi `0`; `False` sau khi nhả | `return-reset` | C-12, C-13 |
| EVD-10 | SIM | In `light_level()`, `temperature()`, gia tốc (`s14` D) | ánh sáng `int`; nhiệt độ float 1 chữ số; gia tốc `0,0,-50`; widget 0–100 | `return-reset` (kiểu trả về). **Không** đỡ `physical-range` | C-15, C-16 |
| EVD-11 | SIM | `running_time()` ×2; số `-7`, `0`, `100`; chữ `'à'` (`s15` F, `s16` J) | giá trị kiểu epoch; 2400 / ~0 / 3602 ms; `KeyError` / ô trống | `blocking`, `display-transition`, `return-reset` | C-07, C-08, C-19 (gốc mâu thuẫn) |
| EVD-12 | SIM | Từng ký tự `0x21`–`0x7E` (`s16` H) | 94/94 hiện, 0 lỗi | `display-transition` | C-07 |
| EVD-13 | SIM | Hình nhiều màu; độ sáng; màu `#123456`; `set_all`; toạ độ ngoài khoảng (`s16` I) | 2→vàng, 6/7→magenta; độ sáng không đổi; ngoài khoảng bị bỏ qua | `display-transition` (toạ độ ngoài khoảng: không dùng làm claim vật lý) | C-70, C-11, C-10, C-43 |
| EVD-14 | SIM | Part "Rotary Analog" cổng A; Home/End widget (`s23-vr-analog.json`) | widget 0–4095; `0`/`4095`; float nhiễu | **Bổ trợ**, không đỡ claim nào (`physical-range`/`electrical` bị cấm) | C-25 (ngữ cảnh) |
| EVD-15 | SIM | Part "Led đơn"; `write_analog` 0…4095 (`s24-vr-pwm-B.json`) | bật/tắt như nhau với mọi giá trị ≠ 0 | không đỡ claim nào | C-26 |
| EVD-16 | SIM | Chương trình s26 (K0–K5, print giữa các bước): `servo_write(P0, 90)` rồi `(P0, 0)`; `read_digital(P1)`; `write_digital(P2, 1)` rồi `read_digital(P2)`; `pulse_in(P1)` chân hở; `is_pressed(A)` (`s26-vr-misc.json`) | servo_write ≈0,4–0,7 ms; `read_digital` in `0` sau +2,4 ms; `write_digital` + `read_digital` in `1` sau +0,24 ms; `is_pressed` in `False` sau +3,8 ms; `pulse_in` → `0` ngay; `read_digital` → `int` 0/1 | `blocking` (OF-block của C-23 `write_digital`, C-24 `read_digital`, C-27 `servo_write`: lời gọi trả về nhanh trong snapshot simulator, simDependent, không phải timing vật lý hay hành vi điện), `return-reset` (kiểu `read_digital`). Đọc lại chân / `pulse_in`: `electrical`, không dùng | C-23, C-24, C-27, C-28 |
| EVD-17 | SIM | Ghi đè khung; `scroll('')`; `get_presses` khi đang giữ (`s28-vr-state.json`) | `Image`/scroll thay toàn khung; `''` không đổi; `1` rồi `0` | `display-transition`, `return-reset` | C-06…C-08, C-13 |
| EVD-18 | WEB | `fw.ohstem.vn` dropdown (`s27-fw.json`) | "Yolo:Bit S3 v1.14", "Yolo:Bit v1.12" | `snapshot` | §1 |
| EVD-19 | SIM | `button_a.is_pressed_ab()` (`s14` C1) | `AttributeError` | `return-reset` (không hỗ trợ trong snapshot) | C-47 |
| EVD-20 | SIM | Nốt `:1 :2 :4 :8`, nghỉ `:2 :8` (`s30-vr-ticks.json`) | 131 / 250 / 500 / **500**; 249 / **500** ms | `sound-indicator`, `blocking` | C-50, C-51, C-60 |
| EVD-21 | SIM | 15 nốt C3…C5 (`s31-vr-notes.json`) | Bảng Hz §8.1 | `sound-indicator` | C-50 |
| EVD-22 | GEN | P1–P11 bản r1 (`s29-canon.json`) | §18.1 | `parity-output` | §18 |
| EVD-23 | GEN | P10 r2 + count up có cận `get_presses` (`canon2.mjs` → `s32-canon2.json`) | §18.1; `i_end = float(button_a.get_presses())` | `parity-output`, `call-shape` | §18, C-39 |
| EVD-24 | SIM | Chương trình s15 E: poll `button_a/b.is_pressed()` + print trong vòng lặp, giữ A rồi B | Dòng poll đầu tiên sau marker 8,1 ms (hai lời gọi + print); poll tiếp tục khi nút đang giữ | `blocking` (OF-block của C-12) | C-12 |
| EVD-25 | SIM | s14 C2: `print(button_a.get_presses())` hai lần liền sau 3 lần click | In `3`, rồi `0` sau ≈0,9 ms | `blocking` (OF-block của C-13) | C-13 |
| EVD-26 | SIM | s14 D: marker `D0`, rồi `print(light_level())`, `print(temperature())` | `80` sau 3,6 ms, `28.0` sau 6,8 ms kể từ marker | `blocking` (OF-block của C-15, C-16) | C-15, C-16 |
| EVD-27 | SIM | s23: một `print` của `read_analog()` trên 11 chân trong vòng lặp `sleep(400)` | Dòng đầu 41 ms sau marker; chu kỳ ≈460 ms | `blocking` (OF-block của C-25) | C-25 |
| EVD-28 | SIM | s16 I: `set_all('#0000ff')` rồi `sleep(500)`, marker I6/I7 | I6→I7 = 499,7 ms | `blocking` (OF-block của C-43) | C-43 |
| DOC-W1 | WEB | https://ohstem.vn/product/may-tinh-lap-trinh-yolobit/ (2023-01-09, sửa 2026-05-16) | "25 đèn LED đa màu, được sắp xếp theo ma trận vuông 5 x 5." | `documented` | §4 |
| DOC-W2 | WEB | https://ohstem.vn/gioi-thieu-ve-do-choi-tri-tue-yolobit/ (2019-09-07) | "Vi điều khiển ESP32 của Espressif (160-240 MHz)"; "Các chân này được đánh số từ P0 đến P20"; P0, P1, P2 "đa chức năng" digital + analog | `documented` | §1, §9 |
| DOC-W3 | WEB | https://ohstem.vn/so-sanh-microbit-va-yolobit/ (2020-07-04) | "5×5 LED đa màu"; "Dual-core 32bit Xtensa LX6, up to 240MHz"; "Cả 2 đều có ra các chân cắm P0, P1, P2, GND và 3V…" | `documented` | §1, §3.2, §4, §9 |
| DOC-W4 | WEB | https://ohstem.vn/bat-led-ngau-nhien-he-toa-do-xy/ (2021-09-21) | "quy ước cột đầu tiên là cột số 0, tiếp theo là cột số 1, 2, 3, 4. Tương tự, ta có hàng số 0, 1, 2, 3, 4"; hình quy ước (xem, không lưu) | `documented` (quy ước toạ độ của display). **Không** dùng để suy `random.randint` (§0.2) | §4 |
| DOC-W5 | WEB | https://ohstem.vn/yolobit-la-gi-cong-cu-hoc-lap-trinh/ (2022-05-01) | "Nền tảng lập trình cho Yolo:Bit chính là OhStem App, có hỗ trợ 2 ngôn ngữ lập trình là kéo thả khối lệnh và MicroPython." | `documented` | §1, C-03a |
| DOC-W6 | WEB | https://docs.ohstem.vn/en/latest/module/cam-bien/goc-xoay.html (wiki 2.0, truy cập 2026-10-14) | "Kiểu tính hiệu: tín hiệu analog (0~4095)"; "Kết nối cảm biến với P0 trên mạch mở rộng."; "có thể kết nối với các chân P0, P1, P2 trên mạch mở rộng"; "chuyển từ giá trị analog 0- 4095 thành 0 - 100%" | `documented` | C-25, §9 |
| DOC-W7 | WEB | https://docs.ohstem.vn/en/latest/module/cam-bien/rotary.html (wiki 2.0) | "Giá trị đọc được là dạng analog (từ 0 đến 4095 đối với Yolo:Bit)" | `documented` | C-25 |
| DOC-M1 | MPY | https://docs.micropython.org/en/latest/library/time.html | `sleep_ms`: "Delay for given number of milliseconds, should be positive or 0. This function will delay for at least the given number of milliseconds…" | `documented` | C-02, C-04 |
| DOC-M2 | MPY | https://docs.micropython.org/en/latest/library/random.html | "randint() and choice() functions are only available if the MICROPY_PY_RANDOM_EXTRA_FUNCS configuration option is enabled." | `documented` | C-03d |
| DOC-M3 | MPY | như trên + https://docs.micropython.org/en/latest/genrst/modules.html | "Return a random integer in the range [a, b]."; "randint method can only return an integer that is at most the native word size."; "getrandbits method can only return a maximum of 32 bits at a time." | `documented` | §3.5 |
| DOC-M4 | MPY | https://docs.micropython.org/en/latest/library/time.html | `ticks_ms()`: "…with an arbitrary reference point, that wraps around after some value." | `documented` (không áp cho `running_time`) | C-19 |
| DOC-M5 | MPY | https://docs.micropython.org/en/latest/esp32/quickref.html | `ADC.read()` "…e.g., 0-4095 for 12-bit resolution." | `context` (không xác lập wrapper Yolo:Bit) | C-25 |
| DOC-M6 | MPY | như trên | "Pins 34-39 are input only"; PWM `duty()` 0-1023 (API `machine.PWM` chung) | `context` | §9, §10 |
| DOC-M7 | MPY | https://docs.micropython.org/en/latest/library/machine.html | `time_pulse_us`: "return -2 if there was timeout waiting for condition … and -1 if there was timeout during the main measurement" | `context` | C-28 |
| DOC-M8 | MPY | https://docs.micropython.org/en/latest/genrst/index.html | "MicroPython implements Python 3.4 and some select features of Python 3.5 and above." | `documented` | §3 |
| DOC-M9 | MPY | https://docs.micropython.org/en/latest/genrst/builtin_types.html | "Range arguments must fit in a machine word; large start or stop values misbehave." | `documented` | §3.2, C-37, C-39 |
| DOC-M10 | MPY | https://docs.micropython.org/en/latest/esp32/quickref.html | "Delay and timing: Use the time module: import time … time.sleep_ms(500) # sleep for 500 milliseconds" | `documented` | C-03a |

> **YB-1 fix turn:** EVD-24…EVD-28 là trace đã thu ở YB-0 (file raw s15, s14, s23, s16), bổ sung vì bản máy đọc được giờ kiểm entry nào được phép đỡ field nào (`establishes`); EVD-16 ghi rõ chương trình s26 K0–K5. Chỉ là timing quan sát trong simulator, không phải timing vật lý.

Ngữ cảnh không dùng làm evidence: các bài MicroPython của `docs.ohstem.vn/en/latest/tutorials/micropython/*` dành cho **xController/xBuild** (board khác), có `pin41.read_analog()` "giá trị kiểu số nguyên (int) nằm trong khoảng từ 0 ~ 4095".

---

## 21. Machine-readable representation (đặc tả cho YB-1)

YB-1 tạo `src/core/compat/yolobit-contract.ts` **từ bản đã freeze**, theo shape dưới. YB-0 **không** tạo file `.ts`. Data thuần (B1, B6), validate bằng Zod.

```ts
// Shape only (YB-1 implements). Values come verbatim from this document.
type ContractLabel = 'VERIFIED' | 'DOCUMENTED' | 'INFERRED' | 'UNKNOWN' | 'n/a';
type EvidenceKind = 'GEN' | 'SIM' | 'UI' | 'WEB' | 'MPY';
type OfField = 'call' | 'import' | 'module' | 'unit' | 'range' | 'default' | 'clamp' | 'round'
             | 'block' | 'yield' | 'return' | 'error' | 'coord' | 'event' | 'content';
type Eligibility = 'ELIGIBLE' | 'RESTRICTED' | 'EXCLUDED' | 'DEFERRED';

// Claim kinds (§0.4, §20). A source may support a claim only if its kind is allowed below.
type ClaimKind =
  | 'call-shape' | 'import-syntax' | 'preamble-text' | 'encoding' | 'parity-output'   // text facts
  | 'ui-statement'                                                                    // tooltip/label text
  | 'documented'                                                                      // public docs
  | 'blocking' | 'return-reset' | 'display-transition' | 'sound-indicator' | 'yield-observed' | 'sim-module'
  // never satisfiable by SIM: 'physical-range' | 'language' | 'electrical' | 'physical-timing'
  //                           | 'firmware-identity' | 'firmware-module'
  | 'physical-range' | 'language' | 'electrical' | 'physical-timing' | 'firmware-identity' | 'firmware-module';

// RV-1 = ACCEPT WITH RESTRICTIONS, encoded as data (frozen):
const EVIDENCE_SCOPE: Record<EvidenceKind, readonly ClaimKind[]> = {
  GEN: ['call-shape', 'import-syntax', 'preamble-text', 'encoding', 'parity-output'],
  UI:  ['ui-statement'],
  WEB: ['documented'],
  MPY: ['documented', 'language'],
  SIM: ['blocking', 'return-reset', 'display-transition', 'sound-indicator', 'yield-observed', 'sim-module'],
};
// Field → claim kinds that can establish it (any one suffices per claim; all claims of a field must be established).
// e.g. 'module' accepts 'documented' | 'language' (builtins/port modules) | 'sim-module' (=> simDependent).
// 'module' never accepts 'import-syntax' (N2).

type EvidenceRef = string;                     // 'EVD-06', 'DOC-W6', …

type Claim = {
  kind: ClaimKind;
  statement: string;                           // what is claimed, verbatim from the contract
  sources: readonly EvidenceRef[];             // non-empty; each source's kind must allow `kind`
  value?: unknown;
};

type FieldEntry =
  | { label: 'VERIFIED' | 'DOCUMENTED'; claims: readonly Claim[] }      // claims non-empty; VERIFIED needs ≥1 GEN/SIM source, DOCUMENTED ≥1 UI/WEB/MPY source
  | { label: 'n/a'; reason: 'not-applicable' | 'domain-restricted' | 'explicit-parameter'; note: string }
  | { label: 'INFERRED' | 'UNKNOWN'; note: string };
// Derived, never hand-written: field.simDependent = some claim whose sources are all kind 'SIM'.

type ModuleContract = {                        // C-03a…d — availability is separate from import syntax (N2)
  id: 'C-03a' | 'C-03b' | 'C-03c' | 'C-03d';
  module: 'time' | 'yolobit' | 'music' | 'random';
  importForm: string;                          // 'import time', 'from yolobit import *', …
  preamble?: readonly string[];                // exact lines (IM-2, IM-4)
  fields: { import: FieldEntry; module: FieldEntry };
  eligibility: Eligibility;
};

// Relational restriction predicates (R1/R2): small, closed AST — no free-form code.
type Term = { arg: string } | { const: number } | { add: [Term, Term] } | { sub: [Term, Term] };
type Pred =
  | { le: [Term, Term] } | { lt: [Term, Term] } | { eq: [Term, Term] }
  | { all: readonly Pred[] }
  | { oneOf: { arg: string; values: readonly (number | string)[] } }
  | { ascii: { arg: string; from: 0x20; to: 0x7e } }
  | { literal: { arg: string } };              // arg must be a compile-time literal

type Domain = {
  args: Readonly<Record<string, 'int' | 'str'>>;
  evaluation?: {                               // R1: explicit order, each exactly once, before the operation
    order: readonly string[];                  // e.g. ['start', 'end']
    once: true;
    checkEach: 'after-own-evaluation';         // runtime guard for an arg runs right after that arg is evaluated
    temporaries: 'unless-all-literal';         // generator emits _cu_start_k/_cu_end_k unless every evaluated arg is a literal
  };
  // A `literal` rule is always checked. Every other rule is checked at compile time only when every arg
  // it references is a literal (non-literal args are covered by `runtime`).
  compileTime: readonly { when: Pred; diagnostic: 'value-out-of-range' | 'descending-range-not-supported'
                                                | 'display-char-unsupported' | 'literal-required' }[];
  runtime: Pred;                               // applied to evaluated values (per `evaluation`); violation => 'out-of-domain'
};

type ConstructContract = {
  id: string;                                  // 'C-39'
  capability: string;
  tier: { 'ybc-basic'?: 'MUST' | 'NICE'; 'ybc-advanced'?: 'MUST' | 'NICE' };
  eligibility: Eligibility;
  modules: readonly ModuleContract['id'][];    // eligible only if every referenced module is eligible
  python?: { form: string; builtins?: readonly ('print' | 'range' | 'str' | 'int' | 'len')[] };
  fields: Readonly<Record<OfField, FieldEntry>>;   // all 15 keys
  domain?: Domain;                             // required when RESTRICTED
  timing?: { blocksMs: string; source: 'SIM-observed' };   // never 'physical'
  presentation?: readonly string[];
  blockedBy?: readonly string[];              // owner/reviewer gate ids; empty in v1.0 (OQ-E, C-Q6 resolved 2026-10-14)
  exclusionReason?: string;                    // required when EXCLUDED/DEFERRED
  preSpecifiedDomain?: Domain;                 // EXCLUDED constructs may carry an inactive domain (C-40)
};

type YolobitContract = {
  contractId: 'yolobit-micropython';
  version: string;                             // '1.0.0' when frozen
  snapshot: { observedOn: '2026-10-14'; editorBuildMarker: '20261007130057'; blocklyVersion: '8.0.1';
              simulatorBuild: string; firmwareListing: readonly string[];
              firmwareExact: 'UNKNOWN'; micropythonVersion: 'UNKNOWN'; statement: string };
  rv1: 'ACCEPT_WITH_RESTRICTIONS';
  evidence: Readonly<Record<EvidenceRef, { kind: EvidenceKind; date: string; source: string; action: string; observed: string;
                                            supports: readonly ClaimKind[] }>>;   // §20 "Claim được đỡ"
  constants: { MAX_RANGE_VALUE: 1_000_000; MAX_REPEAT_ABS: 1_000_000; MAX_RANDOM_ABS: 1_000_000; MAX_RANDOM_SPAN: 1_000_000;
               DISPLAY_CHARSET: { from: 0x20; to: 0x7e } };
  modules: readonly ModuleContract[];
  constructs: readonly ConstructContract[];
};
```

**Domain của C-39 (ví dụ data, frozen):**

```ts
{ args: { start: 'int', end: 'int', step: 'int' },
  evaluation: { order: ['start', 'end'], once: true, checkEach: 'after-own-evaluation', temporaries: 'unless-all-literal' },
  compileTime: [
    { when: { literal: { arg: 'step' } }, diagnostic: 'literal-required' },
    { when: { all: [ { le: [{ const: 1 }, { arg: 'step' }] }, { le: [{ arg: 'step' }, { const: 1_000_000 }] } ] }, diagnostic: 'value-out-of-range' },
    { when: { all: [ { le: [{ const: 0 }, { arg: 'start' }] }, { le: [{ arg: 'start' }, { const: 1_000_000 }] } ] }, diagnostic: 'value-out-of-range' },
    { when: { all: [ { le: [{ const: 0 }, { arg: 'end' }] }, { le: [{ arg: 'end' }, { const: 1_000_000 }] } ] }, diagnostic: 'value-out-of-range' },
    { when: { le: [{ arg: 'start' }, { arg: 'end' }] }, diagnostic: 'descending-range-not-supported' },  // only if both literal
  ],
  runtime: { all: [ { le: [{ const: 0 }, { arg: 'start' }] }, { le: [{ arg: 'start' }, { const: 1_000_000 }] },
                    { le: [{ const: 0 }, { arg: 'end' }] },   { le: [{ arg: 'end' }, { const: 1_000_000 }] } ] } }
// runtime: start checked right after start is evaluated, end right after end is evaluated (checkEach).
// runtime start > end (both in domain) is NOT a violation: 0 iterations (Python range).
```

**Domain đặc tả sẵn của C-40 (không hoạt động):** `runtime: all[ le(−1e6, a), le(a, b), le(b, 1e6), le(sub(b, a), 1e6) ]`, `evaluation.order: ['a', 'b']`.

**Invariant mà test YB-1/YB-5A phải kiểm:**
1. Mọi `ConstructContract`/`ModuleContract` có đủ field (15 / 2 key).
2. Mỗi `Claim`: `sources` không rỗng; mọi source tồn tại trong `evidence`; `kind` thuộc `EVIDENCE_SCOPE[source.kind]` **và** thuộc `evidence[source].supports` (RV-1 + ledger §20).
3. `eligibility ∈ {ELIGIBLE, RESTRICTED}` ⇒ không field nào `INFERRED`/`UNKNOWN`; mọi module trong `modules` có `eligibility ∈ {ELIGIBLE}`; field `module` không bao giờ được đỡ chỉ bởi claim `import-syntax`.
4. `n/a` + `domain-restricted` ⇒ có `domain`; `explicit-parameter` ⇒ `python.form` hoặc preamble module truyền tường minh.
5. `RESTRICTED` ⇒ `domain` có mặt; `EXCLUDED`/`DEFERRED` ⇒ `exclusionReason`, không có `python`.
6. `timing.source` luôn là `'SIM-observed'` cho mọi giá trị đến từ `V·S`.
7. Công tắc `rv1 = 'REJECTED'` (test giả định): claim chỉ có nguồn `SIM` → không đạt ⇒ invariant 3 phải fail cho mọi construct có field simDependent và cho C-03b/C-03c.
8. Construct có `blockedBy` khác rỗng không vào toolbox/template production.
9. Allowlist generator (plan §13.9) = hợp của `python.form`, `importForm`, `preamble`, `builtins` của construct/module được mở.
10. Bộ đánh giá `Pred` là hàm thuần trong core, có test bảng (biên `0`, `10⁶`, `10⁶ + 1`, `−1`), dùng chung cho compiler (literal) và interpreter (runtime).

---

## 22. Decision points, UNKNOWNs, exit checklist

### 22.1 Self-audit r2 (EG cho mọi construct được mở)

| Kiểm | Kết quả |
|---|---|
| Mọi field của mọi construct ELIGIBLE/RESTRICTED ∈ {VERIFIED, DOCUMENTED, n/a, `–ᴰ`, `–ᴱ`} | ✓ (§15.1) |
| Mọi nguồn được phép cho loại claim của nó (RV-1) | ✓ Đã bỏ các claim cũ: khoảng nhiệt độ từ widget; đọc lại chân; khoảng analog từ simulator/ESP32 chung; thời gian chạy |
| **C-03** | Tách theo module. `time`: D·M + D·W (không sim). `yolobit`, `music`: `sim-module` (simDependent). `random`: INFERRED → EXCLUDED |
| **C-19** | EXCLUDED (wrap/reset/khoảng phép trừ UNKNOWN) |
| **C-25** | Khoảng 0–4095 và chân P0–P2: D·W (DOC-W6, DOC-W7); simulator/ESP32 chỉ bổ trợ/ngữ cảnh; `int()` tách riêng. Owner chọn C-Q6 = A: learner dùng thang native |
| **C-39** | Thứ tự tường minh (start → end, mỗi cái một lần, tạm `_cu_*`); domain không âm có quan hệ; mọi trung gian < 2^21 |
| **C-40** | EXCLUDED (`OF-module` INFERRED); domain có quan hệ đặc tả sẵn |
| Mọi field simDependent được liệt kê | ✓ (§15.1 cột cuối, C-03b/C-03c) |
| Program chuẩn chỉ dùng construct được mở | ✓ (§18; P8 DEFERRED) |
| Không copy source/asset độc quyền | ✓ (§0.3, §14) |

Không construct nào được mở còn field bắt buộc UNKNOWN/INFERRED.

### 22.2 Quyết định của owner (đã áp dụng)

| ID | Quyết định (2026-10-14) | Áp dụng ở |
|---|---|---|
| **OQ-E** | **APPROVED:** 5×5 RGB, 0-based, gốc trên-trái, `x` = cột, `y` = hàng, màu hex, mặc định đỏ | §4.3; plan §3 Q5, §7.4, §25 |
| **C-Q6** | **Option A:** analog read native 0–4095, UI 0–100 %, không chuẩn hoá về 0–1023; PWM EXCLUDED | §10.2; plan §3 Q6, §11.3, §25 |

**Không còn quyết định YB-0 nào đang chờ owner.** RV-1 đã được reviewer quyết: **ACCEPT WITH RESTRICTIONS**.

### 22.3 Nếu RV-1 bị thu hồi sau này

Mọi field simDependent thành UNKNOWN. C-03b (`yolobit`) và C-03c (`music`) mất `OF-module`, nên **mọi** construct phần cứng bị loại: display, nút, ánh sáng, nhiệt độ, âm thanh, chân, servo.

Còn lại: C-01, C-02, C-03a, C-04, C-29 và ngôn ngữ (C-30…C-39, C-56…C-59). Test invariant 7 (§21) kiểm kịch bản này.

### 22.4 UNKNOWN còn lại

| UNKNOWN | Loại |
|---|---|
| `random.randint` trên firmware | Không chặn (C-40 EXCLUDED; mở lại khi có evidence) |
| `running_time()` wrap/reset/khoảng | Không chặn (C-19 EXCLUDED) |
| Độ sáng; biểu đồ; màu chữ số 2–8; A+B | Không chặn (EXCLUDED) |
| Gia tốc, cử chỉ, lắc, chạm | Không chặn (EXCLUDED) |
| `pitch` kết thúc/chồng; `stop`; tick ≥ 8 | Không chặn (EXCLUDED) |
| PWM / analog write | Không chặn (EXCLUDED) |
| `pulse_in`, siêu âm | Không chặn (EXCLUDED) |
| Event EV1–EV10 | Không chặn (DEFERRED) |
| Vai trò P3–P20; pull mặc định | Không chặn (P0–P2; net hở → `out-of-domain`) |
| Toạ độ ngoài 0..4; ngưỡng machine-word chính xác | Không chặn (`–ᴰ`; cận 10⁶) |
| `main.py`; firmware chính xác; MicroPython version | Không chặn (`program.py`; snapshot pin) |
| Module `yolobit`/`music` trên firmware vật lý; mọi timing simulator (200 ms/cột, 1200 ms/ký tự, 125 ms/tick); hướng toạ độ trên board thật; `light_level` `int`; nhiệt độ float; analog trên board; debounce/cạnh nút; khác biệt ESP32 / ESP32-S3; độ chính xác `sleep_ms` | **Cần kiểm vật lý** (L3, YB-P) |

### 22.5 Hard gate YB-0 (plan §7.6)

| Tiêu chí | Trạng thái |
|---|---|
| Firmware/snapshot | ✓ |
| Dòng contract + nhãn cho mọi ứng viên | ✓ |
| Không ELIGIBLE/RESTRICTED còn UNKNOWN | ✓ |
| Display xác lập + đề xuất trình owner | ✓, owner đã duyệt (OQ-E APPROVED) |
| Asset / provenance | ✓ |
| Event DEFERRED | ✓ |
| Ngôn ngữ / module | ✓ (§2.2, §3) |
| P1–P11 | ✓ |
| §14, §15, §7.3, §18.7 plan cập nhật | ✓ |
| Không nội dung độc quyền | ✓ (reviewer kiểm) |
| Shape máy đọc được | ✓ (§21) |

### 22.6 Truy vết review (r1 → r2)

| Finding | Mức | Đóng bằng |
|---|---|---|
| R1 — thứ tự đánh giá count up | High | §3.3 (start → end, mỗi cái một lần, tạm `_cu_start_k`/`_cu_end_k`, simulator cùng thứ tự); §21 `Domain.evaluation`; plan §6.5, §18.3 (fixture side effect), YB-5A golden |
| R2 — cận machine-word cho range/random | High | §3.2 (domain API-specific, trung gian < 2^21); C-39 domain không âm có quan hệ; C-37; C-40 domain có quan hệ (đặc tả sẵn); §21 `Pred`; plan §6.4, §6.5, §6.7 |
| R3 — ngữ nghĩa phép trừ thời gian | High | C-19 **EXCLUDED** (phương án C); P10 viết lại không dùng thời gian; plan §14, §15, §18.7 |
| N1 — nguồn evidence analog | Medium | §10.1 thứ bậc: D·W (DOC-W6/W7) xác lập; V·S bổ trợ; D·M ngữ cảnh; `int()` tách riêng; C-Q6 trình bày A/B/C |
| N2 — module/import và fallback RV-1 | Medium | §2.2 tách theo module (`OF-import` ≠ `OF-module`); `simDependent` theo field (§15.1, §21); §22.3 gồm C-03b/C-03c; self-audit → C-40 EXCLUDED |
| N3 — text kiểm `pitch` cũ | Low | plan §18.4 và các tham chiếu cũ (§14, §15, YB-2, YB-4) cập nhật theo nốt/nghỉ chặn |
| RV-1 | — | **ACCEPT WITH RESTRICTIONS**, mã hoá ở §0.4, §20, §21 |

### 22.7 Lịch sử thay đổi

| Version | Ngày | Nội dung |
|---|---|---|
| 1.0-draft | 2026-10-14 | Bản đầu tiên (YB-0) |
| 1.0-draft (r2) | 2026-10-14 | Sửa R1–R3, N1–N3; RV-1 ACCEPT WITH RESTRICTIONS; C-19, C-40 EXCLUDED; P10 viết lại |
| 1.0-draft (r3) | 2026-10-14 | Áp dụng quyết định owner: OQ-E APPROVED (model display cuối); C-Q6 = Option A (analog native 0–4095, UI 0–100 %, PWM EXCLUDED). Không còn quyết định owner đang chờ |
