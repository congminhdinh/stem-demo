# ADR 0002 — Render 3D của robot lab: three.js + @react-three/fiber

- **Trạng thái:** đề xuất, chờ controller duyệt. Đây là phần render của gate G0 (N18 task R0.2). Physics có ADR riêng (R0.1, `0001-robot-physics.md`).
- **Ngày:** 2026-10-25. **Nhánh:** `n18/r02-render`.
- **Bằng chứng:** `spikes/robot-render/` (code spike, `measure.mjs`, `tables.mjs`) và `spikes/robot-render/results/*.json`. Mọi số trong tài liệu này
  lấy từ các file JSON đó (`node spikes/robot-render/tables.mjs` in lại các bảng). Spike là bằng chứng, không phải code sản phẩm (eslint bỏ qua `spikes/`, không nằm trong `tsconfig`); giữ hay xoá sau gate G0 do controller quyết định.

## 1. Câu hỏi

Plan N18 (D-R7) chọn three.js + @react-three/fiber (R3F) + drei, và §5 đặt ngân sách: chunk JS 3D ≤ 0,6 MB gzip, ≥ 50 fps trên laptop tầm trung,
≥ 30 fps ở tier thấp khi CPU throttle 4×, chạy → robot chuyển động ≤ 300 ms. R0.2 trả lời năm câu:

1. Chunk lazy của three + R3F nặng bao nhiêu (gzip, brotli), có kéo theo `@mediapipe/tasks-vision` của drei không, và dùng `OrbitControls` của drei hay của three thì khác gì?
2. FPS ở tier cao/thấp, bình thường và khi throttle 4×, trong iframe 1100×640 của LMS?
3. Playwright headless có render WebGL với `--use-angle=swiftshader --enable-unsafe-swiftshader` không; FPS và độ ổn định ra sao?
4. `webglcontextlost` xảy ra thì sao, R3F phục hồi thế nào?
5. Nên cấu hình renderer thế nào cho từng tier.

## 2. Quyết định

1. **Giữ three 0.186.1 + R3F 9.8.1**, nạp lazy bằng `React.lazy`. Phần render (three + R3F + scene spike) là **246,0 kB gzip** (202,9 kB brotli), tức 41 % ngân sách 0,6 MB.
2. **Camera tự do dùng `OrbitControls` của three** (`three/examples/jsm/controls/OrbitControls.js`) bọc tay khoảng 20 dòng, **không import barrel `@react-three/drei`** trong `src/`. Kích thước
   bằng nhau (chênh 0,1 kB); lý do là rủi ro mặc định tải từ CDN của drei và phiên bản `three-stdlib` đi sau three (mục 5).
3. **Hai tier** như bảng ở mục 6: cao = shadow `"percentage"` + DPR ≤ 1,5 + MSAA; thấp = không shadow + DPR 1 + không MSAA. Chọn tier thấp mặc định khi renderer là phần mềm (SwiftShader/llvmpipe).
4. **`frameloop="demand"` khi không chạy**, `"always"` khi chạy. Đã đo: 0 frame trong 3 s idle, orbit vẫn vẽ (mục 4.5).
5. **Xử lý context loss bằng handler của app** (mục 4.7, mã mẫu ở mục 6): R3F 9.8.1 không có handler nào; three tự phục hồi nhưng vòng `demand` không tự vẽ lại sau khi phục hồi.
6. **E2E dùng Playwright Chromium với `--use-angle=swiftshader --enable-unsafe-swiftshader`** (mục 7). Không assert FPS trong E2E.
7. **G0 phần render: PASS**, có hai điều kiện ghi ở mục 8 (chưa đo trên laptop tầm trung thật; ngân sách draw call của scene R4).

## 3. Phương pháp và môi trường

| Mục | Giá trị |
|---|---|
| Máy | Apple M4 Pro, 12 lõi, 24 GB, macOS 26.5.2 (Darwin 25.5.0), cắm điện (`pmset`: AC Power, powermode 2) |
| Node, pnpm | 24.22.1, 12.8.1 |
| Playwright | 1.63.0. Chromium 153.0.8010.12 (cả `chromium-headless-shell` và Chromium đầy đủ ở chế độ "new headless"), Firefox 155.0, WebKit 26.6 |
| Thư viện | three 0.186.1, @react-three/fiber 9.8.1, @react-three/drei 10.7.9, React 19.3.0, Vite 8.3.2 |
| Tải máy | **máy dùng chung với các agent chạy song song**: load average 1 phút lúc bắt đầu mỗi ô đo FPS từ 3,5 đến 16 (trung vị 7,3) trên 12 lõi |

**Spike** (`spikes/robot-render/`): trang tự có `vite.config.ts` riêng; chunk 3D nạp bằng `React.lazy(() => import('./Lab'))`. Sa bàn 2×2 m (nền, đường line đen
dạng ruy băng 240 điểm, 4 tường, 3 hộp, 4 vùng màu), robot thủ tục (khung hộp, bo mạch, 2 bánh, bánh caster, cảm biến siêu âm và 3 cảm biến line dạng khối), replay **1 000 tick** pose ghi sẵn
(100 Hz, 10 s ảo, sinh bằng động học, vòng lặp liền mạch, nội suy mỗi frame; không có physics). Cảnh gồm 41 draw call và 2 030 tam giác ở tier cao (đã tính lượt vẽ shadow), 27 và 1 354 ở tier thấp.
Canvas phủ cả iframe 1100×640, lớn hơn viewport thật (khoảng 60 % khung), nên là phép đo thận trọng về số pixel.

**Khung nhúng:** dùng nguyên `e2e/lesson-host.mjs` (cổng 5222, iframe 1100×640) với `sandbox="allow-scripts allow-same-origin allow-downloads"` (`docs/lab-embed-contract.md` §4);
lab phục vụ bởi `vite preview` bản production (cổng 5221) với cùng header COOP/COEP của sản phẩm. `LAB_FRAME_ALLOW` (`clipboard-write; autoplay; camera/microphone/geolocation 'none'`) không có tính năng nào liên quan WebGL; host E2E
không đặt `allow=`, nên chỉ phần này khác bản thật.

**Giao thức FPS:** mỗi ô đo = 2 s khởi động + 8 s đo, **3 lần chạy**, báo trung vị của các lần (và p5 xấu nhất trong các lần). Khoảng cách giữa hai callback `useFrame` là chu kỳ frame người dùng thấy;
`median fps = 1000 / trung vị(Δt)`, `p5 fps = 1000 / p95(Δt)` (5 % frame chậm nhất). Throttle: CDP `Emulation.setCPUThrottlingRate` = 4, đặt **trước** khi nạp trang;
kiểm chứng trong iframe: cùng một vòng lặp cố định mất 16 đến 19 ms ở 1× và 63 đến 75 ms ở 4× (khoảng 3,9×). Throttle chỉ làm chậm main thread của renderer, **không** làm chậm tiến trình GPU/SwiftShader.

Nhóm trình duyệt:

| Nhóm | Cách chạy | Renderer WebGL |
|---|---|---|
| `gpu-capped` | Chromium "new headless" (`channel: 'chromium'`), mặc định, vsync 60 Hz | ANGLE Metal, Apple M4 Pro |
| `gpu-uncapped` | như trên + `--disable-frame-rate-limit --disable-gpu-vsync`: đo **dung lượng** frame | ANGLE Metal |
| `swiftshader-shell` | Playwright `headless: true` (headless shell) + `--use-angle=swiftshader --enable-unsafe-swiftshader` | SwiftShader (Vulkan, LLVM 10) |
| `swiftshader-new` | Chromium new headless + hai cờ SwiftShader | SwiftShader |

DPR: `deviceScaleFactor` 1 và 2. Ở DPR 2 tier cao có drawing buffer 1650×960 (do giới hạn 1,5), tier thấp vẫn 1100×640.

## 4. Kết quả

### 4.1 Bundle (production build, `measure.mjs bundle`)

| Biến thể | Chunk lazy 3D (min) | gzip -9 | gzip -6 (số Vite in) | brotli -11 | mediapipe trong chunk |
|---|---:|---:|---:|---:|---|
| three (`three/examples/.../OrbitControls.js`) | 939,9 kB | **246,0 kB** | 246,8 kB | 202,9 kB | không |
| drei (`import { OrbitControls } from '@react-three/drei'`) | 935,3 kB | **246,1 kB** | 246,9 kB | 202,8 kB | không |

