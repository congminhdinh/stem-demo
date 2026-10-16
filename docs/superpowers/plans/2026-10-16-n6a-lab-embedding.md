# N6a — stem-demo lab embedding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** STEM Studio mở được hai loại lab mà app `learn` của STEMLearning đã ship (`BlocklyLab`, `YolobitLab`) qua `?embed=1&lab=…&template=…&origin=…[&profile=…]`, có template Yolo:Bit, nút **Kiểm tra** tự chấm, kênh `stem-lab/v1` với host, theme riêng và tiếng Việt — mà standalone, lab S1 cũ và đường compile → IR → MicroPython không đổi.

**Architecture:** URL được đọc một lần (`src/ui/app/launch.ts`). Template và challenge là dữ liệu (`src/samples`). Bộ chấm là TypeScript thuần trong `src/core/challenge` (B1): nó chạy chương trình qua `RunSession` (subscribe), đưa input theo kịch bản và chấm từng mục tiêu. Bridge `stem-lab/v1` chỉ ở lớp UI (`host-bridge.ts`, `lab-host.ts`), chỉ bật khi có `lab=` + `origin=` hợp lệ và lab nằm trong frame. Tiếng Việt là từ điển ở lớp UI (`src/ui/i18n`), text block được phủ lên ở UI, core không đổi.

**Tech Stack:** React 19.3, Vite 8.3, Vitest 4.1, TypeScript 6.0, Blockly 13.3 (renderer + theme Zelos, `blockly/msg/vi`), Konva 10.7 / react-konva 19.3, zustand 5, zod 4, Playwright 1.63 (Chromium), pnpm 12.8.1, `@fontsource/be-vietnam-pro` 5.3.0 (mới).

**Spec:** `/Users/hoangminh/.claude/plans/agile-conjuring-candy.md` — §7 (S0–S6, "Phía STEMLearning"), bảng "Quyết định đã chốt", §9 bước 4, §11, §12. Hợp đồng phía host (đã ship, read-only): `/Users/hoangminh/Desktop/stem/STEMLearning/Web/apps/learn/src/features/player/activities/lab/{lab-launch.ts,lab-protocol.ts,useLabBridge.ts,LabFrame.tsx}` và `Services/CourseService/Features/Activities/LabTemplateCatalog.cs`. Repo: `/Users/hoangminh/Desktop/stem/stem-demo`, branch `master` (làm trên branch riêng, vd. `n6a-lab-embedding`; controller commit/merge).

## Global Constraints

- stem-demo là sản phẩm độc lập: không import gì từ STEMLearning (code, package, token, font); không có khái niệm XP, lớp, tiến độ, hoàn thành trong stem-demo (spec "Quyết định đã chốt", §7).
- Hợp đồng duy nhất = launch URL + `stem-lab/v1`, ghi ở `docs/lab-embed-contract.md` (Task 10).
- Không đụng compile → IR → MicroPython codegen (`src/core/program/compile-*`, `src/core/codegen/**`): `git diff --stat master -- src/core/program src/core/codegen` phải rỗng ở cuối.
- Boundary B1: `src/core/**` không import `react`, `blockly`, `zustand`, `src/ui`, `src/storage`… (`pnpm lint` kiểm). `src/core/challenge` chỉ import core.
- Standalone (không `embed`/`template`/`lab`) và lab S1 (`?embed=1&template=<key>`, không `lab`) giữ nguyên hành vi: tiếng Anh, có New, không bridge, không Kiểm tra; `profile`/`origin` bị bỏ qua như mọi tham số lạ.
- `postMessage(msg, origin)` — **không bao giờ `'*'`**; chỉ nhận từ `window.parent` ở đúng `origin`; bỏ qua mọi thứ khác (spec §7 S3).
- Message đúng shape host đọc (`lab-protocol.ts`): `ready {template, profile, goals:[{id,label}]}`, `run-started`, `run-stopped`, `check-result {passed, goals:[{id,label,passed}]}`, `project-changed {document}` (debounce 1 s); host → lab `load-project {document}`. ≤ 50 goals, nhãn 1–200 ký tự.
- Key template (khớp `LabTemplateCatalog`): Blockly `blink`, `led-on`, `button-direct`, `button-led`, `empty`; Yolo:Bit `ybc-heart`, `ybc-button-ab`, `ybc-night-light`, `ybc-melody`, `ybc-empty`. `profile=ybc-basic|ybc-advanced`.
- Template Yolo:Bit chỉ dùng màn hình 5×5, nút A/B, cảm biến ánh sáng, loa; không đọc chân header (net hở → `out-of-domain`, spec §11).
- Dependency mới: pin chính xác, ≥ 2 tuần tuổi: `@fontsource/be-vietnam-pro@5.3.0` (publish 2026-07-19, SIL OFL 1.1). Cài bằng pnpm (lockfile `pnpm-lock.yaml`, `packageManager: pnpm@12.8.1`); không thêm gì khác.
- Ngôn ngữ (CLAUDE.md, cập nhật ở Task 5): identifier/comment tiếng Anh; chuỗi UI trong `src/ui/i18n/messages.ts` (`en` + `vi`); tài liệu tiếng Việt.
- Mỗi task: `pnpm verify` xanh trước khi commit; UI task chạy E2E liên quan; Task 9 chạy toàn bộ `pnpm e2e`.

## Review Focus

Năm điều spec ngụ ý nhưng dễ vỡ nhất với người dùng thật; mỗi dòng có test ở task sở hữu:

1. **Host gửi `load-project` với project của loại lab khác, hỏng, hoặc lúc đang chạy** → lab bỏ qua, giữ project đang có, không ném lỗi (Task 6, `lab-host.test.ts` "refuses …", "does nothing while a run locks the editor").
2. **Học sinh bấm Dừng (hoặc Đặt lại) giữa lúc Kiểm tra** → kiểm tra bị huỷ, không gửi `check-result`, mục tiêu về "chưa kiểm tra" (Task 3 `check-run.test.ts` "ends without a result…", Task 9 E2E "Stop during a check…").
3. **`origin=` viết gần đúng** (`/` cuối, có path, port mặc định, chữ hoa, `*`, `null`) → launch hỏng có lý do, không bao giờ bridge với origin sai (Task 2 `launch.test.ts` "refuses the origin …").
4. **Mở lab mà không sửa gì không được làm host lưu đè bài** → template viết đúng thứ tự key Blockly lưu, nên không có `project-changed` lúc mở (Task 1 "is saved by the editor exactly as written", Task 9 chuỗi message `ready, run-started, run-stopped, check-result`).
5. **Lab mở ở tab mới (nút "Mở trong tab mới" của host, cùng URL có `origin`)** → không có `window.parent` khác: không bridge, Kiểm tra vẫn chạy, không lỗi console (Task 9 E2E "a lab opened on its own").

## Rulings (quyết định tự chốt, có lý do)

| # | Chủ đề | Quyết định |
|---|---|---|
| R1 | Host vs spec | Host đã ship thắng: URL luôn có `lab=` và `origin=`, Yolo:Bit luôn có `profile=`. E2E của spec §12 viết `?embed=1&template=ybc-heart&origin=…` (thiếu `lab`); plan dùng đúng URL host dựng: `?embed=1&lab=yolobit&template=ybc-heart&origin=…&profile=ybc-basic`. Không thấy bug ở host. |
| R2 | `load-project` (P1 trong spec) | Làm luôn: `useLabBridge` của host gửi nó sau `ready` khi có bài đã lưu; thiếu thì học sinh mất bài mỗi lần mở lại. |
| R3 | `inputScript` (P1) | Làm luôn: không có nó thì `ybc-button-ab`, `ybc-night-light`, `ybc-melody` (và `button-led`, `button-direct`) không chấm được — đèn ngủ cần ánh sáng < 30 nhưng mặc định là 50. |
| R4 | Lab S1 legacy | Không `lab` ⇒ y như cũ (tiếng Anh, New, không bridge/Kiểm tra, bỏ qua `profile`/`origin`), chỉ thêm: nhận cả key `ybc-*` (đúng ý YB plan §17.2). Câu "Supported templates" của lỗi S1 vì vậy liệt kê 10 key; E2E cũ được cập nhật chuỗi này. |
| R5 | `origin` | Thiếu → lab chạy, không bridge. Có mà sai dạng → `LaunchError` (như key sai ở S1: trang nhúng phải biết URL hỏng). Bridge còn cần `window.parent !== window`. |
| R6 | Template Yolo:Bit | Là **bài khởi đầu**: board + chương trình + đúng một khối/chuỗi khối rời, bị vô hiệu hoá (`disabledReasons: ["ORPHANED_BLOCK"]`), đặt ở chỗ khung 1100×640 nhìn thấy; kéo vào là đạt ("kéo thả khối → Chạy → Kiểm tra → Đạt", spec §9). Template generic giữ nguyên (chung với `StemLab` cũ và E2E S1), nên Kiểm tra đạt ngay. Lời giải ở `src/samples/ybc-solutions.ts` (chỉ test/E2E import). |
| R7 | `empty`, `ybc-empty` | Không có challenge ⇒ không có nút Kiểm tra, `ready.goals = []`. Người soạn bài phải để `requiresCheck=false` (ghi trong contract; host chặn cấu hình này là việc của N6b). |
| R8 | `uses-block` | Chấm trên Blockly JSON (khối nối vào hat và không bị vô hiệu hoá), không trên IR: IR của cả hai dialect không giữ block type. Trường tên `blockType` (không `type`, tránh nhầm với `kind`). |
| R9 | `display-shows` | `frame` viết như `Image("…")` của contract: `"01010:11111:11111:01110:00100"`; thêm `fromMs` tuỳ chọn để chấm "sau khi bấm/đổi ánh sáng". So sáng/tắt, không so màu. |
| R10 | Lượt chạy của Kiểm tra | Chính là lượt chạy toolbar hiển thị (adapter `checkSessionOf(runStore)`): khoá editor, vẽ lên canvas, báo lỗi start như Chạy. Hết giờ thì dừng; Dừng giữa chừng ⇒ huỷ. `check-result` đến **sau** `run-stopped`. |
| R11 | Tiếng Việt | Chỉ launch `lab=` (và `lang=vi`); standalone + S1 giữ tiếng Anh nên 117 E2E cũ không phải sửa. Text block tiếng Việt phủ lên ở UI theo block type (`src/ui/i18n/blocks.ts`) thay vì thêm tham số locale vào core: core không đổi dòng nào, B1 vẫn giữ (spec chỉ yêu cầu "không import UI vào core"). Diagnostic của core vẫn tiếng Anh (deferred). |
| R12 | Bảng màu Konva | File là `src/ui/canvas/colors.ts`, không phải `palette.ts`: trên ổ macOS không phân biệt hoa thường, `import './Palette'` (component đã có) sẽ trỏ nhầm sang `palette.ts` (đã gặp khi dry-run: TS2305). Giá trị giữ nguyên ⇒ canvas trông như cũ. |
| R13 | Đặt lại | Bấm hai lần (nhãn đổi thành "Bấm lần nữa để đặt lại" trong 4 s): iframe của host không có `allow-modals`, `confirm()` luôn trả `false`. |
| R14 | Font | `@fontsource/be-vietnam-pro@5.3.0` (OFL, 2026-07-19), Vite bundle ⇒ tự host cùng origin (dev server có COEP `require-corp`, CDN sẽ bị chặn). Chờ font tối đa 1,5 s trước khi render vì Blockly đo chữ một lần. |
| R15 | Key bài Yolo:Bit | 5 key của host/spec thay danh sách B1–B10 đề xuất trong YB plan §14 (ghi chú ở Task 10). |
| R16 | Nhãn mục tiêu | Dữ liệu template mang cả `en` và `vi`; lab gửi nhãn theo ngôn ngữ của nó. |

## Môi trường (đã gặp khi dry-run trên máy này)

- `pnpm` global là 10.x; repo đòi `pnpm@12.8.1` và shim của bản 12.8.1 ở `~/Library/pnpm/.tools/pnpm/12.8.1/bin/pnpm` không có shebang ⇒ `spawnSync … ENOEXEC`. Cách chạy: `sh ~/Library/pnpm/.tools/pnpm/12.8.1/node_modules/pnpm/pnpm <lệnh>`, hoặc đặt một wrapper `pnpm` (`#!/bin/sh` + `exec sh …/node_modules/pnpm/pnpm "$@"`) lên đầu `PATH`. Cài lần đầu: `pnpm install --frozen-lockfile`.
- Playwright browsers đã có (`~/Library/Caches/ms-playwright/chromium_headless_shell-1243`). **Baseline trên `master` (2026-10-16): `pnpm e2e` = 117 passed, 4 failed**, cả 4 ở `e2e/ybc-python.spec.ts` (dòng 178, 186, 195, 204: phím Cmd+C/Ctrl+C của macOS) — có từ trước, ngoài scope; đừng sửa, đừng tính là hồi quy.
- `src/core/program/ybc-heavy-expression.test.ts` ("leaves the event loop free… longest gap stays small", "is stopped promptly…") (cùng `ybc-responsiveness.test.ts` và timeout 5 s của `editor-blocks.test.ts`) đo thời gian thật: fail khi máy bận (dry-run: fail cả trên clone `master` chưa sửa khi load average ~65 vì build khác chạy song song; xanh khi máy rảnh). Có từ trước, ngoài scope; đó là failure duy nhất được bỏ qua.
- Playwright không nạp JSON import thiếu `with { type: 'json' }` ⇒ file E2E không được import `src/samples/templates.ts` (nó import `*.project.json`).

## File Structure

| File | Trách nhiệm | Task |
|---|---|---|
| `src/samples/ybc-templates.ts` | 5 key Yolo:Bit, profile của lab, board id, hình mẫu, builder JSON đúng thứ tự Blockly, bài khởi đầu | 1 |
| `src/samples/ybc-solutions.ts` | Lời giải của 4 bài (test/E2E) | 1 |
| `src/samples/templates.ts` | Thêm `genericTemplateKeys`, `LabKind`, `labOfTemplate`, `templateKeysOf`, `createTemplateProject(key, {profile})` | 1 |
| `src/ui/app/launch.ts` | `lab`, `profile`, `origin`; `LabLaunch`; `isPageOrigin` | 2 |
| `src/ui/app/startup.ts`, `LaunchError.tsx` | Profile vào template; lỗi liệt kê key của lab | 2 (LaunchError dịch ở 5) |
| `src/core/challenge/*` | `Goal`, `Challenge`, `CheckResult`, `parseFrame`, `runningBlockTypes`, `createGoalTracker`, `runCheck` | 3 |
| `src/samples/challenges.ts` | Challenge (song ngữ) của từng template | 4 |
| `src/ui/i18n/*` | `messages.ts` (en/vi), `locale.ts`, `text.tsx` (`TextProvider`, `useText`), `blocks.ts` (text block + toolbox tiếng Việt) | 5 (+ khoá `lab.*` ở 7) |
| `src/ui/blockly/locale.ts` | `applyEditorLocale`: `blockly/msg/vi` + locale của block | 5 |
| `src/ui/app/host-bridge.ts` | `stem-lab/v1`: gửi/nhận, lọc origin, debounce | 6 |
| `src/ui/app/lab-host.ts` | Nối store ↔ bridge; kiểm `load-project` | 6 |
| `src/ui/state/run-store.ts` | `run()` trả `StartResult`, `latestSnapshot()`, `checkSessionOf` | 7 |
| `src/ui/app/ChallengePanel.tsx`, `App.tsx`, `RunToolbar.tsx` | Chrome lab: tiêu đề, ẩn New, Kiểm tra, mục tiêu, Đặt lại | 7 |
| `src/ui/app/app.css` | Token CSS, chrome lab, layout co giãn | 7, 8 |
| `src/ui/app/fonts.ts`, `src/ui/blockly/theme.ts`, `src/ui/canvas/colors.ts` | Font tự host, theme Blockly, bảng màu canvas | 8 |
| `src/main.tsx` | Composition root: locale, font, bridge, chrome lab | 2, 5, 6, 7, 8 |
| `e2e/lesson-host.mjs`, `e2e/ybc-embed.spec.ts` | Ghi/gửi message ở trang bài học; E2E N6a | 9 |
| `docs/lab-embed-contract.md` + 2 plan | Hợp đồng và ghi nhận scope (§15) | 10 |

Thứ tự task là thứ tự phụ thuộc: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 (7 dùng khoá dịch của 5 và bridge của 6; 8 chạy script token hoá CSS trên CSS mà 7 vừa thêm).

---

### Task 1: Yolo:Bit lab templates (S1)  — `model: sonnet`

Thêm 5 key `ybc-*` mà CourseService đã cho phép (`LabTemplateCatalog.DefaultYolobit`) và lời giải của chúng. Template Yolo:Bit là bài khởi đầu (R6): một khối rời, bị vô hiệu hoá như Blockly đánh dấu orphan, mà học sinh kéo vào. JSON được viết **đúng thứ tự key Blockly lưu** (`type, id, x, y, disabledReasons, extraState, fields, inputs, next`) để mở lab không làm Blockly lưu lại (không sinh `project-changed`, Review Focus 4). Template generic không đổi; hai test baseline cũ được thu hẹp về `genericTemplateKeys` vì key mới cố ý là Yolo:Bit.

**Files:**
- Modify: `e2e/embed.spec.ts`
- Modify: `src/samples/templates.test.ts`
- Modify: `src/samples/templates.ts`
- Create: `src/samples/ybc-solutions.ts`
- Create: `src/samples/ybc-templates.test.ts`
- Create: `src/samples/ybc-templates.ts`
- Modify: `tests/fixture-leakage.test.ts`
- Modify: `tests/generic-baseline.test.ts`

**Interfaces:**
- Consumes: `projectDocumentSchema`, `createNewProject` (`src/core/circuit/document.ts`); block types `ybc_display_show_image` (fields `R{row}C{col}` boolean), `ybc_display_clear`, `ybc_button_pressed` (`BUTTON`), `ybc_light_level`, `ybc_sound_note` (`NOTE`, `TICKS` string), `controls_if`, `logic_compare`, `math_number`, hats `stem_on_start` / `stem_forever`.
- Produces (`src/samples/ybc-templates.ts`): `ybcTemplateKeys`, `type YbcTemplateKey`, `ybcLabProfiles = ['ybc-basic','ybc-advanced']`, `type YbcLabProfile`, `ybcTemplateBoardId = 'ybc-board-1'`, `ybcImages {heart, check, cross, full}` (chuỗi `"01010:…"`), `ybcStarterDocument(key): Record<string, unknown>`, `isYbcTemplateKey(key)`, builders `showImage`, `clearDisplay`, `buttonPressed`, `playNote`, `ifBlock`, `lightBelow`, `melodyNotes`, `loose`, `ybcProgram`, `ybcProject`.
- Produces (`src/samples/ybc-solutions.ts`): `type YbcLessonKey = Exclude<YbcTemplateKey,'ybc-empty'>`, `ybcSolutionDocument(key): ProjectDocument`.
- Produces (`src/samples/templates.ts`): `genericTemplateKeys`, `templateKeys` (10 key, generic trước), `type TemplateKey`, `type LabKind = 'blockly' | 'yolobit'`, `labOfTemplate(key): LabKind`, `templateKeysOf(lab): TemplateKey[]`, `type TemplateOptions = { profile?: YbcLabProfile }`, `createTemplateProject(key, options?)`.

- [ ] **Step 1: Write the failing tests**

**Edit `e2e/embed.spec.ts`** (1 change(s), each `old` occurs exactly once):

**Replace in `e2e/embed.spec.ts`** (1):

```ts
    await expect(error).toContainText('This lab could not be opened.');
    await expect(error).toContainText(problem);
    await expect(error).toContainText('Supported templates: blink, led-on, button-direct, button-led, empty.');
    await expect(page.getByTestId('circuit-canvas')).toHaveCount(0);
    await expect(page.getByTestId('program-region')).toHaveCount(0);
```

with:

```ts
    await expect(error).toContainText('This lab could not be opened.');
    await expect(error).toContainText(problem);
    await expect(error).toContainText(
      'Supported templates: blink, led-on, button-direct, button-led, empty, ybc-heart, ybc-button-ab, ybc-night-light, ybc-melody, ybc-empty.',
    );
    await expect(page.getByTestId('circuit-canvas')).toHaveCount(0);
    await expect(page.getByTestId('program-region')).toHaveCount(0);
```

**Edit `src/samples/templates.test.ts`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/samples/templates.test.ts`** (1):

```ts
import buttonLedSample from './button-led.project.json';
import ledOnSample from './led-on.project.json';
import { createTemplateProject, isTemplateKey, templateKeys, type TemplateKey } from './templates';

const registry = createDeviceRegistry(localDeviceDefinitions);
```

with:

```ts
import buttonLedSample from './button-led.project.json';
import ledOnSample from './led-on.project.json';
import { createTemplateProject, isTemplateKey, labOfTemplate, templateKeys, templateKeysOf, type TemplateKey } from './templates';

const registry = createDeviceRegistry(localDeviceDefinitions);
```

**Replace in `src/samples/templates.test.ts`** (2):

```ts
describe('templates (S1)', () => {
  it('are exactly the keys of the launch contract', () => {
    expect(templateKeys).toEqual(['blink', 'led-on', 'button-direct', 'button-led', 'empty']);
  });

```

with:

```ts
describe('templates (S1)', () => {
  it('are exactly the keys of the launch contract', () => {
    expect(templateKeys).toEqual([
      'blink',
      'led-on',
      'button-direct',
      'button-led',
      'empty',
      'ybc-heart',
      'ybc-button-ab',
      'ybc-night-light',
      'ybc-melody',
      'ybc-empty',
    ]);
  });

  it('opens the ybc-* templates in a Yolo:Bit lab and every other one in a Blockly lab', () => {
    expect(templateKeysOf('blockly')).toEqual(['blink', 'led-on', 'button-direct', 'button-led', 'empty']);
    expect(templateKeysOf('yolobit')).toEqual(['ybc-heart', 'ybc-button-ab', 'ybc-night-light', 'ybc-melody', 'ybc-empty']);
    expect(labOfTemplate('blink')).toBe('blockly');
    expect(labOfTemplate('ybc-empty')).toBe('yolobit');
  });

```

**Replace in `src/samples/templates.test.ts`** (3):

```ts
  });

  it.each(['', 'Blink', 'BLINK', ' blink', 'blink ', 'sample-blink', 'button_led', 'constructor', '__proto__', 'toString'])(
    'refuses %j: keys match exactly',
    (value) => {
```

with:

```ts
  });

  it.each(['', 'Blink', 'BLINK', ' blink', 'blink ', 'sample-blink', 'button_led', 'constructor', '__proto__', 'toString', 'YBC-HEART', 'ybc_heart', 'ybc-'])(
    'refuses %j: keys match exactly',
    (value) => {
```

**Create `src/samples/ybc-templates.test.ts`:**

```ts
import * as Blockly from 'blockly';
import { describe, expect, it } from 'vitest';
import { generateForDocument } from '../core/codegen/yolobit/generate-document';
import type { ProjectDocument } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { productionProfiles } from '../core/profiles';
import { createBlockPackCatalog } from '../core/program/block-packs';
import { listBlocks } from '../core/program/block-walk';
import { compileYbcProgram } from '../core/program/compile-ybc-program';
import { canOpenProgram, registerBlocks } from '../ui/blockly/editor-blocks';
import { createTemplateProject } from './templates';
import { ybcSolutionDocument, type YbcLessonKey } from './ybc-solutions';
import { ybcLabProfiles, ybcTemplateBoardId, ybcTemplateKeys } from './ybc-templates';

// The Yolo:Bit templates (N6a S1) are starters: the board and the lesson's program with one loose, disabled
// block. They reach the expectation level of a lesson template (YB plan §8.6, §17.2: L-4, Python generated), and
// so do the finished programs the tests and the E2E use.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const lessonKeys: YbcLessonKey[] = ['ybc-heart', 'ybc-button-ab', 'ybc-night-light', 'ybc-melody'];

const pythonOf = (document: ProjectDocument) => generateForDocument(document, registry, productionProfiles, packs);
const compile = (document: ProjectDocument) =>
  compileYbcProgram(document.program.blocks, packs.typesOf(productionProfiles.get('ybc-basic')?.blockPacks ?? []));
/** What the editor saves after opening `blocks` untouched (real Blockly, headless). */
function savedByEditor(blocks: unknown) {
  registerBlocks(packs);
  const workspace = new Blockly.Workspace();
  try {
    Blockly.serialization.workspaces.load(blocks as Record<string, unknown>, workspace);
    return Blockly.serialization.workspaces.save(workspace);
  } finally {
    workspace.dispose();
  }
}
const topBlocks = (document: ProjectDocument) =>
  (document.program.blocks as { blocks: { blocks: { type: string; disabledReasons?: string[] }[] } }).blocks.blocks;

describe('Yolo:Bit templates (N6a S1)', () => {
  it.each(ybcTemplateKeys)('%s is a Basic project of one Yolo:Bit-compatible board', (key) => {
    const document = createTemplateProject(key);

    expect(document.id).toBe(`template-${key}`);
    expect(document.profile).toBe('ybc-basic');
    expect(document.circuit).toEqual({
      components: [{ id: ybcTemplateBoardId, deviceType: 'ybc-board', position: { x: 300, y: 220 } }],
      wires: [],
    });
  });

  it.each(ybcLabProfiles)('opens with the launch profile %s', (profile) => {
    expect(createTemplateProject('ybc-heart', { profile }).profile).toBe(profile);
  });

  it('ignores a profile for a generic template', () => {
    expect(createTemplateProject('blink', { profile: 'ybc-advanced' })).toEqual(createTemplateProject('blink'));
  });

  it.each(ybcTemplateKeys)('%s reaches L-4: it compiles without a diagnostic and Python is generated', (key) => {
    const document = createTemplateProject(key);

    expect(compile(document)).toMatchObject({ ok: true, diagnostics: [] });
    expect(pythonOf(document)).toMatchObject({ ok: true });
  });

  it.each(ybcTemplateKeys)('%s opens in the editor (real Blockly, every pack)', (key) => {
    expect(canOpenProgram(createTemplateProject(key).program.blocks, packs)).toBe(true);
  });

  // Written as the editor saves it, key order included: opening a lab changes nothing, so it sends no project-changed.
  it.each(ybcTemplateKeys)('%s is saved by the editor exactly as written', (key) => {
    const { blocks } = createTemplateProject(key).program;
    expect(JSON.stringify(savedByEditor(blocks))).toBe(JSON.stringify(blocks));
  });

  it.each(lessonKeys)('the solution of %s is saved by the editor exactly as written', (key) => {
    const { blocks } = ybcSolutionDocument(key).program;
    expect(JSON.stringify(savedByEditor(blocks))).toBe(JSON.stringify(blocks));
  });

  it.each(lessonKeys)('%s leaves exactly one loose block or stack, disabled as Blockly marks an orphan', (key) => {
    const loose = topBlocks(createTemplateProject(key)).filter((block) => block.type !== 'stem_on_start' && block.type !== 'stem_forever');

    expect(loose).toHaveLength(1);
    expect(loose[0]?.disabledReasons).toEqual(['ORPHANED_BLOCK']);
  });

  it('ybc-empty holds only the two hats', () => {
    expect(topBlocks(createTemplateProject('ybc-empty')).map((block) => block.type)).toEqual(['stem_on_start', 'stem_forever']);
  });

  it.each(lessonKeys)('the solution of %s attaches the loose block: same blocks, none disabled, still L-4', (key) => {
    const starter = createTemplateProject(key);
    const solution = ybcSolutionDocument(key);
    const types = (document: ProjectDocument) => listBlocks(document.program.blocks).map((block) => block.type).sort();

    expect(types(solution)).toEqual(types(starter));
    expect(JSON.stringify(solution.program.blocks)).not.toContain('disabledReasons');
    expect(topBlocks(solution).map((block) => block.type)).toEqual(['stem_on_start', 'stem_forever']);
    expect({ ...solution, program: null }).toEqual({ ...starter, program: null });
    expect(compile(solution)).toMatchObject({ ok: true, diagnostics: [] });
    expect(pythonOf(solution)).toMatchObject({ ok: true });
    expect(canOpenProgram(solution.program.blocks, packs)).toBe(true);
  });
});
```

**Edit `tests/fixture-leakage.test.ts`** (2 change(s), each `old` occurs exactly once):

**Replace in `tests/fixture-leakage.test.ts`** (1):

```ts
import { resolveBoardContext } from '../src/core/profiles/board-context';
import { toolbox } from '../src/core/program/blocks';
import { templateKeys, createTemplateProject } from '../src/samples/templates';
import { paletteItems } from '../src/ui/canvas/palette-model';

```

with:

```ts
import { resolveBoardContext } from '../src/core/profiles/board-context';
import { toolbox } from '../src/core/program/blocks';
import { genericTemplateKeys, templateKeys, createTemplateProject } from '../src/samples/templates';
import { paletteItems } from '../src/ui/canvas/palette-model';

```

**Replace in `tests/fixture-leakage.test.ts`** (2):

```ts
  });

  it('leaves the templates generic: no profile, no ybc device', () => {
    for (const key of templateKeys) {
      const document = createTemplateProject(key);
      expect(Object.hasOwn(document, 'profile'), key).toBe(false);
```

with:

```ts
  });

  // The ybc-* templates (N6a S1) are Yolo:Bit projects by design; the generic ones stay generic.
  it('leaves the generic templates generic: no profile, no ybc device', () => {
    for (const key of genericTemplateKeys) {
      const document = createTemplateProject(key);
      expect(Object.hasOwn(document, 'profile'), key).toBe(false);
```

**Edit `tests/generic-baseline.test.ts`** (2 change(s), each `old` occurs exactly once):

**Replace in `tests/generic-baseline.test.ts`** (1):

```ts
import buttonLedSample from '../src/samples/button-led.project.json';
import ledOnSample from '../src/samples/led-on.project.json';
import { createTemplateProject, templateKeys } from '../src/samples/templates';
import { productionProfiles } from '../src/core/profiles';
import { resolveBoardContext } from '../src/core/profiles/board-context';
```

with:

```ts
import buttonLedSample from '../src/samples/button-led.project.json';
import ledOnSample from '../src/samples/led-on.project.json';
import { createTemplateProject, genericTemplateKeys, templateKeys } from '../src/samples/templates';
import { productionProfiles } from '../src/core/profiles';
import { resolveBoardContext } from '../src/core/profiles/board-context';
```

**Replace in `tests/generic-baseline.test.ts`** (2):

```ts
  });

  it('keeps every template key', () => {
    expect(templateKeys).toEqual(['blink', 'led-on', 'button-direct', 'button-led', 'empty']);
  });
});
```

with:

```ts
  });

  it('keeps every generic template key, first in the list (the ybc-* keys of N6a come after them)', () => {
    expect(genericTemplateKeys).toEqual(['blink', 'led-on', 'button-direct', 'button-led', 'empty']);
    expect(templateKeys.slice(0, genericTemplateKeys.length)).toEqual([...genericTemplateKeys]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/samples tests/fixture-leakage.test.ts tests/generic-baseline.test.ts`

Expected: `FAIL` — `src/samples/ybc-templates.test.ts` cannot resolve `./ybc-solutions` / `./ybc-templates`, and `templates.test.ts` fails on `templateKeysOf` (not exported) and on the 10-key list.

- [ ] **Step 3: Implement**

**Replace the whole file `src/samples/templates.ts`:**

```ts
import { createNewProject, projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import blinkSample from './blink.project.json';
import buttonDirectSample from './button-direct.project.json';
import buttonLedSample from './button-led.project.json';
import ledOnSample from './led-on.project.json';
import { isYbcTemplateKey, ybcStarterDocument, ybcTemplateKeys, type YbcLabProfile } from './ybc-templates';

// The labs an embedding page can launch by key (S1, plan §9.2; N6a S1 adds the Yolo:Bit keys). The keys are
// a public contract: lesson content stores them, so a key is never renamed or reused. The documents stay
// inside the simulator; only keys travel.

/** The templates of a Blockly lab (`lab=blockly`), and of the legacy S1 launch. */
export const genericTemplateKeys = ['blink', 'led-on', 'button-direct', 'button-led', 'empty'] as const;

export const templateKeys = [...genericTemplateKeys, ...ybcTemplateKeys] as const;

export type TemplateKey = (typeof templateKeys)[number];

/** The two kinds of lab of the launch URL (`lab=`): block programming on a generic board, or the Yolo:Bit board. */
export type LabKind = 'blockly' | 'yolobit';

type GenericKey = (typeof genericTemplateKeys)[number];

const bundledSamples: Record<Exclude<GenericKey, 'empty'>, unknown> = {
  blink: blinkSample,
  'led-on': ledOnSample,
  'button-direct': buttonDirectSample,
  'button-led': buttonLedSample,
};

/** Exact, case-sensitive match against the list; no lookup on an object, so "constructor" is not a key. */
export function isTemplateKey(value: string): value is TemplateKey {
  return (templateKeys as readonly string[]).includes(value);
}

/** The lab a template opens in: the `ybc-*` templates are Yolo:Bit labs, every other one a Blockly lab. */
export function labOfTemplate(key: TemplateKey): LabKind {
  return isYbcTemplateKey(key) ? 'yolobit' : 'blockly';
}

/** The templates `lab` accepts, in the order of `templateKeys`. */
export function templateKeysOf(lab: LabKind): TemplateKey[] {
  return templateKeys.filter((key) => labOfTemplate(key) === lab);
}

export type TemplateOptions = {
  /** The board profile of a Yolo:Bit template (the launch's `profile=`); ignored for a generic template. */
  profile?: YbcLabProfile;
};

/**
 * A fresh document for `key`, the same on every call. It is a deep copy:
 * schema parsing alone would hand out the bundled sample's own program
 * object, so an edit of one launch could reach the next.
 */
export function createTemplateProject(key: TemplateKey, options: TemplateOptions = {}): ProjectDocument {
  if (isYbcTemplateKey(key)) {
    const document = projectDocumentSchema.parse(ybcStarterDocument(key));
    return options.profile ? { ...document, profile: options.profile } : document;
  }
  return key === 'empty'
    ? createNewProject('template-empty')
    : projectDocumentSchema.parse(structuredClone(bundledSamples[key]));
}
```

**Create `src/samples/ybc-solutions.ts`:**

```ts
import { projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import {
  buttonPressed,
  clearDisplay,
  ifBlock,
  lightBelow,
  melodyNotes,
  showImage,
  ybcImages,
  ybcProgram,
  ybcProject,
  type YbcTemplateKey,
} from './ybc-templates';

// The finished programs of the Yolo:Bit starters (tests and E2E only; the app never imports this file): each is
// its starter with the loose block attached where the lesson asks, so the template's challenge passes.

export type YbcLessonKey = Exclude<YbcTemplateKey, 'ybc-empty'>;

const solutions: Readonly<Record<YbcLessonKey, () => unknown>> = {
  'ybc-heart': () => ybcProject('ybc-heart', 'Trái tim', ybcProgram({ onStart: [showImage('heart', ybcImages.heart)], forever: [] })),
  'ybc-button-ab': () =>
    ybcProject(
      'ybc-button-ab',
      'Nút A/B',
      ybcProgram({
        onStart: [],
        forever: [
          ifBlock('if-buttons', [
            [buttonPressed('pressed-a', 'A'), [showImage('show-check', ybcImages.check)]],
            [buttonPressed('pressed-b', 'B'), [showImage('show-cross', ybcImages.cross)]],
          ]),
        ],
      }),
    ),
  'ybc-night-light': () =>
    ybcProject(
      'ybc-night-light',
      'Đèn ngủ',
      ybcProgram({
        onStart: [],
        forever: [ifBlock('if-dark', [[lightBelow('dark', 30), [showImage('show-full', ybcImages.full)]]], [clearDisplay('clear')])],
      }),
    ),
  'ybc-melody': () =>
    ybcProject(
      'ybc-melody',
      'Giai điệu',
      ybcProgram({ onStart: [], forever: [ifBlock('if-a', [[buttonPressed('pressed-a', 'A'), melodyNotes('melody')]])] }),
    ),
};

/** The finished project of a Yolo:Bit lesson template, new on every call. */
export const ybcSolutionDocument = (key: YbcLessonKey): ProjectDocument => projectDocumentSchema.parse(solutions[key]());
```

**Create `src/samples/ybc-templates.ts`:**

```ts
// The Yolo:Bit-compatible labs an embedding page can launch by key (N6a S1). Like the generic keys of
// templates.ts they are a public contract: CourseService stores them (LabTemplateCatalog.DefaultYolobit), so a
// key is never renamed or reused. Each template is a STARTER: the board, the program around the idea of the
// lesson, and one prepared block left loose (disabled, so it does not run) that the learner drags into place.
// The challenge of the template (challenges.ts) fails on the starter and passes once that block is in place
// (ybc-solutions.ts holds the finished programs the tests and the E2E use).
//
// Only the 5×5 display, buttons A/B, the light sensor and the buzzer are used: reading a header pin that is
// not driven stops the program (`out-of-domain`, YB plan §14 B9), so no template reads a pin.

type Json = Record<string, unknown>;

export const ybcTemplateKeys = ['ybc-heart', 'ybc-button-ab', 'ybc-night-light', 'ybc-melody', 'ybc-empty'] as const;

export type YbcTemplateKey = (typeof ybcTemplateKeys)[number];

/** The board profiles a Yolo:Bit lab can be launched with (`profile=`); a template opens with the first one. */
export const ybcLabProfiles = ['ybc-basic', 'ybc-advanced'] as const;

export type YbcLabProfile = (typeof ybcLabProfiles)[number];

/** The board of every Yolo:Bit template; challenges address its parts as `<board id>/<part>`. */
export const ybcTemplateBoardId = 'ybc-board-1';

/** Pictures as the contract writes `Image("…")`: five rows of five digits, top to bottom, 1 lit. */
export const ybcImages = {
  heart: '01010:11111:11111:01110:00100',
  check: '00000:00001:00010:10100:01000',
  cross: '10001:01010:00100:01010:10001',
  full: '11111:11111:11111:11111:11111',
} as const;

/** Blockly's reason for a block that is not attached to a hat; the editor keeps it until the block is attached. */
const orphaned = { disabledReasons: ['ORPHANED_BLOCK'] };

/** Statements linked by `next`, as Blockly saves a stack. */
function chain(statements: Json[]): Json | undefined {
  const [first, ...rest] = statements;
  if (!first) {
    return undefined;
  }
  const next = chain(rest);
  return next ? { ...first, next: { block: next } } : first;
}

const statementInput = (statements: Json[]) => {
  const first = chain(statements);
  return first ? { block: first } : undefined;
};

const hat = (type: 'stem_on_start' | 'stem_forever', id: string, y: number, body: Json[]): Json => {
  const DO = statementInput(body);
  return { type, id, x: 40, y, ...(DO ? { inputs: { DO } } : {}) };
};

export const showImage = (id: string, picture: string, extra: Json = {}): Json => ({
  type: 'ybc_display_show_image',
  id,
  ...extra,
  fields: Object.fromEntries(
    picture.split(':').flatMap((row, rowIndex) => [...row].map((digit, column) => [`R${rowIndex}C${column}`, digit === '1'])),
  ),
});

export const clearDisplay = (id: string): Json => ({ type: 'ybc_display_clear', id });

export const buttonPressed = (id: string, button: 'A' | 'B'): Json => ({ type: 'ybc_button_pressed', id, fields: { BUTTON: button } });

export const playNote = (id: string, note: string, ticks: 1 | 2 | 4): Json => ({
  type: 'ybc_sound_note',
  id,
  fields: { NOTE: note, TICKS: String(ticks) },
});

/** if / else if … / else, as Blockly saves it: `branches` are [condition, statements]. */
export function ifBlock(id: string, branches: [Json, Json[]][], otherwise?: Json[]): Json {
  const extraState = {
    ...(branches.length > 1 ? { elseIfCount: branches.length - 1 } : {}),
    ...(otherwise ? { hasElse: true } : {}),
  };
  const inputs: Json = {};
  branches.forEach(([condition, statements], index) => {
    inputs[`IF${index}`] = { block: condition };
    const body = statementInput(statements);
    if (body) {
      inputs[`DO${index}`] = body;
    }
  });
  const elseBody = otherwise ? statementInput(otherwise) : undefined;
  if (elseBody) {
    inputs.ELSE = elseBody;
  }
  return { type: 'controls_if', id, ...(Object.keys(extraState).length > 0 ? { extraState } : {}), inputs };
}

export const lightBelow = (id: string, threshold: number): Json => ({
  type: 'logic_compare',
  id,
  fields: { OP: 'LT' },
  inputs: {
    A: { block: { type: 'ybc_light_level', id: `${id}-light` } },
    B: { block: { type: 'math_number', id: `${id}-threshold`, fields: { NUM: threshold } } },
  },
});

/** The melody the ybc-melody lab plays: four notes of two ticks (250 ms each). */
export const melodyNotes = (prefix: string): Json[] => [
  playNote(`${prefix}-c4`, 'C4', 2),
  playNote(`${prefix}-e4`, 'E4', 2),
  playNote(`${prefix}-g4`, 'G4', 2),
  playNote(`${prefix}-c5`, 'C5', 2),
];

/**
 * A loose block or stack beside the program, disabled until the learner attaches it; keys in the order Blockly
 * saves them. It sits right of the empty "on start", where a lesson frame (1100×640) still shows it.
 */
export const loose = ({ type, id, ...rest }: Json): Json => ({ type, id, x: 230, y: 40, ...orphaned, ...rest });

/** The parts of a Yolo:Bit program: what `on start` and `forever` hold, and the loose blocks beside them. */
export type YbcProgramParts = { onStart: Json[]; forever: Json[]; loose?: Json[] };

/** The blocks of a program, as Blockly saves a workspace (no variables: no template uses one). */
export function ybcProgram(parts: YbcProgramParts): Json {
  return {
    blocks: {
      languageVersion: 0,
      blocks: [hat('stem_on_start', 'on-start', 40, parts.onStart), hat('stem_forever', 'forever', 220, parts.forever), ...(parts.loose ?? [])],
    },
  };
}

/** A project of one Yolo:Bit-compatible board and `program`, in the shape the schema parses. */
export function ybcProject(key: YbcTemplateKey, name: string, program: Json): Json {
  return {
    schemaVersion: 1,
    id: `template-${key}`,
    name,
    profile: ybcLabProfiles[0],
    circuit: {
      components: [{ id: ybcTemplateBoardId, deviceType: 'ybc-board', position: { x: 300, y: 220 } }],
      wires: [],
    },
    program: { blocks: program },
  };
}

const starters: Readonly<Record<YbcTemplateKey, () => Json>> = {
  // Drag "show image" (the heart) into "on start".
  'ybc-heart': () =>
    ybcProject('ybc-heart', 'Trái tim', ybcProgram({ onStart: [], forever: [], loose: [loose(showImage('heart', ybcImages.heart))] })),
  // A shows ✓ already; drag the ✗ picture into the "else if B" branch.
  'ybc-button-ab': () =>
    ybcProject(
      'ybc-button-ab',
      'Nút A/B',
      ybcProgram({
        onStart: [],
        forever: [
          ifBlock('if-buttons', [
            [buttonPressed('pressed-a', 'A'), [showImage('show-check', ybcImages.check)]],
            [buttonPressed('pressed-b', 'B'), []],
          ]),
        ],
        loose: [loose(showImage('show-cross', ybcImages.cross))],
      }),
    ),
  // Bright: clear. Drag the full picture into "if light level < 30".
  'ybc-night-light': () =>
    ybcProject(
      'ybc-night-light',
      'Đèn ngủ',
      ybcProgram({
        onStart: [],
        forever: [ifBlock('if-dark', [[lightBelow('dark', 30), []]], [clearDisplay('clear')])],
        loose: [loose(showImage('show-full', ybcImages.full))],
      }),
    ),
  // Drag the melody (four notes) into "if button A is pressed".
  'ybc-melody': () =>
    ybcProject(
      'ybc-melody',
      'Giai điệu',
      ybcProgram({
        onStart: [],
        forever: [ifBlock('if-a', [[buttonPressed('pressed-a', 'A'), []]])],
        loose: [loose(chain(melodyNotes('melody')) ?? {})],
      }),
    ),
  'ybc-empty': () => ybcProject('ybc-empty', 'Untitled', ybcProgram({ onStart: [], forever: [] })),
};

/** The starter of `key` as plain JSON, new on every call (templates.ts parses it). */
export const ybcStarterDocument = (key: YbcTemplateKey): Json => starters[key]();

/** Whether `key` is one of the Yolo:Bit keys (exact, case-sensitive). */
export const isYbcTemplateKey = (key: string): key is YbcTemplateKey => (ybcTemplateKeys as readonly string[]).includes(key);
```

- [ ] **Step 4: Run the tests and the whole gate**

Run: `pnpm vitest run src/samples tests/fixture-leakage.test.ts tests/generic-baseline.test.ts`

Expected: all listed files pass (`Test Files  5 passed`).

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  121 passed`, `Tests  4099 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 5: Commit**

```bash
git add e2e/embed.spec.ts src/samples/templates.test.ts src/samples/templates.ts src/samples/ybc-solutions.ts src/samples/ybc-templates.test.ts src/samples/ybc-templates.ts tests/fixture-leakage.test.ts tests/generic-baseline.test.ts
git commit -m "$(cat <<'EOF'
feat(n6a): add the Yolo:Bit lab templates (S1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 2: Launch params: lab, profile, origin (S0)  — `model: sonnet`

`parseLaunch` đọc thêm `lab=blockly|yolobit`, `profile=` (chỉ `yolobit`) và `origin=` (page origin chính xác, R5). Thiếu `lab` ⇒ launch S1 như cũ (R4). Sai cặp ⇒ `invalid` kèm `lab` để màn lỗi liệt kê key của lab đó. `openAtStartup` mở template với profile của launch. Lý do lỗi giữ tiếng Anh (cho người viết URL); khung màn lỗi được dịch ở Task 5.

**Files:**
- Modify: `src/main.tsx`
- Create: `src/ui/app/LaunchError.test.tsx`
- Modify: `src/ui/app/LaunchError.tsx`
- Modify: `src/ui/app/launch.test.ts`
- Modify: `src/ui/app/launch.ts`
- Modify: `src/ui/app/startup.test.ts`
- Modify: `src/ui/app/startup.ts`

**Interfaces:**
- Consumes (Task 1): `isTemplateKey`, `labOfTemplate`, `templateKeysOf`, `type LabKind`, `createTemplateProject(key, { profile })`, `ybcLabProfiles`, `type YbcLabProfile`.
- Produces (`src/ui/app/launch.ts`): `type LabLaunch = { kind: LabKind; profile: YbcLabProfile | null; hostOrigin: string | null }`; `type Launch = { mode: 'standalone' } | { mode: 'embed'; template: TemplateKey; lab?: LabLaunch } | { mode: 'invalid'; problem: string; lab?: LabKind }`; `parseLaunch(search: string): Launch`; `isPageOrigin(value: string): boolean`.
- Produces (`src/ui/app/startup.ts`): `Startup` launch-error variant gains `lab?: LabKind`.
- Produces (`src/ui/app/LaunchError.tsx`): `LaunchError({ problem, lab? })`.

- [ ] **Step 1: Write the failing tests**

**Create `src/ui/app/LaunchError.test.tsx`:**

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LaunchError } from './LaunchError';

describe('LaunchError (S1, N6a S0)', () => {
  it('lists every template for a legacy launch', () => {
    expect(renderToStaticMarkup(<LaunchError problem="Unknown template &quot;x&quot;." />)).toContain(
      'Supported templates: blink, led-on, button-direct, button-led, empty, ybc-heart, ybc-button-ab, ybc-night-light, ybc-melody, ybc-empty.',
    );
  });

  it('lists only the templates of the lab a lab launch named', () => {
    expect(renderToStaticMarkup(<LaunchError problem="p" lab="yolobit" />)).toContain(
      'Supported templates: ybc-heart, ybc-button-ab, ybc-night-light, ybc-melody, ybc-empty.',
    );
    expect(renderToStaticMarkup(<LaunchError problem="p" lab="blockly" />)).toContain(
      'Supported templates: blink, led-on, button-direct, button-led, empty.',
    );
  });
});
```

**Replace the whole file `src/ui/app/launch.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { templateKeys, templateKeysOf } from '../../samples/templates';
import { parseLaunch } from './launch';

describe('parseLaunch (S1 launch contract)', () => {
  it.each(['', '?', '?lang=vi', '?embedded=1', '?Embed=1&Template=blink'])(
    'opens the standalone editor for %j: no embed, no template',
    (search) => {
      expect(parseLaunch(search)).toEqual({ mode: 'standalone' });
    },
  );

  it.each(templateKeys)('opens an embedded lab for ?embed=1&template=%s', (key) => {
    expect(parseLaunch(`?embed=1&template=${key}`)).toEqual({ mode: 'embed', template: key });
  });

  it('reads the parameters in any order, ignoring others', () => {
    expect(parseLaunch('?lang=vi&template=button-led&embed=1')).toEqual({ mode: 'embed', template: 'button-led' });
    expect(parseLaunch('embed=1&template=blink')).toEqual({ mode: 'embed', template: 'blink' });
  });

  it.each([
    ['blinky', '?embed=1&template=blinky'],
    ['Blink', '?embed=1&template=Blink'],
    [' blink', '?embed=1&template=%20blink'],
    ['sample-blink', '?embed=1&template=sample-blink'],
    ['constructor', '?embed=1&template=constructor'],
  ])('refuses the unknown template %j, naming it', (key, search) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem: `Unknown template "${key}".` });
  });

  it.each(['?embed=1', '?embed=1&template=', '?embed=1&template'])('refuses %j: the template is missing', (search) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem: 'No template was given: add template=<key>.' });
  });

  it.each([
    ['?template=blink', 'A template opens only in an embedded lab: add embed=1.'],
    ['?embed=true&template=blink', 'embed must be given once, as embed=1.'],
    ['?embed=0&template=blink', 'embed must be given once, as embed=1.'],
    ['?embed=0', 'embed must be given once, as embed=1.'],
    ['?embed=&template=blink', 'embed must be given once, as embed=1.'],
    ['?embed=1&embed=1&template=blink', 'embed must be given once, as embed=1.'],
    ['?embed=1&template=blink&template=led-on', 'template must be given once.'],
    ['?embed=1&template=blink&template=blink', 'template must be given once.'],
  ])('refuses the malformed launch %j', (search, problem) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem });
  });
});

