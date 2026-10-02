# OhStem Demo Reconstruction Specification

> Ngày audit: 2026-10-02 · Build app: `js/app.48bdaa95.js`, static `?v=20260924205808`.
> Tiếp nối từ `docs/ohstem-platform-investigation.md`. Tài liệu này không lặp lại phần tổng quan.
> Tài sản đi kèm: `docs/ohstem-reconstruction-assets/` gồm ~165 ảnh chụp và `data/` với 18 file JSON đã sanitize.
>
> **Phương pháp:**
> - Dùng Playwright + Chrome 155 với profile riêng cho từng module. Thao tác UI thật bằng chuột và bàn phím.
> - Sau mỗi thao tác, dump state trong bộ nhớ (React instance đọc qua fiber) và IndexedDB/localStorage. Bọc `window.Worker` để ghi lại toàn bộ message giữa main thread và worker.
> - Đọc chunk webpack đã beautify để giải thích các hành vi đã quan sát.
> - Không đăng nhập, không gọi endpoint backend thủ công. Profile test (có dữ liệu AI mẫu tổng hợp) đã được xoá sau khi thu thập.

**Nhãn bằng chứng**

| Nhãn | Ý nghĩa |
|---|---|
| **[UI]** | VERIFIED BY UI: thấy trên màn hình hoặc ảnh chụp sau thao tác thật |
| **[RT]** | VERIFIED BY RUNTIME/NETWORK: state trong bộ nhớ, IndexedDB, localStorage, message worker, request mạng |
| **[SRC]** | VERIFIED BY SOURCE: đọc trong chunk/static JS hoặc XML/JSON công khai |
| **[INF]** | INFERRED: suy luận từ các bằng chứng trên |
| **[UNK]** | UNKNOWN |

---

## 1. Executive Summary

Sau vòng audit này, một developer có thể dựng demo mà không cần mở lại OhStem cho các phần sau:

| Mảng | Mức độ đầy đủ | Ghi chú |
|---|---|---|
| Circuit Builder | **Rất cao** | Đủ layout, gesture, schema project/component/wire/port, catalog 41 linh kiện, solver MNA, lỗi cháy/chập, protocol worker Python ↔ mạch. Đã chạy end-to-end thật |
| Blockly workspace | **Cao** | Cấu hình `inject` của 2 editor, toolbox 3 thiết bị, customization, 6 case sinh code với output thật |
| Python simulation | **Cao** | Pyodide worker, message `init/run/stop/portData/cmd(writePort…)`, ánh xạ GPIO → chân, cập nhật pin, ADC |
| Robot Project Builder | **Trung bình–cao** | Schema `vrb-project` v2, part XML → runtime, kit Rover, validator/auto-fix, robot chạy được bằng Python. Chưa đọc được toạ độ pose số |
| Map Builder | **Trung bình** | Schema world/scene, editor option, part pack. Chưa thao tác thêm object bằng UI |
| AI Trainer | **Cao** | Flow đầy đủ (upload → train → save), schema IndexedDB/localStorage, hyperparameter |
| IoT Dashboard | **Trung bình–cao** | Schema widget/grid/kênh, mapping MQTT topic. Bước "lưu" chỉ xác minh qua source |

**10 điều quan trọng nhất cho implementation**

1. **Circuit Builder là app PixiJS v7 (WebGL), không phải SVG/DOM.**
   - Canvas chiếm (viewport − 320 px) × (viewport − 49 px). Panel phải cố định 320 px, đổi qua lại giữa palette và inspector.
   - Lưới snap 10 px. Bán kính bắt dính chân là 24 px (world unit). Zoom bằng wheel ×1.12 trong khoảng 0.25–4. Pan bằng cách kéo vùng trống.
   - [UI][RT][SRC]
2. **Project mạch rất gọn:**
   - `components[{id,type,x,y,rotation(rad),flipX?,params}]`.
   - `wires[{id,from{componentId,portId},to{…},breakpoints[{x,y}],color}]`.
   - Port **không** lưu trong project: vị trí tuyệt đối tính từ catalog (`dx,dy` + xoay + lật).
   - Lưu vào IndexedDB `CircuitProjectDB/circuits`. File export dạng `{format:"ohstem-circuit",version:1,…}`.
   - [RT]
3. **Kết nối điện dùng union-find trên khoá `"<componentId>/<portId>"`.**
   - Breadboard có 420 port. Các nhóm nối nội bộ (`internalConnections`, 64 nhóm) được gộp thành cùng một net.
   - Net ground được chọn theo thứ tự: linh kiện `ground` → cực `neg` của nguồn → `groundPortId` của board.
   - [SRC][RT]
4. **Solver là DC operating point bằng MNA.**
   - Mỗi element có `stamp(addG/addB/addC/addD/addI/addE)`. Linh kiện phi tuyến (LED/diode/BJT) giải bằng Newton (tối đa 500 vòng, vTol 1e-6).
   - Mạch được giải lại **mỗi khi model thay đổi**, kể cả lúc đang thiết kế. Vì vậy LED có thể "cháy" ngay khi vừa nối dây.
   - LED cháy khi I > 30 mA (đã quan sát: 31.7 mA → cháy). Trạng thái cháy được lưu vào `params._broken`.
   - [RT][SRC]
5. **Pipeline Blockly → mạch đã chạy được end-to-end:**
   - Blockly → Python async → Worker Pyodide 0.29.3 (JSPI) → `machine.Pin(48)` → `{type:"cmd",cmd:"writePort",port:"48",value:1}` → ánh xạ GPIO48 → `d13` → `pinStates.d13={mode:"digital_out",value:1}` → stamp nguồn 3.3 V qua 30 Ω → LED 2.8 mA → render.
   - Chiều ngược lại: điện áp chân → `portData` (ADC 0–4095) gửi vào worker.
   - [RT]
6. **Editor thiết bị và tab code của thiết bị ảo dùng hai cấu hình Blockly 8.0.1 khác nhau:**
   - Editor thiết bị: geras, theme classic, có grid và âm thanh, có trashcan custom, copy/paste qua localStorage, prompt numpad/piano.
   - Tab code thiết bị ảo: zelos, có ô tìm kiếm, không có âm thanh.
   - Toolbox là XML có placeholder `{{MSG}}`.
   - [RT][SRC]
7. **Code sinh ra nằm gần như toàn bộ trong `definitions_` theo prefix.**
   - Block sự kiện (`uno_event_start/forever`) trả về chuỗi rỗng. `finish()` lắp khung chương trình theo board: Yolo UNO dùng asyncio `setup/main/run_loop`, Yolo:Bit dùng `while True`, xBot nối block tuần tự.
   - Đã xác minh bằng 6 case thật.
   - [RT]
8. **Robot 3D (GEARS fork) có project slim:**
   - Chỉ lưu `_part_id` cùng position/rotation/port/override. Khi nạp, ghép lại với `defaultConfig` của part trong toolbox XML (`designDataUtils.dehydrate/rehydrate`).
   - Part là XML khai báo (`<config>` = giá trị mặc định, `<option>` = control của editor). Đây là mẫu tốt cho CMS.
   - [SRC][RT]
9. **Map vừa là world option (nền, tường, timer, chấm điểm, giới hạn robot) vừa là danh sách part, dùng chung engine với robot ("map mode").**
   - Đường line cho cảm biến dò line là **ảnh texture của nền**, không phải đối tượng hình học.
   - [SRC][RT]
10. **AI trainer và IoT dashboard là hai CRUD app nhỏ, độc lập:**
    - AI: TF.js Teachable Machine (denseUnits 100, epochs 30, lr 0.001, batch 16, early-stop 5). Mẫu lưu IndexedDB, model lưu `indexeddb://<projectId>`, metadata trong localStorage.
    - IoT: react-grid-layout 60 cột. Widget gắn kênh V1–V20, ánh xạ sang topic MQTT `<botName>/feeds/V<n>`.
    - [RT][SRC]

---

## 2. Demo Scope Recommendation

**Demo đầu tiên nên là “A + B hợp nhất”: Circuit + Blockly điều khiển board ảo.**

Đây chính là phần OhStem làm khác biệt nhất. Phần này cũng có độ rủi ro kỹ thuật vừa phải: solver đơn giản và runtime Python đã có sẵn bằng Pyodide.

| Demo | Giá trị | Độ khó | Rủi ro | Khuyến nghị |
|---|---|---|---|---|
| A — Circuit (pin, điện trở, LED, nút, board) | Cao (dạy điện học) | Trung bình (canvas + MNA nhỏ) | Thấp | **Làm đầu tiên** |
| B — Blockly → code → Run → LED ảo | Cao (dạy lập trình) | Trung bình (Blockly + generator + Pyodide) | Trung bình (Pyodide worker, đồng bộ sleep) | **Gộp với A** để chạy được `Blockly → board ảo → LED` |
| C — Robot 3D + cảm biến khoảng cách + tường | Cao (robotics) | Cao (3D, physics, ray-cast, part model) | Cao | Làm sau. Có thể làm **bản 2D top-down** trước |

**Phạm vi đề xuất cho MVP (A+B):**

- **Linh kiện:** Battery (1.5–9 V), Resistor, LED (4 màu), Pushbutton, Switch, Ground, “UNO-like Board” (D2–D13, A0–A5, 3V3, 5V, GND).
- **Thao tác:**
  - đặt linh kiện, kéo, xoay ±90°, lật, xoá
  - nối dây từ chân tới chân, thêm điểm uốn, đổi màu dây
  - inspector tham số
  - undo/redo, nhân bản
  - zoom/pan
  - Run/Stop
  - lưu IndexedDB, xuất/nhập JSON
- **Lập trình:** Blockly (start, forever, LED on/off, sleep, if, đọc nút, đọc analog), toggle sang Python, terminal.
- **Runtime:** Pyodide trong Worker. Shim `machine` (Pin, PWM, ADC), `time.sleep` đồng bộ.
- **Ngoài phạm vi MVP:** breadboard (để phase 2), transistor, relay, motor, servo, MQTT, chế độ C.

---

## 3. Screen Inventory

