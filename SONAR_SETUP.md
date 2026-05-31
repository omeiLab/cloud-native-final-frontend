# SonarCloud 設定（CETS Frontend）

## 已完成的項目

- GitHub Public Repo：https://github.com/elaine17016/cloud-native-final-team10
- 前端已可 `npm run build`、單元測試 6/6 通過
- Coverage 已產生 `frontend/coverage/lcov.info`（約 52%）
- `frontend/sonar-project.properties` 已設定
  - Organization：`elaine17016`
  - Project Key：`elaine17016_cets-frontend`
- CI：`.github/workflows/sonarcloud.yml`

## 你需要手動完成的最後 3 步（約 5 分鐘）

### 1) 在 SonarCloud 建立專案

1. 打開 https://sonarcloud.io
2. 確認組織已導入（Organization Key：`elaine17016`）
3. **+ Analyze new project** → 選 `cloud-native-final-team10`（或沿用既有 `cets-frontend` 專案 key）
4. 若手動建立，Project Key 請使用：`elaine17016_cets-frontend`

### 2) 產生 Token

1. SonarCloud → 右上角頭像 → **My Account**
2. **Security** → **Generate Token**
3. 名稱例如：`cets-frontend-github`
4. 複製 Token（只會顯示一次）

### 3) 加到 GitHub Secret

1. 打開 https://github.com/elaine17016/cets-frontend/settings/secrets/actions
2. **New repository secret**
3. Name：`SONAR_TOKEN`
4. Value：貼上剛剛的 Token

### 4) 重新跑 CI

1. https://github.com/elaine17016/cets-frontend/actions
2. 選 **SonarCloud** workflow → **Run workflow**

成功後可在這裡看報告：

https://sonarcloud.io/project/overview?id=elaine17016_cets-frontend

## 本機手動掃描（選用）

```powershell
cd frontend
$env:SONAR_HOST_URL="https://sonarcloud.io"
$env:SONAR_TOKEN="你的TOKEN"
npm run test:coverage
sonar-scanner
```

需先安裝 SonarScanner CLI。

## 常見問題

- **CI 顯示 SONAR_TOKEN 空白**：Secret 尚未設定或名稱不是 `SONAR_TOKEN`
- **Project not found**：SonarCloud 尚未建立 `elaine17016_cets-frontend` 專案
- **Coverage 0%**：先跑 `npm run test:coverage` 再掃描
