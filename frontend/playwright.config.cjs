const { defineConfig } = require('@playwright/test');

const e2eApiBase = 'https://cets.alanh.uk/api/v1';
const e2eWsBase = 'wss://cets.alanh.uk/ws';

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  reporter: 'line',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' }
    }
  ],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1080 },
    actionTimeout: 15000,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    cwd: __dirname,
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: false,
    timeout: 180000,
    env: {
      ...process.env,
      VITE_API_BASE_URL: e2eApiBase,
      VITE_WS_BASE_URL: e2eWsBase
    }
  }
});