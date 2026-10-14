# OhStem Yolo:Bit & STEM Simulator — Investigation và đề xuất Basic/Advanced Board

> **Ngày:** 2026-10-13 · **Repo:** `stem-demo`, branch `poc-14-local-persistence` @ `4f9f249` (working tree sạch) · **Loại tài liệu:** điều tra + đề xuất kiến trúc. **Không có implementation** trong thay đổi này.
> **Phạm vi:** bảng mạch cơ bản (Basic Board) và bảng mạch nâng cao (Advanced Board) cho giáo trình STEM/lập trình. Robot simulator là nhánh khác, nằm ngoài phạm vi.
> **Quan hệ với tài liệu khác:** `docs/stem-demo-implementation-plan.md` vẫn là plan của PoC đã xong. Tài liệu này là input cho phase planning tiếp theo, chưa sửa plan. `docs/ohstem-platform-investigation.md` và `docs/ohstem-demo-reconstruction-spec.md` (2026-10-02) là research trước đó về toàn bộ platform OhStem; tài liệu này chỉ đào sâu Yolo:Bit và kiểm chứng lại các điểm liên quan.
> **Cập nhật sau owner review (2026-10-13):** owner đã chốt Q1–Q10 và đổi một số hướng đề xuất. Xem **§0** ngay dưới đây và **§18**. Plan triển khai mới là `docs/yolobit-compatible-board-implementation-plan.md`. Các finding (§2–§8) **giữ nguyên**; các đề xuất bị thay thế (§10–§13, §17) được đánh dấu *superseded*, không bị xoá.
> **Cập nhật sau review độc lập của plan (2026-10-14):** plan v0.2 đóng F1–F9. Bảy điểm có ảnh hưởng tới tài liệu này:
> 1. **Exposure eligibility gate:** construct chỉ được mở khi mọi field quan sát được là VERIFIED hoặc DOCUMENTED; không còn "hành vi an toàn" do simulator chọn.
> 2. **Domain ngôn ngữ:** chỉ số nguyên, không float, chỉ đếm lên.
> 3. **Giới hạn tài nguyên.**
> 4. **Gate event:** không đủ evidence thì hoãn event.
> 5. **Board context resolution.**
> 6. **Asset parity:** identifier ≠ nội dung.
> 7. **L2:** bắt buộc kiểm cú pháp.
>
> Q5 và §18.2 dưới đây đã được làm rõ cho khớp.
> **Ghi chú phương pháp (YB-0, 2026-10-14):** `docs/yolobit-compatibility-contract.md` **không** dùng các quan sát dựa trên bundle/source trong tài liệu này (fingerprint chunk, message type đọc từ source simulator, nhãn "VERIFIED-source") làm evidence. Contract chỉ dùng output Python của program của mình, quan sát hành vi UI/simulator public trong ranh giới RV-1, và tài liệu public (contract §0.3–§0.4). Thang analog 0–1023 ở §18.2 đã được owner thay bằng **C-Q6 = Option A** (2026-10-14): analog read native 0–4095, UI 0–100 % (contract §10.2).
> **Cập nhật sau re-check lần 2 (2026-10-14, plan v0.3):** ghi lại đúng thẩm quyền về display.
> - **Owner** đã duyệt **nguyên tắc** "tương thích ngữ nghĩa với Yolo:Bit > ưu tiên tạm 8×8".
> - **Model display logic cuối chưa được duyệt**: YB-0 xác lập model thật, rồi trình **owner xác nhận lần cuối** trước khi implement capability display (OQ-E của plan). *(Cập nhật 2026-10-14: owner đã xác nhận, **OQ-E APPROVED**: 5×5 RGB, 0-based, gốc trên-trái, x = cột, y = hàng, màu hex, mặc định đỏ; contract §4.3.)*
> - Khuyến nghị của reviewer chỉ là input kỹ thuật, không phải thẩm quyền thay owner.

**Nhãn độ tin cậy**

| Nhãn | Ý nghĩa |
|---|---|
| **VERIFIED** | Quan sát trực tiếp trong phiên này: đọc source `stem-demo`/`STEMLearning`, hoặc thấy trên app.ohstem.vn (UI, DOM, network) |
| **PRIOR** | Lấy từ research 2026-10-02 trong repo, **chưa** kiểm chứng lại trong phiên này |
| **INFERRED** | Suy ra từ evidence gián tiếp mạnh; ghi rõ evidence |
| **UNKNOWN** | Không đủ evidence. Không đoán |
| **OWNER DECISION** | Quyết định của owner sau review, 2026-10-13. Không phải finding |
| **PLANNING DECISION** | Hệ quả kỹ thuật mà người lập plan rút ra từ owner decision; reviewer có thể phản biện |

---

## 0. Owner decisions sau review (2026-10-13) — OWNER DECISION

Phần này ghi lại thay đổi hướng đi so với đề xuất ban đầu (§10–§17). Chi tiết triển khai nằm trong `docs/yolobit-compatible-board-implementation-plan.md`.

| # | Quyết định | Thay thế đề xuất nào trong tài liệu này |
|---|---|---|
| D1 | **Hợp đồng sản phẩm cứng:** với track tương thích Yolo:Bit, chương trình Blockly phải xuất ra được **MicroPython Yolo:Bit thật**, dùng để chạy trên Yolo:Bit vật lý. Không được tự đặt ra một ngôn ngữ riêng chỉ chạy trong STEMLearning | §13.1 coi Python là "cầu nối read-only, nice-to-have" → **sai, đã thay** |
| D2 | Pipeline đích: `Blockly → IR → (simulator runtime \| Yolo:Bit MicroPython generator → .py → Yolo:Bit vật lý)`. Simulator vẫn chạy IR; **cùng ngữ nghĩa** phải map được sang MicroPython Yolo:Bit hợp lệ | §13.2 (thêm generator là nhánh chính thức, không phải view) |
| D3 | **Giữ nguyên `board` generic** và năm template cũ (`blink`, `led-on`, `button-direct`, `button-led`, `empty`) cùng contract nhúng STEMLearning. Không biến `board` thành Yolo:Bit giả | §10.1 nguyên tắc 4 ("mở rộng `board` hiện có") → **superseded** |
| D4 | Tạo **một board family tương thích Yolo:Bit riêng**. **Basic và Advanced là hai curriculum profile** của cùng board family đó, dùng chung semantic model, IR, simulator engine và generator. Hai profile chỉ khác ở capability được mở, block pack, độ phức tạp giáo trình và peripheral/module | §10, §11 (hai board definition) → **superseded** |
| D5 | Runtime chính vẫn là `Blockly JSON → compiler → IR → interpreter → HardwareIO → virtual hardware`. **Không** thêm Pyodide/MicroPython-WASM chỉ để Basic/Advanced chạy được | Khớp §13.1 (giữ A) |
| D6 | **`IR → Yolo:Bit MicroPython` là năng lực MUST.** Python sửa được, Python runtime trong browser, nạp code qua Web Serial/Bluetooth đều là **Later** | §9 (dòng "Xem code text… Nên có"), §10.3 ("Code view: Nice-to-have") → **superseded** |
| D7 | Bắt buộc có phase **YB-0 — Yolo:Bit compatibility contract** trước khi chốt contract triển khai: với mỗi capability định hỗ trợ, quan sát Python mà UI public của OhStem sinh ra (hoặc tài liệu public), ghi API, import, cách khởi tạo, event/polling, timing, độ tin cậy | Mới |
| D8 | Tuyên bố tương thích phải chính xác theo ba mức: *simulator-semantic verified*, *generated-code verified*, *physical-board verified*. Khi chưa có phần cứng, tuyên bố mạnh nhất là: **"Yolo:Bit MicroPython code-generation compatible; physical-board verification pending."** | Mới |
| D9 | Không nhân bản thương hiệu: **compatibility target** (Yolo:Bit MicroPython) tách khỏi **product branding/board artwork** (của mình) | Khớp §8 |

**Hệ quả quan trọng (PLANNING DECISION):**
- Đề xuất "LED onboard trên D13" kiểu Arduino ở §10.2 **không còn phù hợp**. Theo evidence §5.4–§5.5, Yolo:Bit xuất output onboard qua **ma trận LED (`display`)**, không qua một LED đơn trên chân. Basic phải lấy display, nút A/B, âm thanh và ánh sáng làm trục.
- Q5 (ma trận 8×8 một màu) **có thể xung đột** với D1: PRIOR cho thấy Yolo:Bit có ma trận 5×5 RGB. Kết luận cuối do YB-0 đưa ra, kèm khuyến nghị tạm thời (xem §18, Q5). *(Làm rõ 2026-10-14: **owner** đã duyệt nguyên tắc **tương thích ngữ nghĩa > ưu tiên tạm 8×8**; 8×8 không freeze. Model display logic cuối do YB-0 xác lập rồi trình owner xác nhận trước khi implement (plan §7.4, OQ-E). Owner đã xác nhận 2026-10-14: OQ-E APPROVED, 5×5 RGB.)*

---

## 1. Objective

1. Ghi lại chính xác simulator `stem-demo` hiện làm được gì, dựa trên source.
2. Benchmark phần **Lập trình thiết bị → Yolo:Bit** của OhStem ở mức hành vi sản phẩm và kiến trúc quan sát được (không clone, không lấy source/asset).
3. Từ hai nguồn trên, đề xuất **hai cấp board** (Basic, Advanced) trên **cùng một kiến trúc**, xuất phát từ giáo trình chứ không từ danh sách phần cứng.
4. So sánh ba hướng runtime (high-level IR, MicroPython-like, MCU emulation) và chọn một.
5. Xác định phần code giữ lại, phần phải làm mới, MVP và câu hỏi mở cho owner.

---

## 2. Current STEM Simulator state

Tóm tắt: `stem-demo` là PoC **đã xong** (POC-01…14 và S1 theo plan §0). Nó là một editor chạy hoàn toàn trên trình duyệt: dựng mạch 2D bằng chuột, lập trình bằng Blockly, Run để mạch phản ứng. `pnpm verify` xanh trong phiên này: typecheck + lint + **339 unit test / 26 file** (VERIFIED, 2026-10-13). Có 10 spec Playwright trong `e2e/`.

### 2.1 Runtime (VERIFIED)

| Câu hỏi | Trả lời | Evidence |
|---|---|---|
| Frontend stack | React 19.3, Vite 8.3, TypeScript 6.0, Konva 10.7 + react-konva 19.3 (canvas), Blockly 13.3, Zustand 5, Zod 4, Dexie 4.4 (IndexedDB) | `package.json` |
| Simulator loop | **Không có tick toàn cục.** Hướng sự kiện: interpreter async chạy `onStart` một lần, sau đó lặp `forever`, cuối mỗi vòng nhường 10 ms bằng macrotask (E3). Mỗi lần một chân **đổi** mức thì `simulateCircuit` tính lại toàn bộ mạch và `RunSession` phát snapshot. `runStore` gộp snapshot, React nhận tối đa 1 lần mỗi frame (`requestAnimationFrame`) | `src/core/program/interpreter.ts`, `src/core/run/run-session.ts`, `src/ui/state/run-store.ts` |
| State nằm ở đâu | **Design state:** `ProjectDocument` trong Zustand `projectStore`. **Runtime state:** `ActiveRun` trong closure của `RunSession` (`pinOutputs`, `contacts`, `simulation`), không bao giờ vào document (B2). **UI state:** `runStore.snapshot`, cùng selection/drag/dây đang nối là state cục bộ của canvas | `src/ui/state/project-store.ts`, `src/core/run/run-session.ts`, `src/ui/canvas/CircuitCanvas.tsx` |
| Physics engine | **Không có.** Cũng không có solver điện (MNA). Simulation là **logic mức net**: union-find gom port thành net, net có mức `floating` / `high` / `low` / `conflict` | `src/core/simulation/simulate-circuit.ts`, `src/core/circuit/netlist.ts` |
| Worker / WASM / runtime riêng | **Không có.** Mọi thứ chạy trên main thread. Header COOP/COEP đã bật trong dev/preview để chuẩn bị cho track Pyodide sau này, nhưng chưa có consumer | `vite.config.ts` |
| Code learner được thực thi kiểu gì | Blockly serialization JSON → `compileProgram` (hàm thuần, không import Blockly) → IR nhỏ → `runProgram` (interpreter duyệt cây, async). Không sinh code text, không `eval`, không Python | `src/core/program/compile-program.ts`, `ir.ts`, `interpreter.ts` |

### 2.2 Board model hiện có (VERIFIED)

**Catalog device** (`src/core/devices/definitions/*.json`, validate bằng Zod trong `device-definition.ts`, đăng ký ở `local-catalog.ts`):

| Device id | Port | Simulation model | Renderer |
|---|---|---|---|
| `board` ("STEM Board", thân 220×300) | `3v3` (power), `gnd` (ground), `d2`…`d13` (gpio) | `board`: khi được cấp nguồn thì drive `3v3` HIGH, `gnd` LOW, và các chân mà program đã ghi | Chưa có renderer riêng → **GenericRenderer** (hình chữ nhật xám + tên) |
| `led` | `anode`, `cathode` | `led`: `lit` ⇔ net anode `high` và net cathode `low` | `LedRenderer` |
| `resistor` | `a`, `b` | `resistor`: luôn dẫn a–b (bỏ qua giá trị điện trở) | Generic |
| `push-button` | `a`, `b` | `contact`: dẫn a–b khi đang được giữ (runtime input) | `PushButtonRenderer` |

