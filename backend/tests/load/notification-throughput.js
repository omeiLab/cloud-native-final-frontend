// Phase 6 NFR — notification 吞吐 + 站內讀取 P95
// 對齊 plan v3 §7 Phase 6:1000 通知/分鐘吞吐 + WS 推播 P95 < 2s
//
// 此測試只跑 HTTP 路徑(/me/notifications GET):取得未讀清單 P95 < 200ms。
// WebSocket 推播 / SMTP 路徑由 K6 ws plugin + Mailpit API 在 Phase 6.5 audit 後另跑。
//
// 跑法:
//   k6 run -e API_BASE=https://cets.alanh.uk -e TOKEN=<jwt> notification-throughput.js
//
// 退出碼非 0 即 NFR fail。
import http from 'k6/http';
import {check, sleep} from 'k6';
import {Trend} from 'k6/metrics';

const list_p95 = new Trend('list_p95_ms');

export const options = {
  scenarios: {
    list_notifications: {
      executor: 'constant-arrival-rate',
      rate: 60, // 60 req/s = 3600/min,壓力測試 list endpoint
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 30,
      maxVUs: 60,
      tags: {scenario: 'list'},
    },
  },
  thresholds: {
    'http_req_failed{scenario:list}': ['rate<0.01'],
    'http_req_duration{scenario:list}': ['p(95)<200'],
    list_p95_ms: ['p(95)<200'],
  },
};

const API_BASE = __ENV.API_BASE || 'https://cets.alanh.uk';
const TOKEN = __ENV.TOKEN || '';

export default function () {
  const params = {
    headers: TOKEN ? {Authorization: `Bearer ${TOKEN}`} : {},
    timeout: '5s',
  };
  const res = http.get(`${API_BASE}/api/v1/me/notifications?page=1&page_size=20`, params);
  check(res, {
    'status 200 or 401(無 token 預設視為 ok)': (r) => r.status === 200 || r.status === 401,
  });
  list_p95.add(res.timings.duration);
  sleep(0.05);
}
