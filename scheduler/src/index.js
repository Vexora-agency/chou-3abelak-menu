/**
 * chou3abelak report scheduler — a tiny standalone Worker (free plan).
 *
 * ONE cron trigger (daily 05:00 UTC) fans out to every site listed in the
 * CLIENT_ENDPOINTS secret (a JSON array of { "url", "secret" }).
 * Each site gets its own secret; a failing site never blocks the others.
 * CPU and subrequests are kept minimal: sequential POSTs, short timeout,
 * tiny log lines with no customer data.
 *
 * Deploy:  cd scheduler && npx wrangler deploy
 * Add/update sites:
 *   npx wrangler secret put CLIENT_ENDPOINTS
 *   # paste: [{"url":"https://<site>/api/internal/run-reports","secret":"<CRON_SECRET>"}]
 */

export default {
  async scheduled(event, env, ctx) {
    let sites = [];
    try {
      const raw = typeof env.CLIENT_ENDPOINTS === 'string' ? env.CLIENT_ENDPOINTS : '[]';
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) sites = parsed;
    } catch {}
    for (const site of sites) {
      const url = site && typeof site.url === 'string' ? site.url : '';
      const secret = site && typeof site.secret === 'string' ? site.secret : '';
      if (!url || !secret) continue;
      ctx.waitUntil(callSite(url, secret, event.cron));
    }
  },
};

async function callSite(url, secret, cron) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cron }),
      signal: ctrl.signal,
    });
    console.log(`run-reports ${res.status}`);
  } catch (e) {
    console.log(`run-reports error: ${(e && e.name) || 'fetch_failed'}`);
  } finally {
    clearTimeout(timer);
  }
}
