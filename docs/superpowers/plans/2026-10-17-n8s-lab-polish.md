# N8s — stem-demo lab polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lab `lab=` của STEM Studio dùng được trong khung nhúng 600–1000 px (chương trình là phần lớn, khối khởi đầu trong tầm nhìn, mạch vừa khung, tab dưới 800 px), nút **Kiểm tra** chạy chương trình trước mắt học sinh (các lần bấm ảo hiện ra, khung cuối được giữ), và lab nói tiếng Việt trọn vẹn (lỗi launch, thông báo của core, nhãn bo mạch) — mà standalone, lab S1, đường compile → IR → MicroPython và hợp đồng `stem-lab/v1` không đổi.

**Architecture:** Mọi thay đổi ở lớp UI. Bố cục: `LabWorkspace.tsx` (split + separator + fold, tab dưới 800 px) chỉ dùng cho launch `lab=`; `viewport.ts` (B7) có scale + offset để canvas tự thu nhỏ; `blockly/fit.ts` thu nhỏ view Blockly khi khối không vừa (không đổi document). Kiểm tra nhìn thấy được: `checkSessionOf(runStore, observer)` báo input của kịch bản và snapshot cuối cho App, App vẽ chúng lên bo mạch/nút điều khiển và giữ khung cuối; bộ chấm `src/core/challenge` không đổi. Tiếng Việt: `i18n/core-text.ts` dịch câu tiếng Anh của core và của parser launch theo từng khung câu (core không có locale, B1), `i18n/devices.ts` dịch nhãn Konva. Vệ sinh test: test thời gian đo CPU time, E2E macOS dùng `ControlOrMeta`, cổng E2E đổi được.

**Tech Stack:** React 19.3, Vite 8.3, Vitest 4.1, TypeScript 6.0, Blockly 13.3, Konva 10.7 / react-konva 19.3, zustand 5, Playwright 1.63 (Chromium), pnpm 12.8.1. Không thêm dependency.

**Spec:** Yêu cầu N8s của owner (nhận xét từ test trình duyệt end-to-end của demo-v1, ghi ở mục "Evidence" dưới) trong khuôn khổ spec `/Users/hoangminh/.claude/plans/agile-conjuring-candy.md` §7 (stem-demo là sản phẩm độc lập, hợp đồng duy nhất là URL + `stem-lab/v1`). Hợp đồng: `docs/lab-embed-contract.md`. Plan trước: `docs/superpowers/plans/2026-10-16-n6a-lab-embedding.md` (Rulings R1–R16, Deferred). Repo: `/Users/hoangminh/Desktop/stem/stem-demo`, branch `feat/lab-embedding` == `origin/master` == tag `demo-v1` (`9cdd6b3`); controller commit.

## Global Constraints

- stem-demo độc lập: không import gì từ STEMLearning, không có khái niệm LMS (XP, lớp, tiến độ, hoàn thành).
- `stem-lab/v1` giữ tương thích ngược (host STEMLearning đã ship): không đổi URL, không đổi/bỏ/thêm message; thứ tự `ready, run-started, run-stopped, check-result` của E2E N6a giữ nguyên.
- Không đụng compile → IR → MicroPython (`src/core/program/compile-*`, `src/core/codegen/**`) và bộ chấm `src/core/challenge/**`. Ở cuối: `git diff --stat 9cdd6b3 -- src/core ':(exclude)*.test.ts' ':(exclude)**/__fixtures__/**'` phải rỗng (core chỉ đổi test và fixture của test).
- Boundary B1: `src/core/**` không import `react`, `blockly`, `konva`, `zustand`, `src/ui`, `src/storage`… (`pnpm lint`). Không thêm locale vào core: mọi bản dịch ở `src/ui/i18n`.
- Standalone (không `embed`/`template`/`lab`) và lab S1 legacy (`?embed=1&template=`) giữ bố cục, ngôn ngữ (tiếng Anh) và hành vi; mọi thay đổi bố cục/Kiểm tra/tiếng Việt chỉ cho launch `lab=` (tiếng Việt cũng cho `lang=vi`).
- Chuỗi UI trong `src/ui/i18n/messages.ts` (`en` + `vi`, cùng key, cùng tham số); không viết chuỗi UI inline. Identifier/comment tiếng Anh, tài liệu tiếng Việt.
- Không thêm dependency (không cần: mọi thứ làm bằng React, CSS, Blockly/Konva API sẵn có).
- Mỗi task: `pnpm verify` xanh trước khi commit; task UI chạy E2E liên quan với `E2E_PORT=5273`; Task 7 chạy toàn bộ `pnpm e2e` và phải **xanh hoàn toàn** (147 passed, 0 failed).
- Commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Năm điều yêu cầu ngụ ý nhưng dễ vỡ nhất với người dùng thật; mỗi dòng có test ở task sở hữu:

1. **Học sinh sửa chương trình ngay sau một lần Kiểm tra** → khung cuối được giữ phải biến mất cùng kết quả (bo mạch tắt, mục tiêu về "chưa kiểm tra"), không được để hình cũ đánh lừa (Task 6, `lab-check.spec.ts` "an edit after a check drops the frame it left").
2. **Thu nhỏ khối khởi đầu cho vừa không được đổi document** → nếu đổi, lab gửi `project-changed` ngay lúc mở và host lưu đè bài (Task 5, `lab-layout.spec.ts` "shrinks the blocks … and saves nothing for it"; Task 6 chạy lại `ybc-embed.spec.ts` với chuỗi message chính xác).
3. **Xoay tablet / đổi cỡ khung qua mốc 800 px** → chuyển giữa split và tab mà không mất khối, không mất mạch, không cuộn trang (Task 5, `lab-layout.spec.ts` "switches between the split and the tabs …").
4. **Core thêm hoặc đổi câu thông báo** → câu chưa dịch hiện nguyên tiếng Anh (không bao giờ rỗng), và test đọc nguồn core báo đỏ để người làm thêm luật (Task 3, `core-text.test.ts` "knows …", "leaves English … a sentence it does not know as it is").
5. **Host chỉ thấy đúng chuỗi message cũ khi Kiểm tra nay "nhìn thấy được"** → không có message mới, `check-result` vẫn đến sau `run-stopped` (Task 6 chạy `ybc-embed.spec.ts`: `['ready', 'run-started', 'run-stopped', 'check-result']`).

## Evidence (đo khi dry-run, 2026-10-16)

- Nhúng 1000×640 (`?embed=1&lab=yolobit&template=ybc-heart`): canvas `3fr` / chương trình `2fr` ⇒ khối rời "hiển thị hình" ở x = 230 bị cắt nửa; Blink (`lab=blockly`) đèn LED nằm ngoài canvas. 670×600: `@media (max-width: 760px)` xếp dọc, bo mạch cắt ở 270 px, chương trình dưới nếp gấp.
- Kiểm tra **không** chạy headless: nó chạy trên run store của toolbar (N6a R10). Lấy mẫu canvas mỗi 200 ms khi Kiểm tra `ybc-button-ab` (lời giải): màn hình hiện ✓ ở 205 ms, ✗ ở 853 ms, rồi tắt ở 1 500 ms khi lượt chạy dừng; không nút nào `aria-pressed`, bo mạch không có dấu bấm. Học sinh chỉ kịp thấy danh sách mục tiêu.
- `LaunchError` hiện câu tiếng Anh của parser; thông báo compile/runtime/validity của core và lỗi nối dây (`CircuitCanvas` `wireErrorText`) tiếng Anh; nhãn Konva "Bit-compatible Board", "Light", "Buzzer". `/favicon.ico` 404 (không có `<link rel="icon">`).
- `describeTone` chỉ được dùng trong `tone.test.ts`. `BlocklyPanel` dùng `media: '/blockly-media/'` cố định.
- 4 E2E `ybc-python.spec.ts` (dòng 178, 186, 195, 204) fail trên macOS: `Control+A` không chọn hết trên Mac (gõ nối thành `21`), và app hiện `Cmd+C` trong khi test chờ `Ctrl+C`. Khi chạy cả bộ song song, "an invalid edit that is fixed again" còn flake: editor của Blockly mở chậm, phím đi chỗ khác.
- Timing test dưới tải (36 tiến trình `yes`, load ~52–61, 12 core): `pnpm test` fail 3/3 lần (`ybc-heavy-expression` gap test, `ybc-responsiveness` tight while). Đo song song: khoảng hở wall-clock 48–180 ms, khoảng hở CPU time 9–24 ms (máy rảnh: wall 10–11, CPU 17–24). Sau khi đổi sang CPU time: 3/3 xanh dưới cùng tải.
- Cổng 5173 đang có server demo chạy; `playwright.config.ts` dùng `reuseExistingServer` ⇒ E2E sẽ chạy nhầm vào server đó.

## Rulings (quyết định tự chốt, có lý do)

| # | Chủ đề | Quyết định |
|---|---|---|
| R1 | Phạm vi bố cục mới | Chỉ launch `lab=` (prop `lab` của `App` khác null). Standalone và S1 legacy render đúng `<main className="workspace">` cũ (E2E "outside a lab" kiểm tra không có tab/separator, canvas vẫn rộng hơn, viewport identity). |
| R2 | Tỉ lệ và mốc | Mạch 38 % / chương trình 62 % lúc mở; separator 20–65 %, bước 5 % (WAI-ARIA window splitter: ←/→, Home/End, kéo chuột); dưới 800 px là tab. Không lưu gì (lab không lưu trong trình duyệt, S1), mỗi lần mở là mặc định. |
| R3 | Tab | Mặc định "Chương trình". **Chạy** và **Kiểm tra** chuyển sang "Mạch" (và mở lại mạch đang thu gọn ở bố cục rộng): học sinh phải thấy chương trình làm gì. Nhãn tab dùng lại `app.program` / `app.circuit` ("Chương trình" / "Mạch"). |
| R4 | Panel khuất | Vẫn mount, chồng cùng ô grid, `visibility: hidden` + `inert`, không `display: none`: Blockly và Konva giữ kích thước và trạng thái, không phải đo lại từ 0. |
| R5 | Canvas vừa khung | `fitViewport` trong `viewport.ts` (nơi duy nhất đổi stage ↔ world, B7): scale ≤ 1 (không phóng to), ≥ 0.4, lề 24 px, căn giữa. Tính từ mạch **lúc mở** và mỗi khi canvas đổi cỡ, không theo từng lần sửa (kéo linh kiện không làm view nhảy). Bán kính chọn cổng tính theo world (`12 px / scale`) để vẫn là 12 px trên màn hình. Standalone: identity. Không có zoom/pan của người dùng (BL-E5 vẫn hoãn). |
| R6 | Khối khởi đầu trong tầm nhìn | Sau khi nạp (chỉ lab): nếu khối không vừa view thì `setScale` (≥ 0.6, không phóng to) + `scrollBoundsIntoView`. Chỉ đổi view — Blockly không serialize scale/scroll — nên document không đổi, không có `project-changed`. Template giữ nguyên (key và document là hợp đồng với host). |
| R7 | Python trong lab | Thu gọn về thanh tiêu đề lúc mở (nút "Hiện"/"Ẩn"): khối được chỗ. Standalone giữ panel 38 % như cũ. |
| R8 | Kiểm tra nhìn thấy được | Lượt chạy của Kiểm tra vốn là lượt chạy canvas vẽ (evidence). Thêm ở lớp UI: `checkSessionOf(runStore, { onInput, beforeStop })`; input của kịch bản được vẽ lên bo mạch (nút bấm tô màu + viền, mức ánh sáng ghi cạnh cảm biến) và lên nút điều khiển; thanh tiến độ CSS chạy đúng `durationMs`; khung cuối được giữ (kèm ghi chú) tới lần Chạy, lần sửa hoặc Đặt lại. Thời lượng challenge và `runCheck` không đổi (B1, dữ liệu template). Không có message mới. |
| R9 | Nút điều khiển khi Kiểm tra | Chỉ hiển thị (disabled) và hiện đúng input của kịch bản: một lần bấm tay giữa chừng sẽ làm sai kịch bản. Bấm Dừng vẫn huỷ như N6a. |
| R10 | Tiếng Việt của core | Dịch theo **khung câu** (regex) ở `src/ui/i18n/core-text.ts`, không theo `code`: một code như `value-out-of-range` gồm 6 câu khác nhau. Tên khối trong câu lấy từ text khối tiếng Việt (`viBlockText`). Câu không khớp luật nào → giữ tiếng Anh. Test đọc nguồn core (các `report(…)`, `new RuntimeFault(…)`, `message:`) để mọi câu đều có luật và mọi luật đều được dùng. Lý do launch hỏng dịch cùng cơ chế (`launch.ts` và test của nó không đổi); bản tiếng Anh nằm dưới `<details>` "Chi tiết kỹ thuật" cho người viết URL. |
| R11 | Nhãn Konva | `localizeDeviceDefinition` trả bản sao definition với tên (`device.<id>`) và nhãn bộ phận (Màn hình, Ánh sáng, Loa) tiếng Việt; chỉ renderer dùng bản sao, hình học dùng definition của registry. Nhãn cổng giữ nguyên (P0, GND, D13 như nhau mọi ngôn ngữ; cổng passive không vẽ nhãn). Lỗi nối dây chuyển vào `messages.ts` (`wire.*`). |
| R12 | Favicon | SVG tự vẽ (`public/favicon.svg`): ô vuông bo góc màu token primary `#4f46e5`, lưới đèn 3×3 trắng, một ô cam `#f97316`. `<link rel="icon" href="/favicon.svg">`; Vite thêm base khi build. |
| R13 | S6 | `blocklyMediaUrl(import.meta.env.BASE_URL)` (`src/ui/blockly/media.ts`); middleware dev nhận `${base}blockly-media/`. Kiểm bằng `vite --base /lab/` (curl) và `vite build --base /lab/`. |
| R14 | Timing test | Đo **CPU time** của tiến trình (`process.cpuUsage`) thay wall clock: chặn event loop là tính toán, tính toán là CPU time; tải của tiến trình khác chỉ làm wall clock dài ra. Ngưỡng giữ nguyên (50 ms, 100 ms, 1 000 ms); test có chờ (sleep, Stop) thêm trần wall-clock 1 000 ms (bắt lỗi "chờ hết sleep 60 s"). Test lồng 100 000 khối của `editor-blocks` được timeout 30 s (nó kiểm kết quả, không kiểm tốc độ). Không dùng `retry`: dưới tải kéo dài, lần thử lại cũng fail. |
| R15 | E2E macOS | `ControlOrMeta+A`; chờ editor Blockly mở trước khi gõ và đóng sau Enter (Enter commit ngay, không chờ debounce lưu nên test vẫn đo "export ngay sau khi sửa"); phím copy mong đợi lấy theo `navigator.platform` như `PythonPanel`. |
| R16 | Cổng E2E | `E2E_PORT` (mặc định 5173) trong `playwright.config.ts`. Mọi lệnh E2E của plan dùng `E2E_PORT=5273` và cổng đó phải trống (nếu không, `reuseExistingServer` chạy test trên server khác). Cổng lesson-host 5190 giữ nguyên (E2E viết cứng origin `http://lesson.localhost:5190`). |
| R17 | Console rỗng | Trong lab, `.run-console` rỗng bị ẩn bằng CSS (`:has(> pre:empty)`): nó chỉ là một thanh tối đẩy workspace xuống mỗi lần chạy chương trình Yolo:Bit không in gì. Standalone không đổi. |
| R18 | `describeTone` | Xoá cùng 2 assertion của nó: không code nào khác dùng. |
| R19 | CLAUDE.md | Không sửa (hướng dẫn agent là của owner). Quy ước "core không có locale, UI phủ text lên" vẫn đúng; `core-text.ts` và `devices.ts` được ghi trong plan này và stem-demo plan §9.2 N8s. |

## Môi trường (đã gặp khi dry-run trên máy này)

- `pnpm` 12.8.1 qua wrapper: mọi lệnh shell của plan chạy sau `export PATH=/private/tmp/claude-501/-Users-hoangminh-Desktop-stem/3a81bd87-e5be-4246-b5b9-b2dab2da24f0/scratchpad/bin:$PATH;` (wrapper `pnpm` = `exec sh ~/Library/pnpm/.tools/pnpm/12.8.1/node_modules/pnpm/pnpm "$@"`). Cài lần đầu: `pnpm install --frozen-lockfile`.
- Một server demo đang chạy ở 5173 — **đừng đụng**. E2E: `E2E_PORT=5273 pnpm exec playwright test …` (sau Task 1). Trước mỗi lần chạy: `lsof -nP -iTCP:5273 -sTCP:LISTEN` phải không in gì (Playwright tự bật `pnpm dev --port 5273`). Kiểm sub-path ở Task 2 dùng 5274.
- Baseline trên `9cdd6b3`: `pnpm verify` = `Test Files  135 passed (135)`, `Tests  4377 passed | 1 skipped (4378)`; `pnpm e2e` = 130 test, 126 passed, 4 failed (ybc-python, macOS). Sau N8s: 141 file / 4572 test unit; E2E 147 passed.
- Tạo tải để tái hiện flake thời gian: `for i in $(seq 1 36); do (yes > /dev/null &); done; sleep 3` … rồi `pkill yes`.
- Playwright không nạp JSON import thiếu `with { type: 'json' }`: file E2E không import `src/samples/templates.ts` (đã có từ N6a; E2E mới chỉ import `ybc-templates.ts` / `ybc-solutions.ts`).
- Dry-run: clone `…/scratchpad/n8s/dry`, replay trên clone mới `…/scratchpad/n8s/replay` bằng cách áp đúng các khối Create/Replace của plan này rồi chạy lệnh của từng task (kết quả ở cuối plan).

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `playwright.config.ts` | Cổng dev của E2E từ `E2E_PORT` | 1 |
| `src/core/program/__fixtures__/cpu-clock.ts` | `cpuMs`, `heartbeat` (CPU time), `wallCeilingMs` cho test | 1 |
| `src/core/program/ybc-heavy-expression.test.ts`, `ybc-responsiveness.test.ts`, `src/ui/blockly/editor-blocks.test.ts` | Đo bằng CPU time, giữ ngưỡng | 1 |
| `e2e/ybc-python.spec.ts` | `ControlOrMeta`, chờ editor, phím copy theo nền tảng | 1 |
| `public/favicon.svg`, `index.html` | Favicon | 2 |
| `src/ui/blockly/media.ts`, `BlocklyPanel.tsx`, `vite.config.ts` | Media Blockly theo base path (S6) | 2 |
| `src/ui/audio/tone.ts` | Bỏ `describeTone` | 2 |
| `src/ui/i18n/core-text.ts` | Luật dịch câu của core và của parser launch; `blockName` | 3 |
| `src/ui/i18n/devices.ts` | Tên thiết bị, nhãn bộ phận cho canvas | 3 |
| `src/ui/app/RunToolbar.tsx`, `PythonPanel.tsx`, `LaunchError.tsx`, `src/ui/canvas/CircuitCanvas.tsx` | Dùng bản dịch | 3 |
| `src/ui/canvas/viewport.ts` | `Viewport`, `circuitBounds`, `fitViewport` | 4 |
| `src/ui/canvas/CircuitCanvas.tsx`, `canvas-test-state.ts`, `e2e/helpers.ts` | Stage có scale/offset; test state có `viewport`; `worldToPage` theo viewport | 4 |
| `src/ui/app/lab-layout.ts`, `LabWorkspace.tsx` | Tỉ lệ, separator, fold, tab | 5 |
| `src/ui/blockly/fit.ts` | Thu nhỏ view cho vừa khối | 5 |
| `src/ui/app/App.tsx`, `app.css`, `PythonPanel.tsx` | Ghép bố cục lab; Python thu gọn | 5 |
| `src/ui/state/run-store.ts` | `CheckObserver` cho `checkSessionOf` | 6 |
| `src/ui/runtime-controls/RuntimeControls.tsx`, `src/ui/canvas/YbcBoardRenderer.tsx`, `renderers.ts`, `colors.ts` | Vẽ input của kịch bản | 6 |
| `src/ui/app/App.tsx`, `app.css` | Khung cuối, overlay tiến độ | 6 |
| `e2e/lab-layout.spec.ts`, `e2e/lab-check.spec.ts` | E2E N8s | 4, 5, 6 |
| `docs/lab-embed-contract.md` + 2 plan + N6a plan | Ghi nhận (§15) | 7 |

Thứ tự là thứ tự phụ thuộc: 1 → 2 → 3 → 4 → 5 → 6 → 7 (5 dùng prop `fit` của 4 và text-state của 3; 6 dùng `LabWorkspace` `showBoard` của 5).

---

### Task 1: Test hygiene: CPU-time timing, macOS keys, E2E port  — `model: sonnet`

Bốn E2E `ybc-python` fail trên macOS và ba file test thời gian fail khi máy bận (Evidence). Task này chỉ sửa test (và config Playwright); không đổi code sản phẩm. Ruling R14, R15, R16.

**Files:**
- Modify: `playwright.config.ts`
- Create: `src/core/program/__fixtures__/cpu-clock.ts`
- Modify: `src/core/program/ybc-heavy-expression.test.ts`, `src/core/program/ybc-responsiveness.test.ts`, `src/ui/blockly/editor-blocks.test.ts`
- Modify: `e2e/ybc-python.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `cpuMs(): number`, `wallCeilingMs = 1000`, `heartbeat(): { beats(): number; maxBusyMs(): number; stop(): void }` in `src/core/program/__fixtures__/cpu-clock.ts` (tests only); env `E2E_PORT` read by `playwright.config.ts` (every later E2E command uses `E2E_PORT=5273`).

- [ ] **Step 1: Reproduce the failures on the untouched tree**

Run (load first, so the timing failures show):

```bash
export PATH=/private/tmp/claude-501/-Users-hoangminh-Desktop-stem/3a81bd87-e5be-4246-b5b9-b2dab2da24f0/scratchpad/bin:$PATH
for i in $(seq 1 36); do (yes > /dev/null &); done; sleep 3
pnpm exec vitest run src/core/program/ybc-heavy-expression.test.ts src/core/program/ybc-responsiveness.test.ts src/ui/blockly/editor-blocks.test.ts
pkill yes
```

Expected: FAIL in `ybc-heavy-expression.test.ts` ("leaves the event loop free within … the longest gap stays small", `expected 68.8 to be less than 50` or similar) and possibly `ybc-responsiveness.test.ts` ("lets a timer fire during a tight while true"). On a quiet machine they may pass; the load is what makes them fail.

The macOS E2E failures cannot be run against a free port yet (the config is fixed to 5173, which a live demo server holds); they are the 4 tests of Evidence.

- [ ] **Step 2: Measure CPU time, fix the keys, read the port**

**Replace in `e2e/ybc-python.spec.ts` (1/3):**

```ts
const blocklyPanel = (page: Page) => page.getByTestId('blockly-panel');

/** Types a new value into the number block showing `current`, as a learner does, and returns without waiting. */
async function editNumber(page: Page, current: string, next: string) {
  await blocklyPanel(page).locator('.blocklyEditableField .blocklyText', { hasText: new RegExp(`^${current}$`) }).first().click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(next);
  await page.keyboard.press('Enter');
}

```

with:

```ts
const blocklyPanel = (page: Page) => page.getByTestId('blockly-panel');

/**
 * Types a new value into the number block showing `current`, as a learner does, and returns without waiting for
 * any save. It does wait for Blockly's editor to open before typing (on a busy machine it opens late, and the keys
 * would go elsewhere) and to close on Enter, which commits the value at once.
 */
async function editNumber(page: Page, current: string, next: string) {
  const editor = page.locator('.blocklyWidgetDiv input.blocklyHtmlInput');
  await blocklyPanel(page).locator('.blocklyEditableField .blocklyText', { hasText: new RegExp(`^${current}$`) }).first().click();
  await expect(editor).toBeVisible();
  // Select all the field's text: Cmd+A on macOS, Ctrl+A elsewhere (Control+A only moves the caret on macOS).
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(next);
  await page.keyboard.press('Enter');
  await expect(editor).toBeHidden();
}

```

**Replace in `e2e/ybc-python.spec.ts` (2/3):**

```ts
});

test('when the clipboard is refused, the source is selected and Ctrl+C is explained, with no false Copied', async ({ page }) => {
  await openProject(page, project(program([print(text('héllo'))])));
  await expect(source(page)).toContainText("print('héllo')");
```

with:

```ts
});

