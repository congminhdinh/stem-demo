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