- kB = 1 000 byte. Cả hai biến thể chỉ có một chunk lazy (`Lab-*.js`) và một chunk entry (React + react-dom + entry spike, 222,2 kB / 68,9 kB gzip; trong sản phẩm React nằm sẵn ở chunk app, không tính vào chunk 3D).
- **`@mediapipe/tasks-vision` không có trong chunk** của cả hai biến thể: không có chuỗi `mediapipe`/`tasks-vision`/`FaceLandmarker` trong bất kỳ file JS nào, không có trong source map, không có chunk riêng. Drei khai báo nó là dependency và `FaceLandmarker` chỉ `await import()` nó,
  nhưng `sideEffects: false` cộng với việc chỉ import `OrbitControls` khiến Rolldown loại bỏ toàn bộ nhánh đó.
- Thành phần chunk (ước lượng theo source map, chỉ để biết tỉ lệ): three 584,2 kB, R3F 165,6 kB, `OrbitControls` của three 19,8 kB (hoặc `three-stdlib` 14,3 kB + drei 1,0 kB), các thư viện nhỏ của R3F (react-use-measure, its-fine, zustand…) khoảng 8 kB, code spike 9,7 kB.
  R3F `extend` cả danh mục three nên **không cắt được phần three**: đừng kỳ vọng tree-shaking giảm 584 kB này.
- Khác biệt thật của drei nằm ở đồ thị module: build với drei phải transform **572 module** (so với 34), dù kết quả sau tree-shake chỉ hơn 3 module. Thời gian build gần như bằng nhau (316 ms so với 340 ms); chi phí lớn hơn nằm ở dev server (pre-bundle toàn bộ drei), chưa đo.
- Để so sánh (không thuộc chunk render; R0.1 quyết định): `rapier3d-deterministic` tách file: `.wasm` 3 105,9 kB, **1 179,5 kB gzip** (855,2 kB brotli). `rapier3d-deterministic-compat` (WASM nhúng base64 trong JS): `rapier.mjs` 4 372,0 kB, **1 650,9 kB gzip**.
  **Nếu R0.1 chọn bản compat thì chunk JS 3D (246 kB + 1 651 kB) vượt xa 0,6 MB**; chỉ bản tách file mới hợp với ngân sách "JS chunk 3D ≤ 0,6 MB" và "WASM ≤ 1,3 MB".

### 4.2 FPS (`measure.mjs fps`, 3 lần chạy mỗi ô)

Mỗi ô: median fps / p5 fps (trong ngoặc: p5 xấu nhất của một lần chạy bất kỳ).

| Nhóm | DPR (drawing buffer) | Tier | CPU 1× | CPU 4× |
|---|---|---|---:|---:|
| gpu-capped | 1 (1100×640) | cao | 59,9 / 57,8 (57,5) | 59,9 / 56,8 (56,2) |
| gpu-capped | 1 (1100×640) | thấp | 59,9 / 57,1 (57,1) | 59,9 / 56,8 (56,5) |
| gpu-capped | 2 (1650×960) | cao | 59,9 / 57,5 (57,5) | 59,9 / 56,8 (56,8) |
| gpu-capped | 2 (1100×640) | thấp | 59,9 / 58,1 (57,5) | 59,9 / 56,8 (56,8) |
| gpu-uncapped | 1 | cao | 500 / 285,7 (277,8) | 833,3 / 333,3 (294,1) |
| gpu-uncapped | 1 | thấp | 500 / 400 (400) | 769,2 / 370,4 (370,4) |
| gpu-uncapped | 2 (1650×960) | cao | 526,3 / 384,6 (384,6) | 769,2 / 357,1 (357,1) |
| gpu-uncapped | 2 (1100×640) | thấp | 500 / 416,7 (400) | 769,2 / 333,3 (333,3) |
| swiftshader-shell | 1 | cao | 59,9 / 55,2 (41,5) | 59,2 / 36,9 (35,5) |
| swiftshader-shell | 1 | thấp | 59,9 / 55,2 (54,6) | 59,9 / 54,6 (54,6) |
| swiftshader-shell | 2 (1650×960) | cao | 58,8 / 48,8 (30,9) | 59,9 / 54,3 (54,3) |
| swiftshader-shell | 2 (1100×640) | thấp | 59,9 / 54,9 (54,9) | 59,9 / 54,6 (54,6) |
| swiftshader-new | 1 | cao | 59,9 / 55,2 (54,6) | 59,9 / 55,2 (54,3) |
| swiftshader-new | 1 | thấp | 59,9 / 55,2 (54,6) | 59,9 / 54,6 (54,1) |
| swiftshader-new | 2 (1650×960) | cao | 59,9 / 54,6 (54,1) | 58,8 / 54,1 (50,8) |
| swiftshader-new | 2 (1100×640) | thấp | 59,9 / 55,9 (55,2) | 59,9 / 54,9 (54,6) |

Đọc bảng:

- Các nhóm có vsync bị chặn ở 59,9 fps (60 Hz); p5 khoảng 55 đến 58 chỉ là một khung trễ một nhịp. Không ô nào của GPU thật có p5 dưới 56,2.
- **Dung lượng** (nhóm `gpu-uncapped`, tắt giới hạn khung): trung vị 500 đến 833 fps, p5 thấp nhất 277,8 fps. Thời gian `gl.render()` trên main thread là 0,2 ms (1×) và 0,5 ms (4×) ở tier cao (trung vị), tức khoảng 1/30 của 16,7 ms ở 4×, nên throttle 4× gần như không đổi FPS. Đây chỉ là chi phí gửi lệnh; thời gian GPU không đo trực tiếp (dung lượng `gpu-uncapped` là chỉ số gián tiếp).
- **SwiftShader** (rasterizer CPU, không GPU): median ≥ 58,8 ở mọi ô. Tier thấp: p5 ≥ 54,1 ở mọi ô. Tier cao **dao động**: p5 xấu nhất 30,9 (DPR 2, 1×, một lần chạy có một frame 6,5 fps) và 35,5 (DPR 1, 4×).
  Tier cao trên phần mềm nằm sát rìa; đó là lý do mục 6 chọn tier thấp khi renderer là phần mềm.
- Một lượt đo đầu (1 lần/ô, không giữ JSON) cho ô SwiftShader tier cao DPR 1 1× ra median 45,2 / p5 18,5; đó là ô đầu tiên sau khi bật trình duyệt, và một lượt soak thử (JSON không giữ; `uptime` lúc đó báo load average 1 phút tăng đến khoảng 22) ra p5 15,8 (cao, 4×) và 27,3 (thấp, 4×).
  Hai lượt đó không còn trong `results/`; tôi ghi lại để cảnh báo rằng **p5 của SwiftShader phụ thuộc mạnh vào tải CPU của máy chủ**. Số trong bảng là các lần chạy được giữ lại.

### 4.3 Sức chịu tải của scene (`measure.mjs stress`, CPU 4×, DPR 1)

Mỗi "robot thêm" là khoảng 20 draw call (khoảng 40 với lượt shadow).

| Nhóm | Tier | Robot thêm | Draw call | Tam giác | median fps | p5 fps |
|---|---|---:|---:|---:|---:|---:|
| gpu-uncapped | cao | 0 / 8 / 24 | 41 / 209 / 545 | 2 030 / 13 006 / 34 958 | 833,3 / 714,3 / 277,8 | 322,6 / 400 / 204,1 |
| gpu-uncapped | thấp | 0 / 8 / 24 | 27 / 139 / 363 | 1 354 / 7 594 / 20 074 | 714,3 / 833,3 / 526,3 | 333,3 / 344,8 / 384,6 |
| swiftshader-shell | cao | 0 / 8 / 24 | 41 / 209 / 545 | 2 030 / 13 006 / 34 958 | 59,9 / 59,9 / **48,8** | 54,6 / 54,1 / 45,9 |
| swiftshader-shell | thấp | 0 / 8 / 24 | 27 / 139 / 363 | 1 354 / 7 594 / 20 074 | 59,9 / 59,9 / 59,9 | 54,9 / 54,1 / 54,3 |

Trên phần mềm, tier cao giữ 60 fps đến khoảng 209 draw call và rơi xuống 48,8 fps ở 545; tier thấp giữ 60 fps đến 363 draw call. Trên GPU thật, 545 draw call vẫn 277,8 fps.
**Ngân sách cho scene R4: ≤ 200 draw call ở tier cao, ≤ 350 ở tier thấp** (hợp nhất hình học tĩnh: tường, vùng màu, line; dùng `InstancedMesh` cho vật lặp).

### 4.4 MSAA (`measure.mjs aa`, CPU 4×, DPR 2)

| Nhóm | Tier | antialias tắt (median / p5) | antialias bật (median / p5) |
|---|---|---:|---:|
| swiftshader-shell | cao | 59,5 / 54,6 | 58,5 / 53,8 |
| swiftshader-shell | thấp | 59,9 / 54,3 | 59,9 / 54,1 |
| gpu-uncapped | cao | 833,3 / 333,3 | 769,2 / 333,3 |
| gpu-uncapped | thấp | 909,1 / 344,8 | 909,1 / 333,3 |