test('when the clipboard is refused, the source is selected and the copy key is explained, with no false Copied', async ({ page }) => {
  await openProject(page, project(program([print(text('héllo'))])));
  await expect(source(page)).toContainText("print('héllo')");
```

**Replace in `e2e/ybc-python.spec.ts` (3/3):**

```ts
  await page.getByRole('button', { name: 'Copy' }).click();

  await expect(page.getByTestId('python-copy-status')).toHaveText('Copy failed. Press Ctrl+C to copy the selected code.');
  await expect(page.getByRole('button', { name: 'Copied' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
```

with:

```ts
  await page.getByRole('button', { name: 'Copy' }).click();

  // The app names the copy key of the platform the browser reports (PythonPanel's copyKey): Cmd+C on macOS.
  const copyKey = await page.evaluate(() => (/Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd+C' : 'Ctrl+C'));
  await expect(page.getByTestId('python-copy-status')).toHaveText(`Copy failed. Press ${copyKey} to copy the selected code.`);
  await expect(page.getByRole('button', { name: 'Copied' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
```

**Replace in `playwright.config.ts`:**

```ts
import { defineConfig, devices } from '@playwright/test';

const port = 5173;
const baseURL = `http://localhost:${port}`;
/** The lesson page that frames the lab in the iframe E2E (S1, e2e/lesson-host.mjs). */
```

with:

```ts
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = `http://localhost:${port}`;
/** The lesson page that frames the lab in the iframe E2E (S1, e2e/lesson-host.mjs). */
```

**Create `src/core/program/__fixtures__/cpu-clock.ts`:**

```ts
// How the timing tests measure (N8s): by the CPU time this process spends, not by the wall clock. A program that
// blocks the event loop does so by computing, and computing is CPU time; the wall clock also counts the time the
// operating system gives to other processes, so on a loaded machine (a build running next to the tests) it showed
// gaps of 50–180 ms for a loop that computed 9–24 ms at a stretch. The bounds stay as they were; only the clock
// changes. What waits instead of computing (a sleep that is never cut short) uses no CPU, so those tests also keep
// a wall-clock ceiling, loose enough for a loaded machine and far below any wait a program can ask for.

/** The CPU time this process has used, in ms (user + system, every thread). */
export function cpuMs(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

/** What a test that waits for something allows on the wall clock, however loaded the machine. */
export const wallCeilingMs = 1000;

export type Heartbeat = {
  /** How many times the 1 ms timer ran. */
  beats(): number;
  /** The most CPU time used between two runs of the timer: how long the event loop was blocked at a stretch. */
  maxBusyMs(): number;
  stop(): void;
};

/** A 1 ms timer that measures, in CPU time, the longest stretch the event loop spent without running it. */
export function heartbeat(): Heartbeat {
  let beats = 0;
  let last = cpuMs();
  let maxBusy = 0;
  const timer = setInterval(() => {
    const now = cpuMs();
    maxBusy = Math.max(maxBusy, now - last);
    last = now;
    beats++;
  }, 1);
  return { beats: () => beats, maxBusyMs: () => maxBusy, stop: () => clearInterval(timer) };
}
```

**Replace in `src/core/program/ybc-heavy-expression.test.ts` (1/4):**

```ts
import { timerSleep } from './interpreter';
import { MAX_PROGRAM_BLOCKS } from './limits';
import { runYbc } from './__fixtures__/run-ybc';

// Expression nodes are execution steps too (plan section 6.7): a tight loop around a big expression
// must hand control back about every 8 ms, not every 256 iterations of a heavy body. Real timers; the
// bounds catch the old behaviour (gaps of 50-70 ms) with room for Windows timer granularity.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
```

with:

```ts
import { timerSleep } from './interpreter';
import { MAX_PROGRAM_BLOCKS } from './limits';
import { cpuMs, heartbeat, wallCeilingMs } from './__fixtures__/cpu-clock';
import { runYbc } from './__fixtures__/run-ybc';

// Expression nodes are execution steps too (plan section 6.7): a tight loop around a big expression
// must hand control back about every 8 ms, not every 256 iterations of a heavy body. Real timers; the
// bounds catch the old behaviour (gaps of 50-70 ms) with room for Windows timer granularity. Time is the
// CPU time the run uses (__fixtures__/cpu-clock.ts), so a loaded machine does not make the loop look blocked.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
```

**Replace in `src/core/program/ybc-heavy-expression.test.ts` (2/4):**

```ts
}

/** A 1 ms timer: the longest time between two of its ticks is how long the event loop was blocked. */
function heartbeat() {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 1);
  return { maxGap: () => maxGap, stop: () => clearInterval(timer) };
}

// Measured here: 17-24 ms with expression accounting, 37-38 ms without it. The bound is the generous
// one (a gross-blocking guard, Windows timers are coarse); the exact property is pinned by the
```

with:

```ts
}

// Measured here: 17-24 ms with expression accounting, 37-38 ms without it. The bound is the generous
// one (a gross-blocking guard, Windows timers are coarse); the exact property is pinned by the
```

**Replace in `src/core/program/ybc-heavy-expression.test.ts` (3/4):**

```ts
    await running.done;
    beat.stop();
    expect(beat.maxGap()).toBeLessThan(maxGapAllowedMs);
  });

  it.each(heavy)('is stopped promptly by a Stop that is itself scheduled on the event loop: %s', async (_, build) => {
    const running = start(prog([whileLoop(bool(true), [setVar('x', build())])]));
    let pressedAt = 0;
    let lateness = 0;
    const due = performance.now() + 60;
    const pressed = new Promise<void>((resolve) => {
      setTimeout(() => {
        pressedAt = performance.now();
        lateness = pressedAt - due; // how long the busy program kept the Stop button waiting
        running.stop();
        resolve();
```

with:

```ts
    await running.done;
    beat.stop();
    expect(beat.maxBusyMs()).toBeLessThan(maxGapAllowedMs);
  });

  it.each(heavy)('is stopped promptly by a Stop that is itself scheduled on the event loop: %s', async (_, build) => {
    const beat = heartbeat();
    const running = start(prog([whileLoop(bool(true), [setVar('x', build())])]));
    let pressedCpu = 0;
    let pressedWall = 0;
    const pressed = new Promise<void>((resolve) => {
      setTimeout(() => {
        pressedCpu = cpuMs();
        pressedWall = performance.now();
        running.stop();
        resolve();
```

**Replace in `src/core/program/ybc-heavy-expression.test.ts` (4/4):**

```ts
    await pressed;
    const outcome = await running.done;
    const total = performance.now() - due;

    expect(outcome).toEqual({ status: 'stopped' });
    expect(lateness).toBeLessThan(maxGapAllowedMs);
    expect(total).toBeLessThan(stopDeadlineMs);
  });

```

with:

```ts
    await pressed;
    const outcome = await running.done;
    const stopCpu = cpuMs() - pressedCpu;
    const stopWall = performance.now() - pressedWall;
    beat.stop();

    expect(outcome).toEqual({ status: 'stopped' });
    // How long the busy program kept the Stop button waiting: its longest stretch without letting a timer run.
    expect(beat.maxBusyMs()).toBeLessThan(maxGapAllowedMs);
    expect(stopCpu).toBeLessThan(stopDeadlineMs);
    expect(stopWall).toBeLessThan(wallCeilingMs);
  });

```

**Replace in `src/core/program/ybc-responsiveness.test.ts` (1/5):**

```ts
import { timerSleep, type Sleep } from './interpreter';
import { MAX_REPEAT_ABS, MAX_WAIT_MS } from './limits';
import { runYbc } from './__fixtures__/run-ybc';

// Real time, real timers (no fake clock): a learner loop must not freeze the event loop, and Stop
// must end any program within the frozen 100 ms (plan section 6.7, 18.5). The deadline is the plan's;
// the runs below need a few milliseconds.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
```

with:

```ts
import { timerSleep, type Sleep } from './interpreter';
import { MAX_REPEAT_ABS, MAX_WAIT_MS } from './limits';
import { cpuMs, heartbeat, wallCeilingMs } from './__fixtures__/cpu-clock';
import { runYbc } from './__fixtures__/run-ybc';

// Real time, real timers (no fake clock): a learner loop must not freeze the event loop, and Stop
// must end any program within the frozen 100 ms (plan section 6.7, 18.5). The deadline is the plan's;
// the runs below need a few milliseconds. Time is the CPU time the run uses (__fixtures__/cpu-clock.ts),
// with a wall-clock ceiling for what waits, so a loaded machine does not fail them.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
```

**Replace in `src/core/program/ybc-responsiveness.test.ts` (2/5):**

```ts
}

/** A 1 ms timer. `maxGap` is the longest time between two ticks: how long the event loop was blocked at a stretch. */
function heartbeat() {
  let beats = 0;
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    beats++;
  }, 1);
  return { beats: () => beats, maxGap: () => maxGap, stop: () => clearInterval(timer) };
}

/** Generous for Windows timer granularity; a loop that never yields would show a gap of the whole run. */
const maxGapAllowedMs = 50;
```

with:

```ts
}

/** Generous for Windows timer granularity; a loop that never yields would show a gap of the whole run. */
const maxGapAllowedMs = 50;
```

**Replace in `src/core/program/ybc-responsiveness.test.ts` (3/5):**

```ts
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Presses Stop after `runForMs` and says how long the program took to end. */
async function stopAfter(blocks: Json, runForMs: number, options: Parameters<typeof start>[1] = {}) {
  const { running, runConsole, stats } = start(blocks, options);
  await pause(runForMs);
  const pressed = performance.now();
  running.stop();
  const outcome = await running.done;
  return { outcome, tookMs: performance.now() - pressed, runConsole, stats };
}

```

with:

```ts
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Presses Stop after `runForMs` and says how long the program took to end: in CPU time, and on the wall clock. */
async function stopAfter(blocks: Json, runForMs: number, options: Parameters<typeof start>[1] = {}) {
  const { running, runConsole, stats } = start(blocks, options);
  await pause(runForMs);
  const pressedCpu = cpuMs();
  const pressedWall = performance.now();
  running.stop();
  const outcome = await running.done;
  return { outcome, tookMs: cpuMs() - pressedCpu, tookWallMs: performance.now() - pressedWall, runConsole, stats };
}

```

**Replace in `src/core/program/ybc-responsiveness.test.ts` (4/5):**

```ts
  it('lets a timer fire during a tight while true with an empty body', async () => {
    const beat = heartbeat();
    const { tookMs, outcome, stats } = await stopAfter(prog([whileLoop(bool(true), [])]), 100);
    beat.stop();
    expect(outcome).toEqual({ status: 'stopped' });
    expect(beat.maxGap()).toBeLessThan(maxGapAllowedMs);
    expect(stats().yields).toBeGreaterThan(3);
    expect(tookMs).toBeLessThan(stopDeadlineMs);
  });

```

with:

```ts
  it('lets a timer fire during a tight while true with an empty body', async () => {
    const beat = heartbeat();
    const { tookMs, tookWallMs, outcome, stats } = await stopAfter(prog([whileLoop(bool(true), [])]), 100);
    beat.stop();
    expect(outcome).toEqual({ status: 'stopped' });
    expect(beat.maxBusyMs()).toBeLessThan(maxGapAllowedMs);
    expect(stats().yields).toBeGreaterThan(3);
    expect(tookMs).toBeLessThan(stopDeadlineMs);
    expect(tookWallMs).toBeLessThan(wallCeilingMs);
  });

```

**Replace in `src/core/program/ybc-responsiveness.test.ts` (5/5):**

```ts

  it.each(cases)('during %s', async (_, blocks) => {
    const { outcome, tookMs } = await stopAfter(blocks, 30);
    expect(outcome).toEqual({ status: 'stopped' });
    expect(tookMs).toBeLessThan(stopDeadlineMs);
  });

```

with:

```ts

  it.each(cases)('during %s', async (_, blocks) => {
    const { outcome, tookMs, tookWallMs } = await stopAfter(blocks, 30);
    expect(outcome).toEqual({ status: 'stopped' });
    expect(tookMs).toBeLessThan(stopDeadlineMs);
    expect(tookWallMs).toBeLessThan(wallCeilingMs);
  });

```

**Replace in `src/ui/blockly/editor-blocks.test.ts` (1/5):**

```ts
import { createBlockPackCatalog } from '../../core/program/block-packs';
import { createDefaultProgram } from '../../core/program/blocks';
import blinkSample from '../../samples/blink.project.json';
import buttonLedSample from '../../samples/button-led.project.json';
```

with:

```ts
import { createBlockPackCatalog } from '../../core/program/block-packs';
import { createDefaultProgram } from '../../core/program/blocks';
import { cpuMs } from '../../core/program/__fixtures__/cpu-clock';
import blinkSample from '../../samples/blink.project.json';
import buttonLedSample from '../../samples/button-led.project.json';
```

**Replace in `src/ui/blockly/editor-blocks.test.ts` (2/5):**

```ts
// The editor's own check of stored programs (plan §7), on real Blockly (its
// Node build, on jsdom): what it refuses is exactly what would make the
// program panel throw, and so the app go blank.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
```

with:

```ts
// The editor's own check of stored programs (plan §7), on real Blockly (its
// Node build, on jsdom): what it refuses is exactly what would make the
// program panel throw, and so the app go blank. "Quickly" and "in bounded time" are CPU time
// (core/program/__fixtures__/cpu-clock.ts): the work is synchronous, and a loaded machine must not fail it.

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
```

**Replace in `src/ui/blockly/editor-blocks.test.ts` (3/5):**

```ts
  });

  it('refuses a program nested too deeply for Blockly to load, and still opens the next one', () => {
    let block: Record<string, unknown> = { type: 'stem_digital_read', id: 'read', fields: { PIN: 'D2' } };
    for (let depth = 0; depth < 100_000; depth++) {
```

with:

```ts
  });

  // It asserts what is refused, not how fast: building 100 000 nested blocks may take longer than the default 5 s on a loaded machine.
  it('refuses a program nested too deeply for Blockly to load, and still opens the next one', { timeout: 30_000 }, () => {
    let block: Record<string, unknown> = { type: 'stem_digital_read', id: 'read', fields: { PIN: 'D2' } };
    for (let depth = 0; depth < 100_000; depth++) {
```

**Replace in `src/ui/blockly/editor-blocks.test.ts` (4/5):**

```ts

  it('opens a program with as many else-ifs as allowed, quickly', () => {
    const started = performance.now();

    expect(canOpen(program(ifWith({ elseIfCount: maxMutatorItemsPerBlock, hasElse: true })))).toBe(true);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
```

with:

```ts

  it('opens a program with as many else-ifs as allowed, quickly', () => {
    const started = cpuMs();

    expect(canOpen(program(ifWith({ elseIfCount: maxMutatorItemsPerBlock, hasElse: true })))).toBe(true);
    expect(cpuMs() - started).toBeLessThan(1000);
  });
});
```

**Replace in `src/ui/blockly/editor-blocks.test.ts` (5/5):**

```ts
      throw new Error('Blockly must not be asked to load this program');
    });
    const started = performance.now();

    expect(canOpen(blocks)).toBe(false);
    expect(performance.now() - started).toBeLessThan(100);
    // The count only: printing the calls would walk the program's holes too.
    expect(load.mock.calls.length).toBe(0);
```

with:

```ts
      throw new Error('Blockly must not be asked to load this program');
    });
    const started = cpuMs();

    expect(canOpen(blocks)).toBe(false);
    expect(cpuMs() - started).toBeLessThan(100);
    // The count only: printing the calls would walk the program's holes too.
    expect(load.mock.calls.length).toBe(0);
```

- [ ] **Step 3: Run the tests under the same load**

```bash
for i in $(seq 1 36); do (yes > /dev/null &); done; sleep 3
pnpm exec vitest run src/core/program/ybc-heavy-expression.test.ts src/core/program/ybc-responsiveness.test.ts src/ui/blockly/editor-blocks.test.ts
pkill yes
```

Expected: `Test Files  3 passed (3)`, `Tests  54 passed (54)`.

- [ ] **Step 4: Run the macOS E2E on a free port, three times over**

```bash
lsof -nP -iTCP:5273 -sTCP:LISTEN   # expected: no output
E2E_PORT=5273 pnpm exec playwright test e2e/ybc-python.spec.ts --repeat-each=3
```

Expected: `39 passed`.

- [ ] **Step 5: Run the gate**

Run: `pnpm verify`

Expected: `Test Files  135 passed (135)`, `Tests  4377 passed | 1 skipped (4378)`.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts src/core/program/__fixtures__/cpu-clock.ts src/core/program/ybc-heavy-expression.test.ts src/core/program/ybc-responsiveness.test.ts src/ui/blockly/editor-blocks.test.ts e2e/ybc-python.spec.ts
git commit -m "$(cat <<'EOF'
test(n8s): time by CPU, use macOS keys in the Python E2E, take the E2E port from E2E_PORT

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Favicon, Blockly media under the base path (S6), drop describeTone  — `model: sonnet`

Ruling R12, R13, R18.

**Files:**
- Create: `public/favicon.svg`, `src/ui/blockly/media.ts`, `src/ui/blockly/media.test.ts`
- Modify: `index.html`, `src/ui/blockly/BlocklyPanel.tsx`, `vite.config.ts`, `src/ui/audio/tone.ts`, `src/ui/audio/tone.test.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `blocklyMediaUrl(base: string): string` in `src/ui/blockly/media.ts`; `/favicon.svg`.

- [ ] **Step 1: Write the failing tests**

**Replace in `e2e/smoke.spec.ts`:**

```ts
  await expect(page.getByText('Proof of Concept')).toBeVisible();
});
```

with:

```ts
  await expect(page.getByText('Proof of Concept')).toBeVisible();
});

test('has its own icon, and the page asks for nothing that is missing', async ({ page }) => {
  const missing: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      missing.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);

  const href = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(href).toBe('/favicon.svg');
  const icon = await page.request.get(href ?? '');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');
  expect(missing).toEqual([]);
});
```

**Replace in `src/ui/audio/tone.test.ts` (1/2):**

```ts
import { describe, expect, it } from 'vitest';
import { describeTone, formatHz, toneHz } from './tone';

describe('toneHz', () => {
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { formatHz, toneHz } from './tone';

describe('toneHz', () => {
```

**Replace in `src/ui/audio/tone.test.ts` (2/2):**

```ts
    expect(formatHz(261.63)).toBe('262 Hz');
  });

  it('says what is sounding, or that nothing is', () => {
    expect(describeTone(undefined)).toBe('Silent');
    expect(describeTone(440)).toBe('Playing 440 Hz');
  });
});
```

with:

```ts
    expect(formatHz(261.63)).toBe('262 Hz');
  });
});
```

**Create `src/ui/blockly/media.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { blocklyMediaUrl } from './media';

describe('blocklyMediaUrl (S6)', () => {
  it.each([
    ['/', '/blockly-media/'],
    ['/lab/', '/lab/blockly-media/'],
    ['/lab', '/lab/blockly-media/'],
    ['./', './blockly-media/'],
  ])('serves the media of base %j at %j', (base, url) => {
    expect(blocklyMediaUrl(base)).toBe(url);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/ui/blockly/media.test.ts src/ui/audio/tone.test.ts`

Expected: FAIL — `Error: Cannot find module './media' imported from …/src/ui/blockly/media.test.ts`; `tone.test.ts` passes (it no longer imports `describeTone`).

Run: `E2E_PORT=5273 pnpm exec playwright test e2e/smoke.spec.ts`

Expected: FAIL in "has its own icon …" after 30 s: `Error: locator.getAttribute: Test timeout of 30000ms exceeded.` (there is no `link[rel="icon"]` to read); `1 failed`, `1 passed`.

- [ ] **Step 3: Implement**

**Replace in `index.html`:**

```html
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>STEM Studio</title>
  </head>
```

with:

```html
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>STEM Studio</title>
  </head>
```

**Create `public/favicon.svg`:**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <title>STEM Studio</title>
  <rect width="64" height="64" rx="14" fill="#4f46e5"/>
  <g fill="#ffffff">
    <rect x="14" y="14" width="8" height="8" rx="2"/>
    <rect x="28" y="14" width="8" height="8" rx="2" opacity="0.35"/>
    <rect x="42" y="14" width="8" height="8" rx="2"/>
    <rect x="14" y="28" width="8" height="8" rx="2"/>
    <rect x="28" y="28" width="8" height="8" rx="2"/>
    <rect x="42" y="28" width="8" height="8" rx="2"/>
    <rect x="14" y="42" width="8" height="8" rx="2" opacity="0.35"/>
    <rect x="42" y="42" width="8" height="8" rx="2" opacity="0.35"/>
  </g>
  <rect x="28" y="42" width="8" height="8" rx="2" fill="#f97316"/>
</svg>
```

**Replace in `src/ui/audio/tone.ts`:**

```ts
/** "262 Hz": the notes of the contract are whole numbers (§8.1), so rounding only guards the reading. */
export const formatHz = (hz: number) => `${Math.round(hz)} Hz`;

/** The text indicator: what is sounding, whether or not sound is turned on. */
export const describeTone = (hz: number | undefined) => (hz === undefined ? 'Silent' : `Playing ${formatHz(hz)}`);
```

with:

```ts
/** "262 Hz": the notes of the contract are whole numbers (§8.1), so rounding only guards the reading. */
export const formatHz = (hz: number) => `${Math.round(hz)} Hz`;
```

**Replace in `src/ui/blockly/BlocklyPanel.tsx` (1/2):**

```tsx
import type { ProjectStore } from '../state/project-store';
import { registerBlocks, ybcVariablesFlyout } from './editor-blocks';
import { stemTheme } from './theme';

```

with:

```tsx
import type { ProjectStore } from '../state/project-store';
import { registerBlocks, ybcVariablesFlyout } from './editor-blocks';
import { blocklyMediaUrl } from './media';
import { stemTheme } from './theme';

```

**Replace in `src/ui/blockly/BlocklyPanel.tsx` (2/2):**

```tsx
      theme: stemTheme,
      toolbox: toolbox as Blockly.utils.toolbox.ToolboxInfo,
      media: '/blockly-media/',
      sounds: false,
      maxInstances: { [blockTypes.onStart]: 1, [blockTypes.forever]: 1 },
```

with:

```tsx
      theme: stemTheme,
      toolbox: toolbox as Blockly.utils.toolbox.ToolboxInfo,
      media: blocklyMediaUrl(import.meta.env.BASE_URL),
      sounds: false,
      maxInstances: { [blockTypes.onStart]: 1, [blockTypes.forever]: 1 },
```

**Create `src/ui/blockly/media.ts`:**

```ts
/**
 * Where Blockly's media (sprites, cursors, the dropdown arrow) is served: `blockly-media/` under the app's base
 * path (`import.meta.env.BASE_URL`), so a build served from a sub-path finds it (S6). vite.config.ts serves and
 * copies the folder there.
 */
export function blocklyMediaUrl(base: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}blockly-media/`;
}
```

**Replace in `vite.config.ts` (1/2):**

```ts

/**
 * Serves Blockly's media (dropdown arrow, sprites, cursors) at /blockly-media/
 * so it never comes from a CDN: in dev by rewriting to the package folder,
 * in builds by copying that folder next to the bundle.
 */
function blocklyMedia(): Plugin {
```

with:

```ts

/**
 * Serves Blockly's media (dropdown arrow, sprites, cursors) at <base>blockly-media/
 * so it never comes from a CDN: in dev by rewriting to the package folder,
 * in builds by copying that folder next to the bundle. The base path is the
 * app's (`--base /lab/` serves it at /lab/blockly-media/, S6), and so is the
 * URL BlocklyPanel gives Blockly (src/ui/blockly/media.ts).
 */
function blocklyMedia(): Plugin {
```

**Replace in `vite.config.ts` (2/2):**

```ts
    name: 'blockly-media',
    configureServer(server) {
      // Not mounted on a path: connect would re-add the mount prefix after next().
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith('/blockly-media/')) {
          req.url = `/${blocklyMediaDir}/${req.url.slice('/blockly-media/'.length)}`;
        }
        next();
```

with:

```ts
    name: 'blockly-media',
    configureServer(server) {
      const prefix = `${server.config.base}blockly-media/`;
      // Not mounted on a path: connect would re-add the mount prefix after next().
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith(prefix)) {
          // Still under the base, which Vite strips before it serves the file.
          req.url = `${server.config.base}${blocklyMediaDir}/${req.url.slice(prefix.length)}`;
        }
        next();
```

- [ ] **Step 4: Run the tests, the sub-path checks and the gate**

Run: `pnpm exec vitest run src/ui/blockly/media.test.ts src/ui/audio/tone.test.ts`

Expected: `Test Files  2 passed (2)`.

Run: `E2E_PORT=5273 pnpm exec playwright test e2e/smoke.spec.ts`

Expected: `2 passed`.

Run (the dev server under a sub-path serves the media and the icon there):

```bash
(pnpm exec vite --port 5274 --strictPort --base /lab/ > n8s-sub.log 2>&1 &); sleep 4
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:5274/lab/blockly-media/sprites.svg
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:5274/lab/favicon.svg
pkill -f "vite --port 5274"; rm -f n8s-sub.log
pnpm exec vite build --base /lab/
grep -o 'href="[^"]*favicon[^"]*"' dist/index.html; ls dist/blockly-media/sprites.svg; rm -rf dist
```

Expected: `200 image/svg+xml` twice, `href="/lab/favicon.svg"`, and the path `dist/blockly-media/sprites.svg` (`dist/` and `*.log` are git-ignored).

Run: `pnpm verify`

Expected: `Test Files  136 passed (136)`, `Tests  4380 passed | 1 skipped (4381)`.

- [ ] **Step 5: Commit**

```bash
git add public/favicon.svg index.html src/ui/blockly/media.ts src/ui/blockly/media.test.ts src/ui/blockly/BlocklyPanel.tsx vite.config.ts src/ui/audio/tone.ts src/ui/audio/tone.test.ts e2e/smoke.spec.ts
git commit -m "$(cat <<'EOF'
feat(n8s): own favicon, Blockly media under the base path (S6), drop describeTone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Vietnamese overlay for the core's messages, launch problems and board labels  — `model: opus`

Ruling R10, R11. Áp dụng ở: thông báo của toolbar (`RunToolbar`: lý do không chạy, lỗi runtime, diagnostic), danh sách lỗi của `PythonPanel`, `LaunchError`, thông báo nối dây và nhãn Konva của `CircuitCanvas`. Tiếng Anh (`en`) trả nguyên văn, nên standalone và lab S1 không đổi một ký tự.

**Files:**
- Create: `src/ui/i18n/core-text.ts`, `src/ui/i18n/core-text.test.ts`, `src/ui/i18n/devices.ts`, `src/ui/i18n/devices.test.ts`
- Modify: `src/ui/i18n/messages.ts`, `src/ui/app/RunToolbar.tsx`, `src/ui/app/PythonPanel.tsx`, `src/ui/app/LaunchError.tsx`, `src/ui/app/LaunchError.test.tsx`, `src/ui/canvas/CircuitCanvas.tsx`, `src/ui/canvas/canvas-test-state.ts`, `e2e/ybc-embed.spec.ts`

**Interfaces:**
- Consumes: `viBlockText` (`src/ui/i18n/blocks.ts`), `translate`, `isMessageKey`, `Locale` (`messages.ts`), `useLocale` (`text.tsx`), `parseLaunch` (tests).
- Produces: `localizeCoreMessage(message: string, locale: Locale): string`, `localizeLaunchProblem(problem: string, locale: Locale): string`, `blockName(type: string): string`, `coreMessageRules`, `launchProblemRules`, `matchingRule(rules, message): number` (`core-text.ts`); `localizeDeviceDefinition(definition: DeviceDefinition, locale: Locale): DeviceDefinition`, `viPartLabels` (`devices.ts`); `diagnosticText(t, locale, diagnostic)` (signature gains `locale`); message keys `launch.detail`, `canvas.label`, `wire.duplicate-wire`, `wire.same-port`, `wire.rejected`; `CanvasTestState.components[].texts: string[]` (every Konva text of a body; Task 6 and the E2E read it).

- [ ] **Step 1: Write the failing tests**

**Replace in `e2e/ybc-embed.spec.ts`:**

```ts
    const error = page.getByTestId('launch-error');
    await expect(error).toContainText('Không mở được bài thực hành này.');
    await expect(error).toContainText('The template "ybc-heart" does not open in lab=blockly.');
    await expect(error).toContainText('Các mẫu được hỗ trợ: blink, led-on, button-direct, button-led, empty.');
  });
});
```

with:

```ts
    const error = page.getByTestId('launch-error');
    await expect(error).toContainText('Không mở được bài thực hành này.');
    // The reason in Vietnamese (N8s); the parser's English stays for whoever wrote the URL, under "technical detail".
    await expect(error.getByText('Mẫu bài "ybc-heart" không mở trong lab=blockly.')).toBeVisible();
    await expect(error.getByText('The template "ybc-heart" does not open in lab=blockly.')).toBeHidden();
    await error.getByText('Chi tiết kỹ thuật (cho người tạo đường dẫn)').click();
    await expect(error.getByText('The template "ybc-heart" does not open in lab=blockly.')).toBeVisible();
    await expect(error).toContainText('Các mẫu được hỗ trợ: blink, led-on, button-direct, button-led, empty.');
  });

  test('says what the core reports and what the board is in Vietnamese; the legacy lab keeps English (N8s)', async ({ page }) => {
    const boardTexts = async () =>
      (await page.evaluate(() => window.__stem?.getCanvasState()))?.components.find((component) => component.deviceType === 'ybc-board')?.texts;

    await page.goto('/?embed=1&lab=yolobit&template=ybc-heart');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    expect(await boardTexts()).toEqual(expect.arrayContaining(['Bo mạch tương thích Bit', 'Ánh sáng', 'Loa']));

    // Two "on start" blocks: the compiler refuses the program, and the toolbar says why in Vietnamese.
    const twoStarts = ybcSolutionDocument('ybc-heart');
    (twoStarts.program.blocks as { blocks: { blocks: unknown[] } }).blocks.blocks.push({ type: 'stem_on_start', id: 'on-start-2', x: 40, y: 420 });
    await page.evaluate((document) => window.__stem?.loadProject(document), twoStarts);
    await page.getByRole('button', { name: 'Chạy' }).click();
    await expect(page.getByTestId('run-messages')).toContainText('Chương trình có lỗi.');
    await expect(page.getByTestId('run-messages')).toContainText('Lỗi: Chỉ được có một khối "khi bắt đầu".');

    await page.goto('/?embed=1&template=ybc-heart');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    expect(await boardTexts()).toEqual(expect.arrayContaining(['Bit-compatible Board', 'Light', 'Buzzer']));
  });
});
```

**Replace in `src/ui/app/LaunchError.test.tsx` (1/2):**

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LaunchError } from './LaunchError';

```

with:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TextProvider } from '../i18n/text';
import { LaunchError } from './LaunchError';

```

**Replace in `src/ui/app/LaunchError.test.tsx` (2/2):**

```tsx
    );
  });
});
```

with:

```tsx
    );
  });

  it('says the problem in Vietnamese in a Vietnamese lab, and keeps the parser’s words as the technical detail (N8s)', () => {
    const markup = renderToStaticMarkup(
      <TextProvider locale="vi">
        <LaunchError problem="The template &quot;ybc-heart&quot; does not open in lab=blockly." lab="blockly" />
      </TextProvider>,
    );
    expect(markup).toContain('<p>Mẫu bài &quot;ybc-heart&quot; không mở trong lab=blockly.</p>');
    expect(markup).toContain('<summary>Chi tiết kỹ thuật (cho người tạo đường dẫn)</summary><p lang="en">The template &quot;ybc-heart&quot; does not open in lab=blockly.</p>');
  });

  it('shows no technical detail in English: the problem is already the parser’s words', () => {
    expect(renderToStaticMarkup(<LaunchError problem="template must be given once." />)).not.toContain('<details');
  });
});
```

**Create `src/ui/i18n/core-text.test.ts`:**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLaunch } from '../app/launch';
import { blockName, coreMessageRules, launchProblemRules, localizeCoreMessage, localizeLaunchProblem, matchingRule } from './core-text';

const sourceRoot = join(import.meta.dirname, '..', '..');

/** The files whose messages reach the UI: compile diagnostics, runtime faults, validity layers, the run session. */
const messageSources = [
  'core/program/compile-program.ts',
  'core/program/compile-ybc-program.ts',
  'core/program/ybc-interpreter.ts',
  'core/program/values.ts',
  'core/constructs/ybc.pins.ts',
  'core/run/ybc-pin-io.ts',
  'core/profiles/validity.ts',
  'core/run/run-session.ts',
];

/**
 * Every message literal of those files, as `report(severity, code, …)`, `new RuntimeFault(code, …)` or `message: …`
 * writes it, with each `${…}` replaced by X: what the overlay must recognise, whatever the values.
 */
function coreMessages(): string[] {
  const literal = /(?:report\(\s*'(?:error|warning)',\s*'[a-z-]+',\s*|new RuntimeFault\(\s*'[a-z-]+',\s*|message:\s*)(?:'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/g;
  const found = new Set<string>();
  for (const file of messageSources) {
    for (const match of readFileSync(join(sourceRoot, file), 'utf8').matchAll(literal)) {
      const text = (match[1] ?? match[2] ?? '').replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, 'X');
      // A template with a nested template (validity.ts' profile sentence) is listed by hand below.
      if (!text.includes('${') && !text.includes('`')) {
        found.add(text);
      }
    }
  }
  return [...found];
}

/** Messages the scan cannot read (built by a ternary, or a nested template), as the core writes them. */
const handWritten = [
  '"<" compares whole numbers, not a text and a whole number.',
  '"==" compares two values of one type, not a true / false value and a text.',
  '"ybc_light_level" is not available in the ybc-basic profile.',
  '"ybc_light_level" is not available in a generic project.',
  'led cannot be used in a ybc-basic project.',
  'led, button cannot be used in a generic project.',
  'This board has no analog input, so this block cannot be used.',
];