**Template `button-led`** (`src/samples/button-led.project.json`) thực chất gồm:
- mạch: Board + Push Button + Resistor + LED; dây `3V3 → button.a`, `button.b → D2`, `D13 → R → LED.anode`, `LED.cathode → GND`;
- program: `forever { if (digital read D2) { digital write D13 HIGH } else { digital write D13 LOW } }`.

Các câu hỏi cụ thể:

| Câu hỏi | Trả lời |
|---|---|
| Button input | Nút là device ngoài, có model `contact`. Khi đang Run, người dùng **giữ chuột** trên nút: canvas gọi `onContactChange` → `runStore.setContactInput` → `RunSession.setContactInput` → simulate lại. Không có nút onboard |
| LED output | LED là device ngoài. Renderer chỉ đọc `runtimeState.lit` từ snapshot; không tự tính |
| Pin/state representation | Chân có **tên** (`D13`) map sang port (`d13`) qua `board.pins`. Runtime giữ `pinOutputs: Record<pinName, 0 \| 1>`. Kết quả có `nets[].level`, `components[id] = { lit?, closed? }`, `pinReads[pinName]` |
| Wiring | `Wire { id, from: PortRef, to: PortRef }`, `PortRef = { componentId, portId }`. Vị trí port suy ra từ definition (B7, `geometry.ts`). Không có rotation, bendpoint, breadboard |
| GPIO abstraction | Có, ở mức tối thiểu: `HardwareIO { digitalWrite(pin, level); digitalRead(pin) }` là đường **duy nhất** từ program tới phần cứng ảo (B5). Chế độ chân suy ra ngầm. **Không có** analog, PWM, tone, `configurePin`, pull-up |
| Board definition/schema | Có: `DeviceDefinition.board.pins` là "board profile". Nhưng **chỉ có một loại board**: `main.tsx` hard-code `registry.get('board')` để lấy danh sách chân cho Blockly, và `registerBlocks` chỉ đăng ký block một lần cho cả app (cờ `blocksRegistered`). `RunSession.start` đòi đúng một board trong mạch (`no-board` / `multiple-boards`) |

### 2.3 Programming model (VERIFIED)

| Câu hỏi | Trả lời |
|---|---|
| Learner viết gì | **Chỉ Blockly.** Toolbox (`src/core/program/blocks.ts`): Events (`on start`, `forever`), Pins (`digital write <pin> <HIGH/LOW>`, `digital read <pin>`), Logic (`if`, `if/else`, `not`), Time (`wait <n> seconds`). Không có biến, số, phép so sánh, vòng lặp đếm, hàm, text, console |
| Block / JS / Python / custom? | Block là nguồn duy nhất. Không có view code text |
| Simulator nhận program dạng gì | Blockly serialization JSON lưu ở `document.program.blocks`. Compiler kiểm tên chân theo board profile, báo lỗi kèm `blockId` trước khi chạy (C1–C8) |
| Parser/interpreter ở đâu | `src/core/program/compile-program.ts` (JSON → IR), `ir.ts`, `interpreter.ts` (IR → `HardwareIO`) |
| Execution lifecycle | Run → `BlocklyPanel.saveNow()` → `runStore.run(document)` → `RunSession.start`: kiểm đúng 1 board → compile → cấp nguồn + simulate lần đầu → `running` → interpreter. Program chạy xong thì `finished` nhưng board **vẫn được cấp nguồn** (E6). Lỗi runtime → `error` kèm `blockId` (E7) |
| Start / Stop / Reset | Có **Run** và **Stop**. Stop huỷ ngay (AbortController), kể cả đang `wait`; mọi runtime state bị xoá, canvas về trạng thái thiết kế. **Không có Reset riêng** (Stop chính là reset), không có Pause/Step. Khi đang chạy thì khoá sửa mạch/palette/New; Blockly vẫn sửa được nhưng chỉ áp dụng ở lần Run sau |
| Loop/tick | `forever` + nhường 10 ms mỗi vòng. Snapshot chỉ phát khi có thay đổi |
| Event | **Không có event.** Đọc chân theo kiểu polling, như MCU không có interrupt (plan §6.4). Không có "khi nút được nhấn" |
| Delay/timing | `wait` (giây, field số) dùng `setTimeout` huỷ được. Số đo trong Learning log: Run → LED ~9 ms, Stop khi đang wait 15–26 ms, blink lệch < ±50 ms, nhấn → LED qua `if` median 36,5 ms |

### 2.4 STEMLearning integration (VERIFIED, đọc source cả hai repo)

| Câu hỏi | Trả lời | Evidence |
|---|---|---|
| Contract nhúng | URL: `<base>/?embed=1&template=<key>`. Key hợp lệ: `blink`, `led-on`, `button-direct`, `button-led`, `empty`. URL hỏng (key lạ, thiếu, lặp) → màn hình lỗi, không mở project nào | `stem-demo/src/ui/app/launch.ts`, `src/samples/templates.ts`, `LaunchError.tsx` |
| StemLab activity truyền gì | `StemLabSettings { simulatorKey: "stem-studio", templateKey, launchOptions (map string, tối đa 20, "reserved"), instructions (Markdown) }`. Content chỉ lưu **key**, không lưu URL hay document của simulator (D-7). Completion mode của StemLab là `OnView` | `STEMLearning/Services/CourseService/Entities/ActivitySettings.cs`, `Features/Activities/StemLabRules.cs`, `Features/ActivityTypes.cs` |
| Ai dựng URL | Student Web `features/courses/stemLab.ts` (`launchUrl`) và CMS `Web/AdminCms/Features/StemLab.cs` dùng **cùng một quy tắc**: `embed=1`, `template=<key>`, rồi các launch option có giá trị. Base URL là cấu hình môi trường (`stem-simulator-url`, mặc định `http://localhost:5173`, trong Aspire AppHost) | `STEMLearning.AppHost/AppHost.cs` |
| Iframe | `<iframe sandbox="allow-scripts allow-same-origin" allow="camera 'none'; microphone 'none'; geolocation 'none'">`, kích thước cố định 1100×640, scale theo bề rộng. Có kiểm tra simulator còn sống bằng `fetch` `no-cors`, nút "Start the lab again" load lại iframe | `STEMLearning/Web/StudentWeb/src/features/courses/activities.tsx` |
| State/session lifecycle | Mỗi lần load iframe = một lab mới từ template. Lab **không đọc, không ghi** IndexedDB (`saveTo: null`); reload là về lại template. Không truyền learner identity. Bài làm không được lưu (D-17) | `stem-demo/src/ui/app/startup.ts`, `main.tsx` |
| Giao tiếp hai chiều | **Không có.** Chỉ một chiều qua launch URL. `stem-demo/src` không có `postMessage` hay listener `message`. `launchOptions` bị simulator bỏ qua. Không có event `ready` / `runStarted` / `runCompleted`, không có chấm bài | grep `postMessage` trong `src` = 0 |

**Hệ quả cho board mới:** template key là public contract (lesson content lưu nó), nên các key cũ phải tiếp tục mở được. Bài học mới cho Basic/Advanced Board chỉ cần thêm key. Muốn chấm bài hay báo hoàn thành thì cần thêm kênh `postMessage`; việc đó đã được hai repo ghi là "sau PoC".

---

## 3. Current architecture

```text
            ┌─────────────── src/ui (React) ───────────────┐
 Palette ──►│ CircuitCanvas (react-konva)   BlocklyPanel    │
            │    ▲ snapshot (≤1/frame)        │ Blockly JSON│
            │    │                            ▼             │
            │ runStore ◄──────────────── projectStore ──► autosave → ProjectRepository (Dexie)
            └────┬──────────────────────────────────────────┘
                 │ run(document) / stop / setContactInput
            ┌────▼──────────── src/core (TS thuần, B1) ─────────────┐
            │ RunSession ── compileProgram ──► IR ──► interpreter     │
            │     ▲                                     │ HardwareIO │
            │     └──── simulateCircuit ◄── pinOutputs ◄┘ (digital)  │
            │              │ netlist (union-find) ◄── DeviceRegistry │
            └────────────────────────────────────────────────────────┘
```

### 3.1 Phân loại

| Loại | Có khớp không | Evidence |
|---|---|---|
| A. Hardware/MCU emulator | **Không.** Không có CPU, firmware, register, tập lệnh | Không có code nào kiểu đó trong `src/` |
| B. Circuit state simulator | **Có một phần.** Mạch do người dùng tự nối, netlist union-find, mức logic theo net, LED sáng theo hai đầu net | `netlist.ts`, `simulate-circuit.ts` |
| C. Educational API simulator | **Có một phần.** Ngôn ngữ khối riêng → IR → interpreter, chạm phần cứng chỉ qua API mức chân `HardwareIO` | `compile-program.ts`, `interpreter.ts` |
| **D. Hybrid** | **✓ Kết luận: D = B + C.** Program là educational API simulator; phần cứng là circuit state simulator mức logic. `RunSession` là chỗ duy nhất nối hai nửa | `run-session.ts` |

### 3.2 Board giống Yolo:Bit có mở rộng trực tiếp được không?

**Không trực tiếp, nhưng không cần viết lại.** Cần thêm một lớp abstraction ở giữa, còn các seam chính vẫn đứng vững.

Lý do không trực tiếp (mỗi điểm là một chỗ cụ thể trong source):
1. **Không có khái niệm thiết bị onboard.** Board hiện chỉ là một hàng chân. Một board kiểu Yolo:Bit có LED, nút, loa, cảm biến gắn sẵn mà learner dùng **theo tên** ("nút A", "loa"), không phải theo dây nối. `DeviceDefinition.board` chỉ có `pins`.
2. **`HardwareIO` chỉ có digital.** Không có analog read, PWM, tone, hay API cho thiết bị không đi qua chân (ma trận LED, gia tốc kế).
3. **Simulation chỉ có 4 mức logic.** Không biểu diễn được giá trị analog, duty PWM hay tần số.
4. **IR quá nhỏ cho giáo trình.** Không có số, biến, so sánh, vòng lặp đếm, text, event "khi nhấn nút".
5. **Chỉ một board.** `main.tsx` hard-code `'board'`; Blockly đăng ký block một lần với một danh sách chân cố định.
6. **Runtime input chỉ có "giữ nút".** Không có thanh trượt cho cảm biến, không có nghiêng/lắc.
7. **Board chưa có renderer riêng** (đang dùng GenericRenderer).

Phần **đứng vững** và tái sử dụng được:
- `RunSession` là nơi duy nhất nối program với simulation (B5). Thêm input, event hay peripheral đều đi qua đúng chỗ này, như plan §6.4 đã dự đoán (`notifyInputsChanged`).
- Compile từ Blockly JSON sang IR, có diagnostics trước khi chạy (B4). IR không persist nên đổi thoải mái.
- Simulation là hàm thuần trên document và runtime input (B3). Device là data, renderer/model tham chiếu bằng id (B6).
- Push button đã chứng minh chi phí thêm một device nhỏ (L6, Learning log M3).

→ **Cần thêm runtime/abstraction layer:** board profile có thiết bị onboard và capability của chân; `HardwareIO` mở rộng theo capability; simulation mức tín hiệu (signal-level); IR v1. **Không cần** lớp giả lập MCU. Chi tiết ở §13 và §14.

---

## 4. OhStem investigation method

| Mục | Giá trị |
|---|---|
| Ngày | 2026-10-13 |
| URL | `https://app.ohstem.vn/` (build marker `?v=20261007130057`; build của simulator `static/gears` `658a5c2ea03841e0`) |
| Browser | Playwright 1.63 (dùng read-only từ `node_modules` của repo), Chromium bundled (`chromium-1243`), headless, viewport 1440×900, locale `vi-VN`. Một số lần chạy thêm `--use-angle=swiftshader` để có WebGL; một lần chạy headed |
| Auth | **Không đăng nhập**, không tạo tài khoản, không lưu/chia sẻ/xuất project lên cloud |
| Người thực hiện | (1) Subagent Sonnet: khám phá UI, đọc toolbox, dựng program, đo network, đọc bundle trong bộ nhớ (69 tool call). (2) Main agent: đọc lại report, xem screenshot, rồi **tự chạy một script kiểm chứng** các claim quan trọng nhất (`scripts/main-verify.mjs`, xem §6) |
| Đã thử thật | Điều hướng landing → Yolo:Bit → Lập trình; mở mọi category của toolbox; load một program nhỏ; chuyển Block → Python; bấm Run, Stop, USB, Bluetooth khi không có thiết bị; mở Thiết bị ảo → Project Builder, đặt Grove Shield và Stem Kit Shield, lập trình, bấm Chạy ở tab Giả lập |
| Can thiệp vào page | Toolbox được đọc qua `Blockly.getMainWorkspace().getToolbox()`. Program được nạp bằng `Blockly.Xml.domToWorkspace`, vì một lần kéo thả thật thả block ra workspace nhưng không gắn vào `bắt đầu`. Probe bằng init script chỉ bọc (không đổi hành vi) `WebAssembly.*`, `Worker`, `WebSocket`, `navigator.serial/bluetooth/usb`, `postMessage` |
| Bundle JS | Tải trong bộ nhớ để tìm fingerprint (tên module, tên message, version). Không lưu file nào của OhStem xuống đĩa; chỉ trích vài từ khoá |
| Không làm được | Không có thiết bị thật: chooser Web Serial/Bluetooth không hoàn tất. Ở tab Giả lập, canvas 3D vẫn tối và program không được gửi vào simulator (xem §5.7). Chưa vào Circuit Builder, Map Builder, `pin-io`, `draw-run`, bài học |
| Lưu ý bảo mật | Bundle chính chứa một chuỗi trông như GitHub token (giống research 2026-10-02). Không ghi lại giá trị |