Chi phí MSAA ở cảnh này nhỏ (dưới 10 % dung lượng trên GPU, không phân biệt được trên SwiftShader bị chặn 60 Hz). Tắt MSAA ở tier thấp vẫn hợp lý vì tiết kiệm bộ nhớ và băng thông trên iGPU yếu, nhưng đây là lựa chọn thận trọng, **không** phải kết quả đo thấy khác biệt lớn.

### 4.5 Vòng lặp `demand`, orbit, khởi động (`measure.mjs idle`, `boot`)

| Biến thể controls | frame khi idle (3 s) | frame sau khi kéo chuột | frame trong 2 s sau khi ổn định | camera đổi vị trí | frame khi chạy (3 s) | `run()` đến frame thứ 2 (1× / 4×) |
|---|---:|---:|---:|---|---:|---:|
| three | **0** | 103 | **0** | có | 180 | 13,5 ms / 17,6 ms |
| drei | **0** | 103 | **0** | có | 180 | 19,1 ms / 16,3 ms |

- `frameloop="demand"` đứng yên hoàn toàn khi idle (0 frame); kéo chuột vẽ lại, sau khi damping lắng thì về 0. Cả hai biến thể `OrbitControls` hành xử như nhau, kể cả việc phải gọi `invalidate()` khi sự kiện `change` bắn (wrapper của three có đoạn này).
- **Chạy → robot chuyển động:** từ `run()` (chuyển `demand` sang `always`) đến frame thứ hai (frame đầu tiên robot đã dịch chuyển) mất 13 đến 19 ms ở cả 1× và 4×, so với ngân sách 300 ms. Đây mới chỉ là phần render; phần scheduler/physics thuộc R3.

Khởi động chunk lazy (nạp mới, trung vị 7 lần, localhost, không có độ trễ mạng):

| Controls | CPU | import (tải, parse, chạy) | `new WebGLRenderer()` | renderer đến frame đầu | frame đầu tính từ lúc bắt đầu import |
|---|---:|---:|---:|---:|---:|
| three | 1× | 33,3 ms | 6,1 ms | 9,8 ms | 384,1 ms |
| three | 4× | 94,5 ms | 23,0 ms | 41,8 ms | 435,4 ms |
| drei | 1× | 32,1 ms | 6,2 ms | 10,0 ms | 383,5 ms |
| drei | 4× | 82,6 ms | 18,8 ms | 37,5 ms | 424,3 ms |

Phần việc thật (import + renderer + frame đầu) là khoảng 50 ms (1×) đến 160 ms (4×). Phần còn lại của 380 đến 435 ms (khoảng 270 đến 335 ms giữa lúc import xong và lúc tạo renderer) **không phải CPU**:
là React 19 giữ lại việc commit Suspense boundary vừa tải xong tối đa 300 ms sau khi fallback hiện (`FALLBACK_THROTTLE_MS = 300`, `node_modules/react-dom/cjs/react-dom-client.development.js:30031`); hằng số này không đổi theo throttle.
Với mạng thật, chunk tải lâu hơn 300 ms thì độ trễ này biến mất. Không có biến thể nào tốn thêm đáng kể ở lúc nạp.

### 4.6 Render headless (`measure.mjs flags`, `soak`)

| Cách chạy | WebGL2 | Renderer |
|---|---|---|
| headless shell, mặc định Playwright | có | SwiftShader (Vulkan) |
| headless shell, bỏ `--enable-unsafe-swiftshader` (`ignoreDefaultArgs`) | có, nhưng console có cảnh báo *"Automatic fallback to software WebGL has been deprecated. Please use the --enable-unsafe-swiftshader flag…"* | SwiftShader |
| headless shell, `--use-angle=swiftshader --enable-unsafe-swiftshader` | có | SwiftShader |
| headless shell, `--disable-gpu` | có (vẫn rơi về SwiftShader) | SwiftShader |
| headless shell, `--disable-3d-apis` | **không** (`getContext('webgl2')` trả `null`) | n/a |
| new headless, mặc định | có | **GPU thật** (ANGLE Metal, Apple M4 Pro) |
| new headless, hai cờ SwiftShader | có | SwiftShader |
| new headless, `--disable-3d-apis` | **không** | n/a |

- Trong Playwright 1.63.0, bộ khởi chạy Chromium **đã tự thêm `--enable-unsafe-swiftshader`** (`playwright-core/lib/coreBundle.js`, `_innerDefaultArgs`); bỏ nó đi vẫn chạy ở Chromium 153 nhưng có cảnh báo deprecate, nên nên giữ cờ tường minh.
  `--use-angle=swiftshader` quyết định Chromium full (new headless) dùng GPU thật hay SwiftShader: không có cờ này, chạy trên máy dev ra GPU thật còn trên CI ra SwiftShader, tức hai môi trường khác nhau.
- **FPS và độ ổn định:** FPS ở mục 4.2 (median ≥ 58,8; tier thấp p5 ≥ 54,1). Soak 60 s, 2 lần × 4 cấu hình (tier cao/thấp × CPU 1×/4×), `swiftshader-shell`, DPR 1:

| Lần | Tier | CPU | Load máy chủ (đầu / cuối) | frame | median fps | p5 fps | frame > 50 ms | heap MB đầu → cuối | geometry/texture GL đầu → cuối | context event | crash |
|---:|---|---:|---|---:|---:|---:|---:|---|---|---:|---:|
| 1 | cao | 1× | 12,2 / 11,15 | 3 519 | 59,9 | 55,2 | 14 | 10 → 10 | 27/3 → 27/3 | 0 | 0 |
| 1 | thấp | 1× | 11,15 / 7,15 | 3 601 | 59,9 | 55,2 | 0 | 10 → 10 | 27/1 → 27/1 | 0 | 0 |
| 1 | cao | 4× | 6,98 / 12,32 | 3 239 | 59,2 | 35,2 | 28 | 10 → 10 | 27/3 → 27/3 | 0 | 0 |
| 1 | thấp | 4× | 13,98 / 8,71 | 3 590 | 59,9 | 54,3 | 2 | 10 → 10 | 27/1 → 27/1 | 0 | 0 |
| 2 | cao | 1× | 8,71 / 6,77 | 3 601 | 59,9 | 55,2 | 0 | 10 → 10 | 27/3 → 27/3 | 0 | 0 |
| 2 | thấp | 1× | 7,27 / 5,57 | 3 590 | 59,9 | 54,9 | 1 | 10 → 10 | 27/1 → 27/1 | 0 | 0 |
| 2 | cao | 4× | 5,57 / 5,17 | 3 601 | 59,9 | 54,3 | 0 | 10 → 10 | 27/3 → 27/3 | 0 | 0 |
| 2 | thấp | 4× | 5,08 / 5,23 | 3 601 | 59,9 | 54,3 | 0 | 10 → 10 | 27/1 → 27/1 | 0 | 0 |

  Không crash, không context lost, tài nguyên GL phẳng, không có `console.error`; chỉ có hai loại cảnh báo (kiểu `warning`): `THREE.Clock: This module has been deprecated` (R3F 9.8.1 vẫn dùng `THREE.Clock`) và thông điệp của driver `GPU stall due to ReadPixels`
  (chỉ thấy với SwiftShader, Chromium tự ngừng lặp sau vài lần; nguyên nhân chưa xác định, có thể do compositor phần mềm đọc lại canvas). `performance.memory` do Chromium làm tròn theo bậc nên chỉ khẳng định "không tăng thấy được", không phải rò rỉ bằng 0.
  Một lần chạy (cao, 4×, load tăng lên 12) có p5 35,2, thấp hơn các lần khác: tier cao trên phần mềm nhạy với tải máy chủ.
- Screenshot render đúng (không trống) của hai tier: `results/render-high-swiftshader.png`, `results/render-low-swiftshader.png`.
- Firefox 155.0 và WebKit 26.6 (Playwright headless) cũng render WebGL: Firefox median 125 / p5 100 fps (chu kỳ frame 8 ms, không bị chặn ở 60 Hz), WebKit 58,8 / 55,6. Firefox in một cảnh báo về lọc depth texture (`WebGL warning: drawElementsInstanced: Depth texture comparison…`) từ PCF shadow của three.
  Playwright của repo chỉ khai báo project chromium; số này chỉ để biết không có rào cản ở hai engine kia.

### 4.7 Context loss (`measure.mjs context`)

Thử bằng `WEBGL_lose_context` (`loseContext()` / `restoreContext()`) trên GPU thật và SwiftShader, ba kịch bản: đang chạy (`always`) rồi phục hồi; đứng yên (`demand`) rồi phục hồi; đang chạy và không bao giờ phục hồi. Kết quả giống nhau ở cả hai renderer:

| Hiện tượng | Quan sát |
|---|---|
| Sự kiện | `webglcontextlost` bắn một lần, **`defaultPrevented = true`**: three đã gọi `preventDefault()` nên trình duyệt cho phép phục hồi |
| Trong lúc mất | `isContextLost() = true`, `readPixels` trả `[0,0,0,0]`; `gl.render()` thoát ngay (0 ms), không ném lỗi; canvas **trống** (hiện nền trang). Vòng R3F `always` vẫn gọi `useFrame` khoảng 60 lần/s (90 đến 94 lần trong 1,5 s) mà không vẽ gì |
| Phục hồi | sự kiện `webglcontextrestored` đến sau 4,1 đến 26,5 ms kể từ `restoreContext()`; three log `THREE.WebGLRenderer: Context Restored.` và tự khởi tạo lại GL (không cần dựng lại scene) |
| Vòng `always` sau phục hồi | tự vẽ lại: 75 đến 92 frame trong 1,5 s kế tiếp |
| Vòng `demand` sau phục hồi | **0 frame được vẽ**, canvas vẫn trống (screenshot `…-restored.png` trùng từng byte với `…-lost.png`) cho đến khi có `invalidate()`; sau `invalidate()` vẽ 1 frame và ảnh trùng từng byte với ảnh trước khi mất (`…-before.png` = `…-invalidated.png`); băm FNV-1a toàn bộ drawing buffer cũng khớp |
| Không phục hồi | canvas trống mãi; vòng `always` vẫn đốt callback; app không nhận tín hiệu nào nếu không tự nghe |

Cách R3F phục hồi: **R3F 9.8.1 không xử lý context loss** (không có chuỗi `webglcontext` nào trong `@react-three/fiber/dist`); toàn bộ phục hồi là của `THREE.WebGLRenderer`
(`three.module.js`: `onContextLost` gọi `preventDefault()` và đặt `_isContextLost`; `onContextRestore` gọi `initGLContext()` rồi giữ cấu hình shadow map). Trạng thái mô phỏng nằm ở `src/core` (không ở GL) nên không mất gì khi context mất.

## 5. drei hay `OrbitControls` của three

| Tiêu chí | drei (`OrbitControls`) | three (`examples/jsm`) |
|---|---|---|
| Kích thước chunk | 246,1 kB gzip | 246,0 kB gzip (chênh 0,1 kB) |
| mediapipe trong chunk | không | không |
| Mã cần viết | 1 dòng | khoảng 20 dòng (`spikes/robot-render/src/controls-three.tsx`) |
| Module Vite phải transform | 572 | 34 |
| Phiên bản mã | `three-stdlib` 2.36.1 (bản port riêng, đi sau three) | cùng phiên bản với `three` 0.186.1 và `@types/three` 0.186.0 |
| Mặc định chạm mạng | có ở nhiều helper khác trong barrel (xem dưới) | không |
| Vòng `demand` | đúng (103 frame khi kéo, 0 khi idle) | đúng (như nhau) |

**Khuyến nghị: dùng `OrbitControls` của three, tự bọc.** Kích thước không phải lý do (bằng nhau); lý do là:

1. `docs/lab-embed-contract.md` quy định lab "không tải gì từ trang nhúng hay CDN". Nhiều helper của drei mặc định tải từ CDN: `useGLTF` (decoder Draco từ `www.gstatic.com/draco/versioned/decoders/1.5.5/`),
   `Environment`/`useEnvironment` (HDRI từ `raw.githack.com/pmndrs/drei-assets`), `Cloud`, `MatcapTexture`, `NormalTexture` (cdn.jsdelivr.net, rawcdn.githack.com), `FaceLandmarker` (cdn.jsdelivr.net và storage.googleapis.com).
   Một câu `import` nhầm là phá hợp đồng đó; chunk vẫn nhỏ nên không có tín hiệu cảnh báo nào. (Danh sách lấy bằng `grep` trên `node_modules/@react-three/drei/{core,web}`.)
2. `OrbitControls` của drei đến từ `three-stdlib`, tách phiên bản khỏi three; bản của three luôn khớp kiểu `@types/three` đã cài.
3. Không kéo thêm đồ thị phụ thuộc (drei có hơn 20 dependency trực tiếp, gồm `@mediapipe/tasks-vision`, `hls.js`, `troika-three-text`…) vào dev server và supply chain.

Nếu R4 cần một helper drei thật sự đáng giá (ví dụ `useGLTF` ở giai đoạn GLB), import **deep path** và trỏ decoder về file tự host, qua review từng helper.
Gợi ý cho controller: khi R4 bắt đầu, thêm `no-restricted-imports` cho `@react-three/drei` vào `eslint.config.js` (cùng chỗ B1); nếu R4 không dùng helper nào thì gỡ `@react-three/drei` khỏi `package.json`
(R0.2 không đổi dependency theo luật chung nên chưa gỡ).

## 6. Cấu hình renderer theo tier

| Thiết lập | Tier cao | Tier thấp |
|---|---|---|
| `shadows` (R3F) | `"percentage"` (`PCFShadowMap`) | `false` (và không `castShadow`) |
| shadow map | `directionalLight` 2048×2048, `shadow-bias` -0,0004, camera shadow phủ 3×3 m | không có |
| `dpr` | `[1, 1.5]` | `1` |
| `gl.antialias` | `true` | `false` |
| `frameloop` | `"demand"` khi dừng; `setFrameloop('always')` khi chạy | như tier cao |
| `gl.powerPreference` | mặc định của R3F (`'high-performance'`) | như tier cao |
| Ngân sách draw call (mục 4.3) | ≤ 200 | ≤ 350 |

- **Dùng `"percentage"`, không dùng `true`/`"soft"`.** R3F 9.8.1 ánh xạ `shadows={true}` và `"soft"` sang `PCFSoftShadowMap`, mà three 0.186.1 đã gỡ kiểu này: nó in cảnh báo
  *"PCFSoftShadowMap has been removed. Using PCFShadowMap instead."* rồi rơi về `PCFShadowMap` (`three.module.js` quanh dòng 9150; R3F `events-*.esm.js` quanh dòng 1583). Phát hiện này đến từ đọc mã đã cài; spike dùng `"percentage"` nên không kích hoạt cảnh báo.
- `antialias` cố định lúc tạo context: đổi tier phải **dựng lại `<Canvas>`** (đổi `key`). `dpr` và `shadows` đổi được lúc chạy.
- **Chọn tier:** mặc định `high`; mặc định `low` khi `UNMASKED_RENDERER_WEBGL` khớp `/SwiftShader|llvmpipe|software/i`; tự hạ xuống `low` nếu p5 trong 3 s liên tiếp dưới 30 fps khi đang `always`. Hai quy tắc tự động này **chưa được đo** trong spike; chúng suy ra từ bảng 4.2 (tier cao trên phần mềm dao động, tier thấp ổn).
- **Context loss** (mã mẫu; R4.6 hiện thực kèm `TopView2D` fallback):

```tsx
<Canvas
  frameloop="demand"
  onCreated={({ gl, invalidate }) => {
    const canvas = gl.domElement;
    // three has already called preventDefault(), so the browser may restore the context.
    canvas.addEventListener('webglcontextlost', () => onContextLost()); // show an overlay; arm a ~3 s fallback timer
    canvas.addEventListener('webglcontextrestored', () => {
      onContextRestored(); // cancel the timer, hide the overlay
      invalidate(); // required with frameloop="demand": nothing else redraws the blank canvas
    });
  }}
/>
```

  Khi mất context: hiện thông báo nhỏ; nếu **2 s** (R4.6, trước đó ADR ghi 3 s) không có `webglcontextrestored` thì `TopView2D` thế chỗ scene, còn `<Canvas>` **vẫn mounted** bên dưới để nghe `webglcontextrestored` và đưa 3D về; simulation vẫn chạy vì không phụ thuộc GL. (Không dùng `setFrameloop('never')`: frameloop đã là `demand`, và R3F vẫn vẽ lại khi context về nhờ `invalidate()`.) Khi thử: `getExtension('WEBGL_lose_context')` trả `null` lúc context đã mất, nên extension phải lấy từ trước, rồi mới gọi `restoreContext()` lên chính đối tượng đó (chạy thật trong Chromium + SwiftShader: sự kiện `webglcontextlost` tới sau khoảng 160 ms, `webglcontextrestored` sau khoảng 170 ms).

## 7. Playwright cho E2E

```ts
// playwright.config.ts: project for the robot specs (R4)
{
  name: 'chromium-robot',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1200, height: 760 }, // the lesson host page plus the 1100x640 frame
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
}
```