describe('the core’s messages in Vietnamese (N8s)', () => {
  it('reads the core’s sources', () => {
    expect(coreMessages().length).toBeGreaterThan(80);
  });

  it.each(coreMessages())('knows %j', (message) => {
    expect(matchingRule(coreMessageRules, message)).toBeGreaterThanOrEqual(0);
    expect(localizeCoreMessage(message, 'vi')).not.toBe(message);
  });

  it.each(handWritten)('knows %j, which the scan cannot read', (message) => {
    expect(matchingRule(coreMessageRules, message)).toBeGreaterThanOrEqual(0);
  });

  it('has no rule that no message of the core reaches', () => {
    const reached = new Set([...coreMessages(), ...handWritten].map((message) => matchingRule(coreMessageRules, message)));
    const unreached = coreMessageRules.map(([pattern], index) => (reached.has(index) ? null : String(pattern))).filter((rule) => rule !== null);
    expect(unreached).toEqual([]);
  });

  it.each([
    ['Only one "stem_on_start" block is allowed.', 'Chỉ được có một khối "khi bắt đầu".'],
    ['"if" needs a condition.', 'Khối "nếu" cần một điều kiện.'],
    ['"while" needs a true / false condition, not a whole number.', 'Khối "lặp khi" cần một điều kiện đúng / sai, không phải một số nguyên.'],
    ['"repeat" needs a whole number, not a text.', '"lặp lại" cần một số nguyên, không phải một đoạn chữ.'],
    ['"count up" start needs a whole number, not a true / false value.', 'Số bắt đầu của "đếm lên" cần một số nguyên, không phải một giá trị đúng / sai.'],
    ['"x" (a whole-number variable) needs a whole number, not a text.', '"x" (biến số nguyên) cần một số nguyên, không phải một đoạn chữ.'],
    ['A wait must be between 0 and 60000, not 70000.', 'Thời gian chờ phải nằm trong khoảng 0 tới 60000, không phải 70000.'],
    ['The number of repetitions must be between -1000000 and 1000000.', 'Số lần lặp phải nằm trong khoảng -1000000 tới 1000000.'],
    ['The sum is outside the supported integer range (±9007199254740991).', 'Tổng vượt quá khoảng số nguyên được hỗ trợ (±9007199254740991).'],
    ['Division by zero.', 'Chia cho 0.'],
    ['Pin P1 is not connected to anything, so it cannot be read.', 'Chân P1 chưa nối với gì, nên không đọc được.'],
    ['This board has no display for "ybc_display_show_image".', 'Bo mạch này không có màn hình cho khối "hiển thị hình".'],
    ['Blocks outside "on start" and "forever" do not run.', 'Khối nằm ngoài "khi bắt đầu" và "lặp mãi mãi" sẽ không chạy.'],
    ['The circuit needs a board.', 'Mạch cần có một bo mạch.'],
    ['"ybc_light_level" is not available in the ybc-basic profile.', 'Khối "mức ánh sáng" không có ở cấp độ ybc-basic.'],
    ['Unknown block "stem_servo".', 'Không biết khối "stem_servo".'],
  ])('says %j as %j', (english, vietnamese) => {
    expect(localizeCoreMessage(english, 'vi')).toBe(vietnamese);
  });

  it('leaves English as the core wrote it, and a sentence it does not know as it is', () => {
    expect(localizeCoreMessage('Division by zero.', 'en')).toBe('Division by zero.');
    expect(localizeCoreMessage('Something new happened.', 'vi')).toBe('Something new happened.');
  });

  it.each([
    ['stem_on_start', 'khi bắt đầu'],
    ['ybc_sound_note', 'phát nốt trong nhịp'],
    ['controls_if', 'nếu'],
    ['stem_servo', 'stem_servo'],
    ['constructor', 'constructor'],
  ])('names the block %s "%s"', (type, name) => {
    expect(blockName(type)).toBe(name);
  });
});

describe('a broken launch in Vietnamese (N8s)', () => {
  const broken = [
    '?template=blink',
    '?embed=0&template=blink',
    '?embed=1&lab=blockly&lab=blockly&template=blink',
    '?embed=1&lab=scratch&template=blink',
    '?embed=1&lab=&template=blink',
    '?embed=1&lab=yolobit',
    '?embed=1&template=blink&template=led-on',
    '?embed=1&lab=blockly&template=blinky',
    '?embed=1&lab=blockly&template=ybc-heart',
    '?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-basic&profile=ybc-basic',
    '?embed=1&lab=blockly&template=blink&profile=ybc-basic',
    '?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-pro',
    '?embed=1&lab=blockly&template=blink&origin=http://a.example&origin=http://a.example',
    `?embed=1&lab=blockly&template=blink&origin=${encodeURIComponent('http://localhost:3000/')}`,
  ];

  it.each(broken)('says the problem of %s in Vietnamese', (search) => {
    const launch = parseLaunch(search);
    if (launch.mode !== 'invalid') {
      throw new Error(`${search} is not a broken launch`);
    }
    expect(matchingRule(launchProblemRules, launch.problem)).toBeGreaterThanOrEqual(0);
    expect(localizeLaunchProblem(launch.problem, 'vi')).not.toBe(launch.problem);
    expect(localizeLaunchProblem(launch.problem, 'en')).toBe(launch.problem);
  });

  it('has no rule that no broken launch reaches', () => {
    const reached = new Set(
      broken.map((search) => {
        const launch = parseLaunch(search);
        return launch.mode === 'invalid' ? matchingRule(launchProblemRules, launch.problem) : -1;
      }),
    );
    expect(launchProblemRules.map((_, index) => index).filter((index) => !reached.has(index))).toEqual([]);
  });

  it('keeps the key and the lab it names', () => {
    expect(localizeLaunchProblem('The template "ybc-heart" does not open in lab=blockly.', 'vi')).toBe('Mẫu bài "ybc-heart" không mở trong lab=blockly.');
    expect(localizeLaunchProblem('Unknown profile "ybc-pro": use ybc-basic or ybc-advanced.', 'vi')).toBe('Không có cấp độ "ybc-pro": dùng ybc-basic hoặc ybc-advanced.');
  });
});
```

**Create `src/ui/i18n/devices.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { localizeDeviceDefinition } from './devices';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('the canvas text of a device (N8s)', () => {
  it('draws the Yolo:Bit-compatible board and its parts in Vietnamese', () => {
    const board = localizeDeviceDefinition(registry.get('ybc-board'), 'vi');
    expect(board.name).toBe('Bo mạch tương thích Bit');
    expect(board.board?.onboard?.map((part) => part.label)).toEqual(['Màn hình', 'A', 'B', 'Ánh sáng', 'Loa']);
    // Only text changes: where the parts are, what they are and the ports stay the core's.
    expect(board.ports).toEqual(registry.get('ybc-board').ports);
    expect(board.board?.onboard?.map((part) => part.at)).toEqual(registry.get('ybc-board').board?.onboard?.map((part) => part.at));
  });

  it.each([
    ['board', 'Bo mạch STEM'],
    ['resistor', 'Điện trở'],
    ['led', 'Đèn LED'],
    ['push-button', 'Nút bấm'],
    ['potentiometer', 'Biến trở'],
  ])('names the %s "%s"', (deviceType, name) => {
    expect(localizeDeviceDefinition(registry.get(deviceType), 'vi').name).toBe(name);
  });

  it('gives English the definition itself, and leaves the registry’s definitions as they were', () => {
    const board = registry.get('ybc-board');
    expect(localizeDeviceDefinition(board, 'en')).toBe(board);
    localizeDeviceDefinition(board, 'vi');
    expect(board.name).toBe('Bit-compatible Board');
    expect(board.board?.onboard?.[3]?.label).toBe('Light');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/ui/i18n/core-text.test.ts src/ui/i18n/devices.test.ts src/ui/app/LaunchError.test.tsx`

Expected: FAIL — `Error: Cannot find module './core-text'`, `Error: Cannot find module './devices'`, and in `LaunchError.test.tsx` "says the problem in Vietnamese …": `AssertionError: expected '<main class="launch-error" role="aler…' to contain '<p>Mẫu bài &quot;ybc-heart&quot; khôn…'`.

- [ ] **Step 3: Implement**

**Replace in `src/ui/app/LaunchError.tsx` (1/2):**

```tsx
import { templateKeys, templateKeysOf, type LabKind } from '../../samples/templates';
import { useText } from '../i18n/text';
import './app.css';

```

with:

```tsx
import { templateKeys, templateKeysOf, type LabKind } from '../../samples/templates';
import { localizeLaunchProblem } from '../i18n/core-text';
import { useLocale, useText } from '../i18n/text';
import './app.css';

```

**Replace in `src/ui/app/LaunchError.tsx` (2/2):**

```tsx
export function LaunchError({ problem, lab }: { problem: string; lab?: LabKind }) {
  const t = useText();
  const supported = lab === undefined ? templateKeys : templateKeysOf(lab);
  // The problem is the parser's own text (English): it names the parameter to fix, for the page that built the URL.
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
      <h1>{t('app.title')}</h1>
      <p className="launch-error-title">{t('launch.title')}</p>
      <p>{problem}</p>
      <p>{t('launch.supported', { keys: supported.join(', ') })}</p>
    </main>
```

with:

```tsx
export function LaunchError({ problem, lab }: { problem: string; lab?: LabKind }) {
  const t = useText();
  const locale = useLocale();
  const supported = lab === undefined ? templateKeys : templateKeysOf(lab);
  // The problem is the parser's own text (English): it names the parameter to fix, for the page that built the URL.
  // A Vietnamese lab says it in Vietnamese (N8s) and keeps the parser's words under "technical detail".
  const reason = localizeLaunchProblem(problem, locale);
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
      <h1>{t('app.title')}</h1>
      <p className="launch-error-title">{t('launch.title')}</p>
      <p>{reason}</p>
      {reason !== problem && (
        <details className="launch-error-detail">
          <summary>{t('launch.detail')}</summary>
          <p lang="en">{problem}</p>
        </details>
      )}
      <p>{t('launch.supported', { keys: supported.join(', ') })}</p>
    </main>
```

**Replace in `src/ui/app/PythonPanel.tsx` (1/3):**

```tsx
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { BlockPackCatalog } from '../../core/program/block-packs';
import { useText } from '../i18n/text';

// The Python panel of a Yolo:Bit-compatible project (YB plan §13.7): the MicroPython the
```

with:

```tsx
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { BlockPackCatalog } from '../../core/program/block-packs';
import { localizeCoreMessage } from '../i18n/core-text';
import { useLocale, useText } from '../i18n/text';

// The Python panel of a Yolo:Bit-compatible project (YB plan §13.7): the MicroPython the
```

**Replace in `src/ui/app/PythonPanel.tsx` (2/3):**

```tsx
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const t = useText();

  useEffect(() => {
```

with:

```tsx
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const t = useText();
  const locale = useLocale();

  useEffect(() => {
```

**Replace in `src/ui/app/PythonPanel.tsx` (3/3):**

```tsx
            {generation.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: diagnostic.message })}
              </li>
            ))}
```

with:

```tsx
            {generation.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: localizeCoreMessage(diagnostic.message, locale) })}
              </li>
            ))}
```

**Replace in `src/ui/app/RunToolbar.tsx` (1/2):**

```tsx
import { useStore } from 'zustand';
import type { RunDiagnostic } from '../../core/run/run-session';
import { useText, type Text } from '../i18n/text';
import { selectIsRunning, type RunStore } from '../state/run-store';
import { Console } from './Console';

/** A diagnostic of the core as the toolbar lists it: the core's message (English) after the UI's own prefix. */
export const diagnosticText = (t: Text, diagnostic: RunDiagnostic) =>
  t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: diagnostic.message });

type RunToolbarProps = {
```

with:

```tsx
import { useStore } from 'zustand';
import type { RunDiagnostic } from '../../core/run/run-session';
import { localizeCoreMessage } from '../i18n/core-text';
import type { Locale } from '../i18n/messages';
import { useLocale, useText, type Text } from '../i18n/text';
import { selectIsRunning, type RunStore } from '../state/run-store';
import { Console } from './Console';

/** A diagnostic of the core as the toolbar lists it: the core's message, in the UI's language (core-text.ts), after the UI's own prefix. */
export const diagnosticText = (t: Text, locale: Locale, diagnostic: RunDiagnostic) =>
  t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: localizeCoreMessage(diagnostic.message, locale) });

type RunToolbarProps = {
```

**Replace in `src/ui/app/RunToolbar.tsx` (2/2):**

```tsx
  const running = useStore(runStore, selectIsRunning);
  const t = useText();

  // A failed Run leaves the session idle, so its reasons come from the start result.
  const messages = startFailure
    ? [t(`run.failure.${startFailure.reason}`), ...startFailure.diagnostics.map((diagnostic) => diagnosticText(t, diagnostic))]
    : [
        ...(snapshot.error ? [t('run.error', { message: snapshot.error.message })] : []),
        ...snapshot.diagnostics.map((diagnostic) => diagnosticText(t, diagnostic)),
      ];

```

with:

```tsx
  const running = useStore(runStore, selectIsRunning);
  const t = useText();
  const locale = useLocale();

  // A failed Run leaves the session idle, so its reasons come from the start result.
  const messages = startFailure
    ? [t(`run.failure.${startFailure.reason}`), ...startFailure.diagnostics.map((diagnostic) => diagnosticText(t, locale, diagnostic))]
    : [
        ...(snapshot.error ? [t('run.error', { message: localizeCoreMessage(snapshot.error.message, locale) })] : []),
        ...snapshot.diagnostics.map((diagnostic) => diagnosticText(t, locale, diagnostic)),
      ];

```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (1/7):**

```tsx
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Shape } from 'konva/lib/Shape';
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { addComponent, deleteComponent, moveComponent } from '../../core/circuit/components';
```

with:

```tsx
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Shape } from 'konva/lib/Shape';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { addComponent, deleteComponent, moveComponent } from '../../core/circuit/components';
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (2/7):**

```tsx
import type { BoardContext } from '../../core/profiles/board-context';
import { isContact, type ComponentState, type SimulationResult } from '../../core/simulation/simulate-circuit';
import { partStateOf } from '../runtime-controls/display-view';
import { Palette } from './Palette';
```

with:

```tsx
import type { BoardContext } from '../../core/profiles/board-context';
import { isContact, type ComponentState, type SimulationResult } from '../../core/simulation/simulate-circuit';
import { localizeDeviceDefinition } from '../i18n/devices';
import type { MessageKey } from '../i18n/messages';
import { useLocale, useText } from '../i18n/text';
import { partStateOf } from '../runtime-controls/display-view';
import { Palette } from './Palette';
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (3/7):**

```tsx
// connectWire decides what is valid; the UI only words its answer. Only the
// first two can come from a click: ports come from the circuit, ids from nextWireId.
const wireErrorText: Record<ConnectWireError, string> = {
  'duplicate-wire': 'These ports are already connected.',
  'same-port': 'A wire needs two different ports.',
  'duplicate-wire-id': 'That wire cannot be added.',
  'unknown-component': 'That wire cannot be added.',
  'unknown-port': 'That wire cannot be added.',
};

```

with:

```tsx
// connectWire decides what is valid; the UI only words its answer. Only the
// first two can come from a click: ports come from the circuit, ids from nextWireId.
const wireErrorText: Record<ConnectWireError, MessageKey> = {
  'duplicate-wire': 'wire.duplicate-wire',
  'same-port': 'wire.same-port',
  'duplicate-wire-id': 'wire.rejected',
  'unknown-component': 'wire.rejected',
  'unknown-port': 'wire.rejected',
};

```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (4/7):**

```tsx
  const [hoveredPort, setHoveredPort] = useState<PortRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The button the pointer holds. Not rendered: how a button looks comes from
  // the snapshot (`closed`), like a lit LED, so the run stays the only source.
```

with:

```tsx
  const [hoveredPort, setHoveredPort] = useState<PortRef | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const t = useText();
  const locale = useLocale();
  // What a body draws (its name, its parts' labels) in the UI's language (N8s); geometry keeps the registry's definitions.
  const drawnDefinition = useMemo(() => {
    const drawn = new Map<string, DeviceDefinition>();
    return (deviceType: string) => {
      let definition = drawn.get(deviceType);
      if (!definition) {
        definition = localizeDeviceDefinition(registry.get(deviceType), locale);
        drawn.set(deviceType, definition);
      }
      return definition;
    };
  }, [registry, locale]);
  // The button the pointer holds. Not rendered: how a button looks comes from
  // the snapshot (`closed`), like a lit LED, so the run stays the only source.
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (5/7):**

```tsx
      onCircuitChange(result.circuit);
    } else {
      setMessage(wireErrorText[result.error]);
    }
  };
```

with:

```tsx
      onCircuitChange(result.circuit);
    } else {
      setMessage(t(wireErrorText[result.error]));
    }
  };
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (6/7):**

```tsx
          data-testid="circuit-canvas"
          tabIndex={0}
          aria-label="Circuit canvas"
          onKeyDown={onKeyDown}
          // Capture: runs before Konva's handlers. Konva prevents the default of
```

with:

```tsx
          data-testid="circuit-canvas"
          tabIndex={0}
          aria-label={t('canvas.label')}
          onKeyDown={onKeyDown}
          // Capture: runs before Konva's handlers. Konva prevents the default of
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (7/7):**

```tsx
                    key={component.id}
                    component={component}
                    definition={registry.get(component.deviceType)}
                    incompatible={incompatibleIds.has(component.id)}
                    runtimeState={runtimeStateOf(simulation, component.id)}
```

with:

```tsx
                    key={component.id}
                    component={component}
                    definition={drawnDefinition(component.deviceType)}
                    incompatible={incompatibleIds.has(component.id)}
                    runtimeState={runtimeStateOf(simulation, component.id)}
```

**Replace in `src/ui/canvas/canvas-test-state.ts` (1/2):**

```ts
    /** Drawn with the mark for a device that does not belong to the project's family (R-F4). */
    incompatible: boolean;
  }[];
  wires: { id: string; points: number[]; selected: boolean }[];
```

with:

```ts
    /** Drawn with the mark for a device that does not belong to the project's family (R-F4). */
    incompatible: boolean;
    /** Every text drawn on the body (its name, its parts' labels), in drawing order (N8s). */
    texts: string[];
  }[];
  wires: { id: string; points: number[]; selected: boolean }[];
```

**Replace in `src/ui/canvas/canvas-test-state.ts` (2/2):**

```ts
      selected: node.findOne('.selection') !== undefined,
      incompatible: node.findOne('.incompatible') !== undefined,
    })),
    wires: stage.find<Konva.Line>('.wire').map((node) => ({
```

with:

```ts
      selected: node.findOne('.selection') !== undefined,
      incompatible: node.findOne('.incompatible') !== undefined,
      texts: node.find<Konva.Text>('Text').map((text) => text.text()),
    })),
    wires: stage.find<Konva.Line>('.wire').map((node) => ({
```

**Create `src/ui/i18n/core-text.ts`:**

```ts
import type { Locale } from './messages';
import { viBlockText } from './blocks';

// What the core says, in the UI's language (N8s). The core has no locale (B1): its compiler, interpreter and
// validity layers word their diagnostics in English, and the launch parser words a broken URL in English. This
// overlay recognises those sentences, one rule per sentence frame, and says them in Vietnamese; the names inside
// (a block, a pin, a number) are carried over, a block by its Vietnamese text where the UI has one. A sentence no
// rule knows is shown as the core wrote it: English, never nothing. English launches get the core's text unchanged.
// When the core gains or rewords a message, core-text.test.ts (which reads the core's sources) says so.

type Rule = readonly [pattern: RegExp, say: (...parts: string[]) => string];

/** Words of the core's sentences that name a block or an input by its English label. */
const terms: Readonly<Record<string, string>> = {
  if: 'nếu',
  'else if': 'nếu không thì nếu',
  while: 'lặp khi',
  repeat: 'lặp lại',
  'count up': 'đếm lên',
  'count up from': 'đếm lên từ',
  'count up to': 'đếm lên tới',
  wait: 'chờ',
  'scroll text': 'chạy chữ',
  'scroll number': 'chạy số',
  compare: 'so sánh',
  join: 'nối chữ',
  not: 'phủ định',
  and: 'và',
  or: 'hoặc',
  'on start': 'khi bắt đầu',
  forever: 'lặp mãi mãi',
  'set pin': 'đặt chân',
  set: 'đặt',
  'analog read': 'đọc tương tự',
};

/** Blockly's own blocks that the core may name by type; the custom blocks are named by their Vietnamese text. */
const builtinBlockNames: Readonly<Record<string, string>> = {
  controls_if: 'nếu',
  controls_repeat_ext: 'lặp lại',
  logic_compare: 'so sánh',
  logic_operation: 'và / hoặc',
  logic_negate: 'phủ định',
  logic_boolean: 'đúng / sai',
  math_number: 'số',
  math_arithmetic: 'phép tính',
  math_modulo: 'chia lấy dư',
  text: 'chữ',
  text_join: 'nối chữ',
  text_print: 'in',
  variables_get: 'biến',
  variables_set: 'đặt biến',
};

/** What the type checker calls a type (compile-ybc-program.ts `describe`). */
const types: Readonly<Record<string, string>> = {
  'a whole number': 'một số nguyên',
  'a true / false value': 'một giá trị đúng / sai',
  'a text': 'một đoạn chữ',
};

/** The quantities of a range or overflow message (`what`). */
const quantities: Readonly<Record<string, string>> = {
  'The number of repetitions': 'Số lần lặp',
  'The start': 'Số bắt đầu',
  'The end': 'Số kết thúc',
  'A wait': 'Thời gian chờ',
  'The sum': 'Tổng',
  'The difference': 'Hiệu',
  'The product': 'Tích',
  'The quotient': 'Thương',
  'The remainder': 'Số dư',
};

/** The capabilities a board may lack (constructs' `capability`). */
const capabilities: Readonly<Record<string, string>> = {
  display: 'màn hình',
  buttons: 'nút bấm',
  light: 'cảm biến ánh sáng',
  sound: 'loa',
  digital: 'chân số',
  analogIn: 'đầu vào tương tự',
  'analog input': 'đầu vào tương tự',
  'digital pin': 'chân số',
};

const own = <Value>(table: Readonly<Record<string, Value>>, key: string): Value | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);
const term = (label: string) => own(terms, label) ?? label;
const typeName = (english: string) => own(types, english) ?? english;

/** A block type as the learner knows it: the text of the block (placeholders dropped), or the type itself. */
export function blockName(type: string): string {
  const custom = own(viBlockText, type)?.message0;
  if (custom !== undefined) {
    const words = custom.replace(/%\d+/g, '').replace(/\s+/g, ' ').trim();
    if (words !== '') {
      return words;
    }
  }
  return own(builtinBlockNames, type) ?? type;
}

/** `"repeat"` → `"lặp lại"`, `"count up" start` → `số bắt đầu của "đếm lên"`, `"x" (a whole-number variable)` → … */
function subject(what: string): string {
  const known = own(quantities, what);
  if (known !== undefined) {
    return known;
  }
  const bound = /^"(.+)" (start|end)$/.exec(what);
  if (bound) {
    return `${bound[2] === 'start' ? 'Số bắt đầu' : 'Số kết thúc'} của "${term(bound[1] ?? '')}"`;
  }
  const variable = /^"(.+)" \(a whole-number variable\)$/.exec(what);
  if (variable) {
    return `"${variable[1]}" (biến số nguyên)`;
  }
  const quoted = /^"(.+)"$/.exec(what);
  return quoted ? `"${term(quoted[1] ?? '')}"` : what;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** `a generic project` → `dự án mạch thường`, `a ybc-basic project` → `dự án ybc-basic` (validity.ts `where`). */
function place(where: string): string {
  if (where === 'a generic project') {
    return 'dự án mạch thường';
  }
  const profile = /^a (.+) project$/.exec(where);
  return profile ? `dự án ${profile[1]}` : where;
}

/** The rules for the core's diagnostics and runtime errors, most specific first. Exported for its tests. */
export const coreMessageRules: readonly Rule[] = [
  // Program shape (both compilers)
  [/^The program is not a Blockly workspace\.$/, () => 'Chương trình không phải một vùng làm việc Blockly.'],
  [/^The program is nested too deeply\.$/, () => 'Chương trình lồng nhau quá sâu.'],
  [/^A block in the program is malformed\.$/, () => 'Một khối trong chương trình bị hỏng.'],
  [/^The "(.+)" input is malformed\.$/, (input) => `Ô "${input}" bị hỏng.`],
  [/^The else-if count or the else of "if" is malformed\.$/, () => 'Số nhánh "nếu không thì nếu" hoặc nhánh "nếu không thì" của khối "nếu" bị hỏng.'],
  [/^The number of parts of "join" is malformed\.$/, () => 'Số phần của khối "nối chữ" bị hỏng.'],
  [/^A program is limited to (.+) blocks\.$/, (count) => `Một chương trình có tối đa ${count} khối.`],
  [/^Blocks outside "on start" and "forever" do not run\.$/, () => 'Khối nằm ngoài "khi bắt đầu" và "lặp mãi mãi" sẽ không chạy.'],
  [/^Only one "(.+)" block is allowed\.$/, (type) => `Chỉ được có một khối "${blockName(type)}".`],
  [/^Unknown condition block "(.+)"\.$/, (type) => `Không biết khối điều kiện "${blockName(type)}".`],
  [/^Unknown block "(.+)"\.$/, (type) => `Không biết khối "${blockName(type)}".`],
  [/^"(.+)" is not available: it is excluded \((.+)\)\.$/, (type, row) => `Khối "${blockName(type)}" không dùng được: đã bị loại (${row}).`],
  [/^"(.+)" is not supported by the compiler\.$/, (type) => `Trình dịch chưa hỗ trợ khối "${blockName(type)}".`],
  [/^"(.+)" cannot be used as a value\.$/, (type) => `Khối "${blockName(type)}" không dùng làm giá trị được.`],
  [/^"(.+)" cannot be used as a statement\.$/, (type) => `Khối "${blockName(type)}" không dùng làm câu lệnh được.`],
  [/^"(.+)" is not available in the (.+) profile\.$/, (type, profile) => `Khối "${blockName(type)}" không có ở cấp độ ${profile}.`],
  [/^"(.+)" is not available in a generic project\.$/, (type) => `Khối "${blockName(type)}" không có trong dự án mạch thường.`],
  // Inputs and conditions
  [/^"(.+)" needs a condition; the one it has is disabled\.$/, (label) => `Khối "${term(label)}" cần một điều kiện; điều kiện đang có bị vô hiệu hoá.`],
  [/^"(.+)" needs a condition\.$/, (label) => `Khối "${term(label)}" cần một điều kiện.`],
  [/^"(.+)" needs a value; the one it has is disabled\.$/, (label) => `Khối "${term(label)}" cần một giá trị; giá trị đang có bị vô hiệu hoá.`],
  [/^"(.+)" needs a value\.$/, (label) => `Khối "${term(label)}" cần một giá trị.`],
  [/^"(.+)" needs a true \/ false condition, not (.+)\.$/, (label, type) => `Khối "${term(label)}" cần một điều kiện đúng / sai, không phải ${typeName(type)}.`],
  [/^"(.+)" compares whole numbers, not (.+) and (.+)\.$/, (op, a, b) => `"${op}" so sánh hai số nguyên, không phải ${typeName(a)} và ${typeName(b)}.`],
  [/^"(.+)" compares two values of one type, not (.+) and (.+)\.$/, (op, a, b) => `"${op}" so sánh hai giá trị cùng loại, không phải ${typeName(a)} và ${typeName(b)}.`],
  [/^(.+) needs (.+), not (.+)\.$/, (what, wanted, got) => `${capitalize(subject(what))} cần ${typeName(wanted)}, không phải ${typeName(got)}.`],
  [/^digital read needs a pin name\.$/, () => 'Khối "đọc chân số" cần tên chân.'],
  [/^digital write needs a pin name and a HIGH or LOW level\.$/, () => 'Khối "ghi chân số" cần tên chân và mức HIGH hoặc LOW.'],
  [/^wait needs a number of seconds\.$/, () => 'Khối "chờ" cần số giây.'],
  [/^A button block needs its button\.$/, () => 'Khối nút cần chọn nút.'],
  [/^A button is A or B\.$/, () => 'Nút là A hoặc B.'],
  [/^A note or rest needs its length\.$/, () => 'Khối nốt hoặc nghỉ cần độ dài.'],
  [/^A length is 1, 2 or 4 ticks\.$/, () => 'Độ dài là 1, 2 hoặc 4 nhịp.'],
  [/^A note block needs its note\.$/, () => 'Khối nốt cần chọn nốt.'],
  [/^A note is one of the natural notes from C3 to C5\.$/, () => 'Nốt là một nốt tự nhiên từ C3 tới C5.'],
  [/^A pin block needs its pin\.$/, () => 'Khối chân cần chọn chân.'],
  [/^A "set pin" block needs ON or OFF\.$/, () => 'Khối "đặt chân" cần BẬT hoặc TẮT.'],
  [/^A pin is set ON or OFF\.$/, () => 'Chân chỉ đặt được BẬT hoặc TẮT.'],
  [/^A true \/ false block needs its value\.$/, () => 'Khối đúng / sai cần giá trị.'],
  [/^A text block needs its text\.$/, () => 'Khối chữ cần nội dung.'],
  [/^A variable block needs its variable\.$/, () => 'Khối biến cần chọn biến.'],
  [/^A "set" block needs its variable\.$/, () => 'Khối "đặt" cần chọn biến.'],
  [/^"count up" needs its variable\.$/, () => 'Khối "đếm lên" cần chọn biến.'],
  [/^"count up" needs a whole-number step\.$/, () => 'Khối "đếm lên" cần bước là số nguyên.'],
  [/^"count up" cannot count down; use "repeat" and a variable\.$/, () => 'Khối "đếm lên" không đếm xuống được; dùng "lặp lại" và một biến.'],
  [/^This variable does not exist\.$/, () => 'Biến này không tồn tại.'],
  [/^An arithmetic block needs its operation\.$/, () => 'Khối phép tính cần chọn phép tính.'],
  [/^A comparison needs its operator\.$/, () => 'Khối so sánh cần chọn phép so sánh.'],
  [/^A logic block needs "and" or "or"\.$/, () => 'Khối logic cần "và" hoặc "hoặc".'],
  [/^Every square of a picture is either lit or not\.$/, () => 'Mỗi ô của hình chỉ sáng hoặc tắt.'],
  // Values and limits
  [/^Only \+, − and × are supported; use \/\/ for whole-number division\.$/, () => 'Chỉ có +, − và ×; dùng // để chia lấy phần nguyên.'],
  [/^This arithmetic block is not available here; use the \+ − × block of this profile\.$/, () => 'Khối phép tính này không dùng ở đây; dùng khối + − × của cấp độ này.'],
  [/^Only whole numbers are supported\.$/, () => 'Chỉ dùng được số nguyên.'],
  [/^A number must be between (.+) and (.+)\.$/, (low, high) => `Số phải nằm trong khoảng ${low} tới ${high}.`],
  [/^A text is limited to (.+) characters\.$/, (count) => `Một đoạn chữ có tối đa ${count} ký tự.`],
  [/^A text cannot contain control characters\.$/, () => 'Đoạn chữ không được chứa ký tự điều khiển.'],
  [/^"join" takes at most (.+) parts\.$/, (count) => `Khối "nối chữ" có tối đa ${count} phần.`],
  [/^The step must be between 1 and (.+)\.$/, (high) => `Bước phải nằm trong khoảng 1 tới ${high}.`],
  [/^The display shows only the characters from space to ~ \(ASCII\)\.$/, () => 'Màn hình chỉ hiện được ký tự từ dấu cách tới ~ (ASCII): chữ không dấu, chữ số và ký hiệu.'],
  [/^(.+) must be between (.+) and (.+), not (.+)\.$/, (what, low, high, value) => `${capitalize(subject(what))} phải nằm trong khoảng ${low} tới ${high}, không phải ${value}.`],
  [/^(.+) must be between (.+) and (.+)\.$/, (what, low, high) => `${capitalize(subject(what))} phải nằm trong khoảng ${low} tới ${high}.`],
  [/^(.+) is outside the supported integer range \(±(.+)\)\.$/, (what, max) => `${capitalize(subject(what))} vượt quá khoảng số nguyên được hỗ trợ (±${max}).`],
  [/^Division by zero\.$/, () => 'Chia cho 0.'],
  // The board, its pins and its parts
  [/^The board has no pin "(.+)"\.$/, (pin) => `Bo mạch không có chân "${pin}".`],
  [/^This board has no (.+) for "(.+)"\.$/, (capability, type) => `Bo mạch này không có ${own(capabilities, capability) ?? capability} cho khối "${blockName(type)}".`],
  [/^This board has no (.+), so this block cannot be used\.$/, (capability) => `Bo mạch này không có ${own(capabilities, capability) ?? capability}, nên không dùng được khối này.`],
  [/^Only the pins P0, P1 and P2 can be used\.$/, () => 'Chỉ dùng được các chân P0, P1 và P2.'],
  [/^Pin (.+) cannot be used on this board\.$/, (pin) => `Không dùng được chân ${pin} trên bo mạch này.`],
  [/^A pin must be P0, P1 or P2, not (.+)\.$/, (pin) => `Chân phải là P0, P1 hoặc P2, không phải ${pin}.`],
  [/^A pin is set to 0 \(off\) or 1 \(on\), not (.+)\.$/, (level) => `Chân chỉ đặt được 0 (tắt) hoặc 1 (bật), không phải ${level}.`],
  [/^An analog reading is between 0 and (.+), not (.+)\.$/, (max, raw) => `Giá trị đọc tương tự nằm trong khoảng 0 tới ${max}, không phải ${raw}.`],
  [/^Pin (.+) is set by this program, so it cannot be read as well\.$/, (pin) => `Chân ${pin} đang được chương trình này đặt, nên không đọc được nữa.`],
  [/^Pin (.+) is not connected to anything, so it cannot be read\.$/, (pin) => `Chân ${pin} chưa nối với gì, nên không đọc được.`],
  [/^Pin (.+) is driven by two things at once, so it cannot be read\.$/, (pin) => `Chân ${pin} bị hai thứ cùng điều khiển, nên không đọc được.`],
  [/^Pin (.+) carries an analog level, which is neither on nor off\. Use "analog read"\.$/, (pin) => `Chân ${pin} mang mức tương tự, không phải bật hay tắt. Dùng "đọc tương tự".`],
  [/^Pin (.+) could not be read\.$/, (pin) => `Không đọc được chân ${pin}.`],
  [/^The circuit needs a board\.$/, () => 'Mạch cần có một bo mạch.'],
  [/^The circuit can have only one board\.$/, () => 'Mạch chỉ được có một bo mạch.'],
  [/^(.+) cannot be used in (.+)\.$/, (ids, where) => `Không dùng được ${ids} trong ${place(where)}.`],
  [/^The board could not be set up\.$/, () => 'Không khởi động được bo mạch.'],
  // Faults that only a broken program or a bug can cause: said plainly, the details kept.
  [/^The board is missing a part this block needs\.$/, () => 'Bo mạch thiếu bộ phận mà khối này cần.'],
  [/^The board does not have the capability this block needs\.$/, () => 'Bo mạch không có khả năng mà khối này cần.'],
  [/^A button block names a button that does not exist\.$/, () => 'Khối nút gọi một nút không tồn tại.'],
  [/^The board cannot count presses\.$/, () => 'Bo mạch không đếm được số lần nhấn.'],
  [/^The press count is not a whole number\.$/, () => 'Số lần nhấn không phải số nguyên.'],
  [/^The light level is not a whole number from 0 to 100\.$/, () => 'Mức ánh sáng không phải số nguyên từ 0 tới 100.'],
  [/^A variable has no value\.$/, () => 'Một biến chưa có giá trị.'],
  [/^A read gave another type than its block says\.$/, () => 'Một lần đọc trả về loại khác với khối của nó.'],
  [/^A note or rest has a length that does not exist\.$/, () => 'Khối nốt hoặc nghỉ có độ dài không tồn tại.'],
  [/^A text block was given another type\.$/, () => 'Khối chữ nhận một loại khác.'],
  [/^A number block was given another type\.$/, () => 'Khối số nhận một loại khác.'],
  [/^A note block names a note that does not exist\.$/, () => 'Khối nốt gọi một nốt không tồn tại.'],
  [/^This block is not known to the board\.$/, () => 'Bo mạch không biết khối này.'],
  [/^An int variable was given another type\.$/, () => 'Biến số nguyên nhận một loại khác.'],
  [/^A pin block was given the wrong number of values\.$/, () => 'Khối chân nhận sai số giá trị.'],
  [/^Expected an int, got (.+)\.$/, (type) => `Cần một số nguyên, nhận được ${type}.`],
  [/^Expected a bool, got (.+)\.$/, (type) => `Cần một giá trị đúng / sai, nhận được ${type}.`],
  [/^Cannot compare (.+) with (.+)\.$/, (a, b) => `Không so sánh được ${a} với ${b}.`],
  [/^Unexpected runtime error\.$/, () => 'Lỗi không mong đợi khi chạy.'],
];

/** The rules for the launch parser's problems (src/ui/app/launch.ts), most specific first. Exported for its tests. */
export const launchProblemRules: readonly Rule[] = [
  [/^A template opens only in an embedded lab: add embed=1\.$/, () => 'Mẫu bài chỉ mở trong lab nhúng: thêm embed=1.'],
  [/^embed must be given once, as embed=1\.$/, () => 'Tham số embed phải có đúng một lần, dạng embed=1.'],
  [/^lab must be given once\.$/, () => 'Tham số lab chỉ được có một lần.'],
  [/^Unknown lab "(.*)": use lab=blockly or lab=yolobit\.$/, (lab) => `Không có lab "${lab}": dùng lab=blockly hoặc lab=yolobit.`],
  [/^No template was given: add template=<key>\.$/, () => 'Chưa có mẫu bài: thêm template=<key>.'],
  [/^template must be given once\.$/, () => 'Tham số template chỉ được có một lần.'],
  [/^Unknown template "(.*)"\.$/, (key) => `Không có mẫu bài "${key}".`],
  [/^The template "(.*)" does not open in lab=(.+)\.$/, (key, lab) => `Mẫu bài "${key}" không mở trong lab=${lab}.`],
  [/^profile must be given once\.$/, () => 'Tham số profile chỉ được có một lần.'],
  [/^profile is only for lab=yolobit\.$/, () => 'Tham số profile chỉ dùng với lab=yolobit.'],
  [/^Unknown profile "(.*)": use (.+) or (.+)\.$/, (profile, a, b) => `Không có cấp độ "${profile}": dùng ${a} hoặc ${b}.`],
  [/^origin must be given once\.$/, () => 'Tham số origin chỉ được có một lần.'],
  [/^origin "(.*)" is not a page origin such as (.+)\.$/, (origin, example) => `origin "${origin}" không phải origin của một trang, ví dụ ${example}.`],
];

/** The index of the first rule that matches `message`, or -1. Exported for its tests. */
export function matchingRule(rules: readonly Rule[], message: string): number {
  return rules.findIndex(([pattern]) => pattern.test(message));
}

function translate(rules: readonly Rule[], message: string, locale: Locale): string {
  if (locale === 'en') {
    return message;
  }
  for (const [pattern, say] of rules) {
    const match = pattern.exec(message);
    if (match) {
      return say(...match.slice(1).map((part) => part ?? ''));
    }
  }
  return message;
}

/** A diagnostic or runtime error of the core in `locale`; English, or a sentence no rule knows, as it is. */
export const localizeCoreMessage = (message: string, locale: Locale): string => translate(coreMessageRules, message, locale);

/** A broken launch's problem (launch.ts) in `locale`; English, or a sentence no rule knows, as it is. */
export const localizeLaunchProblem = (problem: string, locale: Locale): string => translate(launchProblemRules, problem, locale);
```

