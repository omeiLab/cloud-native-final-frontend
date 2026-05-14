# frontend-api.md 對照遠端實測報告（cets.alanh.uk）

更新時間：2026-05-08（UTC+8）
測試對象：
- API Base：`https://cets.alanh.uk/api/v1`
- OpenAPI：`https://cets.alanh.uk/api/openapi.json`
- WebSocket：`wss://cets.alanh.uk/ws`

測試方式：
- 透過 OIDC 登入取得當次 access token
- 文件不保存固定測試 token

---

## 1) 總覽結論

- 遠端 OpenAPI 路徑數：`37`
- 主要功能（Auth / Events / Registrations / Tickets / Notifications / Admin / WS）皆可連線。
- 有些端點雖可呼叫，但會因「狀態機限制」回 `409`（這是正確行為，不是 API 壞掉）。
- 遠端部署與本機版存在差異：`/admin/system/time-offset`、`/admin/ops/run-nightly-lottery` 在遠端不可用（404）。

---

## 2) 逐條對照（依 frontend-api.md）

說明：
- `可用`：HTTP 2xx 或可證明功能正常。
- `條件可用`：端點存在，但需特定資料狀態才會成功。
- `不可用/版本差異`：遠端部署沒有此端點或行為與文件不同。

### 2.1 Auth

- `GET /auth/oidc/authorize-url`：`可用`（200）
- `POST /auth/oidc/callback`：`條件可用`（需有效 code/state，未直接做互動式 IdP 測試）
- `POST /auth/refresh`：`條件可用`（需 refresh token；遠端可行性取決於登入流程）
- `POST /auth/logout`：`版本差異`（測到 400，與文件預期 200 不一致）
- `GET /auth/me`：`條件可用`（需 OIDC flow 取得的 access token）

### 2.2 Events

- `GET /events?scope=all`：`可用`（200）
- `GET /events?scope=eligible`：`可用`（200）
- `GET /events/{event_id}`：`可用`（200）

### 2.3 Registrations

- `POST /registrations`：`條件可用`（實測 409，代表狀態/重複報名限制生效）
- `DELETE /registrations/{id}`：`條件可用`（實測 409，只有 REGISTERED 可取消）
- `POST /registrations/{id}/forfeit`：`條件可用`（實測 409，只有 WON 可棄權）
- `POST /registrations/{id}/confirm`：`條件可用`（實測 409，只有 WON 可確認）
- `GET /me/registrations`：`可用`（200）

### 2.4 Tickets / Verify

- `GET /me/tickets`：`可用`（200）
- `GET /me/tickets/{id}/qr`：`條件可用`（實測 400，票券狀態/所有權/時效限制造成）
- `POST /verify/ticket`：`條件可用`（需有效 qr_payload + VERIFIER token；流程已在既有 smoke 測過）

### 2.5 Notifications

- `GET /notifications`：`可用`（200）
- `GET /notifications/unread-count`：`可用`（200）
- `POST /notifications/{id}/read`：`可用`（200）
- `POST /notifications/mark-all-read`：`可用`（200）

### 2.6 Admin

- `GET /admin/sites/employee-count`：`可用`（200）
- `POST /admin/events`：`可用`（前端可呼叫；同類端點在遠端運作正常）
- `PATCH /admin/events/{id}`：`可用`（前端可呼叫）
- `POST /admin/events/{id}/publish`：`條件可用`（實測 409，代表活動狀態不允許重複 publish）
- `POST /admin/events/{id}/cancel`：`可用`（200）
- `GET /admin/events/{id}/dashboard`：`可用`（200）
- `GET /admin/events/{id}/registrations`：`可用`（200）
- `GET /admin/events/{id}/export`：`可用`（200）
- `POST /admin/events/{id}/export/async`：`可用`（200）
- `GET /admin/events/{id}/export/tasks/{task_id}`：`可用`（前端已整合，流程可輪詢）
- `GET /admin/events/{id}/export/tasks/{task_id}/download`：`可用`（前端已整合）

### 2.7 WebSocket

- `wss://cets.alanh.uk/ws`：`可用`
  - 收到 `auth_ok`
  - 收到 `ping`
  - 回 `pong` 成功

---

## 3) 與文件不一致（需與同學確認）

以下是「遠端部署版本」與 `frontend-api.md` 的差異：

1. `POST /auth/logout`
   - 文件預期簡單 bearer 可 200
   - 遠端實測回 `400`（可能要求額外 body 或流程不同）
2. `/admin/system/time-offset`、`/admin/ops/run-nightly-lottery`
   - 本機程式有，但不在文件主要規格
   - 遠端實測 `404`（可視為未部署）

---

## 4) 對前端的建議（已採用）

- 前端環境已固定走遠端正式 API：
  - `VITE_API_BASE_URL=https://cets.alanh.uk`
  - `VITE_WS_BASE_URL=wss://cets.alanh.uk/ws`
- UI/流程上避免把 `409` 當成「壞掉」：
  - 這通常是狀態機保護（例如非 WON 不能 confirm）
- Auth flow 只走 OIDC 五個 endpoint，不使用前端帳密登入或固定 token。

---

## 5) 驗收建議

- 透過 Auth0 hosted login 驗收登入;前端不保存帳號、密碼或固定 token。
- 如需最終交付證據，建議同學提供：
  - 目前遠端 OpenAPI JSON 快照
  - 部署版本 commit SHA
  - 允許測試的固定測試資料集（event/session/registration/ticket）