- Hai cờ trên cho WebGL phần mềm **giống nhau trên máy dev và CI** và không phụ thuộc GPU (mục 4.6). Nên giữ cờ tường minh dù Playwright 1.63 đã thêm `--enable-unsafe-swiftshader`.
- Tắt WebGL cho `robot-webgl-fallback.spec.ts`: **`--disable-3d-apis`** (đã kiểm: `getContext('webgl2')` trả `null`). `--disable-gpu` **không** tắt WebGL (rơi về SwiftShader).
- Phải chấp nhận cảnh báo `THREE.Clock` và `GL Driver Message … GPU stall due to ReadPixels` (cả hai kiểu `warning`); assert "không có console error" nên lọc theo kiểu `error`/`pageerror`.
- **Không assert FPS trong E2E**: FPS SwiftShader phụ thuộc tải CPU máy chủ (mục 4.2). E2E assert chức năng: canvas không trống (`readPixels`), băm snapshot, sự kiện context lost/restored. FPS đo bằng script riêng (`measure.mjs`) và ghi kèm load average.
- Mất context trong E2E: `canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()` / `.restoreContext()`, chạy được cả trên SwiftShader lẫn GPU thật.
- Throttle CPU trong E2E: `context.newCDPSession(page)` rồi `Emulation.setCPUThrottlingRate` (chỉ Chromium). Nó **không** làm chậm GPU/SwiftShader (mục 3).

## 8. Verdict G0 theo từng dòng ngân sách (§5)

| Dòng ngân sách | Kết luận | Bằng chứng |
|---|---|---|
| JS chunk 3D ≤ 0,6 MB gzip | **PASS** cho phần render | 246,0 kB gzip -9 (246,8 kB gzip -6; 202,9 kB brotli) = 41 % ngân sách; còn khoảng 354 kB cho code scene, UI, glue. **Cảnh báo cho R0.1:** bản `-compat` (1 650,9 kB gzip) phá ngân sách; chỉ bản WASM tách file hợp |
| physics WASM ≤ 1,3 MB gzip | không thuộc R0.2 | tham khảo: `.wasm` tách file 1 179,5 kB gzip -9 (R0.1 quyết định) |
| init physics ≤ 1,5 s khi throttle 4× | không thuộc R0.2 | phần render khởi động: import 94,5 ms + renderer 23,0 ms + frame đầu 41,8 ms ở 4× (mục 4.5) |
| ≥ 50 fps laptop tầm trung | **PASS có điều kiện** | median 59,9 (trần vsync) và p5 ≥ 56,2 trên GPU thật; dung lượng 500 đến 833 fps; SwiftShader median ≥ 58,8. **Điều kiện:** máy đo là M4 Pro, không phải laptop tầm trung; throttle không làm chậm GPU; phải đo lại một máy thật (iGPU Intel) khi kết thúc R4 |
| ≥ 30 fps tier thấp khi throttle 4× | **PASS** | median 59,9 ở mọi nhóm; p5 ≥ 54,1 (ma trận) và ≥ 54,3 (soak 60 s); tier thấp giữ 59,9 median đến 363 draw call trên SwiftShader 4× |
| physics ≤ 0,5 ms/tick | không thuộc R0.2 | |
| Kiểm tra headless 3 biến thể × 60 s ≤ 10 s / ≤ 30 s | không thuộc R0.2 | thiết kế: kiểm tra chạy `src/core` không qua renderer, nên không cần WebGL; render không nằm trên đường này |
| Chạy → robot chuyển động ≤ 300 ms | **PASS** cho phần render | frame thứ hai sau `run()` đến sau 13,5 ms (1×) và 17,6 ms (4×) |
| Frame nhúng 1100×640 | **PASS** | mọi số trên đo trong iframe 1100×640 với sandbox của LMS |
| Không logo Arduino/OhStem | **PASS** | hình học thủ tục, không texture/asset |

**Chỗ lệch và biện pháp (nói thẳng):**

1. *Không có máy tầm trung thật.* Throttle 4× đã kiểm chứng (3,9×) nhưng chỉ chậm main thread; GPU yếu không được mô phỏng, và SwiftShader trên 12 lõi M4 Pro nhanh hơn GPU yếu thật. **Biện pháp:** tier thấp mặc định khi renderer là phần mềm; ghi nhận một lần đo thủ công trên một máy thật khi xong R4.2 (dùng lại `measure.mjs`, trỏ vào bản build).
2. *Tier cao trên phần mềm không ổn định:* p5 xấu nhất 30,9 (DPR 2), 15,8 khi máy chủ quá tải (lượt không giữ), và 48,8 median ở 545 draw call. **Biện pháp:** quy tắc chọn tier ở mục 6, ngân sách draw call 200/350, hợp nhất hình học tĩnh.
3. *Chunk 3D chỉ mới là phần render.* Nếu R0.1 chọn Rapier `-compat` thì FAIL ngân sách JS. **Biện pháp:** chọn bản tách file + `vite-plugin-wasm`; khi R4 đo lại chunk thật, ngân sách phần còn lại là khoảng 354 kB.

## 9. Điều chưa đo

- Laptop tầm trung thật, màn hình DPR cao thật, GPU rời/iGPU Intel, Chrome có tiện ích, tab nền (rAF bị giảm).
- Dev server (pre-bundle drei) và mạng thật (độ trễ nạp chunk).
- Shader compile lần đầu trên GPU thật (chỉ thấy gián tiếp trong "renderer đến frame đầu": 9,8 ms).
- Context loss do trình duyệt (GPU process crash) thay vì `WEBGL_lose_context`; hành vi phục hồi tự động chưa kiểm.
- Tier tự động (hai quy tắc ở mục 6) và chuyển tier lúc chạy.

## 10. Tái lập

Từ gốc repo (worktree), cần `pnpm install` đã chạy và Playwright browsers đã cài:

```sh
node spikes/robot-render/measure.mjs bundle                    # 2 production builds, gzip/brotli, mediapipe check
node spikes/robot-render/measure.mjs fps --repeats=3           # tier x CPU throttle x DPR x 4 browser groups (about 20 min)
node spikes/robot-render/measure.mjs stress                    # extra robots, CPU 4x
node spikes/robot-render/measure.mjs aa                        # MSAA on/off per tier
node spikes/robot-render/measure.mjs boot                      # fresh load of the lazy chunk
node spikes/robot-render/measure.mjs idle                      # demand loop, orbit, run to motion
node spikes/robot-render/measure.mjs context                   # WEBGL_lose_context scenarios
node spikes/robot-render/measure.mjs flags                     # launch flags and renderers
node spikes/robot-render/measure.mjs soak --repeats=2          # 60 s SwiftShader runs
node spikes/robot-render/measure.mjs engines                   # Firefox and WebKit
node spikes/robot-render/tables.mjs                            # print the tables above from results/*.json
```

`measure.mjs` tự khởi động `vite preview` (cổng 5221, cấu hình `spikes/robot-render/vite.config.ts`) và `node e2e/lesson-host.mjs 5222`; không dùng cổng 5173/5190. Build tay một biến thể:
`SPIKE_CONTROLS=three|drei node node_modules/vite/bin/vite.js build -c spikes/robot-render/vite.config.ts` (ra `spikes/robot-render/dist/<biến thể>/`, đã được `.gitignore`).
Kiểm kiểu của spike: `npx tsc -p spikes/robot-render/tsconfig.json --noEmit`. Số liệu thay đổi theo máy và tải; hãy xem `loadavg` trong từng file JSON trước khi so sánh.

## 11. Bổ sung R4.7 (2026-10-25): mô hình Blender, ánh sáng studio, camera có chiều sâu

R4.2 vẽ hình thủ tục (plan D-R7: "procedural geometry first, home-made GLB later"); chủ dự án thấy "trông không 3d lắm". R4.7 là phần
"later". **Engine giữ nguyên** (three 0.186.1 + R3F 9.8.1, không drei); quyết định dưới đây chỉ thêm vào mục 2 và 6.