| Màn hình | Route (hash `#!/…`) | Ảnh | Bằng chứng |
|---|---|---|---|
| Circuit Builder – Thiết kế | `/vr/circuit-builder` | `circuit-01-default-full.png` | [UI] |
| Circuit – inspector linh kiện | (chọn linh kiện) | `circuit-04-inspector-resistor.png`, `circuit-66-inspector-led.png`, `circuit-67-inspector-battery.png` | [UI] |
| Circuit – inspector dây | (chọn dây) | `circuit-05-inspector-wire.png` | [UI] |
| Circuit – menu danh mục palette | dropdown | `circuit-62-palette-category-menu.png` | [UI] |
| Circuit – menu màu dây | `arrow_drop_down` | `circuit-64-wire-color-menu.png` | [UI] |
| Circuit – menu Chia sẻ/Xuất | 📂 | `circuit-51-open-menu.png` | [UI] |
| Circuit – đang chạy | Run | `circuit-46-run-click-led.png`, `circuit-07-running-canvas.png` | [UI] |
| Circuit – LED cháy | sau khi nối dây | `circuit-28-wire-close-loop.png`, `circuit-65-burn-fault.png` | [UI][RT] |
| Circuit – tab Lập trình (có board) | tab 💻 | `uno-03-program-blink-blocks.png`, `uno-04-program-python-view.png`, `uno-06-running-terminal.png`, `uno-07-python-machine-pin.png` | [UI] |
| Circuit – tab Lập trình (không board) | tab 💻 | `circuit-69-program-tab-no-board.png` | [UI] |
| Circuit – responsive | 1024/768/420 | `circuit-resp-*.png` | [UI] |
| Editor thiết bị (Yolo UNO/Yolo:Bit/xBot) | `/codes/<device>` | `blockly-<dev>-01-default.png`, `blockly-<dev>-cat-NN.png` | [UI] |
| Editor – context menu | chuột phải | `blockly-yolobit-ctx-block.png`, `blockly-*-ctx-workspace.png` | [UI] |
| Editor – chế độ Python | toggle | `codegen-case*-python.png` | [UI] |
| Project Builder – Thiết kế/Lập trình/Giả lập | `/vr/project-builder` | `robot-01…03`, `robot-12-select-wheel-inspector.png`, `robot-15-simulate-tab.png`, `robot-21-rover-only.png`, `robot-23-program-python.png` | [UI] |
| Project Builder – preflight lỗi | Run | `robot-24b-preflight-dialog.png`, `robot-25-simulating.png` | [UI] |
| Project Builder – kết thúc sim | | `robot-26-sim-end.png` (robot đã đi và quay) | [UI] |
| Map Builder | `/vr/map-builder` | `map-01-default.png`, `map-02-template-popup.png`, `map-04-after-save.png` | [UI] |
| AI Trainer | `/ai/new/image` | `ai-01…08` | [UI] |
| IoT Dashboard | `/iot-panels/new` | `iot-01…09`, `iot-06c-widget-menu.png` | [UI] |

---

## 4. Exact UI Layout

### 4.1 Circuit Builder (viewport 1440×900) [UI][RT]

```text
┌──────────────────────────────────────────────── ide-header (h=49) ─────────────────────────────────────────────┐
│← Mạch điện [tên project 135px] [💾 43] [📂 44] │🔧Thiết kế│💻Lập trình│ [▶ Chạy 82] ↶ ↷ ⧉ 🗑 ⟲ ⟳ ⇋  [■▾ màu dây] │
├────────────────────────────────────────────────────────────────────────────────────┬───────────────────────────┤
│ cb-canvas-wrap  (x=0,y=49, w=W−320, h=H−49)                                       │ cb-right-panel (w=320)    │
│   PixiJS canvas, nền #F5F7FA, lưới                                                │ [▾ 🧰 Thành phần cơ bản]  │
│   badge "▶ Đang chạy giả lập" góc phải trên (khi chạy)                            │ lưới card 3 cột (cuộn)    │
│                                                                                   │ … hint 32px:              │
│                                                                                   │ "Chọn linh kiện rồi nhấn  │
│                                                                                   │  lên khung vẽ"            │
└────────────────────────────────────────────────────────────────────────────────────┴───────────────────────────┘
```

| Vùng | Vị trí / kích thước | Resize | Collapse | Cuộn | Responsive | Icon/nút | Tooltip | Phím tắt |
|---|---|---|---|---|---|---|---|---|
| Header | 0,0, W×49 | không | không | không (tràn ngang khi hẹp) | ≤1024: nhãn tab chỉ còn icon (tab-bar 234→102 px). Không wrap → tràn ở <1000 px | ← back 30×30 | “Quay lại” | – |
| Tên project | 149,9, 135×30 | không | – | – | – | input | – | – |
| Lưu | 296,10, 43×29 | – | – | – | – | 💾 + chấm cam khi dirty | “Lưu vào trình duyệt” / “Có thay đổi chưa lưu” / “Đã lưu” | – |
| Chia sẻ/Xuất | 351,10, 44×29 | – | – | – | – | 📂 → dropdown “Chia sẻ mạch”, “Xuất JSON” | “Chia sẻ / Xuất” | – |
| Tab Thiết kế / Lập trình | 407,6, 234×37 | – | – | – | – | 🔧 / 💻 | – | – |
| Run/Stop | 664,8, 82×32 | – | – | – | – | xanh “▶ Chạy” ↔ đỏ “■ Dừng” | “Chạy giả lập” / “Dừng” | – |
| Toolbar | 38×30, cách nhau 52 px từ x=765 | – | – | – | – | undo, redo, content_copy, delete, rotate_left, rotate_right, swap_horiz | “Hoàn tác (Ctrl+Z)”, “Làm lại (Ctrl+Shift+Z)”, “Nhân bản (Ctrl+D)”, “Xóa (Delete)”, “Xoay ngược…”, “Xoay theo…”, “Lật ngang” | Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, Ctrl+D, Delete/Backspace, Ctrl+A, Esc |
| Màu dây mặc định | 1133,14, 52×20 | – | – | – | – | swatch + ▾, menu 12 màu | “Màu mặc định cho dây mới” | – |
| Canvas | 0,49, (W−320)×(H−49) | theo viewport | không | pan bằng kéo | co theo viewport (420 px → canvas chỉ còn 100 px) | không có nút zoom | – | wheel zoom, pinch |
| Panel phải: palette | 1120,49, 320×851 | không | không | lưới card `overflow:auto` | rộng cố định | dropdown danh mục 299×36, card ~97×100 | – | – |
| Panel phải: inspector | thay palette khi có selection | – | – | – | – | “← Linh kiện”, tiêu đề, ✕ đỏ | “Quay lại danh sách linh kiện”, “Xóa” | – |
| Khung trạng thái/lỗi | Không có thanh trạng thái riêng. Linh kiện cháy hiện hiệu ứng nổ trên canvas + `_broken`. Câu thông báo lỗi lấy từ i18n (`fault_led_burnt`…), **vị trí hiển thị DOM: [UNK]** | | | | | | | |

**Tab Lập trình** (ảnh `uno-06-running-terminal.png`) [UI][RT]:

- Header thêm toggle “Khối lệnh / Python” (775,6, 114×36; title “Lập trình khối lệnh” / “Lập trình Python”).
- Vùng Blockly 0,49, W×669. Toolbox bên trái rộng ~216 px, có ô “Tìm kiếm blocks…”, category kèm icon màu.
- Terminal dock dưới cùng cao 182 px: header 34 px “Terminal” bấm để thu/mở, body `pre` cuộn, có nút xoá.
- Không có chia đôi canvas/code: hai tab thay thế nhau.

### 4.2 Editor thiết bị `/codes/<device>` [UI][RT]

- **Navbar trong suốt cao 64 px.**
  - Trái: back.
  - Giữa–phải: toggle khối/Python (2 nút 44×42), ô tên project.
  - Bên phải là 5 nút tròn 44×44: lưu, project, cài đặt, Bluetooth, USB.
- **Toolbox** 0,64, 206×832, cuộn. Mỗi category là nút màu đặc 190×40, chữ hoa trắng, có icon Font Awesome. Category lồng nhau dùng “NÂNG CAO” (collapsible); “MỞ RỘNG” ở cuối.
- **Workspace** chiếm toàn bộ phần còn lại.
- **FAB** góc phải dưới: ▶ xanh dương (1381,771) và ■ đỏ (1381,831).
- Panel tài liệu (iframe `docs.ohstem.vn`), terminal (xterm) và biểu đồ (ApexCharts) đều có thể bật/tắt (key `document-visible`, `terminal-visible`).

### 4.3 Project Builder / Map Builder [UI]

```text
┌ header 48: ← Project Builder [tên] 💾 📂 │✏️Thiết kế│💻Lập trình│🎮Giả lập│ [▶] … ? ┐
│┌ cây "THÀNH PHẦN THIẾT KẾ" (nổi, ~200px) ┐                            ┌ panel phải ~280px ┐│
││ Body / Caster / Left Motor DB / …        │   Babylon canvas 3D        │ Palette: dropdown │ │
│└──────────────────────────────────────────┘   gizmo: ☰ ✥ ⟲            │ + 5 tab icon      │ │
│                                    [⊞ 8mm|4mm|1mm] [✕ N lỗi]       │ hoặc Inspector    │ │
└────────────────────────────────────────────────────────────────────┴───────────────────┘
```

- **Tab Giả lập:**
  - Thanh trái gồm reset, chọn sa bàn, thước đo, tay cầm ảo.
  - Panel phải “HUB PANEL” gồm ảnh board có slider cảm biến tích hợp, ảnh robot, % từng motor, đèn cảm biến line.
  - Terminal thu gọn ở đáy.
  - Ảnh: `robot-15-simulate-tab.png`.
- **Map Builder** dùng cùng khung. Header có Lưu / Xuất / Nhập / Sa bàn mẫu / Xuất bản / Sa bàn cloud, cùng undo/redo, nhân bản, xoá (`map-01-default.png`).

### 4.4 AI Trainer [UI]

- Cột trái: card cho từng nhóm (lớp), gồm tên có thể sửa, menu ⋮, nút “Webcam” / “Tải Lên”, dải thumbnail và số mẫu. Bên dưới là “⊕ THÊM NHÓM MỚI”.
- Cột phải: card “Huấn luyện” (nút “HUẤN LUYỆN MÔ HÌNH”, thông báo “Đã huấn luyện… Thời gian: 9,355 giây”) và card “Thử nhận diện” (cần webcam).
- Header: tên model, nút “LƯU MÔ HÌNH”.

### 4.5 IoT Dashboard [UI]

- **Chế độ thiết kế:**
  - Nền xám. Panel trái 240 px chứa 10 mẫu widget có thể kéo.
  - Header: ← “Bảng điều khiển” [tên] … “Username” [ô nhập] [▶ chuyển chế độ].
  - FAB “+” mở/đóng panel widget.
- **Chế độ chạy:** nền xanh đậm, nút ⬇ (xuất) và ✎ (về chế độ thiết kế).

---

## 5. Interaction Specification (Circuit Builder)

Mọi thao tác dưới đây đã được thực hiện bằng chuột/bàn phím thật. Diff đầy đủ nằm trong `data/circuit-diff-sequence.json`.