**Create `src/ui/i18n/devices.ts`:**

```ts
import type { DeviceDefinition } from '../../core/devices/device-definition';
import { isMessageKey, translate, type Locale } from './messages';

// The names the canvas draws on a device, in the UI's language (N8s). A definition is core data, in English (B1);
// the canvas draws a copy with the device's name from the UI dictionary (`device.<id>`, as the palette says it) and
// the onboard parts' labels below. Ports keep their labels: pin names (P0, GND, D13) are the same in every language.

/** The labels of onboard parts (ybc-board.json), by the core's English label. A and B stay. */
export const viPartLabels: Readonly<Record<string, string>> = {
  Display: 'Màn hình',
  Light: 'Ánh sáng',
  Buzzer: 'Loa',
};

/** `definition` with the text the canvas draws in `locale`: the same object in English. */
export function localizeDeviceDefinition(definition: DeviceDefinition, locale: Locale): DeviceDefinition {
  if (locale === 'en') {
    return definition;
  }
  const key = `device.${definition.id}`;
  const name = isMessageKey(key) ? translate(locale, key) : definition.name;
  const board = definition.board;
  const onboard = board?.onboard;
  return {
    ...definition,
    name,
    ...(board && onboard
      ? {
          board: {
            ...board,
            onboard: onboard.map((part) => {
              const label = Object.hasOwn(viPartLabels, part.label) ? viPartLabels[part.label] : undefined;
              return label === undefined ? part : { ...part, label };
            }),
          },
        }
      : {}),
  };
}
```

**Replace in `src/ui/i18n/messages.ts` (1/3):**

```ts
// The strings of the lab's UI in its two languages (N6a S5). English is the standalone editor's, unchanged; a
// lab launched by an LMS (`lab=`) speaks Vietnamese (locale.ts). Every key exists in both, with the same
// `{name}` parameters (messages.test.ts). What the core says (compiler and runtime diagnostics) stays English:
// the core has no UI strings to translate (B1).

export type Locale = 'en' | 'vi';
```

with:

```ts
// The strings of the lab's UI in its two languages (N6a S5). English is the standalone editor's, unchanged; a
// lab launched by an LMS (`lab=`) speaks Vietnamese (locale.ts). Every key exists in both, with the same
// `{name}` parameters (messages.test.ts). What the core says (compiler and runtime diagnostics) is English in
// the core (B1); core-text.ts says it in Vietnamese for a Vietnamese UI (N8s).

export type Locale = 'en' | 'vi';
```

**Replace in `src/ui/i18n/messages.ts` (2/3):**

```ts
  'launch.title': 'This lab could not be opened.',
  'launch.supported': 'Supported templates: {keys}.',
  'palette.label': 'Add a device',
  'palette.add': 'Add {name}',
  'device.board': 'STEM Board',
  'device.ybc-board': 'Bit-compatible Board',
```

with:

```ts
  'launch.title': 'This lab could not be opened.',
  'launch.supported': 'Supported templates: {keys}.',
  'launch.detail': 'Technical detail (for whoever wrote the link)',
  'palette.label': 'Add a device',
  'palette.add': 'Add {name}',
  'canvas.label': 'Circuit canvas',
  'wire.duplicate-wire': 'These ports are already connected.',
  'wire.same-port': 'A wire needs two different ports.',
  'wire.rejected': 'That wire cannot be added.',
  'device.board': 'STEM Board',
  'device.ybc-board': 'Bit-compatible Board',
```

**Replace in `src/ui/i18n/messages.ts` (3/3):**

```ts
  'launch.title': 'Không mở được bài thực hành này.',
  'launch.supported': 'Các mẫu được hỗ trợ: {keys}.',
  'palette.label': 'Thêm linh kiện',
  'palette.add': 'Thêm {name}',
  'device.board': 'Bo mạch STEM',
  'device.ybc-board': 'Bo mạch tương thích Bit',
```

with:

```ts
  'launch.title': 'Không mở được bài thực hành này.',
  'launch.supported': 'Các mẫu được hỗ trợ: {keys}.',
  'launch.detail': 'Chi tiết kỹ thuật (cho người tạo đường dẫn)',
  'palette.label': 'Thêm linh kiện',
  'palette.add': 'Thêm {name}',
  'canvas.label': 'Khung vẽ mạch',
  'wire.duplicate-wire': 'Hai cổng này đã được nối.',
  'wire.same-port': 'Một dây cần hai cổng khác nhau.',
  'wire.rejected': 'Không thêm được dây đó.',
  'device.board': 'Bo mạch STEM',
  'device.ybc-board': 'Bo mạch tương thích Bit',
```

- [ ] **Step 4: Run the tests and the gate**

Run: `pnpm exec vitest run src/ui/i18n/core-text.test.ts src/ui/i18n/devices.test.ts src/ui/app/LaunchError.test.tsx`

Expected: `Test Files  3 passed (3)` (the scan test lists one case per core message: about 140 tests).

Run: `pnpm verify`

Expected: `Test Files  138 passed (138)`, `Tests  4536 passed | 1 skipped (4537)`.

Run: `E2E_PORT=5273 pnpm exec playwright test e2e/ybc-embed.spec.ts e2e/embed.spec.ts e2e/canvas.spec.ts`

Expected: `33 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/ui/i18n/core-text.ts src/ui/i18n/core-text.test.ts src/ui/i18n/devices.ts src/ui/i18n/devices.test.ts src/ui/i18n/messages.ts src/ui/app/RunToolbar.tsx src/ui/app/PythonPanel.tsx src/ui/app/LaunchError.tsx src/ui/app/LaunchError.test.tsx src/ui/canvas/CircuitCanvas.tsx src/ui/canvas/canvas-test-state.ts e2e/ybc-embed.spec.ts
git commit -m "$(cat <<'EOF'
feat(n8s): say the core's messages, launch problems and board labels in Vietnamese in lab launches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Fit a lab's circuit into its canvas (viewport scale and offset)  — `model: sonnet`

Ruling R5. `viewport.ts` đã là nơi duy nhất đổi stage ↔ world (B7) và đang là identity; nó nhận thêm `Viewport` (mặc định identity, nên mọi lời gọi cũ giữ nghĩa). `CircuitCanvas` nhận prop `fit`; `App` bật nó cho launch `lab=`.

**Files:**
- Modify: `src/ui/canvas/viewport.ts`, `src/ui/canvas/CircuitCanvas.tsx`, `src/ui/canvas/canvas-test-state.ts`, `src/ui/app/App.tsx`, `e2e/helpers.ts`
- Create: `src/ui/canvas/viewport.test.ts`, `e2e/lab-layout.spec.ts`

**Interfaces:**
- Consumes: `portWorldPosition` (core geometry), `DeviceRegistry`.
- Produces: `type Viewport = { scale: number; x: number; y: number }`, `identityViewport`, `stageToWorld(point, viewport = identityViewport)`, `stageToWorldDistance(pixels, viewport = identityViewport)`, `type Bounds`, `circuitBounds(circuit, registry): Bounds | null`, `fitViewport(bounds, size, { margin = 24, minScale = 0.4 } = {}): Viewport` (`viewport.ts`); `CircuitCanvas` prop `fit?: boolean`; `CanvasTestState.viewport`; `worldToPage` in `e2e/helpers.ts` now applies the viewport (Task 5 and 6 E2E use it).

- [ ] **Step 1: Write the failing tests**

**Replace in `e2e/helpers.ts` (1/2):**

```ts
}

/** World → page coordinates: the viewport is fixed, so world = stage = canvas pixels. */
export async function worldToPage(page: Page) {
  const box = await page.getByTestId('circuit-canvas').locator('canvas').first().boundingBox();
```

with:

```ts
}

/** World → page coordinates, through the stage's viewport (the identity in the standalone editor; a lab fits its circuit, N8s). */
export async function worldToPage(page: Page) {
  const box = await page.getByTestId('circuit-canvas').locator('canvas').first().boundingBox();
```

**Replace in `e2e/helpers.ts` (2/2):**

```ts
    throw new Error('The canvas is not visible');
  }
  return { box, at: (x: number, y: number) => ({ x: box.x + x, y: box.y + y }) };
}

```

with:

```ts
    throw new Error('The canvas is not visible');
  }
  const { viewport } = await canvasState(page);
  return { box, at: (x: number, y: number) => ({ x: box.x + viewport.x + x * viewport.scale, y: box.y + viewport.y + y * viewport.scale }) };
}

```

**Create `e2e/lab-layout.spec.ts`:**

```ts
import { expect, test, type Page } from '@playwright/test';
import { canvasState, worldToPage } from './helpers';

// N8s: how a lab launch (`lab=`) lays itself out in the frame of a lesson page: the circuit fitted into its
// canvas. (The standalone editor and the legacy S1 lab keep their layout; their E2E are unchanged.)

async function openLab(page: Page, query: string) {
  await page.goto(`/?embed=1&${query}`);
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
}

test.describe('a lab fits its circuit into the canvas', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('shows every port of the Blink circuit inside the canvas, never enlarged', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const { box, at } = await worldToPage(page);
    const { ports, viewport } = await canvasState(page);
    expect(viewport.scale).toBeLessThanOrEqual(1);
    for (const port of ports) {
      const shown = at(port.x, port.y);
      expect(shown.x, `${port.componentId}/${port.portId}`).toBeGreaterThan(box.x);
      expect(shown.x, `${port.componentId}/${port.portId}`).toBeLessThan(box.x + box.width);
      expect(shown.y, `${port.componentId}/${port.portId}`).toBeGreaterThan(box.y);
      expect(shown.y, `${port.componentId}/${port.portId}`).toBeLessThan(box.y + box.height);
    }
  });

  test('picks the port under the pointer at the fitted scale', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const { at } = await worldToPage(page);
    const anode = (await canvasState(page)).ports.find((port) => port.componentId === 'led' && port.portId === 'anode');
    if (!anode) {
      throw new Error('The LED has no anode port');
    }
    const shown = at(anode.x, anode.y);
    await page.mouse.move(shown.x + 3, shown.y + 2);
    await expect.poll(async () => (await canvasState(page)).highlightedPorts).toEqual([{ componentId: 'led', portId: 'anode' }]);
  });
});
```

**Create `src/ui/canvas/viewport.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import type { Circuit } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import blink from '../../samples/blink.project.json';
import { circuitBounds, fitViewport, identityViewport, stageToWorld, stageToWorldDistance } from './viewport';

const registry = createDeviceRegistry(localDeviceDefinitions);

describe('the viewport (B7, N8s)', () => {
  it('is the identity unless a viewport is given: the standalone editor is unchanged', () => {
    expect(stageToWorld({ x: 120, y: 45 })).toEqual({ x: 120, y: 45 });
    expect(stageToWorldDistance(12)).toBe(12);
  });

  it('converts stage pixels to world units through the scale and the offset', () => {
    const viewport = { scale: 0.5, x: 40, y: 10 };
    expect(stageToWorld({ x: 140, y: 60 }, viewport)).toEqual({ x: 200, y: 100 });
    expect(stageToWorldDistance(12, viewport)).toBe(24);
  });

  it('boxes every body and port of the Blink circuit', () => {
    // The board, 220×300 at (200, 220), and the LED, 40×70 at (600, 240), are the outermost (blink.project.json).
    expect(circuitBounds(blink.circuit as Circuit, registry)).toEqual({ left: 90, top: 70, right: 620, bottom: 370 });
  });

  it('has no box for a circuit without components', () => {
    expect(circuitBounds({ components: [], wires: [] }, registry)).toBeNull();
  });

  it('shrinks a circuit that does not fit, and centres it', () => {
    const viewport = fitViewport({ left: 80, top: 70, right: 640, bottom: 370 }, { width: 400, height: 500 });
    expect(viewport.scale).toBeCloseTo(352 / 560);
    // The middle of the box lands in the middle of the stage.
    expect(stageToWorld({ x: 200, y: 250 }, viewport)).toEqual({ x: 360, y: 220 });
  });

  it('never enlarges a circuit that fits; it only centres it', () => {
    const viewport = fitViewport({ left: 0, top: 0, right: 100, bottom: 100 }, { width: 800, height: 600 });
    expect(viewport).toEqual({ scale: 1, x: 350, y: 250 });
  });

  it('stops shrinking at the smallest readable scale', () => {
    expect(fitViewport({ left: 0, top: 0, right: 5000, bottom: 100 }, { width: 400, height: 400 }).scale).toBe(0.4);
  });

  it('is the identity without a circuit or without room', () => {
    expect(fitViewport(null, { width: 400, height: 400 })).toEqual(identityViewport);
    expect(fitViewport({ left: 0, top: 0, right: 10, bottom: 10 }, { width: 30, height: 400 })).toEqual(identityViewport);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/ui/canvas/viewport.test.ts`

Expected: FAIL — 7 of 8 tests, e.g. `AssertionError: expected { x: 140, y: 60 } to deeply equal { x: 200, y: 100 }` and `TypeError: circuitBounds is not a function`.

- [ ] **Step 3: Implement**

**Replace in `src/ui/app/App.tsx`:**

```tsx
      simulation={simulation}
      locked={running}
      onCircuitChange={editCircuit}
      // Runtime input, not an edit: the session ignores it unless running.
```

with:

```tsx
      simulation={simulation}
      locked={running}
      fit={lab !== null}
      onCircuitChange={editCircuit}
      // Runtime input, not an edit: the session ignores it unless running.
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (1/8):**

```tsx
import { rendererFor, type DeviceRendererProps } from './renderers';
import { useElementSize } from './use-element-size';
import { portPickRadiusPx, stageToWorld, stageToWorldDistance } from './viewport';
import { canvasPalette } from './colors';

```

with:

```tsx
import { rendererFor, type DeviceRendererProps } from './renderers';
import { useElementSize } from './use-element-size';
import { circuitBounds, fitViewport, identityViewport, portPickRadiusPx, stageToWorld, stageToWorldDistance } from './viewport';
import { canvasPalette } from './colors';

```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (2/8):**

```tsx
  /** While running: a contact (push button) is held closed, or released. Never a design edit. */
  onContactChange(componentId: string, closed: boolean): void;
};

```

with:

```tsx
  /** While running: a contact (push button) is held closed, or released. Never a design edit. */
  onContactChange(componentId: string, closed: boolean): void;
  /**
   * A lab launch (N8s): the circuit as it was loaded is shrunk, if needed, and centred to fit the canvas, and
   * fitted again when the canvas changes size, never when the circuit is edited. Absent: the identity viewport.
   */
  fit?: boolean;
};

```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (3/8):**

```tsx
  onCircuitChange,
  onContactChange,
}: CircuitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
```

with:

```tsx
  onCircuitChange,
  onContactChange,
  fit = false,
}: CircuitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  // The canvas is mounted again for every loaded project (App keys it), so this is the circuit as loaded.
  const [loadedBounds] = useState(() => (fit ? circuitBounds(circuit, registry) : null));
  const viewport = useMemo(() => (fit && size ? fitViewport(loadedBounds, size) : identityViewport), [fit, size, loadedBounds]);
  const pickRadius = stageToWorldDistance(portPickRadiusPx, viewport);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drag, setDrag] = useState<DragPreview | null>(null);
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (4/8):**

```tsx
      return null;
    }
    const point = stageToWorld(pointer);
    return { point, port: nearestPort(shown, registry, point, stageToWorldDistance(portPickRadiusPx)) };
  };

  const add = (deviceType: string) => {
    const middle = stageToWorld({ x: (size?.width ?? 0) / 2, y: (size?.height ?? 0) / 2 });
    const { circuit: next, componentId } = addComponent(circuit, deviceType, placementPosition(circuit, middle));
    onCircuitChange(next);
```

with:

```tsx
      return null;
    }
    const point = stageToWorld(pointer, viewport);
    return { point, port: nearestPort(shown, registry, point, pickRadius) };
  };

  const add = (deviceType: string) => {
    const middle = stageToWorld({ x: (size?.width ?? 0) / 2, y: (size?.height ?? 0) / 2 }, viewport);
    const { circuit: next, componentId } = addComponent(circuit, deviceType, placementPosition(circuit, middle));
    onCircuitChange(next);
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (5/8):**

```tsx
              width={size.width}
              height={size.height}
              onPointerDown={onStagePointerDown}
              onPointerUp={onStagePointerUp}
```

with:

```tsx
              width={size.width}
              height={size.height}
              scaleX={viewport.scale}
              scaleY={viewport.scale}
              x={viewport.x}
              y={viewport.y}
              onPointerDown={onStagePointerDown}
              onPointerUp={onStagePointerUp}
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (6/8):**

```tsx
                    definition={registry.get(component.deviceType)}
                    highlightedPorts={highlightedPorts}
                    onPointerDown={onPortPointerDown}
                  />
```

with:

```tsx
                    definition={registry.get(component.deviceType)}
                    highlightedPorts={highlightedPorts}
                    pickRadius={pickRadius}
                    onPointerDown={onPortPointerDown}
                  />
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (7/8):**

```tsx

/**
 * Each marker takes clicks in a circle of the pick radius around its port and
 * is drawn above bodies and wires. So a click near a port never reaches the
 * component under it (no drag starts), and nearestPort decides which port.
 */
function pickAreaHit(context: Context, shape: Shape) {
  context.beginPath();
  context.arc(0, 0, stageToWorldDistance(portPickRadiusPx), 0, Math.PI * 2, false);
  context.closePath();
  context.fillStrokeShape(shape);
}

type PortMarkersProps = ComponentProps & {
  highlightedPorts: PortRef[];
  onPointerDown(event: KonvaEventObject<PointerEvent>): void;
};

function PortMarkers({ component, definition, highlightedPorts, onPointerDown }: PortMarkersProps) {
  return definition.ports.map((port) => {
    const at = portWorldPosition(component, definition, port.id);
```

with:

```tsx

/**
 * Each marker takes clicks in a circle of the pick radius (world units) around
 * its port and is drawn above bodies and wires. So a click near a port never
 * reaches the component under it (no drag starts), and nearestPort decides which port.
 */
const pickAreaHit = (radius: number) => (context: Context, shape: Shape) => {
  context.beginPath();
  context.arc(0, 0, radius, 0, Math.PI * 2, false);
  context.closePath();
  context.fillStrokeShape(shape);
};

type PortMarkersProps = ComponentProps & {
  highlightedPorts: PortRef[];
  /** The pick radius in world units: the same screen distance at any scale. */
  pickRadius: number;
  onPointerDown(event: KonvaEventObject<PointerEvent>): void;
};

function PortMarkers({ component, definition, highlightedPorts, pickRadius, onPointerDown }: PortMarkersProps) {
  const hit = useMemo(() => pickAreaHit(pickRadius), [pickRadius]);
  return definition.ports.map((port) => {
    const at = portWorldPosition(component, definition, port.id);
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (8/8):**

```tsx
          stroke={highlighted ? canvasPalette.port.highlighted : canvasPalette.port.outline}
          strokeWidth={highlighted ? 2 : 1}
          hitFunc={pickAreaHit}
          onPointerDown={onPointerDown}
        />
```

with:

```tsx
          stroke={highlighted ? canvasPalette.port.highlighted : canvasPalette.port.outline}
          strokeWidth={highlighted ? 2 : 1}
          hitFunc={hit}
          onPointerDown={onPointerDown}
        />
```

**Replace in `src/ui/canvas/canvas-test-state.ts` (1/2):**

```ts
  /** The wire being drawn, from its port to the pointer; null when none is. */
  wirePreview: number[] | null;
};

```

with:

```ts
  /** The wire being drawn, from its port to the pointer; null when none is. */
  wirePreview: number[] | null;
  /** Stage pixels = world units × scale + offset (the identity unless a lab fits its circuit, N8s). */
  viewport: { scale: number; x: number; y: number };
};

```

**Replace in `src/ui/canvas/canvas-test-state.ts` (2/2):**

```ts
      .map((node) => ({ componentId: node.getAttr('componentId'), portId: node.getAttr('portId') })),
    wirePreview: stage.findOne<Konva.Line>('.wire-preview')?.points() ?? null,
  };
}
```

with:

```ts
      .map((node) => ({ componentId: node.getAttr('componentId'), portId: node.getAttr('portId') })),
    wirePreview: stage.findOne<Konva.Line>('.wire-preview')?.points() ?? null,
    viewport: { scale: stage.scaleX(), x: stage.x(), y: stage.y() },
  };
}
```

**Replace in `src/ui/canvas/viewport.ts`:**

```ts
import type { Point } from '../../core/circuit/document';

// The one place that converts between stage (pointer) coordinates and world
// coordinates (plan §5.1 B7). The viewport is fixed, so both conversions are
// the identity until pan/zoom (BL-E5) changes them here. Konva node positions
// are already world positions.

export function stageToWorld(point: Point): Point {
  return { x: point.x, y: point.y };
}

/** A distance on screen (stage pixels) in world units. */
export function stageToWorldDistance(pixels: number): number {
  return pixels;
}