1. **Asset: Blender → glTF** (phán quyết controller, thay cho lựa chọn (a)/(b) của brief). Mỗi part/prop là một script bpy commit trong
   `assets-src/robot3d/` (`lib.py`, `tex.py` dùng chung; `parts/*.py`, `props/*.py`), chạy headless bằng Blender 5.2.3 LTS
   (`pnpm build:robot-assets`, khoảng 7 s). Mô hình hoá thật: bevel modifier, boolean cho lỗ, array cho tấm đục lỗ, lathe/spin cho lốp
   với gai lốp bằng array xoay quanh trục; vật liệu Principled BSDF xuất thành glTF PBR; texture vẽ bằng numpy (vân gỗ, lớp ván ép,
   mạch in, bìa carton, sọc cảnh báo), không ảnh tải về. AO bake bằng Cycles vào **vertex colour** (COLOR_0, nhân vào base colour) khi
   mọi part đặt ở mount của kit tham chiếu. Xuất GLB với `EXT_meshopt_compression` (bridge meshopt có sẵn trong add-on glTF của 5.2; màu
   AO được vá để đi qua meshopt ở 8 bit) và ảnh WebP (`EXT_texture_webp`). Hai file cho mỗi tier: `robot-kit.glb` + `arena-props.glb`
   (tier cao) và `-low` (nửa số segment, bevel 1 segment): **1 113 kB** (gzip 497 kB) và **724 kB** (gzip 312 kB) một cảnh, dưới 2 MB.
   Manifest SHA-256 của script và file (`src/ui/robot3d/assets/robot-assets.manifest.json`) có test bắt asset cũ; URL mang `?v=<hash>`.
2. **Kit-driven:** runtime clone từng node `part_*` về mount của kit (RobotModel, cùng số mà physics dùng) và scale theo spec khi khác
   kit tham chiếu (bánh theo `wheelRadiusCm`/`wheelWidthCm`, chassis theo `bodyCm`/`clearanceCm`, caster, chiều dài tay servo, khoảng
   cách mắt line). Node động có tên cố định: `wheel_spin`, `servo_horn`, `flag_mast`/`flag_pennant` (extras `low`/`high`), `led_dome`,
   `line_led_<i>`, `button_cap` (extras `travel`), `board_led_l`. Part tĩnh được merge theo material: robot của kit tham chiếu là 60
   mesh ở tier cao (60 431 vertex), 26 ở tier thấp (29 327); sa bàn line-follow 19 và 5 mesh. **Seam vendor CAD:** thay output của một
   script bằng node GLB cùng tên, gốc ở mount của module; runtime không đổi. File không tải được, hoặc không dựng được robot hay sa bàn
   từ file: vẽ hình thủ tục của R4.2 (`RobotView`, `ArenaView`), không ném lên error boundary (boundary là của canvas hỏng, R4.6: bản đồ
   2D).
3. **Ánh sáng:** `RoomEnvironment` qua `PMREMGenerator` (`scene.environment`, cường độ 1), key light ấm (cường độ 3) từ sau vai trái
   camera với PCF shadow 2048² bán kính 2,5 texel (PCF của r186 lấy 5 mẫu Vogel disk), rim light lạnh, hemisphere fill, fog màu studio.
   Tone mapping **Khronos PBR Neutral** (`NeutralToneMapping`, thiết kế cho ảnh sản phẩm: giữ base colour như đã soạn, chỉ cuộn
   highlight); lượt ảnh đầu dùng AgX với đèn yếu hơn, mat trắng trông xám. AO: **bake** (vertex AO của part, aoMap của mat vẽ từ chân tường/vật cố định, bóng mềm
   dạng blob dưới robot và vật động), không GTAO: không thêm pass nào, chi phí runtime là 1 draw call blob và 4 B/vertex màu AO.
4. **Tier** (bổ sung bảng mục 6; `quality.ts` không đổi, phần mới ở `lighting/look.ts`):

| Thiết lập | Tier cao | Tier thấp |
|---|---|---|
| File mô hình | `robot-kit.glb`, `arena-props.glb` | `robot-kit-low.glb`, `arena-props-low.glb` (nửa segment) |
| Material | `MeshStandardMaterial` từ glTF (PBR) | `MeshLambertMaterial` cùng màu/texture/AO; material không texture bake vào vertex colour, merge thành 1 mesh |
| Environment map | PMREM RoomEnvironment, cường độ 1 | không (hemisphere 1,6) |
| Bóng | PCF 2048², radius 2,5 + blob 0,32 | blob 0,55 + aoMap của mat |
| Dây jumper, đèn point của LED, normal map sợi giấy | có | không |
| Draw call (đo, line-follow) | 129 (kể cả shadow pass) | 37 |

   Đo trước khi có tier thấp Lambert: SwiftShader tier thấp với `MeshStandardMaterial` chỉ được median 15,9 fps, p5 10,6 ở 4× (load 3,6);
   đổi sang Lambert + vertex colour: 60,2 / 27,2; thêm file `-low`: 59,9 / 53,2.
5. **Camera** (thay overview 52° của R4.2 bằng `camera-studio.ts`; hàm cũ trong `camera.ts` giữ nguyên cùng test; số đo ở đây là của
   lượt đầu, fix round 1 đổi chúng: mục 8): "Tự do" thấp 26°, sau
   điểm xuất phát của robot, nhìn về các zone mục tiêu của bài (lệch trái 14° để mục tiêu nằm bên phải, xa HUD), khung hình chứa vùng
   quanh robot, mọi zone mục tiêu và hai góc xa của sa bàn trong phần màn hình mà HUD (đo từ DOM, lớn theo số goal) và các nút để trống;
   "Theo xe" bám sau robot 34 cm, cao 15 cm, nhìn trước 10 cm, xoay theo hướng robot, tự nâng lên nhìn qua tường khi tường chắn; "Đặt lại
   góc nhìn" về pose ban đầu của chế độ hiện tại. Khi thẻ kết quả Kiểm tra mở, camera quay về robot và lens shift (`setViewOffset`) đẩy hình
   sang phần màn hình thẻ để trống.
6. **Đo** (`spikes/r47-visual/measure-fps.mjs`: harness của R4.2 trên cổng 5252/5253, chờ `data-drawn` rồi mới Chạy, đo thêm
   `firstFrameMs` (điều hướng trang lesson → frame đầu của cảnh) và `runToMovingMs` (lượt Chạy thứ hai: bấm → frame đầu robot đã đi);
   `results/*.json`; M4 Pro, Chromium 153, line-follow tham chiếu ở 1×, 3 lần × 8 s mỗi ô, load 1 phút ghi trong từng ô). So với master
   97adda4 (cảnh thủ tục của R4.2 cùng R4.5, R4.6, R6.3) đo cùng harness:

| Nhóm | Tier | CPU | median fps | p5 fps | draw/frame | frame đầu (ms) | Chạy lần đầu (ms) | Chạy → chạy (ms) | load |
|---|---|---:|---|---|---:|---|---|---|---|
| GPU (Metal) | cao | 1× | 59,9–60,2 | 54,1–54,6 | 129 | 794–895 (master 544–915) | 116–132 | 45–49 | 5,4–6,2 |
| GPU | cao | 4× | 59,9–60,2 | 53,2–53,8 | 129 | 1 748–1 760 (master 1 080–1 082) | 372–384 | 29–31 | 4,6–5,3 |
| GPU, DPR 2 → 1,5 (990 × 745) | cao | 1× | 59,9–60,2 | 54,3–54,9 | 129 | 792–895 | 116–128 | 26–50 | 8,7–11,5 |
| GPU, DPR 2 → 1,5 | cao | 4× | 59,9–60,2 | 53,5–54,1 | 129 | 1 757–1 775 | 383–385 | 31–33 | 6,0–7,4 |
| GPU | thấp | 1× | 59,9 | 53,8–54,9 | 37 | 682–790 | 104–111 | 29–47 | 4,0–4,5 |
| GPU | thấp | 4× | 59,9 | 53,2–53,8 | 37 | 1 756–1 765 | 303–315 | 29–30 | 4,1–4,2 |
| SwiftShader | thấp | 1× | 59,9 | 54,3–55,2 | 37 | 1 104–1 113, lần lạnh 2 509 (master 905–906, lạnh 2 063) | 111–216 | 17–39 | 3,8–5,6 |
| SwiftShader | thấp | 4× | 59,9–60,2 | 53,2–53,8 | 37 | 1 711–1 716 (master 1 148–1 160) | 353–360 | 27–29 | 6,6–6,9 |
| SwiftShader | cao | 1× | 14,6–15,0 | 11,3–14,1 | 129 | 943–1 115 | 98–264 | 94–120 | 8,4–9,4 |
| SwiftShader | cao | 4× | 13,8–14,0 | 10,7–12,5 | 129 | 1 714–1 745 | 356–380 | 225–245 | 9,8–11,2 |

   - **Ngân sách:** tier cao ≥ 50 fps median trên GPU máy này: **đạt** (59,9–60,2, p5 ≥ 53,2, cả DPR 1,5). Tier thấp ≥ 30 fps p5 ở
     SwiftShader 4×: **đạt** (p5 53,2–53,8). Draw call 129 / 37 (ngân sách 200 / 350). Chạy → robot chạy 17–50 ms (≤ 300).
     Chạy lần đầu (nạp Rapier) như master (116–132 so với 117–129 ms ở GPU 1×; 353–360 so với 353–369 ms ở SwiftShader 4×).
   - **Frame đầu chậm hơn:** khoảng +0,1 đến +0,25 s ở 1× và +0,55 đến +0,7 s ở CPU 4×. Đo bằng mark tạm (không giữ trong code): tải
     + parse hai GLB 25–46 ms ở 1× (155 ms ở một lượt khi load 33) và 100–133 ms ở 4×, lắp robot và sa bàn 11–19 ms ở 1× và 47–76 ms ở
     4×, frame đầu (biên dịch, upload) 50–165 ms trên GPU và 0,4–1,2 s ở SwiftShader (12 program ở tier thấp lúc đó). Đã giảm: nạp file ngay khi `SceneHost` dựng (song song với việc tạo canvas; GPU 1× từ 1 244–1 344 xuống 794–895 ms),
     `compileAsync` trước frame đầu (SwiftShader 4× từ 2 090–2 210 xuống 1 609–1 630 ms ở lượt đo trước), tier thấp ít program hơn,
     mat của tier thấp 5 px/cm. Thử meshopt decode trong 2 worker: GPU 4× chậm hơn (1 889–1 975 ms), đã bỏ.
   - **SwiftShader ở tier cao** chỉ 14–15 fps (R4.2: 46,7–53,5): renderer phần mềm vẫn mặc định tier thấp (`tierForRenderer`), người học
     chỉ vào tier cao khi tự bấm "Đồ hoạ".
   - **Bundle** (gzip -6): chunk `RobotLab-*.js` 353,7 kB (master 97adda4: 316,0 kB; +37,6 kB: GLTFLoader, meshopt decoder,
     RoomEnvironment, BufferGeometryUtils, code R4.7), dưới 0,6 MB; entry và chunk dùng chung không đổi (±20 byte). GLB mỗi cảnh: tier cao
     1 113 kB (gzip 497 kB), tier thấp 724 kB (gzip 312 kB), dưới 2 MB; tải một lần mỗi trang, URL có hash nên cache được lâu dài.
