/**
 * Customer data tool helpers (no PII in logs, masked display, HMAC audit).
 */

import { verifyLogin } from './session.js';

export function digitsOnly(s) {
  return typeof s === 'string' ? s.replace(/[^0-9]/g, '') : '';
}

export function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts
    .map((w) => {
      const first = [...w][0] || '';
      return `${first}***`;
    })
    .join(' ');
}

export function maskPhone(phone) {
  const d = digitsOnly(phone);
  if (d.length < 4) return '****';
  return `${d.slice(0, 2)}${'*'.repeat(Math.max(0, d.length - 4))}${d.slice(-2)}`;
}

export function maskEmail(email) {
  if (typeof email !== 'string' || !email || !email.includes('@')) return '****';
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain) return '****';
  const first = [...local][0] || '*';
  const parts = domain.split('.');
  const head = parts[0] || '';
  const headFirst = [...head][0] || '*';
  const tld = parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
  return `${first}***@${headFirst}***${tld}`;
}

export function maskRow(r) {
  return {
    id: r.id,
    number: r.number,
    createdAt: r.created_at,
    status: r.status,
    type: r.type,
    name: maskName(r.customer_name),
    phone: maskPhone(r.customer_phone),
    email: maskEmail(r.customer_email),
    total: r.total,
    anonymized: r.pii_purged_at !== null && r.pii_purged_at !== undefined,
  };
}

export async function findMatches(db, q) {
  const res = await db
    .prepare('SELECT id, number, created_at, status, type, customer_name, customer_phone, customer_email, total, pii_purged_at FROM orders WHERE phone_norm LIKE ?1 ORDER BY created_at DESC LIMIT 50')
    .bind(`%${q}%`)
    .all();
  return (res && res.results) || [];
}

export async function checkAdminPassword(env, password) {
  const expectedUser = typeof env?.ADMIN_USERNAME === 'string' ? env.ADMIN_USERNAME.trim() : '';
  const storedHash = typeof env?.ADMIN_PASSWORD_HASH === 'string' ? env.ADMIN_PASSWORD_HASH.trim() : '';
  if (!expectedUser || !storedHash || typeof password !== 'string' || !password) return false;
  try {
    return await verifyLogin(expectedUser, password, expectedUser, storedHash);
  } catch {
    return false;
  }
}

/**
 * Audit entry: who/when/action/mode/count + HMAC(phone) truncated to 12 hex.
 * NEVER the phone number or any customer field.
 */
export async function auditCustomerAction(env, { who, action, mode, count, phoneNorm }) {
  try {
    const secret = typeof env?.AUDIT_SECRET === 'string' ? env.AUDIT_SECRET : '';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || 'no-audit-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`customer-data|${phoneNorm}`));
    const phoneHash = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    const rand = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const id = `${new Date().toISOString()}-${rand}`;
    // Audit keys expire after 90 days — unbounded growth would burn the
    // 1 GB namespace quota for data nobody reads after an audit window.
    await env.MENU_KV.put(
      `audit:${id}`,
      JSON.stringify({ who, when: new Date().toISOString(), action, mode, count, phoneHash }),
      { expirationTtl: 90 * 24 * 3600 }
    );
    return id;
  } catch {
    return null;
  }
}

/**
 * Per-action confirm words: each destructive/regulatory action has its OWN
 * word, shown in the UI label ("Type X to confirm"). Typing DELETE must
 * never confirm an export, and vice versa — the word is the last guard.
 */
export const CONFIRM_WORDS = {
  anonymize: ['ANONYMIZE', 'إخفاء'],
  delete: ['DELETE', 'حذف'],
  export: ['EXPORT', 'تصدير'],
};

export function confirmWordOk(s, mode) {
  const list = (mode && CONFIRM_WORDS[mode]) || CONFIRM_WORDS.anonymize;
  const v = typeof s === 'string' ? s.trim() : '';
  return list.includes(v) || list.includes(v.toUpperCase());
}