describe('parseLaunch: lab, profile and origin (N6a S0)', () => {
  const host = 'http://localhost:3000';
  const lab = (kind: 'blockly' | 'yolobit', profile: string | null = null, hostOrigin: string | null = host) => ({ kind, profile, hostOrigin });

  it.each(templateKeysOf('blockly'))('opens the Blockly lab of %s', (key) => {
    expect(parseLaunch(`?embed=1&lab=blockly&template=${key}&origin=${host}`)).toEqual({ mode: 'embed', template: key, lab: lab('blockly') });
  });

  it.each(templateKeysOf('yolobit'))('opens the Yolo:Bit lab of %s, with or without a profile', (key) => {
    expect(parseLaunch(`?embed=1&lab=yolobit&template=${key}&origin=${host}`)).toEqual({ mode: 'embed', template: key, lab: lab('yolobit') });
    expect(parseLaunch(`?embed=1&lab=yolobit&template=${key}&origin=${host}&profile=ybc-advanced`)).toEqual({
      mode: 'embed',
      template: key,
      lab: lab('yolobit', 'ybc-advanced'),
    });
  });

  it('reads the URL the learn app builds (lab-launch.ts), percent-encoded origin included', () => {
    expect(parseLaunch('?embed=1&lab=yolobit&template=ybc-heart&origin=http%3A%2F%2Flocalhost%3A3000&profile=ybc-basic')).toEqual({
      mode: 'embed',
      template: 'ybc-heart',
      lab: lab('yolobit', 'ybc-basic'),
    });
  });

  it('opens a lab without origin: it works but has no host to talk to', () => {
    expect(parseLaunch('?embed=1&lab=blockly&template=blink')).toEqual({ mode: 'embed', template: 'blink', lab: lab('blockly', null, null) });
  });

  it.each(['https://school.example', 'http://lesson.localhost:5190', 'http://127.0.0.1:8080', 'https://xn--trng-hoa.vn'])(
    'accepts the page origin %s',
    (origin) => {
      expect(parseLaunch(`?embed=1&lab=blockly&template=blink&origin=${encodeURIComponent(origin)}`)).toMatchObject({
        lab: { hostOrigin: origin },
      });
    },
  );

  it.each([
    ['*', 'origin "*" is not a page origin such as https://school.example.'],
    ['null', 'origin "null" is not a page origin such as https://school.example.'],
    ['', 'origin "" is not a page origin such as https://school.example.'],
    ['localhost:3000', 'origin "localhost:3000" is not a page origin such as https://school.example.'],
    ['http://localhost:3000/', 'origin "http://localhost:3000/" is not a page origin such as https://school.example.'],
    ['http://localhost:3000/lesson', 'origin "http://localhost:3000/lesson" is not a page origin such as https://school.example.'],
    ['https://school.example:443', 'origin "https://school.example:443" is not a page origin such as https://school.example.'],
    ['HTTP://LOCALHOST:3000', 'origin "HTTP://LOCALHOST:3000" is not a page origin such as https://school.example.'],
    ['javascript:alert(1)', 'origin "javascript:alert(1)" is not a page origin such as https://school.example.'],
    ['file:///tmp', 'origin "file:///tmp" is not a page origin such as https://school.example.'],
  ])('refuses the origin %j: the lab compares it to event.origin exactly', (origin, problem) => {
    expect(parseLaunch(`?embed=1&lab=blockly&template=blink&origin=${encodeURIComponent(origin)}`)).toEqual({
      mode: 'invalid',
      problem,
      lab: 'blockly',
    });
  });

  it.each([
    ['?embed=1&lab=yolobit&template=blink', 'The template "blink" does not open in lab=yolobit.', 'yolobit'],
    ['?embed=1&lab=blockly&template=ybc-heart', 'The template "ybc-heart" does not open in lab=blockly.', 'blockly'],
    ['?embed=1&lab=blockly&template=blinky', 'Unknown template "blinky".', 'blockly'],
    ['?embed=1&lab=yolobit', 'No template was given: add template=<key>.', 'yolobit'],
    ['?embed=1&lab=yolobit&template=ybc-heart&template=ybc-melody', 'template must be given once.', 'yolobit'],
    ['?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-pro', 'Unknown profile "ybc-pro": use ybc-basic or ybc-advanced.', 'yolobit'],
    ['?embed=1&lab=yolobit&template=ybc-heart&profile=', 'Unknown profile "": use ybc-basic or ybc-advanced.', 'yolobit'],
    ['?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-basic&profile=ybc-basic', 'profile must be given once.', 'yolobit'],
    ['?embed=1&lab=blockly&template=blink&profile=ybc-basic', 'profile is only for lab=yolobit.', 'blockly'],
    [`?embed=1&lab=blockly&template=blink&origin=${host}&origin=${host}`, 'origin must be given once.', 'blockly'],
  ])('refuses the lab launch %j', (search, problem, kind) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem, lab: kind });
  });

  it.each([
    ['?embed=1&lab=scratch&template=blink', 'Unknown lab "scratch": use lab=blockly or lab=yolobit.'],
    ['?embed=1&lab=Blockly&template=blink', 'Unknown lab "Blockly": use lab=blockly or lab=yolobit.'],
    ['?embed=1&lab=&template=blink', 'Unknown lab "": use lab=blockly or lab=yolobit.'],
    ['?embed=1&lab=blockly&lab=blockly&template=blink', 'lab must be given once.'],
    ['?lab=blockly&template=blink', 'A template opens only in an embedded lab: add embed=1.'],
    ['?lab=yolobit', 'A template opens only in an embedded lab: add embed=1.'],
  ])('refuses %j, naming no lab', (search, problem) => {
    expect(parseLaunch(search)).toEqual({ mode: 'invalid', problem });
  });

  it('keeps the legacy S1 launch as it was: any key, profile and origin ignored, no lab', () => {
    expect(parseLaunch('?embed=1&template=blink&origin=*&profile=nonsense')).toEqual({ mode: 'embed', template: 'blink' });
    expect(parseLaunch('?embed=1&template=ybc-heart')).toEqual({ mode: 'embed', template: 'ybc-heart' });
    expect(parseLaunch('?embed=1&template=blink')).not.toHaveProperty('lab');
  });
});
```

**Edit `src/ui/app/startup.test.ts`** (1 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/startup.test.ts`** (1):

```ts
  });
});
```

with:

```ts
  });
});

describe('openAtStartup: lab launches (N6a S0)', () => {
  it('opens a Yolo:Bit template with the launch profile, never its storage', async () => {
    const { uses, options } = storage(ownProject);

    expect(await openAtStartup(parseLaunch('?embed=1&lab=yolobit&template=ybc-heart&profile=ybc-advanced'), options)).toEqual({
      kind: 'editor',
      document: createTemplateProject('ybc-heart', { profile: 'ybc-advanced' }),
      notice: null,
      saveTo: null,
    });
    expect(uses).toEqual([]);
  });

  it('opens a Yolo:Bit template with its own profile when the launch names none', async () => {
    const { options } = storage(ownProject);

    expect(await openAtStartup(parseLaunch('?embed=1&lab=yolobit&template=ybc-melody'), options)).toMatchObject({
      document: { profile: 'ybc-basic' },
    });
  });

  it('opens a Blockly template as the legacy launch does', async () => {
    const { options } = storage(ownProject);

    expect(await openAtStartup(parseLaunch('?embed=1&lab=blockly&template=blink&origin=http://localhost:3000'), options)).toEqual(
      await openAtStartup(parseLaunch('?embed=1&template=blink'), options),
    );
  });

  it('carries the lab of a broken lab launch to the error', async () => {
    const { uses, options } = storage(ownProject);

    expect(await openAtStartup(parseLaunch('?embed=1&lab=yolobit&template=blink'), options)).toEqual({
      kind: 'launch-error',
      problem: 'The template "blink" does not open in lab=yolobit.',
      lab: 'yolobit',
    });
    expect(uses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/ui/app/launch.test.ts src/ui/app/startup.test.ts src/ui/app/LaunchError.test.tsx`

Expected: `FAIL` — the new `parseLaunch` cases get `{ mode: "embed", template }` or a different problem instead of the lab result; `startup.test.ts` lab cases fail; `LaunchError.test.tsx` lists all 10 keys for a lab.

- [ ] **Step 3: Implement**

**Edit `src/main.tsx`** (1 change(s), each `old` occurs exactly once):

**Replace in `src/main.tsx`** (1):

```tsx
  root.render(
    <StrictMode>
      <LaunchError problem={started.problem} />
    </StrictMode>,
  );
```

with:

```tsx
  root.render(
    <StrictMode>
      <LaunchError problem={started.problem} lab={started.lab} />
    </StrictMode>,
  );
```

**Edit `src/ui/app/LaunchError.tsx`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/LaunchError.tsx`** (1):

```tsx
import { templateKeys } from '../../samples/templates';
import './app.css';

/** Shown instead of the editor when the launch URL is broken (S1): no project is opened. */
export function LaunchError({ problem }: { problem: string }) {
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
```

with:

```tsx
import { templateKeys, templateKeysOf, type LabKind } from '../../samples/templates';
import './app.css';

/** Shown instead of the editor when the launch URL is broken (S1): no project is opened. A lab launch lists its own templates (N6a S0). */
export function LaunchError({ problem, lab }: { problem: string; lab?: LabKind }) {
  const supported = lab === undefined ? templateKeys : templateKeysOf(lab);
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
```

**Replace in `src/ui/app/LaunchError.tsx`** (2):

```tsx
      <p className="launch-error-title">This lab could not be opened.</p>
      <p>{problem}</p>
      <p>Supported templates: {templateKeys.join(', ')}.</p>
    </main>
  );
```

with:

```tsx
      <p className="launch-error-title">This lab could not be opened.</p>
      <p>{problem}</p>
      <p>Supported templates: {supported.join(', ')}.</p>
    </main>
  );
```

**Replace the whole file `src/ui/app/launch.ts`:**

```ts
import { isTemplateKey, labOfTemplate, type LabKind, type TemplateKey } from '../../samples/templates';
import { ybcLabProfiles, type YbcLabProfile } from '../../samples/ybc-templates';

// The launch contract (S1, plan §9.2; N6a S0): how the app is told, by its URL, to run as the standalone
// editor or as an embedded lab. The URL is read once, at startup (main.tsx); nothing past this module knows
// about it. docs/lab-embed-contract.md is the contract as the embedding page (STEMLearning) sees it.
//
//   (no embed, no template, no lab)                     standalone editor
//   ?embed=1&template=<key>                             legacy S1 lab: any key, no host bridge, legacy chrome
//   ?embed=1&lab=blockly&template=<key>[&origin=<o>]    Blockly lab: a generic template
//   ?embed=1&lab=yolobit&template=<key>[&profile=<p>][&origin=<o>]
//                                                       Yolo:Bit lab: a ybc-* template, profile ybc-basic|ybc-advanced
//
// `origin` is the embedding page's origin, the only one the lab talks to (stem-lab/v1, host-bridge.ts); without
// it the lab works but talks to nobody. Anything else that names embed, template or lab is a broken launch,
// shown as an error: an embedding page must learn about a bad key, not get a standalone project in its place.
// Without `lab` the launch is the S1 one, unchanged: `profile` and `origin` are ignored like any other parameter.

/** What a `lab=` launch adds to the template. */
export type LabLaunch = {
  kind: LabKind;
  /** Yolo:Bit labs only: the board profile of `profile=`; null keeps the template's own. */
  profile: YbcLabProfile | null;
  /** The embedding page's origin (`origin=`), the only target of the lab's messages; null: no host bridge. */
  hostOrigin: string | null;
};

export type Launch =
  | { mode: 'standalone' }
  /** `lab` is absent for the legacy S1 launch. */
  | { mode: 'embed'; template: TemplateKey; lab?: LabLaunch }
  /** `lab`: the lab the broken launch asked for, when it named a known one (the error lists that lab's templates). */
  | { mode: 'invalid'; problem: string; lab?: LabKind };

const labKinds: readonly LabKind[] = ['blockly', 'yolobit'];

/** Reads the launch from a URL query string such as `location.search`. */
export function parseLaunch(search: string): Launch {
  const params = new URLSearchParams(search);
  const embed = params.getAll('embed');
  const template = params.getAll('template');
  const lab = params.getAll('lab');
  if (embed.length === 0 && template.length === 0 && lab.length === 0) {
    return { mode: 'standalone' };
  }
  if (embed.length === 0) {
    return invalid('A template opens only in an embedded lab: add embed=1.');
  }
  if (embed.length > 1 || embed[0] !== '1') {
    return invalid('embed must be given once, as embed=1.');
  }
  if (lab.length > 1) {
    return invalid('lab must be given once.');
  }
  const [labName] = lab;
  if (labName !== undefined && !(labKinds as readonly string[]).includes(labName)) {
    return invalid(`Unknown lab "${labName}": use lab=blockly or lab=yolobit.`);
  }
  const kind = labName as LabKind | undefined;
  const [key] = template;
  if (key === undefined || key === '') {
    return invalid('No template was given: add template=<key>.', kind);
  }
  if (template.length > 1) {
    return invalid('template must be given once.', kind);
  }
  if (!isTemplateKey(key)) {
    return invalid(`Unknown template "${key}".`, kind);
  }
  if (kind === undefined) {
    return { mode: 'embed', template: key };
  }
  if (labOfTemplate(key) !== kind) {
    return invalid(`The template "${key}" does not open in lab=${kind}.`, kind);
  }
  const profile = readProfile(params.getAll('profile'), kind);
  if (typeof profile === 'object' && profile !== null) {
    return profile;
  }
  const hostOrigin = readOrigin(params.getAll('origin'), kind);
  if (typeof hostOrigin === 'object' && hostOrigin !== null) {
    return hostOrigin;
  }
  return { mode: 'embed', template: key, lab: { kind, profile, hostOrigin } };
}

function readProfile(values: string[], kind: LabKind): YbcLabProfile | null | Extract<Launch, { mode: 'invalid' }> {
  if (values.length === 0) {
    return null;
  }
  if (values.length > 1) {
    return invalid('profile must be given once.', kind);
  }
  const [value = ''] = values;
  if (kind !== 'yolobit') {
    return invalid('profile is only for lab=yolobit.', kind);
  }
  return (ybcLabProfiles as readonly string[]).includes(value)
    ? (value as YbcLabProfile)
    : invalid(`Unknown profile "${value}": use ${ybcLabProfiles.join(' or ')}.`, kind);
}

/**
 * The embedding page's origin: an http(s) origin written exactly as browsers serialize it (scheme, host and a
 * port other than the default; no path, no trailing slash), because the lab compares it to `event.origin`.
 */
function readOrigin(values: string[], kind: LabKind): string | null | Extract<Launch, { mode: 'invalid' }> {
  if (values.length === 0) {
    return null;
  }
  if (values.length > 1) {
    return invalid('origin must be given once.', kind);
  }
  const [value = ''] = values;
  return isPageOrigin(value) ? value : invalid(`origin "${value}" is not a page origin such as https://school.example.`, kind);
}

export function isPageOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    // not an absolute URL
    return false;
  }
}

function invalid(problem: string, lab?: LabKind): Extract<Launch, { mode: 'invalid' }> {
  return lab === undefined ? { mode: 'invalid', problem } : { mode: 'invalid', problem, lab };
}
```

**Edit `src/ui/app/startup.ts`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/startup.ts`** (1):

```ts
  type ProjectRepository,
} from '../../core/persistence/project-repository';
import { createTemplateProject } from '../../samples/templates';
import type { Launch } from './launch';

```

with:

```ts
  type ProjectRepository,
} from '../../core/persistence/project-repository';
import { createTemplateProject, type LabKind } from '../../samples/templates';
import type { Launch } from './launch';

```

**Replace in `src/ui/app/startup.ts`** (2):

```ts
      saveTo: ProjectRepository | null;
    }
  | { kind: 'launch-error'; problem: string };

/**
 * What the app opens for its launch (S1, plan §7, §9.2).
 * - Standalone: the last project, as before S1 (`openLastProject`), saved as it is edited.
 * - Embedded lab: the template, fresh on every launch. The repository is
 *   never even created, so a lab can neither show nor replace the
 *   standalone last project, and its edits are not kept (CourseService D-17).
```

with:

```ts
      saveTo: ProjectRepository | null;
    }
  /** `lab`: the lab the broken launch named, if any (the error lists its templates). */
  | { kind: 'launch-error'; problem: string; lab?: LabKind };

/**
 * What the app opens for its launch (S1, plan §7, §9.2).
 * - Standalone: the last project, as before S1 (`openLastProject`), saved as it is edited.
 * - Embedded lab: the template, fresh on every launch, with the board profile of a Yolo:Bit launch (N6a S0). The repository is
 *   never even created, so a lab can neither show nor replace the
 *   standalone last project, and its edits are not kept (CourseService D-17).
```

**Replace in `src/ui/app/startup.ts`** (3):

```ts
  switch (launch.mode) {
    case 'invalid':
      return { kind: 'launch-error', problem: launch.problem };
    case 'embed':
      return { kind: 'editor', document: createTemplateProject(launch.template), notice: null, saveTo: null };
    case 'standalone': {
      const repository = options.openRepository();
```

with:

```ts
  switch (launch.mode) {
    case 'invalid':
      return launch.lab === undefined
        ? { kind: 'launch-error', problem: launch.problem }
        : { kind: 'launch-error', problem: launch.problem, lab: launch.lab };
    case 'embed': {
      const profile = launch.lab?.profile ?? null;
      const document = createTemplateProject(launch.template, profile === null ? {} : { profile });
      return { kind: 'editor', document, notice: null, saveTo: null };
    }
    case 'standalone': {
      const repository = options.openRepository();
```

- [ ] **Step 4: Run the tests and the whole gate**

Run: `pnpm vitest run src/ui/app/launch.test.ts src/ui/app/startup.test.ts src/ui/app/LaunchError.test.tsx`

Expected: `Test Files  3 passed`.

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  122 passed`, `Tests  4148 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/ui/app/LaunchError.test.tsx src/ui/app/LaunchError.tsx src/ui/app/launch.test.ts src/ui/app/launch.ts src/ui/app/startup.test.ts src/ui/app/startup.ts
git commit -m "$(cat <<'EOF'
feat(n6a): read lab, profile and origin from the launch URL (S0)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 3: Challenge checker in the core (S2)  — `model: opus`

`src/core/challenge` là TypeScript thuần (B1): kiểu `Goal`/`Challenge`/`CheckResult`, `runningBlockTypes` (cho `uses-block`, R8), `createGoalTracker` (chấm trên từng snapshot, thuần) và `runCheck` (một lượt Kiểm tra: subscribe → start → input theo `inputScript` → hết giờ thì chấm và dừng; Dừng giữa chừng ⇒ `cancelled`, R10). Chú ý hai chi tiết đã kiểm khi dry-run: (1) snapshot đưa cho listener có thể giữ console cũ — tracker đọc `session.getSnapshot()`; (2) start thất bại sẽ `stop()` lượt chạy cũ và phát `idle` — idle đó không được coi là Dừng (`starting`). Lần quan sát cuối lúc hết giờ là cần thiết: màn hình đứng yên thì không có snapshot mới (đèn ngủ cần nó).

**Files:**
- Create: `src/core/challenge/challenge.ts`
- Create: `src/core/challenge/check-run.test.ts`
- Create: `src/core/challenge/check-run.ts`
- Create: `src/core/challenge/goal-tracker.test.ts`
- Create: `src/core/challenge/goal-tracker.ts`
- Create: `src/core/challenge/index.ts`
- Create: `src/core/challenge/running-blocks.test.ts`
- Create: `src/core/challenge/running-blocks.ts`

**Interfaces:**
- Consumes: `RunSession`, `RunSnapshot`, `StartResult` (`src/core/run/run-session.ts`); `ComponentInput`, `peripheralComponentId` (`src/core/simulation/simulate-circuit.ts`); `displayPartId`, `buzzerPartId` (`src/core/simulation/peripherals/onboard-capabilities.ts`); `ProjectDocument`.
- Produces (`src/core/challenge/index.ts` re-exports all):
  - `type GoalSpec = {kind:'display-shows'; frame: string; fromMs?: number} | {kind:'led-lit'; componentId} | {kind:'led-blinks'; componentId; minToggles} | {kind:'buzzer-played'; minNotes} | {kind:'console-contains'; text} | {kind:'uses-block'; blockType}`; `type Goal = GoalSpec & { id: string; label: string }`.
  - `type InputStep = { atMs: number; input: ComponentInput } & ({ part: string } | { componentId: string })`; `type Challenge = { goals: readonly Goal[]; durationMs: number; inputScript?: readonly InputStep[] }`.
  - `type GoalResult = { id; label; passed: boolean }`; `type CheckResult = { passed: boolean; goals: GoalResult[] }`; `parseFrame(frame): boolean[] | null`.
  - `runningBlockTypes(workspace: unknown): Set<string>`; `createGoalTracker(challenge, boardId: string | null): { observe(snapshot, atMs): void; result(program: unknown): CheckResult }`.
  - `type CheckSession = Pick<RunSession,'start'|'stop'|'subscribe'|'getSnapshot'|'setComponentInput'>`; `type CheckTimers`; `type CheckOutcome = { status:'checked'; result: CheckResult; started: boolean } | { status:'cancelled' }`; `runCheck({ session, document, challenge, boardId, timers? }): { done: Promise<CheckOutcome>; cancel(): void }`.

- [ ] **Step 1: Write the failing tests**

**Create `src/core/challenge/check-run.test.ts`:**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../circuit/document';
import type { RunSnapshot, StartResult } from '../run/run-session';
import type { ComponentInput } from '../simulation/simulate-circuit';
import type { Challenge } from './challenge';
import { runCheck, type CheckSession } from './check-run';

// The check against a fake session (N6a S2): when it starts and stops the run, when it gives inputs, and how it
// ends. Real runs of real templates are in src/samples/challenges.test.ts.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const running = (lit: boolean): RunSnapshot => ({
  status: 'running',
  diagnostics: [],
  error: null,
  simulation: { nets: [], components: { led: { lit } }, pinReads: {} },
});
const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };

function fakeSession(startResult: StartResult = { ok: true }) {
  const listeners = new Set<(snapshot: RunSnapshot) => void>();
  let current: RunSnapshot = idle;
  const calls: string[] = [];
  const inputs: [number, string, ComponentInput][] = [];
  const publish = (next: RunSnapshot) => {
    current = next;
    [...listeners].forEach((listener) => listener(next));
  };
  const session: CheckSession = {
    start() {
      calls.push('start');
      if (!startResult.ok) {
        publish(idle);
        return startResult;
      }
      publish(running(false));
      return startResult;
    },
    stop() {
      calls.push('stop');
      publish(idle);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => current,
    setComponentInput(componentId, input) {
      inputs.push([Date.now(), componentId, input]);
    },
  };
  return { session, publish, calls, inputs, listeners };
}

const document = createNewProject('p');
const challenge: Challenge = {
  goals: [{ id: 'lit', label: 'Lit', kind: 'led-lit', componentId: 'led' }],
  durationMs: 1000,
  inputScript: [
    { atMs: 300, part: 'button-a', input: { kind: 'hold', closed: true } },
    { atMs: 100, componentId: 'button', input: { kind: 'hold', closed: true } },
  ],
};

describe('runCheck (N6a S2)', () => {
  it('runs the program for the duration, then stops it and gives the verdict', async () => {
    const fake = fakeSession();
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });

    await vi.advanceTimersByTimeAsync(500);
    fake.publish(running(true));
    expect(fake.calls).toEqual(['start']);
    await vi.advanceTimersByTimeAsync(500);

    expect(await check.done).toEqual({ status: 'checked', started: true, result: { passed: true, goals: [{ id: 'lit', label: 'Lit', passed: true }] } });
    expect(fake.calls).toEqual(['start', 'stop']);
    expect(fake.listeners.size).toBe(0);
  });

  it('fails a goal the run never met', async () => {
    const fake = fakeSession();
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(await check.done).toMatchObject({ status: 'checked', result: { passed: false } });
  });

  it('gives each input on time: a part of the board, or a circuit component', async () => {
    const fake = fakeSession();
    const startedAt = Date.now();
    runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.inputs).toEqual([
      [startedAt + 100, 'button', { kind: 'hold', closed: true }],
      [startedAt + 300, 'board/button-a', { kind: 'hold', closed: true }],
    ]);
  });

  it('gives no input to a part when there is no board', async () => {
    const fake = fakeSession();
    runCheck({ session: fake.session, document, challenge, boardId: null });
    await vi.advanceTimersByTimeAsync(1000);

    expect(fake.inputs.map(([, componentId]) => componentId)).toEqual(['button']);
  });

  it('is a failed check when the run does not start, without waiting', async () => {
    const fake = fakeSession({ ok: false, reason: 'compile-error', diagnostics: [] });
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });

    expect(await check.done).toEqual({ status: 'checked', started: false, result: { passed: false, goals: [{ id: 'lit', label: 'Lit', passed: false }] } });
    expect(fake.calls).toEqual(['start']);
    expect(fake.listeners.size).toBe(0);
  });

  it('ends without a result when the run is stopped meanwhile, and gives no more input', async () => {
    const fake = fakeSession();
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    await vi.advanceTimersByTimeAsync(200);
    fake.session.stop();
    await vi.advanceTimersByTimeAsync(1000);

    expect(await check.done).toEqual({ status: 'cancelled' });
    expect(fake.inputs).toHaveLength(1);
    expect(fake.calls).toEqual(['start', 'stop']);
  });

  it('cancel ends the check without a result and stops the run; later calls do nothing', async () => {
    const fake = fakeSession();
    const check = runCheck({ session: fake.session, document, challenge, boardId: 'board' });
    check.cancel();
    check.cancel();
    await vi.advanceTimersByTimeAsync(1000);

    expect(await check.done).toEqual({ status: 'cancelled' });
    expect(fake.calls).toEqual(['start', 'stop']);
    expect(fake.inputs).toEqual([]);
  });
});
```

**Create `src/core/challenge/goal-tracker.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../run/run-session';
import type { ComponentState } from '../simulation/simulate-circuit';
import { parseFrame, type Challenge, type Goal } from './challenge';
import { createGoalTracker } from './goal-tracker';

// Each goal kind against hand-written snapshots (N6a S2): the tracker sees what the run store sees.

const board = 'ybc-board-1';
const heart = '01010:11111:11111:01110:00100';
const dark = '00000:00000:00000:00000:00000';

const frameOf = (rows: string) => ({ pixels: [...rows.replaceAll(':', '')].map((digit) => (digit === '1' ? '#FF0000' : null)) });

function snapshot(components: Record<string, ComponentState>, lines?: string[]): RunSnapshot {
  return {
    status: 'running',
    diagnostics: [],
    error: null,
    simulation: { nets: [], components, pinReads: {} },
    ...(lines ? { console: { lines, hidden: 0 } } : {}),
  };
}
const idle: RunSnapshot = { status: 'idle', diagnostics: [], error: null, simulation: null };

const challengeOf = (...goals: Goal[]): Challenge => ({ goals, durationMs: 1000 });
const verdicts = (challenge: Challenge, observed: [RunSnapshot, number][], program: unknown = null, boardId: string | null = board) => {
  const tracker = createGoalTracker(challenge, boardId);
  observed.forEach(([seen, at]) => tracker.observe(seen, at));
  return tracker.result(program);
};

describe('parseFrame', () => {
  it('reads five rows of five digits, row by row', () => {
    expect(parseFrame(heart)?.map((lit) => (lit ? 1 : 0)).join('')).toBe('0101011111111110111000100');
  });

  it.each(['', '01010', '01010:11111:11111:01110', '01010:11111:11111:01110:0010', '01010:11111:11111:01110:00102', '01010;11111;11111;01110;00100'])(
    'refuses %j',
    (frame) => {
      expect(parseFrame(frame)).toBeNull();
    },
  );
});

describe('display-shows', () => {
  const goal: Goal = { id: 'heart', label: 'Heart', kind: 'display-shows', frame: heart };

  it('passes when the display showed the frame at some moment, even if it changed after', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({}), 0], [snapshot({ [`${board}/display`]: { frame: frameOf(heart) } }), 100], [snapshot({ [`${board}/display`]: { frame: frameOf(dark) } }), 200]])).toEqual({
      passed: true,
      goals: [{ id: 'heart', label: 'Heart', passed: true }],
    });
  });

  it('compares lit and dark only, whatever the colour', () => {
    const blue = { pixels: frameOf(heart).pixels.map((pixel) => (pixel ? '#0000FF' : null)) };
    expect(verdicts(challengeOf(goal), [[snapshot({ [`${board}/display`]: { frame: blue } }), 0]]).passed).toBe(true);
  });

  it('fails on another picture, and on another board’s display', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({ [`${board}/display`]: { frame: frameOf(dark) } }), 0]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[snapshot({ 'other-board/display': { frame: frameOf(heart) } }), 0]]).passed).toBe(false);
  });

  it('takes a display that never showed anything as dark', () => {
    const darkGoal: Goal = { id: 'dark', label: 'Dark', kind: 'display-shows', frame: dark };
    expect(verdicts(challengeOf(darkGoal), [[snapshot({}), 0]]).passed).toBe(true);
  });

  it('counts only what is shown at or after fromMs', () => {
    const late: Goal = { ...goal, fromMs: 500 };
    const shown = snapshot({ [`${board}/display`]: { frame: frameOf(heart) } });
    expect(verdicts(challengeOf(late), [[shown, 499]]).passed).toBe(false);
    expect(verdicts(challengeOf(late), [[shown, 500]]).passed).toBe(true);
  });

  it('never passes on a generic run (no board) or with a malformed frame', () => {
    const shown = snapshot({ [`${board}/display`]: { frame: frameOf(heart) } });
    expect(verdicts(challengeOf(goal), [[shown, 0]], null, null).passed).toBe(false);
    expect(verdicts(challengeOf({ ...goal, frame: 'heart' }), [[shown, 0]]).passed).toBe(false);
  });
});

describe('led-lit', () => {
  const goal: Goal = { id: 'lit', label: 'Lit', kind: 'led-lit', componentId: 'led' };

  it('passes once the LED was lit', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({ led: { lit: false } }), 0], [snapshot({ led: { lit: true } }), 10], [snapshot({ led: { lit: false } }), 20]]).passed).toBe(true);
  });

  it('fails when it never was, or when another component was', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({ led: { lit: false } }), 0]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[snapshot({ 'led-2': { lit: true } }), 0]]).passed).toBe(false);
  });
});

describe('led-blinks', () => {
  const goal: Goal = { id: 'blink', label: 'Blink', kind: 'led-blinks', componentId: 'led', minToggles: 3 };
  const lit = (value: boolean, at: number): [RunSnapshot, number] => [snapshot({ led: { lit: value } }), at];

  it('counts changes from dark, where the LED starts', () => {
    expect(verdicts(challengeOf(goal), [lit(true, 0), lit(false, 1000), lit(true, 2000)]).passed).toBe(true);
    expect(verdicts(challengeOf(goal), [lit(true, 0), lit(false, 1000)]).passed).toBe(false);
  });

  it('does not count a repeated state as a change', () => {
    expect(verdicts(challengeOf(goal), [lit(true, 0), lit(true, 10), lit(true, 20), lit(false, 30)]).passed).toBe(false);
  });

  it('takes an LED without state as dark', () => {
    expect(verdicts(challengeOf(goal), [lit(true, 0), [snapshot({}), 10], lit(true, 20)]).passed).toBe(true);
  });
});

describe('buzzer-played', () => {
  const goal: Goal = { id: 'notes', label: 'Notes', kind: 'buzzer-played', minNotes: 3 };
  const tone = (hz: number | undefined, at: number): [RunSnapshot, number] => [snapshot(hz === undefined ? {} : { [`${board}/buzzer`]: { hz } }), at];

  it('counts a tone that begins and a change of pitch as notes', () => {
    expect(verdicts(challengeOf(goal), [tone(262, 0), tone(330, 250), tone(392, 500)]).passed).toBe(true);
    expect(verdicts(challengeOf(goal), [tone(262, 0), tone(undefined, 250), tone(262, 260), tone(undefined, 500), tone(262, 510)]).passed).toBe(true);
  });

  it('does not count a tone that goes on', () => {
    expect(verdicts(challengeOf(goal), [tone(262, 0), tone(262, 100), tone(262, 200), tone(330, 300)]).passed).toBe(false);
  });

  it('never passes on a generic run', () => {
    expect(verdicts(challengeOf(goal), [tone(262, 0), tone(330, 250), tone(392, 500)], null, null).passed).toBe(false);
  });
});

describe('console-contains', () => {
  const goal: Goal = { id: 'hello', label: 'Hello', kind: 'console-contains', text: 'hello' };

  it('passes when a printed line contains the text', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({}, ['1', 'say hello world']), 0]]).passed).toBe(true);
  });

  it('fails otherwise, and on a run without a console', () => {
    expect(verdicts(challengeOf(goal), [[snapshot({}, ['Hello']), 0]]).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [[snapshot({}), 0]]).passed).toBe(false);
  });
});

describe('uses-block', () => {
  const goal: Goal = { id: 'write', label: 'Write', kind: 'uses-block', blockType: 'stem_digital_write' };
  const program = (body: Record<string, unknown>) => ({ blocks: { languageVersion: 0, blocks: [{ type: 'stem_forever', id: 'f', inputs: { DO: { block: body } } }] } });

  it('passes when the block runs, whatever the run did', () => {
    expect(verdicts(challengeOf(goal), [], program({ type: 'stem_digital_write', id: 'w' })).passed).toBe(true);
  });

  it('fails when the block is disabled or missing', () => {
    expect(verdicts(challengeOf(goal), [], program({ type: 'stem_digital_write', id: 'w', disabledReasons: ['MANUALLY_DISABLED'] })).passed).toBe(false);
    expect(verdicts(challengeOf(goal), [], program({ type: 'stem_wait', id: 'w' })).passed).toBe(false);
  });
});

describe('the result', () => {
  it('passes only when every goal passed, and lists every goal in order', () => {
    const goals: Goal[] = [
      { id: 'lit', label: 'Lit', kind: 'led-lit', componentId: 'led' },
      { id: 'write', label: 'Write', kind: 'uses-block', blockType: 'stem_digital_write' },
    ];
    expect(verdicts(challengeOf(...goals), [[snapshot({ led: { lit: true } }), 0]])).toEqual({
      passed: false,
      goals: [
        { id: 'lit', label: 'Lit', passed: true },
        { id: 'write', label: 'Write', passed: false },
      ],
    });
  });

  it('never passes without goals', () => {
    expect(verdicts(challengeOf(), [])).toEqual({ passed: false, goals: [] });
  });

  it('ignores idle snapshots', () => {
    const blink: Goal = { id: 'blink', label: 'Blink', kind: 'led-blinks', componentId: 'led', minToggles: 2 };
    expect(verdicts(challengeOf(blink), [[snapshot({ led: { lit: true } }), 0], [idle, 10], [snapshot({ led: { lit: true } }), 20]]).passed).toBe(false);
  });
});
```

**Create `src/core/challenge/running-blocks.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { runningBlockTypes } from './running-blocks';

const workspace = (...blocks: unknown[]) => ({ blocks: { languageVersion: 0, blocks } });