| # | Action | UI gesture | State trước → sau | Quan sát DOM/canvas | Thay đổi dữ liệu project | Hiệu ứng runtime |
|---|---|---|---|---|---|---|
| 1 | Thêm điện trở | Bấm card palette → con trỏ thành “ghost” → bấm lên canvas | `placingType:null→"resistor"→null` | Ghost bám theo chuột, snap 10 px | `+{id:"resistor_<t36>_<n>",type:"resistor",x,y,rotation:0,params:{resistance:470}}` | solve + emit. Undo `hist_add_component` |
| 2 | Thêm LED | như trên (`circuit-14/15`) | 3→4 linh kiện | – | `params:{forwardVoltage:2,color:"#ff3333"}` | – |
| 3 | Thêm pin | card “Pin” = `battery9V` (`circuit-16/17`) | 4→5 | – | `params:{voltage:9}` | – |
| 4 | Di chuyển | pointerdown lên thân linh kiện → kéo → thả | (440,200)→(560,240), kéo +123,+41 rồi làm tròn 10 | `circuit-60-dragging.png` | `x,y` | history `hist_move_component` gộp trong 500 ms |
| 5 | Xoay | chọn → `rotate_right` / `rotate_left` | `rotation: 0→1.5708→0→−1.5708` | Thân và chân xoay quanh tâm | `rotation` (rad, **không chuẩn hoá về dương**) | emit (không solve) |
| 6 | Lật | `swap_horiz` | `flipX:true` | `circuit-61-rotated-flipped.png` | `flipX` | – |
| 7 | Xoá | chọn + phím Delete, hoặc nút 🗑, hoặc ✕ trong inspector | 5→4→3 | Inspector đóng | Xoá linh kiện **và mọi dây nối tới nó** | solve |
| 8 | Nối dây | bấm chân A (bắt đầu `wireDraft`) → di chuột (ghost line) → bấm chân B | `wires +1` | Dây ghost; chân B highlight khi trong bán kính 24 px | `+{id:"wire_…",from:{componentId,portId},to:{…},breakpoints:[],color:"#27ae60"}` | solve. Có thể sinh lỗi cháy ngay |
| 9 | Điểm uốn | (a) đang vẽ dây, bấm chỗ trống; (b) double-click lên dây đã có (<350 ms, <8 px) | `breakpoints +1` | Góc bo tròn bán kính 14 | `breakpoints:[{x:610,y:200}]`, snap 10 + căn theo chân trong 12 px | (a) không có history riêng; (b) `hist_add_bendpoint` |
| 10 | Bỏ nối | bấm lên dây (chọn) → Delete | `wires −1` | Inspector dây (`circuit-05`) | xoá wire | solve. Nếu còn net lơ lửng → `solveError` “Không giải được mạch…” |
| 11 | Đổi thuộc tính | chọn → sửa input inspector → Enter | `resistance 220→1000` | `circuit-06-inspector-changed.png` | `params` merge | `hist_change_props` (gộp theo key) + solve |
| 12 | Chọn nhiều | Shift/Ctrl/Meta+click; Ctrl+A | `selection:{type:"component",id,ids:[…]}` | Khung chọn từng linh kiện | – | – |
| 13 | Copy/paste | **Không hỗ trợ Ctrl+C/V**. Dùng **Ctrl+D nhân bản** (offset +20,+20, nhân bản cả dây nội bộ giữa các linh kiện được chọn) | 3→6 | `circuit-39-duplicate.png` | id mới, dây mới | `hist_duplicate_components` |
| 14 | Undo/redo | Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / nút | stack ≤ 50 snapshot JSON | Nút redo disable khi rỗng | Thay toàn bộ components/wires | solve |
| 15 | Zoom/pan | wheel (×1.12 quanh con trỏ, 0.25–4); kéo vùng trống >4 px | `view.scale 1→1.405`, `view.x/y` | Lưới vẽ lại | **Không lưu** vào project | – |
| 16 | Run | “▶ Chạy” | `isRunning:false→true` | Nút đỏ “Dừng”, badge “Đang chạy giả lập”, nút sửa bị disable, chấm dòng điện chạy dọc dây, LED phát sáng | Gọi `resetFaults()` (xoá `_broken`). Snapshot trạng thái switch/battery.isOn/pinStates | Nếu có Yolo UNO: sinh Python → worker |
| 16b | Tương tác khi chạy | bấm switch (đảo `closed`), giữ pushbutton (`closed` khi giữ), xoay biến trở, kéo slider (LDR/TMP36/NTC/pin mặt trời), nút BOOT của board | `params` thay đổi với history tắt | – | Phục hồi về snapshot khi Stop | solve liên tục |
| 17 | Stop | “■ Dừng” | `isRunning→false` | Ngược lại bước 16 | Phục hồi snapshot | `worker.postMessage({type:"stop"})`, 600 ms sau `terminate()` |
| 18 | Lưu | 💾 | `dirty→false` | Nút hiện “Đã lưu” 1.5 s | IndexedDB `put({...,updatedAt:Date.now()})` | – |
| 19 | Huỷ dây đang vẽ | Esc | `wireDraft→null` | – | – | – |
| 20 | Esc khi đang đặt | Esc | `placingType→null` | – | – | – |

> Khi đang chạy, bấm vào linh kiện **không mở inspector**: `toggleRunning` đặt `selection=null`, và trong chế độ chạy click chỉ dùng cho tương tác ở bước 16b. Vì vậy không sửa được tham số (đã thử đổi sang 5 Ω, giá trị giữ nguyên) [RT][SRC]. Thao tác thiết kế (đặt/nối/xoá) bị chặn: `onPortPointerDown/onWirePointerDown` bỏ qua khi `isRunning` [SRC].

---

## 6. Project Data Models

### 6.1 CircuitProject [RT] (`data/circuit-project-idb-record.json`, `data/circuit-uno-export-bundle.json`)

```ts
// IndexedDB "CircuitProjectDB" v1, store "circuits", keyPath "id"
interface CircuitProject {
  id: string;            // "circ_" + Date.now().toString(36) + "_" + random6
  name: string;          // "Mạch điện mới"
  circuit: { components: ComponentInstance[]; wires: Wire[] };
  scripts: Record<string /* componentId của board */, BoardScript>;
  updatedAt: number;     // ms
}
interface ComponentInstance {
  id: string;            // `${type}_${Date.now().toString(36)}_${counter.toString(36)}`
  type: string;          // khoá trong catalog (vd "resistor", "yoloUno")
  x: number; y: number;  // world px, bội số của 10
  rotation: number;      // radian, bước ±π/2, cộng dồn modulo 2π
  flipX?: boolean;
  params: Record<string, unknown> & {
    _broken?: boolean;   // LED/bóng đèn/tụ cháy (runtime nhưng có thể bị lưu!)
    pinStates?: Record<PinId, PinState>; // chỉ yoloUno; reset khi Stop
    bootPressed?: boolean;
  };
}
interface Wire {
  id: string;            // "wire_..."
  from: { componentId: string; portId: string };
  to:   { componentId: string; portId: string };
  breakpoints: { x: number; y: number }[];
  color?: string;        // "#27ae60" mặc định
}
type PinState = { mode: "digital_out"; value: 0 | 1 } | { mode: "pwm"; duty: number /*0..1023*/ };
interface BoardScript { boardType: "yolouno"; label: string; xmlText: string; python: string; c: string }
// Export ("Xuất JSON"):
interface CircuitExport { format: "ohstem-circuit"; version: 1; name: string; circuit: CircuitProject["circuit"]; scripts: CircuitProject["scripts"] }
```

**Chuỗi diff đã quan sát** (rút gọn):

```jsonc
// empty → +LED
{"added":[{"id":"led_muqjbx1r_4","type":"led","x":860,"y":160,"rotation":0,"params":{"forwardVoltage":2,"color":"#ff3333"}}]}
// + wire battery.pos → resistor.a
{"addedWires":[{"id":"wire_muqjc65x_6","from":{"componentId":"battery_…_1","portId":"pos"},"to":{"componentId":"resistor_…_2","portId":"a"},"breakpoints":[],"color":"#27ae60"}]}
// + wire có điểm uốn
{"addedWires":[{"from":{"…":"resistor","portId":"b"},"to":{"…":"led","portId":"anode"},"breakpoints":[{"x":610,"y":200}]}]}
// đổi giá trị điện trở
{"changed":{"params":{"resistance":220}} → {"params":{"resistance":1000}}}
// đóng mạch với 220 Ω @ 9 V → LED cháy (persisted flag)
{"changed":{"params":{"forwardVoltage":2,"color":"#ff3333"}} → {"params":{…,"_broken":true}}}
```

**Port** không lưu trong project. Vị trí tuyệt đối được tính như sau [SRC]:

```ts
absX = c.x + (dx * (c.flipX ? -1 : 1)) * cos(rot) - dy * sin(rot)
absY = c.y + (dx * (c.flipX ? -1 : 1)) * sin(rot) + dy * cos(rot)
```

**Runtime state** (không lưu) [RT]:

```ts
lastSolution = {
  nodeVoltages, extraCurrents,
  nodeIndexByName: { gnd: 0, net_1: 1, … },
  componentStates: Map<id, state>,
}
```

Ví dụ state: `led → {voltage, current, broken}`, `battery → {voltage, current, shortCircuit}`, `yoloUno → {pins:{d0..a5:V}, v3v3, v5v}`.

### 6.2 Code project của editor thiết bị [RT] (`data/device-code-project-localstorage.json`)

```ts
// localStorage (store.js JSON):
//   "<device>-code" = DeviceCodeProject[]
//   "<device>-current-project-id" = uuid
interface DeviceCodeProject { id: string /*uuid v4*/; name: string; xmlText: string; python: string; mode: "block" | "python"; updatedAt: number }
```

### 6.3 Robot / Map / AI / IoT

Xem mục 11–14 và các file trong `data/`.

---

## 7. Circuit Builder

### 7.1 Component catalog → runtime → render → serialization [SRC][RT]

```text
palette card (78440: danh sách type theo 4 danh mục)
  → model.addComponent(type, x, y) ; type = khoá trong catalog 61882.ne
  → catalog def { labelKey|label, solverType, width, height, ports[{id,dx,dy,labelKey}], portOrder,
                   defaultParams, paramSpec[{key,type:number|boolean|toggleButtons|colorChoice|slider,min,max,step,options}],
                   internalConnections?, groundPortId?, runInteractiveSlider?, dynamicWidth? }
  → solver: element factory 54428 { solverType → class } ; class.stamp/extractState
  → render: CircuitCanvas (68795) vẽ từng type bằng PIXI Graphics/Sprite trong componentLayer ("No renderer for type" nếu thiếu)
  → serialization: { id, type, x, y, rotation, flipX?, params }
```

Catalog đầy đủ 41 type nằm trong `data/circuit-component-catalog.json`. Dưới đây là các linh kiện được yêu cầu:

| type | Chân (dx,dy) | Tham số (mặc định) | Asset | Lớp mô phỏng |
|---|---|---|---|---|
| resistor | a(−40,0) b(40,0) | resistance 470 Ω | vẽ dải màu theo giá trị | `resistor` (G=1/R) |
| led | anode(−10,30) cathode(10,30) | forwardVoltage 2, color #ff3333 (4 lựa chọn) | thân + quầng sáng | `led`: Shockley n=2, Vt=0.02585, Is chọn sao cho I=20 mA tại Vf, **iMax 30 mA → _broken** |
| rgbLed | red(−30,30) green(−10,30) blue(10,30) cathode(30,30) | vfRed 2, vfGreen 2.2, vfBlue 3.2 | | `rgbLed` |
| pushbutton | a1(−20,−20) a2(−20,20) b1(20,−20) b2(20,20); internal [a1,a2],[b1,b2] | closed false | | `switch` |
| switch | a(−40,0) b(40,0) | closed false | | `switch` |
| potentiometer | a(−10,30) wiper(0,30) b(10,30) | resistance 10 kΩ, wiperPosition 0.5 | núm xoay được khi chạy | `potentiometer` |
| buzzer | a(−30,0) b(30,0) | resistance 100, frequency 2000 | | `buzzer` |
| motor | a(−30,0) b(30,0) | resistance 5, kRpmPerVolt 600, noLoadRpm 6000 | rotor quay theo rpm | `motor` |
| servo | vcc(−20,−72) gnd(0,−72) signal(20,−72) | mode "180"/"360", maxRpm 60 | horn xoay | `servo` |
| relay | coilP(−70,−20) coilN(−70,20) no(70,−30) com(70,0) nc(70,30) | coilResistance 100, pickupVoltage 3 | | `relay` |
| diode | anode(−30,0) cathode(30,0) | forwardVoltage 0.7 | | `diode` |
| capacitor / electrolyticCapacitor | a,b | 100 µF / 470 µF, ratedVoltage 25 | | `capacitor` (DC → hở mạch; quá áp → “explode”) [INF] |
| ldr | a(−10,40) b(10,40) | brightness 0.5 (slider khi chạy), 100 Ω…1 MΩ | | `ldr` |
| tmp36 | vs(−13,40) vout(0,40) gnd(13,40) | temperature 25 (slider −40…125) | | `tmp36` (nguồn áp phụ thuộc) |
| ntcThermistor | a(−8,40) b(8,40) | temperature 25, r0 10 k, beta 3950 | | `ntcThermistor` |
| npn/pnpTransistor | collector/base/emitter | beta 100 | | Ebers–Moll + `_pnjlim` |
| multimeter | red(−20,30) black(20,30) | mode voltage/current/resistance | màn hình số | `multimeter` |
| battery (AA) | pos(−20,−70) neg(20,−70) | voltage 1.5, cellCount 1–4, hasSwitch, isOn | rộng động theo số cell | `voltageSource` (×cellCount, công tắc tắt = 1e9 Ω) |
| battery9V / coinCell3V | pos/neg | 9 V / 3 V | | `voltageSource` |
| breadboard | 420 chân: tp/tn/bp/bn 1–30, a–j × 1–30 | – | | **không có solverType**: chỉ `internalConnections` (64 nhóm: 4 thanh nguồn + 60 cột 5 lỗ) |
| yoloUno | 31 chân: phải scl, sda, 3v3_r, gnd_r, d13…d0; trái 3v3_l1, reset, 3v3_l2, 5v, gnd_l1, gnd_l2, vin, a0–a5 | pinStates {}, bootPressed | ảnh board 315×420, nút BOOT | `yoloUno`: nguồn 3.3 V và 5 V (0.1 Ω). GPIO: `digital_out` = 3.3/0 V qua 30 Ω; `pwm` = duty/1023·3.3 V qua 30 Ω; input = 1e9 Ω. Các GND và các 3V3 được nối nội bộ |
| ground | g(0,−20) | – | | không solver; chọn net gnd |

### 7.2 Connection model [SRC][RT]

- **Pin object** = `{id,dx,dy,label|labelKey}` trong catalog. Port ID là chuỗi cố định theo type (`a`, `b`, `anode`, `d13`, `tp1`…), **không sinh ngẫu nhiên**.
- **Wire** lưu `from/to = {componentId, portId}`. Hướng không có ý nghĩa điện.
- **Một chân nối được nhiều dây.** `addWire` chỉ chặn hai trường hợp: dây trùng (cùng cặp, kể cả đảo chiều) và tự nối vào chính chân đó. Dây nối hai chân của cùng linh kiện bị netlist bỏ qua, trừ khi linh kiện có `internalConnections`.
- **Ground:** net chứa chân `ground.g` → nếu không có thì chân `neg` của nguồn đầu tiên (`voltageSource/pwmSource/solarCell/powerSupply`) → nếu không có thì `groundPortId` (Yolo UNO `gnd_r`). Đặt tên net `gnd`, các net khác `net_N`.
- **Bend point** lưu `breakpoints[]` theo world coords. Snap 10 px, đồng thời căn theo x/y của bất kỳ chân nào trong 12 px.
- **Màu dây** lưu `wire.color` (hex), lấy từ “màu mặc định” tại thời điểm tạo dây. 12 màu: Đen #34495e, Đỏ #e74c3c, Cam #e67e22, Vàng #f1c40f, Xanh lá #27ae60, Xanh ngọc #1abc9c, Xanh dương #3498db, Tím #8e44ad, Hồng #e91e63, Nâu #8b5a2b, Xám #95a5a6, Trắng #ecf0f1.
- **Hit-testing** dùng event pointer của PIXI trên từng display object (component, port, wire, breakpoint). Snap tìm chân gần nhất trong **bán kính 24 world px** (`d² < 576`).
- **Kết nối không hợp lệ:**
  - Không có kiểm tra theo kiểu chân.
  - Sau khi giải, `_detectSelfLoopSourceShorts` và `_detectDirectSourceLoads` báo chập nguồn. Linh kiện vượt ngưỡng → fault `burn/explode/short`.
  - Nếu ma trận suy biến (net lơ lửng) → `lastSolveError` (“Không giải được mạch — có thể do nối sai hoặc thiếu điện trở bảo vệ…”).
- **Breadboard:** mỗi lỗ là một port riêng, nhưng **cùng electrical node** nhờ union-find trên `internalConnections`. Nhóm gồm thanh nguồn trên/dưới (30 lỗ mỗi thanh) và mỗi cột 5 lỗ a–e, f–j.

### 7.3 Solver [SRC]

```text
solve():
  nets = unionFind(ports ∪ internalConnections ∪ wires)  → netForPort
  defs = components.filter(solverType).map(c => ({id, type: solverType, nodes: portOrder→net, params}))
  circuit = build(defs)  // assign node indices (gnd=0), extraVar offsets
  sol = nonlinear ? newton(circuit, maxIter 500, vTol 1e-6, iTol 1e-9) : linearMNA(circuit)
  linearMNA: matrix (nodes-1 + extraVars)², stamps addG/addB/addC/addD/addI/addE, gmin 1e-12, dt=0 (DC)
  componentStates = element.extractState(sol)
  faults = selfLoopShorts ∪ directSourceLoads ∪ scan(broken→burn/explode, shortCircuit→short)
```

- Linh kiện hiện được **giải lại ở mỗi lần thay đổi model**, kể cả thay đổi `pinStates` từ Python.
- **Không có mô phỏng transient** (dt=0) [INF]. Tụ điện vì vậy không “nạp/xả” theo thời gian.

### 7.4 Renderer [RT][SRC]

- `PIXI.Application`, WebGL (type 1), nền `#F5F7FA`.
- `stage` gồm `gridLayer` (không gian màn hình) và `worldContainer` (có pan/zoom).
- Các layer trong `worldContainer`, từ dưới lên: `componentBgLayer`, `wireLayer`, `componentLayer`, `portLayer`, `breakpointLayer`, `particleLayer`, `overlayLayer`, `effectLayer`, `ghostLayer`.
- Có `ticker` cho animation: quay rotor motor, horn servo nội suy 6 rad/s, chấm dòng điện chạy với tốc độ ∝ |I| (8e4·I px/s, tối đa 200), hiệu ứng nổ khi cháy.
- Công thức độ sáng LED theo dòng: **[UNK]** (renderer lấy `current` từ `componentStates`).

---

## 8. Blockly Workspace

### 8.1 Hai cấu hình inject [RT][SRC]

| Thuộc tính | Editor thiết bị `/codes/:device` (chunk 7205) | Tab code của thiết bị ảo (chunk 124) |
|---|---|---|
| Phiên bản | Blockly 8.0.1 (global script) | như bên trái |
| Renderer / theme | **geras** / classic | **zelos**; tuỳ chỉnh `FIELD_BORDER_RECT_RADIUS` 26 (flyout 16), colour field 26×26 |
| Grid | spacing 25, length 3, #ccc, snap | spacing 25, length 3, #d0d6dc, snap |
| Zoom | controls false, wheel true, start 1, 0.3–3, ×1.1, pinch | start 0.9, còn lại giống |
| Move | scrollbars, drag, wheel=false | mặc định |
| Trashcan | false (thay bằng icon `#blocklyTrashIcon` chèn vào toolbox: kéo block vào toolbox để xoá) | false |
| Sounds | true | false |
| Media | `static/blocks/blockly/media/` | như bên trái |
| Toolbox | XML có placeholder `{{YOLOUNO_CAT_*}}` thay bằng `Blockly.Msg`. Category có `colour` + `icon` (Font Awesome). “NÂNG CAO” là CollapsibleToolboxCategory. “MỞ RỘNG” mở popup extension | XML tương tự + gộp `window.__simBlocklyExtensions` (XML có `name_vi/name_en`). **Ô tìm kiếm block** tạo category “kết quả tìm kiếm” ảo. `_formatToolboxMakeCode` restyle category |
| Comments / collapse / disable | true / true / true | – |

### 8.2 Phần đã custom hoá [SRC][RT]

- **Block và generator riêng:** `static/blocks/coding_blocks/*`. Runtime đếm được 559 block type trong `Blockly.Blocks` và 525 hàm trong `Blockly.Python` (cả core lẫn custom).
- **Field riêng:** `field_pitch` (chọn nốt nhạc), `field_matrix_image` (ma trận LED 5×5).
- **Override `Blockly.alert/confirm/prompt`** bằng dialog Framework7:
  - prompt số → **bàn phím số ảo** (`promptNumpad`)
  - giá trị là tên nốt → **bàn phím piano** (`promptPiano`)
- **Context menu thêm 2 mục** “Copy”/“Paste” qua localStorage `ohstemappblocklyStash`, để copy giữa các tab. Menu block: Tạo bản sao, Thêm chú giải, Thu nhỏ, Ngưng tác dụng, Xoá, Trợ giúp, Copy (`blockly-yolobit-ctx-block.png`).
- **Extension `text_quotes`** đăng ký lại để hiển thị “ … ” (tab code thiết bị ảo).
- **Biến/hàm:** dùng category động chuẩn `custom="VARIABLE"` và `custom="PROCEDURE"`.
- **Workspace mặc định:**

  | Thiết bị | Block mặc định |
  |---|---|
  | Yolo UNO | `uno_event_start` |
  | Yolo:Bit | `yolobit_basic_forever` |
  | xBot | rỗng |

### 8.3 Toolbox thật

Chi tiết trong `data/blockly-toolbox-{yolouno,yolobit,xbot}.json`, ảnh `blockly-<dev>-cat-NN.png`.

- **Yolo UNO:** CƠ BẢN, HIỂN THỊ (LED đơn, LED RGB, LCD1602), CẢM BIẾN (nút, DHT20, siêu âm, ánh sáng, đất, PIR, âm thanh, mưa, lửa), TRUYỀN ĐỘNG (bơm, quạt, USB switch, còi, relay, servo, servo360), LẬP LỊCH, VÒNG LẶP, LOGIC, BIẾN, TÍNH TOÁN, NÂNG CAO{IoT, WIFI, BLUETOOTH, SERIAL, HÀM, DANH SÁCH, CHỮ VIẾT, CHÂN CẮM}, MỞ RỘNG.
- **xBot:** DI CHUYỂN (`xbot_move_move_delay`, `xbot_move_turn_angle`, `xbot_move_motor`, `xbot_move_stop`, servo…), ĐẦU VÀO (siêu âm, line array, nút, IR, timer, MPU), HIỆU ỨNG, …, THƯ VIỆN.

---

## 9. Code Generation Pipeline

Đã xác minh bằng output thật trong UI. Đầu ra hiển thị trong Ace sau toggle trùng 100% với `workspaceToCode`. Chi tiết trong `data/codegen-cases.json`, ảnh `codegen-case*-{blocks,python}.png`.