---

## 5. OhStem/Yolo:Bit observations

### 5.1 UI (VERIFIED)

- **Menu chính:** Lập trình thiết bị, Thiết bị ảo, Cuộc thi, Thí nghiệm khoa học, Bảng điều khiển IoT, Mô hình AI, Lập trình AI, Khóa học online. Thiết bị: Yolo:Bit, xBot, Yolo UNO, Rio, Tay cầm điều khiển, Camera AI… (`01-landing`).
- **Hub Yolo:Bit** (`#!/devices/yolobit`): ba thẻ **Bài học**, **Lập trình**, **Gamepad** (`02-yolobit-hub`).
- **Editor Yolo:Bit** (`#!/codes/yolobit`, `03-codes-yolobit`):
  - bên trái là toolbox dạng category màu; giữa là workspace Blockly;
  - thanh trên: công tắc Block ⇄ Python, ô tên project, các nút Lưu, Thư mục, Cài đặt, Bluetooth, USB;
  - góc dưới phải: nút Chạy (xanh) và Dừng (đỏ);
  - **không có board ảo, không có preview, không có nút ảo.** Các nút không có `title`/`aria-label`.
- **Menu phụ của editor** (DOM text): Hiện cửa sổ thông tin, Bật nhập lệnh (terminal), Bật tài liệu, Bật biểu đồ, Lưu project vào thiết bị, Cập nhật thư viện mở rộng, Cập nhật firmware (→ `fw.ohstem.vn`), project mẫu, chia sẻ, export/import.
- **Project mẫu** (là gợi ý về giáo trình): Trái tim nhấp nháy, Bảng tên học sinh, Máy phát nhạc, Lắc xúc xắc, Di chuyển tới và lui, Di chuyển né vật cản, Dò line, Điều khiển bằng gamepad.
- **Thiết bị ảo → Project Builder** (`13`, `16`, `24`): đây là môi trường 3D với ba tab **Thiết kế / Lập trình / Giả lập** và ba mức **Nhí / Cơ bản / Nâng cao**. Thư viện "Điện tử" có Robot Rover, ORC K1, ORC K2, ORC Control Hub, Yolo UNO, Grove Shield, Stem Kit Shield. Tab Lập trình có nút Block, Python, C ("chỉ hỗ trợ Yolo UNO và ORC Control Hub"), Bluetooth, Web Serial, cùng một terminal (`18`). Tab Giả lập có nút Chạy và một "HUB PANEL" (`29`).

### 5.2 Programming modes (VERIFIED)

| Kiểu | Có cho Yolo:Bit? | Evidence |
|---|---|---|
| Block (Blockly) | **Có.** Blockly `8.0.1` (`Blockly.VERSION`, main agent đọc lại) | `03`, `08` |
| Python (MicroPython) | **Có**, dạng text trong Ace editor, sinh từ block | `09` |
| JavaScript | Không thấy đường vào trên UI cho Yolo:Bit (dù `javascript_compressed.js` có được tải) | — |
| C | Không cho Yolo:Bit. Tooltip ghi C chỉ cho Yolo UNO và ORC Control Hub | `14` |
| Arduino/C++ | Không thấy trong app | — |

### 5.3 Blocks ↔ code (VERIFIED, trừ chỗ ghi khác)

- **Block là nguồn, Python là sản phẩm sinh ra** ở client. Bật công tắc thì thấy code; không có request nào lên server.
- Code sinh ra cho program thử (verbatim, là output của chính program mình dựng):

  ```python
  import time
  from yolobit import *
  button_a.on_pressed = None
  button_b.on_pressed = None
  button_a.on_pressed_ab = button_b.on_pressed_ab = -1
  import music

  if True:
    display.show(Image.HEART)

  while True:
    if button_a.is_pressed():
      display.scroll('Hi')
      music.play(music.DADADADUM, wait=False)
    time.sleep_ms(10)
  ```

- Nhận xét:
  - Block `bắt đầu` sinh ra `if True:`, block `lặp lại mãi` sinh ra `while True:`. Mỗi vòng `forever` kết thúc bằng `time.sleep_ms(10)`, **cùng ý tưởng với E3 của `stem-demo`** (nhường 10 ms).
  - Code tuần tự, **không phải asyncio**.
  - API theo phong cách micro:bit MicroPython: `display`, `Image`, `button_a`, `music`.
- **Mặc định:** workspace mới có đúng một block `yolobit_basic_forever` (hai ngăn `bắt đầu` / `lặp lại mãi`).
- **Chưa kiểm:** sửa Python có quay ngược về block được không (UNKNOWN trong phiên này; PRIOR ghi là không, có hộp thoại cảnh báo).
- **Chưa kiểm:** code sinh ra từ event block `khi nút được nhấn` (UNKNOWN).

### 5.4 Board capabilities được expose cho learner (VERIFIED từ toolbox live)

Phân loại: **A** onboard hardware · **B** linh kiện/peripheral ngoài · **C** cấu trúc lập trình · **D** giao tiếp.

| Category (UI) | Nội dung (theo block type) | Loại |
|---|---|---|
| Cơ bản | hiện số/chữ chạy, hiện hình (hình có sẵn như HEART hoặc ma trận tự vẽ, mỗi ô một màu `#rrggbb`), chờ (ms), xoá màn hình, `bắt đầu / lặp lại mãi` | A (hiển thị), C |
| Ngõ vào | nút A/B đang nhấn, số lần nhấn, **sự kiện khi nhấn nút**, chân cảm ứng, cử chỉ, lắc (độ nhạy 10–50), thời gian chạy, timer, **nhiệt độ**, **ánh sáng**, **gia tốc kế** | A |
| Âm nhạc | bài nhạc có sẵn, nốt, nghỉ, dừng, phát tần số (Hz, ms), tempo | A (buzzer) |
| LED | đặt màu điểm (cột, hàng), xoá điểm, đặt tất cả, vẽ biểu đồ, độ sáng, màu RGB | A (ma trận LED RGB) |
| Bluetooth | kết nối, gửi số/chuỗi/cặp tên–giá trị, sự kiện nhận, kết nối/ngắt, tin nhắn app gamepad | D |
| Vòng lặp | chờ đến khi, lặp N lần, while/until, for, for-each, break/continue | C |
| Logic | if (4 biến thể), so sánh, and/or, not, true/false | C |
| Biến | biến động (Blockly variables) | C |
| Tính toán | số, chuyển số, + − × ÷, hàm toán, làm tròn, chia dư, giới hạn, random, `map` | C |
| Chữ viết | text, nối, độ dài, cắt, đổi hoa/thường, in ra serial | C |
| Nâng cao → Hàm | định nghĩa hàm có/không trả về | C |
| Nâng cao → Serial | ghi chuỗi/số/dòng/biểu đồ ra serial (block type có prefix `xbot_` dù nằm trong toolbox Yolo:Bit) | D (USB) |
| Nâng cao → Danh sách | list đầy đủ | C |
| Nâng cao → Game | sprite trên ma trận LED (tạo, di chuyển, nảy, va chạm, điểm, đếm ngược) | A + C |
| Nâng cao → **Chân cắm** | đọc/ghi digital, đọc/ghi analog, `pulse_in`, **servo 180/270/360**, nhả servo, pull-up/down, chân cảm ứng | A + B |
| Nâng cao → Thiết bị | tên thiết bị, serial, đọc terminal, chạy nền, reset | A |
| Mở rộng (chỉ tên) | Robot Rover, Robocon, AIoT Kit, Camera AI, STEM Starter Kit, Home:Bit, Plant:Bit, City:Bit, Car:Bit, Robot Arm, cảm biến màu, DHT, siêu âm, OLED I2C, NeoPixel, driver động cơ I2C, MQx, relay, LED 7 đoạn, ma trận 16×8, TFT LCD, IR receiver, keypad cảm ứng, MQTT, HTTP, NTP, Blynk, "Sự kiện"… (danh sách lấy từ `extensions.json` public trên S3) | B / D |

Không thấy trong core: block I2C thô, la bàn, radio (chỉ có Bluetooth), Wi-Fi (chỉ qua extension MQTT/HTTP/NTP). Kích thước ma trận không ghi trong text của block. PRIOR (2026-10-02) ghi là **5×5**.

### 5.5 Inputs/outputs

- **Output onboard:** ma trận LED RGB (hình, chữ chạy, điểm, độ sáng, biểu đồ, game) và buzzer (nhạc, nốt, tần số).
- **Input onboard:** nút A/B (trạng thái, số lần nhấn, sự kiện), chân cảm ứng, cử chỉ/lắc, gia tốc kế, nhiệt độ, ánh sáng, timer.
- **Chân và linh kiện ngoài:** chỉ nằm sau **Nâng cao → Chân cắm** (digital, analog, servo, pulse) và **Mở rộng** (module theo kit).
- **Ý nghĩa cho thiết kế:** giáo trình Yolo:Bit đi theo kiểu **onboard trước**, gọi phần cứng theo tên. Nối chân và module ngoài là bước nâng cao. Learner **không nối dây** trong editor.

### 5.6 Run / Stop / Reset

- **Editor Yolo:Bit** (VERIFIED, main agent chạy lại):
  - bấm **Chạy** khi chưa có thiết bị → gọi `navigator.bluetooth.requestDevice` với service Nordic UART (`6e400001-b5a3-f393-e0a9-e50e24dcca9e`);
  - bấm **USB** → `navigator.serial.requestPort({})`;
  - không có toast hay dialog trong DOM; không có worker; không có request nào ngoài analytics.

  → **Run trong editor nghĩa là "chạy trên board thật"**. Không có thiết bị thì không có gì chạy.
- **Project Builder** (VERIFIED trong source; **chưa thấy chạy**): Run → `sendCode(code, boardKey, boardLibs, …)` → `postMessage` `RUN_CODE` vào iframe simulator. Stop → `STOP_CODE`. Có thêm message `RESET_SIM`, `SET_BOARD_BUTTON` (nút ảo), `SET_ACCEL_VALUE` (gia tốc kế ảo), `SET_WIDGET_VALUE`, `PORT_STATE_UPDATE`. Timing và cách reset state: UNKNOWN.

### 5.7 Virtual-device behavior

| Câu hỏi | Trả lời | Nhãn |
|---|---|---|
| Editor Yolo:Bit có board ảo không? | **Không.** Không có preview, không có nút ảo. Chunk editor (`js/888.*`) có cờ `isSimulatorVisible` (4 chỗ) và chuỗi "Simulator visible - bypassing device connection", nhưng cờ không được bật từ UI Yolo:Bit | VERIFIED (UI + main agent đếm fingerprint) |
| Có Yolo:Bit ảo ở đâu khác không? | **Có, trong Thiết bị ảo → Project Builder**, nhưng không có tile nào tên "Yolo:Bit". Registry board (`js/3576.*`) có `YOLOBIT` làm board gốc (`parentBoard`) của **Grove Shield**, **Stem Kit Shield**, **Robot Rover**. Đặt Grove Shield hoặc Stem Kit Shield thì tab Lập trình dùng đúng toolbox `yolobit_*` và sinh đúng Python như editor | VERIFIED (UI + registry) |
| Board ảo chạy bằng gì? | Iframe `static/gears/index.html`: Babylon.js 8.51.2 (WebGL2) + Havok physics (WASM), Skulpt, `pyodideEngine.js` → `pyodideWorker.js` (Pyodide 0.29.3 từ jsdelivr). Chạy **thư viện firmware Python thật của Yolo:Bit** (25 file dưới `/static/gears/firmware/yolobit/`, ví dụ `display.py`, `button.py`, `music.py`) trên một `machine.py` giả (`/static/gears/override/machine.py`, `import simPython`). Main agent xác nhận các file này trả về 200 | VERIFIED (file, source); thực thi: UNKNOWN |
| Render bằng gì? | Board là **model 3D** (WebGL qua Babylon). Ma trận LED, nút ảo, nhãn chân trên board 3D: **UNKNOWN** (không thấy được output) | VERIFIED / UNKNOWN |
| Đã thấy program chạy trên board ảo chưa? | **Chưa.** Bấm Chạy thì nút chuyển sang dừng, nhưng canvas 3D vẫn tối, "HUB PANEL: No widgets configured", và không có `RUN_CODE` nào tới iframe. Theo source, code được giữ trong hàng đợi cho tới khi scene báo đã load, và scene không bao giờ báo. Nguyên nhân (môi trường headless/swiftshader, hay cần chọn map/world trước) UNKNOWN | VERIFIED (không chạy) |
| Gắn linh kiện ngoài? | Trong Project Builder có thư viện part 3D (cảm biến, động cơ…), nhưng **không có nối dây kiểu mạch điện** | VERIFIED (UI) |

