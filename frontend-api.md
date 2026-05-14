# CETS 前端對接 API 參考

每個 endpoint 皆附實際 JSON payload 範例。

## 0. 先看這個

| 項目 | 值 |
|---|---|
| 公網 base URL | `https://cets.alanh.uk` |
| API prefix | `/api/v1` |
| Auth scheme | `Authorization: Bearer <jwt>` |
| Response envelope | 統一 `{ success: bool, data \| error }` |
| Time format | ISO 8601 + offset(`Asia/Taipei`,後端 DB 已轉好,前端不要再處理時區)|
| ID format | ULID 26 字(`[0-9A-HJKMNP-TV-Z]`),全 system 一致 |
| Content-Type | `application/json`(except export 為 csv / xlsx) |
| OpenAPI spec | `GET /api/openapi.json` — 永遠開,可餵 codegen 工具(orval / openapi-generator)|
| Swagger UI | `/api/docs` — production 預設關;dev / lab 可看 |
| WebSocket | `wss://cets.alanh.uk/ws` — see §6 |

統一 envelope 範例:

```json
{ "success": true,  "data": { /* see each endpoint below */ } }
{ "success": false, "error": { "code": "EVENT_NOT_FOUND", "message": "活動不存在", "details": { "request_id": "01HQE9..." } } }
```

---

## 1. Auth flow(OIDC)

### 1.1 啟動登入

```http
GET /api/v1/auth/oidc/authorize-url
```

**Response 200**:
```json
{
  "success": true,
  "data": {
    "authorize_url": "https://<tenant>.us.auth0.com/authorize?response_type=code&client_id=...&redirect_uri=https%3A%2F%2Fcets.alanh.uk%2Fapi%2Fv1%2Fauth%2Foidc%2Fcallback&scope=openid+profile+email&state=<random>&nonce=<random>&code_challenge=<S256>&code_challenge_method=S256",
    "state": "<同 url 的 state>"
  }
}
```

前端拿 `authorize_url` 後 `window.location.href = authorize_url`(或 `<a href>`)。
state + PKCE(S256)由後端產 + 暫存(防 CSRF / code interception);前端不必管 state,
callback 時後端自己驗。

### 1.2 OIDC callback(IdP 回呼,前端不會直接打)

```http
POST /api/v1/auth/oidc/callback
Content-Type: application/json

{ "code": "<auth_code>", "state": "<state>" }
```

**Response 200**:
```json
{
  "success": true,
  "data": {
    "access_token": "eyJraWQiOiJ2MSIsInR5cCI6IkpXVCIsImFsZyI6IkhTMjU2In0.eyJzdWIiOiIwMUhRRTZBQkNERUZHSEpLTU5QUVJTVFZXWCIsInJvbGUiOiJFTVBMT1lFRSIsImV4cCI6MTc0NDcwMjQwMH0.signature",
    "refresh_token": "rt_01HQE6ABCDEFGHJKMNPQRSTVWX",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
}
```

| field | type | note |
|---|---|---|
| access_token | str | JWT,1 小時過期 |
| refresh_token | str | 8 小時過期,refresh 後輪替 |
| expires_in | int | access token TTL(秒)|
| token_type | str | 永遠 `"Bearer"` |

### 1.3 Refresh

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refresh_token": "rt_01HQE6ABCDEFGHJKMNPQRSTVWX" }
```

回新 access + refresh pair(舊 refresh 即時失效;reuse 偵測會撤銷整個 family)。Response shape 同 §1.2。

### 1.4 Logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <jwt>
```

撤銷當前 access token + 對應 refresh family。

**Response 200**:
```json
{ "success": true, "data": null }
```

### 1.5 取得當前使用者

```http
GET /api/v1/auth/me
Authorization: Bearer <jwt>
```

**Response 200**:
```json
{
  "success": true,
  "data": {
    "id": "01HQE6ABCDEFGHJKMNPQRSTVWX",
    "employee_id": "E12345",
    "name": "王小明",
    "email": "wang.xm@example.com",
    "department": "研發部 D300",
    "site": "HSINCHU",
    "role": "EMPLOYEE",
    "status": "ACTIVE"
  }
}
```

| field | type | nullable | enum |
|---|---|---|---|
| id | str (ULID) | no | |
| employee_id | str | no | |
| name | str | no | |
| email | str | no | |
| department | str | yes | |
| site | str | no | `HSINCHU` / `TAINAN` / `TAICHUNG` / `TAIPEI` / `OVERSEAS` |
| role | str | no | `EMPLOYEE` / `ADMIN` / `ADMIN_VIEWER` / `VERIFIER` |
| status | str | no | `ACTIVE` / `INACTIVE` |

### 1.6 OIDC 登入與 token 取得

前端不保存預簽 token、不設定固定 token 環境變數,也不在程式碼或文件中放入固定 access token。所有角色都走 OIDC 流程:

1. `GET /api/v1/auth/oidc/authorize-url` 取得 Auth0 hosted login URL。
2. 使用者在 Auth0 頁面輸入帳號密碼。
3. Auth0 redirect 回 SPA `/auth/callback`。
4. SPA 驗證 `state` 後呼叫 `POST /api/v1/auth/oidc/callback`。
5. 後端完成 token exchange 並回傳 cets `access_token` 與 `refresh_token`。

`access_token` 僅保存在前端記憶體中;`refresh_token` 由前端的 token lifecycle 管理並在 refresh 時輪替。

#### Token claims 結構

實際 claims 由後端簽發並以 `GET /api/v1/auth/me` 回傳前端需要的使用者資料。文件不保留固定 token 或固定 claims 範例。

---

## 2. 員工瀏覽活動

### 2.1 列表