```text
UI toggle "Python" (openPython)
  → Blockly.Python.workspaceToCode(ws)
      init(): definitions_={}, dev_vars_, functionNames_, nameDB_
      for each top block: block generator
          event blocks (uno_event_start/forever, on_button…) → ghi vào definitions_ với khoá có prefix, trả về ""
          statement blocks rời → trả code vào body
      finish(body):
          phân loại definitions_ theo prefix: import_* | init_* | task_* | setup_* | add_task_* | loop_* | deinit_* | on_button_* | on_ble_*
          deviceType = workspace.deviceType (yolouno|yolobit|xbot|spark)
          yolouno/spark → khung asyncio (đảm bảo "from yolo_uno import *", def→async def, await khi gọi hàm, run_loop(main()))
          yolobit → imports + reset button handler + on_start + forever
          khác → imports + body
  → state.project.python = code ; Ace.setValue(code)
Ngược lại (Python → Blocks): KHÔNG chuyển đổi; nếu code khác bản sinh → hộp thoại "không thể chuyển code về khối" [SRC]
```

| Case | Thiết bị | `definitions_` (rút gọn) | Python cuối |
|---|---|---|---|
| 1 LED ON | yolouno | `import_pins`, `init_led_D13="led_D13 = Pins(D13_PIN)"`, `import_yolo_uno`, `setup_uno_start="  led_D13.write_digital(1)\n"` | imports → `led_D13 = Pins(D13_PIN)` → `async def setup(): print('App started'); led_D13.write_digital(1)` → `async def main(): await setup(); while True: await asleep_ms(100)` → `run_loop(main())` |
| 2 Blink | yolouno | + `task_forever="async def task_forever(): while True: await asleep_ms(50) …"`, `add_task_forever="create_task(task_forever())"` | thêm `task_forever` và `create_task(...)` trong `setup()` |
| 3 Cảm biến + if | yolouno | `init_light_A1="light_A1 = Pins(A1_PIN)"`, `init_rgb_led_D3="rgb_led_D3 = RGBLed(D3_PIN, 4)"`, task_forever có `if (light_A1.read_analog_percent()) <= 50:` | như trên |
| 4 Servo + nút BOOT | yolouno | `init_servo_D2`, `setup_uno_start` (servo_write(0)), `import_abutton`, `init_abutton_BOOT`, `on_abutton_BOOT_pressed` (async def), `setup_abutton_BOOT_pressed`, `deinit_abutton_BOOT` | thêm `def deinit()` + `yolo_uno.deinit = deinit` |
| 5 Robot (xBot) | xbot | `{}` (block rời) | `robot.forward(50, 1, True)` / `robot.turn_left_angle(90)` / `robot.stop()` |
| 6 Blink Yolo:Bit | yolobit | `import_time`, `import_yolobit`, `on_start`, `forever` | `import time … button_a.on_pressed = None … while True: …` |

---

## 10. Python Simulation Pipeline (Circuit ↔ Yolo UNO)

Đã chạy end-to-end hai lần: blink bằng Blockly và `machine.Pin` bằng Python. Dữ liệu trong `data/circuit-uno-run-timeline.json` và `data/circuit-worker-protocol.json`; ảnh `uno-01…08`.

```mermaid
sequenceDiagram
  participant UI as CircuitPage (React)
  participant CT as CodeTab (Blockly zelos)
  participant RN as PyRunner (main thread)
  participant W as pyodideWorker.js (Worker)
  participant M as CircuitModel + Solver
  participant R as PIXI renderer
  UI->>CT: toggleRunning → generatePython()
  UI->>M: resetFaults(); solve()
  UI->>RN: run(code)
  RN->>W: {type:"init"}
  W-->>RN: {type:"syncModeDetected", mode:"jspi"} · stdout bootstrap · {type:"ready"}
  RN->>UI: applyPinPatch({}, {reset:true})
  RN->>W: {type:"portData", port:"d0", data:0, isArray:false}
  RN->>W: {type:"run", code, boardLibs:{"./machine.py":"/static/gears/override/machine.py",…}, boardId:"yolouno", bootScript:"/static/gears/firmware/yolouno/boot.py"}
  W-->>RN: {type:"started"} · stdout "Simulator: Yolo UNO firmware ready, version: 1.4"
  W-->>RN: {type:"cmd", cmd:"writePort", port:"48", value:1}
  RN->>RN: GPIO 48 → "d13"; queue {d13:{mode:"digital_out",value:1}}; flush on requestAnimationFrame
  RN->>UI: applyPinPatch({d13:{…}})
  UI->>M: updateParams(yoloUno, {pinStates}) (silent history) → solve
  M-->>UI: componentStates: yoloUno.pins.d13=3.216 V; led.current=2.80 mA
  UI->>R: rebuildScene (LED sáng, chấm dòng điện)
  UI->>RN: pushPinVoltages(pins)
  RN->>W: {type:"portData", port:"d13"|"48"|"D13", data: round(V/3.3·4095)} ×(20 chân × 3 alias)
  W-->>RN: {type:"cmd", cmd:"writePortExtended", port:"45", data:{r,g,b,index}} (LED RGB onboard; bỏ qua nếu không có pwm)
  UI->>RN: stop()
  RN->>W: {type:"stop"} (600 ms sau: terminate)
  W-->>RN: {type:"done"}
  RN->>UI: onDone → applyPinPatch({}, {reset:true}); isRunning=false
```

**Bảng ánh xạ GPIO → chân Yolo UNO** [SRC]:

| GPIO | Chân | GPIO | Chân |
|---|---|---|---|
| 44 | d0 | 43 | d1 |
| 5–10 | d2–d7 | 17, 18 | d8, d9 |
| 21 | d10 | 38 | d11 |
| 47 | d12 | 48 | d13 |
| 1–4 | a0–a3 | 11, 12 | a4, a5 |

`scl`/`sda` cũng được chấp nhận.

**Ngữ nghĩa lệnh từ worker:**

| Lệnh | Xử lý |
|---|---|
| `writePort {port, value}` | → `digital_out` |
| `writePortExtended {port, data:{pwm}}` | → `pwm` (0–1023) |
| `mqtt.connect/subscribe/publish/disconnect` | RN tự mở WebSocket MQTT (tự đóng gói CONNECT/PUBLISH) và chuyển `mqtt_connack`/`mqtt_msg` vào worker |

**Đồng bộ hoá:** Chrome hiện tại dùng **JSPI** cho `time.sleep` đồng bộ, nên không cần COOP/COEP. Nếu không có JSPI thì fallback `SharedArrayBuffer` + `Atomics.wait`. Đây là lý do header COOP/COEP được bật [RT].

**Quan sát định lượng** [RT]:

- Từ lúc bấm Chạy đến lệnh `writePort` đầu tiên mất ~3.5–3.8 s: tải Pyodide (~1.2 s) + 69 module firmware + chạy `boot.py`.
- Chu kỳ blink 1 s xuất hiện đúng trong timeline: 1↔0 mỗi ~1–1.2 s.
- `portData` rất “ồn”: 1 862 message trong ~30 s, vì mọi thay đổi model đều đẩy lại điện áp tất cả chân.
- Hết chương trình (Python `for`) → tự `done` → `isRunning=false`, `pinStates={}`.

**[UNK]:** chế độ C chạy trên giả lập ra sao. Đã kiểm tra lại: không có trình biên dịch C trong các chunk đã tải.

---

## 11. Robot Project Builder

### 11.1 Flow đã thao tác [UI][RT]

1. **Mặc định:** Body (khối hộp 14×16×4 cm) + Caster tự động + Left/Right Motor (DB = drivebase-managed), badge “3 lỗi” (`robot-01-default-design.png`). Khi xoá motor/caster, badge còn “1 lỗi”, có lẽ do thiếu board [INF].
2. **Thêm kit:** bấm card “Robot Rover” → thêm **Group** 5 phần (line sensor, caster, board Rover/Yolo:Bit, 2 bánh có motor gán cổng M1/M2) (`robot-11-rover-added.png`).
3. **Chọn:** chọn trong cây → inspector “THÔNG SỐ KỸ THUẬT”. Group có vị trí X/Y/Z, góc xoay X/Y/Z (°), Bỏ nhóm, Xuất. Body có 3 tab 📐 kích thước (±), 📍, ⚙ (`robot-12…`, `robot-20…`).
4. **Gizmo trên canvas:** ☰ (menu), ✥ (di chuyển), ⟲ (xoay). Lưới snap 8/4/1 mm.
5. **Xoá:** Delete trên item của cây. **Body được bảo vệ, không xoá được** [UI].
6. **Lập trình:** board tự nhận `{componentId:"board-0", boardType:"rover"}` → toolbox Yolo:Bit. Có 3 chế độ: khối / Python / C (C bị khoá trừ Yolo UNO/ORC Hub).
7. **Giả lập ▶:**
   - Có **preflight validator** chặn chạy và hiện “Phát hiện 2 lỗi — bánh xe va vào thân robot”, kèm “Tự sửa toàn bộ (2)”, “Sửa ngay”, “Tiếp tục chạy”. Auto-fix dời bánh từ x=±5.9 → ±8.15 cm.
   - Chương trình Python `rover.forward(60); sleep 2; rover.turn_right(50); …` **chạy thật**: robot tiến và xoay, terminal in `done 999` (siêu âm không thấy vật cản) (`robot-24b`, `robot-25`, `robot-26`).

### 11.2 Schema (`data/robot-project-export.json`) [RT]

```ts
// IndexedDB "ProjectBuilderDB": stores "project_designs" (một key "list" → mảng project), "project_maps"
interface VrbProjectFile { version: 2; format: "vrb-project"; exportedAt: string; project: RobotProject; robot: unknown /*bản hydrate*/; models: unknown[] }
interface RobotProject {
  id: string;                       // "proj_<t36>_<rand>"
  name: string;
  design: RobotDesign;              // slim (_slimFormat: true)
  scripts: Record<string /*"board-0"*/, { boardType: string; label: string; xmlText: string; python: string; c: string }>;
  activeBoard: string | null;
  codeMode?: "block" | "python" | "c";
  simConfig: { worldId: string /* "configurator" */ };
  extensions: string[];
  updatedAt: string;                // ISO
}
interface RobotDesign {
  bodyWidth: number; bodyHeight: number; bodyLength: number; bodyMass: number; bodyFriction: number; color: string;
  drivebaseType: "none" | "2wd" | "3wd" | string; caster: boolean; wheelDiameter: number; wheelWidth: number; wheelFriction: number; /* … */
  connections: { indexA: number; indexB: number; snapTypeA: string; snapTypeB: string; jointType: "rigid" | string }[];
  _groupedComponents?: Group[];     // nhóm (kit) giữ cấu trúc cây
  components: Part[];               // danh sách phẳng
  _slimFormat: true;
}
interface Group { type: "Group"; label: string; position: [number, number, number]; _color?: string; children: Part[] }
interface Part {
  type: string;                     // "WheelActuator" | "LineSensor" | "ControlBoard" | "CasterWheel" | "DistanceSensor" | …
  position: [number, number, number];   // cm, so với body
  rotation: [number, number, number];   // radian (Euler XYZ)
  label?: string;
  _assignedPort?: string;           // "M1" | "M2" | "I2C_0" | "S1" | …
  _assignedPort2?: string;
  _drivebaseManaged?: boolean;
  options: { _part_id: string; [k: string]: unknown };  // chỉ whitelist + override
  components?: Part[];              // con gắn trên part
}
```