### 5.8 Network/runtime observations

| Câu hỏi | Trả lời | Nhãn |
|---|---|---|
| Thực thi client-side hay server? | Sinh code ở client. Run trên thiết bị thật không gửi gì lên server (đi thẳng BLE/Serial). Ở Project Builder, simulator chạy trong iframe cùng origin | VERIFIED |
| Run gửi request gì? | Editor: không request nào (ngoài analytics), chỉ gọi device API. Project Builder: `postMessage` vào iframe (theo source) | VERIFIED / VERIFIED-source |
| Compile ở đâu? | Không có bước compile; Blockly sinh Python text ở client | VERIFIED |
| Asset/runtime simulator | `app.ohstem.vn/static/gears/**` (Babylon, Havok WASM, Draco WASM, firmware `.py`, part model); Pyodide từ `cdn.jsdelivr.net/pyodide/v0.29.3/` (đọc trong `pyodideWorker.js`; chưa thấy request vì program chưa chạy); `extensions.json` từ `ohstem-public.s3.ap-southeast-1.amazonaws.com`; `mqtt.min.js` từ cdnjs | VERIFIED |
| Worker | Editor: không có. Project Builder: blob worker trong iframe | VERIFIED |
| WASM | Editor: không có. Project Builder: `HavokPhysics.wasm`, Draco decoder | VERIFIED |
| WebSocket | Không thấy | VERIFIED |
| WebSerial / WebBluetooth / WebUSB | Web Serial và Web Bluetooth (Nordic UART) **có**. WebUSB không thấy được gọi | VERIFIED |
| Header | Document chính: COOP `same-origin`, COEP `credentialless`, **không có CSP**; `crossOriginIsolated === true` (main agent đọc lại). Đây là điều kiện để worker Pyodide dùng `SharedArrayBuffer` + `Atomics.wait` cho `time.sleep` đồng bộ. Source worker có cả nhánh SAB và JSPI; PRIOR quan sát Chrome chọn JSPI | VERIFIED / PRIOR |
| Virtual và physical path có tách nhau không? | **Tách.** Hai code path khác nhau: editor đi device API, Project Builder đi iframe simulator | VERIFIED |

### 5.9 Physical-device path

- **VERIFIED:** Blockly → cùng Python generator → Python text → Run/USB → `bluetooth.requestDevice` (Nordic UART) hoặc `serial.requestPort`.
- **UNKNOWN trong phiên này:** giao thức nạp code sau khi có cổng. PRIOR (đọc bundle, 2026-10-02): MicroPython raw REPL qua Web Serial 115200 (Ctrl-C, Ctrl-A, ghi file, Ctrl-D); Bluetooth dùng Nordic UART.

### 5.10 Flow diagram thực tế và câu trả lời quan trọng nhất

```text
VIRTUAL (Thiết bị ảo → Project Builder; KHÔNG có trong editor Yolo:Bit)
  Blockly 8.0.1 workspace (block yolobit_*)                 [VERIFIED]
    → Blockly Python generator (client)                     [VERIFIED]
    → Python text "from yolobit import *"                   [VERIFIED]
    → postMessage RUN_CODE → iframe static/gears            [VERIFIED trong source; chưa thấy live]
    → Pyodide (Web Worker) chạy firmware/yolobit/*.py
      trên machine.py giả (simPython)                       [VERIFIED file/source; chưa thấy chạy]
    → scene 3D Babylon + Havok, board con của YOLOBIT       [board hiện: VERIFIED; output: UNKNOWN]

PHYSICAL (editor Yolo:Bit)
  Blockly workspace → cùng generator → cùng Python text     [VERIFIED]
    → Run: Web Bluetooth (Nordic UART) / USB: Web Serial    [VERIFIED]
    → MicroPython trên board (raw REPL)                     [PRIOR; giao thức chưa kiểm lại]
```

> **Hai path dùng chung representation tới mức nào?**
> - **Dùng chung:** block set (`yolobit_*`), định dạng workspace Blockly, generator, **Python text sinh ra giống hệt nhau**, và **từ vựng thư viện** (`yolobit`, `display`, `button_a`, `music`). Simulator còn chạy **chính các file thư viện Python** của board.
> - **Khác nhau:** runtime (Pyodide trong worker so với MicroPython trên ESP32), lớp HAL (`machine.py` giả gọi `simPython` so với `machine` thật), và UI/code path (Project Builder 3D so với editor thiết bị).
>
> Kiến trúc của OhStem vì vậy là **"digital twin ở tầng HAL Python"**: representation chung chính là Python text, còn điểm rẽ nhánh là module `machine`.

---

## 6. Evidence