/** A click this close to a port, in screen pixels, picks it (plan POC-10). */
export const portPickRadiusPx = 12;
```

with:

```ts
import type { Circuit, Point } from '../../core/circuit/document';
import { portWorldPosition } from '../../core/circuit/geometry';
import type { DeviceRegistry } from '../../core/devices/registry';

// The one place that converts between stage (pointer) coordinates and world
// coordinates (plan §5.1 B7). The standalone editor's viewport is the identity;
// a lab launch fits its circuit into the canvas (N8s): world = (stage − offset) / scale.
// There is still no pan or zoom by the user (BL-E5). Konva node positions are
// world positions: the stage carries the scale and the offset.

export type Viewport = { scale: number; x: number; y: number };

export const identityViewport: Viewport = { scale: 1, x: 0, y: 0 };

export function stageToWorld(point: Point, viewport: Viewport = identityViewport): Point {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale };
}

/** A distance on screen (stage pixels) in world units. */
export function stageToWorldDistance(pixels: number, viewport: Viewport = identityViewport): number {
  return pixels / viewport.scale;
}

/** A click this close to a port, in screen pixels, picks it (plan POC-10). */
export const portPickRadiusPx = 12;

export type Bounds = { left: number; top: number; right: number; bottom: number };

/** The box around every body and port of the circuit, in world units; null for a circuit without components. */
export function circuitBounds(circuit: Circuit, registry: DeviceRegistry): Bounds | null {
  let bounds: Bounds | null = null;
  const include = (x: number, y: number) => {
    bounds = bounds
      ? { left: Math.min(bounds.left, x), top: Math.min(bounds.top, y), right: Math.max(bounds.right, x), bottom: Math.max(bounds.bottom, y) }
      : { left: x, top: y, right: x, bottom: y };
  };
  for (const component of circuit.components) {
    const definition = registry.get(component.deviceType);
    const { x, y } = component.position;
    include(x - definition.body.width / 2, y - definition.body.height / 2);
    include(x + definition.body.width / 2, y + definition.body.height / 2);
    for (const port of definition.ports) {
      const at = portWorldPosition(component, definition, port.id);
      include(at.x, at.y);
    }
  }
  return bounds;
}

export type FitOptions = {
  /** Room left around the circuit, in screen pixels. */
  margin?: number;
  /** Below this the circuit is unreadable: it is cut off instead. */
  minScale?: number;
};

/**
 * The viewport that shows `bounds` whole, centred in a stage of `size`: shrunk when it does not fit, never
 * enlarged past 1 (bodies and the pick radius keep their size). The identity for no bounds or no room.
 */
export function fitViewport(
  bounds: Bounds | null,
  size: { width: number; height: number },
  { margin = 24, minScale = 0.4 }: FitOptions = {},
): Viewport {
  const roomWidth = size.width - 2 * margin;
  const roomHeight = size.height - 2 * margin;
  if (!bounds || roomWidth <= 0 || roomHeight <= 0) {
    return identityViewport;
  }
  const width = Math.max(bounds.right - bounds.left, 1);
  const height = Math.max(bounds.bottom - bounds.top, 1);
  const scale = Math.max(minScale, Math.min(1, roomWidth / width, roomHeight / height));
  return {
    scale,
    x: size.width / 2 - ((bounds.left + bounds.right) / 2) * scale,
    y: size.height / 2 - ((bounds.top + bounds.bottom) / 2) * scale,
  };
}
```

- [ ] **Step 4: Run the tests and the gate**

Run: `pnpm exec vitest run src/ui/canvas/viewport.test.ts`

Expected: `Tests  8 passed (8)`.

Run: `pnpm verify`

Expected: `Test Files  139 passed (139)`, `Tests  4544 passed | 1 skipped (4545)`.

Run: `E2E_PORT=5273 pnpm exec playwright test e2e/lab-layout.spec.ts e2e/canvas.spec.ts e2e/vs2-build.spec.ts e2e/push-button.spec.ts`

Expected: `19 passed` (the standalone canvas E2E are unchanged: identity viewport).

- [ ] **Step 5: Commit**

```bash
git add src/ui/canvas/viewport.ts src/ui/canvas/viewport.test.ts src/ui/canvas/CircuitCanvas.tsx src/ui/canvas/canvas-test-state.ts src/ui/app/App.tsx e2e/helpers.ts e2e/lab-layout.spec.ts
git commit -m "$(cat <<'EOF'
feat(n8s): fit a lab's circuit into its canvas (viewport scale and offset)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Lab workspace: program first, separator, fold, tabs below 800 px  — `model: opus`

Ruling R1–R4, R6, R7, R17. `App` dựng hai vùng như cũ (`boardRegion`, `programRegion`); launch `lab=` đặt chúng trong `LabWorkspace`, mọi launch khác trong `<main className="workspace">` cũ. `LabWorkspace` dùng `useSyncExternalStore` + `matchMedia('(max-width: 799px)')` để biết khi nào xếp tab (server snapshot `false`, nên unit test node vẫn render được). `showBoard` = `runEpoch` của `App` (tăng ở mỗi lần Chạy/Kiểm tra).

**Files:**
- Create: `src/ui/app/lab-layout.ts`, `src/ui/app/lab-layout.test.ts`, `src/ui/app/LabWorkspace.tsx`, `src/ui/blockly/fit.ts`, `src/ui/blockly/fit.test.ts`
- Modify: `src/ui/app/App.tsx`, `src/ui/app/app.css`, `src/ui/app/PythonPanel.tsx`, `src/ui/blockly/BlocklyPanel.tsx`, `src/ui/i18n/messages.ts`, `e2e/lab-layout.spec.ts`

**Interfaces:**
- Consumes: `CircuitCanvas` `fit` (Task 4), `worldToPage`/`canvasState` (Task 4), `useText` (`text.tsx`).
- Produces: `defaultBoardShare = 38`, `minBoardShare = 20`, `maxBoardShare = 65`, `boardShareStep = 5`, `stackedBelowPx = 800`, `stackedQuery`, `clampBoardShare`, `boardShareAt(clientX, left, width)`, `boardShareAfterKey(share, key)` (`lab-layout.ts`); `LabWorkspace({ board, program, showBoard }: { board: ReactNode; program: ReactNode; showBoard: number })`; `fittedScale`, `fitBlocksIntoView(workspace)`, `minFitScale = 0.6` (`fit.ts`); `BlocklyPanel` prop `fitOnLoad?: boolean`; `PythonPanel` props `collapsed?: boolean`, `onToggleCollapsed?(): void`; message keys `lab.panels`, `lab.resize`, `lab.hideBoard`, `lab.showBoard`, `python.show`, `python.hide`; `App` keeps `runEpoch` as the "show the circuit" signal (Task 6 relies on Kiểm tra bumping it).

- [ ] **Step 1: Write the failing tests**

**Replace in `e2e/lab-layout.spec.ts` (1/3):**

```ts
import { expect, test, type Page } from '@playwright/test';
import { canvasState, worldToPage } from './helpers';

// N8s: how a lab launch (`lab=`) lays itself out in the frame of a lesson page: the circuit fitted into its
// canvas. (The standalone editor and the legacy S1 lab keep their layout; their E2E are unchanged.)

async function openLab(page: Page, query: string) {
```

with:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { canvasState, worldToPage } from './helpers';

// N8s: how a lab launch (`lab=`) lays itself out in the frame of a lesson page: the program the wider part, a
// separator and a fold for the circuit, the circuit fitted into its canvas, the starter blocks in sight; in a
// frame narrower than 800 px, tabs. (The standalone editor and the legacy S1 lab keep their layout.)

async function openLab(page: Page, query: string) {
```

**Replace in `e2e/lab-layout.spec.ts` (2/3):**

```ts
  test.use({ viewport: { width: 1000, height: 640 } });

  test('shows every port of the Blink circuit inside the canvas, never enlarged', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const { box, at } = await worldToPage(page);
    const { ports, viewport } = await canvasState(page);
    expect(viewport.scale).toBeLessThanOrEqual(1);
    for (const port of ports) {
      const shown = at(port.x, port.y);
```

with:

```ts
  test.use({ viewport: { width: 1000, height: 640 } });

  test('shows every port of the Blink circuit inside the canvas, shrunk to fit the narrower circuit column', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const { box, at } = await worldToPage(page);
    const { ports, viewport } = await canvasState(page);
    expect(viewport.scale).toBeLessThan(1);
    for (const port of ports) {
      const shown = at(port.x, port.y);
```

**Replace in `e2e/lab-layout.spec.ts` (3/3):**

```ts
  });
});
```

with:

```ts
  });
});

/** The page box of `locator`, which must be on screen. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error('Not on screen');
  }
  return box;
}

/** Whether `inner` lies inside `outer`, whole. */
const inside = (inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** The block of the workspace (not the flyout) whose label is `label`. */
const workspaceBlock = (page: Page, label: string) =>
  page.getByTestId('blockly-panel').locator('.blocklyWorkspace > .blocklyBlockCanvas .blocklyDraggable', { has: page.locator('.blocklyText', { hasText: label }) }).first();

/** The page never scrolls: everything is inside the frame. */
const pageScrolls = (page: Page) => page.evaluate(() => document.scrollingElement !== null && document.scrollingElement.scrollHeight > window.innerHeight);

test.describe('a lab in a wide frame (1000 × 640, a lesson column)', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('gives the program the wider part, with the starter block in sight and nothing to scroll', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-heart&profile=ybc-basic');
    const program = await boxOf(page.getByTestId('program-region'));
    const circuit = await boxOf(page.getByRole('region', { name: 'Mạch' }));
    expect(program.width).toBeGreaterThan(circuit.width * 1.4);
    expect(inside(await boxOf(workspaceBlock(page, 'hiển thị hình')), await boxOf(page.getByTestId('blockly-panel')))).toBe(true);
    // The Python panel starts folded to its title bar; it opens on demand.
    await expect(page.getByTestId('python-source')).toHaveCount(0);
    await page.getByTestId('python-panel').getByRole('button', { name: 'Hiện' }).click();
    await expect(page.getByTestId('python-source')).toBeVisible();
    expect(await pageScrolls(page)).toBe(false);
  });

  test('moves the separator with the keyboard and the pointer', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const separator = page.getByRole('separator', { name: 'Đổi độ rộng của mạch và chương trình' });
    await expect(separator).toHaveAttribute('aria-valuenow', '38');
    const before = await boxOf(page.getByTestId('circuit-canvas'));

    await separator.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '48');
    await expect.poll(async () => (await boxOf(page.getByTestId('circuit-canvas'))).width).toBeGreaterThan(before.width + 80);
    await page.keyboard.press('Home');
    await expect(separator).toHaveAttribute('aria-valuenow', '20');

    const handle = await boxOf(separator);
    const workspace = await boxOf(page.getByTestId('lab-workspace'));
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
    await page.mouse.down();
    await page.mouse.move(workspace.x + workspace.width * 0.5, handle.y + 200, { steps: 5 });
    await page.mouse.up();
    await expect(separator).toHaveAttribute('aria-valuenow', '50');
  });

  test('folds the circuit away for the blocks, and unfolds it for a run', async ({ page }) => {
    await openLab(page, 'lab=blockly&template=blink');
    const width = (await boxOf(page.getByTestId('program-region'))).width;
    await page.getByRole('button', { name: 'Thu gọn mạch' }).click();
    await expect(page.getByRole('region', { name: 'Mạch' })).toBeHidden();
    await expect.poll(async () => (await boxOf(page.getByTestId('program-region'))).width).toBeGreaterThan(width + 300);

    await page.getByRole('button', { name: 'Chạy' }).click();
    await expect(page.getByRole('region', { name: 'Mạch' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thu gọn mạch' })).toBeVisible();
  });
});

test.describe('a lab whose starter is wider than its program column (820 × 600)', () => {
  test.use({ viewport: { width: 820, height: 600 } });

  test('shrinks the blocks until every one is in sight, and saves nothing for it', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-button-ab&profile=ybc-basic');
    const before = await page.evaluate(() => window.__stem?.getProject());
    const panel = await boxOf(page.getByTestId('blockly-panel'));
    const tops = page.getByTestId('blockly-panel').locator('.blocklyWorkspace > .blocklyBlockCanvas > .blocklyDraggable');
    expect(await tops.count()).toBe(3);
    for (const top of await tops.all()) {
      expect(inside(await boxOf(top), panel)).toBe(true);
    }
    // Only the view changed: the document is the template, as opened.
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__stem?.getProject())).toEqual(before);
  });
});

test.describe('a lab in a narrow frame (670 × 600, a tablet in portrait)', () => {
  test.use({ viewport: { width: 670, height: 600 } });

  test('shows the program or the circuit, in tabs, with nothing to scroll', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-heart&profile=ybc-basic');
    const programTab = page.getByRole('tab', { name: 'Chương trình' });
    const circuitTab = page.getByRole('tab', { name: 'Mạch' });
    await expect(programTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('program-region')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Mạch' })).toBeHidden();
    expect(inside(await boxOf(workspaceBlock(page, 'hiển thị hình')), await boxOf(page.getByTestId('blockly-panel')))).toBe(true);
    expect(await pageScrolls(page)).toBe(false);

    await circuitTab.click();
    await expect(circuitTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('program-region')).toBeHidden();
    const frame = { x: 0, y: 0, width: 670, height: 600 };
    expect(inside(await boxOf(page.getByTestId('circuit-canvas')), frame)).toBe(true);
    expect(inside(await boxOf(page.getByTestId('board-panel')), frame)).toBe(true);
    // The whole board is drawn inside its canvas.
    const { box, at } = await worldToPage(page);
    for (const port of (await canvasState(page)).ports) {
      const shown = at(port.x, port.y);
      expect(inside({ ...shown, width: 0, height: 0 }, box), `${port.componentId}/${port.portId}`).toBe(true);
    }
    expect(await pageScrolls(page)).toBe(false);
  });

  test('turns to the circuit when the program runs', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-heart&profile=ybc-basic');
    await page.getByRole('button', { name: 'Chạy' }).click();
    await expect(page.getByRole('tab', { name: 'Mạch' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('board-panel')).toBeVisible();
    // The starter prints nothing: the empty console takes no room from the workspace.
    await expect(page.getByTestId('run-status')).toHaveText('Đang chạy');
    await expect(page.getByTestId('console')).toBeHidden();
  });
});

test.describe('a frame that changes size (a tablet turned)', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('switches between the split and the tabs, keeping the blocks and the circuit', async ({ page }) => {
    await openLab(page, 'lab=yolobit&template=ybc-heart&profile=ybc-basic');
    await expect(page.getByRole('separator')).toBeVisible();

    await page.setViewportSize({ width: 670, height: 600 });
    await expect(page.getByRole('tab', { name: 'Chương trình' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('separator')).toHaveCount(0);
    await expect(workspaceBlock(page, 'hiển thị hình')).toBeVisible();
    await page.getByRole('tab', { name: 'Mạch' }).click();
    const { box, at } = await worldToPage(page);
    for (const port of (await canvasState(page)).ports) {
      expect(inside({ ...at(port.x, port.y), width: 0, height: 0 }, box), `${port.componentId}/${port.portId}`).toBe(true);
    }

    await page.setViewportSize({ width: 1000, height: 640 });
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByTestId('circuit-canvas')).toBeVisible();
    await expect(workspaceBlock(page, 'hiển thị hình')).toBeVisible();
    expect(await pageScrolls(page)).toBe(false);
  });
});

test.describe('outside a lab', () => {
  test.use({ viewport: { width: 1000, height: 640 } });

  test('keeps the standalone layout: no tabs, no separator, the circuit the wider part', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
    await expect(page.getByTestId('lab-workspace')).toHaveCount(0);
    await expect(page.getByRole('separator')).toHaveCount(0);
    const program = await boxOf(page.getByTestId('program-region'));
    const circuit = await boxOf(page.getByRole('region', { name: 'Circuit' }));
    expect(circuit.width).toBeGreaterThan(program.width);
    expect((await canvasState(page)).viewport).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
```

**Create `src/ui/app/lab-layout.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { boardShareAfterKey, boardShareAt, clampBoardShare, defaultBoardShare, maxBoardShare, minBoardShare, stackedQuery } from './lab-layout';

describe('the lab layout (N8s)', () => {
  it('gives the program the larger part at launch', () => {
    expect(defaultBoardShare).toBeLessThan(50);
  });

  it('keeps the circuit between its smallest and largest share, in whole percent', () => {
    expect(clampBoardShare(5)).toBe(minBoardShare);
    expect(clampBoardShare(90)).toBe(maxBoardShare);
    expect(clampBoardShare(41.6)).toBe(42);
  });

  it('follows the pointer across the workspace', () => {
    expect(boardShareAt(500, 100, 1000)).toBe(40);
    expect(boardShareAt(100, 100, 1000)).toBe(minBoardShare);
    expect(boardShareAt(1100, 100, 1000)).toBe(maxBoardShare);
    expect(boardShareAt(500, 100, 0)).toBe(defaultBoardShare);
  });

  it.each([
    ['ArrowLeft', 38, 33],
    ['ArrowRight', 38, 43],
    ['ArrowLeft', 22, minBoardShare],
    ['ArrowRight', 63, maxBoardShare],
    ['Home', 50, minBoardShare],
    ['End', 30, maxBoardShare],
  ])('moves the separator on %s from %i to %i', (key, from, to) => {
    expect(boardShareAfterKey(from, key)).toBe(to);
  });

  it('leaves other keys to the page', () => {
    expect(boardShareAfterKey(38, 'Enter')).toBeNull();
  });

  it('stacks the panels below 800 px', () => {
    expect(stackedQuery).toBe('(max-width: 799px)');
  });
});
```

**Create `src/ui/blockly/fit.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { fittedScale, minFitScale } from './fit';

describe('fittedScale (N8s)', () => {
  it('keeps the scale of a program that fits', () => {
    expect(fittedScale(1, { width: 300, height: 200 }, { width: 500, height: 400 })).toBe(1);
  });

  it('shrinks a program that is wider than the view, leaving a margin', () => {
    expect(fittedScale(1, { width: 468, height: 100 }, { width: 400, height: 400 })).toBeCloseTo(368 / 468);
  });

  it('never goes below the smallest readable scale', () => {
    expect(fittedScale(1, { width: 5000, height: 100 }, { width: 400, height: 400 })).toBe(minFitScale);
  });

  it('never enlarges, and leaves an empty workspace as it is', () => {
    expect(fittedScale(0.8, { width: 10, height: 10 }, { width: 400, height: 400 })).toBe(0.8);
    expect(fittedScale(1, { width: 0, height: 0 }, { width: 400, height: 400 })).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/ui/app/lab-layout.test.ts src/ui/blockly/fit.test.ts`

Expected: FAIL — `Error: Cannot find module './lab-layout'`, `Error: Cannot find module './fit'`.

- [ ] **Step 3: Implement**

**Replace in `src/ui/app/App.tsx` (1/4):**

```tsx
import { checkSessionOf, selectIsRunning, type RunStore } from '../state/run-store';
import { ChallengePanel, type CheckView } from './ChallengePanel';
import { PythonPanel } from './PythonPanel';
import { RunToolbar } from './RunToolbar';
```

with:

```tsx
import { checkSessionOf, selectIsRunning, type RunStore } from '../state/run-store';
import { ChallengePanel, type CheckView } from './ChallengePanel';
import { LabWorkspace } from './LabWorkspace';
import { PythonPanel } from './PythonPanel';
import { RunToolbar } from './RunToolbar';
```

**Replace in `src/ui/app/App.tsx` (2/4):**

```tsx
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // Counts Run clicks. The runtime controls start from their initial place in every run (inputs belong to a run, B2).
  const [runEpoch, setRunEpoch] = useState(0);
  // A notice about the project the app opened is gone once another one is
  // loaded (New); one about the session (no saving) stays until dismissed.
```

with:

```tsx
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // Counts Run clicks. The runtime controls start from their initial place in every run (inputs belong to a run, B2).
  // A lab also brings its circuit into sight on every new value (LabWorkspace `showBoard`, N8s).
  const [runEpoch, setRunEpoch] = useState(0);
  // A lab folds the Python panel to its title bar at launch: the blocks get the room (N8s).
  const [pythonCollapsed, setPythonCollapsed] = useState(true);
  // A notice about the project the app opened is gone once another one is
  // loaded (New); one about the session (no saving) stays until dismissed.
```

**Replace in `src/ui/app/App.tsx` (3/4):**

```tsx
  );

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>{lab ? t(`lab.title.${lab.kind}`) : t('app.title')}</h1>
```

with:

```tsx
  );

  const boardRegion = (
    <section className={isYbc ? 'canvas-region canvas-region-with-board-panel' : 'canvas-region'} aria-label={t('app.circuit')}>
      {isYbc ? (
        <>
          <div className="circuit-stage">
            {canvas}
            {potentiometerControls}
          </div>
          {/* What the board shows and takes, under the circuit; the run is the only source of both (B2). */}
          {board && (
            <div className="board-panel" data-testid="board-panel">
              <DisplayText display={partStateOf(simulation, board.id, displayPartId)} />
              <RuntimeControls
                key={running ? `run-${runEpoch}` : 'idle'}
                boardId={board.id}
                definition={registry.get(board.deviceType)}
                controls={context.profile?.controls ?? []}
                active={running}
                onInput={(componentId, input) => runStore.getState().setComponentInput(componentId, input)}
              />
              <SoundIndicator buzzer={partStateOf(simulation, board.id, buzzerPartId)} tones={tones} />
            </div>
          )}
        </>
      ) : (
        <>
          {canvas}
          {potentiometerControls}
        </>
      )}
    </section>
  );
  const pythonShown = context.family === 'ybc';
  const programRegion = (
    <section
      className={
        pythonShown ? (lab && pythonCollapsed ? 'program-region program-region-with-python program-region-python-collapsed' : 'program-region program-region-with-python') : 'program-region'
      }
      aria-label={t('app.program')}
      data-testid="program-region"
    >
      <BlocklyPanel ref={blocklyRef} projectStore={projectStore} packs={packs} toolbox={toolbox} fitOnLoad={lab !== null} />
      {/* Python exists for Yolo:Bit-compatible projects only (R-F5); a generic project has no panel. */}
      {pythonShown && (
        <PythonPanel
          key={loadRevision}
          document={document}
          registry={registry}
          profiles={profiles}
          packs={packs}
          flush={() => blocklyRef.current?.saveNow()}
          latestDocument={() => projectStore.getState().document}
          {...(lab ? { collapsed: pythonCollapsed, onToggleCollapsed: () => setPythonCollapsed(!pythonCollapsed) } : {})}
        />
      )}
    </section>
  );

  return (
    <div className={lab ? 'app-shell app-shell-lab' : 'app-shell'}>
      <header className="app-header">
        <h1>{lab ? t(`lab.title.${lab.kind}`) : t('app.title')}</h1>
```

**Replace in `src/ui/app/App.tsx` (4/4):**

```tsx
        )}
      </header>
      <main className="workspace">
        <section className={isYbc ? 'canvas-region canvas-region-with-board-panel' : 'canvas-region'} aria-label={t('app.circuit')}>
          {isYbc ? (
            <>
              <div className="circuit-stage">
                {canvas}
                {potentiometerControls}
              </div>
              {/* What the board shows and takes, under the circuit; the run is the only source of both (B2). */}
              {board && (
                <div className="board-panel" data-testid="board-panel">
                  <DisplayText display={partStateOf(simulation, board.id, displayPartId)} />
                  <RuntimeControls
                    key={running ? `run-${runEpoch}` : 'idle'}
                    boardId={board.id}
                    definition={registry.get(board.deviceType)}
                    controls={context.profile?.controls ?? []}
                    active={running}
                    onInput={(componentId, input) => runStore.getState().setComponentInput(componentId, input)}
                  />
                  <SoundIndicator buzzer={partStateOf(simulation, board.id, buzzerPartId)} tones={tones} />
                </div>
              )}
            </>
          ) : (
            <>
              {canvas}
              {potentiometerControls}
            </>
          )}
        </section>
        <section
          className={context.family === 'ybc' ? 'program-region program-region-with-python' : 'program-region'}
          aria-label={t('app.program')}
          data-testid="program-region"
        >
          <BlocklyPanel ref={blocklyRef} projectStore={projectStore} packs={packs} toolbox={toolbox} />
          {/* Python exists for Yolo:Bit-compatible projects only (R-F5); a generic project has no panel. */}
          {context.family === 'ybc' && (
            <PythonPanel
              key={loadRevision}
              document={document}
              registry={registry}
              profiles={profiles}
              packs={packs}
              flush={() => blocklyRef.current?.saveNow()}
              latestDocument={() => projectStore.getState().document}
            />
          )}
        </section>
      </main>
    </div>
  );
```

with:

```tsx
        )}
      </header>
      {lab ? (
        <LabWorkspace board={boardRegion} program={programRegion} showBoard={runEpoch} />
      ) : (
        <main className="workspace">
          {boardRegion}
          {programRegion}
        </main>
      )}
    </div>
  );
```

**Create `src/ui/app/LabWorkspace.tsx`:**

```tsx
import { useId, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useText } from '../i18n/text';
import { boardShareAfterKey, boardShareAt, defaultBoardShare, maxBoardShare, minBoardShare, stackedQuery } from './lab-layout';

// The workspace of a lab launch (N8s): the circuit and the program side by side, the program the wider, with a
// separator to move and a button to fold the circuit away; in a narrow frame, one of them at a time, in tabs.
// Both panels stay mounted (Blockly and Konva keep their state); the one out of sight is inert. A run or a
// check brings the circuit into sight (`showBoard`), so the learner sees what the program does.

type Panel = 'program' | 'board';

const subscribeStacked = (onChange: () => void) => {
  const query = window.matchMedia(stackedQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** Whether the frame is narrow enough to stack the panels; false where there is no window (unit tests). */
function useStacked(): boolean {
  return useSyncExternalStore(
    subscribeStacked,
    () => window.matchMedia(stackedQuery).matches,
    () => false,
  );
}

type LabWorkspaceProps = {
  board: ReactNode;
  program: ReactNode;
  /** Counts the runs and checks: every new value shows the circuit (its tab, or unfolds it). */
  showBoard: number;
};

export function LabWorkspace({ board, program, showBoard }: LabWorkspaceProps) {
  const t = useText();
  const stacked = useStacked();
  const id = useId();
  const [boardShare, setBoardShare] = useState(defaultBoardShare);
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Panel>('program');
  const [shownFor, setShownFor] = useState(showBoard);
  const workspaceRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  // A new run or check: the circuit comes into sight (state adjusted while rendering, not in an effect).
  if (showBoard !== shownFor) {
    setShownFor(showBoard);
    setTab('board');
    setCollapsed(false);
  }

  const onSeparatorKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = boardShareAfterKey(boardShare, event.key);
    if (next !== null) {
      event.preventDefault();
      setBoardShare(next);
    }
  };
  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = workspaceRef.current?.getBoundingClientRect();
    if (dragging.current && box) {
      setBoardShare(boardShareAt(event.clientX, box.left, box.width));
    }
  };
  const onSeparatorDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragging.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture for a pointer that is not active: the move and up events below still end the drag.
    }
  };
  const endDrag = () => {
    dragging.current = false;
  };

  const tabId = (panel: Panel) => `${id}-tab-${panel}`;
  const paneId = (panel: Panel) => `${id}-pane-${panel}`;
  const paneProps = (panel: Panel) => {
    const shown = stacked ? tab === panel : panel === 'program' || !collapsed;
    return {
      id: paneId(panel),
      className: `lab-pane lab-pane-${panel}`,
      'data-shown': shown,
      inert: !shown,
      ...(stacked ? { role: 'tabpanel', 'aria-labelledby': tabId(panel) } : {}),
    };
  };
  const className = ['lab-workspace', !stacked && collapsed ? 'lab-workspace-collapsed' : ''].filter(Boolean).join(' ');

  return (
    <main
      ref={workspaceRef}
      className={className}
      data-layout={stacked ? 'tabs' : 'split'}
      data-testid="lab-workspace"
      style={{ '--lab-board-share': `${boardShare}%` } as CSSProperties}
    >
      {stacked && (
        <div className="lab-tabs" role="tablist" aria-label={t('lab.panels')}>
          {(['program', 'board'] as const).map((panel) => (
            <button
              key={panel}
              type="button"
              role="tab"
              id={tabId(panel)}
              aria-selected={tab === panel}
              aria-controls={paneId(panel)}
              onClick={() => setTab(panel)}
            >
              {t(panel === 'program' ? 'app.program' : 'app.circuit')}
            </button>
          ))}
        </div>
      )}
      <div {...paneProps('board')}>{board}</div>
      {!stacked && (
        <div className="lab-gutter">
          <button
            type="button"
            className="lab-collapse"
            aria-expanded={!collapsed}
            aria-controls={paneId('board')}
            aria-label={collapsed ? t('lab.showBoard') : t('lab.hideBoard')}
            title={collapsed ? t('lab.showBoard') : t('lab.hideBoard')}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? '›' : '‹'}
          </button>
          {!collapsed && (
            <div
              className="lab-separator"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('lab.resize')}
              aria-controls={paneId('board')}
              aria-valuenow={boardShare}
              aria-valuemin={minBoardShare}
              aria-valuemax={maxBoardShare}
              tabIndex={0}
              data-testid="lab-separator"
              onKeyDown={onSeparatorKey}
              onPointerDown={onSeparatorDown}
              onPointerMove={followPointer}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
            />
          )}
        </div>
      )}
      <div {...paneProps('program')}>{program}</div>
    </main>
  );
}
```

**Replace in `src/ui/app/PythonPanel.tsx` (1/3):**

```tsx
  /** The document in the store, read at the moment of the call. */
  latestDocument(): ProjectView;
};

