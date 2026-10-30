/**
 * WhatsApp Cloud API sender (server-side automation path).
 *
 * Two delivery modes exist in this codebase — do not confuse them:
 *   1. wa.me click-to-chat (default): free, customer taps Send in WhatsApp.
 *      Implemented client-side in useCartCheckoutSubmit; needs no Meta setup.
 *   2. Cloud API (this file): the SITE sends template messages itself — the
 *      customer never opens WhatsApp. Needs Meta Business verification, a
 *      DEDICATED number (it loses normal WhatsApp use!), an approved
 *      template per message, and ~$0.004/message past the monthly free
 *      allowance. Disabled by default; zero behavior change until configured.
 *
 * Secrets (token) live in service_secrets (key 'wa-api-token'), NEVER in
 * menu KV. Non-secret config lives in service_config (key 'wa-api').
 *
 * Canonical template bodies — submit THESE to Meta (utility category,
 * language "ar"). Param counts are contractual: {{1}}..{{5}} owner,
 * {{1}}..{{4}} customer. Changing slots here requires re-approval there.
 *
 *   OWNER (to the restaurant's own phone):
 *     "طلب جديد #{{1}} 🍔\n{{2}}\nالإجمالي: {{3}}\nالزبون: {{4}} — {{5}}"
 *   CUSTOMER (opt-in checkbox only):
 *     "طلبك #{{1}} وصل {{2}} ✅\nالإجمالي: {{3}}\nتتبعه لحظة بلحظة: {{4}}"
 */

export const WA_API_VERSION = 'v22.0';
export const WA_LANG = 'ar';
export const WA_CONFIG_KEY = 'wa-api';
export const WA_TOKEN_KEY = 'wa-api-token';

const digitsOnly = (s, max) =>
  typeof s === 'string' ? s.replace(/[^0-9]/g, '').slice(0, max) : '';

function fmtInt(n) {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return v.toLocaleString('en-US');
}

const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,64}$/;

/**
 * Sanitize admin-submitted config. Enabled configs must be COMPLETE
 * (half-configured sending is worse than none); disabled configs save
 * whatever is present. Returns { config, errors }.
 */
export function sanitizeWaConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const enabled = r.enabled === true;
  const phoneNumberId = digitsOnly(r.phoneNumberId, 32);
  const ownerRecipient = digitsOnly(r.ownerRecipient, 15);
  const ownerTemplate = typeof r.ownerTemplate === 'string' ? r.ownerTemplate.trim().slice(0, 64) : '';
  const customerTemplate = typeof r.customerTemplate === 'string' ? r.customerTemplate.trim().slice(0, 64) : '';
  const customerUpdates = r.customerUpdates === true;
  const dailyCap =
    Number.isInteger(r.dailyCap) && r.dailyCap >= 1 && r.dailyCap <= 5000 ? r.dailyCap : 100;

  if (ownerTemplate && !TEMPLATE_NAME_RE.test(ownerTemplate)) {
    errors.push('ownerTemplate must match [a-z0-9_] (Meta template name rules)');
  }
  if (customerTemplate && !TEMPLATE_NAME_RE.test(customerTemplate)) {
    errors.push('customerTemplate must match [a-z0-9_] (Meta template name rules)');
  }
  if (ownerRecipient && (ownerRecipient.length < 6 || ownerRecipient.length > 15)) {
    errors.push('ownerRecipient must be 6-15 digits, full international format');
  }
  if (enabled) {
    if (!phoneNumberId) errors.push('phoneNumberId is required when enabled');
    if (!ownerRecipient) errors.push('ownerRecipient is required when enabled');
    if (!ownerTemplate || !TEMPLATE_NAME_RE.test(ownerTemplate)) {
      errors.push('ownerTemplate (approved in Meta) is required when enabled');
    }
    if (customerUpdates && (!customerTemplate || !TEMPLATE_NAME_RE.test(customerTemplate))) {
      errors.push('customerTemplate (approved in Meta) is required for customer updates');
    }
  }

  return {
    config: {
      enabled,
      phoneNumberId,
      ownerRecipient,
      ownerTemplate,
      customerTemplate,
      customerUpdates,
      dailyCap,
    },
    errors,
  };
}

