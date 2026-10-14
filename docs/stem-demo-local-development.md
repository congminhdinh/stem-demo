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

## Hai mode: standalone và lab nhúng (S1)

App mở theo URL lúc khởi động. Đây là launch contract mà CourseService, CMS và Student Web dùng; chi tiết và evidence ở plan, task S1.

| Mode | URL | Mở gì | Storage |
|---|---|---|---|
| **Standalone editor** | URL bình thường, ví dụ <http://localhost:5173/> | Project gần nhất trong IndexedDB; chưa có thì mạch mẫu Blink | Tự lưu như mục [Persistence](#persistence) |
| **Lab nhúng** | `?embed=1&template=<key>`, ví dụ <http://localhost:5173/?embed=1&template=button-led> | Đúng template `<key>`, luôn là bản mới, kể cả khi reload | Không đọc và không ghi IndexedDB |

**Template key được hỗ trợ:**

| Key | Project |
|---|---|
| `blink` | Blink: Board, Resistor, LED, program nhấp nháy |
| `led-on` | LED on: Board, LED, program bật D13 |
| `button-direct` | Button without a program: nút nối thẳng vào LED |
| `button-led` | Button and LED: nút → `if` → LED |
| `empty` | Project trống, giống khi bấm New |

- **Key lạ, thiếu hoặc sai dạng** thì app hiện "This lab could not be opened." kèm lý do và danh sách key, không mở project nào. Các trường hợp: key không có trong bảng (phân biệt hoa thường), `template` rỗng hay lặp lại, `embed` khác `1`, và `template` mà không có `embed=1`. App không âm thầm mở Blink hay project của standalone, để lỗi cấu hình nội dung lộ ra ngay ở preview của CMS.
- **Persistence:** lab không restore và không ghi đè "last project" của standalone. Bài làm trong lab không được lưu: reload là về lại template.
- Tham số khác trong URL bị bỏ qua. URL chỉ mang key; document của template nằm trong simulator.
- Chưa có `postMessage`: trang nhúng chưa nhận được sự kiện nào từ lab.

**Nhúng bằng iframe:**

```html
<iframe src="http://localhost:5173/?embed=1&template=blink" title="Lab" width="1100" height="640"></iframe>
```

- Header COOP/COEP của dev server và preview không chặn việc nhúng, vì trang nhúng không cần header gì đặc biệt. Nếu trang nhúng tự bật `Cross-Origin-Embedder-Policy`, simulator sẽ phải gửi thêm `Cross-Origin-Resource-Policy`.
- Trang nhúng và simulator phải cùng không gian địa chỉ: cả hai ở `localhost` khi dev, hoặc cả hai public khi deploy. Chromium chặn trang public nhúng simulator ở localhost hay mạng nội bộ (`net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`).
- Lab chạy được trong iframe có `sandbox="allow-scripts allow-same-origin"`.

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
- `pnpm e2e` cũng start một lesson page giả ở port 5190 (`e2e/lesson-host.mjs`) để test lab trong iframe, và tắt nó khi xong. Port 5190 phải trống.
- Mỗi E2E test chạy trong một browser context mới với storage trống, nên không đụng tới dữ liệu trong trình duyệt của bạn.
- Test fail để lại chi tiết trong `test-results/` (thư mục này đã được gitignore).

## Troubleshooting

- **Mở URL lab mà thấy "This lab could not be opened."** Key hoặc URL sai; lý do và danh sách key nằm ngay trong thông báo. Xem [Hai mode](#hai-mode-standalone-và-lab-nhúng-s1).
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