```

with:

```tsx
  /** The document in the store, read at the moment of the call. */
  latestDocument(): ProjectView;
  /** A lab launch (N8s): the panel can be folded to its title bar, to leave the blocks the room. */
  collapsed?: boolean;
  onToggleCollapsed?(): void;
};

```

**Replace in `src/ui/app/PythonPanel.tsx` (2/3):**

```tsx
const copyKey = () => (/Mac|iPhone|iPad/.test(window.navigator.platform) ? 'Cmd+C' : 'Ctrl+C');

export function PythonPanel({ document, registry, profiles, packs, flush, latestDocument }: PythonPanelProps) {
  const [generation, setGeneration] = useState<DocumentGeneration | null>(() => generateForDocument(document, registry, profiles, packs));
  const { profile, circuit, program } = document;
```

with:

```tsx
const copyKey = () => (/Mac|iPhone|iPad/.test(window.navigator.platform) ? 'Cmd+C' : 'Ctrl+C');

export function PythonPanel({ document, registry, profiles, packs, flush, latestDocument, collapsed = false, onToggleCollapsed }: PythonPanelProps) {
  const [generation, setGeneration] = useState<DocumentGeneration | null>(() => generateForDocument(document, registry, profiles, packs));
  const { profile, circuit, program } = document;
```

**Replace in `src/ui/app/PythonPanel.tsx` (3/3):**

```tsx

  return (
    <section className="python-panel" aria-label="Python" data-testid="python-panel">
      <header className="python-panel-header">
        <h2>Python</h2>
        <button type="button" onClick={() => void copySource()} disabled={!generation.ok}>
          {copy === 'copied' ? t('python.copied') : t('python.copy')}
        </button>
        <button type="button" onClick={download} disabled={!generation.ok}>
          {t('python.download')}
        </button>
      </header>
      <p className="python-copy-status" role="status" data-testid="python-copy-status">
        {copy === 'failed' && generation.ok ? t('python.copyFailed', { key: copyKey() }) : ''}
      </p>
      {generation.ok ? (
        <>
          <p className="python-claim" data-testid="python-claim">
            {t('python.claim')}
          </p>
          <pre ref={sourceRef} className="python-source" data-testid="python-source" tabIndex={0}>
            {lines.map((line, index) => (
              <span key={index} className="python-line">
                {line}
                {'\n'}
              </span>
            ))}
          </pre>
        </>
      ) : (
        <div className="python-blocked" role="status" data-testid="python-diagnostics">
          <p>{t(`python.layer.${generation.layer}`)}</p>
          <ul>
            {generation.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: localizeCoreMessage(diagnostic.message, locale) })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
```

with:

```tsx

  return (
    <section className={collapsed ? 'python-panel python-panel-collapsed' : 'python-panel'} aria-label="Python" data-testid="python-panel">
      <header className="python-panel-header">
        <h2>Python</h2>
        {onToggleCollapsed && (
          <button type="button" aria-expanded={!collapsed} onClick={onToggleCollapsed}>
            {collapsed ? t('python.show') : t('python.hide')}
          </button>
        )}
        {!collapsed && (
          <>
            <button type="button" onClick={() => void copySource()} disabled={!generation.ok}>
              {copy === 'copied' ? t('python.copied') : t('python.copy')}
            </button>
            <button type="button" onClick={download} disabled={!generation.ok}>
              {t('python.download')}
            </button>
          </>
        )}
      </header>
      {!collapsed && (
        <>
          <p className="python-copy-status" role="status" data-testid="python-copy-status">
            {copy === 'failed' && generation.ok ? t('python.copyFailed', { key: copyKey() }) : ''}
          </p>
          {generation.ok ? (
            <>
              <p className="python-claim" data-testid="python-claim">
                {t('python.claim')}
              </p>
              <pre ref={sourceRef} className="python-source" data-testid="python-source" tabIndex={0}>
                {lines.map((line, index) => (
                  <span key={index} className="python-line">
                    {line}
                    {'\n'}
                  </span>
                ))}
              </pre>
            </>
          ) : (
            <div className="python-blocked" role="status" data-testid="python-diagnostics">
              <p>{t(`python.layer.${generation.layer}`)}</p>
              <ul>
                {generation.diagnostics.map((diagnostic, index) => (
                  <li key={index}>
                    {t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: localizeCoreMessage(diagnostic.message, locale) })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
```

**Replace in `src/ui/app/app.css`:**

```css
  }
}
```

with:

```css
  }
}

/*
 * The workspace of a lab launch (N8s): circuit | gutter | program, the program the wider; the gutter holds the
 * button that folds the circuit away and the separator that resizes it. In a narrow frame the two panels share
 * one cell and tabs choose the one in sight; the other keeps its size (Blockly and Konva keep their layout).
 */
.lab-workspace {
  display: grid;
  grid-template-columns: minmax(0, var(--lab-board-share, 38%)) 14px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
}

.lab-workspace-collapsed {
  grid-template-columns: 0 14px minmax(0, 1fr);
}

.lab-pane {
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.lab-pane[data-shown='false'] {
  visibility: hidden;
}

.lab-pane > .program-region {
  border-left: 0;
}

.lab-gutter {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  border-left: 1px solid var(--stem-color-border);
  border-right: 1px solid var(--stem-color-border);
  background: var(--stem-color-surface-muted);
}

.lab-collapse {
  height: 32px;
  padding: 0;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  border: 0;
  border-bottom: 1px solid var(--stem-color-border);
  background: transparent;
  color: var(--stem-color-text-muted);
  cursor: pointer;
}

.lab-separator {
  flex: 1;
  cursor: col-resize;
  touch-action: none;
}

.lab-separator:hover,
.lab-separator:focus-visible {
  background: var(--stem-color-neutral-soft);
}

.lab-collapse:focus-visible,
.lab-separator:focus-visible,
.lab-tabs [role='tab']:focus-visible {
  outline: 3px solid var(--stem-color-primary);
  outline-offset: -3px;
}

.lab-workspace[data-layout='tabs'] {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}

.lab-workspace[data-layout='tabs'] .lab-pane {
  grid-row: 2;
  grid-column: 1;
}

.lab-tabs {
  display: flex;
  gap: 4px;
  padding: 4px 12px 0;
  border-bottom: 1px solid var(--stem-color-border);
  background: var(--stem-color-surface);
}

.lab-tabs [role='tab'] {
  min-height: 36px;
  padding: 4px 16px;
  font: inherit;
  font-size: 14px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: transparent;
  color: var(--stem-color-text-muted);
  cursor: pointer;
}

.lab-tabs [role='tab'][aria-selected='true'] {
  border-bottom-color: var(--stem-color-primary);
  color: var(--stem-color-text);
  font-weight: 600;
}

/* A lab's header shows the console once there is something in it: an empty one only pushes the workspace down. */
.app-shell-lab .run-console:has(> pre:empty):not(:has(.run-console-hidden)) {
  display: none;
}

/* A lab folds its Python panel to the title bar: the blocks take the room. */
.program-region-python-collapsed .blockly-panel {
  bottom: 34px;
}

.program-region-python-collapsed .python-panel {
  inset: auto 0 0;
  height: 34px;
}

.python-panel-collapsed .python-panel-header {
  height: 34px;
  box-sizing: border-box;
  border-bottom: 0;
}
```

**Create `src/ui/app/lab-layout.ts`:**

```ts
// How a lab launch shares the frame between the circuit and the program (N8s). The program gets the larger
// part: a lab is mostly block programming, and the starter blocks must be in sight. Nothing is stored: a lab
// keeps nothing in the browser (S1), so every launch starts from these defaults.

/** The circuit's share of a wide lab's width, in percent, at launch; the program takes the rest. */
export const defaultBoardShare = 38;
export const minBoardShare = 20;
export const maxBoardShare = 65;
/** One step of the separator's arrow keys, in percent. */
export const boardShareStep = 5;

/** Narrower than this, a lab shows one panel at a time, in tabs (a tablet in portrait, a narrow lesson column). */
export const stackedBelowPx = 800;
export const stackedQuery = `(max-width: ${stackedBelowPx - 1}px)`;

export const clampBoardShare = (share: number) => Math.min(maxBoardShare, Math.max(minBoardShare, Math.round(share)));

/** The circuit's share for a pointer at `clientX` over a workspace from `left`, `width` wide: the circuit is on the left. */
export function boardShareAt(clientX: number, left: number, width: number): number {
  return width > 0 ? clampBoardShare(((clientX - left) / width) * 100) : defaultBoardShare;
}

/** The circuit's share after a key on the separator (WAI-ARIA window splitter); null for a key it does not take. */
export function boardShareAfterKey(share: number, key: string): number | null {
  switch (key) {
    case 'ArrowLeft':
      return clampBoardShare(share - boardShareStep);
    case 'ArrowRight':
      return clampBoardShare(share + boardShareStep);
    case 'Home':
      return minBoardShare;
    case 'End':
      return maxBoardShare;
    default:
      return null;
  }
}
```

**Replace in `src/ui/blockly/BlocklyPanel.tsx` (1/4):**

```tsx
import type { ProjectStore } from '../state/project-store';
import { registerBlocks, ybcVariablesFlyout } from './editor-blocks';
import { blocklyMediaUrl } from './media';
import { stemTheme } from './theme';
```

with:

```tsx
import type { ProjectStore } from '../state/project-store';
import { registerBlocks, ybcVariablesFlyout } from './editor-blocks';
import { fitBlocksIntoView } from './fit';
import { blocklyMediaUrl } from './media';
import { stemTheme } from './theme';
```

**Replace in `src/ui/blockly/BlocklyPanel.tsx` (2/4):**

```tsx
  /** What the learner sees, from the board context. Must be stable: a new one would rebuild the workspace. */
  toolbox: Toolbox;
  ref?: Ref<BlocklyPanelHandle>;
};

export function BlocklyPanel({ projectStore, packs, toolbox, ref }: BlocklyPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const saveNowRef = useRef<() => void>(() => {});
```

with:

```tsx
  /** What the learner sees, from the board context. Must be stable: a new one would rebuild the workspace. */
  toolbox: Toolbox;
  /** A lab launch (N8s): every loaded program is shrunk, if needed, so that all its blocks are in sight. */
  fitOnLoad?: boolean;
  ref?: Ref<BlocklyPanelHandle>;
};

export function BlocklyPanel({ projectStore, packs, toolbox, fitOnLoad = false, ref }: BlocklyPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const saveNowRef = useRef<() => void>(() => {});
```

**Replace in `src/ui/blockly/BlocklyPanel.tsx` (3/4):**

```tsx
    if (typeof blocks === 'object' && blocks !== null) {
      Blockly.serialization.workspaces.load(blocks, workspace);
    }

```

with:

```tsx
    if (typeof blocks === 'object' && blocks !== null) {
      Blockly.serialization.workspaces.load(blocks, workspace);
    }
    if (fitOnLoad) {
      fitBlocksIntoView(workspace);
    }

```

**Replace in `src/ui/blockly/BlocklyPanel.tsx` (4/4):**

```tsx
      workspace.dispose();
    };
  }, [loadRevision, projectStore, packs, toolbox]);

  return <div ref={containerRef} className="blockly-panel" data-testid="blockly-panel" />;
```

with:

```tsx
      workspace.dispose();
    };
  }, [loadRevision, projectStore, packs, toolbox, fitOnLoad]);

  return <div ref={containerRef} className="blockly-panel" data-testid="blockly-panel" />;
```

**Create `src/ui/blockly/fit.ts`:**

```ts
import type * as Blockly from 'blockly';

// A lab's program in sight (N8s): the starter blocks of a lab are placed for a wide frame (R6), and a narrow
// program column would show only part of them. This only changes the view (scale and scroll), which Blockly
// never serializes: the document, and so the host's copy of it, stays as it was.

/** Smaller than this the blocks are hard to read: the learner scrolls to the rest instead. */
export const minFitScale = 0.6;
/** Room left around the blocks, in pixels. */
const margin = 16;

/** The scale that shows a `contentWidth` × `contentHeight` (workspace units) program in a `viewWidth` × `viewHeight` view: never larger than `scale`. */
export function fittedScale(scale: number, content: { width: number; height: number }, view: { width: number; height: number }): number {
  if (content.width <= 0 || content.height <= 0) {
    return scale;
  }
  const room = Math.min((view.width - 2 * margin) / content.width, (view.height - 2 * margin) / content.height);
  return Math.max(minFitScale, Math.min(scale, room));
}

/** Shrinks the workspace, if needed, so that every block is in sight, and brings the blocks into the view. */
export function fitBlocksIntoView(workspace: Blockly.WorkspaceSvg): void {
  const box = workspace.getBlocksBoundingBox();
  const content = { width: box.right - box.left, height: box.bottom - box.top };
  const view = workspace.getMetricsManager().getViewMetrics();
  const scale = fittedScale(workspace.scale, content, view);
  const fits = content.width * workspace.scale + 2 * margin <= view.width && content.height * workspace.scale + 2 * margin <= view.height;
  if (fits || content.width <= 0) {
    return;
  }
  workspace.setScale(scale);
  workspace.scrollBoundsIntoView(box, margin);
}
```

**Replace in `src/ui/i18n/messages.ts` (1/4):**

```ts
  'python.copied': 'Copied',
  'python.download': 'Download',
  'python.copyFailed': 'Copy failed. Press {key} to copy the selected code.',
  'python.claim': 'Generated for Yolo:Bit MicroPython. MicroPython syntax validation: pending. Physical-board verification: pending.',
```

with:

```ts
  'python.copied': 'Copied',
  'python.download': 'Download',
  'python.show': 'Show',
  'python.hide': 'Hide',
  'python.copyFailed': 'Copy failed. Press {key} to copy the selected code.',
  'python.claim': 'Generated for Yolo:Bit MicroPython. MicroPython syntax validation: pending. Physical-board verification: pending.',
```

**Replace in `src/ui/i18n/messages.ts` (2/4):**

```ts
  'lab.resetConfirm': 'Click again to reset',
  'lab.goals': 'Goals',
  'lab.goal.todo': 'not checked yet',
  'lab.goal.passed': 'met',
```

with:

```ts
  'lab.resetConfirm': 'Click again to reset',
  'lab.goals': 'Goals',
  'lab.panels': 'Lab panels',
  'lab.resize': 'Resize the circuit and the program',
  'lab.hideBoard': 'Fold the circuit away',
  'lab.showBoard': 'Show the circuit',
  'lab.goal.todo': 'not checked yet',
  'lab.goal.passed': 'met',
```

**Replace in `src/ui/i18n/messages.ts` (3/4):**

```ts
  'python.copied': 'Đã chép',
  'python.download': 'Tải xuống',
  'python.copyFailed': 'Không sao chép được. Nhấn {key} để chép đoạn mã đã chọn.',
  'python.claim': 'Sinh cho Yolo:Bit MicroPython. Kiểm tra cú pháp MicroPython: chưa làm. Kiểm tra trên bo mạch thật: chưa làm.',
```

with:

```ts
  'python.copied': 'Đã chép',
  'python.download': 'Tải xuống',
  'python.show': 'Hiện',
  'python.hide': 'Ẩn',
  'python.copyFailed': 'Không sao chép được. Nhấn {key} để chép đoạn mã đã chọn.',
  'python.claim': 'Sinh cho Yolo:Bit MicroPython. Kiểm tra cú pháp MicroPython: chưa làm. Kiểm tra trên bo mạch thật: chưa làm.',
```

**Replace in `src/ui/i18n/messages.ts` (4/4):**

```ts
  'lab.resetConfirm': 'Bấm lần nữa để đặt lại',
  'lab.goals': 'Mục tiêu',
  'lab.goal.todo': 'chưa kiểm tra',
  'lab.goal.passed': 'đạt',
```

with:

```ts
  'lab.resetConfirm': 'Bấm lần nữa để đặt lại',
  'lab.goals': 'Mục tiêu',
  'lab.panels': 'Các phần của bài thực hành',
  'lab.resize': 'Đổi độ rộng của mạch và chương trình',
  'lab.hideBoard': 'Thu gọn mạch',
  'lab.showBoard': 'Hiện mạch',
  'lab.goal.todo': 'chưa kiểm tra',
  'lab.goal.passed': 'đạt',
```

- [ ] **Step 4: Run the tests and the gate**

Run: `pnpm exec vitest run src/ui/app/lab-layout.test.ts src/ui/blockly/fit.test.ts`

Expected: `Test Files  2 passed (2)`.

Run: `pnpm verify`

Expected: `Test Files  141 passed (141)`, `Tests  4565 passed | 1 skipped (4566)`.

Run: `E2E_PORT=5273 pnpm exec playwright test e2e/lab-layout.spec.ts e2e/ybc-embed.spec.ts e2e/ybc-python.spec.ts`

Expected: `33 passed` (lab-layout 10, ybc-embed 10 — its message order unchanged —, ybc-python 13 with the standalone Python panel as before).

- [ ] **Step 5: Commit**

```bash
git add src/ui/app/lab-layout.ts src/ui/app/lab-layout.test.ts src/ui/app/LabWorkspace.tsx src/ui/blockly/fit.ts src/ui/blockly/fit.test.ts src/ui/app/App.tsx src/ui/app/app.css src/ui/app/PythonPanel.tsx src/ui/blockly/BlocklyPanel.tsx src/ui/i18n/messages.ts e2e/lab-layout.spec.ts
git commit -m "$(cat <<'EOF'
feat(n8s): lab workspace: program first, separator, fold, tabs below 800 px; starter blocks in sight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: A visible check: virtual presses drawn, last frame held, progress  — `model: opus`

Ruling R8, R9. Core không đổi: `runCheck` vẫn nhận một `CheckSession`; adapter của UI (`checkSessionOf`) báo cho `App` mỗi input của kịch bản (`onInput`) và snapshot ngay trước khi kiểm tra dừng lượt chạy (`beforeStop`). `App` giữ `scriptedInputs` trong lúc kiểm tra và `final` (simulation cuối) trong kết quả; khung cuối chỉ hiện khi không chạy và document vẫn là document đã kiểm tra.

**Files:**
- Modify: `src/ui/state/run-store.ts`, `src/ui/state/run-store.test.ts`, `src/ui/runtime-controls/RuntimeControls.tsx`, `src/ui/runtime-controls/RuntimeControls.test.tsx`, `src/ui/canvas/renderers.ts`, `src/ui/canvas/CircuitCanvas.tsx`, `src/ui/canvas/YbcBoardRenderer.tsx`, `src/ui/canvas/colors.ts`, `src/ui/canvas/canvas-test-state.ts`, `src/ui/canvas/ybc-board-renderer.test.tsx`, `src/ui/app/App.tsx`, `src/ui/app/app.css`, `src/ui/i18n/messages.ts`
- Create: `e2e/lab-check.spec.ts`

**Interfaces:**
- Consumes: `runCheck`, `CheckSession` (core, unchanged), `LabWorkspace` `showBoard` (Task 5: `startCheck` bumps `runEpoch`), `CanvasTestState` (Tasks 3–4).
- Produces: `type CheckObserver = { onInput?(componentId, input): void; beforeStop?(snapshot: RunSnapshot): void }`, `checkSessionOf(runStore, observer = {})` (`run-store.ts`); `RuntimeControls` prop `scripted?: Readonly<Record<string, ComponentInput>>`; `DeviceRendererProps.partInputs`; `CircuitCanvas` props `inputs?`, `overlay?: ReactNode`; `partInputsOf(inputs, componentId, definition)`; `canvasPalette.ybcBoard.pressed`; `CanvasTestState.components[].pressedParts?: string[]`, `.lightLevel?: number`; message keys `lab.check.running`, `lab.check.held`.

- [ ] **Step 1: Write the failing tests**

**Create `e2e/lab-check.spec.ts`:**

```ts
import { expect, test, type Page } from '@playwright/test';
import { ybcImages } from '../src/samples/ybc-templates';
import { ybcSolutionDocument, type YbcLessonKey } from '../src/samples/ybc-solutions';

// N8s: Kiểm tra runs the program where the learner can see it: the board the canvas draws is the run the check
// judges, the virtual presses of the challenge are drawn (the board's buttons, the controls, the light level),
// and the board keeps the check's last frame afterwards, until the next run or edit.

type Seen = { display: string | null; pressed: string[]; light: number | undefined; controls: string[]; overlay: string | null };

/** What the learner sees now: the display as drawn (# lit), the parts drawn pressed, the controls shown pressed. */
const seen = (page: Page): Promise<Seen> =>
  page.evaluate(() => {
    const board = window.__stem?.getCanvasState()?.components.find((component) => component.display);
    return {
      display: board?.display ? board.display.map((pixel) => (pixel ? '1' : '0')).join('') : null,
      pressed: board?.pressedParts ?? [],
      light: board?.lightLevel,
      controls: [...document.querySelectorAll('[data-testid^="control-"][aria-pressed="true"]')].map((element) => element.getAttribute('data-testid') ?? ''),
      overlay: document.querySelector('[data-testid="check-overlay"]')?.getAttribute('data-state') ?? null,
    };
  });

/** The 25 cells of a template image as `seen` writes them. */
const cells = (frame: string) => frame.replaceAll(':', '');

async function openSolved(page: Page, key: YbcLessonKey) {
  await page.goto(`/?embed=1&lab=yolobit&template=${key}`);
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
  await page.evaluate((document) => window.__stem?.loadProject(document), ybcSolutionDocument(key));
}

/** Samples what the learner sees every 50 ms while the check runs, until it has a result. */
async function watchCheck(page: Page): Promise<Seen[]> {
  const frames: Seen[] = [];
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  const status = page.getByTestId('challenge-status');
  while (!/^(Đạt|Chưa đạt)/.test((await status.textContent()) ?? '')) {
    frames.push(await seen(page));
    await page.waitForTimeout(50);
  }
  return frames;
}

test.use({ viewport: { width: 1000, height: 640 } });

test('Button A/B: the check presses A then B on the board and the controls, and the board shows ✓ then ✗', async ({ page }) => {
  await openSolved(page, 'ybc-button-ab');
  const frames = await watchCheck(page);

  expect(frames.some((frame) => frame.overlay === 'running')).toBe(true);
  const pressedA = frames.find((frame) => frame.pressed.includes('button-a'));
  const pressedB = frames.find((frame) => frame.pressed.includes('button-b'));
  expect(pressedA?.controls).toEqual(['control-button-a']);
  expect(pressedB?.controls).toEqual(['control-button-b']);
  expect(frames.indexOf(pressedA as Seen)).toBeLessThan(frames.indexOf(pressedB as Seen));
  expect(frames.some((frame) => frame.display === cells(ybcImages.check))).toBe(true);
  expect(frames.some((frame) => frame.display === cells(ybcImages.cross))).toBe(true);

  // The result, and the board as the check left it (✗), held until the next run.
  await expect(page.getByTestId('challenge-status')).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.');
  await expect(page.getByTestId('run-status')).toHaveText('Chưa chạy');
  await expect.poll(() => seen(page)).toEqual({ display: cells(ybcImages.cross), pressed: [], light: undefined, controls: [], overlay: 'held' });
  await expect(page.getByTestId('display-text')).toContainText('#...#');
  await page.getByRole('button', { name: 'Chạy' }).click();
  await expect.poll(async () => (await seen(page)).overlay).toBeNull();
});

test('Night light: the check slides the light down then up, and the board lights then goes dark', async ({ page }) => {
  await openSolved(page, 'ybc-night-light');
  const frames = await watchCheck(page);

  expect(frames.some((frame) => frame.light === 10 && frame.display === cells(ybcImages.full))).toBe(true);
  expect(frames.some((frame) => frame.light === 80)).toBe(true);
  await expect(page.getByTestId('challenge-status')).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.');
});

test('an edit after a check drops the frame it left', async ({ page }) => {
  await openSolved(page, 'ybc-heart');
  await watchCheck(page);
  await expect.poll(async () => (await seen(page)).display).toBe(cells(ybcImages.heart));

  await page.getByRole('button', { name: 'Thêm Đèn LED' }).click();
  await expect.poll(() => seen(page)).toMatchObject({ display: '0'.repeat(25), overlay: null });
});

test('a Blockly lab: the check holds the push button, drawn closed, and the LED follows it', async ({ page }) => {
  await page.goto('/?embed=1&lab=blockly&template=button-led');
  await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
  const states: { closed?: boolean; lit?: boolean }[] = [];
  await page.getByRole('button', { name: 'Kiểm tra' }).click();
  const status = page.getByTestId('challenge-status');
  while (!/^(Đạt|Chưa đạt)/.test((await status.textContent()) ?? '')) {
    const { components } = (await page.evaluate(() => window.__stem?.getCanvasState())) ?? { components: [] };
    states.push({ closed: components.find((c) => c.id === 'button')?.closed, lit: components.find((c) => c.id === 'led')?.lit });
    await page.waitForTimeout(50);
  }
  expect(states).toContainEqual({ closed: true, lit: true });
  await expect(status).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.');
});

test.describe('in a narrow frame', () => {
  test.use({ viewport: { width: 670, height: 600 } });

  test('Kiểm tra turns to the circuit, so the check is seen', async ({ page }) => {
    await openSolved(page, 'ybc-heart');
    await expect(page.getByRole('tab', { name: 'Chương trình' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.getByRole('tab', { name: 'Mạch' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('circuit-canvas')).toBeVisible();
    await expect(page.getByTestId('challenge-status')).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.', { timeout: 10_000 });
  });
});
```

**Replace in `src/ui/canvas/ybc-board-renderer.test.tsx` (1/4):**

```tsx
import { productionProfiles } from '../../core/profiles';
import { resolveBoardContext } from '../../core/profiles/board-context';
import type { SimulationResult } from '../../core/simulation/simulate-circuit';
import { readCanvasState } from './canvas-test-state';
import { CircuitCanvas, partStatesOf } from './CircuitCanvas';
```

with:

```tsx
import { productionProfiles } from '../../core/profiles';
import { resolveBoardContext } from '../../core/profiles/board-context';
import type { ComponentInput, SimulationResult } from '../../core/simulation/simulate-circuit';
import { readCanvasState } from './canvas-test-state';
import { CircuitCanvas, partStatesOf } from './CircuitCanvas';
```

**Replace in `src/ui/canvas/ybc-board-renderer.test.tsx` (2/4):**

```tsx
const frameOf = (...lit: number[]): Frame => ({ pixels: blankFrame().pixels.map((_, index) => (lit.includes(index) ? red : null)) });

function render(circuit: Circuit, profile: string | undefined, run: SimulationResult | null) {
  const context = resolveBoardContext({ profile, circuit }, registry, productionProfiles);
  return act(async () =>
```

with:

```tsx
const frameOf = (...lit: number[]): Frame => ({ pixels: blankFrame().pixels.map((_, index) => (lit.includes(index) ? red : null)) });

function render(circuit: Circuit, profile: string | undefined, run: SimulationResult | null, inputs?: Record<string, ComponentInput>) {
  const context = resolveBoardContext({ profile, circuit }, registry, productionProfiles);
  return act(async () =>
```

**Replace in `src/ui/canvas/ybc-board-renderer.test.tsx` (3/4):**

```tsx
        onCircuitChange={() => undefined}
        onContactChange={() => undefined}
      />,
    ),
```

with:

```tsx
        onCircuitChange={() => undefined}
        onContactChange={() => undefined}
        {...(inputs ? { inputs } : {})}
      />,
    ),
```

**Replace in `src/ui/canvas/ybc-board-renderer.test.tsx` (4/4):**

```tsx
});

describe('a generic project is drawn as before', () => {
  it('gives its board no display and no tone, whatever the snapshot holds', async () => {
```

with:

```tsx
});

describe('the inputs of a lab’s check on the board (N8s)', () => {
  it('draws a button the check holds pressed, and the light level it gives beside the sensor', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({}), {
      'ybc-board-1/button-a': { kind: 'hold', closed: true },
      'ybc-board-1/button-b': { kind: 'hold', closed: false },
      'ybc-board-1/light': { kind: 'slider', value: 10 },
    });

    expect(board().pressedParts).toEqual(['button-a']);
    expect(board().lightLevel).toBe(10);
    expect(groupNamed('.ybc-part-button-a')?.findOne<Konva.Rect>('Rect')?.strokeWidth()).toBeGreaterThan(0);
    expect(groupNamed('.ybc-part-button-b')?.findOne<Konva.Rect>('Rect')?.strokeWidth()).toBe(0);
    expect(stage().find<Konva.Text>('Text').map((text) => text.text())).toContain('10');
  });

  it('draws nothing pressed without inputs, and ignores the inputs of another board', async () => {
    await render(ybcCircuit, 'ybc-basic', simulation({}), { 'other/button-a': { kind: 'hold', closed: true } });

    expect(board().pressedParts).toEqual([]);
    expect(board().lightLevel).toBeUndefined();
  });
});

describe('a generic project is drawn as before', () => {
  it('gives its board no display and no tone, whatever the snapshot holds', async () => {
```

**Replace in `src/ui/runtime-controls/RuntimeControls.test.tsx`:**

```tsx
      expect(byTestId<HTMLButtonElement | HTMLInputElement>(testId).disabled).toBe(false);
    }
  });
});
```

with:

```tsx
      expect(byTestId<HTMLButtonElement | HTMLInputElement>(testId).disabled).toBe(false);
    }
  });
});

describe('while a lab’s check drives the run (N8s)', () => {
  const renderScripted = (scripted: Record<string, ComponentInput>) =>
    act(async () =>
      root.render(<RuntimeControls boardId="board-1" definition={definition} controls={controls} active onInput={() => undefined} scripted={scripted} />),
    );

  it('shows the buttons the check holds as pressed, and takes no press of the learner', async () => {
    await renderScripted({ 'board-1/button-a': hold(true), 'board-1/button-b': hold(false) });

    expect(buttonA().getAttribute('aria-pressed')).toBe('true');
    expect(byTestId('control-button-b').getAttribute('aria-pressed')).toBe('false');
    for (const testId of ['control-button-a', 'control-button-b', 'control-light']) {
      expect(byTestId<HTMLButtonElement | HTMLInputElement>(testId).disabled).toBe(true);
    }
  });

  it('shows the light level the check gives, and the initial level before it gives one', async () => {
    await renderScripted({});
    expect(slider().value).toBe(String(LIGHT_LEVEL_INITIAL));

    await renderScripted({ 'board-1/light': { kind: 'slider', value: 10 } });
    expect(slider().value).toBe('10');
    expect(byTestId('control-light-value').textContent).toBe('10');
  });
});
```

**Replace in `src/ui/state/run-store.test.ts`:**

```ts
    expect(selectIsRunning(store.getState())).toBe(false);
  });
});
```

with:

```ts
    expect(selectIsRunning(store.getState())).toBe(false);
  });

  it('tells the UI each input of the check and the last snapshot before the check stops the run (N8s)', () => {
    const { store } = setup();
    const inputs: [string, unknown][] = [];
    const last: string[] = [];
    const checkSession = checkSessionOf(store, {
      onInput: (componentId, input) => inputs.push([componentId, input]),
      beforeStop: (snapshot) => last.push(`${snapshot.status} ${String(snapshot.simulation?.components.led?.lit)}`),
    });

    checkSession.start(projectDocumentSchema.parse(buttonDirectSample));
    checkSession.setComponentInput('button', { kind: 'hold', closed: true });
    checkSession.stop();

    expect(inputs).toEqual([['button', { kind: 'hold', closed: true }]]);
    // Taken while the run still held the lit LED, before the stop dropped it.
    expect(last).toEqual(['running true']);
    expect(store.getState().latestSnapshot().simulation).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm exec vitest run src/ui/state/run-store.test.ts src/ui/runtime-controls/RuntimeControls.test.tsx src/ui/canvas/ybc-board-renderer.test.tsx`

Expected: FAIL — 5 tests: run-store "tells the UI each input …" (`expected [] to deeply equal [ [ 'button', …(1) ] ]`), RuntimeControls "shows the buttons the check holds as pressed …" (`expected 'false' to be 'true'`) and "shows the light level …" (`expected '50' to be '10'`), ybc-board-renderer "draws a button the check holds pressed …" (`expected undefined to deeply equal [ 'button-a' ]`) and "draws nothing pressed …".

- [ ] **Step 3: Implement**

**Replace in `src/ui/app/App.tsx` (1/8):**

```tsx
import { buildToolbox, type BlockPackCatalog } from '../../core/program/block-packs';
import { buzzerPartId, displayPartId } from '../../core/simulation/peripherals/onboard-capabilities';
import type { LabKind } from '../../samples/templates';
import { SoundIndicator } from '../audio/SoundIndicator';
```

with:

```tsx
import { buildToolbox, type BlockPackCatalog } from '../../core/program/block-packs';
import { buzzerPartId, displayPartId } from '../../core/simulation/peripherals/onboard-capabilities';
import type { ComponentInput, SimulationResult } from '../../core/simulation/simulate-circuit';
import type { LabKind } from '../../samples/templates';
import { SoundIndicator } from '../audio/SoundIndicator';
```

**Replace in `src/ui/app/App.tsx` (2/8):**

```tsx

  // A lab's check (N6a S4): one at a time, on the run the toolbar shows. Its result belongs to the document it
  // checked: once the learner edits, the goals go back to "not checked yet".
  const [check, setCheck] = useState<CheckView & { document?: ProjectDocument }>({ state: 'idle' });
  const checkRun = useRef<CheckRun | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
```

with:

```tsx

  // A lab's check (N6a S4): one at a time, on the run the toolbar shows. Its result belongs to the document it
  // checked: once the learner edits, the goals go back to "not checked yet". The run is the one the canvas draws;
  // the inputs the check gives it are drawn too (`scriptedInputs`), and its last frame stays on the board after it
  // (`final`) until the next run or edit (N8s).
  const [check, setCheck] = useState<CheckView & { document?: ProjectDocument; final?: SimulationResult | null }>({ state: 'idle' });
  const [scriptedInputs, setScriptedInputs] = useState<Readonly<Record<string, ComponentInput>>>({});
  const checkRun = useRef<CheckRun | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
```

**Replace in `src/ui/app/App.tsx` (3/8):**

```tsx
    setRunEpoch((epoch) => epoch + 1);
    setCheck({ state: 'checking' });
    const started = runCheck({ session: checkSessionOf(runStore), document: checked, challenge, boardId });
    checkRun.current = started;
    void started.done.then((outcome) => {
```

with:

```tsx
    setRunEpoch((epoch) => epoch + 1);
    setCheck({ state: 'checking' });
    setScriptedInputs({});
    let final: SimulationResult | null = null;
    const session = checkSessionOf(runStore, {
      onInput: (componentId, input) => setScriptedInputs((inputs) => ({ ...inputs, [componentId]: input })),
      beforeStop: (snapshot) => {
        final = snapshot.simulation;
      },
    });
    const started = runCheck({ session, document: checked, challenge, boardId });
    checkRun.current = started;
    void started.done.then((outcome) => {
```

**Replace in `src/ui/app/App.tsx` (4/8):**

```tsx
      }
      checkRun.current = null;
      if (outcome.status === 'cancelled') {
        setCheck({ state: 'idle' });
        return;
      }
      setCheck({ state: 'done', result: outcome.result, started: outcome.started, document: checked });
      lab?.onChecked?.(outcome.result);
    });
```

with:

```tsx
      }
      checkRun.current = null;
      setScriptedInputs({});
      if (outcome.status === 'cancelled') {
        setCheck({ state: 'idle' });
        return;
      }
      setCheck({ state: 'done', result: outcome.result, started: outcome.started, document: checked, final });
      lab?.onChecked?.(outcome.result);
    });
```

**Replace in `src/ui/app/App.tsx` (5/8):**

```tsx
  const checking = check.state === 'checking';
  const shownCheck: CheckView = check.state === 'done' && check.document !== document ? { state: 'idle' } : check;
  // The sound follows every snapshot of the session, not the one a frame shows (see SoundIndicator).
  const tones = useCallback(
```

with:

```tsx
  const checking = check.state === 'checking';
  const shownCheck: CheckView = check.state === 'done' && check.document !== document ? { state: 'idle' } : check;
  // After a check, the board keeps its last frame until the next run or edit (N8s): what the goals were judged on.
  const heldSimulation = !running && check.state === 'done' && check.document === document ? (check.final ?? null) : null;
  const shownSimulation = simulation ?? heldSimulation;
  const checkOverlay =
    checking && lab?.challenge ? (
      <div className="check-overlay" data-testid="check-overlay" data-state="running">
        <span>{t('lab.check.running')}</span>
        <span className="check-progress" aria-hidden="true">
          <span style={{ animationDuration: `${lab.challenge.durationMs}ms` }} />
        </span>
      </div>
    ) : heldSimulation ? (
      <div className="check-overlay" data-testid="check-overlay" data-state="held">
        {t('lab.check.held')}
      </div>
    ) : null;
  // The sound follows every snapshot of the session, not the one a frame shows (see SoundIndicator).
  const tones = useCallback(
```

**Replace in `src/ui/app/App.tsx` (6/8):**

```tsx
      registry={registry}
      context={context}
      simulation={simulation}
      locked={running}
      fit={lab !== null}
      onCircuitChange={editCircuit}
      // Runtime input, not an edit: the session ignores it unless running.
```

with:

```tsx
      registry={registry}
      context={context}
      simulation={shownSimulation}
      locked={running}
      fit={lab !== null}
      {...(checking ? { inputs: scriptedInputs } : {})}
      overlay={checkOverlay}
      onCircuitChange={editCircuit}
      // Runtime input, not an edit: the session ignores it unless running.
```

**Replace in `src/ui/app/App.tsx` (7/8):**

```tsx
          {board && (
            <div className="board-panel" data-testid="board-panel">
              <DisplayText display={partStateOf(simulation, board.id, displayPartId)} />
              <RuntimeControls
                key={running ? `run-${runEpoch}` : 'idle'}
```

with:

```tsx
          {board && (
            <div className="board-panel" data-testid="board-panel">
              <DisplayText display={partStateOf(shownSimulation, board.id, displayPartId)} />
              <RuntimeControls
                key={running ? `run-${runEpoch}` : 'idle'}
```

**Replace in `src/ui/app/App.tsx` (8/8):**

```tsx
                active={running}
                onInput={(componentId, input) => runStore.getState().setComponentInput(componentId, input)}
              />
              <SoundIndicator buzzer={partStateOf(simulation, board.id, buzzerPartId)} tones={tones} />
```

with:

```tsx
                active={running}
                onInput={(componentId, input) => runStore.getState().setComponentInput(componentId, input)}
                {...(checking ? { scripted: scriptedInputs } : {})}
              />
              <SoundIndicator buzzer={partStateOf(simulation, board.id, buzzerPartId)} tones={tones} />
```

**Replace in `src/ui/app/app.css`:**

```css
  border-bottom: 0;
}
```

with:

```css
  border-bottom: 0;
}

/* How a lab's check is going (N8s), over the top right of the canvas: its progress, then the frame it left. */
.check-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: calc(100% - 16px);
  padding: 6px 10px;
  border: 1px solid var(--stem-color-border);
  border-radius: var(--stem-radius);
  background: var(--stem-color-overlay);
  font-size: 13px;
  pointer-events: none;
}

.check-overlay[data-state='held'] {
  border-style: dashed;
  border-color: var(--stem-color-primary);
  color: var(--stem-color-primary);
}

.check-progress {
  display: block;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--stem-color-neutral-soft);
}

.check-progress > span {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--stem-color-primary);
  transform-origin: left;
  animation: check-progress linear forwards;
}

@keyframes check-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .check-progress > span {
    animation: none;
  }
}
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (1/9):**

```tsx
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Shape } from 'konva/lib/Shape';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { addComponent, deleteComponent, moveComponent } from '../../core/circuit/components';
```

with:

```tsx
import type { KonvaEventObject } from 'konva/lib/Node';
import type { Shape } from 'konva/lib/Shape';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { addComponent, deleteComponent, moveComponent } from '../../core/circuit/components';
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (2/9):**

```tsx
import type { DeviceRegistry } from '../../core/devices/registry';
import type { BoardContext } from '../../core/profiles/board-context';
import { isContact, type ComponentState, type SimulationResult } from '../../core/simulation/simulate-circuit';
import { localizeDeviceDefinition } from '../i18n/devices';
import type { MessageKey } from '../i18n/messages';
```

with:

```tsx
import type { DeviceRegistry } from '../../core/devices/registry';
import type { BoardContext } from '../../core/profiles/board-context';
import { isContact, peripheralComponentId, type ComponentInput, type ComponentState, type SimulationResult } from '../../core/simulation/simulate-circuit';
import { localizeDeviceDefinition } from '../i18n/devices';
import type { MessageKey } from '../i18n/messages';
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (3/9):**

```tsx
   */
  fit?: boolean;
};