```http
GET /api/v1/events?scope=eligible&page=1&page_size=20
Authorization: Bearer <jwt>
```

| Query | 說明 |
|---|---|
| `scope` | `eligible`(只看資格符合的)/ `all`(看全部,含不合資格)— 預設 eligible |
| `page` / `page_size` | page_size 1-100,預設 20 |

**Response 200** — `PagedResult[EventSummary]`:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
        "title": "2026 春季家庭日",
        "cover_image_url": "https://cdn.cets.alanh.uk/events/spring-family-day.jpg",
        "status": "PUBLISHED",
        "allowed_sites": ["HSINCHU", "TAINAN"],
        "starts_at": "2026-06-15T09:00:00+08:00",
        "venue": "新竹科學園區戶外廣場",
        "remaining_quota": 320,
        "session_count": 2,
        "is_eligible": true
      }
    ],
    "page": 1,
    "page_size": 20,
    "total": 8,
    "has_next": false
  }
}
```

`is_eligible` 依員工 site 計算;`allowed_sites=[]` 表全廠區開放。

### 2.2 詳情

```http
GET /api/v1/events/{event_id}
Authorization: Bearer <jwt>
```

**Response 200** — `EventDetail`:
```json
{
  "success": true,
  "data": {
    "id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
    "title": "2026 春季家庭日",
    "description": "歡迎所有同仁攜家帶眷參加。\n含親子手作、午餐、抽獎。",
    "cover_image_url": "https://cdn.cets.alanh.uk/events/spring-family-day.jpg",
    "status": "PUBLISHED",
    "allowed_sites": ["HSINCHU", "TAINAN"],
    "created_by": "01HQE6ABCDEFGHJKMNPQRSTVWX",
    "created_at": "2026-04-01T10:00:00+08:00",
    "updated_at": "2026-04-15T14:30:00+08:00",
    "cancelled_at": null,
    "sessions": [
      {
        "id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
        "event_id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
        "title": "上午場",
        "venue": "新竹園區戶外廣場",
        "starts_at": "2026-06-15T09:00:00+08:00",
        "ends_at": "2026-06-15T12:00:00+08:00",
        "registration_opens_at": "2026-05-01T00:00:00+08:00",
        "registration_closes_at": "2026-06-01T23:59:59+08:00",
        "lottery_at": "2026-06-02T10:00:00+08:00",
        "waitlist_close_at": "2026-06-10T23:59:59+08:00",
        "confirmation_deadline_hours": 48,
        "status": "REGISTRATION_OPEN",
        "lottery_executed_at": null,
        "allowed_sites": ["HSINCHU", "TAINAN"],
        "ticket_types": [
          {
            "id": "01HQE5W2N3P4Q5R6S7T8VW9XY0",
            "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
            "name": "成人票",
            "quota": 200,
            "sort_order": 0
          },
          {
            "id": "01HQE5W3PQ4R5S6T7V8WX9YZ01A",
            "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
            "name": "兒童票(6-12 歲)",
            "quota": 100,
            "sort_order": 1
          }
        ]
      }
    ]
  }
}
```

`sessions[*].status` enum:`REGISTRATION_OPEN` / `REGISTRATION_CLOSED` / `LOTTERY_RUNNING` / `LOTTERY_COMPLETED` / `FINALIZED` / `ONGOING` / `CLOSED`。

**注意**:此 endpoint 不附 `EligibilityResult`。前端如需確切 reason_code(SITE_MISMATCH 等),呼叫 `POST /registrations` 收 403 `INELIGIBLE` 時看 `error.details`,或在 §2.1 以 `is_eligible=false` 過濾後顯示提示訊息。

---

## 3. 報名 / 取消 / 棄權

### 3.1 建立報名

```http
POST /api/v1/registrations
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
  "ticket_type_id": "01HQE5W2N3P4Q5R6S7T8VW9XY0"
}
```

**Response 201** — `RegistrationDetail`:
```json
{
  "success": true,
  "data": {
    "id": "01HQE5XKQRT3VWXY4Z56MNPVW7",
    "user_id": "01HQE6ABCDEFGHJKMNPQRSTVWX",
    "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
    "ticket_type_id": "01HQE5W2N3P4Q5R6S7T8VW9XY0",
    "status": "REGISTERED",
    "lottery_rank": null,
    "waitlist_position": null,
    "confirmation_deadline": null,
    "confirmed_at": null,
    "forfeited_at": null,
    "cancelled_at": null,
    "created_at": "2026-05-04T10:30:00+08:00",
    "updated_at": "2026-05-04T10:30:00+08:00"
  }
}
```

`status` enum:`REGISTERED` / `CANCELLED` / `IN_LOTTERY` / `WON` / `LOST` / `WAITLISTED` / `CONFIRMED` / `FORFEITED` / `EXPIRED` / `USED`。

常見錯誤:`INELIGIBLE`(403)、`REGISTRATION_CLOSED`(409)、`ALREADY_REGISTERED`(409)。

**取消後再次報名（重要）**：`DELETE /registrations/{id}` 僅將同一筆紀錄標為 `CANCELLED`（列仍存在）。`ALREADY_REGISTERED` **不應**在僅存在 `CANCELLED`／`FORFEITED`（及若產品允許則含 `LOST`、`EXPIRED`）時回傳；應允許再度 `POST /registrations` 建立新有效報名，或將該筆更新回 `REGISTERED`。前端會在收到 `ALREADY_REGISTERED` 且本地有對應之 `CANCELLED`／`FORFEITED` 時，依序嘗試 **`PATCH /registrations/{id}`**（body：`ticket_type_id`、`dependent_ids`）與 **`POST /registrations/{id}/resume`**（同上 body）；若後端未實作則需以上述方式修正 `POST` 之唯一性判斷。

### 3.2 取消(報名期間內)

```http
DELETE /api/v1/registrations/{registration_id}
Authorization: Bearer <jwt>
```

**Response 200** — 回更新後的 `RegistrationDetail`(`status=CANCELLED`,`cancelled_at` 填):
```json
{
  "success": true,
  "data": {
    "id": "01HQE5XKQRT3VWXY4Z56MNPVW7",
    "user_id": "01HQE6ABCDEFGHJKMNPQRSTVWX",
    "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
    "ticket_type_id": "01HQE5W2N3P4Q5R6S7T8VW9XY0",
    "status": "CANCELLED",
    "lottery_rank": null,
    "waitlist_position": null,
    "confirmation_deadline": null,
    "confirmed_at": null,
    "forfeited_at": null,
    "cancelled_at": "2026-05-04T15:00:00+08:00",
    "created_at": "2026-05-04T10:30:00+08:00",
    "updated_at": "2026-05-04T15:00:00+08:00"
  }
}
```

只有 `REGISTERED` 狀態可 cancel;其他狀態回 409 `INVALID_STATE_TRANSITION`。

### 3.3 棄權(中籤後不去)

```http
POST /api/v1/registrations/{registration_id}/forfeit
Authorization: Bearer <jwt>
```

**Response 200** — 回更新後的 `RegistrationDetail`(`status=FORFEITED`):
```json
{
  "success": true,
  "data": {
    "id": "01HQE5XKQRT3VWXY4Z56MNPVW7",
    "user_id": "01HQE6ABCDEFGHJKMNPQRSTVWX",
    "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
    "ticket_type_id": "01HQE5W2N3P4Q5R6S7T8VW9XY0",
    "status": "FORFEITED",
    "lottery_rank": 12,
    "waitlist_position": null,
    "confirmation_deadline": "2026-06-04T10:00:00+08:00",
    "confirmed_at": null,
    "forfeited_at": "2026-06-03T18:00:00+08:00",
    "cancelled_at": null,
    "created_at": "2026-05-04T10:30:00+08:00",
    "updated_at": "2026-06-03T18:00:00+08:00"
  }
}
```

只有 `WON` 狀態可 forfeit;會觸發候補遞補(候補者收 `WAITLIST_PROMOTED` 通知)。

### 3.4 我的報名清單

```http
GET /api/v1/me/registrations?status=WON&page=1&page_size=20
Authorization: Bearer <jwt>
```

`status` 支援多值,逗號分隔:`?status=WON,WAITLISTED`。

**Response 200** — `PagedResult[RegistrationDetail]`:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01HQE5XKQRT3VWXY4Z56MNPVW7",
        "user_id": "01HQE6ABCDEFGHJKMNPQRSTVWX",
        "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
        "ticket_type_id": "01HQE5W2N3P4Q5R6S7T8VW9XY0",
        "status": "WON",
        "lottery_rank": 12,
        "waitlist_position": null,
        "confirmation_deadline": "2026-06-04T10:00:00+08:00",
        "confirmed_at": null,
        "forfeited_at": null,
        "cancelled_at": null,
        "created_at": "2026-05-04T10:30:00+08:00",
        "updated_at": "2026-06-02T10:05:00+08:00"
      }
    ],
    "page": 1,
    "page_size": 20,
    "total": 1,
    "has_next": false
  }
}
```