describe('runningBlockTypes (N6a S2)', () => {
  it('lists the blocks inside on start and forever: statements, values and next', () => {
    const types = runningBlockTypes(
      workspace(
        { type: 'stem_on_start', id: 's', inputs: { DO: { block: { type: 'ybc_display_clear', id: 'c', next: { block: { type: 'ybc_wait_ms', id: 'w', inputs: { MS: { block: { type: 'math_number', id: 'n' } } } } } } } } },
        { type: 'stem_forever', id: 'f' },
      ),
    );
    expect([...types].sort()).toEqual(['math_number', 'stem_forever', 'stem_on_start', 'ybc_display_clear', 'ybc_wait_ms']);
  });

  it('leaves out loose blocks and disabled blocks with what is inside them, but not what follows them', () => {
    const types = runningBlockTypes(
      workspace(
        {
          type: 'stem_forever',
          id: 'f',
          inputs: {
            DO: {
              block: {
                type: 'controls_if',
                id: 'if',
                disabledReasons: ['MANUALLY_DISABLED'],
                inputs: { DO0: { block: { type: 'ybc_display_clear', id: 'c' } } },
                next: { block: { type: 'ybc_wait_ms', id: 'w' } },
              },
            },
          },
        },
        { type: 'ybc_display_show_image', id: 'loose', disabledReasons: ['ORPHANED_BLOCK'] },
        { type: 'ybc_sound_note', id: 'loose-enabled' },
      ),
    );
    expect([...types].sort()).toEqual(['stem_forever', 'ybc_wait_ms']);
  });

  it('leaves out a disabled hat', () => {
    expect([...runningBlockTypes(workspace({ type: 'stem_forever', id: 'f', disabledReasons: ['x'], inputs: { DO: { block: { type: 'stem_wait', id: 'w' } } } }))]).toEqual([]);
  });

  it.each([null, undefined, 42, 'blocks', [], {}, { blocks: null }, { blocks: { blocks: 'x' } }])('reads nothing from %j without throwing', (value) => {
    expect(runningBlockTypes(value).size).toBe(0);
  });

  it('ends on a self-referencing structure', () => {
    const hat: Record<string, unknown> = { type: 'stem_forever', id: 'f' };
    hat.next = { block: hat };
    expect([...runningBlockTypes(workspace(hat))]).toEqual(['stem_forever']);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/core/challenge`

Expected: `FAIL` — the three test files cannot resolve `./challenge`, `./goal-tracker`, `./check-run`, `./running-blocks`.

- [ ] **Step 3: Implement**

**Create `src/core/challenge/challenge.ts`:**

```ts
import type { ComponentInput } from '../simulation/simulate-circuit';

// A challenge (N6a S2): what a lab asks of the learner's program, checked by running it. It is plain data
// of the template (src/samples/challenges.ts), never of the project document, and it knows nothing of a
// host, a lesson or a score: the standalone lab checks with it as an embedded one does (spec §7).

/** What one goal looks for in the run, or in the program. */
export type GoalSpec =
  /** The board's 5×5 display shows `frame` at some moment of the check, at or after `fromMs`. */
  | { kind: 'display-shows'; frame: string; fromMs?: number }
  /** The circuit component `componentId` (an LED) is lit at some moment. */
  | { kind: 'led-lit'; componentId: string }
  /** The LED `componentId` changes between lit and dark at least `minToggles` times (dark is where it starts). */
  | { kind: 'led-blinks'; componentId: string; minToggles: number }
  /** The board's buzzer starts at least `minNotes` notes: a tone that begins, or changes to another pitch. */
  | { kind: 'buzzer-played'; minNotes: number }
  /** A line the program printed contains `text`. */
  | { kind: 'console-contains'; text: string }
  /** A block of type `blockType` is in the program and runs: inside "on start" or "forever", and enabled. */
  | { kind: 'uses-block'; blockType: string };

/** `label` is what the learner reads (and the host shows): at most 200 characters (stem-lab/v1). */
export type Goal = GoalSpec & { id: string; label: string };

/**
 * A runtime input the check gives the run at `atMs` after it starts: to an onboard part of the board
 * (`part`, e.g. `button-a`, `light`), which becomes `<board id>/<part>`, or to a circuit component
 * (`componentId`, e.g. a push button).
 */
export type InputStep = { atMs: number; input: ComponentInput } & ({ part: string } | { componentId: string });

export type Challenge = {
  goals: readonly Goal[];
  /** How long the check runs the program. */
  durationMs: number;
  /** The inputs of an interactive lab, in any order. */
  inputScript?: readonly InputStep[];
};

export type GoalResult = { id: string; label: string; passed: boolean };

/** `passed` when every goal passed (a challenge without goals never passes). */
export type CheckResult = { passed: boolean; goals: GoalResult[] };

/** The display is 5×5: a frame is five rows of five digits, top to bottom, `:` between rows, 1 lit. */
const framePattern = /^[01]{5}(?::[01]{5}){4}$/;

/** The 25 lights of a frame, row by row (cell x, y is `[y * 5 + x]`), or null when it is not one. */
export function parseFrame(frame: string): boolean[] | null {
  return framePattern.test(frame) ? [...frame.replaceAll(':', '')].map((digit) => digit === '1') : null;
}
```

**Create `src/core/challenge/check-run.ts`:**

```ts
import type { ProjectDocument } from '../circuit/document';
import type { RunSession } from '../run/run-session';
import { peripheralComponentId } from '../simulation/simulate-circuit';
import type { Challenge, CheckResult, InputStep } from './challenge';
import { createGoalTracker } from './goal-tracker';

// One check (N6a S2): runs the learner's program for the challenge's duration, gives it the challenge's inputs
// on time, evaluates the goals on every snapshot (RunSession.subscribe), then stops the run. A run that does not
// start is a failed check, with the reasons the session gave. A run that goes idle meanwhile (the learner pressed
// Stop) or a cancel ends the check without a result: nothing was checked.

/** What a check needs of a run session; RunSession is one, and so is the UI's run store adapter. */
export type CheckSession = Pick<RunSession, 'start' | 'stop' | 'subscribe' | 'getSnapshot' | 'setComponentInput'>;

export type CheckTimers = {
  setTimeout(task: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
};

export type CheckOutcome =
  | { status: 'checked'; result: CheckResult; started: boolean }
  | { status: 'cancelled' };

export type CheckRun = {
  done: Promise<CheckOutcome>;
  /** Ends the check without a result, and stops its run. Nothing once the check has ended. */
  cancel(): void;
};

export type CheckOptions = {
  session: CheckSession;
  document: ProjectDocument;
  challenge: Challenge;
  /** The board of a Yolo:Bit-compatible project (its parts get the `part` inputs); null for a generic one. */
  boardId: string | null;
  timers?: CheckTimers;
};

const defaultTimers: CheckTimers = {
  setTimeout: (task, ms) => setTimeout(task, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function runCheck({ session, document, challenge, boardId, timers = defaultTimers }: CheckOptions): CheckRun {
  const tracker = createGoalTracker(challenge, boardId);
  const handles: unknown[] = [];
  let settle: (outcome: CheckOutcome) => void = () => {};
  const done = new Promise<CheckOutcome>((resolve) => {
    settle = resolve;
  });
  let settled = false;
  let starting = true;
  let startedAt = timers.now();

  const end = () => {
    settled = true;
    handles.forEach((handle) => timers.clearTimeout(handle));
    unsubscribe();
  };
  const finish = (started: boolean) => {
    end();
    settle({ status: 'checked', result: tracker.result(document.program.blocks), started });
  };
  const cancelled = () => {
    end();
    settle({ status: 'cancelled' });
  };

  const unsubscribe = session.subscribe((snapshot) => {
    if (settled) {
      return;
    }
    if (snapshot.status === 'idle') {
      // A failed start stops the run it replaces: that idle is part of starting, not a Stop.
      if (!starting) {
        cancelled();
      }
      return;
    }
    // The snapshot a listener is given may hold an older console; the session's own is brought up to date.
    tracker.observe(session.getSnapshot(), timers.now() - startedAt);
  });

  startedAt = timers.now();
  const start = session.start(document);
  starting = false;
  if (!start.ok) {
    finish(false);
    return { done, cancel: () => {} };
  }

  const targetOf = (step: InputStep) => ('part' in step ? (boardId === null ? null : peripheralComponentId(boardId, step.part)) : step.componentId);
  for (const step of challenge.inputScript ?? []) {
    const target = targetOf(step);
    if (target !== null) {
      handles.push(timers.setTimeout(() => session.setComponentInput(target, step.input), step.atMs));
    }
  }
  handles.push(
    timers.setTimeout(() => {
      tracker.observe(session.getSnapshot(), timers.now() - startedAt);
      finish(true);
      session.stop();
    }, challenge.durationMs),
  );

  return {
    done,
    cancel() {
      if (!settled) {
        cancelled();
        session.stop();
      }
    },
  };
}
```

**Create `src/core/challenge/goal-tracker.ts`:**

```ts
import type { RunSnapshot } from '../run/run-session';
import { buzzerPartId, displayPartId } from '../simulation/peripherals/onboard-capabilities';
import { peripheralComponentId } from '../simulation/simulate-circuit';
import { parseFrame, type Challenge, type CheckResult, type Goal } from './challenge';
import { runningBlockTypes } from './running-blocks';

// Evaluates the goals of a challenge over the snapshots of one run (N6a S2). Pure: it is told every snapshot
// with the time since the run started, and the program at the end; it never starts, stops or waits for anything
// (check-run.ts does). A goal that looks at the run passes as soon as it has seen what it looks for.

export type GoalTracker = {
  /** One snapshot of the run, `atMs` after it started. Idle snapshots (no simulation) are ignored. */
  observe(snapshot: RunSnapshot, atMs: number): void;
  /** Every goal's verdict; `program` is the run's `document.program.blocks`, for `uses-block`. */
  result(program: unknown): CheckResult;
};

type GoalState = { goal: Goal; passed: boolean; count: number; last: unknown };

/** `boardId`: the board of a Yolo:Bit-compatible run, whose display and buzzer the goals read; null for a generic run. */
export function createGoalTracker(challenge: Challenge, boardId: string | null): GoalTracker {
  const states: GoalState[] = challenge.goals.map((goal) => ({ goal, passed: false, count: 0, last: undefined }));
  const display = boardId === null ? null : peripheralComponentId(boardId, displayPartId);
  const buzzer = boardId === null ? null : peripheralComponentId(boardId, buzzerPartId);

  const observeGoal = (state: GoalState, snapshot: RunSnapshot, atMs: number) => {
    const components = snapshot.simulation?.components ?? {};
    const { goal } = state;
    switch (goal.kind) {
      case 'display-shows': {
        const target = parseFrame(goal.frame);
        if (display === null || target === null || atMs < (goal.fromMs ?? 0)) {
          return;
        }
        // A display that never showed anything is dark.
        const pixels = components[display]?.frame?.pixels;
        const lit = target.map((_, index) => pixels?.[index] != null);
        if (lit.every((value, index) => value === target[index])) {
          state.passed = true;
        }
        return;
      }
      case 'led-lit':
        if (components[goal.componentId]?.lit === true) {
          state.passed = true;
        }
        return;
      case 'led-blinks': {
        const lit = components[goal.componentId]?.lit === true;
        if (lit !== (state.last === true)) {
          state.count += 1;
          state.passed = state.count >= goal.minToggles;
        }
        state.last = lit;
        return;
      }
      case 'buzzer-played': {
        const hz = buzzer === null ? undefined : components[buzzer]?.hz;
        if (hz !== undefined && hz !== state.last) {
          state.count += 1;
          state.passed = state.count >= goal.minNotes;
        }
        state.last = hz;
        return;
      }
      case 'console-contains':
        if (snapshot.console?.lines.some((line) => line.includes(goal.text))) {
          state.passed = true;
        }
        return;
      case 'uses-block':
        return;
    }
  };

  return {
    observe(snapshot, atMs) {
      if (snapshot.simulation === null) {
        return;
      }
      for (const state of states) {
        observeGoal(state, snapshot, atMs);
      }
    },
    result(program) {
      const running = runningBlockTypes(program);
      const goals = states.map(({ goal, passed }) => ({
        id: goal.id,
        label: goal.label,
        passed: goal.kind === 'uses-block' ? running.has(goal.blockType) : passed,
      }));
      return { passed: goals.length > 0 && goals.every((goal) => goal.passed), goals };
    },
  };
}
```

**Create `src/core/challenge/index.ts`:**

```ts
export { parseFrame, type Challenge, type CheckResult, type Goal, type GoalResult, type GoalSpec, type InputStep } from './challenge';
export { runCheck, type CheckOptions, type CheckOutcome, type CheckRun, type CheckSession, type CheckTimers } from './check-run';
export { createGoalTracker, type GoalTracker } from './goal-tracker';
export { runningBlockTypes } from './running-blocks';
```

**Create `src/core/challenge/running-blocks.ts`:**

```ts
// The block types of a program that run (N6a S2, goal `uses-block`): the blocks reachable from an enabled
// "on start" or "forever" through inputs and `next`, skipping disabled blocks with everything inside them.
// A loose block, or one the learner disabled, does not count: it is in the workspace but not in the program.
// Like block-walk.ts it reads Blockly JSON without Blockly and is bounded, so a stored program of any shape
// can neither throw nor run for ever here.

const hats = new Set(['stem_on_start', 'stem_forever']);

/** More blocks than this are not walked; MAX_PROGRAM_BLOCKS is the real limit of a program. */
const maxWalkedBlocks = 100_000;

export function runningBlockTypes(workspace: unknown): Set<string> {
  const types = new Set<string>();
  const seen = new Set<object>();
  const top = asRecord(asRecord(workspace)?.blocks)?.blocks;
  const pending: unknown[] = Array.isArray(top) ? top.filter((block) => hats.has(String(asRecord(block)?.type))) : [];
  let walked = 0;
  while (pending.length > 0 && walked < maxWalkedBlocks) {
    const block = asRecord(pending.pop());
    if (!block || seen.has(block)) {
      continue;
    }
    seen.add(block);
    walked += 1;
    const disabled = Array.isArray(block.disabledReasons) && block.disabledReasons.length > 0;
    if (!disabled) {
      if (typeof block.type === 'string') {
        types.add(block.type);
      }
      const inputs = asRecord(block.inputs);
      for (const input of inputs ? Object.values(inputs) : []) {
        pending.push(asRecord(input)?.block);
      }
    }
    // A disabled statement does not run, but the blocks after it still do.
    pending.push(asRecord(block.next)?.block);
  }
  return types;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
```

- [ ] **Step 4: Run the tests and the whole gate**

Run: `pnpm vitest run src/core/challenge`

Expected: `Test Files  3 passed`, `Tests  47 passed`.

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  125 passed`, `Tests  4195 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 5: Commit**

```bash
git add src/core/challenge/challenge.ts src/core/challenge/check-run.test.ts src/core/challenge/check-run.ts src/core/challenge/goal-tracker.test.ts src/core/challenge/goal-tracker.ts src/core/challenge/index.ts src/core/challenge/running-blocks.test.ts src/core/challenge/running-blocks.ts
git commit -m "$(cat <<'EOF'
feat(n6a): add the challenge checker to the core (S2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 4: A challenge for every lesson template (S2 data)  — `model: sonnet`

Dữ liệu challenge (song ngữ, R16) của từng template, và test tích hợp chạy **thật** từng challenge qua `RunSession` sản xuất (capability onboard + pin như `main.tsx`) với fake timer: template generic đạt; bài khởi đầu Yolo:Bit không đạt (chỉ các mục tiêu nó đã thoả), lời giải đạt, cả với profile Advanced. `empty`/`ybc-empty` không có challenge (R7).

**Files:**
- Create: `src/samples/challenges.test.ts`
- Create: `src/samples/challenges.ts`

**Interfaces:**
- Consumes (Task 1, 3): `ybcImages`, `ybcTemplateBoardId`, `ybcSolutionDocument`, `createTemplateProject`, `templateKeys`, `type TemplateKey`; `type Challenge`, `type GoalSpec`, `type InputStep`, `runCheck`, `parseFrame`.
- Produces (`src/samples/challenges.ts`): `type ChallengeLanguage = 'en' | 'vi'`; `templateChallenge(key: TemplateKey, language: ChallengeLanguage): Challenge | null`. Goal ids: `led-lit`, `uses-digital-write`, `led-blinks`, `uses-wait`, `led-follows-button`, `uses-if`, `shows-heart`, `a-shows-check`, `b-shows-cross`, `dark-lights-up`, `bright-goes-off`, `a-plays-notes`. Yolo:Bit inputs address parts (`button-a`, `button-b`, `light`); generic ones the component `button`.

- [ ] **Step 1: Write the failing tests**

**Create `src/samples/challenges.test.ts`:**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFrame, runCheck, type CheckOutcome } from '../core/challenge';
import type { ProjectDocument } from '../core/circuit/document';
import { localDeviceDefinitions } from '../core/devices/local-catalog';
import { createDeviceRegistry } from '../core/devices/registry';
import { productionProfiles } from '../core/profiles';
import { createBlockPackCatalog } from '../core/program/block-packs';
import { createDefaultProgram } from '../core/program/blocks';
import { createRunSession } from '../core/run/run-session';
import { createPinCapabilities } from '../core/run/ybc-pin-io';
import { createOnboardCapabilities } from '../core/simulation/peripherals/onboard-capabilities';
import { templateChallenge } from './challenges';
import { createTemplateProject, templateKeys, type TemplateKey } from './templates';
import { ybcSolutionDocument, type YbcLessonKey } from './ybc-solutions';
import { ybcTemplateBoardId } from './ybc-templates';

// Every template's challenge (N6a S2) against real runs: the production session, with the capabilities the
// composition root gives it, and fake timers for the time. The generic templates are finished programs and
// pass; the Yolo:Bit starters fail until their loose block is attached (ybc-solutions.ts), and then pass.

const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const pinCapabilities = createPinCapabilities(registry);
const newSession = () =>
  createRunSession(registry, {
    profiles: productionProfiles,
    packs,
    capabilities: (environment) => ({ ...createOnboardCapabilities(environment), ...pinCapabilities(environment) }),
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function check(key: TemplateKey, document: ProjectDocument): Promise<CheckOutcome> {
  const challenge = templateChallenge(key, 'en');
  if (!challenge) {
    throw new Error(`${key} has no challenge`);
  }
  const session = newSession();
  const run = runCheck({ session, document, challenge, boardId: document.profile ? ybcTemplateBoardId : null });
  await vi.advanceTimersByTimeAsync(challenge.durationMs + 50);
  const outcome = await run.done;
  expect(session.getSnapshot().status).toBe('idle');
  return outcome;
}

const passedIds = (outcome: CheckOutcome) => (outcome.status === 'checked' ? outcome.result.goals.filter((goal) => goal.passed).map((goal) => goal.id) : null);

describe('template challenges (N6a S2)', () => {
  it('exist for every template but the empty ones', () => {
    expect(templateKeys.filter((key) => templateChallenge(key, 'vi') === null)).toEqual(['empty', 'ybc-empty']);
  });

  it.each(templateKeys.filter((key) => templateChallenge(key, 'en') !== null))('%s has goals the host can show: unique ids, labels of 1–200 characters in both languages, valid frames', (key) => {
    for (const language of ['en', 'vi'] as const) {
      const challenge = templateChallenge(key, language);
      const goals = challenge?.goals ?? [];
      expect(goals.length).toBeGreaterThan(0);
      expect(new Set(goals.map((goal) => goal.id)).size).toBe(goals.length);
      for (const goal of goals) {
        expect(goal.label.length).toBeGreaterThan(0);
        expect(goal.label.length).toBeLessThanOrEqual(200);
        if (goal.kind === 'display-shows') {
          expect(parseFrame(goal.frame)).not.toBeNull();
        }
      }
      expect(challenge?.durationMs).toBeLessThanOrEqual(5000);
    }
  });

  it('gives the labels in the language asked, the rest unchanged', () => {
    const vi = templateChallenge('ybc-heart', 'vi');
    const en = templateChallenge('ybc-heart', 'en');
    expect(vi?.goals.map((goal) => goal.label)).toEqual(['Màn hình hiện hình trái tim']);
    expect(en?.goals.map((goal) => goal.label)).toEqual(['The display shows a heart']);
    expect({ ...vi, goals: vi?.goals.map((goal) => ({ ...goal, label: '' })) }).toEqual({ ...en, goals: en?.goals.map((goal) => ({ ...goal, label: '' })) });
  });

  describe.each(['led-on', 'blink', 'button-direct', 'button-led'] as const)('%s (a finished generic program)', (key) => {
    it('passes as the template opens', async () => {
      expect(await check(key, createTemplateProject(key))).toMatchObject({ status: 'checked', started: true, result: { passed: true } });
    });
  });

  it.each([
    ['led-on', 'an empty program', (document: ProjectDocument) => ({ ...document, program: { blocks: createDefaultProgram() } })],
    ['blink', 'an empty program', (document: ProjectDocument) => ({ ...document, program: { blocks: createDefaultProgram() } })],
    ['button-led', 'an empty program', (document: ProjectDocument) => ({ ...document, program: { blocks: createDefaultProgram() } })],
    ['button-direct', 'no wires', (document: ProjectDocument) => ({ ...document, circuit: { ...document.circuit, wires: [] } })],
  ] as const)('%s fails with %s', async (key, _, broken) => {
    expect(await check(key, broken(createTemplateProject(key)))).toMatchObject({ status: 'checked', result: { passed: false } });
  });

  const ybcCases: [YbcLessonKey, string[]][] = [
    ['ybc-heart', []],
    ['ybc-button-ab', ['a-shows-check']],
    ['ybc-night-light', ['bright-goes-off']],
    ['ybc-melody', []],
  ];

  describe.each(ybcCases)('%s (a Yolo:Bit starter)', (key, passedByStarter) => {
    it('fails as the template opens: only the goals the starter already meets pass', async () => {
      const outcome = await check(key, createTemplateProject(key));
      expect(outcome).toMatchObject({ status: 'checked', started: true, result: { passed: false } });
      expect(passedIds(outcome)).toEqual(passedByStarter);
    });

    it('passes once the loose block is attached', async () => {
      expect(await check(key, ybcSolutionDocument(key))).toMatchObject({ status: 'checked', started: true, result: { passed: true } });
    });

    it('passes with the Advanced profile too', async () => {
      expect(await check(key, { ...ybcSolutionDocument(key), profile: 'ybc-advanced' })).toMatchObject({ result: { passed: true } });
    });
  });

  it('fails a Yolo:Bit check whose board was removed: the run does not start', async () => {
    const document = ybcSolutionDocument('ybc-heart');
    expect(await check('ybc-heart', { ...document, circuit: { components: [], wires: [] } })).toMatchObject({
      status: 'checked',
      started: false,
      result: { passed: false },
    });
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/samples/challenges.test.ts`

Expected: `FAIL` — cannot resolve `./challenges`.

- [ ] **Step 3: Implement**

**Create `src/samples/challenges.ts`:**

```ts
import type { Challenge, GoalSpec, InputStep } from '../core/challenge';
import type { TemplateKey } from './templates';
import { ybcImages } from './ybc-templates';

// The challenge of each template (N6a S2): what "Kiểm tra" / Check asks of the learner's program. Template data,
// like the documents: the key is the contract, and the goals may be refined without changing it. Labels are in
// both languages of the UI; the host shows the ones the lab sends (stem-lab/v1 `ready`, `check-result`).
// The empty templates have no challenge: a lab on them has nothing to check (an author leaves requiresCheck off).

/** The languages of the lab's UI (src/ui/i18n). */
export type ChallengeLanguage = 'en' | 'vi';

type Text = Readonly<Record<ChallengeLanguage, string>>;
type GoalData = GoalSpec & { id: string; label: Text };
type ChallengeData = { durationMs: number; inputScript?: readonly InputStep[]; goals: readonly GoalData[] };

const hold = (closed: boolean) => ({ kind: 'hold', closed }) as const;
const slider = (value: number) => ({ kind: 'slider', value }) as const;

/** The push button of the generic samples, held from 300 ms to 900 ms. */
const pressButton: readonly InputStep[] = [
  { atMs: 300, componentId: 'button', input: hold(true) },
  { atMs: 900, componentId: 'button', input: hold(false) },
];

const ledFollowsButton: GoalData = {
  id: 'led-follows-button',
  kind: 'led-blinks',
  componentId: 'led',
  minToggles: 2,
  label: { vi: 'Đèn sáng khi bấm nút và tắt khi thả nút', en: 'The LED lights while the button is held and goes off when released' },
};

const challenges: Readonly<Record<TemplateKey, ChallengeData | null>> = {
  'led-on': {
    durationMs: 1000,
    goals: [
      { id: 'led-lit', kind: 'led-lit', componentId: 'led', label: { vi: 'Đèn LED sáng', en: 'The LED lights up' } },
      { id: 'uses-digital-write', kind: 'uses-block', blockType: 'stem_digital_write', label: { vi: 'Dùng khối ghi chân số', en: 'Uses the digital write block' } },
    ],
  },
  blink: {
    durationMs: 3500,
    goals: [
      { id: 'led-blinks', kind: 'led-blinks', componentId: 'led', minToggles: 3, label: { vi: 'Đèn LED nhấp nháy (sáng, tắt, sáng lại)', en: 'The LED blinks (on, off, on again)' } },
      { id: 'uses-wait', kind: 'uses-block', blockType: 'stem_wait', label: { vi: 'Dùng khối chờ', en: 'Uses the wait block' } },
    ],
  },
  'button-direct': { durationMs: 1200, inputScript: pressButton, goals: [ledFollowsButton] },
  'button-led': {
    durationMs: 1200,
    inputScript: pressButton,
    goals: [
      ledFollowsButton,
      { id: 'uses-if', kind: 'uses-block', blockType: 'controls_if', label: { vi: 'Dùng khối nếu… thì… nếu không thì', en: 'Uses the if… else block' } },
    ],
  },
  empty: null,
  'ybc-heart': {
    durationMs: 1000,
    goals: [{ id: 'shows-heart', kind: 'display-shows', frame: ybcImages.heart, label: { vi: 'Màn hình hiện hình trái tim', en: 'The display shows a heart' } }],
  },
  'ybc-button-ab': {
    durationMs: 1500,
    inputScript: [
      { atMs: 200, part: 'button-a', input: hold(true) },
      { atMs: 500, part: 'button-a', input: hold(false) },
      { atMs: 800, part: 'button-b', input: hold(true) },
      { atMs: 1100, part: 'button-b', input: hold(false) },
    ],
    goals: [
      { id: 'a-shows-check', kind: 'display-shows', frame: ybcImages.check, fromMs: 200, label: { vi: 'Nhấn nút A thì hiện dấu ✓', en: 'Button A shows ✓' } },
      { id: 'b-shows-cross', kind: 'display-shows', frame: ybcImages.cross, fromMs: 800, label: { vi: 'Nhấn nút B thì hiện dấu ✗', en: 'Button B shows ✗' } },
    ],
  },
  'ybc-night-light': {
    durationMs: 1500,
    inputScript: [
      { atMs: 300, part: 'light', input: slider(10) },
      { atMs: 1000, part: 'light', input: slider(80) },
    ],
    goals: [
      { id: 'dark-lights-up', kind: 'display-shows', frame: ybcImages.full, fromMs: 300, label: { vi: 'Trời tối (ánh sáng dưới 30) thì màn hình sáng', en: 'In the dark (light below 30) the display lights up' } },
      { id: 'bright-goes-off', kind: 'display-shows', frame: '00000:00000:00000:00000:00000', fromMs: 1100, label: { vi: 'Trời sáng thì màn hình tắt', en: 'In bright light the display goes off' } },
    ],
  },
  'ybc-melody': {
    durationMs: 2000,
    inputScript: [
      { atMs: 200, part: 'button-a', input: hold(true) },
      { atMs: 400, part: 'button-a', input: hold(false) },
    ],
    goals: [{ id: 'a-plays-notes', kind: 'buzzer-played', minNotes: 3, label: { vi: 'Nhấn nút A thì phát ít nhất 3 nốt nhạc', en: 'Button A plays at least 3 notes' } }],
  },
  'ybc-empty': null,
};

/** The challenge of `key` with its labels in `language`, or null when the template has none. */
export function templateChallenge(key: TemplateKey, language: ChallengeLanguage): Challenge | null {
  const data = challenges[key];
  if (!data) {
    return null;
  }
  return {
    durationMs: data.durationMs,
    ...(data.inputScript ? { inputScript: data.inputScript } : {}),
    goals: data.goals.map((goal) => ({ ...goal, label: goal.label[language] })),
  };
}
```

- [ ] **Step 4: Run the tests and the whole gate**

Run: `pnpm vitest run src/samples/challenges.test.ts`

Expected: `Tests  31 passed`.

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  126 passed`, `Tests  4226 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 5: Commit**

```bash
git add src/samples/challenges.test.ts src/samples/challenges.ts
git commit -m "$(cat <<'EOF'
feat(n6a): give every lesson template a challenge (S2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 5: Vietnamese UI and blocks (S5, i18n)  — `model: opus`

Từ điển UI (`en` giữ nguyên chữ cũ, `vi` cùng khoá và cùng tham số), `TextProvider`/`useText` (mặc định `en` ⇒ mọi test component cũ không đổi), `localeOf` (R11: `lab=` ⇒ `vi`, `lang=` ghi đè), text block + tên nhóm toolbox tiếng Việt phủ lên ở UI theo block type (giữ nguyên `%n`), `blockly/msg/vi` cho block có sẵn. Locale chọn **một lần** ở `main.tsx` trước khi Blockly đăng ký block (Blockly giữ định nghĩa đầu tiên). Các component chuyển sang `t(...)`: App, RunToolbar, Console, LaunchError, Palette, RuntimeControls, DisplayText, SoundIndicator, PythonPanel. Cập nhật quy ước ngôn ngữ trong `CLAUDE.md` và `AGENTS.md` (hai file giống hệt nhau).

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `src/main.tsx`
- Modify: `src/ui/app/App.tsx`
- Modify: `src/ui/app/Console.tsx`
- Modify: `src/ui/app/LaunchError.tsx`
- Modify: `src/ui/app/PythonPanel.tsx`
- Modify: `src/ui/app/RunToolbar.tsx`
- Modify: `src/ui/audio/SoundIndicator.tsx`
- Modify: `src/ui/blockly/editor-blocks.ts`
- Create: `src/ui/blockly/locale.ts`
- Modify: `src/ui/canvas/Palette.tsx`
- Create: `src/ui/i18n/blocks.test.ts`
- Create: `src/ui/i18n/blocks.ts`
- Create: `src/ui/i18n/locale.test.ts`
- Create: `src/ui/i18n/locale.ts`
- Create: `src/ui/i18n/messages.test.ts`
- Create: `src/ui/i18n/messages.ts`
- Create: `src/ui/i18n/text.test.tsx`
- Create: `src/ui/i18n/text.tsx`
- Modify: `src/ui/runtime-controls/DisplayText.tsx`
- Modify: `src/ui/runtime-controls/RuntimeControls.tsx`

**Interfaces:**
- Consumes (Task 2): `type Launch`. Core: `BlockDefinitionJson`, `toolbox` (`src/core/program/blocks.ts`), `Toolbox`, `ToolboxCategory`, `buildToolbox`, `createBlockPackCatalog` (`block-packs.ts`), `ANALOG_MAX` (`constructs/ybc.pins.ts`).
- Produces (`src/ui/i18n/messages.ts`): `type Locale = 'en' | 'vi'`, `en` (const), `type MessageKey`, `vi`, `type Params`, `translate(locale, key, params?)`, `isMessageKey(key)`.
- Produces (`src/ui/i18n/text.tsx`): `TextProvider({ locale, children })`, `useLocale()`, `type Text`, `useText(): Text`.
- Produces (`src/ui/i18n/locale.ts`): `localeOf(launch, search): Locale`.
- Produces (`src/ui/i18n/blocks.ts`): `viBlockText`, `viCategoryNames`, `localizeBlockDefinitions(defs, locale)`, `localizeToolbox(toolbox, locale)`.
- Produces (`src/ui/blockly`): `setBlockLocale(locale)` (editor-blocks.ts), `applyEditorLocale(locale)` (locale.ts).
- Produces (`src/ui/app/RunToolbar.tsx`): `diagnosticText(t, diagnostic)` exported.

- [ ] **Step 1: Write the failing tests**

**Create `src/ui/i18n/blocks.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { buildToolbox, createBlockPackCatalog } from '../../core/program/block-packs';
import { toolbox as genericToolbox } from '../../core/program/blocks';
import { localizeBlockDefinitions, localizeToolbox, viBlockText, viCategoryNames } from './blocks';

const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const definitions = packs.definitions();
const placeholders = (message: unknown) => (typeof message === 'string' ? (message.match(/%\d+/g) ?? []).sort() : []);
const hasWords = (message: unknown) => typeof message === 'string' && /\p{L}/u.test(message.replace(/%\d+/g, ''));

describe('Vietnamese blocks (N6a S5)', () => {
  it.each(definitions.map((definition) => [definition.type, definition] as const))('%s keeps the placeholders of the core', (type, definition) => {
    const text = viBlockText[type];
    if (text) {
      expect(placeholders(text.message0)).toEqual(placeholders(definition.message0));
      expect(text.tooltip).not.toBe('');
    }
  });

  it('translates every custom block that has words or a tooltip', () => {
    const missing = definitions.filter((definition) => (hasWords(definition.message0) || typeof definition.tooltip === 'string') && !viBlockText[definition.type]);
    expect(missing.map((definition) => definition.type)).toEqual([]);
  });

  it('translates no block the core does not define', () => {
    const known = new Set(definitions.map((definition) => definition.type));
    expect(Object.keys(viBlockText).filter((type) => !known.has(type))).toEqual([]);
  });

  it('changes only message0 and tooltip, in new objects, and nothing in English', () => {
    const localized = localizeBlockDefinitions(definitions, 'vi');
    localized.forEach((definition, index) => {
      const original = definitions[index];
      expect({ ...definition, message0: null, tooltip: null }).toEqual({ ...original, message0: null, tooltip: null });
    });
    expect(localized.find((definition) => definition.type === 'ybc_display_show_image')?.message0).toBe('hiển thị hình');
    expect(definitions.find((definition) => definition.type === 'ybc_display_show_image')?.message0).toBe('show image');
    expect(localizeBlockDefinitions(definitions, 'en')).toEqual(definitions);
  });

  it('names every toolbox category in Vietnamese', () => {
    const toolboxes = [genericToolbox, ...productionProfiles.ids().map((id) => buildToolbox(productionProfiles.get(id)?.blockPacks ?? [], packs))];
    for (const toolbox of toolboxes) {
      const localized = localizeToolbox(toolbox, 'vi');
      expect(localized.contents.map((category) => category.name).filter((name) => name !== undefined && !Object.values(viCategoryNames).includes(name))).toEqual([]);
      expect(localizeToolbox(toolbox, 'en')).toBe(toolbox);
    }
  });
});
```

**Create `src/ui/i18n/locale.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { parseLaunch } from '../app/launch';
import { localeOf } from './locale';

const of = (search: string) => localeOf(parseLaunch(search), search);

describe('localeOf (N6a S5)', () => {
  it.each(['', '?embed=1&template=blink', '?embed=1&template=blinky', '?template=blink'])('keeps %j in English', (search) => {
    expect(of(search)).toBe('en');
  });

  it.each(['?embed=1&lab=blockly&template=blink', '?embed=1&lab=yolobit&template=ybc-heart&origin=http://localhost:3000', '?embed=1&lab=yolobit&template=blink'])(
    'speaks Vietnamese in the lab launch %j, a broken one too',
    (search) => {
      expect(of(search)).toBe('vi');
    },
  );

  it('follows lang=vi or lang=en whatever the launch', () => {
    expect(of('?lang=vi')).toBe('vi');
    expect(of('?embed=1&template=blink&lang=vi')).toBe('vi');
    expect(of('?embed=1&lab=blockly&template=blink&lang=en')).toBe('en');
    expect(of('?embed=1&lab=blockly&template=blink&lang=fr')).toBe('vi');
  });
});
```

**Create `src/ui/i18n/messages.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { en, isMessageKey, translate, vi, type MessageKey } from './messages';

const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const keys = Object.keys(en) as MessageKey[];

describe('UI messages (N6a S5)', () => {
  it('has every key in both languages, and no other', () => {
    expect(Object.keys(vi).sort()).toEqual([...keys].sort());
  });

  it.each(keys)('%s has the same parameters in both languages, and no empty text', (key) => {
    expect(params(vi[key])).toEqual(params(en[key]));
    expect(vi[key].trim()).not.toBe('');
  });

  it('fills the parameters, and leaves an unknown one as written', () => {
    expect(translate('vi', 'palette.add', { name: 'Đèn LED' })).toBe('Thêm Đèn LED');
    expect(translate('en', 'console.hiddenMany', { count: 3 })).toBe('3 earlier lines hidden');
    expect(translate('en', 'palette.add')).toBe('Add {name}');
  });

  it('keeps the English of the standalone editor as it was', () => {
    expect(translate('en', 'run.status.finished')).toBe('Program finished — board powered');
    expect(translate('en', 'python.claim')).toBe(
      'Generated for Yolo:Bit MicroPython. MicroPython syntax validation: pending. Physical-board verification: pending.',
    );
  });

  it.each(['device.led', 'control.light'])('knows %s', (key) => {
    expect(isMessageKey(key)).toBe(true);
  });

  it.each(['device.servo', 'toString', 'constructor', ''])('does not take %j for a key', (key) => {
    expect(isMessageKey(key)).toBe(false);
  });
});
```

**Create `src/ui/i18n/text.test.tsx`:**

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Palette } from '../canvas/Palette';
import { TextProvider, useText } from './text';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function Probe() {
  const t = useText();
  return <p>{t('run.run')}</p>;
}

describe('TextProvider (N6a S5)', () => {
  it('is English without a provider, as every component test expects', async () => {
    await act(async () => root.render(<Probe />));
    expect(container.textContent).toBe('Run');
  });

  it('speaks the provider’s language', async () => {
    await act(async () =>
      root.render(
        <TextProvider locale="vi">
          <Probe />
        </TextProvider>,
      ),
    );
    expect(container.textContent).toBe('Chạy');
  });

  it('names devices in Vietnamese, and keeps a name it does not know', async () => {
    const items = [
      { deviceType: 'led', name: 'LED' },
      { deviceType: 'servo', name: 'Servo' },
    ];
    await act(async () =>
      root.render(
        <TextProvider locale="vi">
          <Palette items={items} disabled={false} onAdd={() => {}} />
        </TextProvider>,
      ),
    );
    expect([...container.querySelectorAll('button')].map((button) => [button.getAttribute('aria-label'), button.textContent])).toEqual([
      ['Thêm Đèn LED', '+ Đèn LED'],
      ['Thêm Servo', '+ Servo'],
    ]);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/ui/i18n`

Expected: `FAIL` — the four test files cannot resolve `./messages`, `./locale`, `./blocks`, `./text`.

- [ ] **Step 3: Implement**

**Edit `AGENTS.md`** (1 change(s), each `old` occurs exactly once):

**Replace in `AGENTS.md`** (1):

```markdown
- **Commands:** run `pnpm verify` (typecheck + lint + unit tests) before finishing a task; run `pnpm e2e` for UI changes.
- **Versions:** read the installed package types before using an API (React 19, Vite 8, Vitest 4, ESLint 10, TypeScript 6). Vitest 5 and TypeScript 7 are intentionally not used (see plan §4).
- **Language:** UI strings, identifiers and comments in English; docs in Vietnamese with English technical terms.
```

with:

```markdown
- **Commands:** run `pnpm verify` (typecheck + lint + unit tests) before finishing a task; run `pnpm e2e` for UI changes.
- **Versions:** read the installed package types before using an API (React 19, Vite 8, Vitest 4, ESLint 10, TypeScript 6). Vitest 5 and TypeScript 7 are intentionally not used (see plan §4).
- **Language:** identifiers and comments in English; docs in Vietnamese with English technical terms. UI strings live in `src/ui/i18n/messages.ts` (English `en` and Vietnamese `vi`, same keys) and are read with `useText()`; never write a UI string inline. The standalone editor and the legacy `?embed=1&template=` lab speak English, `lab=` launches Vietnamese (`src/ui/i18n/locale.ts`). Custom block text is overlaid in the UI (`src/ui/i18n/blocks.ts`), never in `src/core` (B1). Template challenge labels carry both languages (`src/samples/challenges.ts`).
```

**Edit `CLAUDE.md`** (1 change(s), each `old` occurs exactly once):

**Replace in `CLAUDE.md`** (1):

```markdown
- **Commands:** run `pnpm verify` (typecheck + lint + unit tests) before finishing a task; run `pnpm e2e` for UI changes.
- **Versions:** read the installed package types before using an API (React 19, Vite 8, Vitest 4, ESLint 10, TypeScript 6). Vitest 5 and TypeScript 7 are intentionally not used (see plan §4).
- **Language:** UI strings, identifiers and comments in English; docs in Vietnamese with English technical terms.
```

with:

```markdown
- **Commands:** run `pnpm verify` (typecheck + lint + unit tests) before finishing a task; run `pnpm e2e` for UI changes.
- **Versions:** read the installed package types before using an API (React 19, Vite 8, Vitest 4, ESLint 10, TypeScript 6). Vitest 5 and TypeScript 7 are intentionally not used (see plan §4).
- **Language:** identifiers and comments in English; docs in Vietnamese with English technical terms. UI strings live in `src/ui/i18n/messages.ts` (English `en` and Vietnamese `vi`, same keys) and are read with `useText()`; never write a UI string inline. The standalone editor and the legacy `?embed=1&template=` lab speak English, `lab=` launches Vietnamese (`src/ui/i18n/locale.ts`). Custom block text is overlaid in the UI (`src/ui/i18n/blocks.ts`), never in `src/core` (B1). Template challenge labels carry both languages (`src/samples/challenges.ts`).
```

**Edit `src/main.tsx`** (4 change(s), each `old` occurs exactly once):

**Replace in `src/main.tsx`** (1):

```tsx
import { installTestHooks } from './ui/app/test-hooks';
import { canOpenProgram } from './ui/blockly/editor-blocks';
import { startAutosave } from './ui/state/autosave';
import { createProjectStore } from './ui/state/project-store';
```

with:

```tsx
import { installTestHooks } from './ui/app/test-hooks';
import { canOpenProgram } from './ui/blockly/editor-blocks';
import { applyEditorLocale } from './ui/blockly/locale';
import { localeOf } from './ui/i18n/locale';
import { TextProvider } from './ui/i18n/text';
import { startAutosave } from './ui/state/autosave';
import { createProjectStore } from './ui/state/project-store';
```

**Replace in `src/main.tsx`** (2):

```tsx
// it in the meantime; an embedded lab opens its template and never touches
// storage (S1).
const started = await openAtStartup(parseLaunch(window.location.search), {
  openRepository: () => createDexieProjectRepository(),
  registry,
```

with:

```tsx
// it in the meantime; an embedded lab opens its template and never touches
// storage (S1).
const launch = parseLaunch(window.location.search);
// The UI's language is chosen once, before Blockly registers a block (N6a S5).
const locale = localeOf(launch, window.location.search);
document.documentElement.lang = locale;
applyEditorLocale(locale);

const started = await openAtStartup(launch, {
  openRepository: () => createDexieProjectRepository(),
  registry,
```

**Replace in `src/main.tsx`** (3):

```tsx
  root.render(
    <StrictMode>
      <LaunchError problem={started.problem} lab={started.lab} />
    </StrictMode>,
  );
```

with:

```tsx
  root.render(
    <StrictMode>
      <TextProvider locale={locale}>
        <LaunchError problem={started.problem} lab={started.lab} />
      </TextProvider>
    </StrictMode>,
  );
```

**Replace in `src/main.tsx`** (4):

```tsx
  root.render(
    <StrictMode>
      <App
        projectStore={projectStore}
        runStore={runStore}
        registry={registry}
        profiles={profiles}
        packs={packs}
        notice={started.notice}
      />
    </StrictMode>,
  );
```

with:

```tsx
  root.render(
    <StrictMode>
      <TextProvider locale={locale}>
        <App
          projectStore={projectStore}
          runStore={runStore}
          registry={registry}
          profiles={profiles}
          packs={packs}
          notice={started.notice}
        />
      </TextProvider>
    </StrictMode>,
  );
```

**Edit `src/ui/app/App.tsx`** (7 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/App.tsx`** (1):

```tsx
import { toneHz } from '../audio/tone';
import { BlocklyPanel, type BlocklyPanelHandle } from '../blockly/BlocklyPanel';
import { CircuitCanvas } from '../canvas/CircuitCanvas';
import { PotentiometerControls } from '../canvas/PotentiometerControls';
```

with:

```tsx
import { toneHz } from '../audio/tone';
import { BlocklyPanel, type BlocklyPanelHandle } from '../blockly/BlocklyPanel';
import { localizeToolbox } from '../i18n/blocks';
import { useLocale, useText } from '../i18n/text';
import { CircuitCanvas } from '../canvas/CircuitCanvas';
import { PotentiometerControls } from '../canvas/PotentiometerControls';
```

**Replace in `src/ui/app/App.tsx`** (2):

```tsx
  const running = useStore(runStore, selectIsRunning);
  const blocklyRef = useRef<BlocklyPanelHandle>(null);
  // The one place the family, the palette and the toolbox are decided (R-F1…R-F6):
  // from the document's profile, never from the boards on the canvas.
```

with:

```tsx
  const running = useStore(runStore, selectIsRunning);
  const blocklyRef = useRef<BlocklyPanelHandle>(null);
  const t = useText();
  const locale = useLocale();
  // The one place the family, the palette and the toolbox are decided (R-F1…R-F6):
  // from the document's profile, never from the boards on the canvas.
```

**Replace in `src/ui/app/App.tsx`** (3):

```tsx
  // Only a different set of packs is a different toolbox, so circuit edits keep the Blockly workspace.
  const packKey = context.blockPacks.join('|');
  const toolbox = useMemo(() => buildToolbox(packKey === '' ? [] : packKey.split('|'), packs), [packKey, packs]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // Counts Run clicks. The runtime controls start from their initial place in every run (inputs belong to a run, B2).
```

with:

```tsx
  // Only a different set of packs is a different toolbox, so circuit edits keep the Blockly workspace.
  const packKey = context.blockPacks.join('|');
  const toolbox = useMemo(() => localizeToolbox(buildToolbox(packKey === '' ? [] : packKey.split('|'), packs), locale), [packKey, packs, locale]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  // Counts Run clicks. The runtime controls start from their initial place in every run (inputs belong to a run, B2).
```

**Replace in `src/ui/app/App.tsx`** (4):

```tsx
    <div className="app-shell">
      <header className="app-header">
        <h1>STEM Studio</h1>
        <p>Proof of Concept</p>
        <button type="button" onClick={newProject} disabled={running}>
          New
        </button>
        <RunToolbar runStore={runStore} onRun={run} />
```

with:

```tsx
    <div className="app-shell">
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <p>{t('app.subtitle')}</p>
        <button type="button" onClick={newProject} disabled={running}>
          {t('app.new')}
        </button>
        <RunToolbar runStore={runStore} onRun={run} />
```

**Replace in `src/ui/app/App.tsx`** (5):

```tsx
            {shownNotice}
            <button type="button" onClick={() => setNoticeDismissed(true)}>
              Dismiss
            </button>
          </p>
```

with:

```tsx
            {shownNotice}
            <button type="button" onClick={() => setNoticeDismissed(true)}>
              {t('app.dismiss')}
            </button>
          </p>
```

**Replace in `src/ui/app/App.tsx`** (6):

```tsx
      </header>
      <main className="workspace">
        <section className={isYbc ? 'canvas-region canvas-region-with-board-panel' : 'canvas-region'} aria-label="Circuit">
          {isYbc ? (
            <>
```

with:

```tsx
      </header>
      <main className="workspace">
        <section className={isYbc ? 'canvas-region canvas-region-with-board-panel' : 'canvas-region'} aria-label={t('app.circuit')}>
          {isYbc ? (
            <>
```

**Replace in `src/ui/app/App.tsx`** (7):

```tsx
        <section
          className={context.family === 'ybc' ? 'program-region program-region-with-python' : 'program-region'}
          aria-label="Program"
          data-testid="program-region"
        >
```

with:

```tsx
        <section
          className={context.family === 'ybc' ? 'program-region program-region-with-python' : 'program-region'}
          aria-label={t('app.program')}
          data-testid="program-region"
        >
```

**Edit `src/ui/app/Console.tsx`** (1 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/Console.tsx`** (1):

```tsx
import type { ConsoleSnapshot } from '../../core/program/console';

/** What a Yolo:Bit-compatible program printed: the newest lines, and how many older ones were let go (YB plan §6.7). */
export function Console({ console }: { console: ConsoleSnapshot }) {
  return (
    <div className="run-console" role="log" aria-label="Console" data-testid="console">
      {console.hidden > 0 && (
        <p className="run-console-hidden" data-testid="console-hidden">
          {console.hidden} earlier {console.hidden === 1 ? 'line' : 'lines'} hidden
        </p>
      )}
```

with:

```tsx
import type { ConsoleSnapshot } from '../../core/program/console';
import { useText } from '../i18n/text';

/** What a Yolo:Bit-compatible program printed: the newest lines, and how many older ones were let go (YB plan §6.7). */
export function Console({ console }: { console: ConsoleSnapshot }) {
  const t = useText();
  return (
    <div className="run-console" role="log" aria-label={t('console.label')} data-testid="console">
      {console.hidden > 0 && (
        <p className="run-console-hidden" data-testid="console-hidden">
          {t(console.hidden === 1 ? 'console.hiddenOne' : 'console.hiddenMany', { count: console.hidden })}
        </p>
      )}
```

**Edit `src/ui/app/LaunchError.tsx`** (1 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/LaunchError.tsx`** (1):

```tsx
import { templateKeys, templateKeysOf, type LabKind } from '../../samples/templates';
import './app.css';

/** Shown instead of the editor when the launch URL is broken (S1): no project is opened. A lab launch lists its own templates (N6a S0). */
export function LaunchError({ problem, lab }: { problem: string; lab?: LabKind }) {
  const supported = lab === undefined ? templateKeys : templateKeysOf(lab);
  return (
    <main className="launch-error" role="alert" data-testid="launch-error">
      <h1>STEM Studio</h1>
      <p className="launch-error-title">This lab could not be opened.</p>
      <p>{problem}</p>
      <p>Supported templates: {supported.join(', ')}.</p>
    </main>
  );
```

with:

```tsx
import { templateKeys, templateKeysOf, type LabKind } from '../../samples/templates';
import { useText } from '../i18n/text';
import './app.css';

/** Shown instead of the editor when the launch URL is broken (S1): no project is opened. A lab launch lists its own templates (N6a S0). */
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
  );
```

**Edit `src/ui/app/PythonPanel.tsx`** (6 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/PythonPanel.tsx`** (1):

```tsx
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { BlockPackCatalog } from '../../core/program/block-packs';

// The Python panel of a Yolo:Bit-compatible project (YB plan §13.7): the MicroPython the
```

with:

```tsx
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { BlockPackCatalog } from '../../core/program/block-packs';
import { useText } from '../i18n/text';

// The Python panel of a Yolo:Bit-compatible project (YB plan §13.7): the MicroPython the
```

**Replace in `src/ui/app/PythonPanel.tsx`** (2):

```tsx
// not been run over this generator's output (plan §13.9, OQ-B: that is the YB-5A freeze condition),
// and no board has run it (L3). The L2 sentence of §6.9 ("code-generation compatible") is NOT used
// until mpy-cross has passed; then this constant is the one line to change.
//
// FRESHNESS. What is shown follows the document after a debounce, and the document follows Blockly
```

with:

```tsx
// not been run over this generator's output (plan §13.9, OQ-B: that is the YB-5A freeze condition),
// and no board has run it (L3). The L2 sentence of §6.9 ("code-generation compatible") is NOT used
// until mpy-cross has passed; then the message `python.claim` (src/ui/i18n/messages.ts) is the line to change.
//
// FRESHNESS. What is shown follows the document after a debounce, and the document follows Blockly
```

**Replace in `src/ui/app/PythonPanel.tsx`** (3):

```tsx
/** Contract IM-8: the downloaded file is `program.py`. */
export const downloadName = 'program.py';

const claim = 'Generated for Yolo:Bit MicroPython. MicroPython syntax validation: pending. Physical-board verification: pending.';

const layerText = { 'L-1': 'The project cannot be opened.', 'L-2': 'The project does not fit this profile.', 'L-3': 'The program cannot run yet.', 'L-4': 'Python cannot be generated yet.' };

type ProjectView = Pick<ProjectDocument, 'profile' | 'circuit' | 'program'>;
```

with:

```tsx
/** Contract IM-8: the downloaded file is `program.py`. */
export const downloadName = 'program.py';

type ProjectView = Pick<ProjectDocument, 'profile' | 'circuit' | 'program'>;
```

**Replace in `src/ui/app/PythonPanel.tsx`** (4):

```tsx
  const sourceRef = useRef<HTMLPreElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
```

with:

```tsx
  const sourceRef = useRef<HTMLPreElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const t = useText();

  useEffect(() => {
```

**Replace in `src/ui/app/PythonPanel.tsx`** (5):

```tsx
        <h2>Python</h2>
        <button type="button" onClick={() => void copySource()} disabled={!generation.ok}>
          {copy === 'copied' ? 'Copied' : 'Copy'}
        </button>
        <button type="button" onClick={download} disabled={!generation.ok}>
          Download
        </button>
      </header>
      <p className="python-copy-status" role="status" data-testid="python-copy-status">
        {copy === 'failed' && generation.ok ? `Copy failed. Press ${copyKey()} to copy the selected code.` : ''}
      </p>
      {generation.ok ? (
        <>
          <p className="python-claim" data-testid="python-claim">
            {claim}
          </p>
          <pre ref={sourceRef} className="python-source" data-testid="python-source" tabIndex={0}>
```

with:

```tsx
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
```

**Replace in `src/ui/app/PythonPanel.tsx`** (6):

```tsx
      ) : (
        <div className="python-blocked" role="status" data-testid="python-diagnostics">
          <p>{layerText[generation.layer]}</p>
          <ul>
            {generation.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {diagnostic.severity === 'error' ? 'Error' : 'Warning'}: {diagnostic.message}
              </li>
            ))}
```

with:

```tsx
      ) : (
        <div className="python-blocked" role="status" data-testid="python-diagnostics">
          <p>{t(`python.layer.${generation.layer}`)}</p>
          <ul>
            {generation.diagnostics.map((diagnostic, index) => (
              <li key={index}>
                {t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: diagnostic.message })}
              </li>
            ))}
```

**Replace the whole file `src/ui/app/RunToolbar.tsx`:**

```tsx
import { useStore } from 'zustand';
import type { RunDiagnostic } from '../../core/run/run-session';
import { useText, type Text } from '../i18n/text';
import { selectIsRunning, type RunStore } from '../state/run-store';
import { Console } from './Console';

/** A diagnostic of the core as the toolbar lists it: the core's message (English) after the UI's own prefix. */
export const diagnosticText = (t: Text, diagnostic: RunDiagnostic) =>
  t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: diagnostic.message });

type RunToolbarProps = { runStore: RunStore; onRun(): void };

export function RunToolbar({ runStore, onRun }: RunToolbarProps) {
  const snapshot = useStore(runStore, (state) => state.snapshot);
  const startFailure = useStore(runStore, (state) => state.startFailure);
  const running = useStore(runStore, selectIsRunning);
  const t = useText();

  // A failed Run leaves the session idle, so its reasons come from the start result.
  const messages = startFailure
    ? [t(`run.failure.${startFailure.reason}`), ...startFailure.diagnostics.map((diagnostic) => diagnosticText(t, diagnostic))]
    : [
        ...(snapshot.error ? [t('run.error', { message: snapshot.error.message })] : []),
        ...snapshot.diagnostics.map((diagnostic) => diagnosticText(t, diagnostic)),
      ];

  return (
    <div className="run-toolbar" role="toolbar" aria-label={t('run.toolbar')}>
      <button type="button" onClick={onRun}>
        {t('run.run')}
      </button>
      <button type="button" onClick={() => runStore.getState().stop()} disabled={!running}>
        {t('run.stop')}
      </button>
      <span className={`run-status run-status-${snapshot.status}`} role="status" data-testid="run-status">
        {t(`run.status.${snapshot.status}`)}
      </span>
      {snapshot.console && <Console console={snapshot.console} />}
      {messages.length > 0 && (
        <ul className="run-messages" data-testid="run-messages">
          {messages.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

**Edit `src/ui/audio/SoundIndicator.tsx`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/ui/audio/SoundIndicator.tsx`** (1):

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { createAudioPlayer, type AudioPlayer } from './audio-player';
import { describeTone, toneHz } from './tone';

type SoundIndicatorProps = {
```

with:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { useText } from '../i18n/text';
import { createAudioPlayer, type AudioPlayer } from './audio-player';
import { formatHz, toneHz } from './tone';

type SoundIndicatorProps = {
```

**Replace in `src/ui/audio/SoundIndicator.tsx`** (2):

```tsx
export function SoundIndicator({ buzzer, tones }: SoundIndicatorProps) {
  const hz = toneHz(buzzer);
  const [enabled, setEnabled] = useState(false);
  const player = useRef<AudioPlayer | null>(null);
```

with:

```tsx
export function SoundIndicator({ buzzer, tones }: SoundIndicatorProps) {
  const hz = toneHz(buzzer);
  const t = useText();
  const [enabled, setEnabled] = useState(false);
  const player = useRef<AudioPlayer | null>(null);
```

**Replace in `src/ui/audio/SoundIndicator.tsx`** (3):

```tsx
      {/* The label says what a click does and changes with the state; aria-pressed as well would announce the state twice. */}
      <button type="button" onClick={toggle}>
        {enabled ? 'Turn sound off' : 'Turn sound on'}
      </button>
      <span className={hz === undefined ? 'sound-state' : 'sound-state sound-state-playing'} data-testid="sound-indicator">
        {describeTone(hz)}
      </span>
    </div>
```

with:

```tsx
      {/* The label says what a click does and changes with the state; aria-pressed as well would announce the state twice. */}
      <button type="button" onClick={toggle}>
        {enabled ? t('sound.turnOff') : t('sound.turnOn')}
      </button>
      <span className={hz === undefined ? 'sound-state' : 'sound-state sound-state-playing'} data-testid="sound-indicator">
        {hz === undefined ? t('sound.silent') : t('sound.playing', { hz: formatHz(hz) })}
      </span>
    </div>
```

**Edit `src/ui/blockly/editor-blocks.ts`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/ui/blockly/editor-blocks.ts`** (1):

```ts
import type { BlockPackCatalog } from '../../core/program/block-packs';
import { MAX_PROGRAM_BLOCKS, MAX_TEXT_JOIN_PARTS } from '../../core/program/limits';

// The editor's blocks, as Blockly knows them: registered once, and used to
```

with:

```ts
import type { BlockPackCatalog } from '../../core/program/block-packs';
import { MAX_PROGRAM_BLOCKS, MAX_TEXT_JOIN_PARTS } from '../../core/program/limits';
import { localizeBlockDefinitions } from '../i18n/blocks';
import type { Locale } from '../i18n/messages';

// The editor's blocks, as Blockly knows them: registered once, and used to
```

**Replace in `src/ui/blockly/editor-blocks.ts`** (2):

```ts

const registeredTypes = new Set<string>();

/**
```

with:

```ts

const registeredTypes = new Set<string>();

/** The language the blocks are registered in; Blockly keeps a definition once registered, so it is set first (N6a S5). */
let blockLocale: Locale = 'en';

/** Chooses the language of the custom blocks. Called once at startup, before any block is registered (src/ui/blockly/locale.ts). */
export function setBlockLocale(locale: Locale) {
  blockLocale = locale;
}

/**
```

**Replace in `src/ui/blockly/editor-blocks.ts`** (3):

```ts
 */
export function registerBlocks(packs: BlockPackCatalog) {
  const fresh = packs.definitions().filter((definition) => !registeredTypes.has(definition.type));
  if (fresh.length > 0) {
    Blockly.common.defineBlocksWithJsonArray(fresh);
```

with:

```ts
 */
export function registerBlocks(packs: BlockPackCatalog) {
  const fresh = localizeBlockDefinitions(packs.definitions(), blockLocale).filter((definition) => !registeredTypes.has(definition.type));
  if (fresh.length > 0) {
    Blockly.common.defineBlocksWithJsonArray(fresh);
```

**Create `src/ui/blockly/locale.ts`:**

```ts
import * as Blockly from 'blockly';
import * as viMessages from 'blockly/msg/vi';
import type { Locale } from '../i18n/messages';
import { setBlockLocale } from './editor-blocks';

/**
 * Puts the block editor in the UI's language (N6a S5): Blockly's own blocks and menus (`blockly/msg/vi`) and
 * the custom blocks (src/ui/i18n/blocks.ts). Called once at startup, before anything registers a block or opens
 * a workspace: Blockly reads its messages when a block is created and keeps a definition once registered.
 */
export function applyEditorLocale(locale: Locale) {
  setBlockLocale(locale);
  if (locale === 'vi') {
    Blockly.setLocale(viMessages as unknown as Record<string, string>);
  }
}
```

**Edit `src/ui/canvas/Palette.tsx`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/canvas/Palette.tsx`** (1):

```tsx
import type { PaletteItem } from './palette-model';

```

with:

```tsx
import { isMessageKey } from '../i18n/messages';
import { useText } from '../i18n/text';
import type { PaletteItem } from './palette-model';

```

**Replace in `src/ui/canvas/Palette.tsx`** (2):

```tsx
/** Click-to-add: each device goes to the middle of the canvas. */
export function Palette({ items, disabled, onAdd }: PaletteProps) {
  return (
    <div className="palette" role="toolbar" aria-label="Add a device">
      {items.map((item) => (
        <button
          key={item.deviceType}
          type="button"
          aria-label={`Add ${item.name}`}
          disabled={disabled}
          onClick={() => onAdd(item.deviceType)}
        >
          + {item.name}
        </button>
      ))}
```

with:

```tsx
/** Click-to-add: each device goes to the middle of the canvas. */
export function Palette({ items, disabled, onAdd }: PaletteProps) {
  const t = useText();
  // A device the dictionary does not know keeps the name of its definition.
  const nameOf = (item: PaletteItem) => {
    const key = `device.${item.deviceType}`;
    return isMessageKey(key) ? t(key) : item.name;
  };
  return (
    <div className="palette" role="toolbar" aria-label={t('palette.label')}>
      {items.map((item) => (
        <button
          key={item.deviceType}
          type="button"
          aria-label={t('palette.add', { name: nameOf(item) })}
          disabled={disabled}
          onClick={() => onAdd(item.deviceType)}
        >
          + {nameOf(item)}
        </button>
      ))}
```

**Create `src/ui/i18n/blocks.ts`:**

```ts
import { ANALOG_MAX } from '../../core/constructs/ybc.pins';
import type { Toolbox, ToolboxCategory } from '../../core/program/block-packs';
import type { BlockDefinitionJson } from '../../core/program/blocks';
import type { Locale } from './messages';

// The Vietnamese text of the custom blocks and of the toolbox (N6a S5). The core declares its blocks in English
// (it has no locale, B1: it must not import the UI); the UI overlays this text, by block type, before Blockly
// registers them. Only `message0` and `tooltip` change: the `%n` placeholders are the same as the core's
// (blocks.test.ts), so every field and input stays where the core put it. Blockly's own blocks (if, compare,
// numbers, variables…) get their Vietnamese from `blockly/msg/vi` (src/ui/blockly/locale.ts).

type BlockText = { message0: string; tooltip: string };

export const viBlockText: Readonly<Record<string, BlockText>> = {
  stem_on_start: { message0: 'khi bắt đầu %1 %2', tooltip: 'Chạy một lần khi chương trình bắt đầu.' },
  stem_forever: { message0: 'lặp mãi mãi %1 %2', tooltip: 'Lặp lại cho tới khi chương trình dừng.' },
  stem_digital_write: { message0: 'ghi chân số %1 mức %2', tooltip: 'Đặt một chân số ở mức HIGH hoặc LOW.' },
  stem_digital_read: { message0: 'đọc chân số %1', tooltip: 'Đúng khi chân đang ở mức HIGH.' },
  stem_wait: { message0: 'chờ %1 giây', tooltip: 'Tạm dừng chương trình.' },
  ybc_display_show_image: { message0: 'hiển thị hình', tooltip: 'Hiện hình bạn vẽ trên màn hình 5×5. Ô được đánh dấu là một đèn đỏ sáng; hình mới thay toàn bộ màn hình.' },
  ybc_display_scroll_text: { message0: 'chạy chữ %1', tooltip: 'Cho chữ chạy qua màn hình. Chỉ chữ cái không dấu, chữ số và ký hiệu từ dấu cách tới ~. Chương trình chờ tới khi chữ chạy hết.' },
  ybc_display_scroll_number: { message0: 'chạy số %1', tooltip: 'Cho một số nguyên chạy qua màn hình. Một chữ số thì đứng yên; chương trình chờ tới khi số chạy hết.' },
  ybc_display_clear: { message0: 'xoá màn hình', tooltip: 'Tắt mọi đèn của màn hình.' },
  ybc_button_pressed: { message0: 'nút %1 đang được nhấn', tooltip: 'Đúng khi nút đang được giữ ở thời điểm này.' },
  ybc_button_presses: { message0: 'số lần nhấn nút %1', tooltip: 'Số lần nút được nhấn kể từ lần đọc trước (bởi bất kỳ khối nào); đọc xong thì đếm lại từ 0.' },
  ybc_light_level: { message0: 'mức ánh sáng', tooltip: 'Độ sáng, một số nguyên từ 0 (tối nhất) tới 100 (sáng nhất).' },
  ybc_sound_note: { message0: 'phát nốt %1 trong %2 nhịp', tooltip: 'Phát một nốt rồi chờ nốt kết thúc. Một nhịp dài 125 mili giây.' },
  ybc_sound_rest: { message0: 'nghỉ %1 nhịp', tooltip: 'Im lặng và chờ. Một nhịp dài 125 mili giây.' },
  ybc_pin_write: { message0: 'đặt chân %1 thành %2', tooltip: 'Bật hoặc tắt một chân.' },
  ybc_pin_read: { message0: 'đọc số chân %1', tooltip: 'Đúng khi chân đang bật.' },
  ybc_pin_analog: { message0: 'đọc tương tự chân %1', tooltip: `Đọc giá trị tương tự của một chân: từ 0 tới ${ANALOG_MAX}.` },
  ybc_arith: { message0: '%1 %2 %3', tooltip: 'Cộng, trừ hoặc nhân hai số nguyên.' },
  ybc_int_divide: { message0: '%1 // %2', tooltip: 'Chia lấy phần nguyên, làm tròn xuống (như // của Python).' },
  ybc_while: { message0: 'lặp khi %1 %2', tooltip: 'Lặp lại khi điều kiện còn đúng.' },
  ybc_count_up: { message0: 'đếm lên với %1 từ %2 tới %3 bước %4 %5', tooltip: 'Đếm từ số thứ nhất lên số thứ hai, theo bước.' },
  ybc_wait_ms: { message0: 'chờ %1 ms', tooltip: 'Tạm dừng chương trình trong một số mili giây.' },
};

/** The toolbox categories, by the core's English name. */
export const viCategoryNames: Readonly<Record<string, string>> = {
  Events: 'Sự kiện',
  Program: 'Chương trình',
  Pins: 'Chân',
  Logic: 'Logic',
  Loops: 'Vòng lặp',
  Time: 'Thời gian',
  Math: 'Toán',
  Text: 'Chữ',
  Variables: 'Biến',
  Display: 'Màn hình',
  Input: 'Đầu vào',
  Sound: 'Âm thanh',
};

/** The definitions in `locale`: new objects, the core's left as they are. */
export function localizeBlockDefinitions(definitions: readonly BlockDefinitionJson[], locale: Locale): BlockDefinitionJson[] {
  if (locale === 'en') {
    return [...definitions];
  }
  return definitions.map((definition) => {
    const text = Object.hasOwn(viBlockText, definition.type) ? viBlockText[definition.type] : undefined;
    return text ? { ...definition, message0: text.message0, tooltip: text.tooltip } : definition;
  });
}

/** The toolbox in `locale`: only category names change. */
export function localizeToolbox(toolbox: Toolbox, locale: Locale): Toolbox {
  if (locale === 'en') {
    return toolbox;
  }
  const localize = (category: ToolboxCategory): ToolboxCategory =>
    category.name !== undefined && Object.hasOwn(viCategoryNames, category.name) ? { ...category, name: viCategoryNames[category.name] } : category;
  return { ...toolbox, contents: toolbox.contents.map(localize) };
}
```

**Create `src/ui/i18n/locale.ts`:**

```ts
import type { Launch } from '../app/launch';
import type { Locale } from './messages';

/**
 * The language of the UI for this launch (N6a S5): `lang=vi` or `lang=en` when given; otherwise Vietnamese for
 * a lab launch (`lab=`, the LMS's labs, including a broken one) and English for the standalone editor and the
 * legacy S1 lab, which stay as they were.
 */
export function localeOf(launch: Launch, search: string): Locale {
  const lang = new URLSearchParams(search).get('lang');
  if (lang === 'vi' || lang === 'en') {
    return lang;
  }
  return launch.mode !== 'standalone' && launch.lab !== undefined ? 'vi' : 'en';
}
```

**Create `src/ui/i18n/messages.ts`:**

```ts
// The strings of the lab's UI in its two languages (N6a S5). English is the standalone editor's, unchanged; a
// lab launched by an LMS (`lab=`) speaks Vietnamese (locale.ts). Every key exists in both, with the same
// `{name}` parameters (messages.test.ts). What the core says (compiler and runtime diagnostics) stays English:
// the core has no UI strings to translate (B1).

export type Locale = 'en' | 'vi';

export const en = {
  'app.title': 'STEM Studio',
  'app.subtitle': 'Proof of Concept',
  'app.new': 'New',
  'app.dismiss': 'Dismiss',
  'app.circuit': 'Circuit',
  'app.program': 'Program',
  'run.toolbar': 'Run',
  'run.run': 'Run',
  'run.stop': 'Stop',
  'run.status.idle': 'Idle',
  'run.status.running': 'Running',
  'run.status.finished': 'Program finished — board powered',
  'run.status.error': 'Error',
  'run.failure.no-board': 'The circuit needs a board.',
  'run.failure.multiple-boards': 'The circuit can have only one board.',
  'run.failure.incompatible-devices': 'The circuit has devices that this kind of project cannot use.',
  'run.failure.compile-error': 'The program has errors.',
  'run.error': 'Error: {message}',
  'diagnostic.error': 'Error: {message}',
  'diagnostic.warning': 'Warning: {message}',
  'console.label': 'Console',
  'console.hiddenOne': '{count} earlier line hidden',
  'console.hiddenMany': '{count} earlier lines hidden',
  'launch.title': 'This lab could not be opened.',
  'launch.supported': 'Supported templates: {keys}.',
  'palette.label': 'Add a device',
  'palette.add': 'Add {name}',
  'device.board': 'STEM Board',
  'device.ybc-board': 'Bit-compatible Board',
  'device.led': 'LED',
  'device.resistor': 'Resistor',
  'device.push-button': 'Push Button',
  'device.potentiometer': 'Potentiometer',
  'controls.label': 'Board controls',
  'control.button-a': 'Button A',
  'control.button-b': 'Button B',
  'control.light': 'Light level',
  'display.label': 'Display text',
  'sound.turnOn': 'Turn sound on',
  'sound.turnOff': 'Turn sound off',
  'sound.silent': 'Silent',
  'sound.playing': 'Playing {hz}',
  'python.copy': 'Copy',
  'python.copied': 'Copied',
  'python.download': 'Download',
  'python.copyFailed': 'Copy failed. Press {key} to copy the selected code.',
  'python.claim': 'Generated for Yolo:Bit MicroPython. MicroPython syntax validation: pending. Physical-board verification: pending.',
  'python.layer.L-1': 'The project cannot be opened.',
  'python.layer.L-2': 'The project does not fit this profile.',
  'python.layer.L-3': 'The program cannot run yet.',
  'python.layer.L-4': 'Python cannot be generated yet.',
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof en;

export const vi: Readonly<Record<MessageKey, string>> = {
  'app.title': 'STEM Studio',
  'app.subtitle': 'Bản thử nghiệm',
  'app.new': 'Mới',
  'app.dismiss': 'Đóng',
  'app.circuit': 'Mạch',
  'app.program': 'Chương trình',
  'run.toolbar': 'Chạy',
  'run.run': 'Chạy',
  'run.stop': 'Dừng',
  'run.status.idle': 'Chưa chạy',
  'run.status.running': 'Đang chạy',
  'run.status.finished': 'Chương trình đã chạy xong — bo mạch vẫn bật',
  'run.status.error': 'Lỗi',
  'run.failure.no-board': 'Mạch cần có một bo mạch.',
  'run.failure.multiple-boards': 'Mạch chỉ được có một bo mạch.',
  'run.failure.incompatible-devices': 'Mạch có linh kiện mà loại dự án này không dùng được.',
  'run.failure.compile-error': 'Chương trình có lỗi.',
  'run.error': 'Lỗi: {message}',
  'diagnostic.error': 'Lỗi: {message}',
  'diagnostic.warning': 'Cảnh báo: {message}',
  'console.label': 'Bảng in',
  'console.hiddenOne': 'Đã ẩn {count} dòng cũ hơn',
  'console.hiddenMany': 'Đã ẩn {count} dòng cũ hơn',
  'launch.title': 'Không mở được bài thực hành này.',
  'launch.supported': 'Các mẫu được hỗ trợ: {keys}.',
  'palette.label': 'Thêm linh kiện',
  'palette.add': 'Thêm {name}',
  'device.board': 'Bo mạch STEM',
  'device.ybc-board': 'Bo mạch tương thích Bit',
  'device.led': 'Đèn LED',
  'device.resistor': 'Điện trở',
  'device.push-button': 'Nút bấm',
  'device.potentiometer': 'Biến trở',
  'controls.label': 'Điều khiển bo mạch',
  'control.button-a': 'Nút A',
  'control.button-b': 'Nút B',
  'control.light': 'Mức ánh sáng',
  'display.label': 'Màn hình dạng chữ',
  'sound.turnOn': 'Bật âm thanh',
  'sound.turnOff': 'Tắt âm thanh',
  'sound.silent': 'Im lặng',
  'sound.playing': 'Đang phát {hz}',
  'python.copy': 'Sao chép',
  'python.copied': 'Đã chép',
  'python.download': 'Tải xuống',
  'python.copyFailed': 'Không sao chép được. Nhấn {key} để chép đoạn mã đã chọn.',
  'python.claim': 'Sinh cho Yolo:Bit MicroPython. Kiểm tra cú pháp MicroPython: chưa làm. Kiểm tra trên bo mạch thật: chưa làm.',
  'python.layer.L-1': 'Không mở được dự án.',
  'python.layer.L-2': 'Dự án không hợp với cấp độ này.',
  'python.layer.L-3': 'Chương trình chưa chạy được.',
  'python.layer.L-4': 'Chưa sinh được Python.',
};

const dictionaries: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = { en, vi };

export type Params = Readonly<Record<string, string | number>>;

/** The text of `key` in `locale`, with each `{name}` replaced by `params[name]`. */
export function translate(locale: Locale, key: MessageKey, params: Params = {}): string {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}

/** Whether `key` names a message: for keys made from data (a device type, a part id), which may have none. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}
```

**Create `src/ui/i18n/text.tsx`:**

```tsx
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { translate, type Locale, type MessageKey, type Params } from './messages';

// The UI's language, chosen once at startup (main.tsx) and read by every component through `useText`.
// Without a provider it is English, so a component rendered alone (its unit tests) reads as it always did.

const LocaleContext = createContext<Locale>('en');

export function TextProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

export type Text = (key: MessageKey, params?: Params) => string;

/** `t(key, params)` in the UI's language. */
export function useText(): Text {
  const locale = useLocale();
  return useMemo(() => (key, params) => translate(locale, key, params), [locale]);
}
```

**Edit `src/ui/runtime-controls/DisplayText.tsx`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/runtime-controls/DisplayText.tsx`** (1):

```tsx
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { displayLines } from './display-view';

```

with:

```tsx
import type { ComponentState } from '../../core/simulation/simulate-circuit';
import { useText } from '../i18n/text';
import { displayLines } from './display-view';

```

**Replace in `src/ui/runtime-controls/DisplayText.tsx`** (2):

```tsx
 */
export function DisplayText({ display }: { display: ComponentState | undefined }) {
  return (
    <pre className="display-text" role="group" aria-label="Display text" data-testid="display-text">
      {displayLines(display).join('\n')}
    </pre>
```

with:

```tsx
 */
export function DisplayText({ display }: { display: ComponentState | undefined }) {
  const t = useText();
  return (
    <pre className="display-text" role="group" aria-label={t('display.label')} data-testid="display-text">
      {displayLines(display).join('\n')}
    </pre>
```

**Edit `src/ui/runtime-controls/RuntimeControls.tsx`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx`** (1):

```tsx
import type { DeviceDefinition } from '../../core/devices/device-definition';
import type { ComponentInput } from '../../core/simulation/simulate-circuit';
import { controlsOf, sliderValueOf, type ControlSpec } from './controls-model';
import { createHoldTracker, isHoldKey } from './hold-tracker';
```

with:

```tsx
import type { DeviceDefinition } from '../../core/devices/device-definition';
import type { ComponentInput } from '../../core/simulation/simulate-circuit';
import { isMessageKey } from '../i18n/messages';
import { useText } from '../i18n/text';
import { controlsOf, sliderValueOf, type ControlSpec } from './controls-model';
import { createHoldTracker, isHoldKey } from './hold-tracker';
```

**Replace in `src/ui/runtime-controls/RuntimeControls.tsx`** (2):

```tsx

export function RuntimeControls({ boardId, definition, controls, active, onInput }: RuntimeControlsProps) {
  const specs = controlsOf(boardId, definition, controls);
  if (specs.length === 0) {
    return null;
  }
  return (
    <div className="runtime-controls" role="group" aria-label="Board controls" data-testid="runtime-controls">
      {specs.map((spec) =>
        spec.kind === 'hold' ? (
```

with:

```tsx

export function RuntimeControls({ boardId, definition, controls, active, onInput }: RuntimeControlsProps) {
  const t = useText();
  // A part the dictionary does not know keeps the label the model gives it.
  const specs = controlsOf(boardId, definition, controls).map((spec) => {
    const key = `control.${spec.partId}`;
    return isMessageKey(key) ? { ...spec, label: t(key) } : spec;
  });
  if (specs.length === 0) {
    return null;
  }
  return (
    <div className="runtime-controls" role="group" aria-label={t('controls.label')} data-testid="runtime-controls">
      {specs.map((spec) =>
        spec.kind === 'hold' ? (
```

- [ ] **Step 4: Run the tests and the whole gate**

Run: `pnpm vitest run src/ui/i18n`

Expected: `Test Files  4 passed`, `Tests  97 passed`.

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  130 passed`, `Tests  4323 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md CLAUDE.md src/main.tsx src/ui/app/App.tsx src/ui/app/Console.tsx src/ui/app/LaunchError.tsx src/ui/app/PythonPanel.tsx src/ui/app/RunToolbar.tsx src/ui/audio/SoundIndicator.tsx src/ui/blockly/editor-blocks.ts src/ui/blockly/locale.ts src/ui/canvas/Palette.tsx src/ui/i18n/blocks.test.ts src/ui/i18n/blocks.ts src/ui/i18n/locale.test.ts src/ui/i18n/locale.ts src/ui/i18n/messages.test.ts src/ui/i18n/messages.ts src/ui/i18n/text.test.tsx src/ui/i18n/text.tsx src/ui/runtime-controls/DisplayText.tsx src/ui/runtime-controls/RuntimeControls.tsx
git commit -m "$(cat <<'EOF'
feat(n6a): speak Vietnamese in lab launches (S5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 6: Host bridge stem-lab/v1 (S3)  — `model: opus`

Phía lab của `stem-lab/v1`. `createHostBridge` chỉ gửi tới `hostOrigin` (không bao giờ `'*'`), chỉ nhận `load-project` từ `window.parent` ở đúng origin, debounce `project-changed` 1 s và gửi ngay khi `pagehide`, kẹp goals ≤ 50 và nhãn ≤ 200 (giới hạn của host). `lab-host.ts` nối store ↔ bridge (`ready` một lần, chạy/dừng theo khoá `running`, mọi đổi document) và kiểm `load-project` bằng đúng luật nạp của standalone + đúng loại lab + không đang chạy (Review Focus 1). `main.tsx` chỉ dựng bridge khi `lab=`, `origin` hợp lệ và `window.parent !== window` (R5). `check-result` do chrome gửi ở Task 7.

**Files:**
- Modify: `src/main.tsx`
- Create: `src/ui/app/host-bridge.test.ts`
- Create: `src/ui/app/host-bridge.ts`
- Create: `src/ui/app/lab-host.test.ts`
- Create: `src/ui/app/lab-host.ts`

**Interfaces:**
- Consumes: `readStoredProject`, `ProgramCheck` (`src/core/persistence/project-repository.ts`); `ProfileCatalog`; `ProjectStore`, `RunStore`, `selectIsRunning`; Task 1 `LabKind`, `TemplateKey`, `YbcLabProfile`, `createTemplateProject`; Task 3 `Challenge`, `CheckResult`, `Goal`; Task 4 `templateChallenge`; Task 2 `Launch.lab`.
- Produces (`src/ui/app/host-bridge.ts`): `LAB_PROTOCOL = 'stem-lab/v1'`, `PROJECT_CHANGED_DEBOUNCE_MS = 1000`, `type LabGoal`, `type LabMessage`, `type HostWindow`, `type LabWindow = Pick<Window,'addEventListener'|'removeEventListener'>`, `type BridgeTimers`, `type HostBridge = { ready, runStarted, runStopped, checkResult, projectChanged, flush, dispose }`, `createHostBridge({ host, hostOrigin, window, onLoadProject, timers? })`.
- Produces (`src/ui/app/lab-host.ts`): `type HostProjectRules = { lab, profile, registry, profiles, canOpenProgram }`, `readHostProject(document, rules)`, `connectLabHost({ ...rules, bridge, projectStore, runStore, template, challenge }): () => void`, `loadHostProject(document, { ...rules, projectStore, runStore }): boolean`.

- [ ] **Step 1: Write the failing tests**

**Create `src/ui/app/host-bridge.test.ts`:**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { createHostBridge, LAB_PROTOCOL, PROJECT_CHANGED_DEBOUNCE_MS, type LabWindow } from './host-bridge';

// The lab's side of stem-lab/v1 (N6a S3) against fake windows: what it posts, to whom, and what it takes.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const hostOrigin = 'http://localhost:3000';

function setup() {
  const posted: [unknown, string][] = [];
  const host = { postMessage: (message: unknown, targetOrigin: string) => void posted.push([message, targetOrigin]) };
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const window = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as LabWindow;
  const fire = (type: string, event: unknown = {}) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
  const loaded: unknown[] = [];
  const bridge = createHostBridge({ host, hostOrigin, window, onLoadProject: (document) => void loaded.push(document) });
  return { bridge, host, posted, fire, loaded, listeners };
}

describe('createHostBridge (N6a S3)', () => {
  it('posts every message with the protocol, to the host origin only', () => {
    const { bridge, posted } = setup();
    bridge.ready({ template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'g', label: 'Trái tim' }] });
    bridge.runStarted();
    bridge.runStopped();
    bridge.checkResult({ passed: true, goals: [{ id: 'g', label: 'Trái tim', passed: true }] });

    expect(posted).toEqual([
      [{ protocol: LAB_PROTOCOL, type: 'ready', template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'g', label: 'Trái tim' }] }, hostOrigin],
      [{ protocol: LAB_PROTOCOL, type: 'run-started' }, hostOrigin],
      [{ protocol: LAB_PROTOCOL, type: 'run-stopped' }, hostOrigin],
      [{ protocol: LAB_PROTOCOL, type: 'check-result', passed: true, goals: [{ id: 'g', label: 'Trái tim', passed: true }] }, hostOrigin],
    ]);
    expect(posted.map(([, origin]) => origin)).not.toContain('*');
  });

  it('sends only id and label of a goal, within what the host accepts (50 goals, 200 characters)', () => {
    const { bridge, posted } = setup();
    const goals = Array.from({ length: 60 }, (_, index) => ({ id: `g${index}`, label: 'x'.repeat(250), kind: 'led-lit' as const, componentId: 'led' }));
    bridge.ready({ template: 'blink', profile: null, goals });

    const [message] = posted[0] as [{ goals: { id: string; label: string }[] }, string];
    expect(message.goals).toHaveLength(50);
    expect(message.goals[0]).toEqual({ id: 'g0', label: 'x'.repeat(200) });
  });

  it('sends the project one second after the last change, once', async () => {
    const { bridge, posted } = setup();
    const first = createNewProject('a');
    const last = createNewProject('b');
    bridge.projectChanged(first);
    await vi.advanceTimersByTimeAsync(PROJECT_CHANGED_DEBOUNCE_MS - 1);
    bridge.projectChanged(last);
    await vi.advanceTimersByTimeAsync(PROJECT_CHANGED_DEBOUNCE_MS - 1);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(posted).toEqual([[{ protocol: LAB_PROTOCOL, type: 'project-changed', document: last }, hostOrigin]]);
  });

  it('sends a pending project at once when the page goes away, and only once', async () => {
    const { bridge, posted, fire } = setup();
    bridge.projectChanged(createNewProject('a'));
    fire('pagehide');
    await vi.advanceTimersByTimeAsync(PROJECT_CHANGED_DEBOUNCE_MS);

    expect(posted).toHaveLength(1);
    bridge.flush();
    expect(posted).toHaveLength(1);
  });

  it('takes a load-project from the parent window at the host origin', () => {
    const { host, fire, loaded } = setup();
    const document = { any: 'thing' };
    fire('message', { origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project', document } });

    expect(loaded).toEqual([document]);
  });

  it.each([
    ['another origin', (host: unknown) => ({ origin: 'http://evil.example', source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project', document: {} } })],
    ['the host origin from another window', () => ({ origin: hostOrigin, source: {}, data: { protocol: LAB_PROTOCOL, type: 'load-project', document: {} } })],
    ['another protocol', (host: unknown) => ({ origin: hostOrigin, source: host, data: { protocol: 'stem-lab/v2', type: 'load-project', document: {} } })],
    ['another type', (host: unknown) => ({ origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'ready', document: {} } })],
    ['no document', (host: unknown) => ({ origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project' } })],
    ['no data', (host: unknown) => ({ origin: hostOrigin, source: host, data: null })],
    ['a string', (host: unknown) => ({ origin: hostOrigin, source: host, data: 'load-project' })],
  ])('ignores a message from %s', (_, event) => {
    const { host, fire, loaded } = setup();
    fire('message', event(host));

    expect(loaded).toEqual([]);
  });

  it('after dispose: listens to nothing, posts nothing, drops a pending project', async () => {
    const { bridge, host, posted, fire, loaded, listeners } = setup();
    bridge.projectChanged(createNewProject('a'));
    bridge.dispose();
    fire('message', { origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project', document: {} } });
    bridge.runStarted();
    await vi.advanceTimersByTimeAsync(PROJECT_CHANGED_DEBOUNCE_MS);

    expect(posted).toEqual([]);
    expect(loaded).toEqual([]);
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});
```

**Create `src/ui/app/lab-host.test.ts`:**

```ts
import { describe, expect, it } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { localDeviceDefinitions } from '../../core/devices/local-catalog';
import { createDeviceRegistry } from '../../core/devices/registry';
import { productionProfiles } from '../../core/profiles';
import { createRunSession } from '../../core/run/run-session';
import { templateChallenge } from '../../samples/challenges';
import { createTemplateProject } from '../../samples/templates';
import { ybcSolutionDocument } from '../../samples/ybc-solutions';
import { createProjectStore } from '../state/project-store';
import { createRunStore } from '../state/run-store';
import type { HostBridge } from './host-bridge';
import { connectLabHost, loadHostProject, readHostProject, type HostProjectRules } from './lab-host';

// The stores of a lab and its host bridge (N6a S3): what the host is told, and which projects it may load.

const registry = createDeviceRegistry(localDeviceDefinitions);
const rules = (lab: 'blockly' | 'yolobit', profile: 'ybc-basic' | 'ybc-advanced' | null = null): HostProjectRules => ({
  lab,
  profile,
  registry,
  profiles: productionProfiles,
  canOpenProgram: () => true,
});

function recordingBridge() {
  const sent: unknown[] = [];
  const bridge: HostBridge = {
    ready: (info) => void sent.push(['ready', info]),
    runStarted: () => void sent.push('run-started'),
    runStopped: () => void sent.push('run-stopped'),
    checkResult: (result) => void sent.push(['check-result', result]),
    projectChanged: (document) => void sent.push(['project-changed', document.id]),
    flush: () => {},
    dispose: () => {},
  };
  return { bridge, sent };
}

function setup(template: 'blink' | 'ybc-heart') {
  const projectStore = createProjectStore(createTemplateProject(template));
  const runStore = createRunStore(createRunSession(registry), (callback) => callback());
  const { bridge, sent } = recordingBridge();
  const lab = template === 'blink' ? 'blockly' : 'yolobit';
  const disconnect = connectLabHost({ ...rules(lab), bridge, projectStore, runStore, template, challenge: templateChallenge(template, 'vi') });
  return { projectStore, runStore, sent, disconnect };
}

describe('connectLabHost (N6a S3)', () => {
  it('says ready with the template, its profile and the goals', () => {
    expect(setup('ybc-heart').sent).toEqual([
      ['ready', { template: 'ybc-heart', profile: 'ybc-basic', goals: templateChallenge('ybc-heart', 'vi')?.goals }],
    ]);
    expect(setup('blink').sent[0]).toMatchObject(['ready', { template: 'blink', profile: null }]);
  });

  it('tells when a run starts and stops', () => {
    const { runStore, projectStore, sent } = setup('blink');
    runStore.getState().run(projectStore.getState().document);
    runStore.getState().stop();

    expect(sent.slice(1)).toEqual(['run-started', 'run-stopped']);
  });

  it('tells every change of the document, and nothing after disconnect', () => {
    const { projectStore, sent, disconnect } = setup('blink');
    projectStore.getState().setProgramBlocks({});
    projectStore.getState().loadProject(createNewProject('other'));
    disconnect();
    projectStore.getState().setProgramBlocks({});

    expect(sent.slice(1)).toEqual([
      ['project-changed', 'sample-blink'],
      ['project-changed', 'other'],
    ]);
  });
});

describe('readHostProject (N6a S3)', () => {
  it('opens a project of the lab’s kind', () => {
    const solution = ybcSolutionDocument('ybc-heart');
    expect(readHostProject(solution, rules('yolobit'))).toEqual(solution);
    expect(readHostProject(createTemplateProject('blink'), rules('blockly'))).toEqual(createTemplateProject('blink'));
  });

  it('opens a Yolo:Bit project with the launch profile', () => {
    expect(readHostProject(ybcSolutionDocument('ybc-heart'), rules('yolobit', 'ybc-advanced'))?.profile).toBe('ybc-advanced');
  });

  it.each([
    ['a generic project in a Yolo:Bit lab', createTemplateProject('blink'), 'yolobit'],
    ['a Yolo:Bit project in a Blockly lab', ybcSolutionDocument('ybc-heart'), 'blockly'],
    ['something else', { hello: 'world' }, 'blockly'],
    ['an unknown profile', { ...ybcSolutionDocument('ybc-heart'), profile: 'ybc-pro' }, 'yolobit'],
    ['an unknown device', { ...createNewProject('x'), circuit: { components: [{ id: 'm', deviceType: 'motor', position: { x: 0, y: 0 } }], wires: [] } }, 'blockly'],
  ] as const)('refuses %s', (_, document, lab) => {
    expect(readHostProject(document, rules(lab))).toBeNull();
  });

  it('refuses a program the editor cannot open', () => {
    expect(readHostProject(createTemplateProject('blink'), { ...rules('blockly'), canOpenProgram: () => false })).toBeNull();
  });
});

describe('loadHostProject (N6a S3)', () => {
  it('opens the project, replacing the template', () => {
    const { projectStore, runStore } = setup('ybc-heart');
    const solution = ybcSolutionDocument('ybc-heart');

    expect(loadHostProject(solution, { ...rules('yolobit'), projectStore, runStore })).toBe(true);
    expect(projectStore.getState().document).toEqual(solution);
    expect(projectStore.getState().loadRevision).toBe(1);
  });

  it('does nothing while a run locks the editor, or with a project the lab cannot open', () => {
    const { projectStore, runStore } = setup('ybc-heart');
    const before = projectStore.getState().document;
    expect(loadHostProject(createTemplateProject('blink'), { ...rules('yolobit'), projectStore, runStore })).toBe(false);
    runStore.getState().run(before);
    expect(loadHostProject(ybcSolutionDocument('ybc-heart'), { ...rules('yolobit'), projectStore, runStore })).toBe(false);
    runStore.getState().stop();

    expect(projectStore.getState().document).toBe(before);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/ui/app/host-bridge.test.ts src/ui/app/lab-host.test.ts`

Expected: `FAIL` — cannot resolve `./host-bridge` and `./lab-host`.

- [ ] **Step 3: Implement**

**Edit `src/main.tsx`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/main.tsx`** (1):

```tsx
import { createPinCapabilities } from './core/run/ybc-pin-io';
import { createOnboardCapabilities } from './core/simulation/peripherals/onboard-capabilities';
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { LaunchError } from './ui/app/LaunchError';
import { parseLaunch } from './ui/app/launch';
```

with:

```tsx
import { createPinCapabilities } from './core/run/ybc-pin-io';
import { createOnboardCapabilities } from './core/simulation/peripherals/onboard-capabilities';
import { templateChallenge } from './samples/challenges';
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { createHostBridge } from './ui/app/host-bridge';
import { connectLabHost, loadHostProject } from './ui/app/lab-host';
import { LaunchError } from './ui/app/LaunchError';
import { parseLaunch } from './ui/app/launch';
```

**Replace in `src/main.tsx`** (2):

```tsx
  }

  if (import.meta.env.DEV) {
    installTestHooks(projectStore, profiles);
```

with:

```tsx
  }

  // A lab launch (N6a): the template's challenge, and the stem-lab/v1 bridge when the lab is framed by the page
  // its `origin=` names. Opened on its own (a new tab), the lab works the same and talks to nobody.
  const lab = launch.mode === 'embed' ? (launch.lab ?? null) : null;
  const challenge = launch.mode === 'embed' && lab ? templateChallenge(launch.template, locale) : null;
  if (launch.mode === 'embed' && lab && lab.hostOrigin !== null && window.parent !== window) {
    const rules = { lab: lab.kind, profile: lab.profile, registry, profiles, canOpenProgram: (blocks: unknown) => canOpenProgram(blocks, packs) };
    const bridge = createHostBridge({
      host: window.parent,
      hostOrigin: lab.hostOrigin,
      window,
      onLoadProject: (document) => void loadHostProject(document, { ...rules, projectStore, runStore }),
    });
    connectLabHost({ ...rules, bridge, projectStore, runStore, template: launch.template, challenge });
  }

  if (import.meta.env.DEV) {
    installTestHooks(projectStore, profiles);
```

**Create `src/ui/app/host-bridge.ts`:**

```ts
import type { CheckResult, Goal } from '../../core/challenge';
import type { ProjectDocument } from '../../core/circuit/document';

// The lab's side of stem-lab/v1 (N6a S3), the only channel between an embedded lab and the page that frames it
// (docs/lab-embed-contract.md). It exists only for a lab launch with a valid `origin=` inside a frame (main.tsx).
// Every message goes to that origin, never to '*'; a message is taken only from the parent window at that origin,
// and only a well-formed `load-project`. The bridge knows nothing of lessons, scores or progress: it reports
// what the lab does.

export const LAB_PROTOCOL = 'stem-lab/v1';
/** The learner's edits reach the host at most once a second (the last edit wins). */
export const PROJECT_CHANGED_DEBOUNCE_MS = 1000;
/** What the host accepts (its lab-protocol.ts): at most 50 goals, labels of at most 200 characters. */
const MAX_GOALS = 50;
const MAX_LABEL = 200;

export type LabGoal = { id: string; label: string };

export type LabMessage =
  | { protocol: typeof LAB_PROTOCOL; type: 'ready'; template: string; profile: string | null; goals: LabGoal[] }
  | { protocol: typeof LAB_PROTOCOL; type: 'run-started' }
  | { protocol: typeof LAB_PROTOCOL; type: 'run-stopped' }
  | { protocol: typeof LAB_PROTOCOL; type: 'check-result'; passed: boolean; goals: (LabGoal & { passed: boolean })[] }
  | { protocol: typeof LAB_PROTOCOL; type: 'project-changed'; document: ProjectDocument };

/** The embedding page's window (window.parent): only ever posted to, with its origin. */
export type HostWindow = { postMessage(message: unknown, targetOrigin: string): void };

/** Where messages and page events arrive (window). */
export type LabWindow = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export type BridgeTimers = { setTimeout(task: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };

export type HostBridgeOptions = {
  host: HostWindow;
  hostOrigin: string;
  window: LabWindow;
  /** A `load-project` from the host: its document, still unchecked (lab-host.ts checks it). */
  onLoadProject(document: unknown): void;
  timers?: BridgeTimers;
};

export type HostBridge = {
  ready(info: { template: string; profile: string | null; goals: readonly Pick<Goal, 'id' | 'label'>[] }): void;
  runStarted(): void;
  runStopped(): void;
  checkResult(result: CheckResult): void;
  /** Debounced: sent PROJECT_CHANGED_DEBOUNCE_MS after the last call, with the last document. */
  projectChanged(document: ProjectDocument): void;
  /** Sends a pending `project-changed` now (the page is going away). */
  flush(): void;
  /** Stops listening and drops a pending `project-changed`. */
  dispose(): void;
};

const defaultTimers: BridgeTimers = {
  setTimeout: (task, ms) => setTimeout(task, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const goalsOf = <T extends LabGoal>(goals: readonly T[]): T[] =>
  goals.slice(0, MAX_GOALS).map((goal) => ({ ...goal, label: goal.label.slice(0, MAX_LABEL) }));

export function createHostBridge({ host, hostOrigin, window, onLoadProject, timers = defaultTimers }: HostBridgeOptions): HostBridge {
  let disposed = false;
  let pending: { handle: unknown; document: ProjectDocument } | null = null;

  const post = (message: LabMessage) => {
    if (!disposed) {
      host.postMessage(message, hostOrigin);
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (disposed || event.origin !== hostOrigin || event.source !== (host as unknown)) {
      return;
    }
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null) {
      return;
    }
    const message = data as Record<string, unknown>;
    if (message.protocol === LAB_PROTOCOL && message.type === 'load-project' && message.document !== undefined) {
      onLoadProject(message.document);
    }
  };

  const flush = () => {
    if (pending) {
      const { handle, document } = pending;
      pending = null;
      timers.clearTimeout(handle);
      post({ protocol: LAB_PROTOCOL, type: 'project-changed', document });
    }
  };

  window.addEventListener('message', onMessage);
  window.addEventListener('pagehide', flush);

  return {
    ready({ template, profile, goals }) {
      post({ protocol: LAB_PROTOCOL, type: 'ready', template, profile, goals: goalsOf(goals.map(({ id, label }) => ({ id, label }))) });
    },
    runStarted: () => post({ protocol: LAB_PROTOCOL, type: 'run-started' }),
    runStopped: () => post({ protocol: LAB_PROTOCOL, type: 'run-stopped' }),
    checkResult(result) {
      post({ protocol: LAB_PROTOCOL, type: 'check-result', passed: result.passed, goals: goalsOf(result.goals.map(({ id, label, passed }) => ({ id, label, passed }))) });
    },
    projectChanged(document) {
      if (disposed) {
        return;
      }
      if (pending) {
        timers.clearTimeout(pending.handle);
      }
      pending = { document, handle: timers.setTimeout(flush, PROJECT_CHANGED_DEBOUNCE_MS) };
    },
    flush,
    dispose() {
      if (pending) {
        timers.clearTimeout(pending.handle);
        pending = null;
      }
      disposed = true;
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', flush);
    },
  };
}
```

**Create `src/ui/app/lab-host.ts`:**

```ts
import type { Challenge } from '../../core/challenge';
import type { ProjectDocument } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import { readStoredProject, type ProgramCheck } from '../../core/persistence/project-repository';
import type { ProfileCatalog } from '../../core/profiles/profile';
import type { LabKind, TemplateKey } from '../../samples/templates';
import type { YbcLabProfile } from '../../samples/ybc-templates';
import type { ProjectStore } from '../state/project-store';
import { selectIsRunning, type RunStore } from '../state/run-store';
import type { HostBridge } from './host-bridge';

// Connects a lab's stores to its host bridge (N6a S3): `ready` once, `run-started` / `run-stopped` as the run
// lock changes, `project-changed` on every document change (the bridge debounces), and the host's `load-project`
// opened when it is a project this lab can open. Check results are sent by the lab chrome (App), which runs them.

export type HostProjectRules = {
  lab: LabKind;
  /** The launch's board profile, which a Yolo:Bit project opens with; null keeps the project's own. */
  profile: YbcLabProfile | null;
  registry: DeviceRegistry;
  profiles: ProfileCatalog;
  canOpenProgram: ProgramCheck;
};

/**
 * The project of a `load-project`, or null when this lab cannot open it: it must be a project the editor opens
 * (the standalone loader's rules: schema, known devices and profile, a program Blockly loads), of this lab's kind
 * (a Yolo:Bit project in a Yolo:Bit lab, a generic one in a Blockly lab).
 */
export function readHostProject(document: unknown, rules: HostProjectRules): ProjectDocument | null {
  const project = readStoredProject(document, rules.registry, rules.canOpenProgram, rules.profiles);
  if (!project) {
    return null;
  }
  const family = project.profile === undefined ? 'generic' : rules.profiles.get(project.profile)?.family;
  if ((rules.lab === 'yolobit') !== (family === 'ybc')) {
    return null;
  }
  return rules.lab === 'yolobit' && rules.profile !== null ? { ...project, profile: rules.profile } : project;
}

export type LabHostOptions = HostProjectRules & {
  bridge: HostBridge;
  projectStore: ProjectStore;
  runStore: RunStore;
  template: TemplateKey;
  challenge: Challenge | null;
};

/** Sends `ready` and keeps the host told until the returned function is called. */
export function connectLabHost(options: LabHostOptions): () => void {
  const { bridge, projectStore, runStore, template, challenge } = options;
  const stopRuns = runStore.subscribe((state, previous) => {
    if (selectIsRunning(state) !== selectIsRunning(previous)) {
      if (selectIsRunning(state)) {
        bridge.runStarted();
      } else {
        bridge.runStopped();
      }
    }
  });
  const stopEdits = projectStore.subscribe((state, previous) => {
    if (state.document !== previous.document) {
      bridge.projectChanged(state.document);
    }
  });
  bridge.ready({ template, profile: projectStore.getState().document.profile ?? null, goals: challenge?.goals ?? [] });
  return () => {
    stopRuns();
    stopEdits();
  };
}

/**
 * What to do with a `load-project`: open the project when this lab can, and the editor is not locked by a run
 * (like New, loading replaces the whole project); otherwise nothing.
 */
export function loadHostProject(document: unknown, options: HostProjectRules & { projectStore: ProjectStore; runStore: RunStore }): boolean {
  if (selectIsRunning(options.runStore.getState())) {
    return false;
  }
  const project = readHostProject(document, options);
  if (!project) {
    return false;
  }
  options.projectStore.getState().loadProject(project);
  options.runStore.getState().clearStartFailure();
  return true;
}
```

- [ ] **Step 4: Run the tests and the whole gate**

Run: `pnpm vitest run src/ui/app/host-bridge.test.ts src/ui/app/lab-host.test.ts`

Expected: `Test Files  2 passed`, `Tests  26 passed`.

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  132 passed`, `Tests  4349 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 5: Commit**

```bash
git add src/main.tsx src/ui/app/host-bridge.test.ts src/ui/app/host-bridge.ts src/ui/app/lab-host.test.ts src/ui/app/lab-host.ts
git commit -m "$(cat <<'EOF'
feat(n6a): talk stem-lab/v1 to the embedding page (S3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 7: Lab chrome: title, Kiểm tra, goals, Đặt lại, fluid layout (S4)  — `model: opus`

Chrome của launch `lab=` (standalone và S1 không đổi): tiêu đề "Lập trình khối" / "Mạch Yolo:Bit", ẩn Mới/New, nút **Kiểm tra** (khi template có challenge) + `ChallengePanel`, **Đặt lại** hai lần bấm (R13), Chạy bị khoá trong lúc kiểm tra (Dừng vẫn dùng được và huỷ kiểm tra). Kiểm tra chạy trên run store (R10) qua `checkSessionOf`, nên `run()` của store trả `StartResult` và có `latestSnapshot()`. Kết quả gắn với document đã kiểm: sửa chương trình thì mục tiêu về "chưa kiểm tra". Layout: `100dvh`, < 760 px xếp mạch trên, chương trình dưới.

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/ui/app/App.tsx`
- Create: `src/ui/app/ChallengePanel.test.tsx`
- Create: `src/ui/app/ChallengePanel.tsx`
- Modify: `src/ui/app/RunToolbar.tsx`
- Modify: `src/ui/app/app.css`
- Modify: `src/ui/i18n/messages.ts`
- Modify: `src/ui/state/run-store.test.ts`
- Modify: `src/ui/state/run-store.ts`

**Interfaces:**
- Consumes: Task 3 `runCheck`, `Challenge`, `CheckResult`, `CheckRun`, `CheckSession`; Task 5 `useText`, khoá mới `lab.*`; Task 6 `HostBridge.checkResult`; Task 1 `createTemplateProject`, `LabKind`.
- Produces (`src/ui/state/run-store.ts`): `RunState.run(project): StartResult`, `RunState.latestSnapshot(): RunSnapshot`, `checkSessionOf(runStore): CheckSession`.
- Produces (`src/ui/app/ChallengePanel.tsx`): `type CheckView = {state:'idle'} | {state:'checking'} | {state:'done'; result: CheckResult; started: boolean}`, `ChallengePanel({ challenge, check })` (test ids `challenge-panel`, `goal-<id>` với `data-state` `todo|passed|failed`, `challenge-status`).
- Produces (`src/ui/app/App.tsx`): `type LabChrome = { kind: LabKind; challenge: Challenge | null; createTemplate(): ProjectDocument; onChecked?(result: CheckResult): void }`, prop `lab?: LabChrome | null`.
- Produces (`src/ui/app/RunToolbar.tsx`): props `runDisabled?: boolean`, `actions?: ReactNode`.

- [ ] **Step 1: Write the failing tests**

**Create `src/ui/app/ChallengePanel.test.tsx`:**

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Challenge } from '../../core/challenge';
import { TextProvider } from '../i18n/text';
import { ChallengePanel, type CheckView } from './ChallengePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const challenge: Challenge = {
  durationMs: 1000,
  goals: [
    { id: 'heart', label: 'Màn hình hiện hình trái tim', kind: 'display-shows', frame: '01010:11111:11111:01110:00100' },
    { id: 'show', label: 'Dùng khối hiển thị hình', kind: 'uses-block', blockType: 'ybc_display_show_image' },
  ],
};

async function render(check: CheckView) {
  await act(async () =>
    root.render(
      <TextProvider locale="vi">
        <ChallengePanel challenge={challenge} check={check} />
      </TextProvider>,
    ),
  );
  const goals = [...container.querySelectorAll('li')].map((item) => [item.dataset.testid, item.dataset.state, item.textContent]);
  return { goals, status: container.querySelector('[role="status"]')?.textContent };
}

describe('ChallengePanel (N6a S4)', () => {
  it('lists the goals, none checked yet', async () => {
    expect(await render({ state: 'idle' })).toEqual({
      goals: [
        ['goal-heart', 'todo', '○Màn hình hiện hình trái tim, chưa kiểm tra'],
        ['goal-show', 'todo', '○Dùng khối hiển thị hình, chưa kiểm tra'],
      ],
      status: '',
    });
  });

  it('says a check is running', async () => {
    expect((await render({ state: 'checking' })).status).toBe('Đang kiểm tra: chương trình của bạn được chạy thử vài giây…');
  });

  it('marks each goal and says the check passed', async () => {
    const result = { passed: true, goals: challenge.goals.map(({ id, label }) => ({ id, label, passed: true })) };
    expect(await render({ state: 'done', result, started: true })).toEqual({
      goals: [
        ['goal-heart', 'passed', '✓Màn hình hiện hình trái tim, đạt'],
        ['goal-show', 'passed', '✓Dùng khối hiển thị hình, đạt'],
      ],
      status: 'Đạt! Bạn đã hoàn thành mọi mục tiêu.',
    });
  });

  it('marks the goals not met, and says what to do', async () => {
    const result = { passed: false, goals: [{ id: 'heart', label: 'x', passed: false }, { id: 'show', label: 'y', passed: true }] };
    expect(await render({ state: 'done', result, started: true })).toEqual({
      goals: [
        ['goal-heart', 'failed', '✗Màn hình hiện hình trái tim, chưa đạt'],
        ['goal-show', 'passed', '✓Dùng khối hiển thị hình, đạt'],
      ],
      status: 'Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.',
    });
  });

  it('says the program did not run when the check could not start it', async () => {
    const result = { passed: false, goals: challenge.goals.map(({ id, label }) => ({ id, label, passed: false })) };
    expect((await render({ state: 'done', result, started: false })).status).toBe(
      'Chương trình chưa chạy được: sửa lỗi được báo ở thanh trên rồi kiểm tra lại.',
    );
  });
});
```

**Edit `src/ui/state/run-store.test.ts`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/state/run-store.test.ts`** (1):

```ts
import buttonDirectSample from '../../samples/button-direct.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { createRunStore, selectIsRunning } from './run-store';

const registry = createDeviceRegistry(localDeviceDefinitions);
```

with:

```ts
import buttonDirectSample from '../../samples/button-direct.project.json';
import ledOnSample from '../../samples/led-on.project.json';
import { checkSessionOf, createRunStore, selectIsRunning } from './run-store';

const registry = createDeviceRegistry(localDeviceDefinitions);
```

**Replace in `src/ui/state/run-store.test.ts`** (2):

```ts
  });
});
```

with:

```ts
  });
});

describe('runStore for a check (N6a S2)', () => {
  it('says whether Run started', () => {
    const { store } = setup();
    expect(store.getState().run(ledOn)).toEqual({ ok: true });
    expect(store.getState().run({ ...ledOn, circuit: { components: [], wires: [] } })).toEqual({ ok: false, reason: 'no-board', diagnostics: [] });
  });

  it('hands out the session’s snapshot now, before any frame', () => {
    const { session, store } = setup();
    store.getState().run(ledOn);
    expect(store.getState().latestSnapshot()).toBe(session.getSnapshot());
    expect(store.getState().snapshot.status).toBe('idle');
  });

  it('is the session of a check: start, stop, subscribe, snapshot and inputs go to the same run', async () => {
    const { session, store } = setup();
    const checkSession = checkSessionOf(store);
    const seen: string[] = [];
    const unsubscribe = checkSession.subscribe((snapshot) => seen.push(snapshot.status));

    expect(checkSession.start(projectDocumentSchema.parse(buttonDirectSample))).toEqual({ ok: true });
    checkSession.setComponentInput('button', { kind: 'hold', closed: true });
    expect(checkSession.getSnapshot().simulation?.components.led?.lit).toBe(true);
    checkSession.stop();
    unsubscribe();

    expect(seen[0]).toBe('running');
    expect(seen.at(-1)).toBe('idle');
    expect(session.getSnapshot().status).toBe('idle');
    expect(selectIsRunning(store.getState())).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm vitest run src/ui/state/run-store.test.ts src/ui/app/ChallengePanel.test.tsx`

Expected: `FAIL` — `checkSessionOf` is not exported from `./run-store`; `./ChallengePanel` cannot be resolved.

- [ ] **Step 3: Implement**

**Edit `src/main.tsx`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/main.tsx`** (1):

```tsx
import { createOnboardCapabilities } from './core/simulation/peripherals/onboard-capabilities';
import { templateChallenge } from './samples/challenges';
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { createHostBridge } from './ui/app/host-bridge';
import { connectLabHost, loadHostProject } from './ui/app/lab-host';
import { LaunchError } from './ui/app/LaunchError';
```

with:

```tsx
import { createOnboardCapabilities } from './core/simulation/peripherals/onboard-capabilities';
import { templateChallenge } from './samples/challenges';
import { createTemplateProject } from './samples/templates';
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { createHostBridge, type HostBridge } from './ui/app/host-bridge';
import { connectLabHost, loadHostProject } from './ui/app/lab-host';
import { LaunchError } from './ui/app/LaunchError';
```

**Replace in `src/main.tsx`** (2):

```tsx
  const lab = launch.mode === 'embed' ? (launch.lab ?? null) : null;
  const challenge = launch.mode === 'embed' && lab ? templateChallenge(launch.template, locale) : null;
  if (launch.mode === 'embed' && lab && lab.hostOrigin !== null && window.parent !== window) {
    const rules = { lab: lab.kind, profile: lab.profile, registry, profiles, canOpenProgram: (blocks: unknown) => canOpenProgram(blocks, packs) };
    const bridge = createHostBridge({
      host: window.parent,
      hostOrigin: lab.hostOrigin,
```

with:

```tsx
  const lab = launch.mode === 'embed' ? (launch.lab ?? null) : null;
  const challenge = launch.mode === 'embed' && lab ? templateChallenge(launch.template, locale) : null;
  let bridge: HostBridge | null = null;
  if (launch.mode === 'embed' && lab && lab.hostOrigin !== null && window.parent !== window) {
    const rules = { lab: lab.kind, profile: lab.profile, registry, profiles, canOpenProgram: (blocks: unknown) => canOpenProgram(blocks, packs) };
    bridge = createHostBridge({
      host: window.parent,
      hostOrigin: lab.hostOrigin,
```

**Replace in `src/main.tsx`** (3):

```tsx
          packs={packs}
          notice={started.notice}
        />
      </TextProvider>
```

with:

```tsx
          packs={packs}
          notice={started.notice}
          lab={
            launch.mode === 'embed' && lab
              ? {
                  kind: lab.kind,
                  challenge,
                  createTemplate: () => createTemplateProject(launch.template, lab.profile === null ? {} : { profile: lab.profile }),
                  onChecked: (result) => bridge?.checkResult(result),
                }
              : null
          }
        />
      </TextProvider>
```

**Edit `src/ui/app/App.tsx`** (7 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/App.tsx`** (1):

```tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createNewProject, type Circuit } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { Notice } from '../../core/persistence/project-repository';
```

with:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { runCheck, type Challenge, type CheckResult, type CheckRun } from '../../core/challenge';
import { createNewProject, type Circuit, type ProjectDocument } from '../../core/circuit/document';
import type { DeviceRegistry } from '../../core/devices/registry';
import type { Notice } from '../../core/persistence/project-repository';
```

**Replace in `src/ui/app/App.tsx`** (2):

```tsx
import { buildToolbox, type BlockPackCatalog } from '../../core/program/block-packs';
import { buzzerPartId, displayPartId } from '../../core/simulation/peripherals/onboard-capabilities';
import { SoundIndicator } from '../audio/SoundIndicator';
import { toneHz } from '../audio/tone';
```

with:

```tsx
import { buildToolbox, type BlockPackCatalog } from '../../core/program/block-packs';
import { buzzerPartId, displayPartId } from '../../core/simulation/peripherals/onboard-capabilities';
import type { LabKind } from '../../samples/templates';
import { SoundIndicator } from '../audio/SoundIndicator';
import { toneHz } from '../audio/tone';
```

**Replace in `src/ui/app/App.tsx`** (3):

```tsx
import { RuntimeControls } from '../runtime-controls/RuntimeControls';
import type { ProjectStore } from '../state/project-store';
import { selectIsRunning, type RunStore } from '../state/run-store';
import { PythonPanel } from './PythonPanel';
import { RunToolbar } from './RunToolbar';
import './app.css';

type AppProps = {
```

with:

```tsx
import { RuntimeControls } from '../runtime-controls/RuntimeControls';
import type { ProjectStore } from '../state/project-store';
import { checkSessionOf, selectIsRunning, type RunStore } from '../state/run-store';
import { ChallengePanel, type CheckView } from './ChallengePanel';
import { PythonPanel } from './PythonPanel';
import { RunToolbar } from './RunToolbar';
import './app.css';

/** What a lab launch (`lab=`, N6a S4) adds to the editor: its title, the template's challenge and Reset. */
export type LabChrome = {
  kind: LabKind;
  /** The template's challenge; null: nothing to check (the empty templates). */
  challenge: Challenge | null;
  /** A fresh copy of the template, for Reset. */
  createTemplate(): ProjectDocument;
  /** Every finished check (the host bridge's `check-result`). */
  onChecked?(result: CheckResult): void;
};

/** How long Reset waits for the second click before it forgets the first. */
const resetConfirmMs = 4000;

type AppProps = {
```

**Replace in `src/ui/app/App.tsx`** (4):

```tsx
  /** Why the app did not open the saved project, if it did not (plan §7). */
  notice?: Notice | null;
};

export function App({ projectStore, runStore, registry, profiles, packs, notice = null }: AppProps) {
  const document = useStore(projectStore, (state) => state.document);
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
```

with:

```tsx
  /** Why the app did not open the saved project, if it did not (plan §7). */
  notice?: Notice | null;
  /** A lab launch's chrome; null for the standalone editor and the legacy S1 lab, which look as they did. */
  lab?: LabChrome | null;
};

export function App({ projectStore, runStore, registry, profiles, packs, notice = null, lab = null }: AppProps) {
  const document = useStore(projectStore, (state) => state.document);
  const loadRevision = useStore(projectStore, (state) => state.loadRevision);
```

**Replace in `src/ui/app/App.tsx`** (5):

```tsx
  };

  // New replaces the whole project, so it is locked while running like any
  // edit. Why the last Run did not start was about the replaced project.
```

with:

```tsx
  };

  // A lab's check (N6a S4): one at a time, on the run the toolbar shows. Its result belongs to the document it
  // checked: once the learner edits, the goals go back to "not checked yet".
  const [check, setCheck] = useState<CheckView & { document?: ProjectDocument }>({ state: 'idle' });
  const checkRun = useRef<CheckRun | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  useEffect(() => () => checkRun.current?.cancel(), []);
  useEffect(() => {
    if (!resetArmed) {
      return;
    }
    const timer = setTimeout(() => setResetArmed(false), resetConfirmMs);
    return () => clearTimeout(timer);
  }, [resetArmed]);

  // New replaces the whole project, so it is locked while running like any
  // edit. Why the last Run did not start was about the replaced project.
```

**Replace in `src/ui/app/App.tsx`** (6):

```tsx
  const isYbc = context.family === 'ybc';
  const boardId = context.readiness.ok ? context.readiness.board.id : null;
  // The sound follows every snapshot of the session, not the one a frame shows (see SoundIndicator).
  const tones = useCallback(
```

with:

```tsx
  const isYbc = context.family === 'ybc';
  const boardId = context.readiness.ok ? context.readiness.board.id : null;

  const startCheck = () => {
    const challenge = lab?.challenge;
    if (!challenge || checkRun.current) {
      return;
    }
    blocklyRef.current?.saveNow();
    const checked = projectStore.getState().document;
    setRunEpoch((epoch) => epoch + 1);
    setCheck({ state: 'checking' });
    const started = runCheck({ session: checkSessionOf(runStore), document: checked, challenge, boardId });
    checkRun.current = started;
    void started.done.then((outcome) => {
      if (checkRun.current !== started) {
        return;
      }
      checkRun.current = null;
      if (outcome.status === 'cancelled') {
        setCheck({ state: 'idle' });
        return;
      }
      setCheck({ state: 'done', result: outcome.result, started: outcome.started, document: checked });
      lab?.onChecked?.(outcome.result);
    });
  };

  // Reset puts the template back, after a second click: a frame may not allow a confirm dialog (sandbox).
  const reset = () => {
    if (!lab) {
      return;
    }
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    const cancelled = checkRun.current;
    checkRun.current = null;
    cancelled?.cancel();
    runStore.getState().stop();
    projectStore.getState().loadProject(lab.createTemplate());
    runStore.getState().clearStartFailure();
    setCheck({ state: 'idle' });
  };

  const checking = check.state === 'checking';
  const shownCheck: CheckView = check.state === 'done' && check.document !== document ? { state: 'idle' } : check;
  // The sound follows every snapshot of the session, not the one a frame shows (see SoundIndicator).
  const tones = useCallback(
```

**Replace in `src/ui/app/App.tsx`** (7):

```tsx
    <div className="app-shell">
      <header className="app-header">
        <h1>{t('app.title')}</h1>
        <p>{t('app.subtitle')}</p>
        <button type="button" onClick={newProject} disabled={running}>
          {t('app.new')}
        </button>
        <RunToolbar runStore={runStore} onRun={run} />
        {shownNotice && (
          <p className="app-notice" role="status" data-testid="app-notice">
```

with:

```tsx
    <div className="app-shell">
      <header className="app-header">
        <h1>{lab ? t(`lab.title.${lab.kind}`) : t('app.title')}</h1>
        <p>{lab ? t('app.title') : t('app.subtitle')}</p>
        {/* A lab always holds its template: Reset brings it back, nothing replaces it with an empty project. */}
        {!lab && (
          <button type="button" onClick={newProject} disabled={running}>
            {t('app.new')}
          </button>
        )}
        <RunToolbar
          runStore={runStore}
          onRun={run}
          runDisabled={checking}
          actions={
            lab && (
              <>
                {lab.challenge && (
                  <button type="button" className="lab-check" onClick={startCheck} disabled={checking}>
                    {checking ? t('lab.checking') : t('lab.check')}
                  </button>
                )}
                <button type="button" className={resetArmed ? 'lab-reset lab-reset-armed' : 'lab-reset'} onClick={reset}>
                  {resetArmed ? t('lab.resetConfirm') : t('lab.reset')}
                </button>
              </>
            )
          }
        />
        {lab?.challenge && <ChallengePanel challenge={lab.challenge} check={shownCheck} />}
        {shownNotice && (
          <p className="app-notice" role="status" data-testid="app-notice">
```

**Create `src/ui/app/ChallengePanel.tsx`:**

```tsx
import type { Challenge, CheckResult } from '../../core/challenge';
import { useText } from '../i18n/text';

// The goals of a lab and how the last check went (N6a S4): every goal with its state, and one line that says
// what to do next. The state is said in words as well as by the mark, for whoever cannot see the colour.

export type CheckView =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'done'; result: CheckResult; started: boolean };

export function ChallengePanel({ challenge, check }: { challenge: Challenge; check: CheckView }) {
  const t = useText();
  const verdict = (goalId: string) => (check.state === 'done' ? check.result.goals.find((goal) => goal.id === goalId)?.passed : undefined);
  const summary =
    check.state === 'checking'
      ? t('lab.result.checking')
      : check.state === 'done'
        ? check.result.passed
          ? t('lab.result.passed')
          : check.started
            ? t('lab.result.failed')
            : t('lab.result.notStarted')
        : '';
  return (
    <section className="challenge-panel" aria-label={t('lab.goals')} data-testid="challenge-panel">
      <h2>{t('lab.goals')}</h2>
      <ul>
        {challenge.goals.map((goal) => {
          const passed = verdict(goal.id);
          const state = passed === undefined ? 'todo' : passed ? 'passed' : 'failed';
          return (
            <li key={goal.id} className={`challenge-goal challenge-goal-${state}`} data-testid={`goal-${goal.id}`} data-state={state}>
              <span className="challenge-goal-mark" aria-hidden="true">
                {state === 'passed' ? '✓' : state === 'failed' ? '✗' : '○'}
              </span>
              {goal.label}
              <span className="visually-hidden">, {t(`lab.goal.${state}`)}</span>
            </li>
          );
        })}
      </ul>
      <p
        className={check.state === 'done' ? `challenge-status challenge-status-${check.result.passed ? 'passed' : 'failed'}` : 'challenge-status'}
        role="status"
        data-testid="challenge-status"
      >
        {summary}
      </p>
    </section>
  );
}
```

**Edit `src/ui/app/RunToolbar.tsx`** (4 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/RunToolbar.tsx`** (1):

```tsx
import { useStore } from 'zustand';
import type { RunDiagnostic } from '../../core/run/run-session';
```

with:

```tsx
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import type { RunDiagnostic } from '../../core/run/run-session';
```

**Replace in `src/ui/app/RunToolbar.tsx`** (2):

```tsx
  t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: diagnostic.message });

type RunToolbarProps = { runStore: RunStore; onRun(): void };

export function RunToolbar({ runStore, onRun }: RunToolbarProps) {
  const snapshot = useStore(runStore, (state) => state.snapshot);
  const startFailure = useStore(runStore, (state) => state.startFailure);
```

with:

```tsx
  t(diagnostic.severity === 'error' ? 'diagnostic.error' : 'diagnostic.warning', { message: diagnostic.message });

type RunToolbarProps = {
  runStore: RunStore;
  onRun(): void;
  /** True while something else drives the run (a lab's check, N6a S4): Run waits, Stop still stops. */
  runDisabled?: boolean;
  /** More buttons after Stop (a lab's Check and Reset). */
  actions?: ReactNode;
};

export function RunToolbar({ runStore, onRun, runDisabled = false, actions }: RunToolbarProps) {
  const snapshot = useStore(runStore, (state) => state.snapshot);
  const startFailure = useStore(runStore, (state) => state.startFailure);
```

**Replace in `src/ui/app/RunToolbar.tsx`** (3):

```tsx
  return (
    <div className="run-toolbar" role="toolbar" aria-label={t('run.toolbar')}>
      <button type="button" onClick={onRun}>
        {t('run.run')}
      </button>
```

with:

```tsx
  return (
    <div className="run-toolbar" role="toolbar" aria-label={t('run.toolbar')}>
      <button type="button" onClick={onRun} disabled={runDisabled}>
        {t('run.run')}
      </button>
```

**Replace in `src/ui/app/RunToolbar.tsx`** (4):

```tsx
        {t('run.stop')}
      </button>
      <span className={`run-status run-status-${snapshot.status}`} role="status" data-testid="run-status">
        {t(`run.status.${snapshot.status}`)}
```

with:

```tsx
        {t('run.stop')}
      </button>
      {actions}
      <span className={`run-status run-status-${snapshot.status}`} role="status" data-testid="run-status">
        {t(`run.status.${snapshot.status}`)}
```

**Edit `src/ui/app/app.css`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/app/app.css`** (1):

```css
  grid-template-rows: auto minmax(0, 1fr);
  height: 100vh;
}

```

with:

```css
  grid-template-rows: auto minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
}

```

**Replace in `src/ui/app/app.css`** (2):

```css
.launch-error .launch-error-title {
  font-weight: 600;
}
```

with:

```css
.launch-error .launch-error-title {
  font-weight: 600;
}

/* A lab launch (N6a S4): Check stands out, Reset asks twice, and the goals take a row of the header. */
.app-header .lab-check {
  border-color: #2680c2;
  background: #2680c2;
  color: #ffffff;
  font-weight: 600;
}

.app-header .lab-reset-armed {
  border-color: #a61b1b;
  color: #a61b1b;
}

.challenge-panel {
  display: flex;
  flex-basis: 100%;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  font-size: 13px;
}

.challenge-panel h2 {
  margin: 0;
  font-size: 13px;
}

.challenge-panel ul {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.challenge-goal-mark {
  display: inline-block;
  width: 1.4em;
  font-weight: 700;
}

.challenge-goal-passed {
  color: #207227;
}

.challenge-goal-failed {
  color: #a61b1b;
}

.challenge-status {
  margin: 0;
  color: #52606d;
}

.challenge-status:empty {
  display: none;
}

.challenge-status-passed {
  color: #207227;
  font-weight: 600;
}

.challenge-status-failed {
  color: #a61b1b;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* A narrow frame (a phone, a tablet in portrait, a small lesson column): circuit above, program below, scrolling. */
@media (max-width: 760px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-auto-rows: minmax(320px, 1fr);
    overflow-y: auto;
  }

  .program-region {
    border-top: 1px solid #d9e2ec;
    border-left: 0;
  }
}
```

**Edit `src/ui/i18n/messages.ts`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/i18n/messages.ts`** (1):

```ts
  'python.layer.L-3': 'The program cannot run yet.',
  'python.layer.L-4': 'Python cannot be generated yet.',
} as const satisfies Record<string, string>;

```

with:

```ts
  'python.layer.L-3': 'The program cannot run yet.',
  'python.layer.L-4': 'Python cannot be generated yet.',
  'lab.title.blockly': 'Block programming',
  'lab.title.yolobit': 'Yolo:Bit circuit',
  'lab.check': 'Check',
  'lab.checking': 'Checking…',
  'lab.reset': 'Reset',
  'lab.resetConfirm': 'Click again to reset',
  'lab.goals': 'Goals',
  'lab.goal.todo': 'not checked yet',
  'lab.goal.passed': 'met',
  'lab.goal.failed': 'not met yet',
  'lab.result.checking': 'Checking: the lab runs your program for a few seconds…',
  'lab.result.passed': 'Passed! Every goal is met.',
  'lab.result.failed': 'Not yet: look at the goals that are not met, change the program and check again.',
  'lab.result.notStarted': 'The program could not run: fix what the toolbar says, then check again.',
} as const satisfies Record<string, string>;

```

**Replace in `src/ui/i18n/messages.ts`** (2):

```ts
  'python.layer.L-3': 'Chương trình chưa chạy được.',
  'python.layer.L-4': 'Chưa sinh được Python.',
};

```

with:

```ts
  'python.layer.L-3': 'Chương trình chưa chạy được.',
  'python.layer.L-4': 'Chưa sinh được Python.',
  'lab.title.blockly': 'Lập trình khối',
  'lab.title.yolobit': 'Mạch Yolo:Bit',
  'lab.check': 'Kiểm tra',
  'lab.checking': 'Đang kiểm tra…',
  'lab.reset': 'Đặt lại',
  'lab.resetConfirm': 'Bấm lần nữa để đặt lại',
  'lab.goals': 'Mục tiêu',
  'lab.goal.todo': 'chưa kiểm tra',
  'lab.goal.passed': 'đạt',
  'lab.goal.failed': 'chưa đạt',
  'lab.result.checking': 'Đang kiểm tra: chương trình của bạn được chạy thử vài giây…',
  'lab.result.passed': 'Đạt! Bạn đã hoàn thành mọi mục tiêu.',
  'lab.result.failed': 'Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.',
  'lab.result.notStarted': 'Chương trình chưa chạy được: sửa lỗi được báo ở thanh trên rồi kiểm tra lại.',
};

```

**Edit `src/ui/state/run-store.ts`** (6 change(s), each `old` occurs exactly once):

**Replace in `src/ui/state/run-store.ts`** (1):

```ts
import { createStore } from 'zustand/vanilla';
import type { ProjectDocument } from '../../core/circuit/document';
import type { RunSession, RunSnapshot, StartResult } from '../../core/run/run-session';
```

with:

```ts
import { createStore } from 'zustand/vanilla';
import type { CheckSession } from '../../core/challenge';
import type { ProjectDocument } from '../../core/circuit/document';
import type { RunSession, RunSnapshot, StartResult } from '../../core/run/run-session';
```

**Replace in `src/ui/state/run-store.ts`** (2):

```ts
  /** Why the last Run did not start; cleared by the next Run that starts, or by `clearStartFailure`. */
  startFailure: Extract<StartResult, { ok: false }> | null;
  run(project: ProjectDocument): void;
  stop(): void;
  /** Holds a push button of the running circuit closed or lets it open (no-op while idle). */
```

with:

```ts
  /** Why the last Run did not start; cleared by the next Run that starts, or by `clearStartFailure`. */
  startFailure: Extract<StartResult, { ok: false }> | null;
  /** Starts a run of `project`; what the session answered (N6a: a check needs to know whether its run started). */
  run(project: ProjectDocument): StartResult;
  stop(): void;
  /** Holds a push button of the running circuit closed or lets it open (no-op while idle). */
```

**Replace in `src/ui/state/run-store.ts`** (3):

```ts
   */
  onSnapshot(listener: (snapshot: RunSnapshot) => void): () => void;
};

```

with:

```ts
   */
  onSnapshot(listener: (snapshot: RunSnapshot) => void): () => void;
  /** The session's snapshot now, its console brought up to date: not held back to a frame like `snapshot` (N6a S2). */
  latestSnapshot(): RunSnapshot;
};

```

**Replace in `src/ui/state/run-store.ts`** (4):

```ts
        const result = session.start(project);
        set({ startFailure: result.ok ? null : result });
      },
      stop: () => session.stop(),
```

with:

```ts
        const result = session.start(project);
        set({ startFailure: result.ok ? null : result });
        return result;
      },
      stop: () => session.stop(),
```

**Replace in `src/ui/state/run-store.ts`** (5):

```ts
      clearStartFailure: () => set({ startFailure: null }),
      onSnapshot: (listener) => session.subscribe(listener),
    };
  });
```

with:

```ts
      clearStartFailure: () => set({ startFailure: null }),
      onSnapshot: (listener) => session.subscribe(listener),
      latestSnapshot: () => session.getSnapshot(),
    };
  });
```

**Replace in `src/ui/state/run-store.ts`** (6):

```ts

export type RunStore = ReturnType<typeof createRunStore>;
```

with:

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

- [ ] **Step 4: Check the lab by hand (optional but quick)**

Run `pnpm dev`, open `http://localhost:5173/?embed=1&lab=yolobit&template=ybc-heart` (and `?lang=en` on it). Expected: heading "Mạch Yolo:Bit", no "Mới" button, buttons Chạy / Dừng / **Kiểm tra** / Đặt lại, goal "○ Màn hình hiện hình trái tim"; Kiểm tra → after ~1 s "✗ … Chưa đạt"; drag the loose "hiển thị hình" block into "khi bắt đầu", Kiểm tra → "✓ … Đạt!". `http://localhost:5173/` still shows "STEM Studio / Proof of Concept / New / Run" in English.

- [ ] **Step 5: Run the tests and the whole gate**

Run: `pnpm vitest run src/ui/state/run-store.test.ts src/ui/app/ChallengePanel.test.tsx`

Expected: `Test Files  2 passed`, `Tests  17 passed`.

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  133 passed`, `Tests  4371 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 6: Commit**

```bash
git add src/main.tsx src/ui/app/App.tsx src/ui/app/ChallengePanel.test.tsx src/ui/app/ChallengePanel.tsx src/ui/app/RunToolbar.tsx src/ui/app/app.css src/ui/i18n/messages.ts src/ui/state/run-store.test.ts src/ui/state/run-store.ts
git commit -m "$(cat <<'EOF'
feat(n6a): give lab launches their chrome: title, Check, goals, Reset (S4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 8: Theme: CSS tokens, Be Vietnam Pro, Blockly theme, canvas colours (S5, theme)  — `model: sonnet`

Bộ token riêng của stem-demo trên `:root` (indigo/cam, hài hoà với LMS nhưng không import gì, R14), font tự host, theme Blockly Zelos dùng màu token, và một bảng màu canvas (`src/ui/canvas/colors.ts`, R12, giá trị cũ). `app.css` được token hoá bằng một script một lần (thay theo thuộc tính, trong bước 1) — chạy nó **sau** Task 7 vì nó cũng token hoá CSS chrome lab. `theme.test.ts` giữ cho không còn mã màu nào ngoài `:root` và ngoài `colors.ts`.

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/main.tsx`
- Modify: `src/ui/app/app.css`
- Create: `src/ui/app/fonts.test.ts`
- Create: `src/ui/app/fonts.ts`
- Modify: `src/ui/blockly/BlocklyPanel.tsx`
- Create: `src/ui/blockly/theme.ts`
- Modify: `src/ui/canvas/CircuitCanvas.tsx`
- Modify: `src/ui/canvas/GenericRenderer.tsx`
- Modify: `src/ui/canvas/LedRenderer.tsx`
- Modify: `src/ui/canvas/PotentiometerRenderer.tsx`
- Modify: `src/ui/canvas/PushButtonRenderer.tsx`
- Modify: `src/ui/canvas/YbcBoardRenderer.tsx`
- Create: `src/ui/canvas/colors.ts`
- Create: `src/ui/theme.test.ts`

**Interfaces:**
- Consumes: Task 7 CSS (`.lab-check`, `.challenge-*`); `BlocklyPanel` inject options.
- Produces: `canvasPalette` (`src/ui/canvas/colors.ts`); `stemTheme`, `editorFontFamily` (`src/ui/blockly/theme.ts`); `loadUiFont(fonts?, waitMs?)` (`src/ui/app/fonts.ts`); CSS tokens `--stem-font`, `--stem-font-mono`, `--stem-radius`, `--stem-color-{bg,surface,surface-muted,text,text-muted,text-subtle,border,border-strong,primary,on-primary,accent,success,success-soft,danger,danger-soft,warning-text,warning-soft,neutral-soft,neutral-text,console-bg,console-text,display-bg,display-text,pressed,pressed-border,overlay}`, `--stem-shadow-pressed`.

- [ ] **Step 1: Add the font, token-ise the CSS, add the theme and the canvas colours**

**Run (it changes files):**

```bash
pnpm add -E @fontsource/be-vietnam-pro@5.3.0
```

Expected: `+ @fontsource/be-vietnam-pro 5.3.0` … `Done … using pnpm v12.8.1`; `package.json` gains `"@fontsource/be-vietnam-pro": "5.3.0"` under `dependencies` and `pnpm-lock.yaml` gains its entry (8 lines). Nothing else changes.


**Edit `src/main.tsx`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/main.tsx`** (1):

```tsx
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { createHostBridge, type HostBridge } from './ui/app/host-bridge';
import { connectLabHost, loadHostProject } from './ui/app/lab-host';
```

with:

```tsx
import { createDexieProjectRepository } from './storage/dexie-project-repository';
import { App } from './ui/app/App';
import { loadUiFont } from './ui/app/fonts';
import { createHostBridge, type HostBridge } from './ui/app/host-bridge';
import { connectLabHost, loadHostProject } from './ui/app/lab-host';
```

**Replace in `src/main.tsx`** (2):

```tsx
applyEditorLocale(locale);

const started = await openAtStartup(launch, {
  openRepository: () => createDexieProjectRepository(),
```

with:

```tsx
applyEditorLocale(locale);

// Blockly measures block text when it draws: the font is loaded first (at most a moment, N6a S5).
const fontLoaded = loadUiFont();

const started = await openAtStartup(launch, {
  openRepository: () => createDexieProjectRepository(),
```

**Replace in `src/main.tsx`** (3):

```tsx
  canOpenProgram: (blocks) => canOpenProgram(blocks, packs),
});

const container = document.getElementById('root');
```

with:

```tsx
  canOpenProgram: (blocks) => canOpenProgram(blocks, packs),
});

await fontLoaded;

const container = document.getElementById('root');
```

**Run (it changes files)** — rewrite `src/ui/app/app.css` onto tokens (`:root` block replaced; every colour literal outside it becomes the token for that property; monospace font and 4/6 px radii become tokens):

```bash
python3 - <<'PYEOF'
# One-off rewrite of src/ui/app/app.css onto the design tokens (N6a S5). Run from the repo root.
import re

path = 'src/ui/app/app.css'
css = open(path, encoding='utf-8').read()

root_old = """:root {
  color-scheme: light;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #1f2933;
  background: #f5f7fa;
}"""
root_new = """/*
 * The design tokens of STEM Studio (N6a S5): its own defaults, chosen to sit well beside the LMS that embeds it
 * (indigo and orange), never imported from it. Every colour of the chrome is one of these; the canvas has its own
 * palette (src/ui/canvas/colors.ts) and the block editor its theme (src/ui/blockly/theme.ts).
 */
:root {
  --stem-font: 'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --stem-font-mono: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  --stem-radius: 8px;
  --stem-color-bg: #f6f7fb;
  --stem-color-surface: #ffffff;
  --stem-color-surface-muted: #f1f4f9;
  --stem-color-text: #1e293b;
  --stem-color-text-muted: #64748b;
  --stem-color-text-subtle: #94a3b8;
  --stem-color-border: #dbe2ec;
  --stem-color-border-strong: #a3b1c6;
  --stem-color-primary: #4f46e5;
  --stem-color-on-primary: #ffffff;
  --stem-color-accent: #f97316;
  --stem-color-success: #15803d;
  --stem-color-success-soft: #dcfce7;
  --stem-color-danger: #b91c1c;
  --stem-color-danger-soft: #fee2e2;
  --stem-color-warning-text: #9a3412;
  --stem-color-warning-soft: #ffedd5;
  --stem-color-neutral-soft: #e2e8f0;
  --stem-color-neutral-text: #334155;
  --stem-color-console-bg: #1e293b;
  --stem-color-console-text: #e2e8f0;
  --stem-color-display-bg: #10292f;
  --stem-color-display-text: #e6f4f7;
  --stem-color-pressed: #147d64;
  --stem-color-pressed-border: #0c6b58;
  --stem-color-overlay: rgba(255, 255, 255, 0.95);
  --stem-shadow-pressed: rgba(0, 0, 0, 0.4);

  color-scheme: light;
  font-family: var(--stem-font);
  color: var(--stem-color-text);
  background: var(--stem-color-bg);
}"""
assert root_old in css
css = css.replace(root_old, root_new)

direct = {
    '#d9e2ec': 'border',
    '#a61b1b': 'danger',
    '#8d2b0b': 'warning-text',
    '#207227': 'success',
    '#2680c2': 'primary',
    '#fff3c4': 'warning-soft',
    '#ffe3e3': 'danger-soft',
    '#627d98': 'text-muted',
    '#52606d': 'text-muted',
    '#e6f4f7': 'display-text',
    '#10292f': 'display-bg',
    '#e3f9e5': 'success-soft',
    '#3e4c59': 'neutral-text',
    '#147d64': 'pressed',
    '#0c6b58': 'pressed-border',
    '#f5f7fa': 'surface-muted',
}

def token(value, prop):
    if value == '#ffffff':
        return 'on-primary' if prop == 'color' else 'surface'
    if value == '#1f2933':
        return 'console-bg' if prop == 'background' else 'text'
    if value == '#e4e7eb':
        return 'console-text' if prop == 'color' else 'neutral-soft' if prop == 'background' else 'border'
    if value == '#9aa5b1':
        return 'text-subtle' if prop == 'color' else 'border-strong'
    return direct[value]

out = []
in_root = False
for line in css.split('\n'):
    if line.startswith(':root {'):
        in_root = True
    if in_root:
        out.append(line)
        if line == '}':
            in_root = False
        continue
    match = re.match(r'\s*([a-z-]+):', line)
    prop = match.group(1) if match else ''
    line = re.sub(r'#[0-9a-fA-F]{6}\b', lambda m: f'var(--stem-color-{token(m.group(0).lower(), prop)})', line)
    line = line.replace('rgba(255, 255, 255, 0.95)', 'var(--stem-color-overlay)').replace('rgba(0, 0, 0, 0.4)', 'var(--stem-shadow-pressed)')
    line = line.replace("font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;", 'font-family: var(--stem-font-mono);')
    line = re.sub(r'border-radius: [46]px;', 'border-radius: var(--stem-radius);', line)
    out.append(line)

open(path, 'w', encoding='utf-8').write('\n'.join(out))
PYEOF
```

Expected: no output; `grep -nE '#[0-9a-fA-F]{6}|rgba' src/ui/app/app.css` prints only lines inside `:root` (the `--stem-…` definitions).

**Create `src/ui/app/fonts.ts`:**

```ts
// The UI font, Be Vietnam Pro (SIL OFL 1.1), self-hosted from @fontsource: bundled by Vite and served from the
// lab's own origin, so nothing comes from a CDN or from the page that embeds the lab (N6a S5). Every subset is
// declared (latin, latin-ext, vietnamese); the browser fetches only those a page needs.
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';

/** How long startup waits for the font: the editor measures block text once, so it should not measure a fallback. */
const fontWaitMs = 1500;

/** Resolves once the weights the UI uses are loaded, or after `fontWaitMs`; never fails (a missing font is a fallback, not an error). */
export async function loadUiFont(fonts: Pick<FontFaceSet, 'load'> | undefined = globalThis.document?.fonts, waitMs = fontWaitMs): Promise<void> {
  if (!fonts) {
    return;
  }
  const loaded = Promise.all(['400', '600', '700'].map((weight) => fonts.load(`${weight} 16px "Be Vietnam Pro"`, 'Tiếng Việt'))).then(
    () => undefined,
    () => undefined,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  await Promise.race([loaded, waited]);
  clearTimeout(timer);
}
```

**Edit `src/ui/blockly/BlocklyPanel.tsx`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/blockly/BlocklyPanel.tsx`** (1):

```tsx
import type { ProjectStore } from '../state/project-store';
import { registerBlocks, ybcVariablesFlyout } from './editor-blocks';

// Blockly is only a view of `document.program.blocks` (plan §5.1 B4): the
```

with:

```tsx
import type { ProjectStore } from '../state/project-store';
import { registerBlocks, ybcVariablesFlyout } from './editor-blocks';
import { stemTheme } from './theme';

// Blockly is only a view of `document.program.blocks` (plan §5.1 B4): the
```

**Replace in `src/ui/blockly/BlocklyPanel.tsx`** (2):

```tsx
    const workspace = Blockly.inject(container, {
      renderer: 'zelos',
      toolbox: toolbox as Blockly.utils.toolbox.ToolboxInfo,
      media: '/blockly-media/',
```

with:

```tsx
    const workspace = Blockly.inject(container, {
      renderer: 'zelos',
      theme: stemTheme,
      toolbox: toolbox as Blockly.utils.toolbox.ToolboxInfo,
      media: '/blockly-media/',
```

**Create `src/ui/blockly/theme.ts`:**

```ts
import * as Blockly from 'blockly';

// The block editor's theme (N6a S5): Blockly's Zelos theme (the renderer is Zelos too) with the colours of the
// chrome's tokens (app.css) and its font. Blockly draws on SVG and takes no CSS variables, so the few colours it
// needs are written here, with the token each one stands for. The blocks keep the colours of their definitions.

export const editorFontFamily = "'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const stemTheme = Blockly.Theme.defineTheme('stem-studio', {
  name: 'stem-studio',
  base: Blockly.Themes.Zelos,
  fontStyle: { family: editorFontFamily, weight: '600', size: 12 },
  componentStyles: {
    workspaceBackgroundColour: '#f6f7fb', // --stem-color-bg
    toolboxBackgroundColour: '#ffffff', // --stem-color-surface
    toolboxForegroundColour: '#1e293b', // --stem-color-text
    flyoutBackgroundColour: '#f1f4f9', // --stem-color-surface-muted
    flyoutForegroundColour: '#1e293b', // --stem-color-text
    flyoutOpacity: 1,
    scrollbarColour: '#a3b1c6', // --stem-color-border-strong
    insertionMarkerColour: '#4f46e5', // --stem-color-primary
    selectedGlowColour: '#f97316', // --stem-color-accent
  },
});
```

**Edit `src/ui/canvas/CircuitCanvas.tsx`** (8 change(s), each `old` occurs exactly once):

**Replace in `src/ui/canvas/CircuitCanvas.tsx`** (1):

```tsx
import { useElementSize } from './use-element-size';
import { portPickRadiusPx, stageToWorld, stageToWorldDistance } from './viewport';

// Renders the design state plus, while running, the simulation snapshot, and
```

with:

```tsx
import { useElementSize } from './use-element-size';
import { portPickRadiusPx, stageToWorld, stageToWorldDistance } from './viewport';
import { canvasPalette } from './colors';

// Renders the design state plus, while running, the simulation snapshot, and
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx`** (2):

```tsx
                    name="wire-preview"
                    points={[draftStart.x, draftStart.y, draft.pointer.x, draft.pointer.y]}
                    stroke="#2680c2"
                    strokeWidth={2}
                    dash={[6, 4]}
```

with:

```tsx
                    name="wire-preview"
                    points={[draftStart.x, draftStart.y, draft.pointer.x, draft.pointer.y]}
                    stroke={canvasPalette.selection}
                    strokeWidth={2}
                    dash={[6, 4]}
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx`** (3):

```tsx
          width={width + 2 * selectionMargin}
          height={height + 2 * selectionMargin}
          stroke="#d64545"
          strokeWidth={2}
          cornerRadius={4}
```

with:

```tsx
          width={width + 2 * selectionMargin}
          height={height + 2 * selectionMargin}
          stroke={canvasPalette.incompatible}
          strokeWidth={2}
          cornerRadius={4}
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx`** (4):

```tsx
          width={width + 2 * selectionMargin}
          height={height + 2 * selectionMargin}
          stroke="#2680c2"
          strokeWidth={2}
          dash={[6, 4]}
```

with:

```tsx
          width={width + 2 * selectionMargin}
          height={height + 2 * selectionMargin}
          stroke={canvasPalette.selection}
          strokeWidth={2}
          dash={[6, 4]}
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx`** (5):

```tsx
      selected={selected}
      points={[from.x, from.y, to.x, to.y]}
      stroke={selected ? '#2680c2' : '#334e68'}
      strokeWidth={selected ? 4 : 3}
      // Easier to click than the 3 px it shows.
```

with:

```tsx
      selected={selected}
      points={[from.x, from.y, to.x, to.y]}
      stroke={selected ? canvasPalette.wire.selected : canvasPalette.wire.normal}
      strokeWidth={selected ? 4 : 3}
      // Easier to click than the 3 px it shows.
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx`** (6):

```tsx

const portColors: Record<PortDefinition['kind'], string> = {
  gpio: '#2680c2',
  power: '#d64545',
  ground: '#1f2933',
  passive: '#7b8794',
};

```

with:

```tsx

const portColors: Record<PortDefinition['kind'], string> = {
  gpio: canvasPalette.port.gpio,
  power: canvasPalette.port.power,
  ground: canvasPalette.port.ground,
  passive: canvasPalette.port.passive,
};

```

**Replace in `src/ui/canvas/CircuitCanvas.tsx`** (7):

```tsx
          radius={highlighted ? 6 : 4}
          fill={portColors[port.kind]}
          stroke={highlighted ? '#f0b429' : '#ffffff'}
          strokeWidth={highlighted ? 2 : 1}
          hitFunc={pickAreaHit}
```

with:

```tsx
          radius={highlighted ? 6 : 4}
          fill={portColors[port.kind]}
          stroke={highlighted ? canvasPalette.port.highlighted : canvasPalette.port.outline}
          strokeWidth={highlighted ? 2 : 1}
          hitFunc={pickAreaHit}
```

**Replace in `src/ui/canvas/CircuitCanvas.tsx`** (8):

```tsx
            align={labelOnLeft ? 'right' : 'left'}
            fontSize={10}
            fill="#52606d"
            listening={false}
          />
```

with:

```tsx
            align={labelOnLeft ? 'right' : 'left'}
            fontSize={10}
            fill={canvasPalette.port.label}
            listening={false}
          />
```

**Edit `src/ui/canvas/GenericRenderer.tsx`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/ui/canvas/GenericRenderer.tsx`** (1):

```tsx
import { Rect, Text } from 'react-konva';
import type { DeviceRendererProps } from './renderers';

const fontSize = 13;
```

with:

```tsx
import { Rect, Text } from 'react-konva';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

const fontSize = 13;
```

**Replace in `src/ui/canvas/GenericRenderer.tsx`** (2):

```tsx
        height={height}
        cornerRadius={6}
        fill="#e4e7eb"
        stroke="#9aa5b1"
      />
      <Text
```

with:

```tsx
        height={height}
        cornerRadius={6}
        fill={canvasPalette.generic.body}
        stroke={canvasPalette.generic.outline}
      />
      <Text
```

**Replace in `src/ui/canvas/GenericRenderer.tsx`** (3):

```tsx
        align="center"
        fontSize={fontSize}
        fill="#334e68"
      />
    </>
```

with:

```tsx
        align="center"
        fontSize={fontSize}
        fill={canvasPalette.generic.label}
      />
    </>
```

**Edit `src/ui/canvas/LedRenderer.tsx`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/ui/canvas/LedRenderer.tsx`** (1):

```tsx
import { Rect } from 'react-konva';
import type { DeviceRendererProps } from './renderers';

export function LedRenderer({ definition, runtimeState }: DeviceRendererProps) {
```

with:

```tsx
import { Rect } from 'react-konva';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

export function LedRenderer({ definition, runtimeState }: DeviceRendererProps) {
```

**Replace in `src/ui/canvas/LedRenderer.tsx`** (2):

```tsx
        height={domeHeight}
        cornerRadius={[width / 2, width / 2, 4, 4]}
        fill={lit ? '#ff3b30' : '#7f1d1d'}
        stroke="#5c1010"
        shadowColor="#ff3b30"
        shadowBlur={lit ? 28 : 0}
        shadowOpacity={lit ? 0.9 : 0}
```

with:

```tsx
        height={domeHeight}
        cornerRadius={[width / 2, width / 2, 4, 4]}
        fill={lit ? canvasPalette.led.lit : canvasPalette.led.dark}
        stroke={canvasPalette.led.outline}
        shadowColor={canvasPalette.led.glow}
        shadowBlur={lit ? 28 : 0}
        shadowOpacity={lit ? 0.9 : 0}
```

**Replace in `src/ui/canvas/LedRenderer.tsx`** (3):

```tsx
        height={6}
        cornerRadius={2}
        fill="#9aa5b1"
      />
    </>
```

with:

```tsx
        height={6}
        cornerRadius={2}
        fill={canvasPalette.led.base}
      />
    </>
```

**Edit `src/ui/canvas/PotentiometerRenderer.tsx`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/ui/canvas/PotentiometerRenderer.tsx`** (1):

```tsx
import { SLIDER_MAX_PERCENT, SLIDER_MIN_PERCENT } from '../../core/simulation/simulate-circuit';
import type { DeviceRendererProps } from './renderers';

/** The knob turns through this many degrees from its start (0 %) to its end (100 %). */
```

with:

```tsx
import { SLIDER_MAX_PERCENT, SLIDER_MIN_PERCENT } from '../../core/simulation/simulate-circuit';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

/** The knob turns through this many degrees from its start (0 %) to its end (100 %). */
```

**Replace in `src/ui/canvas/PotentiometerRenderer.tsx`** (2):

```tsx
  return (
    <>
      <Rect x={-width / 2} y={-height / 2} width={width} height={height} cornerRadius={6} fill="#3e4c59" stroke="#1f2933" />
      <Group y={-10}>
        <Circle radius={knobRadius} fill="#cbd2d9" stroke="#52606d" strokeWidth={2} />
        {/* `value` is set on the node so tests read what was rendered (plan §11.4). */}
        <Line name="knob" value={percent} points={[0, 0, 0, -(knobRadius - 4)]} rotation={angle} stroke="#1f2933" strokeWidth={4} lineCap="round" />
      </Group>
      <Text
```

with:

```tsx
  return (
    <>
      <Rect x={-width / 2} y={-height / 2} width={width} height={height} cornerRadius={6} fill={canvasPalette.potentiometer.body} stroke={canvasPalette.potentiometer.outline} />
      <Group y={-10}>
        <Circle radius={knobRadius} fill={canvasPalette.potentiometer.knob} stroke={canvasPalette.potentiometer.knobOutline} strokeWidth={2} />
        {/* `value` is set on the node so tests read what was rendered (plan §11.4). */}
        <Line name="knob" value={percent} points={[0, 0, 0, -(knobRadius - 4)]} rotation={angle} stroke={canvasPalette.potentiometer.pointer} strokeWidth={4} lineCap="round" />
      </Group>
      <Text
```

**Replace in `src/ui/canvas/PotentiometerRenderer.tsx`** (3):

```tsx
        align="center"
        fontSize={11}
        fill="#e4e7eb"
        listening={false}
      />
```

with:

```tsx
        align="center"
        fontSize={11}
        fill={canvasPalette.potentiometer.label}
        listening={false}
      />
```

**Edit `src/ui/canvas/PushButtonRenderer.tsx`** (3 change(s), each `old` occurs exactly once):

**Replace in `src/ui/canvas/PushButtonRenderer.tsx`** (1):

```tsx
import { Circle, Rect } from 'react-konva';
import type { DeviceRendererProps } from './renderers';

const capRadius = 13;
```

with:

```tsx
import { Circle, Rect } from 'react-konva';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

const capRadius = 13;
```

**Replace in `src/ui/canvas/PushButtonRenderer.tsx`** (2):

```tsx
        height={height}
        cornerRadius={4}
        fill="#3e4c59"
        stroke="#1f2933"
      />
      {/* `closed` is set on the node so tests read what was rendered (plan §11.4). */}
```

with:

```tsx
        height={height}
        cornerRadius={4}
        fill={canvasPalette.pushButton.body}
        stroke={canvasPalette.pushButton.outline}
      />
      {/* `closed` is set on the node so tests read what was rendered (plan §11.4). */}
```

**Replace in `src/ui/canvas/PushButtonRenderer.tsx`** (3):

```tsx
        closed={closed}
        radius={closed ? capRadius - 2 : capRadius}
        fill={closed ? '#147d64' : '#3ebd93'}
        stroke="#0c6b58"
        shadowColor="#000000"
        shadowOffsetY={closed ? 0 : 2}
        shadowBlur={closed ? 0 : 3}
```

with:

```tsx
        closed={closed}
        radius={closed ? capRadius - 2 : capRadius}
        fill={closed ? canvasPalette.pushButton.pressed : canvasPalette.pushButton.released}
        stroke={canvasPalette.pushButton.capOutline}
        shadowColor={canvasPalette.pushButton.shadow}
        shadowOffsetY={closed ? 0 : 2}
        shadowBlur={closed ? 0 : 3}
```

**Edit `src/ui/canvas/YbcBoardRenderer.tsx`** (2 change(s), each `old` occurs exactly once):

**Replace in `src/ui/canvas/YbcBoardRenderer.tsx`** (1):

```tsx
import { renderedPixels } from '../runtime-controls/display-view';
import type { DeviceRendererProps } from './renderers';

// The body of a Yolo:Bit-compatible board (YB plan §8.4, S9): our own shell and the places of the onboard
```

with:

```tsx
import { renderedPixels } from '../runtime-controls/display-view';
import type { DeviceRendererProps } from './renderers';
import { canvasPalette } from './colors';

// The body of a Yolo:Bit-compatible board (YB plan §8.4, S9): our own shell and the places of the onboard
```

**Replace in `src/ui/canvas/YbcBoardRenderer.tsx`** (2):

```tsx
// their pressed state and slider belong to the controls under the canvas, and the snapshot does not echo them.

const shellFill = '#1f4e5f';
const shellStroke = '#143642';
const partFill = '#2c7a8c';
const labelFill = '#e6f4f7';
const soundingStroke = '#f0b429';
const cellOff = '#10292f';
const cellGap = 3;

```

with:

```tsx
// their pressed state and slider belong to the controls under the canvas, and the snapshot does not echo them.

const { shell: shellFill, shellOutline: shellStroke, part: partFill, label: labelFill, sounding: soundingStroke, cellOff } = canvasPalette.ybcBoard;
const cellGap = 3;

```

**Create `src/ui/canvas/colors.ts`:**

```ts
// Every colour the circuit canvas draws with (N6a S5), in one place: the Konva renderers read them from here
// instead of writing their own. The values are the ones the renderers had, so the canvas looks as before; a
// theme changes this file only. The chrome around the canvas uses the CSS tokens of app.css.

export const canvasPalette = {
  /** The dashed frame of the selected component, and the wire being drawn. */
  selection: '#2680c2',
  /** The frame of a component this kind of project cannot use. */
  incompatible: '#d64545',
  wire: { normal: '#334e68', selected: '#2680c2' },
  port: {
    gpio: '#2680c2',
    power: '#d64545',
    ground: '#1f2933',
    passive: '#7b8794',
    outline: '#ffffff',
    highlighted: '#f0b429',
    label: '#52606d',
  },
  generic: { body: '#e4e7eb', outline: '#9aa5b1', label: '#334e68' },
  led: { lit: '#ff3b30', dark: '#7f1d1d', outline: '#5c1010', glow: '#ff3b30', base: '#9aa5b1' },
  potentiometer: { body: '#3e4c59', outline: '#1f2933', knob: '#cbd2d9', knobOutline: '#52606d', pointer: '#1f2933', label: '#e4e7eb' },
  pushButton: { body: '#3e4c59', outline: '#1f2933', pressed: '#147d64', released: '#3ebd93', capOutline: '#0c6b58', shadow: '#000000' },
  ybcBoard: { shell: '#1f4e5f', shellOutline: '#143642', part: '#2c7a8c', label: '#e6f4f7', sounding: '#f0b429', cellOff: '#10292f' },
} as const;
```

- [ ] **Step 2: Write the tests**

**Create `src/ui/app/fonts.test.ts`:**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadUiFont } from './fonts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('loadUiFont (N6a S5)', () => {
  it('asks for the three weights the UI uses, and resolves once they are loaded', async () => {
    const asked: string[] = [];
    await loadUiFont({ load: async (font) => (asked.push(font), []) }, 1500);
    expect(asked).toEqual(['400 16px "Be Vietnam Pro"', '600 16px "Be Vietnam Pro"', '700 16px "Be Vietnam Pro"']);
  });

  it('stops waiting after the given time', async () => {
    let done = false;
    void loadUiFont({ load: () => new Promise(() => {}) }, 1500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('never fails: a font that does not load is a fallback', async () => {
    await expect(loadUiFont({ load: () => Promise.reject(new Error('offline')) }, 1500)).resolves.toBeUndefined();
    await expect(loadUiFont(undefined)).resolves.toBeUndefined();
  });
});
```

**Create `src/ui/theme.test.ts`:**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canvasPalette } from './canvas/colors';

// N6a S5: every colour of the chrome is a token of app.css, and every colour of the canvas is in colors.ts.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const colourLiteral = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

describe('theme (N6a S5)', () => {
  it('writes the chrome’s colours only as tokens on :root', () => {
    const css = read('./app/app.css');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);
    const outside = css.replace(root, '').split('\n').filter((line) => colourLiteral.test(line));
    expect(outside).toEqual([]);
    expect(root).toContain("--stem-font: 'Be Vietnam Pro'");
  });

  it('uses only tokens that :root defines', () => {
    const css = read('./app/app.css');
    const defined = new Set([...css.matchAll(/(--stem-[a-z-]+):/g)].map((match) => match[1]));
    const used = [...css.matchAll(/var\((--stem-[a-z-]+)\)/g)].map((match) => match[1]);
    expect(used.filter((token) => !defined.has(token))).toEqual([]);
  });

  it('draws the canvas only with the colours of colors.ts', () => {
    const canvasDir = new URL('./canvas/', import.meta.url);
    const renderers = readdirSync(canvasDir).filter((name) => name.endsWith('.tsx') && !name.includes('.test.'));
    const literals = renderers.flatMap((name) => read(`./canvas/${name}`).split('\n').filter((line) => colourLiteral.test(line)).map((line) => `${name}: ${line.trim()}`));
    expect(literals).toEqual([]);
    expect(canvasPalette.selection).toBe('#2680c2');
  });
});
```

- [ ] **Step 3: Run the tests and the whole gate**

Run: `pnpm vitest run src/ui/theme.test.ts src/ui/app/fonts.test.ts`

Expected: `Test Files  2 passed`, `Tests  6 passed`.

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  135 passed`, `Tests  4377 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/main.tsx src/ui/app/app.css src/ui/app/fonts.test.ts src/ui/app/fonts.ts src/ui/blockly/BlocklyPanel.tsx src/ui/blockly/theme.ts src/ui/canvas/CircuitCanvas.tsx src/ui/canvas/GenericRenderer.tsx src/ui/canvas/LedRenderer.tsx src/ui/canvas/PotentiometerRenderer.tsx src/ui/canvas/PushButtonRenderer.tsx src/ui/canvas/YbcBoardRenderer.tsx src/ui/canvas/colors.ts src/ui/theme.test.ts
git commit -m "$(cat <<'EOF'
feat(n6a): theme the lab with tokens, Be Vietnam Pro and one canvas palette (S5)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 9: E2E: stem-lab/v1 in the lesson page (spec §12)  — `model: opus`

`e2e/lesson-host.mjs` ghi mọi message từ frame (kèm origin) vào `window.__labMessages` và có `window.__sendToLab(message, targetOrigin)`, như `LabFrame` của host. `e2e/ybc-embed.spec.ts` (spec §12, URL theo R1): `ready` đúng shape → Kiểm tra bài khởi đầu ⇒ `check-result.passed = false` và chuỗi `ready, run-started, run-stopped, check-result` (không `project-changed` lúc mở) → host gửi `load-project` lời giải ⇒ Kiểm tra ⇒ `check-result.passed = true` → `project-changed` về host; origin lạ ⇒ không message nào, `load-project` bị bỏ qua; lab Blockly `blink` đạt; 4 bài Yolo:Bit ở tab riêng (không bridge) không đạt rồi đạt; Dừng giữa kiểm tra; Đặt lại hai lần; launch hỏng tiếng Việt.

**Files:**
- Modify: `e2e/lesson-host.mjs`
- Create: `e2e/ybc-embed.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ybcSolutionDocument`, `ybcStarterDocument` (not `templates.ts`: JSON imports), `projectDocumentSchema`; Task 7 test ids and Vietnamese labels (`Kiểm tra`, `Dừng`, `Đặt lại`, `Bấm lần nữa để đặt lại`, `Đang kiểm tra…`, `challenge-status`, `goal-<id>`); dev hook `window.__stem` (`getProject`, `loadProject`, `getCanvasState`).
- Produces: `window.__labMessages: { origin, data }[]`, `window.__sendToLab(message, targetOrigin)` on the lesson page.

- [ ] **Step 1: Write the tests**

**Edit `e2e/lesson-host.mjs`** (2 change(s), each `old` occurs exactly once):

**Replace in `e2e/lesson-host.mjs`** (1):

```js
//
//   GET /lesson?lab=<lab URL>[&sandbox=<iframe sandbox tokens>]

const port = Number(argv[2] ?? 5190);
```

with:

```js
//
//   GET /lesson?lab=<lab URL>[&sandbox=<iframe sandbox tokens>]
//
// Like the learn app's LabFrame (N6a S3), the page keeps every message the frame's window sends it, with its
// origin, in `window.__labMessages`, and `window.__sendToLab(message, targetOrigin)` posts to the frame: the
// E2E reads and drives stem-lab/v1 through them.

const port = Number(argv[2] ?? 5190);
```

**Replace in `e2e/lesson-host.mjs`** (2):

```js
      sandbox === null ? '' : ` sandbox="${escapeHtml(sandbox)}"`
    }></iframe>
  </body>
</html>
```

with:

```js
      sandbox === null ? '' : ` sandbox="${escapeHtml(sandbox)}"`
    }></iframe>
    <script>
      const frame = document.querySelector('iframe');
      window.__labMessages = [];
      window.addEventListener('message', (event) => {
        if (event.source === frame.contentWindow) {
          window.__labMessages.push({ origin: event.origin, data: event.data });
        }
      });
      window.__sendToLab = (message, targetOrigin) => frame.contentWindow.postMessage(message, targetOrigin);
    </script>
  </body>
</html>
```

**Create `e2e/ybc-embed.spec.ts`:**

```ts
import { expect, test, type Frame, type Page } from '@playwright/test';
import { projectDocumentSchema } from '../src/core/circuit/document';
import { ybcSolutionDocument, type YbcLessonKey } from '../src/samples/ybc-solutions';
import { ybcStarterDocument, type YbcTemplateKey } from '../src/samples/ybc-templates';

// N6a: the labs the LMS launches (`lab=`), in the lesson page of e2e/lesson-host.mjs, which records what the lab
// says over stem-lab/v1 and can answer it. Spec §12: open a Yolo:Bit lab, press Kiểm tra, receive check-result.

const lessonOrigin = 'http://lesson.localhost:5190';

/** The template as the lab opens it (templates.ts imports JSON, which Playwright's loader does not take). */
const starter = (key: YbcTemplateKey) => projectDocumentSchema.parse(ybcStarterDocument(key));

type Recorded = { origin: string; data: { protocol: string; type: string; [key: string]: unknown } };

const labUrl = (baseURL: string | undefined, query: string) => new URL(`/?embed=1&${query}`, baseURL).href;

async function openInLesson(page: Page, url: string): Promise<Frame> {
  const lesson = new URL('/lesson', lessonOrigin);
  lesson.searchParams.set('lab', url);
  await page.goto(lesson.href);
  const frame = await (await page.locator('iframe').elementHandle())?.contentFrame();
  if (!frame) {
    throw new Error('The lab iframe has no frame');
  }
  await frame.waitForFunction(() => window.__stem?.getCanvasState() != null);
  return frame;
}

const messages = (page: Page) => page.evaluate(() => (window as unknown as { __labMessages: Recorded[] }).__labMessages);
const messagesOfType = async (page: Page, type: string) => (await messages(page)).filter((message) => message.data.type === type);
const sendToLab = (page: Page, message: unknown, targetOrigin: string) =>
  page.evaluate(([data, origin]) => (window as unknown as { __sendToLab(m: unknown, o: string): void }).__sendToLab(data, origin), [message, targetOrigin] as const);

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

test.describe('a Yolo:Bit lab in a lesson (stem-lab/v1)', () => {
  test('says ready, checks the starter (not passed), loads the host’s project and checks it (passed)', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const labOrigin = new URL(baseURL ?? '').origin;
    const frame = await openInLesson(page, labUrl(baseURL, `lab=yolobit&template=ybc-heart&origin=${encodeURIComponent(lessonOrigin)}&profile=ybc-basic`));

    // ready: the template, its profile and the goals, from the lab's origin.
    await expect.poll(() => messagesOfType(page, 'ready')).toEqual([
      {
        origin: labOrigin,
        data: { protocol: 'stem-lab/v1', type: 'ready', template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'shows-heart', label: 'Màn hình hiện hình trái tim' }] },
      },
    ]);

    // The lab's chrome, in Vietnamese: no New, a Check button, the goals.
    await expect(frame.getByRole('heading', { name: 'Mạch Yolo:Bit' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Mới' })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'New' })).toHaveCount(0);
    await expect(frame.getByTestId('goal-shows-heart')).toHaveAttribute('data-state', 'todo');
    await expect(frame.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'hiển thị hình' })).toBeVisible();
    await expect(frame.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'khi bắt đầu' })).toBeVisible();

    // The starter's heart is loose: the check runs it and does not pass.
    await frame.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect.poll(() => messagesOfType(page, 'check-result'), { timeout: 10_000 }).toHaveLength(1);
    expect((await messagesOfType(page, 'check-result'))[0]?.data).toEqual({
      protocol: 'stem-lab/v1',
      type: 'check-result',
      passed: false,
      goals: [{ id: 'shows-heart', label: 'Màn hình hiện hình trái tim', passed: false }],
    });
    await expect(frame.getByTestId('goal-shows-heart')).toHaveAttribute('data-state', 'failed');
    await expect(frame.getByTestId('challenge-status')).toHaveText('Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.');
    // The check's run stops, then its result follows; opening the template changed nothing, so no project-changed.
    expect((await messages(page)).map((message) => message.data.type)).toEqual(['ready', 'run-started', 'run-stopped', 'check-result']);

    // The host sends the learner's saved project (the finished heart); the lab opens it.
    const solution = ybcSolutionDocument('ybc-heart');
    await sendToLab(page, { protocol: 'stem-lab/v1', type: 'load-project', document: solution }, labOrigin);
    await expect.poll(() => frame.evaluate(() => window.__stem?.getProject())).toEqual(solution);

    await frame.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect.poll(() => messagesOfType(page, 'check-result'), { timeout: 10_000 }).toHaveLength(2);
    expect((await messagesOfType(page, 'check-result'))[1]?.data).toMatchObject({ passed: true, goals: [{ id: 'shows-heart', passed: true }] });
    await expect(frame.getByTestId('goal-shows-heart')).toHaveAttribute('data-state', 'passed');
    await expect(frame.getByTestId('challenge-status')).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.');

    // The loaded project went back to the host, debounced, as a project-changed.
    await expect.poll(() => messagesOfType(page, 'project-changed'), { timeout: 5_000 }).not.toHaveLength(0);
    expect((await messagesOfType(page, 'project-changed')).at(-1)?.data.document).toMatchObject({ id: 'template-ybc-heart', profile: 'ybc-basic' });
    expect(errors).toEqual([]);
  });

  test('talks to no other origin: a lab launched for another page sends nothing here and ignores this page', async ({ page, baseURL }) => {
    const errors = collectErrors(page);
    const labOrigin = new URL(baseURL ?? '').origin;
    const frame = await openInLesson(page, labUrl(baseURL, `lab=yolobit&template=ybc-heart&origin=${encodeURIComponent('http://other.localhost:5190')}`));

    await sendToLab(page, { protocol: 'stem-lab/v1', type: 'load-project', document: ybcSolutionDocument('ybc-heart') }, labOrigin);
    await frame.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(frame.getByTestId('challenge-status')).toHaveText('Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.', { timeout: 10_000 });

    // The browser dropped every message addressed to the other origin; the lab kept its template.
    expect(await messages(page)).toEqual([]);
    expect(await frame.evaluate(() => window.__stem?.getProject())).toEqual(starter('ybc-heart'));
    expect(errors).toEqual([]);
  });

  test('a Blockly lab checks the finished Blink and passes', async ({ page, baseURL }) => {
    const frame = await openInLesson(page, labUrl(baseURL, `lab=blockly&template=blink&origin=${encodeURIComponent(lessonOrigin)}`));

    await expect(frame.getByRole('heading', { name: 'Lập trình khối' })).toBeVisible();
    await expect(frame.getByTestId('blockly-panel').locator('.blocklyText', { hasText: 'lặp mãi mãi' })).toBeVisible();
    await frame.getByRole('button', { name: 'Kiểm tra' }).click();

    await expect.poll(() => messagesOfType(page, 'check-result'), { timeout: 10_000 }).toHaveLength(1);
    expect((await messagesOfType(page, 'check-result'))[0]?.data).toMatchObject({
      passed: true,
      goals: [
        { id: 'led-blinks', passed: true },
        { id: 'uses-wait', passed: true },
      ],
    });
  });
});

test.describe('a lab opened on its own (a new tab)', () => {
  for (const key of ['ybc-heart', 'ybc-button-ab', 'ybc-night-light', 'ybc-melody'] as const satisfies readonly YbcLessonKey[]) {
    test(`checks ${key}: the starter does not pass, the finished program does`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/?embed=1&lab=yolobit&template=${key}&origin=${encodeURIComponent(lessonOrigin)}`);
      await page.waitForFunction(() => window.__stem?.getCanvasState() != null);
      const status = page.getByTestId('challenge-status');

      await page.getByRole('button', { name: 'Kiểm tra' }).click();
      await expect(status).toHaveText(/^Chưa đạt/, { timeout: 10_000 });

      await page.evaluate((document) => window.__stem?.loadProject(document), ybcSolutionDocument(key));
      await page.getByRole('button', { name: 'Kiểm tra' }).click();
      await expect(status).toHaveText('Đạt! Bạn đã hoàn thành mọi mục tiêu.', { timeout: 10_000 });
      await expect(page.getByTestId('run-status')).toHaveText('Chưa chạy');
      expect(errors).toEqual([]);
    });
  }

  test('Stop during a check ends it without a result; Reset asks twice, then brings the template back', async ({ page }) => {
    await page.goto(`/?embed=1&lab=yolobit&template=ybc-melody`);
    await page.waitForFunction(() => window.__stem?.getCanvasState() != null);

    await page.getByRole('button', { name: 'Kiểm tra' }).click();
    await expect(page.getByRole('button', { name: 'Đang kiểm tra…' })).toBeDisabled();
    await page.getByRole('button', { name: 'Dừng' }).click();
    await expect(page.getByRole('button', { name: 'Kiểm tra' })).toBeEnabled();
    await expect(page.getByTestId('goal-a-plays-notes')).toHaveAttribute('data-state', 'todo');

    await page.evaluate((document) => window.__stem?.loadProject(document), ybcSolutionDocument('ybc-melody'));
    await page.getByRole('button', { name: 'Đặt lại' }).click();
    await expect(page.getByRole('button', { name: 'Bấm lần nữa để đặt lại' })).toBeVisible();
    expect(await page.evaluate(() => window.__stem?.getProject())).toEqual(ybcSolutionDocument('ybc-melody'));
    await page.getByRole('button', { name: 'Bấm lần nữa để đặt lại' }).click();
    await expect.poll(() => page.evaluate(() => window.__stem?.getProject())).toEqual(starter('ybc-melody'));
  });

  test('a broken lab launch says so in Vietnamese and lists that lab’s templates', async ({ page }) => {
    await page.goto('/?embed=1&lab=blockly&template=ybc-heart');

    const error = page.getByTestId('launch-error');
    await expect(error).toContainText('Không mở được bài thực hành này.');
    await expect(error).toContainText('The template "ybc-heart" does not open in lab=blockly.');
    await expect(error).toContainText('Các mẫu được hỗ trợ: blink, led-on, button-direct, button-led, empty.');
  });
});
```

- [ ] **Step 2: Run the whole E2E suite**

Run: `pnpm e2e`

Expected: `126 passed`, `4 failed` — the 4 failures are exactly the pre-existing macOS ones in `e2e/ybc-python.spec.ts` (lines 178, 186, 195, 204; see "Môi trường"). Any other failure is a regression of this plan: fix it before committing.

- [ ] **Step 3: Run the tests and the whole gate**

Run: `pnpm e2e e2e/ybc-embed.spec.ts`

Expected: `9 passed`.

Run: `pnpm verify`

Expected: typecheck and lint print nothing after their `$` lines; `Test Files  135 passed`, `Tests  4377 passed | 1 skipped`. If the only failures are wall-clock tests that predate N6a (`src/core/program/ybc-heavy-expression.test.ts` "longest gap stays small" / "stopped promptly", `ybc-responsiveness.test.ts`, or a 5 s timeout in `editor-blocks.test.ts`), the machine is busy: run `pnpm test` again when it is idle. Any other failure is real.

- [ ] **Step 4: Commit**

```bash
git add e2e/lesson-host.mjs e2e/ybc-embed.spec.ts
git commit -m "$(cat <<'EOF'
test(n6a): drive stem-lab/v1 end to end in the lesson page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

### Task 10: Contract doc and plan updates (§15)  — `model: sonnet`

`docs/lab-embed-contract.md` là hợp đồng duy nhất (spec §7). Theo working agreement §15: ghi mở rộng scope và evidence vào `docs/stem-demo-implementation-plan.md` (bảng §9.1, mục N6a ở §9.2, Learning log §17) và `docs/yolobit-compatible-board-implementation-plan.md` (§2 non-goals, §14 key bài học, §17.1, YB-6, §23).

**Files:**
- Create: `docs/lab-embed-contract.md`
- Modify: `docs/stem-demo-implementation-plan.md`
- Modify: `docs/yolobit-compatible-board-implementation-plan.md`

**Interfaces:**
- Consumes: everything above (names, keys, messages, rulings R1–R16).
- Produces: documentation only.

- [ ] **Step 1: Write the contract and update the plans**

**Create `docs/lab-embed-contract.md`:**

```markdown
# Lab embed contract (`stem-lab/v1`)

Hợp đồng **duy nhất** giữa STEM Studio (repo này, một sản phẩm độc lập) và trang nhúng nó (hiện tại là app `learn`
của STEMLearning: `BlocklyLab`, `YolobitLab`). Hai bên không import code của nhau, không dùng chung package, token
hay font. Mọi thứ đi qua **launch URL** và **message `stem-lab/v1`** dưới đây. Code: `src/ui/app/launch.ts`
(URL), `src/ui/app/host-bridge.ts` (message), `src/ui/app/lab-host.ts` (nối store với bridge),
`src/samples/templates.ts` + `src/samples/challenges.ts` (template và mục tiêu). Phía host:
`STEMLearning/Web/apps/learn/src/features/player/activities/lab/` (`lab-launch.ts`, `lab-protocol.ts`,
`useLabBridge.ts`).

## 1. Launch URL

| URL | Kết quả |
|---|---|
| không có `embed`, `template`, `lab` | Editor standalone, như trước. Tham số khác bị bỏ qua |
| `?embed=1&template=<key>` | Lab S1 (legacy, cho `StemLab` cũ): mọi key, tiếng Anh, có nút New, **không** bridge, **không** Kiểm tra. `profile`, `origin` bị bỏ qua |
| `?embed=1&lab=blockly&template=<key>[&origin=<o>]` | Lab "Lập trình khối": chỉ key generic |
| `?embed=1&lab=yolobit&template=<key>[&profile=<p>][&origin=<o>]` | Lab "Mạch Yolo:Bit": chỉ key `ybc-*`; `profile` = `ybc-basic` \| `ybc-advanced` (thiếu thì dùng profile của template, `ybc-basic`) |

- **Key** (so khớp chính xác, phân biệt hoa thường; không bao giờ đổi tên hay tái dùng):
  - Blockly: `blink`, `led-on`, `button-direct`, `button-led`, `empty`.
  - Yolo:Bit: `ybc-heart`, `ybc-button-ab`, `ybc-night-light`, `ybc-melody`, `ybc-empty`.
  - Khớp với `LabTemplateCatalog.DefaultBlockly` / `DefaultYolobit` của CourseService.
- **`origin`**: origin của trang nhúng, viết đúng như trình duyệt serialize (`scheme://host[:port]`, không path,
  không `/` cuối; vd. `http://localhost:3000`). Lab chỉ nói chuyện với origin này. Thiếu `origin` thì lab vẫn chạy
  (mở ở tab mới), chỉ là không gửi message nào.
- **Launch hỏng** → màn hình lỗi (tiếng Việt với `lab=`), không mở project nào: `lab` lạ hoặc lặp; key lạ, thiếu,
  lặp; key không thuộc `lab` (vd. `lab=blockly&template=ybc-heart`); `profile` lặp, lạ, hoặc có với `lab=blockly`;
  `origin` lặp hoặc không phải một page origin (`*`, `null`, có path, có `/` cuối, port mặc định viết ra…).
  Lý do (tiếng Anh, cho người viết URL) và danh sách key của lab đó được hiện ra.
- **Ngôn ngữ**: `lab=` → tiếng Việt; standalone và lab S1 → tiếng Anh. `lang=vi|en` ghi đè.
- **Lab không lưu gì** trong trình duyệt (như S1): mỗi lần mở là template mới. Bài làm được giữ bởi host (xem
  `project-changed` / `load-project`).

## 2. Message

Mọi message là object JSON có `protocol: "stem-lab/v1"` và `type`. Lab gửi bằng
`window.parent.postMessage(msg, origin)`, **không bao giờ** `'*'`. Lab chỉ nhận message có `event.origin === origin`
**và** `event.source === window.parent`; mọi thứ khác bị bỏ qua. Bridge chỉ bật khi launch có `lab=`, có `origin`
hợp lệ và lab nằm trong một frame.

### Lab → host

| `type` | Trường | Khi nào |
|---|---|---|
| `ready` | `template: string`, `profile: string \| null`, `goals: { id, label }[]` | Một lần, khi lab đã mở template. `profile` là profile của project (null với lab Blockly). `goals` rỗng khi template không có challenge (`empty`, `ybc-empty`) |
| `run-started` | — | Một lượt chạy bắt đầu (Chạy, hoặc lượt chạy của Kiểm tra) |
| `run-stopped` | — | Lượt chạy kết thúc (Dừng, Đặt lại, hoặc Kiểm tra xong) |
| `check-result` | `passed: boolean`, `goals: { id, label, passed }[]` | Mỗi lần Kiểm tra xong. `passed` = mọi mục tiêu đạt. Đến **sau** `run-stopped` của lượt chạy đó. Kiểm tra bị huỷ (Dừng giữa chừng) thì không gửi |
| `project-changed` | `document` (project document, schema v1) | Sau mỗi thay đổi của project, debounce 1 giây (thay đổi cuối thắng); gửi ngay khi trang `pagehide`. Mở template không gửi gì |

- Tối đa 50 mục tiêu, nhãn 1–200 ký tự (host bỏ qua nguyên message nếu vượt). Nhãn theo ngôn ngữ của lab.
- Lab không có khái niệm XP, lớp, tiến độ hay hoàn thành: host tự quyết `requiresCheck` và lúc nào activity xong.

### Host → lab

| `type` | Trường | Lab làm gì |
|---|---|---|
| `load-project` | `document` | Mở project này thay template, nếu: editor mở được nó (schema, device, profile, program Blockly nạp được), đúng loại lab (project Yolo:Bit cho lab `yolobit`, generic cho lab `blockly`) và không có lượt chạy nào. Lab `yolobit` có `profile=` thì project mở với profile đó. Không hợp lệ → bỏ qua, không báo lỗi |

## 3. Kiểm tra (challenge)

- Mỗi template (trừ `empty`, `ybc-empty`) có một challenge: danh sách mục tiêu, thời lượng chạy (≤ 5 s) và kịch bản
  input (bấm nút A/B, kéo cảm biến ánh sáng, giữ nút bấm của mạch generic). Nút **Kiểm tra** chạy chương trình
  với kịch bản đó, chấm từng mục tiêu, rồi dừng. Chạy được cả khi không có host (mở ở tab mới).
- Loại mục tiêu (`src/core/challenge`): `display-shows` (màn hình 5×5 hiện một hình, có thể từ một thời điểm),
  `led-lit`, `led-blinks` (số lần đổi sáng/tắt), `buzzer-played` (số nốt), `console-contains`, `uses-block` (khối
  có trong chương trình và được chạy).
- Template Yolo:Bit là **bài khởi đầu**: board và chương trình, cùng một khối (hoặc chuỗi khối) đặt rời, bị vô hiệu
  hoá; học sinh kéo nó vào đúng chỗ thì đạt. Template generic là chương trình hoàn chỉnh (như S1): Kiểm tra đạt ngay.
- **Người soạn bài**: với `empty`/`ybc-empty` (không có mục tiêu), để `requiresCheck = false`.

## 4. Khung nhúng

- iframe của host: `sandbox="allow-scripts allow-same-origin allow-downloads"`. Không có `allow-modals`, nên lab
  không dùng `confirm()`: **Đặt lại** cần bấm hai lần.
- Host và lab phải cùng không gian địa chỉ (cùng localhost hoặc cùng public; Chromium Local Network Access).
- Lab tự host font (Be Vietnam Pro, OFL) và media Blockly; không tải gì từ trang nhúng hay CDN.

## 5. Phiên bản

`stem-lab/v1` chỉ được **thêm** trường hoặc `type` mới (bên nhận bỏ qua cái không biết). Đổi nghĩa hay bỏ trường
→ `stem-lab/v2`, và lab phải nói được cả hai trong thời gian chuyển tiếp.
```

**Edit `docs/stem-demo-implementation-plan.md`** (3 change(s), each `old` occurs exactly once):

**Replace in `docs/stem-demo-implementation-plan.md`** (1):

```markdown
| POC-14 | Local persistence | M4 | M | P1 | 03 (nên làm sau 11) | L7, B8 |
| S1 | Embed launch (cho CourseService) | — | S | — | 14 | B1, B8 |

Tổng cộng **14 task: 11 P0, 3 P1.** 23 hạng mục P2 nằm trong backlog §13. **S1** nằm ngoài roadmap PoC: nó là điều kiện của CourseService (T7, T9), không phải của hypothesis.

### 9.2 Chi tiết task
```

with:

```markdown
| POC-14 | Local persistence | M4 | M | P1 | 03 (nên làm sau 11) | L7, B8 |
| S1 | Embed launch (cho CourseService) | — | S | — | 14 | B1, B8 |
| N6a | Lab embedding (`lab=`, `stem-lab/v1`, Kiểm tra, tiếng Việt) | — | M | — | S1, YB-3 | B1, B2, B8 |

Tổng cộng **14 task: 11 P0, 3 P1.** 23 hạng mục P2 nằm trong backlog §13. **S1** nằm ngoài roadmap PoC: nó là điều kiện của CourseService (T7, T9), không phải của hypothesis. **N6a** cũng vậy: nó là phần stem-demo của bản demo LMS (plan redesign STEMLearning §7, S0–S5).

### 9.2 Chi tiết task
```

**Replace in `docs/stem-demo-implementation-plan.md`** (2):

```markdown
  - hiện tên project hay mode trên UI.

---

```

with:

```markdown
  - hiện tên project hay mode trên UI.

### N6a — Lab embedding (cho STEMLearning `BlocklyLab` / `YolobitLab`)

`Ngoài roadmap PoC · M · Phụ thuộc: S1, YB-3 · Yêu cầu: plan redesign STEMLearning §7 (S0–S5), hợp đồng ở docs/lab-embed-contract.md`

**Mở rộng scope (§15).** S1 đã để `postMessage`, completion và thiết kế lại UI lab ra ngoài; YB plan §2 ghi `postMessage`/chấm bài/i18n là non-goal. N6a đưa chúng vào, có giới hạn: lab **báo** việc nó làm (`ready`, chạy/dừng, `check-result`, `project-changed`) và nhận `load-project`; nó **không** biết XP, lớp, tiến độ hay hoàn thành (host quyết). Standalone, lab S1 legacy và đường compile → IR → MicroPython không đổi.

**Đã làm**
- **S0** `launch.ts`: `lab=blockly|yolobit`, `profile=` (chỉ `yolobit`), `origin=` (page origin chính xác). Sai cặp → `LaunchError` liệt kê key của lab đó. Thiếu `lab` → S1 như cũ (giờ nhận cả key `ybc-*`).
- **S1** `ybc-templates.ts`: `ybc-heart`, `ybc-button-ab`, `ybc-night-light`, `ybc-melody`, `ybc-empty`; là **bài khởi đầu** (một khối rời bị vô hiệu hoá, học sinh kéo vào). Lời giải ở `ybc-solutions.ts` (chỉ test/E2E dùng). Không đọc chân header (net hở → `out-of-domain`, YB-4 #9).
- **S2** `src/core/challenge` (thuần TS, B1): `display-shows`, `led-lit`, `led-blinks`, `buzzer-played`, `console-contains`, `uses-block`; `runCheck` chạy qua `RunSession` (subscribe), có `inputScript` (P1 được kéo lên: không có nó thì `ybc-button-ab`/`ybc-night-light`/`ybc-melody`/`button-led` không chấm được). Challenge của từng template ở `src/samples/challenges.ts`.
- **S3** `host-bridge.ts` + `lab-host.ts`: `postMessage(msg, origin)`, không bao giờ `'*'`; chỉ nhận từ `window.parent` ở đúng origin; `project-changed` debounce 1 s; `load-project` (P1, nhưng host đã gửi nó) mở project nếu hợp lệ.
- **S4** chrome: tiêu đề theo lab, ẩn New, nút Kiểm tra + danh sách mục tiêu, Đặt lại (bấm hai lần), layout co giãn (< 760 px xếp dọc).
- **S5** token CSS (`app.css`), Be Vietnam Pro tự host (`@fontsource/be-vietnam-pro` 5.3.0, OFL), theme Blockly Zelos (`theme.ts`), `blockly/msg/vi`, từ điển UI (`src/ui/i18n`), text block tiếng Việt phủ lên ở UI (core không đổi), một bảng màu canvas (`src/ui/canvas/colors.ts`, giá trị cũ).

**Evidence / quyết định**
- Host (STEMLearning `lab-protocol.ts`, đã ship) thắng spec khi lệch: URL luôn có `lab=` và `origin=`, `profile=ybc-basic|ybc-advanced` cho Yolo:Bit; `check-result.goals` mang `label`; host gửi `load-project` sau `ready`.
- Thứ tự key JSON: template viết đúng thứ tự Blockly lưu (`type, id, x, y, disabledReasons, fields, inputs, next`), nếu không lab gửi `project-changed` ngay khi mở dù không ai sửa gì (E2E bắt được).
- `src/ui/canvas/palette.ts` trùng tên với `Palette.tsx` trên ổ không phân biệt hoa thường (macOS): import `'./Palette'` trỏ nhầm sang `palette.ts`. Bảng màu đặt ở `colors.ts`.
- Playwright không nạp được JSON import không có `with { type: 'json' }`: E2E dựng template Yolo:Bit từ `ybc-templates.ts`, không import `templates.ts`.
- `check-result` đến sau `run-stopped` (lượt chạy dừng trước, kết quả tính xong sau).

**Chưa làm (có chủ đích)**
- Text của core (diagnostic compiler/runtime, lỗi nối dây trên canvas) vẫn tiếng Anh.
- Template Yolo:Bit cấp nâng cao riêng (`ybc-adv-*`, YB-8); bài B1–B10 của YB plan §14 (thay bằng 5 key trên).
- `BlocklyPanel` media dưới sub-path (`import.meta.env.BASE_URL`, S6, P2).
- CSP `frame-ancestors`, deploy.

---

```

**Replace in `docs/stem-demo-implementation-plan.md`** (3):

```markdown
| M2 | 2026-10-03 | L1, L2, L8 + go/no-go | Xem "M2 — chi tiết" bên dưới | L1 ✅ · L2 ✅ · L8 ⚠️ (mới có lần chạy của agent) · **GO** cho M3/M4 (reviewer xác nhận 2026-10-03) | Không đổi kiến trúc. Ghi nhận: lỗi tập trung ở chuyển trạng thái của thao tác chuột (UI), không ở model |
| M3 | 2026-10-03 | L3 (built-in), L5, L6 | Xem "M3 — chi tiết" bên dưới | L3 ✅ · L5 ✅ · L6 ✅ · L8 ⚠️ (chỉ có lần chạy của agent) | Không đổi kiến trúc. IR của `if` dùng danh sách nhánh; điều kiện bỏ trống là lỗi (C8) |
| M4 | 2026-10-03 | L7 (+ B8) | Xem "M4 — chi tiết" bên dưới | L7 ✅ · B8 ✅ · L8 ⚠️ (chỉ có lần chạy của agent) | Kiểm tra lúc load gồm cả I1–I3, registry, và program do Blockly phán sau một preflight giới hạn công việc (§6.1, §7). Không đổi kiến trúc |

```

with:

```markdown
| M2 | 2026-10-03 | L1, L2, L8 + go/no-go | Xem "M2 — chi tiết" bên dưới | L1 ✅ · L2 ✅ · L8 ⚠️ (mới có lần chạy của agent) · **GO** cho M3/M4 (reviewer xác nhận 2026-10-03) | Không đổi kiến trúc. Ghi nhận: lỗi tập trung ở chuyển trạng thái của thao tác chuột (UI), không ở model |
| M3 | 2026-10-03 | L3 (built-in), L5, L6 | Xem "M3 — chi tiết" bên dưới | L3 ✅ · L5 ✅ · L6 ✅ · L8 ⚠️ (chỉ có lần chạy của agent) | Không đổi kiến trúc. IR của `if` dùng danh sách nhánh; điều kiện bỏ trống là lỗi (C8) |
| N6a | 2026-10-16 | Lab nhúng cho LMS có chấm bài được không mà không đưa logic LMS vào stem-demo? | Mục N6a ở §9.2; `pnpm verify`; `e2e/ybc-embed.spec.ts` | ✅ Challenge là dữ liệu template + evaluator thuần trong core, bridge chỉ ở UI | Scope mở rộng có ghi (§9.2 N6a); quy ước ngôn ngữ UI đổi (CLAUDE.md) |
| M4 | 2026-10-03 | L7 (+ B8) | Xem "M4 — chi tiết" bên dưới | L7 ✅ · B8 ✅ · L8 ⚠️ (chỉ có lần chạy của agent) | Kiểm tra lúc load gồm cả I1–I3, registry, và program do Blockly phán sau một preflight giới hạn công việc (§6.1, §7). Không đổi kiến trúc |

```

**Edit `docs/yolobit-compatible-board-implementation-plan.md`** (5 change(s), each `old` occurs exactly once):

**Replace in `docs/yolobit-compatible-board-implementation-plan.md`** (1):

```markdown
  - list (trừ khi YB-7 đủ điều kiện, NICE);
  - **event block, nếu gate EV không đạt** (§6.6).
- `postMessage`/chấm bài/completion mới; lưu bài làm trong lab nhúng.
- Viết lại i18n; layout mobile đầy đủ.
- Bluetooth, Wi-Fi, MQTT, radio, IoT; module cần thư viện ngoài firmware chuẩn.
- Robot simulator.
```

with:

```markdown
  - list (trừ khi YB-7 đủ điều kiện, NICE);
  - **event block, nếu gate EV không đạt** (§6.6).
- `postMessage`/chấm bài/completion mới; lưu bài làm trong lab nhúng. *(N6a, 2026-10-16: đã làm ngoài plan này, theo plan redesign STEMLearning §7: `stem-lab/v1`, Kiểm tra, `load-project`/`project-changed`; lab vẫn không lưu gì. Xem docs/lab-embed-contract.md và stem-demo plan §9.2 N6a.)*
- Viết lại i18n; layout mobile đầy đủ. *(N6a: lab `lab=` nói tiếng Việt qua từ điển UI; standalone giữ tiếng Anh.)*
- Bluetooth, Wi-Fi, MQTT, radio, IoT; module cần thư viện ngoài firmware chuẩn.
- Robot simulator.
```

**Replace in `docs/yolobit-compatible-board-implementation-plan.md`** (2):

```markdown
**Bài học** (key đề xuất, freeze ở YB-6). YB-0 đã thay/bỏ những bài phụ thuộc construct bị loại. Hình và nốt trong bài là **tự làm** (§6.8).

| Bài | Key | Nội dung (sau YB-0) | Construct | Ghi chú YB-0 |
|---|---|---|---|---|
```

with:

```markdown
**Bài học** (key đề xuất, freeze ở YB-6). YB-0 đã thay/bỏ những bài phụ thuộc construct bị loại. Hình và nốt trong bài là **tự làm** (§6.8).

> **N6a (2026-10-16):** key đã ship cho STEMLearning là `ybc-heart`, `ybc-button-ab`, `ybc-night-light`, `ybc-melody`, `ybc-empty` (CourseService `LabTemplateCatalog`), thay cho danh sách đề xuất dưới đây; các bài còn lại là backlog của YB-6. B9 vẫn chờ quyết định của owner.

| Bài | Key | Nội dung (sau YB-0) | Construct | Ghi chú YB-0 |
|---|---|---|---|---|
```

**Replace in `docs/yolobit-compatible-board-implementation-plan.md`** (3):

```markdown
### 17.1 Không đổi
`?embed=1&template=<key>`; lỗi key lạ; lab không lưu (Q10); `OnView` (Q7); không `postMessage`; không thêm quyền iframe.

### 17.2 Thêm
```

with:

```markdown
### 17.1 Không đổi
`?embed=1&template=<key>`; lỗi key lạ; lab không lưu (Q10); `OnView` (Q7); không `postMessage`; không thêm quyền iframe.

> **N6a (2026-10-16):** phần "không `postMessage`" và `OnView` chỉ còn đúng cho URL S1 trên. Launch `lab=blockly|yolobit` (thêm `profile=`, `origin=`) có `stem-lab/v1` và Kiểm tra; host STEMLearning hoàn thành activity bằng `check-result` (`OnCheck`). Hợp đồng: docs/lab-embed-contract.md.

### 17.2 Thêm
```

**Replace in `docs/yolobit-compatible-board-implementation-plan.md`** (4):

```markdown
    - diagnostic bằng construct đã có (vd. xoá board → `no-board`, dữ liệu trộn family → `incompatible-devices`).
- **Acceptance:** key Basic freeze và mở đúng; lab không lưu; GB xanh; UI chọn profile đạt các điểm trên; bàn giao danh sách key cho STEMLearning. **Không** đòi construct Advanced thật chạy hay sinh code (round-trip hạ profile thật thuộc YB-7).
- **Out-of-scope:** `postMessage`, sửa repo STEMLearning.
- **Dependencies:** YB-5B; OQ-A trước khi ship ra lesson.

```

with:

```markdown
    - diagnostic bằng construct đã có (vd. xoá board → `no-board`, dữ liệu trộn family → `incompatible-devices`).
- **Acceptance:** key Basic freeze và mở đúng; lab không lưu; GB xanh; UI chọn profile đạt các điểm trên; bàn giao danh sách key cho STEMLearning. **Không** đòi construct Advanced thật chạy hay sinh code (round-trip hạ profile thật thuộc YB-7).
- **Out-of-scope:** `postMessage`, sửa repo STEMLearning. *(N6a đã làm `postMessage` và 5 key `ybc-*` cho STEMLearning; YB-6 còn lại: bài B1–B10, UI chọn profile ở standalone.)*
- **Dependencies:** YB-5B; OQ-A trước khi ship ra lesson.

```

**Replace in `docs/yolobit-compatible-board-implementation-plan.md`** (5):

```markdown
- Số thực, đếm xuống, list (nếu YB-7 chưa đủ điều kiện), `break`/`continue`.
- **Event**, nếu gate EV không đạt.
- `postMessage`/chấm bài/lưu bài làm trong lab; i18n.
- Module cần thư viện; giao tiếp; game; nhiều board.
- Màu/độ sáng display (nếu chưa qua EG); layout mobile.
```

with:

```markdown
- Số thực, đếm xuống, list (nếu YB-7 chưa đủ điều kiện), `break`/`continue`.
- **Event**, nếu gate EV không đạt.
- ~~`postMessage`/chấm bài~~ (N6a); lưu bài làm trong lab (host giữ, lab không lưu); i18n ngoài lab `lab=`.
- Module cần thư viện; giao tiếp; game; nhiều board.
- Màu/độ sáng display (nếu chưa qua EG); layout mobile.
```

- [ ] **Step 2: Check that the codegen path is untouched**

Run: `git diff --stat master -- src/core/program src/core/codegen`

Expected: no output.

- [ ] **Step 3: Run the gate**

Run: `pnpm verify`

Expected: `Test Files  135 passed`, `Tests  4377 passed | 1 skipped`.

- [ ] **Step 4: Commit**

```bash
git add docs/lab-embed-contract.md docs/stem-demo-implementation-plan.md docs/yolobit-compatible-board-implementation-plan.md
git commit -m "$(cat <<'EOF'
docs(n6a): write the lab embed contract and record N6a in the plans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```


---

## Self-review (spec → task)

| Spec | Task |
|---|---|
| §7 S0 `lab` + `profile`, sai cặp → `LaunchError`, thiếu `lab` = cũ, tiêu đề theo loại, test `parseLaunch` | 2 (tiêu đề ở 7) |
| §7 S1 `ybc-heart`, `ybc-button-ab`, `ybc-night-light`, `ybc-melody`, `ybc-empty`, profile, không đọc chân header | 1 |
| §7 S2 `src/core/challenge`, 6 loại goal, evaluator qua `RunSession.subscribe`, `{passed, goals:[{id,label,passed}]}`, `inputScript`, Vitest từng loại | 3, 4 |
| §7 S3 `host-bridge.ts`, chỉ khi embed + origin hợp lệ, 5 message lab → host, `load-project`, không `'*'`, bỏ qua origin lạ | 6 (check-result nối ở 7) |
| §7 S4 ẩn New, Kiểm tra + checklist, Chạy/Dừng/Đặt lại, layout co giãn | 7 |
| §7 S5 CSS variables, Be Vietnam Pro tự host, theme Zelos, `blockly/msg/vi`, gom màu Konva, từ điển UI, text block không import UI vào core, cập nhật CLAUDE.md | 8, 5 |
| §7 S6 `BASE_URL` (P2) | hoãn |
| §7 `docs/lab-embed-contract.md`, cập nhật 2 plan theo §15 | 10 |
| §9 bước 4 "kéo thả → Chạy → Kiểm tra → Đạt" (Blockly + Yolo:Bit "Trái tim") | 1 (bài khởi đầu), 7, 9 |
| §11 giới hạn YBC (chỉ màn hình, A/B, ánh sáng, loa) | 1, 4 |
| §12 `pnpm verify`; `e2e/ybc-embed.spec.ts` với `lesson-host.mjs` ghi message, assert `check-result.passed`; origin bị từ chối khi đổi `origin=` | mọi task; 9 |
| "Quyết định đã chốt": stem-demo độc lập, chỉ URL + postMessage có version, không logic LMS, standalone + MicroPython giữ nguyên | Global Constraints; 10 bước kiểm codegen |

## Deferred (ghi lại, không làm ở N6a)

> **N8s (2026-10-17, `docs/superpowers/plans/2026-10-17-n8s-lab-polish.md`)** đã làm: diagnostic của core, lỗi nối
> dây và nhãn Konva bằng tiếng Việt (lab `lab=`); S6 media Blockly theo `BASE_URL`; 4 E2E `ybc-python` trên macOS;
> flake thời gian (đo CPU time). Còn lại: N6b, template nâng cao, CSP/deploy.

- **N6b (STEMLearning):** preview `LabFrame` trong editor CMS (sau N5); chặn `requiresCheck=true` với `empty`/`ybc-empty` (R7).
- Diagnostic của core (compiler/runtime) và lỗi nối dây trên canvas vẫn tiếng Anh; nhãn Konva lấy từ device definition ("Bit-compatible Board", "Light", "Buzzer") vẫn tiếng Anh.
- S6: media Blockly dưới sub-path (`import.meta.env.BASE_URL` trong `BlocklyPanel.tsx`), P2.
- Template Yolo:Bit nâng cao riêng (`ybc-adv-*`, YB-8) và bài B1–B10 còn lại (YB-6); UI chọn profile ở standalone (YB-6).
- 4 E2E `ybc-python.spec.ts` fail sẵn trên macOS; flake thời gian `ybc-heavy-expression.test.ts`.
- CSP `frame-ancestors`, deploy (spec §10).
