/**
 * Signed export envelopes (HMAC-SHA256, BACKUP_SECRET, constant-time).
 * Split from versions.js — only dependency is ./session.js for safeCompare.
 * Works in Cloudflare Workers and Node.
 * Re-exported from ./versions.js so existing importers keep working.
 */

import { safeCompareStrings } from './session.js';

export const SITEID_KEY = 'backup:siteid';

function randHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return typeof s === 'string' ? s : 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
    .join(',')}}`;
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(text)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signPayload(env, payload) {
  const secret = typeof env?.BACKUP_SECRET === 'string' ? env.BACKUP_SECRET : '';
  if (!secret) throw new Error('backup_unconfigured');
  return hmacHex(secret, canonicalize(payload));
}

/** False when unsigned, misconfigured, or tampered (constant-time). */
export async function verifyPayload(env, payload, sig) {
  try {
    if (typeof sig !== 'string' || !sig) return false;
    const secret = typeof env?.BACKUP_SECRET === 'string' ? env.BACKUP_SECRET : '';
    if (!secret) return false;
    const expected = await hmacHex(secret, canonicalize(payload));
    return safeCompareStrings(expected, sig);
  } catch {
    return false;
  }
}

export async function getSiteId(env) {
  try {
    const existing = await env.MENU_KV.get(SITEID_KEY);
    if (existing) return existing;
  } catch {}
  let id;
  try {
    id = crypto.randomUUID();
  } catch {
    id = `site-${Date.now().toString(36)}${randHex(4)}`;
  }
  try {
    await env.MENU_KV.put(SITEID_KEY, id);
  } catch {}
  return id;
}

export function backupEnvelope({ menu, siteId, exportedAt }) {
  const schemaVersion = menu && typeof menu.schemaVersion === 'number' ? menu.schemaVersion : 2;
  return { format: 'chou-backup', schemaVersion, exportedAt, siteId, menu };
}
