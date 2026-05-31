# SonarCloud 設定（Monorepo：前後端分開）

仓库：https://github.com/elaine17016/cloud-native-final-team10  
Organization：`elaine17016`

## 两个独立 SonarCloud 项目

| 组件 | Project Key | 配置文件 | CI Workflow |
|------|-------------|----------|-------------|
| 前端 | `elaine17016_cets_frontend` | `frontend/sonar-project.properties` | `.github/workflows/sonarcloud-frontend.yml` |
| 后端 | `elaine17016_cets_backend` | `backend/sonar-project.properties` | `.github/workflows/sonarcloud-backend.yml` |

仪表板链接（需在 SonarCloud 先建立对应项目）：

- 前端：https://sonarcloud.io/project/overview?id=elaine17016_cets_frontend
- 后端：https://sonarcloud.io/project/overview?id=elaine17016_cets_backend

## 一次性手动步骤

### 1) 在 SonarCloud 建立项目

1. 打开 https://sonarcloud.io → 组织 `elaine17016`
2. **+ Analyze new project** → 选择 `cloud-native-final-team10`（或手动创建）
3. 若手动创建，请使用上表 **Project Key**（前后端各一个）

### 2) GitHub Actions Secret

1. https://github.com/elaine17016/cloud-native-final-team10/settings/secrets/actions
2. **New repository secret**
3. Name：`SONAR_TOKEN`
4. Value：SonarCloud → My Account → Security → 生成的 Personal Access Token

> **安全提醒**：Token 只应放在 GitHub Secret，不要提交到仓库或写在聊天里。若已泄露，请在 SonarCloud 撤销后重新生成。

### 3) 触发扫描

- 改 `frontend/**` 会跑 **SonarCloud Frontend**
- 改 `backend/**` 会跑 **SonarCloud Backend**
- 也可在 Actions 页对任一 workflow 点 **Run workflow**

## 本机验证

### 前端

```powershell
cd frontend
npm ci
npm run test:coverage
$env:SONAR_HOST_URL="https://sonarcloud.io"
$env:SONAR_TOKEN="你的TOKEN"
sonar-scanner
```

### 后端

```powershell
cd backend
pip install -r requirements-dev.txt
$env:PYTHONPATH="."
pytest tests/unit --cov=app --cov-report=xml -q
$env:SONAR_HOST_URL="https://sonarcloud.io"
$env:SONAR_TOKEN="你的TOKEN"
sonar-scanner
```

## 常见问题

- **SONAR_TOKEN 空白**：GitHub Secret 未设置或名称不是 `SONAR_TOKEN`
- **Project not found**：SonarCloud 尚未建立对应 `projectKey`
- **后端 coverage 0%**：先跑 `pytest tests/unit --cov=app --cov-report=xml`
- **前端 coverage 0%**：先跑 `npm run test:coverage`