---

## 4. 票券

### 4.1 確認中籤並發票

```http
POST /api/v1/registrations/{registration_id}/confirm
Authorization: Bearer <jwt>
```

**Response 201** — `TicketDetail`(`status=ISSUED`):
```json
{
  "success": true,
  "data": {
    "id": "01HQE5VKMNPQRSTVW34X5YZ6AB",
    "registration_id": "01HQE5XKQRT3VWXY4Z56MNPVW7",
    "user_id": "01HQE6ABCDEFGHJKMNPQRSTVWX",
    "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
    "status": "ISSUED",
    "issued_at": "2026-06-03T20:00:00+08:00",
    "used_at": null,
    "used_by_device": null,
    "revoked_at": null,
    "revoke_reason": null
  }
}
```

`status` enum:`ISSUED` / `USED` / `REVOKED`。

常見錯誤:`INVALID_STATE_TRANSITION`(非 WON)、`CONFIRMATION_EXPIRED`(410)、`NOT_FOUND`(他人的報名紀錄)。

### 4.2 我的票券

```http
GET /api/v1/me/tickets?status=ISSUED&page=1&page_size=50
Authorization: Bearer <jwt>
```

**Response 200** — `PagedResult[TicketSummary]`:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01HQE5VKMNPQRSTVW34X5YZ6AB",
        "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
        "status": "ISSUED",
        "issued_at": "2026-06-03T20:00:00+08:00",
        "used_at": null
      }
    ],
    "page": 1,
    "page_size": 50,
    "total": 1,
    "has_next": false
  }
}
```

### 4.3 取得票券 + 即時 QR

```http
GET /api/v1/me/tickets/{ticket_id}/qr
Authorization: Bearer <jwt>
```

**Response 200** — `TicketWithQRPayload`:
```json
{
  "success": true,
  "data": {
    "ticket": {
      "id": "01HQE5VKMNPQRSTVW34X5YZ6AB",
      "registration_id": "01HQE5XKQRT3VWXY4Z56MNPVW7",
      "user_id": "01HQE6ABCDEFGHJKMNPQRSTVWX",
      "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
      "status": "ISSUED",
      "issued_at": "2026-06-03T20:00:00+08:00",
      "used_at": null,
      "used_by_device": null,
      "revoked_at": null,
      "revoke_reason": null
    },
    "qr_payload": "eyJraWQiOiJ2MSIsInR5cCI6IkpXVCIsImFsZyI6IkVkRFNBIn0.eyJ0aWQiOiIwMUhRRTVWS01OUFFSU1RWVzM0WDVZWjZBQiIsInVpZCI6IjAxSFFFNkFCQ0RFRkdISktNTlBRUlNUVldYIiwic2lkIjoiMDFIUUU1VDdLOU1OUFFSM1M0VldYWTVaNkEiLCJleHAiOjE3NDkwNDU4NjB9.signature",
    "qr_expires_at": "2026-06-15T09:01:00+08:00"
  }
}
```

`qr_payload` 為 EdDSA 簽 JWT、60 秒過期 → 前端應 < 60 秒 refresh,或於進場前才呼叫。

### 4.4 驗票端核銷

驗票裝置(scanner / 平板)掃到員工 §4.3 取得的 QR Code 後,呼叫此 endpoint
完成核銷。

```http
POST /api/v1/verify/ticket
Authorization: Bearer <verifier_jwt>
Content-Type: application/json

