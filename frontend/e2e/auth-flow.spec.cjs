const { test, expect } = require('@playwright/test');

const API = process.env.E2E_API_BASE || 'https://cets.alanh.uk/api/v1';

test.describe('Email 認證', () => {
  test('API 註冊後可於 UI 登入並瀏覽個人頁', async ({ page, request }) => {
    const email = `e2e_${Date.now()}@test.local`;
    const password = 'Abc12345';

    const reg = await request.post(`${API}/auth/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        email,
        password,
        name: 'E2E 使用者',
        role: 'EMPLOYEE',
        site: 'HSINCHU'
      }
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();
    expect(reg.status()).toBe(201);

    await page.goto('/login');
    await page.getByPlaceholder('you@company.com').fill(email);
    await page.getByPlaceholder('密碼').fill(password);
    await page.getByRole('button', { name: 'Email 登入' }).click();

    await expect(page.getByRole('heading', { name: '探索精彩活動' })).toBeVisible({ timeout: 60000 });

    await page.goto('/me');
    await expect(page.getByRole('heading', { name: 'E2E 使用者' })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  });
});
