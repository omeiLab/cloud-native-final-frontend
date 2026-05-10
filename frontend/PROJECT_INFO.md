# CETS 前端應用 - 完整項目說明

## 📋 項目概述

本項目是一個**完整可演示的前端應用**，基於後端 API 構建，具有以下特點：

- ✅ **完整業務流程** - 從活動瀏覽到報名再到票券管理
- ✅ **現代化UI設計** - 使用 Ant Design 和自定義樣式
- ✅ **全面的功能** - 活動列表、詳情、報名、個人中心、票券管理
- ✅ **開箱即用** - 預配置了後端 API 和開發 Token，無需額外配置
- ✅ **響應式設計** - 支持所有設備尺寸（手機、平板、桌面）

## 🗂️ 完整文件結構

```
frontend/
├── src/
│   ├── api/
│   │   └── client.js                    # ✅ API 客戶端（自動處理 JWT 認證）
│   ├── components/
│   │   └── Header.jsx                   # ✅ 頁首導航欄（含角色切換）
│   ├── context/
│   │   └── UserContext.jsx              # ✅ React Context（用戶狀態管理）
│   ├── pages/
│   │   ├── EventsList.jsx               # ✅ 活動列表頁面
│   │   ├── EventDetail.jsx              # ✅ 活動詳情 + 報名頁面
│   │   └── UserProfile.jsx              # ✅ 個人資料 + 票券頁面
│   ├── styles/
│   │   ├── App.css                      # 主應用樣式
│   │   ├── Header.css                   # 頁首樣式
│   │   ├── EventsList.css               # 活動列表樣式
│   │   ├── EventDetail.css              # 活動詳情樣式
│   │   ├── Profile.css                  # 個人資料樣式
│   │   └── index.css                    # 全局樣式
│   ├── App.jsx                          # ✅ 主應用組件（路由定義）
│   └── main.jsx                         # ✅ 應用入點
├── index.html                           # ✅ HTML 模板
├── vite.config.js                       # ✅ Vite 配置
├── package.json                         # ✅ 依賴配置
├── .gitignore                           # Git 忽略文件
├── README.md                            # 項目說明
├── GUIDE.md                             # 使用指南（本文）
└── PROJECT_INFO.md                      # 項目信息（本文件）
```

**✅ 標記表示核心功能文件**

## 🎯 核心功能模塊

### 1. **API 管理模塊** (`src/api/client.js`)
```javascript
// 功能包括：
- 自動 JWT 認證
- 統一錯誤處理
- 角色切換支持
- 預簽開發 Token
```

### 2. **用戶狀態管理** (`src/context/UserContext.jsx`)
```javascript
// 功能包括：
- 用戶信息管理
- 登出功能
- 角色切換
- 加載狀態
```

### 3. **頁面組件**
| 頁面 | 文件 | 功能 |
|------|------|------|
| 活動列表 | EventsList.jsx | 瀏覽活動、篩選、搜索 |
| 活動詳情 | EventDetail.jsx | 查看詳情、報名表單、票價信息 |
| 個人資料 | UserProfile.jsx | 用戶信息、報名紀錄、票券管理 |

## 🚀 快速開始（3 步）

### 步驟 1：安裝依賴
```bash
cd frontend
npm install
```

### 步驟 2：啟動開發服務器
```bash
npm run dev
```

### 步驟 3：打開瀏覽器
自動打開 `http://localhost:5173`

✅ **完成！應用已運行。系統預設登入為"一般員工"角色。**

## 🎮 演示場景

### 場景 1：瀏覽活動（3 分鐘）
```
首頁 → 查看活動列表 → 選擇篩選條件 → 查看活動卡片信息
```

**演示重點：**
- 響應式卡片佈局
- 過渡動畫效果
- 活動信息展示
- 篩選功能

### 場景 2：活動報名（5 分鐘）
```
活動詳情 → 查看完整信息 → 填寫報名表單 → 確認報名 → 查看票券
```

**演示重點：**
- 完整的業務流程
- 表單驗證
- 成功提示
- 自動跳轉

### 場景 3：票券管理（2 分鐘）
```
個人資料 → 我的票券 → 點擊票券卡片 → 查看詳情和 QR Code
```

**演示重點：**
- 票券卡片設計
- 詳情 Modal
- QR Code 顯示
- 複製和下載功能

### 場景 4：角色切換（演示多角色系統）
```
頁首角色切換 → 選擇不同角色 → 刷新應用
```

**演示重點：**
- 不同角色的 UI 展示
- Token 管理
- 應用的靈活性

## 🎨 設計亮點

