# Kiểm chứng lại một lần chấm robot đã lưu (`pnpm verify:attempt`)

N18 R8a (robot plan §R8). Lab robot chấm trong trình duyệt của học sinh, nên STEMLearning chỉ kiểm **hình dạng** của kết quả nó nhận
(`LabAttemptRules`: khoảng giá trị, `passed` khớp với goal và variant). Script `scripts/verify-attempt.mjs` là bước kiểm chứng: nó lấy một
`LabAttempt` đã lưu, **chạy lại** lần chấm headless bằng đúng phép chấm của lab (`checkRobot`, `src/core/scenario/check-robot.ts`) trên
project đã lưu, rồi so từng con số. Phép chấm là tất định (cùng tick headless, ở 1× và 4×, trên mọi engine JS; plan §3), nên chạy lại một
lần chấm trung thực cho **đúng** kết quả của nó. Đây là nền cho một bộ kiểm chứng phía server sau này.

Phần lõi (không framework) là `src/core/scenario/verify-attempt.ts`; test: `tests/verify-attempt.test.ts`.

## 1. Cách chạy (giáo viên, admin)

```sh
pnpm verify:attempt attempts.json          # một dòng mỗi lần chấm
pnpm verify:attempt attempts.json --json   # kết quả cho máy đọc
cat attempts.json | pnpm verify:attempt -  # đọc từ stdin
```

Chạy từ thư mục `stem-demo` của **đúng bản build** đang phục vụ lab (cùng scenario, cùng engine). Cần Node ≥ 20.19 và `pnpm install`; không
cần trình duyệt, không cần arduino-cli. Script nạp source TypeScript qua SSR loader của Vite (như `export:robot-manifest`) và dùng bản Rapier
`-compat` cho Node (cùng wasm với bản của app, cùng kết quả: `tests/robot-determinism.test.ts`). Một lần chấm của scenario dài nhất
(`rb-line-follow`, 3 × 120 s mô phỏng) mất khoảng 10 s; phần lớn các scenario dưới 2 s.

### Đầu vào

Một lần chấm, hoặc **danh sách** các lần chấm của một học sinh, **cũ nhất trước**. Mỗi lần chấm là `LabAttemptDto` của API (camelCase) của
một lab robot, cộng project trong `projectJson` (cột `ProjectJson` của entity; DTO của API không gửi project, chỉ có `hasProject`):

```json
{
  "id": 41, "labKind": 2, "templateKey": "rb-mini-mission", "templateVersion": 1, "engine": "robot-engine@1",
  "passed": true, "score": 96, "maxScore": 100, "simTimeMs": 45000,
  "goals": [{ "id": "reach-dock", "label": "…", "passed": true }],
  "variants": [{ "seed": 3225, "passed": true, "score": 96, "simTimeMs": 45000 }],
  "programHash": "3f0a…", "projectJson": "{\"schemaVersion\":1, …}"
}
```

Các trường khác (`lessonId`, `passing`, `hasProject`, `createdAt`…) được chấp nhận và bỏ qua. LMS chỉ lưu project khi chương trình **đổi** so
với lần chấm trước của hoạt động đó (`LabAttemptRules.KeepsProject`), nên trong một danh sách, lần chấm không có project lấy project của
**lần chấm hợp lệ gần nhất trước nó** có cùng `programHash` và cùng `templateKey`. Không bao giờ lấy của lần chấm sau.

Lấy dữ liệu từ database của LearningService (Postgres), ví dụ cho một học sinh và một hoạt động (kiểm lại tên cột với migration
`AddLabAttempts` của bản đang chạy):

```sql
SELECT json_agg(json_build_object(
         'id', "Id", 'labKind', "LabKind", 'templateKey', "TemplateKey", 'templateVersion', "TemplateVersion",
         'engine', "Engine", 'passed', "Passed", 'score', "Score", 'maxScore', "MaxScore", 'simTimeMs', "SimTimeMs",
         'goals', "GoalsJson", 'variants', "VariantsJson", 'programHash', "ProgramHash", 'projectJson', "ProjectJson")
       ORDER BY "Id")
FROM "LearningService"."LabAttempts"
WHERE "EnrollmentId" = 123 AND "ActivityId" = 45 AND NOT "IsDeleted";
```

`GoalsJson` và `VariantsJson` là jsonb với khoá camelCase (`JsonExtensions.ToJson`), nên đi thẳng vào được. Project cũ có thể đã bị xoá theo
chính sách giữ 20 project mới nhất (`LabAttemptQueries.TrimProjects`): lần chấm đó thành `no-project`.

## 2. Kết quả

| Trạng thái | Exit code | Nghĩa |
|---|---|---|
| `match` | 0 (khi **mọi** lần chấm match) | Chạy lại cho đúng mọi con số của lần chấm |
| `mismatch` | 1 | Có trường khác: in từng trường, giá trị của lần chấm và giá trị chạy lại |
| `unverifiable` | 2 | Bản build này không kết luận được, kèm một `reason` |

