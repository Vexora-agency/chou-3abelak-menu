/* k6 load test for chou-3abelak-menu (Pages Functions + D1 + KV).
 *
 * SAFETY: run ONLY against a local stack or a *.pages.dev PREVIEW.
 * NEVER point BASE_URL at the production domain.
 *
 *   Local:  npm run build && npx wrangler pages dev ./dist --port 3000
 *           (seed the menu first: PUT /api/admin/menu with ALLOW_LOCAL_DEV=1,
 *           or reuse persisted local state that already has 52 seed items)
 *   k6:     <k6-binary> run -e BASE_URL=http://127.0.0.1:3000 scripts/load/k6-load-test.js
 *
 * Scenarios (select with --scenario):
 *   baseline_gets  10 VUs, 60s steady      (default quick signal)
 *   stress_gets    ramp 0→100 VUs, ~3.5min (find the knee)
 *   spike_gets     0→200 VUs spike         (D1/KV burst behaviour)
 *   post_orders    4 paced iterations       (D1 WRITE path; see note below)
 *   all            everything above, in order
 *
 * POST NOTE: POST /api/orders is rate-limited to 5 orders / 10 min / IP
 * (KV-backed, functions/api/orders.js RATE_MAX). All k6 VUs share one egress
 * IP, so a 5th+ write inside one window returns 429 by DESIGN. The script
 * therefore sends exactly 4 writes (under the cap) with unique idempotency
 * keys and treats 429 as an expected branch, not a failure. To re-run POST
 * tests, restart the local stack (fresh in-memory KV) — documented in
 * docs/LOAD_TEST.md. To hammer the raw D1 write path without the limiter
 * you must bypass it in a scratch branch — never on shared infra.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';

export const options = {
  scenarios: {
    baseline_gets: {
      executor: 'constant-vus',
      exec: 'getMix',
      vus: 10,
      duration: '60s',
    },
    stress_gets: {
      executor: 'ramping-vus',
      exec: 'getMix',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 25 },
        { duration: '60s', target: 50 },
        { duration: '60s', target: 100 },
        { duration: '30s', target: 0 },
      ],
      startTime: '70s',
    },
    spike_gets: {
      executor: 'ramping-vus',
      exec: 'getMix',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 200 },
        { duration: '30s', target: 200 },
        { duration: '20s', target: 0 },
      ],
      startTime: '280s',
    },
    post_orders: {
      executor: 'shared-iterations',
      exec: 'postOrder',
      vus: 2,
      iterations: 4,
      maxDuration: '120s',
      startTime: '360s',
    },
  },
  thresholds: {
    // GET traffic must stay clean; POST 429s are handled by checks, not here.
    'http_req_failed{scenario:baseline_gets}': ['rate<0.01'],
    'http_req_failed{scenario:stress_gets}': ['rate<0.05'],
    'http_req_duration{scenario:baseline_gets}': ['p(95)<1000'],
  },
};

// Select scenarios: -e SCENARIO=baseline_gets (comma-separated).
// Staggered startTimes only apply to a full run; a filtered run starts now.
if (__ENV.SCENARIO) {
  const keep = __ENV.SCENARIO.split(',');
  for (const k of Object.keys(options.scenarios)) {
    if (!keep.includes(k)) delete options.scenarios[k];
    else if (options.scenarios[k].startTime) options.scenarios[k].startTime = '0s';
  }
}

// Weighted read mix mirrors real traffic: menu JSON dominates,
// ordering-state polls, full page hits are CDN-served (cheap).
export function getMix() {
  const r = Math.random();
  let url;
  if (r < 0.2) url = `${BASE}/`;
  else if (r < 0.7) url = `${BASE}/api/menu`;
  else url = `${BASE}/api/ordering-state`;
  const res = http.get(url, { tags: { endpoint: url.replace(BASE, '') || '/' } });
  check(res, {
    'status is 200': (x) => x.status === 200,
    'TTFB < 1s': (x) => x.timings.waiting < 1000,
  });
  sleep(0.5 + Math.random() * 0.5);
}

// One valid delivery order against the seed menu:
// manakish-zaatar-labneh + mashrouha + extra-veg x2 = 660,000 (≥ minOrder).
// Requires ordering.state === 'open' (seed default) and Origin header
// (functions/api/orders.js checkOrigin).
export function postOrder() {
  const payload = JSON.stringify({
    type: 'delivery',
    customer: { name: 'Load Test', phone: '+96170000000', address: 'Beirut, Test St' },
    items: [{ id: 'manakish-zaatar-labneh', variantId: 'mashrouha', addonIds: ['extra-veg'], qty: 2 }],
    idemKey: uuidv4(),
    lang: 'en',
  });
  const res = http.post(`${BASE}/api/orders`, payload, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    tags: { endpoint: '/api/orders' },
  });
  check(res, {
    'order accepted (200 + orderNumber)': (x) => x.status === 200 && x.json('orderNumber') > 0,
    'or cleanly rate-limited (429)': (x) => x.status === 429,
    'never a 5xx': (x) => x.status < 500,
  });
  sleep(2);
}

export function handleSummary(data) {
  return {
    'scripts/load/results/k6-summary.json': JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE,
        metrics: {
          http_req_duration: data.metrics.http_req_duration?.values,
          http_req_failed: data.metrics.http_req_failed?.values,
          http_reqs: data.metrics.http_reqs?.values,
         vus_max: data.metrics.vus_max?.values,
        },
        checks: data.metrics.checks?.values,
      },
      null,
      2,
    ),
  };
}