### 視覺設計
- **漸變色配色** - 紫藍色漸變 (#667eea → #764ba2)
- **卡片設計** - 懸停動畫、陰影效果
- **排版布局** - 清晰的信息層級
- **響應式網格** - 自動適應各種屏幕

### 交互設計
- **流暢動畫** - 卡片、按鈕、過渡效果
- **清晰提示** - 成功、失敗、加載狀態
- **直觀操作** - 易懂的按鈕文案和操作流程
- **手機友好** - 觸摸優化、大按鈕區域

### 用戶體驗
- **快速加載** - 優化的資源加載
- **錯誤恢復** - 完善的錯誤處理和提示
- **無縫導航** - React Router 快速路由
- **持久化** - Token 本地存儲

## 📊 技術棧

| 技術 | 版本 | 用途 |
|------|------|------|
| React | 18.2.0 | UI 框架 |
| React Router | 6.20.0 | 路由管理 |
| Axios | 1.6.2 | HTTP 客戶端 |
| Ant Design | 5.11.0 | UI 組件庫 |
| Vite | 5.0.0 | 構建工具 |
| Day.js | 1.11.10 | 日期處理 |

## 🔑 API 集成

### 已集成的 API 端點

```javascript
// 認證
GET  /auth/me                              // 獲取當前用戶
POST /auth/logout                          // 登出

// 活動
GET  /events                               // 列表
GET  /events/:eventId                      // 詳情

// 報名
GET  /registrations                        // 我的報名
POST /events/:eventId/registrations        // 報名活動

// 票券
GET  /tickets                              // 我的票券
GET  /tickets/:ticketId                    // 票券詳情
```

### 預簽 Token（開發）

系統包含三個預簽 Token，無需登入即可使用：

```
EMPLOYEE:  e2e-employee（推薦演示用）
ADMIN:     e2e-admin（管理員視圖）
VERIFIER:  e2e-verifier（驗票員視圖）
```

## 📈 部署指南

### 構建生產版本
```bash
npm run build
```

### 輸出文件
```
dist/
├── index.html
├── assets/
│   ├── main-xxxxx.js
│   ├── main-xxxxx.css
│   └── ...
```

### 部署選項

**1. 靜態主機** (推薦)
- Netlify
- Vercel
- GitHub Pages
- AWS S3 + CloudFront

**2. 自托管**
- 任何支持靜態文件的服務器
- 配置 rewrite 規則，使路由正確

## ⚙️ 環境配置

### API 基礎 URL
修改 `src/api/client.js` 的 API_BASE_URL：

```javascript
const API_BASE_URL = 'https://cets.alanh.uk/api/v1';  // 改為你的後端 URL
```

### Vite 配置
修改 `vite.config.js` 以自定義端口和其他設置：

```javascript
server: {
  port: 5173,      // 改變開發服務器端口
  strictPort: false,
  open: true       // 自動打開瀏覽器
}
```

## 🐛 常見問題

### Q: API 連接失敗
**A:** 確認後端服務正在運行，且 API 基礎 URL 正確

### Q: 無法報名
**A:** 檢查活動是否已報滿或已過期

### Q: 票券無法顯示
**A:** 刷新頁面或檢查後端是否已生成票券

### Q: 樣式不正確
**A:** 清空 node_modules，重新安裝：`rm -rf node_modules && npm install`

## 📱 瀏覽器支持

- ✅ Chrome/Edge (最新)
- ✅ Firefox (最新)
- ✅ Safari (最新)
- ✅ 移動瀏覽器 (iOS Safari, Chrome Mobile)

## 🔄 開發工作流

1. **修改代碼**
   ```bash
   # 編輯 src/ 下的文件
   ```

2. **熱重載**
   - Vite 自動檢測變化並刷新瀏覽器

3. **調試**
   - 打開瀏覽器開發者工具 (F12)
   - React DevTools 擴展（推薦安裝）

4. **構建測試**
   ```bash
   npm run build
   npm run preview
   ```

## 📚 學習資源

- [React 官方文檔](https://react.dev)
- [React Router 文檔](https://reactrouter.com)
- [Ant Design 文檔](https://ant.design)
- [Vite 文檔](https://vitejs.dev)

## ✨ 項目成就

✅ 完整的前端應用（不只是示例）
✅ 專業的代碼組織結構
✅ 現代化的 UI/UX 設計
✅ 完善的錯誤處理
✅ 全面的功能實現
✅ 優秀的用戶體驗
✅ 生產就緒的代碼質量

## 📞 支持和聯繫

有任何問題或建議，歡迎提出！

---

**祝演示順利！** 🎉