7. **Chưa đo / còn mở:** laptop tầm trung thật (iGPU) ở tier cao (PBR, PCF, 129 draw); tự hạ tier theo FPS (đã làm ở fix round 1,
   mục 8); build
   Blender không lặp lại đúng từng byte (thứ tự đỉnh của boolean EXACT đổi giữa các lần chạy; manifest vẫn bắt script đổi mà GLB chưa
   build lại); host không nén `.glb` thì tải 1,1 MB thay vì 0,5 MB.
8. **Fix round 1** (review 1 của R4.7, rebase lên master 1211347 có R4.8):
   - **Camera.** "Theo xe" 50 cm sau, 25 cm cao, nhìn trước 25 cm; luôn ở trong tường ít nhất 3 cm tính từ mặt tường: đoạn sàn từ robot
     tới camera chạm footprint nới rộng của một tường thì camera kéo vào theo đoạn đó, nâng lên để giữ khoảng cách tới robot, điểm nhìn
     lùi về robot cùng tỉ lệ (`clearSight`, test quét mọi vị trí và hướng trong ba sa bàn). "Tự do" 34°; khung hình gồm cả zone xuất phát,
     mọi điểm của băng keo và chỗ của nhãn zone; vùng trống trên màn là chữ nhật trừ góc HUD (trên trái) và góc dụng cụ của R4.8 (dưới
     trái), đo từ DOM qua callback ref (view tạo lại sau "Xem 2D" hay "Thử lại 3D" được đo lại). Robot nhỏ hơn 40 px thì bỏ dần: hai góc
     xa, chỗ của nhãn, phần dưới của HUD cao (chỉ còn tới 0,45 NDC; người học gập HUD được), băng keo, rồi zone xa nhất. Thẻ kết quả gập
     hay đóng: camera lướt về pose trước khi thẻ mở, trừ khi người học đã xoay; bắt đầu "Xem lại": camera về pose đầu của view.
   - **Nhãn zone** là sprite cỡ cố định trên màn (6,2 % chiều cao canvas), không depth test, có đường dẫn mảnh xuống tâm zone, ở 13 cm;
     mat chỉ in nền và viền zone.
   - **Prop = collider:** khối cọc tiêu (hộp 8 × 8 × 12 cm) thay nón, rào cổng đặc, cột và lon đúng bán kính trụ, tấm cảnh báo của bến chìm
     vào mặt tường; test giữ bounding box của từng vật cố định của mọi pilot bằng collider trong 0,5 cm.
   - **Đèn line:** bo đèn báo 3 LED ở mép trước sàn trên (`part_line_leds`, trong mũi thân mà physics chạy; thanh cảm biến không thể chìa
     ra trước mũi), quầng đỏ và đốm đỏ trên mat dưới mắt thấy tối. Đèn LED point 0,02 cd.
   - **Studio:** sàn sáng, bóng mềm của bàn và chân bàn trên sàn, bàn 50 cm quanh sa bàn, vân óc chó nhỏ và dịu lặp theo kích thước thật,
     ván ép 20 px/cm, lọc anisotropic cho texture của GLB; băng keo là dải 0,4 mm mờ; ảnh tier thấp nửa độ phân giải.
   - **Code:** PMREM tạo trong effect (StrictMode), `compileAsync` sau environment, hình của R4.2 không tone mapping như trước; Windows
     Basic Render Driver và WARP vào tier thấp; tier cao tự xuống thấp một lần khi median frame của 3 s chạy > 33 ms (`frame-watch.ts`, có
     ghi chú "Đã chuyển sang đồ hoạ nhẹ cho mượt hơn"); file mô hình lỗi được thử lại ở view 3D sau, quá 15 s thì vẽ hình đơn giản, không
     tải khi đang chọn 2D; manifest băm cả kit tham chiếu.
   - **Đo lại** (cùng harness, thêm `autoLowMs` và `endTier`; `results/fix1-*.json`; M4 Pro, Chromium 153, line-follow 1×, 3 lần × 8 s; load
     1 phút ghi trong từng ô; master 1211347 đo trong cùng buổi (18:35–19:08) từ một `git archive`, `results/fix1-master-1211347-*.json`):

| Nhóm | Tier | CPU | median fps | p5 fps | draw/frame | frame đầu (ms) | Chạy lần đầu (ms) | Chạy → chạy (ms) | load |
|---|---|---:|---|---|---:|---|---|---|---|
| GPU (Metal) | cao | 1× | 59,9–60,2 | 56,2 | 131 | 673–837 (master 884–974, load 9,9–13) | 113–145 | 18–21 | 6,0–7,0 |
| GPU | cao | 4× | 60,2 | 55,6 | 131 | 1 799–1 804 (master 1 359–1 395) | 355–379 | 32–33 | 4,4–5,4 |
| GPU | thấp | 1× | 59,9 | 55,6–56,2 | 44 | 677–913 (master 941–959) | 99–110 | 46–47 | 3,6–4,1 |
| GPU | thấp | 4× | 59,9–60,2 | 54,9–55,6 | 44 | 1 807–1 823 (master 1 368–1 503) | 301–310 | 30–31 | 3,0–3,2 |
| SwiftShader | thấp | 1× | 59,9–60,2 | 57,1 | 44 | 944–1 177, lạnh 3 126 (master 902–905, lạnh 2 052) | 121–315 | 41–49 | 3,8–5,1 |
| SwiftShader | thấp | 4× | 59,5–59,9 | 53,2–53,8 | 44 | 1 712–1 726 (master 1 148–1 157) | 344–360 | 30–32 | 5,5–7,1 |
| SwiftShader, chọn tier cao | cao → thấp | 1× | 59,9 | 54,3–54,6 | 44 | 1 181, lạnh 3 041 | 111–614 | 92–162 | 8,6–8,9 |
| SwiftShader, chọn tier cao | cao → thấp | 4× | 60,2 | 52,9–53,8 | 44 | 1 705–1 730 | 331–341 | 217–225 | 8,8–9,5 |

     - Ngân sách vẫn đạt: tier cao trên GPU median ≥ 59,9, p5 ≥ 55,6; SwiftShader tier thấp ở 4× p5 53,2–53,8 (master 53,2–54,1, cùng
       load); draw call 131 / 44 (tier thấp 37 → 44: nhãn zone, đường dẫn, dải băng keo, đốm đèn; bằng cảnh thủ tục của master).
     - **Tự hạ tier:** SwiftShader ở tier cao chuyển sang thấp 3,4–4,0 s sau lần bấm Chạy đầu ở 1× và 3,6–3,7 s ở 4× (`autoLowMs`), ghi chú
       hiện; cửa sổ đo 8 s sau đó là tier thấp (median 59,9–60,2).
     - **Frame đầu:** ở CPU 4× chậm hơn master 0,4–0,45 s trên GPU và 0,55–0,6 s ở SwiftShader (lượt đầu: +0,67 s và +0,56 s). Lọc
       anisotropic texture GLB ở tier thấp từng làm SwiftShader 4× chậm thêm 1,2 s (A/B `results/ab-*.json`: 2 913–2 960 → 1 717–1 720 ms
       khi bỏ), nên chỉ bật ở tier cao; nhãn zone tốn khoảng 0,3 s ở SwiftShader 4× (A/B, 2 624–2 671 ms khi bỏ). Các lượt đo trước khi sửa
       ở `results/superseded/`.
     - **Bundle** (gzip -6): `RobotLab-*.js` 366,1 kB (master 1211347: 325,1 kB, +41,0 kB); entry +3 B, `test-hooks` +68 B (chuỗi i18n).
       GLB: tier cao 827 + 303 = 1 130 kB (gzip 510 kB), tier thấp 496 + 195 = 690 kB (gzip 275 kB), dưới 2 MB.
