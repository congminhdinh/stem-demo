# STEM Studio PoC — Chạy trên máy local

PoC chạy hoàn toàn trong trình duyệt: Vite phục vụ một app React, project được lưu trong IndexedDB của trình duyệt. Không cần backend, database server hay file `.env`.

## Yêu cầu

- **Node.js ≥ 20.19.0**, theo `engines` trong `package.json`. Repo không pin một version Node cụ thể (không có `.nvmrc`).
- **pnpm qua Corepack.** Version được pin trong field `packageManager` của `package.json`, và Corepack dùng đúng version đó.
- **Chrome** hoặc một trình duyệt Chromium khác để mở app. E2E dùng Chromium do Playwright cài riêng.

## Cài đặt

```bash
corepack enable pnpm
pnpm install
```

Bước sau chỉ cần cho E2E, chạy một lần trên mỗi máy:

```bash
pnpm exec playwright install chromium
```

Trên Windows, `corepack enable` có thể báo `EPERM`; cách xử lý có trong [`README.md`](../README.md#setup).

## Chạy app

```bash
pnpm dev
```

Mở <http://localhost:5173>. Không cần build hay setup gì trước. Dừng server bằng `Ctrl+C` trong terminal.

Bản production:

```bash
pnpm build
pnpm preview
```

`pnpm build` ghi bản build vào `dist/`, còn `pnpm preview` phục vụ thư mục đó ở <http://localhost:4173>. Build có in cảnh báo chunk lớn hơn 500 kB; đó chỉ là cảnh báo, không phải lỗi.

## Kiểm tra nhanh

Lần đầu mở, khi storage còn trống, app hiện mạch mẫu **Blink**:

- canvas mạch ở bên trái (Board, Resistor, LED), Blockly ở bên phải, toolbar ở trên cùng;
- bấm **Run**: LED sáng 1 s rồi tắt 1 s, lặp lại, và status là `Running`;
- bấm **Stop**: LED tắt, status về `Idle`.

Kịch bản demo đầy đủ có trong [`stem-demo-demo-script.md`](stem-demo-demo-script.md).

## Persistence

- Mạch và program tự được lưu vào IndexedDB (database `stem-studio`) chưa tới một giây sau mỗi lần sửa; không có nút Save. Một thay đổi ngay trước khi reload có thể bị mất.
- Reload mở lại project được lưu gần nhất. Trạng thái chạy thì không được lưu, nên sau reload app luôn ở `Idle`.
- **New** tạo một project trống mới. Project cũ vẫn còn trong IndexedDB, nhưng chưa có UI để mở lại.
- Nếu dữ liệu đã lưu bị hỏng hoặc thuộc một version khác, app mở project mới và hiện thông báo "The saved project could not be opened, so a new project was started."
- Nếu trình duyệt không cho dùng IndexedDB, app mở mạch mẫu, hiện thông báo "Projects cannot be saved in this browser.", và không lưu gì trong phiên đó.
- Dữ liệu tách theo origin: `localhost:5173` (dev) và `localhost:4173` (preview) có storage riêng. Nhiều tab cùng origin thì ghi đè lên nhau; tab lưu sau cùng thắng.

### Về trạng thái sạch

Đóng các tab khác đang mở app, vì một tab còn mở sẽ ghi lại project của nó ở lần sửa kế tiếp. Sau đó chạy đoạn sau trong Console của DevTools, ở tab đang mở app:

```js
const request = indexedDB.deleteDatabase('stem-studio');
request.onsuccess = () => location.reload();
```

Trang tự reload và mở mạch mẫu Blink như lần chạy đầu. Muốn reset bản preview thì chạy đoạn này trên tab của port 4173. Lần đầu dán vào Console, Chrome có thể yêu cầu gõ `allow pasting` trước.

## Kiểm tra repo

| Command | Làm gì |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint, gồm các rule giữ boundary của kiến trúc |
| `pnpm test` | Unit test bằng Vitest, chạy trong Node, không cần trình duyệt |
| `pnpm test:watch` | Vitest ở watch mode |
| `pnpm build` | Build production vào `dist/` |
| `pnpm verify` | `typecheck` + `lint` + `test` |
| `pnpm e2e` | E2E bằng Playwright trên Chromium |

Khác nhau giữa dev run và E2E:

- `pnpm e2e` tự start dev server ở port 5173 (`--strictPort`) và tắt nó khi xong. Nếu port 5173 đã có server, Playwright dùng luôn server đó (trừ khi biến môi trường `CI` được đặt). Vì vậy server đó phải là `pnpm dev` của chính repo này.
- Mỗi E2E test chạy trong một browser context mới với storage trống, nên không đụng tới dữ liệu trong trình duyệt của bạn.
- Test fail để lại chi tiết trong `test-results/` (thư mục này đã được gitignore).

## Troubleshooting

- **Port 5173 đang bị chiếm.** `pnpm dev` báo "Port 5173 is in use, trying another one..." rồi chạy ở port kế tiếp (ví dụ 5174); hãy mở đúng URL nó in ra. Port khác là origin khác, nên sẽ không thấy project đã lưu ở 5173. Riêng `pnpm e2e` cần chính port 5173, nên phải tắt server đang giữ port đó.
- **Server cũ vẫn còn chạy.** Dừng nó bằng `Ctrl+C` trong terminal đã start nó. Nếu terminal đó không còn, tìm process đang giữ port, rồi chỉ dừng nếu đúng là server của repo này:
  - Windows: `netstat -ano | findstr :5173`
  - macOS/Linux: `lsof -i :5173`
- **Hiện thông báo "The saved project could not be opened…".** Dữ liệu cũ hoặc hỏng không đọc được. App không crash; project mới sẽ thay chỗ khi được lưu. Muốn bắt đầu lại từ đầu, xem [Về trạng thái sạch](#về-trạng-thái-sạch).
- **Hiện thông báo "Projects cannot be saved in this browser."** Trình duyệt chặn IndexedDB, ví dụ ở một số cửa sổ riêng tư, hay khi dữ liệu của site bị chặn. App vẫn chạy được, chỉ là không lưu.
- **`pnpm e2e` báo thiếu browser.** Chạy `pnpm exec playwright install chromium`.

## Phạm vi

- Đây là PoC phía trình duyệt: không có backend, auth hay API, và không cần SQL, Redis hay MinIO.
- Mọi dữ liệu nằm trong IndexedDB của trình duyệt, theo từng origin. Chưa có export/import hay đồng bộ giữa các máy.
- Kiến trúc và các quyết định: xem [`stem-demo-implementation-plan.md`](stem-demo-implementation-plan.md).