{
  "qr_payload": "eyJraWQiOiJ2MSIsInR5cCI6IkpXVCIsImFsZyI6IkVkRFNBIn0...",
  "device_id": "scanner-A-01"
}
```

需 `VERIFIER` role。`device_id` 為
驗票裝置識別碼,用於 audit log 與 rate limit 計算(見 §10)。

**Response 200** — `VerificationResult`:
```json
{
  "success": true,
  "data": {
    "ticket_id": "01HQE5VKMNPQRSTVW34X5YZ6AB",
    "user_id": "01HQE6ABCDEFGHJKMNPQRSTVWX",
    "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
    "used_at": "2026-06-15T09:05:00+08:00",
    "user_name": "王小明"
  }
}
```

`user_name` 給 scanner UI 顯示用(已 mask:中文 3 字 → 王*明,2 字 → 王*)。

錯誤碼:`TICKET_INVALID` / `TICKET_ALREADY_USED`(409,`details.used_at` 含時間)/ `TICKET_REVOKED` / `EVENT_NOT_STARTED`(403)/ `EVENT_ENDED`(410)。

---

## 5. 站內通知

> 路徑說明:`/me/notifications` 已不再使用,請改打 `/api/v1/notifications/...`。

### 5.1 列表 + unread_count(一次回)

```http
GET /api/v1/notifications?unread_only=false&page=1&page_size=20
Authorization: Bearer <jwt>
```

**Response 200** — `NotificationListResponse`:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01HQE5YZ12ABCDEFGHJKMNPQRS",
        "type": "LOTTERY_WON",
        "title": "恭喜中籤 — 2026 春季家庭日",
        "body": "您報名的「2026 春季家庭日」(上午場)已中籤。請於 2026-06-04 10:00 前確認,逾期視同棄權。",
        "payload": {
          "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
          "registration_id": "01HQE5XKQRT3VWXY4Z56MNPVW7",
          "confirmation_deadline": "2026-06-04T10:00:00+08:00"
        },
        "read_at": null,
        "created_at": "2026-06-02T10:05:00+08:00"
      },
      {
        "id": "01HQE5ZP34BCDEFGHJKMNPQRSTV",
        "type": "EVENT_REMINDER",
        "title": "活動提醒 — 2026 春季家庭日 24h 後開始",
        "body": "您的活動將於 2026-06-15 09:00 開始,請準時出席。",
        "payload": {
          "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
          "starts_at": "2026-06-15T09:00:00+08:00"
        },
        "read_at": "2026-06-14T10:00:00+08:00",
        "created_at": "2026-06-14T09:00:00+08:00"
      }
    ],
    "total": 12,
    "unread_count": 3,
    "page": 1,
    "page_size": 20,
    "has_next": false
  }
}
```

通知 `type` 共 9 種(依照設計 05 §12.1):

| type | 觸發 |
|---|---|
| `REGISTRATION_CONFIRMED` | 報名建立 |
| `LOTTERY_WON` | 抽中 |
| `LOTTERY_LOST` | 落選(僅候選但既未中籤也未進候補) |
| `WAITLISTED` | 抽完籤 → 進候補 |
| `WAITLIST_PROMOTED` | 候補遞補成功(被棄權者 / 過期者讓出名額) |
| `CONFIRMATION_REMINDER` | 確認期 24h / 1h 前 |
| `CONFIRMATION_EXPIRED` | 確認期過期 |
| `EVENT_CANCELLED` | 活動取消 |
| `EVENT_REMINDER` | 活動 24h 前 |

`payload` 結構依 `type` 不同(看上方範例);所有 type 都至少帶 `session_id`。

> **行為說明**
>
> - 抽籤完成後,WAITLISTED 員工會收到 `WAITLISTED` 通知,不再混入 `LOTTERY_LOST`。
>   前端若有「落選即隱藏」邏輯,請分別處理 `LOTTERY_LOST` 與 `WAITLISTED` 兩種類型的 UX。
> - 員工棄權(`POST /registrations/{id}/forfeit`)後,候補遞補者會立即收到
>   `WAITLIST_PROMOTED`,不必等 `expire_overdue_won` 排程觸發。

#### `EVENT_CANCELLED`（管理員取消活動）

後端 **`POST /admin/events/{id}/cancel`**（body 含 `reason`）必須:

1. **全面通知**：為該活動底下**每一筆不重複的報名員工**（`user_id`）各建立一封 **`EVENT_CANCELLED`** 站内通知並寫入 DB（報名狀態含 `REGISTERED` / `IN_LOTTERY` / `WON` / `LOST` / `WAITLISTED` / `CONFIRMED` 等曾參與者；可依產品是否含已 `CANCELLED`／`FORFEITED`）。
2. **即時推播**：對目前有 WebSocket 連線的上述員工送出 §6 之 `notification` 訊息,**資料結構與 REST 列表單筆項目相同**。
3. **取消原因**：`reason` **原文**須放入每封通知：
   - `payload.reason`（必填,與請求 body 一致,供前端強制顯示）
   - `body` 建議一併寫成人讀句式,例如：「您報名的活動『{標題}』已由管理員取消。原因：{reason}」（若 `body` 已含原因,可不重複段落）

列表與 WS 範例:

```json
{
  "id": "01HQE60_EVENT_CANCEL_NOTE",
  "type": "EVENT_CANCELLED",
  "title": "活動取消 — 2026 春季家庭日",
  "body": "您曾報名的活動「2026 春季家庭日」已由管理員取消。原因：天候不佳改期另行公告。",
  "payload": {
    "event_id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
    "reason": "天候不佳改期另行公告"
  },
  "read_at": null,
  "created_at": "2026-06-04T09:00:00+08:00"
}
```

前端會讀取 `payload.reason`、`payload.cancel_reason` 等鍵並在通知中心顯示。

### 5.2 未讀計數

```http
GET /api/v1/notifications/unread-count
Authorization: Bearer <jwt>
```

**Response 200**:
```json
{
  "success": true,
  "data": {
    "unread_count": 3
  }
}
```

### 5.3 標記已讀(冪等)

```http
POST /api/v1/notifications/{notification_id}/read
Authorization: Bearer <jwt>
```

**Response 200** — 冪等(已讀也回該筆 read_at):
```json
{
  "success": true,
  "data": {
    "id": "01HQE5YZ12ABCDEFGHJKMNPQRS",
    "read_at": "2026-06-02T10:30:00+08:00"
  }
}
```

不存在 / 別人的 → 404 `NOT_FOUND`。

### 5.4 全部標已讀

```http
POST /api/v1/notifications/mark-all-read
Authorization: Bearer <jwt>
```

**Response 200**:
```json
{
  "success": true,
  "data": {
    "updated_count": 3
  }
}
```

---

## 6. WebSocket(即時推播)

> 協定說明:不再以 `?token=<jwt>` query string 傳遞認證資訊,改在 WebSocket
> 連線建立後 10 秒內以 `auth` 訊息送出 token。

### 6.1 連線

```js
const ws = new WebSocket("wss://cets.alanh.uk/ws");

ws.onopen = () => {
  // 10 秒內必須送 auth 訊息
  ws.send(JSON.stringify({ type: "auth", token: accessToken }));
};

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  // 預期序:auth_ok → 之後 notification / ping
  if (msg.type === "auth_ok") {
    // 認證成功
  } else if (msg.type === "notification") {
    // 推播訊息
    // msg.data shape 同 §5.1 NotificationItem(id / type / title / body / payload / read_at(永遠 null,WS 不持久化) / created_at)
  } else if (msg.type === "ping") {
    ws.send(JSON.stringify({ type: "pong" }));
  }
};
```

WS 訊息格式:

```json
// auth_ok(server → client,認證成功)
{ "type": "auth_ok" }

// notification(server → client)
{
  "type": "notification",
  "data": {
    "id": "01HQE5YZ12ABCDEFGHJKMNPQRS",
    "type": "LOTTERY_WON",
    "title": "恭喜中籤 — 2026 春季家庭日",
    "body": "您報名的活動已中籤...",
    "payload": { "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A", "confirmation_deadline": "2026-06-04T10:00:00+08:00" },
    "read_at": null,
    "created_at": "2026-06-02T10:05:00+08:00"
  }
}

// 活動取消(須對每位曾報名者送出一則,data 同上 REST 項目)
{
  "type": "notification",
  "data": {
    "id": "01HQE7Z_EVENT_CANCEL_NOTE",
    "type": "EVENT_CANCELLED",
    "title": "活動取消 — 2026 春季家庭日",
    "body": "您曾報名的活動「2026 春季家庭日」已由管理員取消。原因：場地檔期異動。",
    "payload": { "event_id": "01HQE5R2J3K4M5N6P7Q8R9STVW", "reason": "場地檔期異動" },
    "read_at": null,
    "created_at": "2026-06-06T08:00:00+08:00"
  }
}

// ping(server → client,30 秒一次)
{ "type": "ping" }

// pong(client → server)
{ "type": "pong" }
```

### 6.2 close code

| code | 含義 | 處理 |
|---|---|---|
| 1000 | 正常關閉 | — |
| 1001 | 伺服器 graceful shutdown(滾動更新)| 指數退避重連:1/2/4/8/最多 30s |
| 4001 | 認證失敗(token 過期 / 缺 / 10s 內未送 auth)| refresh token 後重連 |
| 4008 | rate limit(同 IP 開太快 / 同 user 連線數 ≥ 5)| 退避;檢查重連邏輯 |

### 6.3 心跳

伺服器每 30 秒送 `{"type": "ping"}`;前端應回 `{"type": "pong"}`。60 秒未收到任何訊息(包含 pong)伺服器主動斷。

### 6.4 重連 + 補拉

斷線後重連成功 → 呼叫 `GET /api/v1/notifications?unread_only=true` 補拉錯過訊息(WS 推播不持久化,只通即時)。

---

## 7. 管理員 API

> Phase 9 後 RBAC 細分:router 層 `require_admin_read`(`ADMIN` 或 `ADMIN_VIEWER` 都通過);
> 寫入 / 拉明文 PII / export 加 `require_admin_full`(僅 `ADMIN`,VIEWER 拒)。