9. **Fix round 2** (re-review của R4.7):
   - **Nhãn zone không che chủ thể:** mỗi frame `zone-tag-layout.ts` chiếu điểm neo của nhãn và hộp robot (cả cờ khi có) lên màn hình rồi
     đặt nhãn ở chỗ đầu tiên không chồng lên robot, HUD, dải nút camera, dụng cụ R4.8, thẻ kết quả hay nhãn đã đặt (giữa, lệch phải, lệch
     trái, cạnh đường dẫn; cao hơn; thấp hơn), không có chỗ thì ẩn; zone robot đang đứng và chế độ "Theo xe" không hiện nhãn. Điểm kiểm
     tra chỉ hiện số. Đường dẫn là quad quay về camera vẽ bằng program của bóng tiếp xúc; texture nhãn dựng một lần khi font đã có; nhãn
     gắn sau frame đầu một frame.
   - **Tự hạ tier chỉ đếm frame liền nhau** (`addTail` của R3F báo vòng lặp demand dừng): robot đứng yên nháy LED (cặp frame 484 / 16,7 ms)
     không còn làm máy khoẻ xuống tier thấp.
   - **Camera "Theo xe" không vào vật** (`keepOutOfProps`, `sight-props.ts`): nâng qua cổng, khối, lon, cột; lên hoặc xuống khỏi thanh
     khung đích và mái gara. `MIN_ROBOT_PX` = 60 (một giá trị cho code và test); "Tự do" khung cả vật cố định và 80 cm băng keo đầu.
   - **Đèn line:** sáng là đỏ bão hoà (emissive 1,4) với quầng khoảng 12 px; tắt gần đen; quầng được compile cùng cảnh.
   - **Đo lại frame đầu** (`results/fix2-*.json`, `ab-r2-*.json`): máy bận hơn (một máy ảo chiếm khoảng 1,3 lõi, load 7–12). Cùng điều
     kiện, xen kẽ với master: SwiftShader tier thấp ở 4× 2 610–2 656 ms so với master 1 271–1 302; bản 75bdfda (cuối fix round 1) đo lại
     lúc đó 2 653–2 684 ms, nên round 2 không làm chậm thêm; gắn nhãn ngay hay sau frame đầu không khác (2 616–2 655 so với 2 613–2 648).
     GPU tier cao 4×: 1 980–2 000 so với master 1 351–1 354. FPS vẫn đạt (GPU p5 ≥ 52,4 ở cả hai tier; SwiftShader tier thấp 4× p5 51,5–54,3).
   - Bundle `RobotLab-*.js` 368,3 kB gzip (+43,1 kB so với master 1211347).

10. **P2 (2026-10-26): hiệu năng, cùng hình.** Engine, look và tính năng không đổi (phán quyết của chủ dự án: "vẫn giữ đồ hoạ hiện tại và
    tính năng hiện tại"); 36 ảnh canvas của bản cuối so với `16407b8`: 36/36 trùng từng bit. Bổ sung bảng tier của mục 4:

| Thiết lập | Tier cao | Tier thấp |
|---|---|---|
| Shadow map | PCF 2048², **vẽ lại chỉ khi** robot, bánh, servo hay vật động dịch quá 1 pixel, hoặc nội dung cảnh đổi (`shadow-watch.ts`) | không có |
| Normal map sợi giấy | có (pixel tạo một lần mỗi trang) | **không tạo** |
| Canvas roughness của mat | có | **không vẽ** (Lambert không đọc) |
| Theo dõi khung | median > 33 ms trong 3 s chạy → xuống tier thấp, một lần (R4.7) | **một chiều:** median > 28 ms → vẽ tối đa 30 hình/giây (`drawDue`, mô phỏng không đổi); vẫn > 50 ms → **mời** bản đồ 2D, không ép |
| Draw bóng mỗi khung khi chỉ camera di chuyển (kéo quanh robot đứng yên) | **0** (trước 51) | không có bóng |

    - **Đo** (`pnpm bench:robot3d`, harness của P2: bản production trong khung bài học, M4 Pro, Chromium 153; trước/sau xen kẽ từng
      vòng, 3 vòng; load 1 phút ghi trong từng ô; `spikes/p2-perf3d/results/phase-b/`):

| Mục tiêu P2 (school PC: SwiftShader, tier thấp, CPU 6×, trừ khi ghi khác) | master `16407b8` | bản cuối | |
|---|---|---|---|
| p95 khung ≤ 33 ms khi chạy ở 1× (mọi ô chạy) | 18,7–23,2 ms | 18,6–20,2 ms | đạt |
| p95 khung ≤ 33 ms ở 4× | Kiểm tra 4× 23,8–25,2; mô phỏng 4× 20,1–47,7 ms | 20,8–22,1; 19,6–20,9 ms | đạt |
| không long task > 100 ms trong lượt chạy | Kiểm tra 4×: 1 (327–339 ms) và 19–21 task 50–100 ms | **0**, không task nào từ 50 ms | đạt |
| frame đầu ≤ 2,5 s (ấm) | 2 353–2 762 ms | 2 482–2 870 ms | **chưa đạt, sàn như master** |
| heap tăng ≤ 5 % trong 10 phút | P2 Phase A: −2,2 / +0,2 / −1,8 % | −2,4 / −2,7 / −2,4 %, không long task > 100 ms trong 30 phút | đạt |
| không tăng tài nguyên GPU sau 20 lần đổi (gpu-high) | 0 | 0 context, geometry, texture, program; 0 listener (trước +19 và +18) | đạt |
| GPU tier cao p95 ≤ 20 ms | 17,9–18,5 ms | 17,7–18,3 ms | đạt |
| Chạy lần đầu → robot chạy | school 389–460, ss-low-4x 267–309, GPU 71–87 ms | 78–127, 51–55, 13–26 ms | |

      Load 4,6–13,5 (agent khác cùng máy), vòng lặp CPU 96–105 ms ở mọi ô school. Frame đầu: P2 không đổi nó (hai khoảng chồng lên
      nhau); trong đó có script của entry, Blockly và zod, tải và parse GLB (0,25–0,33 s), dựng cảnh, và lần vẽ cảnh đầu chờ link
      shader 350 ms. Xuống dưới 2,5 s mọi lần cần ít program hơn hay ít thứ phải dựng hơn (đổi hình, phán quyết không cho) hoặc nạp Blockly
      muộn hơn (đổi thứ tự khởi động lab); không thuộc P2.

    - **Chuỗi tier thấp**, ngưỡng đo trên máy bận (`spikes/p2-perf3d/busy.mjs` chiếm 0, 8, 10 trong 12 nhân, profile school): M4 rảnh
      16,7 ms một khung, còn 4 nhân 23,1–23,5 ms (43 fps) thì không động; còn 2 nhân 31–32 ms thì giới hạn còn 29–30 fps, CPU của GPU
      process 84–88 → 46–48 ms một khung, renderer 33–35 → 19–20 ms. Khi giới hạn, p95 khung là 35–36 ms do chính giới hạn (33,3 ms):
      mục tiêu 33 ms không đạt được ở đó. Đã kiểm tra đầu cuối: giới hạn sau 3,3 s chạy khi còn 2 nhân, lời mời 2D khi gần như không còn
      nhân, chọn 2D thì lượt chạy tiếp tục trên bản đồ.
    - **Hai việc chậm còn lại khi không có GPU:** (a) lần vẽ đầu của nhãn zone (144–154 ms ở 6×) là `onFirstUse` của program của nhãn chờ
      GPU process (SwiftShader không có `KHR_parallel_shader_compile`), một lần mỗi canvas, trước lượt chạy; (b) trình duyệt mới mở cần
      thêm khoảng 1,3 s trước khi có WebGL renderer (main thread rảnh suốt lúc đó: GPU process đang khởi động), không phải việc của app.
