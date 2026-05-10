const { test, expect } = require('@playwright/test');

test('admin smoke flow covers patch modal and notification shell', async ({ page }) => {
  const eventId = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

  await page.route('**/api/v1/**', async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();

    if (path === '/auth/me' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: '01ADMINSMOKE000000000000000',
            employee_id: 'E2EADM01',
            name: 'e2e-admin',
            email: 'admin@example.com',
            department: 'IT',
            site: 'HSINCHU',
            role: 'ADMIN',
            status: 'ACTIVE'
          }
        })
      });
      return;
    }

    if (path === '/notifications' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [], unread_count: 0 }
        })
      });
      return;
    }

    if (path === '/events' && method === 'GET' && url.searchParams.get('scope') === 'all') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: eventId,
                title: '2026 春季家庭日',
                status: 'DRAFT',
                allowed_sites: ['HSINCHU', 'TAIPEI']
              }
            ],
            total: 1,
            page: 1,
            page_size: 50
          }
        })
      });
      return;
    }

    if (path === `/events/${eventId}` && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: eventId,
            title: '2026 春季家庭日',
            description: '原始描述',
            cover_image_url: 'https://example.com/cover.jpg',
            status: 'DRAFT',
            allowed_sites: ['HSINCHU', 'TAIPEI']
          }
        })
      });
      return;
    }

    if (path === `/admin/events/${eventId}/dashboard` && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            ticket_type_progress: [
              { ticket_type_id: 't1', name: '成人票', quota: 200, registered: 12, won: 12, confirmed: 9 }
            ],
            attendance: { total_confirmed: 9, checked_in: 6 }
          }
        })
      });
      return;
    }

    if (path === `/admin/events/${eventId}/registrations` && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [] }
        })
      });
      return;
    }

    if (path === `/admin/events/${eventId}` && method === 'PATCH') {
      const body = request.postDataJSON();
      expect(body.title).toBe('2026 春季家庭日 - 更新版');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: eventId,
            ...body,
            status: 'DRAFT'
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { message: `Unhandled mock for ${method} ${path}` } })
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem('cets_access_token', 'mock-admin-token');
    localStorage.setItem('cets_role_hint', 'ADMIN');
  });

  await page.goto('/admin');

  await expect(page.getByText('管理端主控台')).toBeVisible();
  await page.getByRole('tab', { name: '儀表板' }).click();
  await expect(page.getByRole('button', { name: '編輯活動' })).toBeVisible();

  await page.getByRole('button', { name: '編輯活動' }).click();
  await expect(page.getByText('編輯活動欄位')).toBeVisible();

  const editDialog = page.locator('.ant-modal');
  await editDialog.locator('input#title').fill('2026 春季家庭日 - 更新版');
  await editDialog.locator('textarea#description').fill('已更新描述，測試 PATCH 流程。');
  await page.getByRole('button', { name: '儲存變更' }).click();

  await expect(page.getByText('活動欄位已更新')).toBeVisible();
  await expect(page.getByText('票種進度')).toBeVisible();
});