### 7.1 活動管理(CRUD + 狀態)

| Method | Path | 動作 | 權限 |
|---|---|---|---|
| POST | `/api/v1/admin/events` | 建立活動(status=DRAFT)| ADMIN_FULL |
| PATCH | `/api/v1/admin/events/{id}` | 編輯;PUBLISHED 後僅 title/description/cover_image_url 可改 | ADMIN_FULL |
| POST | `/api/v1/admin/events/{id}/publish` | DRAFT → PUBLISHED | ADMIN_FULL |
| POST | `/api/v1/admin/events/{id}/cancel` | 取消活動,自動撤銷票 + 通知所有報名者 | ADMIN_FULL |

> **行為說明**
>
> `POST /events/{id}/cancel` 會依序執行三件事:
>
> 1. event status 設為 `CANCELLED`
> 2. 該活動所有 ISSUED 票券 status 設為 `REVOKED`,並寫入 `revoked_at` 與 `revoke_reason`
> 3. **對該活動所有曾報名員工逐一發送** `EVENT_CANCELLED` 站内通知並 **WebSocket 即時推送**（見 §5.1 `EVENT_CANCELLED`）；`reason` **必須**寫入每封通知的 `payload.reason`（並建議寫進 `body` 內文）
>
> 前端票券狀態輪詢應預期會看到 status 變更為 `REVOKED`;若 UI 依賴「持票才能入場」
> 邏輯,請以 `revoke_reason` 顯示撤銷原因。

POST 建立 request body 範例:
```json
{
  "title": "2026 春季家庭日",
  "description": "歡迎攜家帶眷...",
  "cover_image_url": "https://cdn.cets.alanh.uk/events/spring.jpg",
  "allowed_sites": ["HSINCHU", "TAINAN"],
  "sessions": [
    {
      "title": "上午場",
      "venue": "新竹園區戶外廣場",
      "starts_at": "2026-06-15T09:00:00+08:00",
      "ends_at": "2026-06-15T12:00:00+08:00",
      "registration_opens_at": "2026-05-01T00:00:00+08:00",
      "registration_closes_at": "2026-06-01T23:59:59+08:00",
      "lottery_at": "2026-06-02T10:00:00+08:00",
      "waitlist_close_at": "2026-06-10T23:59:59+08:00",
      "confirmation_deadline_hours": 48,
      "ticket_types": [
        { "name": "成人票", "quota": 200, "sort_order": 0 },
        { "name": "兒童票(6-12 歲)", "quota": 100, "sort_order": 1 }
      ]
    }
  ]
}
```

POST / PATCH / publish / cancel 的 **Response 200/201** 都回 `EventDetail`(同 §2.2)。

cancel request body:
```json
{ "reason": "天候因素" }
```

### 7.2 廠區人數預覽

```http
GET /api/v1/admin/sites/employee-count?sites=HSINCHU,TAINAN
Authorization: Bearer <admin_jwt>
```

**Response 200** — `SiteEmployeeCount`:
```json
{
  "success": true,
  "data": {
    "sites": {
      "HSINCHU": 35420,
      "TAINAN": 28150
    },
    "total": 63570
  }
}
```

### 7.3 活動報名清單(分頁 + PII mask)

```http
GET /api/v1/admin/events/{event_id}/registrations
  ?session_id=...&status=WON&page=1&page_size=20&mask_pii=true
Authorization: Bearer <admin_jwt>
```

| Query | 說明 |
|---|---|
| `session_id` | 限定單一場次 |
| `status` | 大寫 + 底線(WON / CONFIRMED / WAITLISTED ...);regex 限制 |
| `mask_pii` | 預設 `true`;設 `false` 需 `ADMIN`(VIEWER 拒)+ **寫 audit log**(BR-09)|
| `page_size` | 1-100,預設 20 |