### 11.3 Part definition → runtime object [SRC]

- `parts-toolbox/toolbox_parts.xml` (và các pack `*_ext.xml`, liệt kê trong `catalog.xml` theo `configUrl`) khai báo theo cấu trúc sau:

  ```xml
  <part type part_id name_en name_vi model_path image_path icon entity_type>
    <config key value/>
    <option key type min max step label/>
    <metadata .../>
  </part>
  ```

  Ngoài ra có `<group src="models/groups/rover.json">` (kit).
- **Rehydrate:** `partLibrary.getPartTemplate(xmlNode).defaultConfig` + override trong project.
- **Tạo đối tượng runtime:** `PartFactoryV2.create(type, id, data, scene)` chọn class theo type:

  | type | Class |
  |---|---|
  | `WheelActuator`/`Wheel` | `WheelPart` |
  | `DistanceSensor` | `DistanceSensorPart` |
  | `LineSensor` | `LineSensorPart` |
  | `CasterWheel` | `SpherePart` |
  | `ControlBoard`/`Motor`/… | `ModelPart` (GLB) |
  | `Checkpoint`/`FinishLine`/… | các part chấm điểm |
  | không khớp | fallback `RobotPart` (hộp đỏ wireframe) |

- `RobotPart` gồm `rootNode` (TransformNode), `visualMesh`, `snapNodes`, `getPhysicsShapeInfo()` (vật liệu → khối lượng, ma sát, độ nảy), `getConstraintDataToParent()` (mặc định là fixed joint).

**Board** khai báo `_boardPorts[{id,label,category:"digital,analog,uart"|"i2c"|"servo"|"motor",direction,x,y,w,h}]` (toạ độ chuẩn hoá trên ảnh 2D) và `_integratedComponents` (cảm biến/LED onboard ánh xạ tới GPIO, kèm slider giá trị mặc định cho giả lập) (`data/robot-rover-group-definition.json`).

**Bộ part tối thiểu cho demo:**

| Vai trò | Part |
|---|---|
| Control board | `ControlBoard` + ports |
| Bánh xe | `WheelActuator` (diameter 4.7 cm, width 1.9, mass 200, friction 0.8) |
| Động cơ | gộp trong `WheelActuator` qua port M1/M2 |
| Cảm biến khoảng cách | `DistanceSensor` → `sensor.getDistance` |
| Cảm biến line | `LineSensor` (lấy mẫu màu texture nền) |
| Caster | `CasterWheel` (`SpherePart`, ma sát 0) |

### 11.4 Runtime 3D [SRC]

Engine Pyodide riêng (`/static/gears/js/pyodideEngine.js`) dùng lệnh worker theo miền robot:

- `motor.runForever/runTimed/runToPosition/stop/get/set`
- `sensor.getDistance/getDistanceByType/readEyes/readLineEyesByType/getHeading/getRGB/getLuxByType`
- `pen.*`, `getBodyHeading`
- `readPort/writePort/writePortExtended`
- `syncRequest/syncResponse`, `simulationClock/simulationSleep(Done)`, `sensorPush`

Physics dùng Havok qua Babylon (`PhysicsOrchestrator`). Chấm điểm dùng `scoringEngine`.

**[UNK]:** ánh xạ chính xác từ PWM chân → motor M1/M2 của Rover. Đường đi đã thấy là `rover.py` → `machine.PWM` → `PortIO` → port registry trong `Robot.js` [INF]. Chưa đọc được pose số vì body vật lý không nằm ở `robot.body`.

---

## 12. Map Builder

### 12.1 Mô hình [SRC][RT]

- Cùng engine `robotBuilder` ở `mode:"map"`. Map là một “robot” có body kích thước 0.01 (`_mapMode:true`) cộng với `components` là các object trên sa bàn.
- **World options** (form sinh từ `_mapOptionsTemplate`), chia theo nhóm:
  - **NỀN SÂN:** groundType box/cylinder/none, imageURL (upload), imageScale, groundLength/Width (cm), friction, restitution
  - **TƯỜNG BAO:** wall, height, thickness, color
  - **ĐẾM THỜI GIAN:** timer none/up/down, duration, timerEnd continue/stopTimer/stopRobot, autoPhase
  - **CHẤM ĐIỂM:** scoringEnabled, initialScore, endCondition auto/finish/checkpoints/time, timeBonusPerSec, allowEarlySubmit
  - **RÀNG BUỘC ROBOT:** robotMax/StartMax W/D/H
  - **Vị trí xuất phát:** startPosXYZ, startRot, markers
- **Pack part dành cho map:**

  | Pack | Số lượng | Nội dung |
  |---|---|---|
  | `line_tiles` | 32 | Box 20×20×0.1 cm + `linePattern`, xoay theo bước 90° |
  | `dynamic_obstacles` | 3 | SwingGate (thời gian mở/đóng), PatrolBlock, SpinningCross |
  | `scoring_zones` | 5 | Checkpoint (`points`, `order`, `label`, `matchRandomLevel`), FinishLine, ItemZone, ScoringItem |
  | `traffic` | 5 | |

  Mỗi option có `type: vectors | slider | color | text`, `min/max/step`, `deg2rad`, `visibleWhen`.
- **Template sa bàn** là file JSON `/static/gears/worlds/<nhóm>/<file>.json` gồm `{name, worldName:"custom", options:{…, objects:[{type:"box", position, rotationMode:"degrees", rotation, size:[x,y,z], color, physicsOptions:"fixed", ultrasonicDetection, laserDetection, …}], startPosXYZ, startRot}}` (`data/map-world-template-lesson3.json`).
- **Map dò line** = ảnh nền (`textures/maps/basic/line_following_basic.png`), `objects: []` (`data/map-world-template-lesson6.json`).
- **Lưu:** `SceneMapDB.saved_scenes {id:"scene_<ts>", name, updatedAt, thumbnail(PNG dataURL), world, design:{components,_groupedComponents?}, simWorldOptions, cloudMapId?}`.
- **Bundle thi đấu:** `{format:"ohstem-contest-map", version:2, name, world, design, simWorldOptions, maxPossibleScore?, robotConstraints?}` (`data/map-scene-idb-record.json`).

### 12.2 Tập con tối thiểu cho demo

- **World:** `{groundSize:[W,L], groundTexture?, walls:{height,thickness}, start:{x,y,yawDeg}}`.
- **Object:**

  ```ts
  type MapObject = {
    id: string;
    kind: "box" | "lineTile" | "checkpoint" | "finish";
    position: [x, y, z];          // cm
    yawDeg: number;
    size: [w, d, h];
    color: string;
    physics: "fixed" | "dynamic";
    detectable: { ultrasonic: boolean };
    scoring?: { points: number; order: number };
  };
  ```

**Đã xác minh:** popup template, lưu map rỗng, schema world. **Chưa thao tác:** thêm/sửa object bằng UI trong Map Builder (tải template bằng click chưa thành công khi tự động hoá) [UNK].

---

## 13. AI Trainer

### 13.1 Flow [UI][RT] (ảnh `ai-01…08`)

1. Vào `/ai/new/image` → tự tạo `projectId` (uuid), có sẵn 2 nhóm “Nhóm 1/2”.
2. Mỗi nhóm có 2 cách thêm mẫu:
   - **Tải Lên:** input file đơn; ảnh được resize/crop qua canvas thành JPEG (~9 KB/ảnh).
   - **Webcam:** “giữ để chụp”, có cài đặt FPS/delay/duration.
3. Bấm **HUẤN LUYỆN MÔ HÌNH** → tải MobileNet v2 từ `storage.googleapis.com/teachable-machine-models/...` → huấn luyện (12 ảnh: 9.36 s) → hiện “Đã huấn luyện mô hình thành công”.
4. **Thử nhận diện:** cần webcam (headless không có → hiện icon webcam tắt).
5. **LƯU MÔ HÌNH:** dùng tên ở ô header (`ai-02`, `ai-04`, `ai-08`).

### 13.2 Dữ liệu (`data/ai-trainer-storage.json`) [RT]

```ts
// localStorage "ohstemai_projects" = { data: Record<projectId, AiProject> }
interface AiProject {
  id: string; name: string; type: "image" | "audio"; createdAt: string;
  metadata: { tfjsVersion: "3.21.0"; tmVersion: "2.4.4"; packageVersion: "0.8.4-alpha2"; packageName: "@teachablemachine/image";
              timeStamp: string; userMetadata: {}; modelName: "classify-two-objects"; labels: string[]; imageSize: 224 };
  classes: { id: string /*"klass-<t36>-N"*/; name: string }[];
  importedFrom: string | null;
}
// IndexedDB "ohstem-ai-samples" / store "samples" (keyPath "key", index "by_project" on projectId)
interface AiSample { key: `${projectId}:${id}`; id: string; projectId: string; klassId: string; label: string; classIndex: number; order: number; blob: Blob /*image/jpeg*/; createdAt: string }
// IndexedDB "tensorflowjs" (chuẩn TF.js): models_store + model_info_store, key = projectId (URL "indexeddb://<projectId>")
```

**Huấn luyện** [SRC]:

- `denseUnits 100, epochs 30, learningRate 0.001, batchSize 16`, early-stop khi `val_loss` không giảm ≥0.001 trong 5 epoch.
- Audio dùng `speech-commands` (epochs 50).
- Giới hạn mẫu: ~1500, ~40 MB [INF từ hằng số].

**Lưu ý quan sát:** ô đầu tiên trong DOM là tên model chứ không phải tên lớp. Script test đã gán nhầm tên, nên `labels` ghi lại là `["Xanh","Nhóm 2"]`. Dữ liệu test (ảnh màu tổng hợp) đã xoá cùng profile.

---

## 14. IoT Dashboard

### 14.1 Flow [UI][RT]

1. `/iot-panels` → “Tạo Mới” → `/iot-panels/new`, mở ở chế độ thiết kế.
2. Panel trái có 10 widget:
   - joystick, dpad
   - nút nhấn, công tắc
   - slider
   - step (±)
   - color picker
   - thông tin (value-display)
   - đồng hồ đo (gauge)
   - biểu đồ (chart)
3. **Kéo-thả** vào lưới (đã thử: nút, thanh trượt, đồng hồ đo).
4. Bấm vào widget mở **popover**:
   - Tên
   - Kênh thông tin V1–V20
   - nút đưa lên/xuống lớp
   - XOÁ
   - OK
5. ▶ chuyển sang chế độ chạy (tự lưu nếu đã có id).
6. ← khi chưa lưu → prompt “Bạn có muốn lưu bảng điều khiển không? Tên: Untitled 1” với BỎ QUA / LƯU.

### 14.2 Schema (`data/iot-dashboard-state.json`) [RT]

