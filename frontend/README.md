# CETS 事件管理平台 - 前端應用

一個類似 Accupass 的現代化活動管理與報名平台前端應用，使用 React + Ant Design 建置。

## 🎯 功能特性

### 使用者端功能
- **活動列表頁面** - 瀏覽所有可報名活動
- **活動詳情** - 查看完整活動資訊、時間、地點、報名狀態
- **活動報名** - 線上報名流程（包含表單驗證）
- **個人中心** - 管理個人資訊、查看報名紀錄與票券
- **票券管理** - 查看票券詳情、QR Code、下載票券
- **通知中心** - 即時 WebSocket 通知、未讀補抓與已讀管理
- **管理端主控台** - 活動建立、編輯、發布、取消與報表匯出
- **驗票端** - QR 掃描核銷、手動驗票與狀態提示音效
- **角色切換** - 開發模式下可快速切換員工/管理員/驗票員角色

### 技術特點
- ✅ React 18 + React Router v6
- ✅ Ant Design 5 UI 組件庫
- ✅ Axios 自動化 API 管理
- ✅ JWT 認證系統
- ✅ 響應式設計（Mobile、Tablet、Desktop）
- ✅ 現代化 UI/UX 設計
- ✅ HTTPS API 連接

## 🚀 快速開始

### 前置需求
- Node.js 16+
- npm 或 yarn

### 安裝依賴

```bash
cd frontend
npm install
```

### 本機環境檔

建立 `.env.local`。本機開發直接呼叫遠端後端，不再透過 Vite proxy：

```env
VITE_BASE_PATH=/
VITE_API_BASE_URL=https://cets.alanh.uk/api/v1
VITE_WS_BASE_URL=wss://cets.alanh.uk/ws
```

如果要改後端位置，請調整 `VITE_API_BASE_URL` 與 `VITE_WS_BASE_URL`。前端會照 `VITE_API_BASE_URL` 原樣使用，不會自動補 `/api/v1`。`VITE_BASE_PATH` 本機維持 `/`；若部署在 GitHub Pages 專案路徑，GitHub Actions 會預設改成 `/<repo>/`。

### 開發模式

```bash
npm run dev
```

應用預設會在 `http://localhost:5173` 打開；如果 port 被占用，Vite 會自動換到下一個可用 port。

### 生產建置

```bash
npm run build
```

輸出文件在 `dist/` 目錄

### 預覽生產版本

```bash
npm run preview
```

## 📁 專案結構

```
frontend/
├── src/
│   ├── api/
│   │   └── client.js           # API 用戶端配置
│   ├── components/
│   │   └── Header.jsx          # 頁首/導航欄
│   ├── context/
│   │   └── UserContext.jsx     # 使用者狀態管理
│   ├── pages/
│   │   ├── EventsList.jsx      # 活動列表頁
│   │   ├── EventDetail.jsx     # 活動詳情頁
│   │   └── UserProfile.jsx     # 個人資料頁
│   ├── styles/
│   │   ├── App.css
│   │   ├── Header.css
│   │   ├── EventsList.css
│   │   ├── EventDetail.css
│   │   ├── Profile.css
│   │   └── index.css           # 全局樣式
│   ├── App.jsx                 # 主應用組件
│   └── main.jsx                # 應用入點
├── index.html                  # HTML 模板
├── vite.config.js              # Vite 配置
└── package.json                # 專案設定
```

## 🔑 API 設定

開發模式直接使用完整 API base URL，例如 `VITE_API_BASE_URL=https://cets.alanh.uk/api/v1`。前端不會自動補 `/api/v1`，後端需允許本機開發來源的 CORS。

### 登入

前端提供員工、管理員、驗票員三個 OIDC / OAuth 登入入口。點擊後會導向後端身分服務產生的企業登入頁，前端不保存或顯示帳密。

### API 端點

#### 身份認證
- `GET /auth/me` - 取得當前使用者資訊
- `POST /auth/logout` - 登出

#### 活動
- `GET /events` - 取得活動列表
- `GET /events/:eventId` - 取得活動詳情

#### 報名
- `GET /registrations` - 取得我的報名紀錄
- `POST /events/:eventId/registrations` - 報名活動

#### 票券
- `GET /tickets` - 取得我的票券
- `GET /tickets/:ticketId` - 取得票券詳情

## 🎨 UI 設計特點

### 色彩方案
- 主色: 以台積電紅黑白為主（`#c8102e`）
- 背景色: `#f5f5f5`
- 文字色: `#001529`

### 響應式設計
- **移動設備** (< 576px)：單列布局
- **平板** (576px - 992px)：兩列布局
- **桌面** (> 992px)：三列以上布局

## 🔒 安全性

- ✅ JWT Token 本地存儲
- ✅ Authorization Header 自動加入
- ✅ 受保護的路由需要認證
- ✅ Token 錯誤自動處理

## 📱 支援的瀏覽器

- Chrome (最新)
- Firefox (最新)
- Safari (最新)
- Edge (最新)

## 🐛 已知問題

- 目前仍依賴後端 API 與 WebSocket 的實際可用性；若後端離線，對應頁面會顯示錯誤提示

## 🚧 未來改進

- [ ] 新增票券匯出功能（PDF/圖片）
- [ ] 支援多語言（繁體中文、英文）
- [ ] 新增活動日曆視圖
- [ ] 支援活動搜尋與進階篩選
- [ ] 整合支付系統（針對付費活動）
- [ ] 新增使用者評論與評分系統
- [ ] 支援 WebSocket 即時更新
- [ ] 針對大型資料表做進一步的分頁與虛擬捲動優化

## 📞 技術支援

如有問題或建議，請聯繫技術團隊。

## 📄 許可證

MIT License