Với một danh sách: có một `mismatch` thì exit 1 (mismatch quan trọng hơn), không có mismatch nhưng có `unverifiable` thì exit 2. Lỗi dùng
lệnh (thiếu file, file không đọc được, tuỳ chọn lạ) cũng là exit 2.

**So sánh** (`mismatch` khi khác bất kỳ cái nào): `programHash` (phải là `hashProgramIr` của IR của project đã lưu; LMS lưu chữ thường, nên so
không phân biệt hoa thường), `passed`, `score` (bằng **chính xác**), `simTimeMs`, `passed` của từng goal theo `id`, và với từng variant `seed`,
`passed`, `score`, `simTimeMs`. Nhãn của goal không so (nó theo ngôn ngữ của lab).

**Lý do của `unverifiable`:**

| `reason` | Khi nào | Nên làm |
|---|---|---|
| `invalid-attempt` | Đầu vào không qua schema Zod hoặc giới hạn của LMS (xem §4); kèm `problems` (`đường dẫn: lỗi`) | Sửa file xuất |
| `unknown-key` | Bản build không có scenario có điểm mang `templateKey` (key lạ, hoặc `rb-sandbox` không có điểm) | Dùng đúng bản build |
| `scenario-version` | `templateVersion` khác version scenario của bản build: scenario đã đổi | Chạy bằng bản build có version đó |
| `engine` | `engine` khác `robot-engine@<ROBOT_ENGINE_VERSION>` của bản build | Chạy bằng bản build có engine đó |
| `seed-mismatch` | Seed của các variant (thứ tự và số lượng) khác seed của scenario (`variantOffsets`). Lab không bao giờ báo seed khác, nên đây là **dấu hiệu bị sửa** | Xem như đáng ngờ |
| `no-project` | Lần chấm không có project, và không có lần chấm hợp lệ nào trước nó cùng hash và key có project | Xuất kèm lần chấm cũ hơn, hoặc không kiểm được |
| `project-invalid` | Project không phải JSON, không qua schema document, hoặc không compile (L-1 đến L-3, luật chân của kit) | Xem như đáng ngờ |
| `rerun-failed` | Bản build không dựng được world hoặc scorer: lỗi của bản build, không phải của lần chấm | Báo lỗi |

Ví dụ (văn bản):

```text
attempt 1 (id 41, rb-mini-mission): match
attempt 2 (id 42, rb-mini-mission): MISMATCH
  score: attempt 97, re-run 96
attempt 3 (id 43, rb-mini-mission): UNVERIFIABLE seed-mismatch: the attempt’s variant seeds [3225, 3226, 3228] are not the scenario’s [3225, 3226, 3227]
attempt 4 (id 44, rb-mini-mission): match (the project of attempt 1)
```

Với `--json`: một object cho một lần chấm, một mảng cho một danh sách; mỗi phần tử
`{ index, id?, templateKey?, status, reason?, detail?, problems?, diffs?: [{ field, attempt, rerun }], projectFrom? }`
(`index` và `projectFrom` đếm từ 0).

## 3. Nó chứng minh gì, và không chứng minh gì

- **`match` chứng minh**: chương trình trong project đã lưu, chạy trong scenario này (đúng version, đúng seed, đúng engine), **đạt đúng** kết
  quả đó. Không ai sửa điểm, sửa variant hay ghép một project khác vào kết quả.
- **`match` không chứng minh** học sinh tự viết chương trình: một chương trình chép của bạn, hay do người khác viết hộ, cũng match. Nó cũng
  không nói gì về chất lượng bài học ngoài các goal của scenario (một chương trình "lách" goal mà vẫn qua thì match, xem quy tắc 10 của
  `docs/robot-scenario-authoring.md`).
- **`mismatch`** là bằng chứng kết quả gửi lên không phải của project đó (bị sửa, hoặc một lỗi của lab cần điều tra). Nó không nói ai sửa.
- **`unverifiable`** không phải là gian lận: phần lớn là khác bản build (`scenario-version`, `engine`) hoặc thiếu project. Riêng
  `seed-mismatch` và `project-invalid` đáng ngờ, vì lab không bao giờ tự tạo ra chúng.

## 4. Đầu vào không tin được

File xuất do người đưa vào, nên `verify-attempt.ts` đọc nó bằng Zod **trước** mọi việc khác, với chính giới hạn của LMS
(`LabAttemptRules`): project tối đa 262 144 byte UTF-8, tối đa 10 variant, 1–20 goal, mọi số hữu hạn (JSON `1e999` là `Infinity`: bị từ
chối), `maxScore` 100, `score` 0–100, `simTimeMs` là số ms nguyên 0–3 600 000, `programHash` 1–64 chữ số hex, `engine` theo mẫu của LMS. Chỉ
giữ các trường kể trên (một khoá `__proto__` chỉ là dữ liệu). Project được `JSON.parse` rồi kiểm bằng schema document như mọi project;
**không có gì được eval**. Một danh sách tối đa 500 lần chấm (`MaxAttemptsPerActivity`), file tối đa 32 MiB.