```ts
// localStorage "iot-panels" = Dashboard[] (store.js; service: find/query/updateOrCreate/delete, sort updatedAt desc) [SRC]
interface Dashboard { id: string; name: string; botName: string; image?: string; widgets: Widget[]; updatedAt?: number }
type Widget =
  | { id: number; type: "button"; label: string; channel: Channel; code: { pressed: { text: string }; released: { text: string } }; grid: Grid }
  | { id: number; type: "slider"; label: string; channel: Channel; min: number; max: number; code: { changed: { text: string } }; grid: Grid }
  | { id: number; type: "gauge"; label: string; channel: Channel; min: number; max: number; format: string; value: number; grid: Grid }
  | { id: number; type: string; [k: string]: unknown };   // switch (code.turn_on/turn_off), joystick, dpad, step-control, color-picker, value-display, chart, …
type Channel = `V${1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20}`;
interface Grid { x: number; y: number; w: number; h: number }   // react-grid-layout units
```

**Lưới:**

- react-grid-layout `cols=60`, `rowHeight = window.width/60` (24 px ở 1440), `margin [0,0]`
- `verticalCompact:false`, `preventCollision:true`
- droppable/draggable/resizable chỉ trong chế độ thiết kế
- kích thước mặc định khi thả: button 8×6, slider 18×5, gauge 12×8

**MQTT:**

- Topic `<botName || random11>/feeds/<channel>`
- Publish `retain:true`, subscribe `qos 2`
- Broker `wss://mqtt.ohstem.vn:8084/mqtt` (theo report vòng 1)
- Giá trị nhận về cập nhật `widget.value`, ghi telemetry ≤5000 điểm mỗi kênh

**[UNK]:** bản ghi `iot-panels` sau khi lưu chưa quan sát được, vì script không điền được prompt Framework7. Schema trên lấy từ state trong bộ nhớ và mã `updateOrCreate`.

---

## 15. Assets and Component Catalog

| Nguồn | Nội dung | Dùng cho demo |
|---|---|---|
| `data/circuit-component-catalog.json` | 41 type: chân, tham số, `paramSpec`, nối nội bộ, kích thước | Sao chép **cấu trúc** (không sao chép hình ảnh) |
| Hình linh kiện mạch | Vẽ bằng PIXI Graphics/Sprite trong bundle (không phải file SVG riêng) [INF] | Tự vẽ: SVG/Konva/Pixi |
| `data/robot-rover-group-definition.json` | Kit Rover: part, port, `_integratedComponents` | Mẫu cho schema board/kit |
| GLB `/static/gears/models/**` | Model 3D board, bánh, caster | **Không dùng lại** (bản quyền của OhStem) [INF]. Dùng primitive hoặc asset CC0 (Kenney/KayKit được OhStem dùng làm pack 3D) |
| `data/blockly-toolbox-*.json` | Danh mục, màu, danh sách block | Tham khảo cấu trúc toolbox |
| `data/codegen-cases.json` | Cặp XML → Python | **Test vector** cho generator của demo |
| `data/map-world-template-*.json` | World template | Mẫu cho map schema |

> Màu category Blockly (Yolo UNO) để tham khảo: CƠ BẢN #1e90ff, HIỂN THỊ #5d2c91, CẢM BIẾN #d400d4, TRUYỀN ĐỘNG #e63022, LẬP LỊCH #2eb7ed, VÒNG LẶP #42bf42, LOGIC #4281bf, BIẾN #ffa500, TÍNH TOÁN #4257bf, NÂNG CAO #675ba5, MỞ RỘNG #717171.

---

## 16. OSS / Dependency Map

License đã kiểm tra trên GitHub API (`license.spdx_id`) và file LICENSE/npm khi API trả `NOASSERTION`, ngày 2026-10-02.