export function isCompleteConfig(cfg) {
  return !!(
    cfg &&
    cfg.enabled === true &&
    cfg.phoneNumberId &&
    cfg.ownerRecipient &&
    cfg.ownerTemplate
  );
}

/** Customer phone -> API recipient: Lebanon default when sent local-length. */
export function toApiPhone(digits, defaultCc = '961') {
  const d = digitsOnly(digits, 15);
  if (!d) return '';
  if (d.startsWith(defaultCc)) return d;
  if (d.length <= 9) return `${defaultCc}${d}`;
  return d;
}

/** "3 أصناف (5 قطع): سجق ×2، زعتر ×1" — compact, Arabic-first, capped. */
export function itemsSummary(items, maxLen = 150) {
  const list = Array.isArray(items) ? items : [];
  let pieces = 0;
  const bits = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const q = typeof it.qty === 'number' ? it.qty : 0;
    if (!(q > 0)) continue;
    pieces += q;
    const nm =
      (it.name && (it.name.ar || it.name.en)) ||
      (typeof it.id === 'string' ? it.id : '');
    const vn =
      it.variantName && (it.variantName.ar || it.variantName.en)
        ? ` (${it.variantName.ar || it.variantName.en})`
        : '';
    if (nm) bits.push(`${nm}${vn} ×${q}`);
  }
  const head = `${list.length} أصناف (${pieces} قطع)`;
  const body = bits.join('، ');
  const out = body ? `${head}: ${body}` : head;
  return out.length > maxLen ? `${out.slice(0, maxLen - 1)}…` : out;
}

export function buildOwnerParams({ number, items, total, currency, name, phone }) {
  return [
    String(number),
    itemsSummary(items),
    `${fmtInt(total)}${currency ? ` ${currency}` : ''}`,
    String(name || '').slice(0, 60),
    String(phone || '').slice(0, 20),
  ];
}

export function buildCustomerParams({ number, total, currency, storeName, trackUrl }) {
  return [
    String(number),
    String(storeName || '').slice(0, 60),
    `${fmtInt(total)}${currency ? ` ${currency}` : ''}`,
    String(trackUrl || '').slice(0, 300),
  ];
}

export function templatePayload({ to, templateName, langCode, params }) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: langCode || WA_LANG },
      components: [
        {
          type: 'body',
          parameters: params.map((text) => ({ type: 'text', text: String(text).slice(0, 1000) })),
        },
      ],
    },
  };
}

/**
 * One template send. Never throws for HTTP-level failures (returns
 * { ok:false, error }) — the order flow must not break on Meta downtime.
 * Only throws on total transport collapse (caller treats as failure too).
 */
export async function sendTemplate({ token, phoneNumberId, to, templateName, langCode, params, timeoutMs = 10000 }) {
  const url = `https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/messages`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    ctrl && timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(templatePayload({ to, templateName, langCode, params })),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) {
      const msg =
        data && data.error && typeof data.error.message === 'string'
          ? data.error.message.slice(0, 200)
          : `http_${res.status}`;
      return { ok: false, error: msg };
    }
    const id =
      data && Array.isArray(data.messages) && data.messages[0] && data.messages[0].id
        ? data.messages[0].id
        : null;
    return { ok: true, id };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** UTC-day budget key shared by check + incr. */
export function waDayKey(date = new Date()) {
  return `waapi:day:${date.toISOString().slice(0, 10)}`;
}

export async function checkCap(kv, cap) {
  const limit = Number.isInteger(cap) && cap > 0 ? cap : 100;
  if (!kv) return { allowed: true, used: 0 };
  try {
    const raw = await kv.get(waDayKey());
    const used = raw ? Number.parseInt(raw, 10) || 0 : 0;
    return { allowed: used < limit, used };
  } catch {
    return { allowed: true, used: 0 };
  }
}

export async function incrCap(kv, n = 1) {
  if (!kv) return;
  try {
    const key = waDayKey();
    const raw = await kv.get(key);
    const used = raw ? Number.parseInt(raw, 10) || 0 : 0;
    await kv.put(String(key), String(used + n), { expirationTtl: 172800 });
  } catch {}
}