Toàn bộ evidence nằm **ngoài repo**: `%TEMP%\stem-simulator-ohstem-investigation\` (`C:\Users\MINH.DC\AppData\Local\Temp\stem-simulator-ohstem-investigation\`). Không commit ảnh hay asset của OhStem.

| File | Nội dung |
|---|---|
| `sonnet-report.md` | Report đầy đủ của subagent (14 mục) |
| `scripts/lib.mjs`, `scripts/s*.mjs` | Script Playwright của subagent (probe, điều hướng, đọc toolbox, nạp program) |
| `scripts/main-verify.mjs` | Script kiểm chứng của main agent: header, file firmware, fingerprint trong chunk, Run/USB gọi device API gì |
| `logs/*.json` | Log network từng bước (URL, method, status) |
| `screenshots/01-landing.png` | Landing và menu |
| `screenshots/02-yolobit-hub.png` | Hub Yolo:Bit: Bài học / Lập trình / Gamepad |
| `screenshots/03-codes-yolobit.png` | Editor mặc định: toolbox, workspace, Block⇄Python, Run/Stop, Bluetooth/USB; không có board ảo |
| `screenshots/04-advanced-expanded.png`, `05-flyout-device.png` | Nhóm Nâng cao và flyout |
| `screenshots/06-extensions-popup.png` | Popup Mở rộng (danh sách extension) |
| `screenshots/08-program-blocks.png` | Program thử bằng block |
| `screenshots/09-python-mode.png` | Python sinh ra trong Ace |
| `screenshots/10-click_*.png` | Sau khi bấm Run/Stop/USB/Bluetooth không có thiết bị: UI không đổi |
| `screenshots/13-vr-project-builder.png`, `16-design-advanced.png` | Project Builder và thư viện "Điện tử" |
| `screenshots/17-grove-added.png`, `24-design-stem.png` | Grove Shield / Stem Kit Shield (board con của Yolo:Bit) dạng 3D |
| `screenshots/18-grove-programming.png`, `20-vr-python-mode.png` | Tab Lập trình trong Project Builder: cùng toolbox, cùng Python |
| `screenshots/21…23, 26, 27, 29-*.png` | Tab Giả lập: canvas tối, HUB PANEL trống, nút đã chuyển sang Dừng |
| `screenshots/30-main-verify-editor.png` | Lần chạy kiểm chứng của main agent |

**Kết quả `main-verify.mjs`** (main agent, 2026-10-13):
- COOP `same-origin`, COEP `credentialless`, CSP `null`;
- `firmware/yolobit/{boot,display,button}.py`, `override/machine.py` và `pyodideWorker.js` đều trả về 200;
- chunk `3576`: `parentBoard` ×13, `YOLOBIT` ×7, `GROVE_SHIELD` ×3, `firmware/yolobit/boot.py` ×1;
- chunk `888`: `isSimulatorVisible` ×4, "Simulator visible" ×1;
- editor: `Blockly.VERSION = 8.0.1`, `crossOriginIsolated = true`, top block mặc định `yolobit_basic_forever`;
- Run gọi `bluetooth.requestDevice` (Nordic UART), USB gọi `serial.requestPort({})`; không có worker và không có request nào ngoài analytics.

---

## 7. What we should learn from OhStem

Chỉ học concept, không học implementation.

1. **Onboard trước, nối dây sau.** Bài đầu dùng phần cứng gắn sẵn và gọi theo tên ("nút A", "hiện hình"). Chân và module ngoài nằm sau "Nâng cao" và "Mở rộng". → Basic Board có thiết bị onboard (§10). `stem-demo` còn có thể làm tốt hơn ở bước sau, vì nó có canvas nối dây thật.
2. **Category theo nhóm phần cứng và khái niệm**, có phân lớp: Cơ bản / Ngõ vào / Âm nhạc / LED, rồi lập trình, rồi Nâng cao (ẩn mặc định). → Toolbox sinh từ board profile theo block pack (§13.3).
3. **Block là nguồn, text là cầu nối.** Công tắc Block ⇄ Python cho học sinh thấy code thật mà không bắt viết code. → IR → Python printer read-only (§13.1). *(2026-10-13: nâng thành generator Yolo:Bit MicroPython bắt buộc, D6.)*
4. **Một representation cho cả simulator lẫn board thật.** Ở OhStem, chỗ chung là Python text và thư viện board; chỗ rẽ là HAL `machine`. → Ở `stem-demo`, chỗ chung là **IR + `HardwareIO`**; chỗ rẽ là implementation của `HardwareIO` (simulation hôm nay, Web Serial sau này).
5. **Board con kế thừa board gốc** (`parentBoard`: Grove Shield / Stem Kit Shield → YOLOBIT). → Advanced là phần mở rộng của Basic trên cùng schema, không phải engine khác.
6. **Input ảo là một kênh tường minh** (`SET_BOARD_BUTTON`, `SET_ACCEL_VALUE`, `SET_WIDGET_VALUE`, HUB PANEL widget). → `RuntimeControl` và `setComponentInput` (§13.3).
7. **Project mẫu là xương sống của giáo trình** (trái tim nhấp nháy, máy phát nhạc, lắc xúc xắc…). → Mỗi bài ở §15 là một template key.
8. **Nhường 10 ms mỗi vòng `forever`.** OhStem sinh `time.sleep_ms(10)`, `stem-demo` có E3. Hai bên độc lập đi tới cùng một lựa chọn, nên giữ E3.
9. **Mức độ trong UI** (Nhí / Cơ bản / Nâng cao trong Project Builder). → `tier` trong board profile và block pack.

---

## 8. What we should NOT copy

| Không copy | Lý do |
|---|---|
| Thương hiệu, tên, hình board, model 3D, layout chân, màu và text của block, icon, hình có sẵn, giai điệu có sẵn | Tài sản của OhStem. Board của mình phải có thiết kế, tên và layout riêng |
| Thư viện firmware Python (`firmware/yolobit/*.py`), `machine.py` giả, block definition, generator | Source độc quyền. Ta chỉ học khái niệm "HAL twin" |
| Giấu simulator khỏi editor thiết bị (cờ `isSimulatorVisible` có trong code nhưng không bật được từ UI Yolo:Bit) | Với giáo trình không có board thật, simulator phải là đường chính, nằm ngay trong editor. Đây là khác biệt có chủ đích của `stem-demo` (canvas và code hiển thị cùng lúc, plan A8) |
| Dùng engine 3D + physics (Babylon + Havok + Pyodide, nhiều MB) chỉ để chạy một board | Quá nặng cho iframe 1100×640 trong lesson. Canvas 2D là đủ |
| Tải runtime từ CDN bên thứ ba lúc chạy (Pyodide từ jsdelivr) | Phụ thuộc mạng ngoài và rủi ro COEP; nếu làm Option B thì self-host |
| Extension bằng `eval()` JS từ GitHub, catalog hardcode, không pin version (PRIOR) | Vi phạm B6; rủi ro bảo mật |
| Chuỗi giống token trong bundle public, không có CSP | Pattern bảo mật xấu |
| Block type lẫn prefix board khác (`xbot_serial_*` trong toolbox Yolo:Bit) | Dấu hiệu của việc copy block giữa các board; block pack của mình phải trung lập với board |
| Runtime state lẫn vào document (`pinStates` trong `params`, PRIOR) | Đã chặn bằng B2 |

---

## 9. Current stem-demo gap analysis

Effort là tương đối: **S** (vài file, một task nhỏ), **M** (một task cỡ POC-xx), **L** (nhiều task, có thiết kế riêng), **XL** (một track riêng).

| Capability | Current (`stem-demo`) | Needed Basic | Needed Advanced | Effort |
|---|---|---|---|---|
| Board profile có capability của chân (digital/analog/PWM) | Chỉ có tên chân | ✓ | ✓ | S |
| Thiết bị onboard (LED, nút, loa, cảm biến gắn sẵn) | Không | ✓ (LED, nút A/B, loa, cảm biến ánh sáng) | ✓ (thêm ma trận, gia tốc kế, nhiệt độ) | M |
| Renderer riêng cho board | GenericRenderer | ✓ | ✓ | S–M |
| Nhiều loại board, chọn board theo project | Hard-code `'board'` | Không bắt buộc (1 board) | ✓ | M |
| Digital out / in | ✓ | ✓ giữ | ✓ giữ | — |
| Analog input + điều khiển giá trị lúc chạy (slider) | Không | ✓ | ✓ | M |
| PWM (độ sáng LED) | Không | ✓ | ✓ | S–M |
| Buzzer / tone | Không | ✓ | ✓ | S–M |
| Số, biến, so sánh, and/or, toán, random | Không (chỉ `if`/`not`) | ✓ | ✓ | M |
| Vòng lặp `repeat N`, `while` | Chỉ `forever` | ✓ | ✓ | S–M |
| Event "khi nút được nhấn" | Không (polling) | Nên có | ✓ | M |
| In ra console / serial monitor | Không (BL-P1 backlog) | ✓ | ✓ | S |
| Xem code text (Python) read-only | Không (BL-PY2 backlog) | ~~Nên có~~ → **MUST** dưới dạng generator Yolo:Bit MicroPython (OWNER DECISION D6) | ✓ | ~~S–M~~ → M (generator là subsystem chính thức, có golden suite) |
| Highlight block đang chạy / block lỗi | `blockId` có trong IR, chưa dùng (BL-P3) | Nên có | ✓ | S |
| Ma trận LED / hiển thị chữ, số, hình | Không | — | ✓ | M |
| Gia tốc kế (nghiêng, lắc) | Không | — | ✓ | M |
| Cảm biến nhiệt độ, ánh sáng | Không | Ánh sáng | ✓ | S |
| Servo | Không | — | ✓ | S–M |
| Cảm biến siêu âm (khoảng cách) | Không | — | ✓ | S–M |
| Động cơ DC | Không | — | Nice-to-have | S |
| Module kiểu I2C (màn hình, cảm biến ngoài) | Không | — | Later | M–L |
| Giao tiếp (radio giữa board, Wi-Fi/MQTT, BLE) | Không | — | Later | L |
| Python sửa được + runtime Python | Không (BL-PY1/3/4 backlog) | — | Later | L–XL |
| Kết nối board thật (Web Serial/BLE) | Không | — | Later | L |
| Mô phỏng điện (điện áp, dòng, cháy LED) | Không (cố ý) | Không cần | Không cần | XL |
| Lab nhúng theo template key | ✓ (S1) | ✓ thêm key | ✓ thêm key | S |
| `postMessage` (ready/run/hoàn thành/chấm bài) | Không | Nên có | ✓ | M |

---

## 10. Basic Board proposal

> ⚠️ **Superseded (2026-10-13, owner decisions D3, D4, D6).** Đề xuất ban đầu dưới đây được giữ lại làm lịch sử. Ba điểm không còn đúng:
> 1. **Không** mở rộng `board` generic; dùng một board family tương thích Yolo:Bit riêng.
> 2. Basic không phải một board riêng mà là **curriculum profile** của board family đó.
> 3. Output onboard kiểu "LED trên D13" không map sạch sang Yolo:Bit; trục của Basic là display, nút A/B, âm thanh, ánh sáng.
>
> Phạm vi Basic mới: plan §14.

### 10.1 Nguyên tắc thiết kế

1. **Giáo trình đi trước phần cứng.** Mỗi thành phần phải mở ra ít nhất một bài học ở §15. Thành phần nào không có bài học thì chưa đưa vào.
2. **Một board, hai cách dùng.**
   - *Onboard*: dùng LED, nút, loa, cảm biến gắn sẵn, không cần nối dây. Hợp với học sinh nhỏ và bài đầu tiên.
   - *Header*: nối linh kiện ngoài trên canvas, như `stem-demo` đang làm. Đây là điểm `stem-demo` đã có mà Yolo:Bit device programming không có (xem §5).
3. **Thiết bị onboard là device bình thường, chỉ là gắn sẵn và nối sẵn vào chân nội bộ.** Nhờ vậy simulation, renderer và runtime input dùng lại đúng cơ chế đang có (`led`, `contact`), không cần nhánh code riêng cho "onboard".
4. **Tương thích ngược.** Đề xuất mở rộng chính definition `board` hiện có (giữ `id` và các port `3v3`, `gnd`, `d2`…`d13`), chỉ **thêm** field tuỳ chọn. Năm template key mà STEMLearning đang lưu vẫn mở được, không cần tăng `schemaVersion` (plan §6.1: field tuỳ chọn có default thì không cần migration). Đây là đề xuất, cần owner chốt (§18).
5. **Mô phỏng mức tín hiệu, không mô phỏng điện.** Net mang mức logic, cộng thêm giá trị analog (0–1 theo VCC), duty PWM và tần số tone. Không có điện áp/dòng thật, không cháy LED.

### 10.2 Thành phần

| Nhóm | Thành phần | Program thấy gì | Điều khiển lúc chạy | Bài học (§15) | Phân loại |
|---|---|---|---|---|---|
| Onboard output | LED "L" nối nội bộ vào D13 | `D13`, hoặc block "LED onboard bật/tắt" | — | 1, 2 | **Must** |
| Onboard input | Nút **A**, nút **B** trên chân nội bộ `BTN_A`, `BTN_B` | "nút A đang được nhấn", `digital read` | giữ chuột (như push button) | 3, 9 | **Must** |
| Onboard sound | Buzzer trên kênh nội bộ `BUZZER` (PWM/tone) | `play tone <Hz> for <ms>`, `stop tone` | — (biểu tượng sóng; âm thanh WebAudio tuỳ chọn, mặc định tắt) | 8 | **Must** |
| Onboard analog | Cảm biến ánh sáng trên kênh nội bộ `LIGHT` (0–1023) | `light level`, `analog read` | thanh trượt 0–100 % | 6 | **Must** |
| Header digital | `D2`…`D13`. PWM trên `D3`, `D5`, `D6`, `D9`, `D10`, `D11` (ký hiệu `~`) | digital write/read, PWM write | — | 1–5, 7 | **Must** (D2–D13 đã có) |
| Header analog | `A0`…`A3` (port mới) | `analog read` | — | 6 | **Must** |
| Power | `3V3`, `GND`; thêm GND thứ hai bằng `internalConnections` (đã có trong plan §6.2 nhưng hoãn vì chưa có consumer) | — | — | — | **Must** (đã có) / Nice (GND thứ hai) |
| Onboard RGB LED | 1 LED RGB trên 3 kênh PWM nội bộ | `set RGB color` | — | 7 mở rộng | Nice-to-have |

**Linh kiện ngoài trong palette** (dùng với header):

| Device | Trạng thái | Model | Điều khiển lúc chạy | Phân loại |
|---|---|---|---|---|
| LED, Resistor, Push Button | Đã có | `led`, `resistor`, `contact` | giữ nút | Giữ |
| Potentiometer (3 chân VCC / OUT / GND) | Mới | `analog-source` | thanh trượt | **Must** |
| Slide switch | Mới (BL-S3) | `contact` dạng bật/tắt | click để bật/tắt | Nice-to-have |
| LED RGB rời, buzzer rời | Mới | `led` nhiều kênh, `tone-sink` | — | Nice-to-have |

### 10.3 Lập trình (block pack của Basic)

| Pack | Block | Phân loại |
|---|---|---|
| Events | `on start`, `forever` (đã có); `when button A/B pressed` | Must; event là Must ở pha 2 của Basic (polling bằng `if` vẫn dùng được từ pha 1) |
| Pins | `digital write`, `digital read` (đã có); `analog read`, `PWM write (0–100 %)` | Must |
| Onboard | `LED onboard`, `button A/B is pressed`, `light level`, `play tone`, `stop tone` | Must |
| Time | `wait <s>` (đã có); `wait <ms>`; `time since start (ms)` | Must |
| Logic | `if / else if / else` (đã có), `not` (đã có); so sánh `= ≠ < ≤ > ≥`; `and`, `or`; `true/false` | Must |
| Loops | `repeat N times`, `while`, `for i from a to b` | Must (`for` có thể Nice) |
| Variables | biến kiểu số (Blockly variables) | Must |
| Math | số, `+ − × ÷`, `random a..b`, `map`, `constrain` | Must (`map`/`constrain` Nice) |
| Console | `print` ra panel console (BL-P1) | Must |
| Code view | Python read-only sinh từ IR (BL-PY2) | Nice-to-have |
| Functions, lists, text | — | Later (Advanced) |

### 10.4 Ngoài phạm vi của Basic

Mô phỏng điện (resistor bắt buộc, LED cháy), interrupt thật, serial plotter, nhiều board, Python sửa được, kết nối board thật.

---

## 11. Advanced Board proposal

> ⚠️ **Superseded một phần (2026-10-13, D4).** Advanced là **curriculum profile** (superset của Basic) trên **cùng board family tương thích Yolo:Bit**, không phải một definition board khác. Ý "cùng engine" ở §11.3 vẫn đúng. Bảng §11.2 (đối chiếu Yolo:Bit) vẫn là input cho YB-0. Kích thước/màu ma trận: xem §18 Q5. Phạm vi Advanced mới: plan §15.

Advanced Board là **một definition khác trên cùng schema, cùng engine** (cùng `RunSession`, compiler, interpreter, simulation, canvas). Nó chỉ thêm thiết bị onboard, model và block pack. Mọi block của Basic chạy được trên Advanced nếu tên chân/thiết bị tồn tại.

### 11.1 Thành phần

| Nhóm | Thành phần | Program thấy gì | Điều khiển lúc chạy | Phân loại |
|---|---|---|---|---|
| Display | Ma trận LED onboard (đề xuất **8×8 một màu** ở bản đầu, RGB sau; kích thước là câu hỏi mở §18) | `show icon`, `show number`, `scroll text`, `set pixel x y`, `clear` | — | **Must** |
| Input | Nút A, B (như Basic) | như Basic + event | giữ chuột | **Must** |
| Motion | Gia tốc kế 3 trục | `acceleration x/y/z`, `tilt`, `when shaken` | "tilt pad" kéo thả + nút "Shake" | **Must** |
| Sensors onboard | Nhiệt độ (°C), ánh sáng (0–100 %) | `temperature`, `light level` | thanh trượt | **Must** |
| Sound | Buzzer (như Basic), giai điệu có sẵn | `play melody` | — | **Must** |
| Header | Nhiều chân hơn Basic, có digital/analog/PWM theo capability | như Basic | — | **Must** |
| External: Servo | Linh kiện ngoài 3 chân | `servo <pin> angle <deg>` | — (vẽ góc cánh tay) | **Must** |
| External: Ultrasonic | Module khoảng cách | `distance cm` | thanh trượt khoảng cách | **Must** |
| External: DC motor (qua driver) | Module động cơ | `motor speed <−100..100>` | — (vẽ quay) | Nice-to-have |
| External: NeoPixel strip | Dải LED RGB | `set LED i color` | — | Nice-to-have |
| External: màn hình text (OLED/LCD) | Module kiểu I2C, mô phỏng ở mức API (không mô phỏng giao thức bus) | `print line` | — | Nice-to-have |
| Cảm biến âm thanh, la bàn, IR remote | Module | API mức cao | thanh trượt / nút | Nice-to-have |
| Lập trình | text (string), danh sách, hàm, event nhiều loại | — | — | **Must** (text, hàm), Nice (danh sách) |
| Communication | Radio giữa hai board, Wi-Fi/MQTT, BLE, IoT dashboard | — | — | **Later** (cần chạy nhiều board cùng lúc) |
| I2C/SPI mức giao thức | — | — | — | **Later** (không cần cho giáo trình) |
| Kết nối board thật | Web Serial/BLE | — | — | **Later** (phụ thuộc quyết định phần cứng §18) |

### 11.2 Đối chiếu với Yolo:Bit (§5.4): học khái niệm, không copy danh mục

| Nhóm năng lực trên Yolo:Bit (VERIFIED) | Basic | Advanced | Ghi chú |
|---|---|---|---|
| Hiển thị trên ma trận RGB (hình, chữ chạy, điểm, độ sáng, biểu đồ, game) | — | ✓ ma trận (kích thước/màu: Q5) | Game sprite: Later |
| Nút A/B, số lần nhấn, event khi nhấn | ✓ | ✓ | Event là Must ở pha 2 của Basic |
| Chân cảm ứng | — | Nice-to-have | Chỉ là một input boolean có thao tác "chạm" |
| Cử chỉ, lắc, gia tốc kế | — | ✓ | |
| Nhiệt độ, ánh sáng | ánh sáng | ✓ cả hai | |
| Âm nhạc (nốt, tần số, bài có sẵn, tempo) | tone | ✓ + giai điệu | Giai điệu là **của mình**, không dùng bài có sẵn của OhStem |
| Chân: digital, analog, servo, `pulse_in`, pull-up | digital, analog, PWM | + servo; `pulse_in` qua module siêu âm | Pull-up: Later (cần simulation có strength, BL-S1) |
| Timer, thời gian chạy | ✓ | ✓ | |
| Bluetooth, gamepad app | — | Later | |
| Serial, biểu đồ | console | console + biểu đồ (Nice) | |
| Hàm, danh sách, text | — (text tối thiểu cho `print`) | ✓ | |
| Extension theo kit (Home:Bit, Plant:Bit…) | — | Later, nếu có kit thật | Module trong palette, không cần hệ extension |

### 11.3 Vì sao vẫn là cùng engine

- Thiết bị không có chân (ma trận, gia tốc kế) là **peripheral có state** trong `SimulationResult.components[id]`, cùng chỗ `lit`/`closed` đang nằm. Renderer đọc state từ snapshot như LED hiện tại.
- Input của cảm biến (nhiệt độ, khoảng cách, nghiêng) là **runtime input theo component**, tổng quát hoá từ `contacts`. Chúng đi qua `RunSession` như `setContactInput` hôm nay.
- Block mới chỉ là thêm case vào compiler và interpreter, hoặc thêm entry vào bảng block-compiler nếu đã refactor (§14).

---

## 12. Runtime architecture options

| Tiêu chí | **A. High-level educational runtime** (Block → IR → interpreter → virtual board) | **B. MicroPython-like runtime** (Block → Python → Python runtime trong worker → virtual hardware API) | **C. Real MCU emulation** (C/C++ → binary → MCU emulator → virtual peripherals) |
|---|---|---|---|
| Implementation effort | **Thấp–vừa.** Mở rộng đúng pipeline đang có. Phần lớn là block + IR + model | **Cao.** Runtime Python trong worker (Pyodide hoặc MicroPython-WASM), `sleep` đồng bộ (JSPI hoặc SAB + `Atomics.wait`), cầu đọc chân giữa main ↔ worker, interrupt khi Stop, thư viện `machine`/board API viết lại bằng Python, mapping lỗi về block | **Rất cao.** Emulator CPU + peripheral ở mức register, toolchain biên dịch (thường cần build server hoặc toolchain WASM nặng), driver/firmware cho từng board |
| Browser feasibility | Đã chứng minh (Learning log: Run → LED ~9 ms) | Khả thi: OhStem có worker Pyodide 0.29.3 và firmware Yolo:Bit cho simulator (VERIFIED file, §5.7); PRIOR đo ~3,5 s tới lệnh đầu tiên với Yolo UNO. Nặng: tải nhiều MB, cold start vài giây, cần COOP/COEP nếu dùng SAB | Khả thi cho AVR/RP2040 (có emulator mã nguồn mở), **không có lựa chọn mở và chín muồi cho ESP32** (chip của Yolo:Bit theo PRIOR). Compile C++ ngay trong browser rất nặng |
| Curriculum value | Cao cho block-based K-12. Diagnostics trước khi chạy, highlight block, thời gian phản hồi tức thì | Cao khi giáo trình chuyển sang **Python text**. Thấp nếu chỉ dùng block | Thấp cho K-12: học sinh không học register hay toolchain. Chỉ có giá trị cho embedded C/C++ nâng cao |
| Tương thích board thật sau này | Gián tiếp: IR → printer sinh MicroPython/Arduino cho board thật. Hành vi có thể lệch nhẹ (timing, kiểu dữ liệu) | Gần nhất cho board chạy MicroPython: cùng code Python | Chính xác nhất về hành vi chip, nhưng chỉ cho đúng chip đó |
| Security | Tốt nhất: không thực thi code tuỳ ý, interpreter chỉ chạy IR đã kiểm | Chạy Python tuỳ ý trong worker sandbox: chấp nhận được, nhưng cần giới hạn thời gian/bộ nhớ, chặn network/import | Binary chạy trong emulator: cô lập tốt, nhưng compile server là bề mặt tấn công mới |
| Performance | Main thread, nhẹ; đã đo đạt mọi chỉ số §2.5 của plan | Cold start chậm; truyền tin worker có độ trễ; vòng lặp chặt có thể làm worker bận nhưng không đóng băng UI | Emulator chu kỳ CPU tốn CPU; ổn cho AVR, khó cho chip 240 MHz |
| Maintenance | Thấp: một ngôn ngữ (TS), một runtime | Trung bình–cao: hai ngôn ngữ, giữ API Python ↔ `HardwareIO` đồng bộ, nâng version runtime | Cao: emulator, toolchain, firmware từng board |
| Phù hợp demo STEMLearning hiện tại | **Rất phù hợp:** không đổi contract nhúng, load nhanh trong iframe 1100×640, chạy offline | Được, nhưng iframe phải tải runtime lớn; COEP của trang nhúng có thể thành vấn đề (plan S1) | Không phù hợp |

---

## 13. Recommended architecture

### 13.1 Kết luận

> ⚠️ **Đã chỉnh (2026-10-13, D1/D2/D6).** Lựa chọn A (runtime IR) và việc loại C **giữ nguyên** (D5). Phần sai là cách coi Python ở gạch đầu dòng thứ hai: generator `IR → Yolo:Bit MicroPython` **không** phải view read-only. Nó là **output chính thức, MUST**, phải sinh code chạy được trên Yolo:Bit vật lý cho mọi construct được hỗ trợ. Bốn lớp tách bạch (PLANNING DECISION, chi tiết ở plan §5–§6):
> - **simulator runtime:** interpreter IR, hôm nay;
> - **code generator:** IR → `.py` Yolo:Bit, MUST trong milestone này;
> - **physical transport:** Web Serial/Bluetooth, Later;
> - **editable Python + Python runtime trong browser:** Later.

**Chọn A cho Basic và Advanced, thiết kế sẵn seam để thêm B sau. Loại C.**

- **A** là đường ngắn nhất tới giáo trình block-based. Nó tái sử dụng gần như toàn bộ core đã có số đo và test, đồng thời giữ được những ưu điểm mà Python runtime khó có: lỗi kèm `blockId` trước khi chạy, highlight block đang chạy, Stop tức thì.
- **Cầu nối sang text** (đúng thứ OhStem làm bằng nút Block ⇄ Python) được làm bằng **IR → Python printer read-only** (BL-PY2). Nó rẻ và không cần runtime Python.
- **B** chỉ làm khi có một trong hai điều kiện: giáo trình có phần **Python text sửa được**, hoặc owner quyết định **ghép với board thật chạy MicroPython**. Khi đó runtime Python implement **cùng `HardwareIO`** và nằm sau `RunSession`, đúng seam plan §14 đã giữ. Trước đó phải có spike BL-PY1 (plan §13).
- **C** không đáng làm cho sản phẩm này (lý do ở §12 và §16).

### 13.2 Kiến trúc đề xuất

```text
Board profile (data, JSON) ──► block packs + toolbox ──► BlocklyPanel (view)
        │                         │
        │                         ▼
        │                Blockly JSON ──compile──► IR v1 ──► interpreter (main thread)          [A]
        │                                           ├──► Python printer (read-only view)      [A, Basic nice-to-have]
        │                                           └──► (sau) MicroPython printer cho board thật
        │                Python text ──► (sau) Python runtime trong worker                    [B]
        │                                           │
        ▼                                           ▼  HardwareIO (theo capability)
DeviceRegistry ───────────────────────────► RunSession  (nơi duy nhất nối program ↔ simulation)
                                                    │  runtime inputs, events
                                                    ▼
                         simulateCircuit (signal-level) + model của device/peripheral
                                                    │  SimulationResult (JSON)
                                                    ▼
                         runStore (≤1 commit/frame) ──► canvas renderers + runtime controls + console
```

### 13.3 Data model sơ bộ (mở rộng type đang có, không tạo framework song song)

Bảng tên: tên trong đề bài → tên đang có trong source.

| Khái niệm | Tên dùng | Ghi chú |
|---|---|---|
| `ComponentDefinition` | `DeviceDefinition` (đã có) | Thêm field tuỳ chọn |
| `PinDefinition` | `PortDefinition` (đã có) + `BoardPin` (mở rộng `board.pins`) | Port là điểm nối dây; `BoardPin` là tên chân mà program thấy |
| `BoardDefinition` | `DeviceDefinition` có `board: BoardProfile` | Basic và Advanced là hai file JSON, không phải hai class |
| `PeripheralDefinition` | `OnboardDevice` trong `BoardProfile` | Tham chiếu device có sẵn trong catalog |
| `SimulationState` | `SimulationResult` + `RunSnapshot` (đã có) | Mở rộng state theo component |
| `ProgramRuntime` | `runProgram` / `ProgramRun` + `HardwareIO` (đã có) | Mở rộng theo capability |

```ts
// src/core/devices/device-definition.ts — chỉ thêm field tuỳ chọn
type DeviceDefinition = {
  id: string; name: string;
  body: { width: number; height: number };
  ports: PortDefinition[];
  internalConnections?: string[][];                           // plan §6.2, hoãn tới khi có consumer (GND thứ hai)
  renderer: string;
  simulation: { model: string; config?: Record<string, unknown> };   // vd potentiometer { range }, servo { maxAngle }
  controls?: RuntimeControl[];                                // learner thao tác gì lúc chạy
  board?: BoardProfile;
};

type BoardProfile = {
  tier: 'basic' | 'advanced';
  pins: BoardPin[];
  onboard?: OnboardDevice[];
  blockPacks: string[];                                       // 'events' | 'pins' | 'sound' | 'display' | 'motion' …
};

type BoardPin = {
  name: string;                                               // 'D13', 'A0', 'BTN_A' — tên program thấy
  portId?: string;                                            // không có = chân nội bộ, không ra header
  capabilities: ('digital' | 'analogIn' | 'pwm' | 'tone')[];
};

type OnboardDevice = {
  id: string;                                                 // 'button-a' → id trong snapshot: '<boardId>/button-a'
  deviceType: string;                                         // device có sẵn trong catalog: 'led', 'push-button', 'light-sensor'…
  label: string;                                              // 'button A'
  wiring: Record<string, string>;                             // portId của device → tên chân board | 'gnd' | '3v3'
  at: { x: number; y: number };                               // vị trí vẽ trong thân board
};

type RuntimeControl =
  | { kind: 'hold' }                                          // push button (đang có, đang ngầm theo model 'contact')
  | { kind: 'toggle' }                                        // slide switch
  | { kind: 'slider'; min: number; max: number; unit?: string }   // ánh sáng, nhiệt độ, khoảng cách, biến trở
  | { kind: 'tilt' }                                          // gia tốc kế
  | { kind: 'gesture'; values: string[] };                    // 'shake'
```

```ts
// src/core/simulation/simulate-circuit.ts — từ logic mức net lên signal-level
type SimulationInputs = {
  powered: boolean;
  pinOutputs: Record<string, PinDrive>;                       // đang là Record<string, 0 | 1>
  componentInputs?: Record<string, ComponentInput>;           // tổng quát hoá `contacts`
};
type PinDrive = { kind: 'digital'; level: 0 | 1 } | { kind: 'pwm'; duty: number } | { kind: 'tone'; hz: number };
type ComponentInput = { closed?: boolean; value?: number; tilt?: { x: number; y: number }; gesture?: string };
type NetSignal = { level: 'floating' | 'high' | 'low' | 'conflict'; analog?: number; duty?: number; hz?: number };
type ComponentState = {                                       // đang là { lit?, closed? }
  lit?: boolean; brightness?: number; closed?: boolean; value?: number;
  hz?: number; angle?: number; pixels?: number[];             // ma trận
};
type SimulationResult = {
  nets: { ports: PortRef[]; signal: NetSignal }[];
  components: Record<string, ComponentState>;
  pinReads: Record<string, { digital: 0 | 1; analog: number }>;
};
```

```ts
// src/core/program/interpreter.ts — HardwareIO theo capability
type HardwareIO = {
  digitalWrite(pin: string, level: 0 | 1): void;             // đang có
  digitalRead(pin: string): 0 | 1;                            // đang có
  analogRead(pin: string): number;                            // 0–1023
  pwmWrite(pin: string, percent: number): void;               // 0–100
  tone(pin: string, hz: number | null): void;
  peripheral<K extends PeripheralKind>(id: string, kind: K): PeripheralIO[K];   // display, motion… (Advanced)
  print(text: string): void;                                  // console (BL-P1)
};

// src/core/program/ir.ts — IR v1
type ProgramIR = {
  onStart: Statement[];
  forever: Statement[] | null;
  handlers: { event: { kind: 'buttonPressed' | 'shake'; device: string }; body: Statement[] }[];
  variables: string[];
};
// Statement thêm: setVariable, repeat, while, for, analogWrite/pwm, tone, print, display…
// Expression thêm: number, boolean, text, variable, compare, and/or, arithmetic, analogRead, sensor…
```

**Quy tắc giữ nguyên:** B1–B8 của plan. Riêng B2: runtime input của cảm biến (giá trị slider, nghiêng) là runtime state của run, mất khi Stop. B4: compiler vẫn chỉ đọc JSON. B6: board profile và device là data; model và renderer tham chiếu bằng id.

### 13.4 Ngữ nghĩa cần chốt khi vào planning (không quyết ở đây)

- **Event + polling:** handler `when button pressed` chạy như một task song song trong interpreter (cooperative, cùng `AbortSignal`). `RunSession` phát hiện cạnh lên của input và báo xuống runtime (plan §6.4 đã nêu `notifyInputsChanged`).
- **Kiểu dữ liệu:** số (float), boolean, text. Quy tắc chuyển kiểu đơn giản; khi có Python printer thì tránh ngữ nghĩa khác Python ở các chỗ dễ thấy (chia số nguyên, so sánh text).
- **Analog:** thang 0–1023 (dễ dạy, giống Arduino) hay 0–4095 (giống ESP32) hay phần trăm. Đề xuất 0–1023 cho `analog read` và phần trăm cho block cảm biến onboard.

---

## 14. Reuse vs new implementation

> ℹ️ **Ghi chú 2026-10-13:** bảng "giữ / làm mới" bên dưới vẫn đúng về file. Có ba khác biệt: `board.json` **không** bị sửa (D3); "Python printer read-only" trở thành **generator Yolo:Bit MicroPython** trong `src/core` (D6); và block/toolbox đi theo board family + curriculum profile. Danh sách file chi tiết: plan §4 và §21.

### 14.1 Giữ (tái sử dụng, mở rộng cộng thêm)

| Khu vực | File | Giữ gì | Thay đổi dự kiến |
|---|---|---|---|
| Document | `src/core/circuit/document.ts` | `ProjectDocument`, Zod schema, I1–I5 | Không đổi schema cho Basic. Advanced có thể cần biết board nào (đang suy từ component) |
| Circuit ops + geometry | `src/core/circuit/components.ts`, `wires.ts`, `geometry.ts` | Toàn bộ | Không |
| Netlist | `src/core/circuit/netlist.ts` | Union-find, `extraConnections` | Thêm `internalConnections` và nối thiết bị onboard |
| Device registry | `src/core/devices/device-definition.ts`, `registry.ts`, `local-catalog.ts`, `definitions/*.json` | Schema, Zod, catalog | Thêm field tuỳ chọn (§13.3) và definition mới |
| Compiler | `src/core/program/compile-program.ts` | Quy tắc C1–C8, diagnostics, không throw, giới hạn độ sâu | Từ 5 lên vài chục block: đổi `switch` thành **bảng block-compiler theo type** để không phình |
| IR | `src/core/program/ir.ts` | Cấu trúc, `blockId` trên mọi node | IR v1 (§13.3) |
| Interpreter | `src/core/program/interpreter.ts` | Async tree-walk, `AbortSignal`, `timerSleep`, E1–E7 | Expression, biến, vòng lặp, task cho event |
| Run session | `src/core/run/run-session.ts` | Ownership/reentrancy, snapshot khi đổi, E6/E7 | `setContactInput` → `setComponentInput`; báo event xuống runtime |
| Simulation | `src/core/simulation/simulate-circuit.ts` | Hàm thuần, model theo id, model lạ = inert | Signal-level (§13.3), model mới |
| Block data | `src/core/program/blocks.ts` | Block JSON là data trong core | Tách thành block pack theo capability; toolbox sinh từ board profile |
| Persistence | `src/core/persistence/project-repository.ts`, `src/storage/*` | Toàn bộ | Không |
| Stores | `src/ui/state/run-store.ts`, `project-store.ts`, `autosave.ts` | rAF batching, một action cho mọi sửa mạch | Action chuyển tiếp input mới |
| Canvas | `src/ui/canvas/CircuitCanvas.tsx`, `renderers.ts`, `LedRenderer.tsx`, `PushButtonRenderer.tsx`, `GenericRenderer.tsx`, `viewport.ts` | Render từ document + snapshot, renderer theo id | Thêm renderer; tương tác `hold` hiện gắn với model `contact` → tổng quát theo `controls` |
| Blockly | `src/ui/blockly/BlocklyPanel.tsx`, `editor-blocks.ts` | Blockly là view, `saveNow`, `canOpenProgram` + preflight | `registerBlocks` đang đăng ký **một lần** với chân của một board → đăng ký theo board profile |
| Launch/embed | `src/ui/app/launch.ts`, `startup.ts`, `src/samples/templates.ts` | Contract S1 | Thêm template key cho bài học mới |
| Composition root | `src/main.tsx` | Vị trí duy nhất chọn registry/storage | Bỏ hard-code `registry.get('board')` |
| Test | `src/core/**/*.test.ts`, `tests/*.test.ts`, `e2e/*.spec.ts`, `e2e/helpers.ts`, hook `window.__stem` | Pattern test theo rủi ro, fixture Blockly thật, conformance test | Thêm test cho block/model mới |

### 14.2 Phải làm mới

| Hạng mục | Vị trí đề xuất | Basic / Advanced |
|---|---|---|
| Board profile có capability + thiết bị onboard | `src/core/devices` (schema + `board.json` mở rộng) | Basic |
| Board renderer (thân board, LED/nút onboard, nhãn chân) | `src/ui/canvas/BoardRenderer.tsx` | Basic |
| Model mới: analog source, PWM sink (độ sáng), tone sink, light sensor | `src/core/simulation/` (tách model ra file khi `simulate-circuit.ts` quá lớn) | Basic |
| Runtime controls UI (slider, toggle, tilt pad, shake) | `src/ui/canvas/` hoặc panel cạnh canvas | Basic (slider), Advanced (tilt/shake) |
| IR v1 + compiler/interpreter cho biến, số, so sánh, vòng lặp, print | `src/core/program/` | Basic |
| Event runtime (`when button pressed`) | `src/core/program/interpreter.ts`, `src/core/run/run-session.ts` | Basic pha 2 |
| Console panel | `src/ui/app/` | Basic |
| Toolbox sinh từ board profile | `src/core/program/blocks.ts` | Basic |
| Python printer read-only (BL-PY2) | `src/core/program/python-printer.ts` (tên gợi ý) | Basic nice / Advanced |
| Highlight block đang chạy (BL-P3) | `RunSnapshot` + `BlocklyPanel` | Nice |
| Peripheral model: ma trận, gia tốc kế, nhiệt độ, servo, siêu âm | `src/core/simulation/` + renderer | Advanced |
| Chọn board cho project | document/UI | Advanced |
| Kênh `postMessage` với STEMLearning (ready, run, completion) | `src/ui/app/` (không vào core) | Sau MVP, cần owner chốt |
| Python runtime (worker), MicroPython printer cho board thật, Web Serial | — | Later |

---

## 15. Curriculum mapping

> ℹ️ **Ghi chú 2026-10-13:** bảng dưới là curriculum mapping ban đầu, dựa trên board kiểu Arduino. Plan §14–§15 làm lại mapping cho board family tương thích Yolo:Bit, onboard trước (display, nút, âm thanh, ánh sáng), sau đó mới tới header/mạch ngoài. Các bài 1–3 với `board` generic vẫn chạy như hôm nay.

Thứ tự bài học là đề xuất; nội dung sư phạm cần người làm giáo trình duyệt. "Có sẵn" = `stem-demo` hôm nay đã chạy được.

| Bài | Nội dung | Khái niệm lập trình | Phần cứng | Basic | Advanced | Hôm nay |
|---|---|---|---|---|---|---|
| 1 | Bật/tắt LED | `on start`, digital write | LED onboard (không nối dây) hoặc LED ngoài + điện trở | ✓ | ✓ | Có sẵn (`led-on`, LED ngoài) |
| 2 | Nhấp nháy | `forever`, `wait` | LED | ✓ | ✓ | Có sẵn (`blink`) |
| 3 | Nút nhấn → LED | digital read, `if/else` | Nút A onboard hoặc nút ngoài | ✓ | ✓ | Có sẵn (`button-led`, nút ngoài) |
| 4 | Đếm số lần nhấn | biến, phép cộng, `print`, phát hiện cạnh / event | Nút A, console | ✓ | ✓ | Thiếu biến, print |
| 5 | Đèn giao thông | trình tự, `repeat`, nhiều output | 3 LED ngoài | ✓ | ✓ | Thiếu `repeat` (làm được bằng `forever`) |
| 6 | Đèn ngủ tự động | analog read, so sánh ngưỡng | Cảm biến ánh sáng onboard + slider, hoặc biến trở ngoài | ✓ | ✓ | Thiếu analog |
| 7 | Điều chỉnh độ sáng / LED "thở" | PWM, vòng `for`, biến | LED trên chân `~` | ✓ | ✓ | Thiếu PWM, `for` |
| 8 | Còi báo / giai điệu | tone, thời gian | Buzzer onboard | ✓ | ✓ | Thiếu tone |
| 9 | Trò chơi phản xạ hai người | nhiều input, event, `time since start`, random | Nút A/B, LED, buzzer | ✓ | ✓ | Thiếu event, thời gian, random |
| 10 | Hiển thị số, hình, chữ chạy | text, hiển thị | Ma trận LED | — | ✓ | — |
| 11 | Xúc xắc khi lắc, thước thuỷ | event lắc, gia tốc, random | Gia tốc kế | — | ✓ | — |
| 12 | Nhiệt kế mini | cảm biến nhiệt độ, hiển thị số, ngưỡng | Nhiệt độ + ma trận | — | ✓ | — |
| 13 | Cổng chắn / kim chỉ báo | servo, `map` | Servo + biến trở | — | ✓ | — |
| 14 | Cảm biến lùi xe | khoảng cách → tần số còi | Siêu âm + buzzer | — | ✓ | — |
| 15 | Dự án tổng hợp (nhà thông minh mini) | hàm, nhiều cảm biến, trạng thái | Nhiệt độ, ánh sáng, động cơ/quạt, ma trận | — | ✓ | — |
| 16 | Giao tiếp hai board / IoT | message, mạng | Radio / Wi-Fi | — | Later | — |

**Đọc bảng theo chiều ngược:** Basic Board cần đúng các thành phần cho bài 1–9; Advanced thêm thành phần cho bài 10–15. Bài 16 là lý do duy nhất để làm communication, nên nó ở mức Later.

---

## 16. Feasibility

### 16.1 Ba câu hỏi về khả năng mô phỏng

| Câu hỏi | Đánh giá | Vì sao |
|---|---|---|
| **A. Mô phỏng ở mức educational simulator** (Block/Python → simulator API → chân/thiết bị ảo) | **Easy–moderate** | Pipeline đã chạy end-to-end với số đo tốt. Mỗi peripheral mới là data + model + renderer, chi phí đã đo được (L6). Phần "moderate" là IR v1 (biến, kiểu, event) và UX của runtime control |
| **B. Chạy code gần giống board thật** (API tương thích MicroPython) | **Moderate–hard** | Cần runtime Python trong worker, `sleep` đồng bộ (SAB/JSPI), cầu đọc input main ↔ worker, interrupt, và một thư viện board viết lại bằng Python trên `HardwareIO`. OhStem chứng minh khả thi nhưng với chi phí lớn (Pyodide ~3,5 s cold start theo PRIOR, nhiều MB). Nếu chỉ cần **in ra** code tương thích MicroPython thì là easy (printer từ IR) |
| **C. Emulate MCU thật** (CPU, firmware, register GPIO) | **Hard, không đáng làm** | Chip kiểu ESP32 không có emulator mở và chín muồi cho browser. Cần toolchain compile. Giá trị sư phạm cho K-12 thấp. Chính OhStem cũng không làm (PRIOR: không có fingerprint avr8/rp2040/qemu). Chỉ xem lại nếu có giáo trình embedded C chuyên sâu |

### 16.2 Câu hỏi tổng

> ℹ️ **Ghi chú 2026-10-13 (D1, D6, D8):** câu "không tương thích MicroPython cho tới khi làm Option B" dưới đây **không còn đúng**. Với generator Yolo:Bit MicroPython là MUST, tương thích **ở mức sinh code** đạt được mà không cần Option B. Option B vẫn chỉ cần cho Python sửa được hoặc chạy Python trong browser. Tuyên bố tương thích tuân theo ba mức ở §0 D8.

- **Có build được educational simulator tương đương không?** **Có, với giới hạn.** Ở mức trải nghiệm học (block theo nhóm phần cứng, board có màn hình/nút/loa/cảm biến, input ảo, xem code), điều này làm được trên kiến trúc hiện tại. Ở một điểm ta còn có thể **tốt hơn**: editor Yolo:Bit của OhStem không có board ảo, còn Yolo:Bit ảo nằm trong một môi trường 3D nặng. Giới hạn: không có đường chạy trên board thật, không có Python sửa được, không tương thích MicroPython cho tới khi làm Option B.
- **`stem-demo` có tiến hoá thành nó được không?** **Có, bằng cách mở rộng, không viết lại** (§3.2, §14). Mọi boundary B1–B8 giữ được. Thay đổi lớn nhất là IR v1 và simulation signal-level, cả hai đều nằm sau facade đang có.
- **Cái gì khó:**
  - ngữ nghĩa ngôn ngữ của IR v1: kiểu dữ liệu, biến, event chạy song song với `forever`, highlight block khi có nhiều task;
  - UX của input lúc chạy (slider, nghiêng, lắc) mà vẫn vừa iframe 1100×640;
  - chữ chạy trên ma trận (font, tốc độ) và block cho học sinh nhỏ;
  - giữ Python printer khớp ngữ nghĩa với interpreter.
- **Cái gì rủi ro:**
  - **Scope creep** sang Advanced/communication/Python trước khi Basic được giáo viên dùng thử;
  - quyết định về **board thật** (Q1) đến muộn: tên API trong block và printer nên chọn sớm sao cho map được sang MicroPython về sau;
  - giáo trình chưa được người dạy duyệt;
  - **L8** (cảm giác như sản phẩm thật) vẫn chưa có người chạy thử, kể cả với PoC hiện tại;
  - template key là public contract: đổi tên hay xoá key làm hỏng content trong STEMLearning.

---

## 17. Recommended MVP scope

> ⚠️ **Superseded (2026-10-13).** MVP mới chia theo phase YB-0…YB-9 trong `docs/yolobit-compatible-board-implementation-plan.md` §21. Thay đổi chính: có YB-0 trước khi chốt contract; generator MicroPython nằm trong phạm vi bắt buộc; Basic chạy trên board family tương thích Yolo:Bit, không chạy trên `board` generic.

**MVP = Basic Board chạy được bài 1–8 ở §15, trong cùng app và cùng contract nhúng.** Chia theo outcome để mỗi bước có thứ nhìn thấy được, giống cách plan PoC chia slice:

| Bước | Outcome nhìn thấy được | Nội dung chính |
|---|---|---|
| **BB-1. Board profile + onboard** | Bài 1–3 chạy được **không cần nối dây**: LED onboard sáng, giữ nút A thì LED sáng | `BoardProfile` (capability, onboard), board renderer, nối thiết bị onboard vào netlist, toolbox sinh từ profile. Template cũ vẫn mở được |
| **BB-2. IR v1** | Bài 4–5: đếm số lần nhấn, in ra console; đèn giao thông bằng `repeat` | Số, biến, so sánh, and/or, toán, `repeat`/`while`, `print` + console panel |
| **BB-3. Signal-level I/O** | Bài 6–8: kéo slider ánh sáng thì đèn ngủ bật/tắt; LED "thở"; còi kêu | analog read + slider, PWM + độ sáng, tone + biểu tượng/âm thanh, potentiometer |
| **BB-4. Lesson templates** | STEMLearning mở được từng bài bằng key mới | Template key cho bài 1–8; mở thử trong StemLab |

**Nên có nếu còn thời gian** (theo thứ tự): event `when button pressed` (bài 9), highlight block đang chạy, Python read-only.

**Ngoài MVP:** Advanced Board, Python runtime, board thật, mô phỏng điện, `postMessage`/chấm bài (trừ khi owner đổi ưu tiên), robot.

---

## 18. Owner decisions (trước đây: Open questions)

> Cập nhật 2026-10-13. Mười câu hỏi ban đầu đã được owner trả lời. Cột "Hệ quả" là PLANNING DECISION của người lập plan. Câu hỏi **còn mở** sau các quyết định này nằm ở plan §25.

### 18.1 Quyết định

| # | OWNER DECISION | Hệ quả (PLANNING DECISION) |
|---|---|---|
| Q1 — Board vật lý | **Không** tích hợp board vật lý trong MVP hiện tại; chưa làm upload qua Web Serial/BLE. Nhưng code sinh ra phải nhắm **Yolo:Bit MicroPython ngay từ đầu**. Hỗ trợ board vật lý là phase transport/execution sau này, không phải lý do để đặt ra API không tương thích | Generator là MUST (D6). Gate "physical-board verified" để sau, khi có phần cứng |
| Q2 — Người học | Basic: **THCS (khoảng lớp 6–9)**, cũng dùng được làm lộ trình nhập môn cho người lớn hơn. Advanced: **cuối THCS → THPT**, sau khi đã nắm Basic. Không ép UI theo đúng độ tuổi. Basic phải hỗ trợ cả **học onboard trước** lẫn, sau đó, **học với header/mạch ngoài** | Profile Basic có hai nhóm bài: onboard (không nối dây) và header (nối dây trên canvas) |
| Q3 — Python | Milestone này: **soạn bằng block là chính**; **Yolo:Bit MicroPython sinh ra = MUST**; Python sửa được = Later; Python runtime trong browser = Later | Python hiển thị read-only + copy/tải `.py`. Không Monaco, không Pyodide |
| Q4 — `board` hiện có | **Giữ nguyên**, không biến thành Yolo:Bit. Tạo board/profile tương thích Yolo:Bit **song song**. Bắt buộc tương thích ngược | Generic board, block, IR kind và template cũ không đổi. Regression test bắt buộc ở mỗi phase |
| Q5 — Ma trận Advanced | Board ảo của mình: **8×8 một màu trước, RGB sau**. Nhưng nếu ngữ nghĩa sinh code Yolo:Bit đòi theo display model thật thì phải tách **biểu diễn display ảo** khỏi **API output Yolo:Bit**, không được tuyên bố tương đương vật lý khi kích thước khác nhau. Nếu mismatch là không tránh được thì nêu rõ ở YB-0 và đề xuất phương án an toàn trước khi triển khai | **Rủi ro mismatch cao:** PRIOR cho thấy Yolo:Bit là 5×5 RGB, còn `display.show(Image.HEART)` và toạ độ pixel phụ thuộc kích thước. Khuyến nghị tạm thời (chờ YB-0 xác nhận và owner duyệt lại): **phương án A**, tức display ảo của board family **khớp display model của Yolo:Bit** (kích thước, gốc toạ độ). "Một màu trước" giữ dưới dạng *chỉ mở API không phụ thuộc màu*, render bằng màu mặc định; API màu mở sau. Lập luận đầy đủ: plan §7.4. **Owner decision (2026-10-14):** tương thích ngữ nghĩa với Yolo:Bit **ưu tiên hơn** ưu tiên tạm 8×8. 8×8 **không** freeze. **Nghĩa vụ YB-0:** xác lập ngữ nghĩa display logic thật của Yolo:Bit (kích thước, toạ độ, màu, độ sáng, hình). **Freeze checkpoint:** sau evidence YB-0, trình **owner xác nhận lần cuối** model display logic **trước khi** implement capability display (plan §7.4, OQ-E). Khuyến nghị của reviewer là input kỹ thuật, không phải thẩm quyền thay owner. Nếu YB-0 không xác lập được model thì mọi construct display bị loại (plan §7.4) <br>**OQ-E APPROVED (2026-10-14):** model display cuối = 5×5 RGB, toạ độ 0-based, gốc trên-trái, `x` = cột, `y` = hàng, màu hex, mặc định đỏ (contract §4.3). |
| Q6 — Thang analog | **Giá trị lập trình của chân analog: 0–1023. UI cảm biến onboard: 0–100 %.** Quy tắc chuyển đổi phải tường minh | Xem 18.2. Giá trị mà API cảm biến onboard của Yolo:Bit trả về (vd. mức sáng) theo **thang native của Yolo:Bit** do YB-0 xác định; % chỉ là thang của UI <br>**Đã thay (C-Q6 = Option A, 2026-10-14):** analog read dùng thang native **0–4095** (tài liệu OhStem), UI vẫn 0–100 %, **không** chuẩn hoá về 0–1023; PWM EXCLUDED (contract §10.2, plan §3 Q6). |
| Q7 — Hoàn thành/chấm bài | **Không** thuộc milestone board này. Giữ lifecycle/completion StemLab hiện tại (`OnView`). `postMessage`, chấm bài là phase riêng sau này, không được chặn việc board/runtime | Không thêm kênh nào giữa iframe và STEMLearning |
| Q8 — Ngôn ngữ UI | Giữ tiếng Anh cho milestone này. Kiến trúc và định nghĩa text không được cản i18n sau này. Không viết lại i18n bây giờ | Text của block và runtime control nằm trong data, không hard-code rải rác |
| Q9 — Buzzer | Có âm thanh thật qua **WebAudio** nếu khả thi, **mặc định tắt** khi nhúng trong lớp học. **Luôn có trạng thái hình ảnh** để bài học vẫn hiểu được khi tắt tiếng. Code sinh ra map sang API sound/music của Yolo:Bit do YB-0 xác định | Audio là một "renderer" ở UI, đọc state từ snapshot; core không biết WebAudio |
| Q10 — Lưu bài làm | Lab nhúng: **không lưu** project của learner trong milestone này; reload → template sạch. Standalone giữ hành vi hiện tại. Không mở rộng phạm vi persistence | Không đổi `startup.ts`/`launch.ts` về persistence |

### 18.2 Quy tắc chuyển đổi analog (PLANNING DECISION theo Q6)

> **Superseded một phần (2026-10-14, C-Q6 = Option A):** thang 0–1023 dưới đây được thay bằng thang native **0–4095** cho analog read (`percentToNative(p, 4095)`). Các dòng về ghi analog/PWM và duty không còn áp dụng (PWM EXCLUDED). Quy tắc hiện hành: plan §11.3, contract §10.2. Bảng giữ lại làm lịch sử.

Mọi chuyển đổi nằm ở **một module trong core**, có unit test. Không có làm tròn hay chặn ngầm ở chỗ khác.

| Chuyển đổi | Quy tắc | Ví dụ |
|---|---|---|
| Slider UI → % | `p` là số nguyên `0…100`, bước 1. Giá trị ngoài khoảng bị chặn về biên **trước** mọi phép tính | — |
| % → giá trị analog của chân | `raw = round_half_up(p × 1023 / 100)`, với `round_half_up(x) = floor(x + 0.5)` (x ≥ 0) | 0 → 0; 50 → 512 (511,5 làm tròn lên); 100 → 1023 |
| Giá trị chân → % (chỉ để hiển thị) | `p = round_half_up(raw × 100 / 1023)` | 512 → 50; 1023 → 100 |
| Program ghi analog/PWM | Giá trị hợp lệ (supported domain): số nguyên `0…1023`. Ngoài khoảng → **domain guard** (plan §6.2): simulator dừng với diagnostic `out-of-domain` có `blockId`, và lần chạy đó **không có tuyên bố tương thích**. Đây là từ chối mô phỏng, **không** phải đoán hành vi của Yolo:Bit. (Domain chỉ có số nguyên, nên giá trị không nguyên không thể xảy ra, plan §6.4.) Nếu YB-0 có evidence VERIFIED/DOCUMENTED về chặn/làm tròn của Yolo:Bit thì domain có thể mở để mô phỏng **đúng** hành vi đó. *(Sửa 2026-10-14; bản trước ghi "lỗi runtime fail loud" như thể đó là ngữ nghĩa.)* Bản thân thang 0–1023 cũng phải qua EG (`OF-range`) trước khi analog/PWM được mở | — |
| Duty để render (độ sáng LED ngoài) | `duty = raw / 1023` | 512 → 0,5005 |
| % → giá trị cảm biến onboard mà API Yolo:Bit trả về | `value = round_half_up(p × N / 100)`, với `0…N` là thang native YB-0 xác định. Nếu API trả về % thì `N = 100` (đồng nhất). Nếu YB-0 **không** xác lập được thang native (và đơn vị/làm tròn) thì cảm biến đó **không được mở** (EG, plan §6.2); không dùng thang đoán | Chờ YB-0 |

### 18.3 Câu hỏi ban đầu (lịch sử, đã được trả lời ở 18.1)

| # | Câu hỏi cho owner | Vì sao quan trọng | Mặc định nếu chưa trả lời |
|---|---|---|---|
| Q1 | Sẽ có **board vật lý** đi kèm giáo trình không? Nếu có thì board nào, chạy firmware gì? | Quyết định có cần Option B (MicroPython) sớm và API block phải khớp board thật tới mức nào | Không có board thật trong MVP; giữ A |
| Q2 | Độ tuổi/lớp mục tiêu của Basic và Advanced? | Chọn mức "onboard, không nối dây" hay "nối dây kiểu Arduino" làm mặc định; độ khó block | Basic dùng được cả hai cách (§10.1) |
| Q3 | Giáo trình có phần **Python text** không, và từ lớp mấy? | Kích hoạt Option B | Chỉ Python read-only |
| Q4 | Basic Board là **mở rộng `board` hiện tại** (giữ id, template cũ chạy tiếp) hay một device mới? | Tương thích với content đã có trong STEMLearning | Mở rộng `board` hiện tại |
| Q5 | Kích thước ma trận của Advanced: 5×5 (phổ biến trong giáo trình kiểu micro:bit) hay 8×8 (chữ/hình rõ hơn, khác biệt với Yolo:Bit)? Một màu hay RGB? | Ảnh hưởng block hiển thị, font, renderer | 8×8 một màu |
| Q6 | Thang analog: 0–1023, 0–4095 hay %? | Bài học và tương thích board thật | 0–1023 cho `analog read`, % cho cảm biến onboard |
| Q7 | StemLab có cần **báo hoàn thành/chấm bài** (`postMessage`) trong phase tới không? | Đổi completion mode từ `OnView`, thêm contract hai repo | Chưa làm trong MVP |
| Q8 | UI simulator cần tiếng Việt không? | Toàn bộ UI và block hiện là tiếng Anh (CLAUDE.md) | Giữ tiếng Anh, chuẩn bị i18n sau |
| Q9 | Có cần âm thanh thật (WebAudio) cho buzzer trong lớp học không? | Lớp học đông, iframe | Có, mặc định tắt |
| Q10 | Có lưu bài làm của learner không (D-17)? | Basic có bài dài hơn (dự án) | Không lưu, như hiện tại |