```

with:

```tsx
   */
  fit?: boolean;
  /** The inputs a lab's check gives the run, by component id (`<board>/<part>`), drawn on the board (N8s). */
  inputs?: Readonly<Record<string, ComponentInput>>;
  /** Shown over the top of the canvas, e.g. how a lab's check is going (N8s). */
  overlay?: ReactNode;
};

```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (4/9):**

```tsx
  onContactChange,
  fit = false,
}: CircuitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
```

with:

```tsx
  onContactChange,
  fit = false,
  inputs,
  overlay,
}: CircuitCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (5/9):**

```tsx
                    runtimeState={runtimeStateOf(simulation, component.id)}
                    partStates={partStatesOf(simulation, component.id, registry.get(component.deviceType))}
                    selected={selected?.kind === 'component' && selected.id === component.id}
                    // Off while drawing a wire too, so a click there never starts a drag (R5).
```

with:

```tsx
                    runtimeState={runtimeStateOf(simulation, component.id)}
                    partStates={partStatesOf(simulation, component.id, registry.get(component.deviceType))}
                    partInputs={partInputsOf(inputs, component.id, registry.get(component.deviceType))}
                    selected={selected?.kind === 'component' && selected.id === component.id}
                    // Off while drawing a wire too, so a click there never starts a drag (R5).
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (6/9):**

```tsx
          </p>
        )}
      </div>
    </div>
```

with:

```tsx
          </p>
        )}
        {overlay}
      </div>
    </div>
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (7/9):**

```tsx
}

type ComponentBodyProps = ComponentProps &
  Pick<DeviceRendererProps, 'runtimeState' | 'partStates'> & {
    selected: boolean;
    /** The device does not belong to this kind of project (R-F4). */
```

with:

```tsx
}

/** The inputs given to a board's onboard parts, by part id; undefined for no inputs and for a component without parts. */
export function partInputsOf(
  inputs: Readonly<Record<string, ComponentInput>> | undefined,
  componentId: string,
  definition: DeviceDefinition,
): Record<string, ComponentInput> | undefined {
  const onboard = definition.board?.onboard;
  if (!inputs || !onboard) {
    return undefined;
  }
  // No prototype, as in partStatesOf: part ids are data.
  const given: Record<string, ComponentInput> = Object.create(null);
  for (const part of onboard) {
    const id = peripheralComponentId(componentId, part.id);
    if (Object.hasOwn(inputs, id)) {
      given[part.id] = inputs[id] as ComponentInput;
    }
  }
  return given;
}

type ComponentBodyProps = ComponentProps &
  Pick<DeviceRendererProps, 'runtimeState' | 'partStates' | 'partInputs'> & {
    selected: boolean;
    /** The device does not belong to this kind of project (R-F4). */
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (8/9):**

```tsx
  runtimeState,
  partStates,
  selected,
  incompatible,
```

with:

```tsx
  runtimeState,
  partStates,
  partInputs,
  selected,
  incompatible,
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx` (9/9):**

```tsx
      {...interaction}
    >
      <Renderer definition={definition} runtimeState={runtimeState} partStates={partStates} />
      {incompatible && (
        <Rect
```

with:

```tsx
      {...interaction}
    >
      <Renderer definition={definition} runtimeState={runtimeState} partStates={partStates} partInputs={partInputs} />
      {incompatible && (
        <Rect
```

**Replace in `src/ui/canvas/YbcBoardRenderer.tsx` (1/6):**

```tsx
import { Group, Rect, Text } from 'react-konva';
import type { OnboardPeripheral } from '../../core/devices/device-definition';
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { formatHz, toneHz } from '../audio/tone';
import { renderedPixels } from '../runtime-controls/display-view';
```

with:

```tsx
import { Group, Rect, Text } from 'react-konva';
import type { OnboardPeripheral } from '../../core/devices/device-definition';
import type { ComponentInput, ComponentState } from '../../core/simulation/simulate-circuit';
import { formatHz, toneHz } from '../audio/tone';
import { renderedPixels } from '../runtime-controls/display-view';
```

**Replace in `src/ui/canvas/YbcBoardRenderer.tsx` (2/6):**

```tsx
// (`partStates`): the display's cells take their colour from its frame, and the buzzer is marked, with
// its frequency as text, while a note sounds. The buttons and the light sensor are labelled footprints:
// their pressed state and slider belong to the controls under the canvas, and the snapshot does not echo them.

const { shell: shellFill, shellOutline: shellStroke, part: partFill, label: labelFill, sounding: soundingStroke, cellOff } = canvasPalette.ybcBoard;
const cellGap = 3;

export function YbcBoardRenderer({ definition, partStates }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const onboard = definition.board?.onboard ?? [];
```

with:

```tsx
// (`partStates`): the display's cells take their colour from its frame, and the buzzer is marked, with
// its frequency as text, while a note sounds. The buttons and the light sensor are labelled footprints:
// their pressed state and slider belong to the controls under the canvas, and the snapshot does not echo them;
// while a lab's check presses them (N8s), its inputs (`partInputs`) are drawn: a held button filled and ringed,
// the light's level as text beside it.

const {
  shell: shellFill,
  shellOutline: shellStroke,
  part: partFill,
  label: labelFill,
  sounding: soundingStroke,
  cellOff,
  pressed: pressedFill,
} = canvasPalette.ybcBoard;
const cellGap = 3;

export function YbcBoardRenderer({ definition, partStates, partInputs }: DeviceRendererProps) {
  const { width, height } = definition.body;
  const onboard = definition.board?.onboard ?? [];
```

**Replace in `src/ui/canvas/YbcBoardRenderer.tsx` (3/6):**

```tsx
  const stateOf = (partId: string): ComponentState | undefined =>
    partStates && Object.hasOwn(partStates, partId) ? partStates[partId] : undefined;
  return (
    <>
```

with:

```tsx
  const stateOf = (partId: string): ComponentState | undefined =>
    partStates && Object.hasOwn(partStates, partId) ? partStates[partId] : undefined;
  const inputOf = (partId: string): ComponentInput | undefined =>
    partInputs && Object.hasOwn(partInputs, partId) ? partInputs[partId] : undefined;
  return (
    <>
```

**Replace in `src/ui/canvas/YbcBoardRenderer.tsx` (4/6):**

```tsx
          <DisplayGrid key={part.id} part={part} state={stateOf(part.id)} />
        ) : (
          <PartFootprint key={part.id} part={part} hz={part.model === 'buzzer' ? toneHz(stateOf(part.id)) : undefined} />
        ),
      )}
```

with:

```tsx
          <DisplayGrid key={part.id} part={part} state={stateOf(part.id)} />
        ) : (
          <PartFootprint key={part.id} part={part} hz={part.model === 'buzzer' ? toneHz(stateOf(part.id)) : undefined} input={inputOf(part.id)} />
        ),
      )}
```

**Replace in `src/ui/canvas/YbcBoardRenderer.tsx` (5/6):**

```tsx
/**
 * A labelled place of a part. `hz` is only given for the buzzer, and while it sounds the footprint gets a ring
 * and the frequency as text (a colour is never the only sign); it is also set on the group for tests.
 */
function PartFootprint({ part, hz }: { part: OnboardPeripheral; hz?: number }) {
  const { x, y, width, height } = part.at;
  const sounding = hz !== undefined;
  return (
    <Group name={`ybc-part-${part.id}`} hz={hz} listening={false}>
      <Rect
        x={x}
```

with:

```tsx
/**
 * A labelled place of a part. `hz` is only given for the buzzer, and while it sounds the footprint gets a ring
 * and the frequency as text (a colour is never the only sign); it is also set on the group for tests. `input` is
 * what a lab's check gives the part: a held button is filled and ringed, a light level is written beside it;
 * both are set on the group too (`pressed`, `level`).
 */
function PartFootprint({ part, hz, input }: { part: OnboardPeripheral; hz?: number; input?: ComponentInput }) {
  const { x, y, width, height } = part.at;
  const sounding = hz !== undefined;
  const pressed = input?.kind === 'hold' && input.closed;
  const level = input?.kind === 'slider' ? input.value : undefined;
  const ring = sounding ? soundingStroke : pressed ? labelFill : undefined;
  return (
    <Group name={`ybc-part-${part.id}`} hz={hz} pressed={pressed} level={level} listening={false}>
      <Rect
        x={x}
```

**Replace in `src/ui/canvas/YbcBoardRenderer.tsx` (6/6):**

```tsx
        height={height}
        cornerRadius={6}
        fill={partFill}
        stroke={sounding ? soundingStroke : undefined}
        strokeWidth={sounding ? 3 : 0}
      />
      <Text text={part.label} x={x} y={y + height / 2 - 5} width={width} align="center" fontSize={10} fill={labelFill} />
      {sounding && <Text text={formatHz(hz)} x={x + width + 6} y={y + height / 2 - 6} fontSize={12} fill={soundingStroke} />}
    </Group>
  );
```

with:

```tsx
        height={height}
        cornerRadius={6}
        fill={pressed ? pressedFill : partFill}
        stroke={ring}
        strokeWidth={ring === undefined ? 0 : 3}
      />
      <Text text={part.label} x={x} y={y + height / 2 - 5} width={width} align="center" fontSize={10} fill={labelFill} />
      {sounding && <Text text={formatHz(hz)} x={x + width + 6} y={y + height / 2 - 6} fontSize={12} fill={soundingStroke} />}
      {level !== undefined && <Text text={String(level)} x={x + width + 6} y={y + height / 2 - 6} fontSize={12} fill={soundingStroke} />}
    </Group>
  );
```

**Replace in `src/ui/canvas/canvas-test-state.ts` (1/2):**

```ts
    /** Every text drawn on the body (its name, its parts' labels), in drawing order (N8s). */
    texts: string[];
  }[];
  wires: { id: string; points: number[]; selected: boolean }[];
```

with:

```ts
    /** Every text drawn on the body (its name, its parts' labels), in drawing order (N8s). */
    texts: string[];
    /** A Yolo:Bit-compatible board's parts drawn pressed by a lab's check (N8s). */
    pressedParts?: string[];
    /** The light level a lab's check gives the board, as drawn beside the sensor (N8s); absent when none. */
    lightLevel?: number;
  }[];
  wires: { id: string; points: number[]; selected: boolean }[];
```

**Replace in `src/ui/canvas/canvas-test-state.ts` (2/2):**

```ts
      incompatible: node.findOne('.incompatible') !== undefined,
      texts: node.find<Konva.Text>('Text').map((text) => text.text()),
    })),
    wires: stage.find<Konva.Line>('.wire').map((node) => ({
```

with:

```ts
      incompatible: node.findOne('.incompatible') !== undefined,
      texts: node.find<Konva.Text>('Text').map((text) => text.text()),
      pressedParts: node.findOne('.ybc-display')
        ? node
            .find<Konva.Group>((part: Konva.Node) => part.name().startsWith('ybc-part-') && part.getAttr('pressed') === true)
            .map((part) => part.name().slice('ybc-part-'.length))
        : undefined,
      lightLevel: node.findOne('.ybc-part-light')?.getAttr('level'),
    })),
    wires: stage.find<Konva.Line>('.wire').map((node) => ({
```

**Replace in `src/ui/canvas/colors.ts`:**

```ts
  potentiometer: { body: '#3e4c59', outline: '#1f2933', knob: '#cbd2d9', knobOutline: '#52606d', pointer: '#1f2933', label: '#e4e7eb' },
  pushButton: { body: '#3e4c59', outline: '#1f2933', pressed: '#147d64', released: '#3ebd93', capOutline: '#0c6b58', shadow: '#000000' },
  ybcBoard: { shell: '#1f4e5f', shellOutline: '#143642', part: '#2c7a8c', label: '#e6f4f7', sounding: '#f0b429', cellOff: '#10292f' },
} as const;
```

with:

```ts
  potentiometer: { body: '#3e4c59', outline: '#1f2933', knob: '#cbd2d9', knobOutline: '#52606d', pointer: '#1f2933', label: '#e4e7eb' },
  pushButton: { body: '#3e4c59', outline: '#1f2933', pressed: '#147d64', released: '#3ebd93', capOutline: '#0c6b58', shadow: '#000000' },
  ybcBoard: {
    shell: '#1f4e5f',
    shellOutline: '#143642',
    part: '#2c7a8c',
    label: '#e6f4f7',
    sounding: '#f0b429',
    cellOff: '#10292f',
    /** A part a lab's check is pressing (N8s): the pressed colour of the controls (app.css `--stem-color-pressed`). */
    pressed: '#147d64',
  },
} as const;
```

**Replace in `src/ui/canvas/renderers.ts` (1/2):**

```ts
import type { ComponentType } from 'react';
import type { DeviceDefinition } from '../../core/devices/device-definition';
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { GenericRenderer } from './GenericRenderer';
import { LedRenderer } from './LedRenderer';
```

with:

```ts
import type { ComponentType } from 'react';
import type { DeviceDefinition } from '../../core/devices/device-definition';
import type { ComponentInput, ComponentState } from '../../core/simulation/simulate-circuit';
import { GenericRenderer } from './GenericRenderer';
import { LedRenderer } from './LedRenderer';
```

**Replace in `src/ui/canvas/renderers.ts` (2/2):**

```ts
   */
  partStates?: Readonly<Record<string, ComponentState>>;
};

```

with:

```ts
   */
  partStates?: Readonly<Record<string, ComponentState>>;
  /**
   * A board with onboard parts only: the input a lab's check gives a part, by part id (a button held, the light's
   * level), drawn so the learner sees the check press it (N8s). Absent otherwise: the controls under the canvas
   * show the learner's own presses.
   */
  partInputs?: Readonly<Record<string, ComponentInput>>;
};

```

**Replace in `src/ui/i18n/messages.ts` (1/2):**

```ts
  'lab.goal.failed': 'not met yet',
  'lab.result.checking': 'Checking: the lab runs your program for a few seconds…',
  'lab.result.passed': 'Passed! Every goal is met.',
  'lab.result.failed': 'Not yet: look at the goals that are not met, change the program and check again.',
```

with:

```ts
  'lab.goal.failed': 'not met yet',
  'lab.result.checking': 'Checking: the lab runs your program for a few seconds…',
  'lab.check.running': 'Checking: watch the board',
  'lab.check.held': 'The board as the check left it',
  'lab.result.passed': 'Passed! Every goal is met.',
  'lab.result.failed': 'Not yet: look at the goals that are not met, change the program and check again.',
```

**Replace in `src/ui/i18n/messages.ts` (2/2):**

```ts
  'lab.goal.failed': 'chưa đạt',
  'lab.result.checking': 'Đang kiểm tra: chương trình của bạn được chạy thử vài giây…',
  'lab.result.passed': 'Đạt! Bạn đã hoàn thành mọi mục tiêu.',
  'lab.result.failed': 'Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.',
```

with:

```ts
  'lab.goal.failed': 'chưa đạt',
  'lab.result.checking': 'Đang kiểm tra: chương trình của bạn được chạy thử vài giây…',
  'lab.check.running': 'Đang kiểm tra: hãy xem bo mạch',
  'lab.check.held': 'Bo mạch lúc kết thúc lần kiểm tra',
  'lab.result.passed': 'Đạt! Bạn đã hoàn thành mọi mục tiêu.',
  'lab.result.failed': 'Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.',
```

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx` (1/7):**

```tsx
// run decides what that means. What a control shows of itself (pressed, the slider's place) is its own
// presentation; what the board does is drawn from the snapshot. Inputs belong to a run (B2): the owner
// gives the controls a new key for each run, so every run starts from their initial place.

type RuntimeControlsProps = {
```

with:

```tsx
// run decides what that means. What a control shows of itself (pressed, the slider's place) is its own
// presentation; what the board does is drawn from the snapshot. Inputs belong to a run (B2): the owner
// gives the controls a new key for each run, so every run starts from their initial place. While a lab's
// check drives the run (N8s), the controls only show what the check gives the board (`scripted`): pressed
// buttons, the light's level; the learner cannot press them then.

type RuntimeControlsProps = {
```

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx` (2/7):**

```tsx
  active: boolean;
  onInput(componentId: string, input: ComponentInput): void;
};

export function RuntimeControls({ boardId, definition, controls, active, onInput }: RuntimeControlsProps) {
  const t = useText();
  // A part the dictionary does not know keeps the label the model gives it.
```

with:

```tsx
  active: boolean;
  onInput(componentId: string, input: ComponentInput): void;
  /** While a lab's check drives the run: the inputs it gave, by component id; the controls show them and take none. */
  scripted?: Readonly<Record<string, ComponentInput>>;
};

export function RuntimeControls({ boardId, definition, controls, active, onInput, scripted }: RuntimeControlsProps) {
  const t = useText();
  // A part the dictionary does not know keeps the label the model gives it.
```

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx` (3/7):**

```tsx
  return (
    <div className="runtime-controls" role="group" aria-label={t('controls.label')} data-testid="runtime-controls">
      {specs.map((spec) =>
        spec.kind === 'hold' ? (
          <HoldButton key={spec.partId} spec={spec} active={active} onInput={onInput} />
        ) : (
          <RangeControl key={spec.partId} spec={spec} active={active} onInput={onInput} />
        ),
      )}
    </div>
  );
```

with:

```tsx
  return (
    <div className="runtime-controls" role="group" aria-label={t('controls.label')} data-testid="runtime-controls">
      {specs.map((spec) => {
        const shown = scripted ? { input: Object.hasOwn(scripted, spec.componentId) ? scripted[spec.componentId] : undefined } : undefined;
        return spec.kind === 'hold' ? (
          <HoldButton key={spec.partId} spec={spec} active={active && !shown} onInput={onInput} scripted={shown} />
        ) : (
          <RangeControl key={spec.partId} spec={spec} active={active && !shown} onInput={onInput} scripted={shown} />
        );
      })}
    </div>
  );
```

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx` (4/7):**

```tsx
  active: boolean;
  onInput(componentId: string, input: ComponentInput): void;
};

```

with:

```tsx
  active: boolean;
  onInput(componentId: string, input: ComponentInput): void;
  /** Set while a check drives the run: what it gave this part (undefined: nothing yet), shown instead of the control's own state. */
  scripted?: { input: ComponentInput | undefined };
};

```

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx` (5/7):**

```tsx

/** Closed while a pointer or a key holds it, open when nothing does, also when it is disabled, loses focus or goes away. */
function HoldButton({ spec, active, onInput }: ControlProps<'hold'>) {
  const [tracker] = useState(createHoldTracker);
  // Only for how the button looks (aria-pressed, styling); what the run sees is the tracker's changes.
```

with:

```tsx

/** Closed while a pointer or a key holds it, open when nothing does, also when it is disabled, loses focus or goes away. */
function HoldButton({ spec, active, onInput, scripted }: ControlProps<'hold'>) {
  const [tracker] = useState(createHoldTracker);
  // Only for how the button looks (aria-pressed, styling); what the run sees is the tracker's changes.
```

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx` (6/7):**

```tsx
      className="control-hold"
      data-testid={`control-${spec.partId}`}
      aria-pressed={pressed}
      disabled={!active}
      onPointerDown={onPointerDown}
