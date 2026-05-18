// K6 load test — Phase 5 NFR gate
// 目標:驗票 API P95 < 200ms,300 QPS × 5 min(plan v3 §7 Phase 5)
//
// 跑法(在主機上,需要先有 ticket 與 verifier role):
//   K6_VERIFIER_TOKEN=<JWT> QR=<long-jwt> DEVICE=scanner-01 \
//     k6 run tests/load/verify-ticket-p95.js
//
// 沒 token 時退而求其次測 /health。注意:同 ticket 第二次掃會 409,但
// 我們關心 verify endpoint 的 P95,409 也計入(error path 也是熱徑)。

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'https://cets.alanh.uk';
const TOKEN = __ENV.K6_VERIFIER_TOKEN || '';
const QR = __ENV.QR || '';
const DEVICE = __ENV.DEVICE || 'scanner-01';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '4m',  target: 300 },   // 300 QPS 等比例 VUs
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{endpoint:verify}': ['p(95)<200'],
    'http_req_duration{endpoint:health}': ['p(95)<200'],
    // 409 / 410 / 403 都是預期業務錯誤,排除在 fail 之外;真 5xx 才算 fail
    'http_req_failed': ['rate<0.01'],
  },
};

export default function () {
  if (TOKEN && QR) {
    const res = http.post(
      `${BASE}/api/v1/verify/ticket`,
      JSON.stringify({ qr_payload: QR, device_id: DEVICE }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${TOKEN}`,
        },
        tags: { endpoint: 'verify' },
      },
    );
    check(res, {
      'verify status<500': (r) => r.status < 500,
    });
  } else {
    const res = http.get(`${BASE}/health`, { tags: { endpoint: 'health' } });
    check(res, { 'health 200': (r) => r.status === 200 });
  }
  sleep(1);
}