**Response 200** — `PagedResult[RegistrationWithUser]`(`mask_pii=true`):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "01HQE5XKQRT3VWXY4Z56MNPVW7",
        "user": {
          "employee_id": "E1****",
          "name": "王*明",
          "department": "研發部 D300",
          "site": "HSINCHU"
        },
        "session_title": "上午場",
        "ticket_type_name": "成人票",
        "status": "WON",
        "lottery_rank": 12,
        "created_at": "2026-05-04T10:30:00+08:00"
      }
    ],
    "page": 1,
    "page_size": 20,
    "total": 200,
    "has_next": true
  }
}
```

`mask_pii=false`(限 `ADMIN`)— `user.employee_id`、`user.name` 為原值;其餘欄位不變。

### 7.3.1 執行場次抽籤

```http
POST /api/v1/admin/sessions/{session_id}/run-lottery
Authorization: Bearer <admin_jwt>
```

管理員手動觸發抽籤；與 `lottery-runner` CronJob 使用同一套邏輯。此 endpoint 冪等：同一場次/票種已抽過時回既有結果。場次需已進入 `REGISTRATION_CLOSED` 或更後狀態。

### 7.4 儀表板

```http
GET /api/v1/admin/events/{event_id}/dashboard
Authorization: Bearer <admin_jwt>
```

**Response 200** — `DashboardData`:
```json
{
  "success": true,
  "data": {
    "event_id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
    "registration_timeline": [
      { "date": "2026-05-01", "count": 12 },
      { "date": "2026-05-02", "count": 35 },
      { "date": "2026-05-03", "count": 28 }
    ],
    "site_distribution": [
      { "site": "HSINCHU", "count": 180 },
      { "site": "TAINAN", "count": 95 }
    ],
    "ticket_type_progress": [
      {
        "ticket_type_id": "01HQE5W2N3P4Q5R6S7T8VW9XY0",
        "name": "成人票",
        "quota": 200,
        "registered": 275,
        "won": 200,
        "confirmed": 187
      },
      {
        "ticket_type_id": "01HQE5W3PQ4R5S6T7V8WX9YZ01A",
        "name": "兒童票(6-12 歲)",
        "quota": 100,
        "registered": 80,
        "won": 80,
        "confirmed": 76
      }
    ],
    "lottery_status": {
      "executed": true,
      "lottery_at": "2026-06-02T10:00:00+08:00"
    },
    "sessions_lottery": [
      {
        "session_id": "01HQE5T7K9MNPQR3S4VWXY5Z6A",
        "title": "上午場",
        "lottery_at": "2026-06-02T10:00:00+08:00",
        "lottery_executed_at": null,
        "registered_pending": 120
      }
    ],
    "attendance": {
      "checked_in": 198,
      "total_confirmed": 263
    }
  }
}
```

`registered` 計入 `IN_LOTTERY + WON + CONFIRMED`(不算 LOST / CANCELLED)。
`attendance.total_confirmed = ISSUED + USED`(發過票就算)。

**`sessions_lottery`（建議後端實作）**：供後台「依場次執行抽籤」表格使用；每列含 `session_id`、`title`、`lottery_at`、`lottery_executed_at`（已抽籤則非 null）、`registered_pending`（待抽籤之已報名人数，可選）。若未回傳此陣列，前端會改以 `GET /events/{event_id}` 的 `sessions` 補齊場次列（人數欄可能為空）。

### 7.5 同步匯出報名表(< 5000 筆)

```http
GET /api/v1/admin/events/{event_id}/export?format=csv&mask_pii=true
Authorization: Bearer <admin_jwt>
```

| Query | 說明 |
|---|---|
| `format` | `csv`(default,UTF-8 BOM,Excel 直開不亂碼)/ `xlsx` |
| `mask_pii` | 預設 `true`;`false` 寫 audit |

權限:`ADMIN_FULL`(VIEWER 拒)。

**Response 200** — binary stream。Headers:

```http
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="registrations_01HQE5R2J3K4M5N6P7Q8R9STVW.csv"
```

CSV 內容(範例,mask_pii=true):

```csv
registration_id,employee_id,name,department,site,session_title,ticket_type_name,status,lottery_rank,created_at
01HQE5XKQRT3VWXY4Z56MNPVW7,E1****,王*明,研發部 D300,HSINCHU,上午場,成人票,WON,12,2026-05-04T10:30:00+08:00
```

CSV cell 自動 sanitize(`=/+/-/@` 開頭加單引號 prefix 防 Excel 公式注入)。

> 同步 export 上限 5000 筆;超過拋 `EXPORT_TOO_LARGE`(413)— 走 §7.6 背景化路徑。

### 7.6 背景匯出(> 5000 筆,Phase 9 新增)

> Phase 9 Batch B(A6)新增。同步 export 撞 `EXPORT_TOO_LARGE` 時改走此路徑。
> 結果存 archive bucket `exports/{event_id}/{task_id}.{ext}`,TTL 1 day(依照 Redis state TTL)。

#### 7.6.1 入隊任務

```http
POST /api/v1/admin/events/{event_id}/export/async?format=csv&mask_pii=true
Authorization: Bearer <admin_jwt>
```

權限:`ADMIN_FULL`。Query 同 §7.5。

**Response 200** — `ExportTaskCreated`:
```json
{
  "success": true,
  "data": {
    "task_id": "01HQEABCD3F4G5HJKMNPQRSTVW",
    "status": "PENDING",
    "poll_url": "/api/v1/admin/events/01HQE5R2J3K4M5N6P7Q8R9STVW/export/tasks/01HQEABCD3F4G5HJKMNPQRSTVW"
  }
}
```

#### 7.6.2 查狀態(輪詢)

```http
GET /api/v1/admin/events/{event_id}/export/tasks/{task_id}
Authorization: Bearer <admin_jwt>
```

權限:`ADMIN_READ`(VIEWER 也能查)。前端建議 5–10 秒輪一次。

**Response 200** — `ExportTaskStatus`,4 種狀態範例:

PENDING(剛入隊):
```json
{
  "success": true,
  "data": {
    "task_id": "01HQEABCD3F4G5HJKMNPQRSTVW",
    "event_id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
    "format": "csv",
    "status": "PENDING",
    "created_at": "2026-05-04T10:00:00+08:00",
    "started_at": null,
    "finished_at": null,
    "error": null,
    "download_url": null
  }
}
```

RUNNING(worker 處理中):
```json
{
  "success": true,
  "data": {
    "task_id": "01HQEABCD3F4G5HJKMNPQRSTVW",
    "event_id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
    "format": "csv",
    "status": "RUNNING",
    "created_at": "2026-05-04T10:00:00+08:00",
    "started_at": "2026-05-04T10:00:30+08:00",
    "finished_at": null,
    "error": null,
    "download_url": null
  }
}
```

SUCCEEDED(可下載):
```json
{
  "success": true,
  "data": {
    "task_id": "01HQEABCD3F4G5HJKMNPQRSTVW",
    "event_id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
    "format": "csv",
    "status": "SUCCEEDED",
    "created_at": "2026-05-04T10:00:00+08:00",
    "started_at": "2026-05-04T10:00:30+08:00",
    "finished_at": "2026-05-04T10:01:15+08:00",
    "error": null,
    "download_url": "/api/v1/admin/events/01HQE5R2J3K4M5N6P7Q8R9STVW/export/tasks/01HQEABCD3F4G5HJKMNPQRSTVW/download"
  }
}
```

FAILED(查 `error` 欄位):
```json
{
  "success": true,
  "data": {
    "task_id": "01HQEABCD3F4G5HJKMNPQRSTVW",
    "event_id": "01HQE5R2J3K4M5N6P7Q8R9STVW",
    "format": "csv",
    "status": "FAILED",
    "created_at": "2026-05-04T10:00:00+08:00",
    "started_at": "2026-05-04T10:00:30+08:00",
    "finished_at": "2026-05-04T10:00:35+08:00",
    "error": "event 01HQE5R2J3K4M5N6P7Q8R9STVW 報名筆數 60123 > 背景化上限 50000",
    "download_url": null
  }
}
```

task 不存在或過期(TTL 1 day)→ 404 `EXPORT_TASK_NOT_FOUND`。

#### 7.6.3 下載結果

```http
GET /api/v1/admin/events/{event_id}/export/tasks/{task_id}/download
Authorization: Bearer <admin_jwt>
```

權限:`ADMIN_FULL`。main-api 代理 stream 從 MinIO 拉。

**Response 200** — binary stream(同 §7.5 headers)。

任務尚未 SUCCEEDED → 409 `EXPORT_TASK_NOT_READY`。

---

## 8. 統一錯誤碼

```json
{
  "success": false,
  "error": {
    "code": "EVENT_NOT_FOUND",
    "message": "活動不存在",
    "details": { "request_id": "01HQE9ABC..." }
  }
}
```

| HTTP | code | 說明 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | request body / query 不合法,`details.errors` 含 pydantic 詳情 |
| 400 | `TICKET_INVALID` | QR JWT 無效或過期 |
| 401 | `UNAUTHENTICATED` | 缺 token / 簽章不對 |
| 401 | `TOKEN_EXPIRED` | access token 過期(走 refresh)|
| 403 | `FORBIDDEN` | 角色不符(含 ADMIN_VIEWER 動 ADMIN_FULL endpoint)|
| 403 | `INELIGIBLE` | 廠區資格不符 |
| 403 | `EVENT_NOT_STARTED` | 太早入場(starts_at - 30min 之前)|
| 404 | `NOT_FOUND` | event / registration / ticket / notification 不存在(或無權看)|
| 404 | `EVENT_NOT_FOUND` | 活動不存在 |
| 404 | `EXPORT_TASK_NOT_FOUND` | 背景 export task 不存在或已過期(TTL 1 day) |
| 409 | `INVALID_STATE_TRANSITION` | 狀態機禁止此動作 |
| 409 | `REGISTRATION_CLOSED` | 報名已截止 |
| 409 | `ALREADY_REGISTERED` | 同場次已報名 |
| 409 | `TICKET_ALREADY_USED` | 票券已用過,`details.used_at` 含時間 |
| 409 | `TICKET_ALREADY_ISSUED` | 同 reg 已發過票券 |
| 409 | `TICKET_REVOKED` | 票券已撤銷 |
| 409 | `EXPORT_TASK_NOT_READY` | 背景 export 還在 PENDING/RUNNING/FAILED,不能下載 |
| 410 | `CONFIRMATION_EXPIRED` | 確認期限已過 |
| 410 | `EVENT_ENDED` | 活動結束(已超過核銷時段,結束後 30 分鐘內為驗票寬限期)|
| 413 | `EXPORT_TOO_LARGE` | 同步匯出超過 5000 筆;改走 §7.6 |
| 429 | `RATE_LIMITED` | 速率限制 |
| 500 | `INTERNAL_ERROR` | 系統錯誤 |
| 503 | `SERVICE_UNAVAILABLE` | 暫時不可用 |

`details.request_id` 任何錯誤都會帶,排查時提供給後端。

完整錯誤 envelope 範例:

```json
{
  "success": false,
  "error": {
    "code": "TICKET_ALREADY_USED",
    "message": "票券已被使用",
    "details": {
      "request_id": "01HQE9PQR3S4T5VWXY6Z789ABC",
      "used_at": "2026-06-15T09:05:00+08:00",
      "used_by_device": "scanner-A-01"
    }
  }
}
```

---

## 9. PII mask 格式參考

| 欄位 | mask 結果 |
|---|---|
| 中文姓名(3 字)| `王小明` → `王*明` |
| 中文姓名(2 字)| `王明` → `王*` |
| 拉丁姓名 | `John Doe` → `J*** D**` |
| 混合 | `Alice 王` → `A**** 王`(走拉丁路徑,不吃空格)|
| employee_id | `E12345` → `E1****`(留前 2)|
| email | `alice@example.com` → `a****@example.com`(預設留 domain)|

`mask_pii=true` 為預設;前端若需明文做 join、必傳 `mask_pii=false`,**該動作會寫 audit log + 限 ADMIN role**(ADMIN_VIEWER 拒)。

---

## 10. Rate limit

| 端點 | 限制 |
|---|---|
| `/verify/ticket` | per (verifier, device) 60/min |
| `/ws` 連線 | per IP 20/min,per user 同時連線數 ≤ 5 |
| Ingress 全域 | per source IP 100 rps,burst 5x |

超過回 429 `RATE_LIMITED` 或 WS close 4008。

---

## 11. 跨環境提示

| 環境 | URL | OpenAPI | Swagger UI |
|---|---|---|---|
| local dev | `http://localhost:8000` | `/api/openapi.json` | `/api/docs` |
| lab | `https://cets.alanh.uk` | `/api/openapi.json` | 未開放(可用 `EXPOSE_SWAGGER_UI=true` 開)|
| production | TBD | | 未開放 |

OpenAPI JSON 永遠對外可取(只含 schema,不含資料),用於前端 codegen / SDK 產生。