| Subsystem | OhStem dùng | OSS | License (đã xác minh) | Dùng lại cho demo? | Ứng viên |
|---|---|---|---|---|---|
| Block editor | Blockly 8.0.1 (global) | RaspberryPiFoundation/blockly | Apache-2.0 | Có | **Blockly 13.x** (npm 13.3.0) + `@blockly/*` plugins |
| Khối ngang (K1–2) | scratch-blocks (`Blockly2`) | scratchfoundation/scratch-blocks | Apache-2.0 | Tuỳ chọn | Để sau |
| Python trong trình duyệt | Pyodide 0.29.3 (+ Skulpt 1.2.0 cho 3D) | pyodide/pyodide; skulpt/skulpt | MPL-2.0; MIT | Có | **Pyodide** trong Worker (JSPI/SAB) |
| Renderer mạch | PixiJS 7 (WebGL) | pixijs/pixijs | MIT | Có | **Pixi v8** hoặc **Konva/react-konva** (MIT) cho editor 2D |
| Đồ thị/dây | tự viết | (xyflow/React Flow MIT) | – | Không phù hợp cho dây có chân tuỳ ý | Tự viết trên Konva/Pixi |
| Solver mạch | tự viết (MNA + Newton) | – | – | Viết lại bản rút gọn | MNA dense + Gauss, Newton cho diode/LED |
| Render 3D | Babylon.js 8.51.2 | BabylonJS/Babylon.js | Apache-2.0 | Có | Babylon (GUI/gizmo sẵn) hoặc three.js (MIT) |
| Physics 3D | Havok | @babylonjs/havok | MIT (npm metadata) | Có | Havok (qua Babylon) hoặc **Rapier** (Apache-2.0) |
| Robot sim framework | GEARS fork | QuirkyCort/gears | **GPL-3.0** | **Không** cho sản phẩm đóng | Tự viết. Chỉ tham khảo ý tưởng |
| Code editor | Ace (react-ace) | ajaxorg/ace | BSD-3-Clause | Có | **Monaco** (MIT) hoặc CodeMirror 6 |
| Terminal | xterm.js | xtermjs/xterm.js | MIT | Có | xterm.js |
| Chart | ApexCharts 3.54.1 | apexcharts.js | **Dual license** (Community/Commercial) | Cẩn trọng | uPlot / Chart.js (MIT) |
| ML | TF.js 3.21, Teachable Machine, ml5 | tensorflow/tfjs; teachablemachine-community; ml5 | Apache-2.0; Apache-2.0; MIT (npm) | Có | TF.js 4.x + `@teachablemachine/image` |
| Grid dashboard | react-grid-layout | react-grid-layout | MIT | Có | react-grid-layout |
| MQTT | mqtt.js 4.3.7 | mqttjs/MQTT.js | MIT | Có | mqtt.js 5 |
| App shell | React 18 + Framework7 | framework7io/framework7 | MIT | Không cần | React + router + Tailwind/Radix |
| Mô phỏng khoa học | PhET HTML | phetsims/* | Code GPL-3.0, sim CC-BY-4.0 | Chỉ nhúng sim kèm ghi công | – |
| Game | MakeCode Arcade | microsoft/pxt | MIT | Ngoài phạm vi | – |
| Flash firmware | ESP Web Tools | esphome/esp-web-tools | Apache-2.0 | Khi có phần cứng | – |
| (Đối chiếu) mô phỏng MCU | – | wokwi/avr8js | MIT | Không cần cho demo | – |

---

## 17. Proposed React + TypeScript Architecture

```mermaid
flowchart LR
  subgraph UI["Editor (React)"]
    Shell[AppShell + Router] --> CE[CircuitEditor]
    Shell --> CodeTab[CodeEditor: Blockly | Monaco]
    Shell --> Term[Terminal: xterm]
    CE --> Palette & Inspector & Toolbar
  end
  subgraph Domain["Domain Model (pure TS)"]
    Doc[CircuitDocument + commands + undo] --> Net[Netlist builder: union-find]
    Cat[ComponentCatalog: data] --> Doc
  end
  subgraph Sim["Simulation Runtime"]
    Solver[MNA solver: dense LU + Newton] --> States[ComponentStates]
    Bridge[BoardBridge: pins ⇄ worker]
  end
  subgraph Py["Python Runtime (Web Worker)"]
    Pyo[Pyodide] --> Shim[machine/time shims]
  end
  subgraph Render["Renderer"]
    Stage[Konva/Pixi stage] --> Layers[bg|wires|parts|ports|overlay|fx]
  end
  subgraph Gen["Code Generator"]
    BlocklyGen[Blockly generators + board skeleton templates]
  end
  subgraph Persist["Persistence"]
    IDB[IndexedDB via idb] --- Exporter[JSON import/export + schema version]
  end
  CE -- commands --> Doc
  Doc -- change events --> Solver
  Solver --> States --> Stage
  CodeTab --> BlocklyGen --> Bridge
  Bridge <-- postMessage --> Pyo
  Bridge -- pinStates --> Doc
  States -- pin voltages --> Bridge
  Doc <--> IDB
```

### 17.1 Tách lớp (bắt buộc)

| Lớp | Package gợi ý | Nội dung | Không được chứa |
|---|---|---|---|
| Domain | `@demo/circuit-core` | `CircuitDocument`, command (Add/Move/Rotate/Flip/Delete/Connect/Bend/SetParam/Duplicate), undo stack (snapshot hoặc inverse), catalog type, netlist | DOM, canvas, React |
| Simulation | `@demo/circuit-sim` | `Element.stamp(ctx)`, `solveDC(netlist)`, fault detection, component state | UI |
| Renderer | `@demo/circuit-render` | Konva hoặc Pixi; hit-test port (bán kính 24 world px), ghost, wire path có bend point, animation chấm dòng | Logic điện |
| Editor | `apps/web` | React: toolbar, palette, inspector (render từ `paramSpec`), keymap, selection, viewport | Solver |
| Code generator | `@demo/codegen` | Blockly block JSON + generator theo section `imports/init/setup/tasks/loop/deinit` + skeleton theo board | Runtime |
| Python runtime | `@demo/py-runtime` | Worker script, protocol, shim `machine` (Pin/PWM/ADC), sync sleep (JSPI → SAB fallback) | DOM |
| Persistence | `@demo/storage` | `idb` wrapper, migration theo `schemaVersion`, export/import | – |

### 17.2 Hợp đồng chính (đặc tả, chưa phải implementation)

```ts
// Catalog (data, có thể đến từ CMS)
interface ComponentDef {
  type: string; version: string; label: I18n; category: "basic" | "sources" | "actuators" | "materials" | "boards";
  size: { w: number; h: number };
  ports: { id: string; dx: number; dy: number; label?: I18n }[];
  portOrder: string[]; internalConnections?: string[][]; groundPortId?: string;
  params: ParamSpec[];                 // render inspector + validate
  simulationModelId?: string;          // "resistor@1", "led-shockley@1", "board-uno-like@1" — tham chiếu code đã deploy
  rendererId: string;                  // "resistor@1", "led@1", "image-sprite@1"
  runInteractive?: { param: string; kind: "slider" | "toggle" | "momentary" | "knob" };
}
// Simulation element (code, review, version)
interface SimElement {
  extraVarCount(): number; isNonlinear(): boolean;
  stamp(ctx: StampContext): void; isConverged?(sol: Solution, tol: number): boolean;
  extractState(sol: Solution): Record<string, number | boolean | Record<string, number>>;
}
// Worker protocol (giữ gần với OhStem để giảm rủi ro)
type MainToWorker =
  | { type: "init" } | { type: "run"; code: string; boardId: string; libs: Record<string, string> }
  | { type: "stop" } | { type: "portData"; port: string; data: number };
type WorkerToMain =
  | { type: "ready" } | { type: "started" } | { type: "done" } | { type: "error"; message: string }
  | { type: "stdout" | "stderr"; text: string }
  | { type: "cmd"; cmd: "writePort"; port: string; value: 0 | 1 }
  | { type: "cmd"; cmd: "writePwm"; port: string; duty: number };
```

### 17.3 Lựa chọn thư viện

| Nhu cầu | Khuyến nghị | Lý do |
|---|---|---|
| Canvas mạch 2D | **Konva + react-konva** (MVP) → Pixi nếu cần hiệu năng | Konva có hit-test, drag, transformer sẵn, dễ làm việc với React. Pixi nhanh hơn nhưng phải tự viết nhiều hơn |
| Wiring | Tự viết (polyline + bend + snap) | OhStem cũng tự viết. Thư viện đồ thị không hợp với chân linh kiện tuỳ ý |
| Blockly | Blockly 12–13 + `@blockly/plugin-workspace-search`, `@blockly/field-colour`, renderer zelos | Bản mới có JSON serialization, theme API |
| Simulation | MNA dense tự viết (≤ vài trăm node) | Đủ cho giáo dục. Không cần transient ở MVP |
| 2D/3D/physics (Demo C) | 2D: Pixi + Rapier2D. 3D: Babylon + Havok | Rapier 2D đủ cho robot top-down, cảm biến ray-cast |
| State | Zustand (UI state) + domain document riêng (immer/command pattern) | Undo/redo ở domain, không lẫn với React state |
| Serialization | Zod schema + `schemaVersion` + migrations | Tránh lưu nhầm runtime flag (lỗi `_broken` của OhStem) |

---

## 18. CMS Device Model

### 18.1 CMS cấu hình được

- **Định danh:** name (vi/en), category, icon/ảnh/poster, mô tả, link tài liệu.
- **Hình học:** size, danh sách **port** `{id, dx, dy, label, kind: power|gnd|digital|analog|i2c|pwm|passive}`, `portOrder`, `internalConnections`, `groundPortId`.
- **Tham số:** `paramSpec` (key, kiểu number/boolean/enum/color/slider, min/max/step, đơn vị, mặc định, hiển thị khi chạy hay không).
- **Liên kết đến implementation đã deploy:**
  - `simulationModelId@semver`
  - `rendererId@semver` (hoặc `rendererType:"image-sprite"` + ảnh do CMS cung cấp)
  - `runInteractive` (chọn từ danh sách có sẵn)
- **Board:**
  - danh sách chân + capability
  - ánh xạ GPIO ↔ chân (như bảng 48→d13)
  - `programSkeletonId` (`micropython-asyncio@1`, `micropython-loop@1`)
  - danh sách driver lib (file + checksum)
- **Block templates (khai báo):**
  - Blockly JSON (message, args field, input, colour)
  - **template code theo section** (`imports`, `init`, `setup`, `loop`, `expr`) với placeholder `{{FIELD}}`
  - tham chiếu `generatorTemplateId` khi cần logic
- **Tương thích:** module × board × connector, `minFirmware`, phụ thuộc module khác.
- **Tài liệu:** nội dung bài học, worksheet (mô hình block của OhStem: instructions/question/table/note).

### 18.2 Bắt buộc developer viết code (deploy, review, version)

- **Hành vi mô phỏng:** `SimElement.stamp` (linh kiện phi tuyến mới, mô hình nhiệt, motor/servo dynamics, cảm biến).
- **Giao thức phức tạp:** I2C/SPI/UART, MQTT, cảm biến số (DHT, siêu âm) trong shim Python.
- **Physics/3D:** part có joint, gripper, camera AI.
- **Renderer custom:** LED glow, màn hình LCD/OLED, ma trận LED, đồng hồ đo.
- **Field Blockly đặc biệt** (ma trận LED, piano) và **generator có logic** (đệ quy, async transform).
- **Khung chương trình mới cho board** (skeleton).

### 18.3 Không bao giờ cho phép thực thi tuỳ ý từ CMS

- Không có ô “nhập JS/Python rồi `eval()`”. OhStem `eval()` `definition.js` của extension ngay trong main window. Đây là điều cần tránh.
- CMS chỉ chứa **dữ liệu + tham chiếu** `simulationModelId`, `rendererId`, `generatorTemplateId`, `programSkeletonId` trỏ tới module đã build, review và ký.
- Template code chỉ được **nội suy giá trị field đã validate** (escape theo ngôn ngữ đích, whitelist ký tự cho tên định danh).
- Driver lib upload chỉ là **file tĩnh có checksum**, chỉ chạy trên board/Pyodide sandbox, không chạy ở main thread.
- Không lưu runtime flag vào document thiết kế (tách `designState` và `runtimeState`).

```yaml
# ví dụ ComponentDef do CMS quản lý
type: led
version: 1.2.0
label: { vi: "Đèn LED", en: "LED" }
category: basic
size: { w: 40, h: 70 }
ports:
  - { id: anode,   dx: -10, dy: 30, kind: passive, label: { vi: "+" } }
  - { id: cathode, dx:  10, dy: 30, kind: passive, label: { vi: "−" } }
portOrder: [anode, cathode]
params:
  - { key: forwardVoltage, type: number, min: 1.5, max: 3.5, step: 0.1, default: 2, unit: V }
  - { key: color, type: enum, options: ["#ff3333", "#3498db", "#27ae60", "#f1c40f"], default: "#ff3333" }
simulationModelId: led-shockley@1      # code: n=2, Vt=25.85mV, I(Vf)=20mA, iMax=30mA → burn
rendererId: led@1
faults: [{ when: "state.current > 0.03", kind: burn, messageKey: fault_led_burnt }]   # biểu thức khai báo, đánh giá bằng evaluator an toàn
```

---

## 19. MVP / Demo Backlog

| # | Hạng mục | Phụ thuộc | Ước lượng | Done khi |
|---|---|---|---|---|
| 1 | Schema + Zod: `CircuitDocument`, `ComponentDef`, `Wire`, export v1 | – | S | Round-trip JSON khớp `data/circuit-project-idb-record.json` (đổi tên field nếu muốn) |
| 2 | Catalog 7 linh kiện (pin, R, LED, nút, công tắc, ground, board UNO-like) | 1 | S | Render inspector từ `paramSpec` |
| 3 | Command + undo/redo (≤50), gộp lệnh move trong 500 ms | 1 | M | Ctrl+Z/Y/D, Delete, Esc như mục 5 |
| 4 | Canvas: grid, pan/zoom (0.25–4, ×1.12), snap 10, ghost khi đặt | 2 | M | `circuit-01`/`circuit-42` tương đương |
| 5 | Port hit-test (24 px), vẽ dây, bend point (click khi vẽ + double-click), màu dây | 4 | M | Diff dây khớp mục 6.1 |
| 6 | Netlist union-find + chọn ground | 1 | S | Unit test theo breadboard group |
| 7 | MNA DC + Newton (resistor, source, switch, LED, diode) + fault burn/short + singular error | 6 | M | 9 V/220 Ω → LED cháy (31.7 mA); 9 V/1 kΩ → 7.05 mA, Vled 1.946 V (giá trị OhStem đo được) |
| 8 | Render state: LED sáng theo I, chấm dòng điện, hiệu ứng cháy, badge Running, khoá thao tác khi chạy | 7 | M | So với `circuit-46` |
| 9 | Blockly tab (zelos), toolbox 6 category, block: start/forever/led/sleep/if/read button/read analog | – | M | Generator khớp `data/codegen-cases.json` case 1–3 (cho board demo) |
| 10 | Python Worker: Pyodide + shim `machine.Pin/PWM/ADC`, `time.sleep` (JSPI → SAB fallback), protocol 17.2 | – | L | Blink 1 s quan sát được trong timeline |
| 11 | BoardBridge: `writePort` → `pinStates` → solve; điện áp chân → `portData`; nút BOOT | 7, 10 | M | End-to-end như mục 10 (`uno-05-running-*`) |
| 12 | Terminal (xterm hoặc pre), Run/Stop, tự dừng khi `done` | 10 | S | Terminal giống `uno-06` |
| 13 | Persistence IndexedDB + danh sách project + export/import JSON | 1 | S | Lưu/mở lại không mất bend point/màu |
| 14 | (Phase 2) Breadboard 420 lỗ, potentiometer, LDR slider khi chạy, PWM | 6–11 | M | – |
| 15 | (Demo C) Robot 2D top-down: thân + 2 bánh + cảm biến khoảng cách + tường; Blockly `move/turn/distance` | 10 | L | Robot dừng trước tường |

---

## 20. Unknowns and Risks

| # | Hạng mục | Trạng thái | Ảnh hưởng cho demo |
|---|---|---|---|
| 1 | Chế độ **C** trong giả lập chạy thế nào | [UNK] | Không cần cho MVP |
| 2 | Công thức độ sáng LED, vị trí DOM hiện thông báo lỗi | [UNK] | Tự thiết kế |
| 3 | Tụ điện, transient: solver chỉ DC (dt=0) | [INF] | Nếu muốn dạy nạp/xả tụ phải tự thêm transient (backward Euler) |
| 4 | `_broken` được lưu vào params (có thể vào IndexedDB nếu lưu khi chưa chạy) | [RT] quan sát flag xuất hiện trong model; bản lưu sau khi chạy không còn flag | Rủi ro thiết kế. Demo nên tách runtime state |
| 5 | Ánh xạ PWM → motor M1/M2 trong robot 3D; pose robot dạng số | [UNK] / [UI] chỉ ảnh | Demo C tự định nghĩa |
| 6 | Thêm/sửa object trên Map Builder bằng UI; nạp template bằng click | [UNK] | Schema đã có; UI tự thiết kế |
| 7 | Bản ghi `iot-panels` sau khi lưu | [UNK] (schema từ bộ nhớ + source) | Thấp |
| 8 | Thử nhận diện AI bằng webcam | [UNK] (không có camera headless) | Thấp |
| 9 | `portData` gửi quá nhiều (~60 message mỗi lần model thay đổi) | [RT] | Demo nên chỉ gửi chân thay đổi hoặc gộp theo frame |
| 10 | GEARS là GPL-3.0; GLB/ảnh của OhStem | [SRC] license | **Không** sao chép code/asset. Chỉ học mô hình dữ liệu |
| 11 | ApexCharts license kép | [SRC] | Dùng chart MIT |
| 12 | JSPI chỉ có ở Chromium mới; fallback SAB cần COOP/COEP | [RT] | Cấu hình header ngay từ đầu cho demo |
| 13 | Ảnh của các bước tự động hoá thất bại đã bị xoá khỏi assets để tránh nhầm (placement đầu tiên bấm nhầm tiêu đề inspector, v.v.) | – | – |

---

### Phụ lục: file dữ liệu trong `ohstem-reconstruction-assets/data/`

`circuit-component-catalog.json` · `circuit-project-idb-record.json` · `circuit-diff-sequence.json` · `circuit-uno-export-bundle.json` · `circuit-uno-run-timeline.json` · `circuit-worker-protocol.json` · `codegen-cases.json` · `blockly-toolbox-{yolouno,yolobit,xbot}.json` · `robot-project-export.json` · `robot-rover-group-definition.json` · `map-world-template-lesson3.json` · `map-world-template-lesson6.json` · `map-scene-idb-record.json` · `ai-trainer-storage.json` · `iot-dashboard-state.json` · `device-code-project-localstorage.json`
