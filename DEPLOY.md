# Deploy và cài app lên dev store

## Deploy hai app GingerGlow và Flagwix

Hai app dùng chung source code nhưng có cấu hình Shopify và Render độc lập:

- GingerGlow: `shopify.app.ginger.toml` → `https://uoy-ginger-bulk-edit.onrender.com`
- Flagwix: `shopify.app.flagwix.toml` → `https://uoy-flagwix-bulk-edit.onrender.com`

Validate và phát hành cấu hình Shopify cho từng app:

```bash
shopify app config validate --config ginger --json
shopify app deploy --config ginger

shopify app config validate --config flagwix --json
shopify app deploy --config flagwix
```

`shopify app deploy` chỉ cập nhật configuration/extensions trên Shopify; web app
vẫn phải deploy riêng trên hai Render services.

Không dùng chung một `.env` cho hai service. Mỗi Render service cần bộ biến riêng:
`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `DATABASE_URL`,
`SCOPES`, và `CRON_SECRET`. Render tự chuyển `SHOPIFY_APP_URL` thành Docker build
argument; URL này không phải secret và được dùng để build `allowedActionOrigins`.

## shopify.web.toml — đọc phần này trước

Repo được tạo bằng `git clone` template chứ không phải `shopify app init`, nên
`shopify.web.toml.liquid` chưa bao giờ được render. Thiếu file `shopify.web.toml`,
Shopify CLI không biết lệnh nào khởi động web process: proxy mở cổng nhưng phía sau
không có gì, mọi request trả 500. Triệu chứng này giống hệt lỗi tunnel nên rất dễ
chẩn đoán nhầm.

File đã được tạo thủ công (bản render của `.liquid` với `pnpm`). Đừng xoá nó.

## Chạy dev và cài lên dev store (không cần thẻ, không cần domain)

Shopify CLI 4.x **không còn tự tạo tunnel**. Nó dùng đúng `application_url` trong config,
nên phải tự chạy tunnel rồi truyền vào bằng `--tunnel-url`.

```bash
nvm use

# Terminal 1 — quick tunnel, không cần tài khoản Cloudflare
cloudflared tunnel --url http://localhost:3458 --no-autoupdate
# ghi lại URL dạng https://<random>.trycloudflare.com

# Terminal 2
shopify app dev --config local --tunnel-url https://<random>.trycloudflare.com:3458
```

Mở Preview URL mà CLI in ra để cài vào dev store.

Hạn chế: URL đổi mỗi lần chạy lại `cloudflared`, và tắt máy là app chết. Chỉ để dev/test.
Muốn app sống 24/7 thì làm tiếp các bước hosting bên dưới.

Không dùng `--use-localhost`: nó cần mkcert và chỉ mở được từ trình duyệt trên chính máy này.

Hai cái bẫy đã xử lý sẵn, ghi lại để khỏi mất công chẩn đoán lại:

- `shopify app dev` **cần TTY**. Chạy nền với `< /dev/null` thì nó in banner rồi thoát im
  lặng, không báo lỗi gì. Chạy trong terminal thật, hoặc bọc bằng `script -qefc`.
- Vite chặn host lạ. `vite.config.ts` cũ chỉ cho phép host suy ra từ `SHOPIFY_APP_URL`,
  nên mọi request qua tunnel trả 403 `Blocked request. This host is not allowed`.
  Đã thêm `.trycloudflare.com` vào `server.allowedHosts`. Cách phân biệt lỗi này với lỗi
  tunnel: `curl -H "Host: <tunnel>" http://localhost:3458/` — nếu 403 mà `Host: localhost`
  cho 200 thì là Vite chặn, không phải tunnel hỏng.

---


App đã link sẵn với app record `UOY Bulk Product Editor` (`client_id = 8c011a2792436213134d604517505948`)
và dev store `mrhellowworld.myshopify.com`. Database production là Neon Postgres, migration đã apply.

Phần còn thiếu là một URL HTTPS public chạy 24/7. Shopify không cài được app trỏ vào `localhost`.

