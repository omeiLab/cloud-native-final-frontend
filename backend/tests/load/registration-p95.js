// K6 load test — Phase 3 NFR gate
// 目標:報名 API P95 < 500ms,500 QPS × 5 min(對齊 plan v3 §7 Phase 3)
//
// 跑法:
//   K6_TOKEN=<JWT> SESSION_ID=<ulid> TICKET_TYPE_ID=<ulid> k6 run tests/load/registration-p95.js
//
// 注意:此腳本會「真的」打報名 API。若無 token 或 SESSION_ID 退化為 list_my smoke。
//        若場次只有 quota=N 名額,500 QPS 會迅速踩到 ALREADY_REGISTERED(409),
//        thresholds 用 status<500 而非 status==201 — 排除業務級錯誤(409 仍計效能)。

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'https://cets.alanh.uk';
const TOKEN = __ENV.K6_TOKEN || '';
const SESSION_ID = __ENV.SESSION_ID || '';
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID || '';

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '4m',  target: 500 },   // 500 QPS x 4 min
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{endpoint:register}': ['p(95)<500'],   // 主指標
    'http_req_duration{endpoint:list_my}':  ['p(95)<500'],
    'http_req_failed':                      ['rate<0.05'],   // 算上 409 寬容
  },
};

export default function () {
  if (TOKEN && SESSION_ID && TICKET_TYPE_ID) {
    // 主測:報名(409 是預期業務錯,不算 fail)
    const res = http.post(
      `${BASE}/api/v1/registrations`,
      JSON.stringify({ session_id: SESSION_ID, ticket_type_id: TICKET_TYPE_ID }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
        },
        tags: { endpoint: 'register' },
      },
    );
    check(res, {
      'register status<500': (r) => r.status < 500,
    });
  } else if (TOKEN) {
    // 退化:列我的報名(讀路徑)
    const res = http.get(`${BASE}/api/v1/me/registrations`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      tags: { endpoint: 'list_my' },
    });
    check(res, { 'list_my 200': (r) => r.status === 200 });
  } else {
    // 無 token:測 health(僅基礎可用性)
    const res = http.get(`${BASE}/health`, { tags: { endpoint: 'health' } });
    check(res, { 'health 200': (r) => r.status === 200 });
  }

  sleep(1);
}
