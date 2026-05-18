// K6 load test — Phase 2 NFR gate
// 目標:列表 API P95 < 500ms,50 VU × 5 min(對齊 plan v3 §7 Phase 2)
//
// 跑法(在主機 SSH 進 cluster 後):
//   K6_TOKEN=<JWT> k6 run tests/load/event-list-p95.js
//
// 沒 token 時退而求其次測 /health(基礎設施可用性)。

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'https://cets.alanh.uk';
const TOKEN = __ENV.K6_TOKEN || '';

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // ramp up
    { duration: '4m',  target: 50 },   // 50 VU × 4 min
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    'http_req_duration{endpoint:list}': ['p(95)<500'],   // 列表 P95 < 500ms
    'http_req_duration{endpoint:health}': ['p(95)<200'], // health 基準
    'http_req_failed': ['rate<0.01'],                    // 錯誤率 < 1%
  },
};

export default function () {
  // 主測:列表(需 JWT)
  if (TOKEN) {
    const res = http.get(`${BASE}/api/v1/events?page=1&page_size=20`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      tags: { endpoint: 'list' },
    });
    check(res, {
      'list status 200': (r) => r.status === 200,
      'list returns items': (r) => r.json('items') !== undefined,
    });
  } else {
    // 沒 token 時退而求其次:測健康端點(只驗 ingress / Pod 可用)
    const res = http.get(`${BASE}/health`, { tags: { endpoint: 'health' } });
    check(res, { 'health 200': (r) => r.status === 200 });
  }

  sleep(1);
}