## 0. Node version (bắt buộc, làm 1 lần mỗi terminal)

Shopify CLI 4.7.1 yêu cầu Node >= 22.12. Node mặc định của máy là v20.20.2 nên mọi lệnh
`shopify app *` sẽ crash với `SyntaxError: ... enableCompileCache`.

```bash
nvm use          # đọc .nvmrc -> 22.23.2
node -v          # phải in v22.23.2
```

Muốn khỏi gõ lại mỗi lần: `nvm alias default 22.23.2`.

## 1. Cài flyctl và tạo app trên Fly

Fly bắt buộc có thông tin thanh toán trước khi tạo app, kể cả khi chỉ dùng free allowance
(`Error: We need your payment information to continue!`). Chưa có thẻ thì dùng phần dev
tunnel ở trên, hoặc Render free tier.

```bash
curl -L https://fly.io/install.sh | sh
export FLYCTL_INSTALL="$HOME/.fly"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

fly auth signup      # hoặc: fly auth login
fly apps create uoy-bulk-editor
```

Tên `uoy-bulk-editor` phải khớp với `app` trong `fly.toml` và với `application_url`
trong `shopify.app.toml`. Nếu tên đã bị người khác chiếm, đổi tên ở cả ba chỗ.

## 2. Nạp secrets cho Fly

Lấy API secret của app:

```bash
shopify app env show
```

Rồi nạp vào Fly (thay `<...>` bằng giá trị thật, `DATABASE_URL` và `CRON_SECRET` lấy từ `.env`):

```bash
fly secrets set \
  DATABASE_URL='<chuỗi Neon trong .env, bỏ dấu ngoặc kép>' \
  SHOPIFY_API_KEY='8c011a2792436213134d604517505948' \
  SHOPIFY_API_SECRET='<lấy từ shopify app env show>' \
  SHOPIFY_APP_URL='https://uoy-bulk-editor.fly.dev' \
  SCOPES='write_products,write_inventory' \
  CRON_SECRET='<chuỗi CRON_SECRET trong .env>'
```

Lưu ý: `.env` bọc giá trị trong dấu ngoặc kép. Khi set secret phải **bỏ** dấu ngoặc kép,
nếu không Prisma sẽ báo `P1012 ... the URL must start with the protocol postgresql://`.

## 3. Deploy web app

```bash
fly deploy
curl -s -o /dev/null -w '%{http_code}\n' https://uoy-bulk-editor.fly.dev/
```

Phải trả về `200`. Nếu lỗi: `fly logs`.

## 4. Đẩy config lên Dev Dashboard

`include_config_on_deploy` đã bật, nên lệnh này đồng bộ `application_url`, `redirect_urls`,
`access_scopes` và toàn bộ webhook subscriptions từ `shopify.app.toml` sang Dev Dashboard:

```bash
shopify app deploy
```

Không chạy lệnh này khi đang dùng `shopify.app.local.toml` (URL localhost sẽ ghi đè lên production).

## 5. Cài lên dev store

Mở Dev Dashboard → app `UOY Bulk Product Editor` → **Install link**, chọn `mrhellowworld.myshopify.com`.

Hoặc mở thẳng:

```
https://uoy-bulk-editor.fly.dev/auth/login?shop=mrhellowworld.myshopify.com
```

Sau khi bấm Install, app xuất hiện trong Shopify admin → Apps.

## 6. Cron cho task theo lịch (làm sau, không chặn việc cài)

`app/routes/api.cron.ts` không tự chạy. Nó cần một scheduler bên ngoài gọi vào:

```bash
curl -X POST https://uoy-bulk-editor.fly.dev/api/cron \
  -H "x-cron-secret: <CRON_SECRET>"
```

Dùng cron-job.org hoặc GitHub Actions scheduled workflow, chu kỳ 5 phút.
Không có bước này thì scheduled task và reconciliation sẽ không bao giờ chạy.

## Vòng dev tại chỗ vẫn giữ nguyên

```bash
shopify app dev --config local
```

`shopify.app.local.toml` giữ URL localhost, tách khỏi config production.