```

with:

```tsx
      className="control-hold"
      data-testid={`control-${spec.partId}`}
      aria-pressed={scripted ? scripted.input?.kind === 'hold' && scripted.input.closed : pressed}
      disabled={!active}
      onPointerDown={onPointerDown}
```

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx` (7/7):**

```tsx

/** A slider of the part's range, an integer, which the run reads as the value of the sensor. */
function RangeControl({ spec, active, onInput }: ControlProps<'slider'>) {
  const { min, max, initial } = spec.range;
  const [value, setValue] = useState(initial);
  const inputId = useId();
  const onChange = (raw: string) => {
```

with:

```tsx

/** A slider of the part's range, an integer, which the run reads as the value of the sensor. */
function RangeControl({ spec, active, onInput, scripted }: ControlProps<'slider'>) {
  const { min, max, initial } = spec.range;
  const [own, setValue] = useState(initial);
  const value = scripted ? (scripted.input?.kind === 'slider' ? scripted.input.value : initial) : own;
  const inputId = useId();
  const onChange = (raw: string) => {
```

**Replace in `src/ui/state/run-store.ts`:**

```ts
export type RunStore = ReturnType<typeof createRunStore>;

/**
 * The run store as the session of a check (N6a S2): a check starts, observes and stops the same run the toolbar
 * shows, so its run locks the editor, draws on the canvas and reports why it did not start, like Run.
 */
export function checkSessionOf(runStore: RunStore): CheckSession {
  return {
    start: (project) => runStore.getState().run(project),
    stop: () => runStore.getState().stop(),
    subscribe: (listener) => runStore.getState().onSnapshot(listener),
    getSnapshot: () => runStore.getState().latestSnapshot(),
    setComponentInput: (componentId, input) => runStore.getState().setComponentInput(componentId, input),
  };
}
```

with:

```ts
export type RunStore = ReturnType<typeof createRunStore>;

/** What the UI watches of a check's run (N8s): the inputs the check gives it, and its last snapshot. */
export type CheckObserver = {
  /** Every input of the challenge's script, as the check gives it to the run (to draw the virtual press). */
  onInput?(componentId: string, input: ComponentInput): void;
  /** The run's snapshot just before the check stops it (the board as the check left it). */
  beforeStop?(snapshot: RunSnapshot): void;
};

/**
 * The run store as the session of a check (N6a S2): a check starts, observes and stops the same run the toolbar
 * shows, so its run locks the editor, draws on the canvas and reports why it did not start, like Run.
 */
export function checkSessionOf(runStore: RunStore, observer: CheckObserver = {}): CheckSession {
  return {
    start: (project) => runStore.getState().run(project),
    stop: () => {
      observer.beforeStop?.(runStore.getState().latestSnapshot());
      runStore.getState().stop();
    },
    subscribe: (listener) => runStore.getState().onSnapshot(listener),
    getSnapshot: () => runStore.getState().latestSnapshot(),
    setComponentInput: (componentId, input) => {
      observer.onInput?.(componentId, input);
      runStore.getState().setComponentInput(componentId, input);
    },
  };
}
```

- [ ] **Step 4: Run the tests and the gate**

Run: `pnpm exec vitest run src/ui/state/run-store.test.ts src/ui/runtime-controls/RuntimeControls.test.tsx src/ui/canvas/ybc-board-renderer.test.tsx`

Expected: all passed.

Run: `pnpm verify`

Expected: `Test Files  141 passed (141)`, `Tests  4572 passed | 1 skipped (4573)`.

Run: `E2E_PORT=5273 pnpm exec playwright test e2e/lab-check.spec.ts e2e/ybc-embed.spec.ts e2e/lab-layout.spec.ts`

Expected: `25 passed` (ybc-embed still records exactly `['ready', 'run-started', 'run-stopped', 'check-result']`).

- [ ] **Step 5: Commit**

```bash
git add src/ui/state/run-store.ts src/ui/state/run-store.test.ts src/ui/runtime-controls/RuntimeControls.tsx src/ui/runtime-controls/RuntimeControls.test.tsx src/ui/canvas/renderers.ts src/ui/canvas/CircuitCanvas.tsx src/ui/canvas/YbcBoardRenderer.tsx src/ui/canvas/colors.ts src/ui/canvas/canvas-test-state.ts src/ui/canvas/ybc-board-renderer.test.tsx src/ui/app/App.tsx src/ui/app/app.css src/ui/i18n/messages.ts e2e/lab-check.spec.ts
git commit -m "$(cat <<'EOF'
feat(n8s): a visible check: virtual presses drawn, last frame held, progress, circuit in sight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Contract doc, plan updates (§15) and the full E2E run  — `model: sonnet`

Hợp đồng không đổi về kỹ thuật (không URL, không message mới), nhưng phần host đọc được về hành vi nhìn thấy (ngôn ngữ của lỗi launch, Kiểm tra, bố cục theo khung) được cập nhật. Theo working agreement §15: ghi N8s vào `docs/stem-demo-implementation-plan.md` (§9.1, §9.2, learning log) và `docs/yolobit-compatible-board-implementation-plan.md` (§2, §23), và đánh dấu các mục Deferred của plan N6a đã làm.

**Files:**
- Modify: `docs/lab-embed-contract.md`, `docs/stem-demo-implementation-plan.md`, `docs/yolobit-compatible-board-implementation-plan.md`, `docs/superpowers/plans/2026-10-16-n6a-lab-embedding.md`

**Interfaces:**
- Consumes: everything above (names, rulings R1–R19).
- Produces: documentation only.

- [ ] **Step 1: Write the documentation**

**Replace in `docs/lab-embed-contract.md` (1/4):**

```markdown
  lặp; key không thuộc `lab` (vd. `lab=blockly&template=ybc-heart`); `profile` lặp, lạ, hoặc có với `lab=blockly`;
  `origin` lặp hoặc không phải một page origin (`*`, `null`, có path, có `/` cuối, port mặc định viết ra…).
  Lý do (tiếng Anh, cho người viết URL) và danh sách key của lab đó được hiện ra.
- **Ngôn ngữ**: `lab=` → tiếng Việt; standalone và lab S1 → tiếng Anh. `lang=vi|en` ghi đè.
- **Lab không lưu gì** trong trình duyệt (như S1): mỗi lần mở là template mới. Bài làm được giữ bởi host (xem
  `project-changed` / `load-project`).
```

with:

```markdown
  lặp; key không thuộc `lab` (vd. `lab=blockly&template=ybc-heart`); `profile` lặp, lạ, hoặc có với `lab=blockly`;
  `origin` lặp hoặc không phải một page origin (`*`, `null`, có path, có `/` cuối, port mặc định viết ra…).
  Lý do (theo ngôn ngữ của lab; với `lab=` là tiếng Việt, nguyên văn tiếng Anh cho người viết URL nằm dưới
  "Chi tiết kỹ thuật") và danh sách key của lab đó được hiện ra.
- **Ngôn ngữ**: `lab=` → tiếng Việt; standalone và lab S1 → tiếng Anh. `lang=vi|en` ghi đè. Với tiếng Việt, cả
  thông báo của core (lỗi biên dịch, lỗi khi chạy, lỗi mạch) và nhãn vẽ trên bo mạch cũng tiếng Việt (N8s).
- **Lab không lưu gì** trong trình duyệt (như S1): mỗi lần mở là template mới. Bài làm được giữ bởi host (xem
  `project-changed` / `load-project`).
```

**Replace in `docs/lab-embed-contract.md` (2/4):**

```markdown
- Template Yolo:Bit là **bài khởi đầu**: board và chương trình, cùng một khối (hoặc chuỗi khối) đặt rời, bị vô hiệu
  hoá; học sinh kéo nó vào đúng chỗ thì đạt. Template generic là chương trình hoàn chỉnh (như S1): Kiểm tra đạt ngay.
- **Người soạn bài**: với `empty`/`ybc-empty` (không có mục tiêu), để `requiresCheck = false`.

```

with:

```markdown
- Template Yolo:Bit là **bài khởi đầu**: board và chương trình, cùng một khối (hoặc chuỗi khối) đặt rời, bị vô hiệu
  hoá; học sinh kéo nó vào đúng chỗ thì đạt. Template generic là chương trình hoàn chỉnh (như S1): Kiểm tra đạt ngay.
- Kiểm tra chạy **trên bo mạch học sinh đang nhìn** (N8s): đó chính là lượt chạy được chấm. Các lần bấm nút A/B,
  kéo ánh sáng, giữ nút bấm của kịch bản được vẽ lên bo mạch và lên nút điều khiển; có thanh tiến độ trong lúc chạy;
  xong thì bo mạch giữ khung hình cuối (có ghi chú) tới lần chạy hoặc lần sửa tiếp theo. Message không đổi.
- **Người soạn bài**: với `empty`/`ybc-empty` (không có mục tiêu), để `requiresCheck = false`.

```

**Replace in `docs/lab-embed-contract.md` (3/4):**

```markdown
  không dùng `confirm()`: **Đặt lại** cần bấm hai lần.
- Host và lab phải cùng không gian địa chỉ (cùng localhost hoặc cùng public; Chromium Local Network Access).
- Lab tự host font (Be Vietnam Pro, OFL) và media Blockly; không tải gì từ trang nhúng hay CDN.

## 5. Phiên bản
```

with:

```markdown
  không dùng `confirm()`: **Đặt lại** cần bấm hai lần.
- Host và lab phải cùng không gian địa chỉ (cùng localhost hoặc cùng public; Chromium Local Network Access).
- Lab tự host font (Be Vietnam Pro, OFL) và media Blockly; không tải gì từ trang nhúng hay CDN. Media Blockly và
  favicon đi theo base path của bản build (`vite build --base /lab/` cũng chạy).
- **Bố cục theo khung** (N8s, chỉ launch `lab=`): khung rộng từ 800 px: mạch | chương trình, chương trình rộng hơn
  (62 %), có thanh kéo đổi độ rộng và nút thu gọn mạch; mạch được thu nhỏ cho vừa khung, khối khởi đầu luôn nằm
  trong tầm nhìn. Khung hẹp hơn 800 px: hai tab "Chương trình" / "Mạch"; Chạy và Kiểm tra tự chuyển sang tab Mạch.
  Trang không cuộn khi khung cao từ khoảng 600 px. Host không phải làm gì: iframe hiện tại
  (`h-[min(78dvh,56rem)] min-h-[32rem]`) vừa. Lab không lưu bố cục (mỗi lần mở là mặc định).

## 5. Phiên bản
```

**Replace in `docs/lab-embed-contract.md` (4/4):**

```markdown
`stem-lab/v1` chỉ được **thêm** trường hoặc `type` mới (bên nhận bỏ qua cái không biết). Đổi nghĩa hay bỏ trường
→ `stem-lab/v2`, và lab phải nói được cả hai trong thời gian chuyển tiếp.
```

with:

```markdown
`stem-lab/v1` chỉ được **thêm** trường hoặc `type` mới (bên nhận bỏ qua cái không biết). Đổi nghĩa hay bỏ trường
→ `stem-lab/v2`, và lab phải nói được cả hai trong thời gian chuyển tiếp.

N8s (2026-10-17) không đổi URL hay message nào: chỉ bố cục, Kiểm tra nhìn thấy được và tiếng Việt bên trong lab.
```

**Replace in `docs/stem-demo-implementation-plan.md` (1/3):**

```markdown
| S1 | Embed launch (cho CourseService) | — | S | — | 14 | B1, B8 |
| N6a | Lab embedding (`lab=`, `stem-lab/v1`, Kiểm tra, tiếng Việt) | — | M | — | S1, YB-3 | B1, B2, B8 |

Tổng cộng **14 task: 11 P0, 3 P1.** 23 hạng mục P2 nằm trong backlog §13. **S1** nằm ngoài roadmap PoC: nó là điều kiện của CourseService (T7, T9), không phải của hypothesis. **N6a** cũng vậy: nó là phần stem-demo của bản demo LMS (plan redesign STEMLearning §7, S0–S5).
```

with:

```markdown
| S1 | Embed launch (cho CourseService) | — | S | — | 14 | B1, B8 |
| N6a | Lab embedding (`lab=`, `stem-lab/v1`, Kiểm tra, tiếng Việt) | — | M | — | S1, YB-3 | B1, B2, B8 |
| N8s | Lab polish (bố cục khung nhúng, Kiểm tra nhìn thấy được, tiếng Việt của core) | — | S | — | N6a | B1, B2, B7 |

Tổng cộng **14 task: 11 P0, 3 P1.** 23 hạng mục P2 nằm trong backlog §13. **S1** nằm ngoài roadmap PoC: nó là điều kiện của CourseService (T7, T9), không phải của hypothesis. **N6a** cũng vậy: nó là phần stem-demo của bản demo LMS (plan redesign STEMLearning §7, S0–S5).
```

**Replace in `docs/stem-demo-implementation-plan.md` (2/3):**

```markdown
- CSP `frame-ancestors`, deploy.

---

```

with:

```markdown
- CSP `frame-ancestors`, deploy.

*(N8s đã làm hai mục đầu (phần text) và mục `BlocklyPanel`, xem dưới.)*

### N8s — Lab polish (sau demo-v1)

`Ngoài roadmap PoC · S · Phụ thuộc: N6a · Plan: docs/superpowers/plans/2026-10-17-n8s-lab-polish.md`

**Evidence (test trình duyệt end-to-end của demo-v1).** Nhúng ở ~1000 px, canvas chiếm 60 % nên vùng khối hẹp và
khối khởi đầu nằm nửa ngoài màn hình; ở ~670 px (tablet 1024×768) vùng chương trình bị đẩy xuống dưới nếp gấp.
Trong lúc Kiểm tra, màn hình 5×5 *có* đổi (✓ ở 205 ms, ✗ ở 853 ms — đo lại khi dry-run) nhưng lượt chạy chỉ 1–2 s
rồi tắt, các lần bấm của kịch bản không hiện ở đâu, nên học sinh chỉ thấy danh sách mục tiêu. Câu lỗi launch và
thông báo của core vẫn tiếng Anh; `/favicon.ico` 404.

**Đã làm**
- Bố cục `lab=`: chương trình 62 %, thanh kéo (bàn phím + chuột), thu gọn mạch; < 800 px: tab "Chương trình" /
  "Mạch", Chạy và Kiểm tra chuyển sang Mạch; canvas tự thu nhỏ cho vừa (viewport scale + offset trong
  `viewport.ts`, B7); khối khởi đầu được thu nhỏ vào tầm nhìn (chỉ đổi view, không đổi document); Python thu gọn
  lúc mở. Standalone và lab S1 giữ bố cục cũ.
- Kiểm tra nhìn thấy được: chính lượt chạy được chấm, các input của kịch bản vẽ lên bo mạch và nút điều khiển
  (`checkSessionOf(runStore, observer)`, lớp UI), thanh tiến độ, giữ khung cuối. Bộ chấm trong core không đổi.
- Tiếng Việt: `src/ui/i18n/core-text.ts` dịch thông báo của core và lý do launch hỏng theo từng khung câu (core
  không có locale, B1); test đọc nguồn của core để bắt câu mới chưa dịch. Nhãn Konva qua `src/ui/i18n/devices.ts`.
- Nhỏ: favicon SVG tự vẽ, media Blockly theo `BASE_URL` (S6), bỏ `describeTone`.
- Test: 4 E2E `ybc-python` trên macOS (`ControlOrMeta`, phím copy theo nền tảng), test thời gian đo bằng CPU time
  (`__fixtures__/cpu-clock.ts`, giữ nguyên ngưỡng, thêm trần wall-clock), cổng E2E đổi được (`E2E_PORT`).

**Không đổi**: `stem-lab/v1` (URL, message), compile → IR → MicroPython, `src/core/challenge`.

---

```

**Replace in `docs/stem-demo-implementation-plan.md` (3/3):**

```markdown
| M3 | 2026-10-03 | L3 (built-in), L5, L6 | Xem "M3 — chi tiết" bên dưới | L3 ✅ · L5 ✅ · L6 ✅ · L8 ⚠️ (chỉ có lần chạy của agent) | Không đổi kiến trúc. IR của `if` dùng danh sách nhánh; điều kiện bỏ trống là lỗi (C8) |
| N6a | 2026-10-16 | Lab nhúng cho LMS có chấm bài được không mà không đưa logic LMS vào stem-demo? | Mục N6a ở §9.2; `pnpm verify`; `e2e/ybc-embed.spec.ts` | ✅ Challenge là dữ liệu template + evaluator thuần trong core, bridge chỉ ở UI | Scope mở rộng có ghi (§9.2 N6a); quy ước ngôn ngữ UI đổi (CLAUDE.md) |
| M4 | 2026-10-03 | L7 (+ B8) | Xem "M4 — chi tiết" bên dưới | L7 ✅ · B8 ✅ · L8 ⚠️ (chỉ có lần chạy của agent) | Kiểm tra lúc load gồm cả I1–I3, registry, và program do Blockly phán sau một preflight giới hạn công việc (§6.1, §7). Không đổi kiến trúc |

```

with:

```markdown
| M3 | 2026-10-03 | L3 (built-in), L5, L6 | Xem "M3 — chi tiết" bên dưới | L3 ✅ · L5 ✅ · L6 ✅ · L8 ⚠️ (chỉ có lần chạy của agent) | Không đổi kiến trúc. IR của `if` dùng danh sách nhánh; điều kiện bỏ trống là lỗi (C8) |
| N6a | 2026-10-16 | Lab nhúng cho LMS có chấm bài được không mà không đưa logic LMS vào stem-demo? | Mục N6a ở §9.2; `pnpm verify`; `e2e/ybc-embed.spec.ts` | ✅ Challenge là dữ liệu template + evaluator thuần trong core, bridge chỉ ở UI | Scope mở rộng có ghi (§9.2 N6a); quy ước ngôn ngữ UI đổi (CLAUDE.md) |
| N8s | 2026-10-17 | Lab nhúng dùng được trong khung 600–1000 px, Kiểm tra nhìn thấy được, tiếng Việt trọn vẹn — mà không đổi hợp đồng? | Mục N8s ở §9.2; `e2e/lab-layout.spec.ts`, `e2e/lab-check.spec.ts`; `pnpm e2e` xanh hoàn toàn | ✅ Bố cục và dịch thuật thuần lớp UI; `stem-lab/v1` không đổi | Timing test đo CPU time (máy bận không còn làm fail) |
| M4 | 2026-10-03 | L7 (+ B8) | Xem "M4 — chi tiết" bên dưới | L7 ✅ · B8 ✅ · L8 ⚠️ (chỉ có lần chạy của agent) | Kiểm tra lúc load gồm cả I1–I3, registry, và program do Blockly phán sau một preflight giới hạn công việc (§6.1, §7). Không đổi kiến trúc |

```

**Replace in `docs/superpowers/plans/2026-10-16-n6a-lab-embedding.md`:**

```markdown
## Deferred (ghi lại, không làm ở N6a)

- **N6b (STEMLearning):** preview `LabFrame` trong editor CMS (sau N5); chặn `requiresCheck=true` với `empty`/`ybc-empty` (R7).
- Diagnostic của core (compiler/runtime) và lỗi nối dây trên canvas vẫn tiếng Anh; nhãn Konva lấy từ device definition ("Bit-compatible Board", "Light", "Buzzer") vẫn tiếng Anh.
```

with:

```markdown
## Deferred (ghi lại, không làm ở N6a)

> **N8s (2026-10-17, `docs/superpowers/plans/2026-10-17-n8s-lab-polish.md`)** đã làm: diagnostic của core, lỗi nối
> dây và nhãn Konva bằng tiếng Việt (lab `lab=`); S6 media Blockly theo `BASE_URL`; 4 E2E `ybc-python` trên macOS;
> flake thời gian (đo CPU time). Còn lại: N6b, template nâng cao, CSP/deploy.

- **N6b (STEMLearning):** preview `LabFrame` trong editor CMS (sau N5); chặn `requiresCheck=true` với `empty`/`ybc-empty` (R7).
- Diagnostic của core (compiler/runtime) và lỗi nối dây trên canvas vẫn tiếng Anh; nhãn Konva lấy từ device definition ("Bit-compatible Board", "Light", "Buzzer") vẫn tiếng Anh.
```

**Replace in `docs/yolobit-compatible-board-implementation-plan.md` (1/2):**

```markdown
  - **event block, nếu gate EV không đạt** (§6.6).
- `postMessage`/chấm bài/completion mới; lưu bài làm trong lab nhúng. *(N6a, 2026-10-16: đã làm ngoài plan này, theo plan redesign STEMLearning §7: `stem-lab/v1`, Kiểm tra, `load-project`/`project-changed`; lab vẫn không lưu gì. Xem docs/lab-embed-contract.md và stem-demo plan §9.2 N6a.)*
- Viết lại i18n; layout mobile đầy đủ. *(N6a: lab `lab=` nói tiếng Việt qua từ điển UI; standalone giữ tiếng Anh.)*
- Bluetooth, Wi-Fi, MQTT, radio, IoT; module cần thư viện ngoài firmware chuẩn.
- Robot simulator.
```

with:

```markdown
  - **event block, nếu gate EV không đạt** (§6.6).
- `postMessage`/chấm bài/completion mới; lưu bài làm trong lab nhúng. *(N6a, 2026-10-16: đã làm ngoài plan này, theo plan redesign STEMLearning §7: `stem-lab/v1`, Kiểm tra, `load-project`/`project-changed`; lab vẫn không lưu gì. Xem docs/lab-embed-contract.md và stem-demo plan §9.2 N6a.)*
- Viết lại i18n; layout mobile đầy đủ. *(N6a: lab `lab=` nói tiếng Việt qua từ điển UI; standalone giữ tiếng Anh. N8s: cả thông báo của core và nhãn bo mạch; lab `lab=` dưới 800 px dùng tab Chương trình / Mạch — chưa phải layout mobile đầy đủ.)*
- Bluetooth, Wi-Fi, MQTT, radio, IoT; module cần thư viện ngoài firmware chuẩn.
- Robot simulator.
```

**Replace in `docs/yolobit-compatible-board-implementation-plan.md` (2/2):**

```markdown
- ~~`postMessage`/chấm bài~~ (N6a); lưu bài làm trong lab (host giữ, lab không lưu); i18n ngoài lab `lab=`.
- Module cần thư viện; giao tiếp; game; nhiều board.
- Màu/độ sáng display (nếu chưa qua EG); layout mobile.
- Ngôn ngữ mới cho board generic; robot.

```

with:

```markdown
- ~~`postMessage`/chấm bài~~ (N6a); lưu bài làm trong lab (host giữ, lab không lưu); i18n ngoài lab `lab=`.
- Module cần thư viện; giao tiếp; game; nhiều board.
- Màu/độ sáng display (nếu chưa qua EG); layout mobile (lab `lab=` có tab dưới 800 px từ N8s; standalone chưa).
- Ngôn ngữ mới cho board generic; robot.

```

- [ ] **Step 2: Check that the core is untouched and the contract still compatible**

Run: `git diff --stat 9cdd6b3 -- src/core ':(exclude)*.test.ts' ':(exclude)**/__fixtures__/**'`

Expected: no output.

Run: `git diff 9cdd6b3 -- src/ui/app/host-bridge.ts src/ui/app/lab-host.ts src/ui/app/launch.ts`

Expected: no output (`stem-lab/v1` and the launch URL untouched).

- [ ] **Step 3: Run the gate and the whole E2E suite**

Run: `pnpm verify`

Expected: `Test Files  141 passed (141)`, `Tests  4572 passed | 1 skipped (4573)`.

Run:

```bash
lsof -nP -iTCP:5273 -sTCP:LISTEN   # expected: no output
E2E_PORT=5273 pnpm e2e
```

Expected: `147 passed`, nothing failed or flaky.

- [ ] **Step 4: Commit**

```bash
git add docs/lab-embed-contract.md docs/stem-demo-implementation-plan.md docs/yolobit-compatible-board-implementation-plan.md docs/superpowers/plans/2026-10-16-n6a-lab-embedding.md
git add docs/superpowers/plans/2026-10-17-n8s-lab-polish.md   # this plan, if it is not committed yet
git commit -m "$(cat <<'EOF'
docs(n8s): record N8s in the contract and the plans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (yêu cầu → task)

| Yêu cầu N8s | Task |
|---|---|
| 1. Bố cục `lab=`: Blockly là phần lớn, separator kéo được, canvas zoom-to-fit, thu gọn mạch, khối khởi đầu trong tầm nhìn; dưới ~800 px tab "Chương trình / Mạch", không cuộn trang trong iframe ~600 px; standalone không đổi | 4 (fit), 5 |
| 2. Kiểm tra chạy trước mắt (cùng simulation bộ chấm quan sát), rồi hiện kết quả; nút A/B, ánh sáng của inputScript có bấm ảo; logic chấm thuần trong core | 6 (core không đổi, Task 7 bước 2 kiểm) |
| 3. Tiếng Việt: chi tiết LaunchError, thông báo của core (compile/runtime/nối dây), nhãn Konva, qua overlay ở UI, chỉ cho `lab=`; tiếng Anh nơi khác không đổi | 3 |
| 4. Favicon SVG tự vẽ; bỏ `describeTone` (đã xác minh không dùng); S6 `BASE_URL` trong `BlocklyPanel.tsx` | 2 |
| 5. 4 E2E macOS (`ControlOrMeta`), timing test bền khi máy bận mà không nới điều chúng khẳng định | 1 (CPU time, ngưỡng giữ nguyên) |
| 6. Docs: contract (vẫn tương thích), hai plan theo §15 | 7 |
| Ràng buộc: không import STEMLearning, không khái niệm LMS, standalone + compile → IR → MicroPython không đổi, B1, `stem-lab/v1` tương thích ngược | Global Constraints; Task 7 bước 2 |
| `pnpm e2e` cuối cùng xanh hoàn toàn | 7 |

## Deferred (ghi lại, không làm ở N8s)

- **N6b (STEMLearning):** preview `LabFrame` trong CMS; chặn `requiresCheck=true` với `empty`/`ybc-empty`.
- Template Yolo:Bit nâng cao (`ybc-adv-*`, YB-8), bài B1–B10 (YB-6); bố trí lại khối của `ybc-button-ab` (khối rời đè lên "lặp mãi mãi" ở khung hẹp — thuộc dữ liệu template, key là hợp đồng).
- Zoom/pan canvas do người dùng (BL-E5); layout mobile cho standalone.
- Vẽ lần bấm tay của học sinh lên bo mạch (hiện chỉ bấm ảo của Kiểm tra được vẽ; nút điều khiển vẫn hiện lần bấm tay).
- Ẩn console rỗng ở standalone (R17 chỉ làm cho lab).
- CLAUDE.md nhắc `core-text.ts`/`devices.ts` (R19, việc của owner).
- CSP `frame-ancestors`, deploy.

## Dry-run

Dry-run 2026-10-16 trên máy này (12 core, server demo ở 5173 không bị đụng):

1. **Clone nháp** `…/scratchpad/n8s/dry` (từ `feat/lab-embedding` @ `9cdd6b3`): viết và thử từng task, chụp màn hình lab ở 1000×640, 820×600, 670×600 và trong lúc Kiểm tra; đo flake thời gian dưới tải (36 `yes`). Ở đó tìm ra: kỳ vọng `circuitBounds` của Blink (thân bo mạch 220, không phải 240), câu "X needs X, not X" / "X cannot be used in X" mà luật đầu tiên chưa khớp (luật được nới, có `place()`), `getAttribute` của Playwright chờ tới timeout chứ không trả `null`, flake "an invalid edit that is fixed again" khi chạy cả bộ (→ chờ editor Blockly, R15), console rỗng đẩy workspace xuống (→ R17), template starter của `ybc-heart` có vòng lặp mãi nên trạng thái là "Đang chạy".
2. **Replay** trên clone mới `…/scratchpad/n8s/replay` (cùng commit, `pnpm install --frozen-lockfile`): mọi khối Create/Replace của plan được áp **đúng như viết** bằng một script (mỗi `old` phải xuất hiện đúng một lần), rồi chạy lệnh của từng bước:

| Task | Bước "fail" | Sau khi làm | `pnpm verify` | E2E |
|---|---|---|---|---|
| 1 | dưới tải: 3 fail ở `ybc-heavy-expression` (`expected 94.8 to be less than 50`, …) | dưới tải: 3 file, 54 passed | 135 file, 4377 passed, 1 skipped | `ybc-python` ×3: 39 passed |
| 2 | `Cannot find module './media'`; smoke: timeout `getAttribute` | 2 file, 13 passed; `/lab/` dev + build đúng | 136 file, 4380 passed | smoke: 2 passed |
| 3 | `./core-text`, `./devices` thiếu; LaunchError vi fail | 3 file, 153 passed | 138 file, 4536 passed | ybc-embed + embed + canvas: 33 passed |
| 4 | 7/8 fail (`circuitBounds is not a function`, …) | 8 passed | 139 file, 4544 passed | lab-layout + canvas + vs2 + push-button: 19 passed |
| 5 | `./lab-layout`, `./fit` thiếu | 2 file, 15 passed | 141 file, 4565 passed | lab-layout + ybc-embed + ybc-python: 33 passed |
| 6 | 5 fail (run-store, RuntimeControls ×2, ybc-board-renderer ×2) | 3 file, 61 passed | 141 file, 4572 passed | lab-check + ybc-embed + lab-layout: 25 passed |
| 7 | — | `git diff` core (trừ test/fixture) rỗng; bridge/launch không đổi | 141 file, 4572 passed | **`pnpm e2e`: 147 passed, 0 failed** (chạy hai lần) |

Cây cuối của replay trùng từng byte với clone nháp. Dưới tải ~52–61, `pnpm test` xanh 3/3 lần (trước N8s: fail 3/3).
