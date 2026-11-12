/**
 * Suspicious-order risk scoring (WebCrypto-free pure JS + fail-open DB reads).
 * Stored at insert (orders.risk_score / orders.risk_reasons); the release
 * sweep renders the Telegram review line from the stored columns.
 *
 * Score (additive, integers only):
 *   +40 test-like name ('test', 'abc', 'xxx', single-char, digits-only)
 *   +30 repeated-digit or fully-sequential phone (e.g. 77777777, 12345678)
 *   +15 order placed 00:00–06:00 Asia/Beirut
 *   +25 phone has >=1 cancelled order in the last 7 days
 *   +25 phone has >=2 orders in the last 24 hours
 * needsReview = score >= RISK_THRESHOLD. Reasons are STABLE CODES (never
 * display strings) so every renderer (Telegram, dashboard badge) localizes
 * from RISK_REASON_LABEL — never the numeric score, never raw codes.
 */

import {
  countRecentCancelledByPhone,
  countRecentOrdersByPhone,
} from './repositories/orders.repo.js';

/** needsReview threshold (single source for scoring; mapOrderRow mirrors it). */
export const RISK_THRESHOLD = 50;

/** Exact test-like names (case-insensitive, trimmed). Real names never match. */
const TEST_NAMES = ['test', 'abc', 'xxx'];

const REASONS = {
  testName: 'test_name',
  phonePattern: 'repeated_digits',
  nightOrder: 'night_order',
  recentCancel: 'many_cancelled',
  frequentOrders: 'frequent_phone',
};

/** Bilingual display labels per stable reason code (single source — Telegram + badge mirror this). */
export const RISK_REASON_LABEL = {
  test_name: { ar: 'اسم تجريبي', en: 'test-like name' },
  repeated_digits: { ar: 'رقم مكرر', en: 'repeated digits' },
  night_order: { ar: 'طلب ليلي', en: 'night order' },
  many_cancelled: { ar: 'إلغاءات سابقة', en: 'past cancellations' },
  frequent_phone: { ar: 'طلبات متكررة', en: 'frequent orders' },
};

/** +40: exact test names, single-char names, digits-only names. */
export function isTestLikeName(name) {
  if (typeof name !== 'string') return false;
  const t = name.trim();
  if (!t) return false;
  if (t.length <= 1) return true;
  if (/^[0-9]+$/.test(t)) return true;
  return TEST_NAMES.includes(t.toLowerCase());
}

/**
 * +30: the WHOLE normalized phone is one repeated digit (6+ chars) or a
 * full ascending/descending run (e.g. 12345678 / 87654321). Substring runs
 * do NOT count — real Lebanese numbers like 70-123456 contain 123456 and
 * must never be flagged.
 */
export function isSuspiciousPhone(phoneNorm) {
  if (typeof phoneNorm !== 'string' || phoneNorm.length < 6) return false;
  if (!/^[0-9]+$/.test(phoneNorm)) return false;
  if (/^(\d)\1+$/.test(phoneNorm)) return true;
  let asc = true;
  let desc = true;
  for (let i = 1; i < phoneNorm.length; i++) {
    const d = (phoneNorm.charCodeAt(i) - phoneNorm.charCodeAt(i - 1) + 10) % 10;
    if (d !== 1) asc = false;
    if (d !== 9) desc = false;
    if (!asc && !desc) return false;
  }
  return true;
}

/** Beirut hour (0–23) for an instant, or null when unresolvable. */
export function beirutHour(nowMs) {
  try {
    const t = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Beirut',
      hour: 'numeric',
      hour12: false,
    }).format(new Date(nowMs));
    const h = parseInt(t, 10);
    return Number.isFinite(h) ? h % 24 : null;
  } catch {
    return null;
  }
}

/**
 * Static (no-DB) portion of the score. Pure — unit-testable.
 * Returns { score, reasons }.
 */
export function scoreStaticRisk({ name, phoneNorm, nowMs }) {
  let score = 0;
  const reasons = [];
  if (isTestLikeName(name)) {
    score += 40;
    reasons.push(REASONS.testName);
  }
  if (isSuspiciousPhone(phoneNorm)) {
    score += 30;
    reasons.push(REASONS.phonePattern);
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const h = beirutHour(now);
  if (h !== null && h >= 0 && h < 6) {
    score += 15;
    reasons.push(REASONS.nightOrder);
  }
  return { score, reasons };
}

/**
 * Phone-history portion (needs DB). Fail-OPEN: any DB failure yields
 * { score: 0, reasons: [] } so a blip never eats a real dinner order.
 */
export async function scorePhoneHistory(db, phoneNorm, nowMs) {
  try {
    if (!db || typeof phoneNorm !== 'string' || !phoneNorm) return { score: 0, reasons: [] };
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const day = new Date(now - 24 * 3600 * 1000).toISOString();
    const week = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
    const [recent, cancelled] = await Promise.all([
      countRecentOrdersByPhone(db, phoneNorm, day),
      countRecentCancelledByPhone(db, phoneNorm, week),
    ]);
    let score = 0;
    const reasons = [];
    if (cancelled >= 1) {
      score += 25;
      reasons.push(REASONS.recentCancel);
    }
    if (recent >= 2) {
      score += 25;
      reasons.push(REASONS.frequentOrders);
    }
    return { score, reasons };
  } catch {
    return { score: 0, reasons: [] };
  }
}

/**
 * Full assessment for a validated order. Fail-open on history (static
 * signals always apply). Returns { riskScore, riskReasons, needsReview }.
 */
export async function assessOrderRisk({ name, phoneNorm } = {}, { db = null, nowMs = Date.now() } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const s = scoreStaticRisk({ name, phoneNorm, nowMs: now });
  let h = { score: 0, reasons: [] };
  try {
    h = await scorePhoneHistory(db, phoneNorm, now);
  } catch {
    h = { score: 0, reasons: [] };
  }
  const riskScore = s.score + h.score;
  const riskReasons = [...s.reasons, ...h.reasons].slice(0, 10);
  return { riskScore, riskReasons, needsReview: riskScore >= RISK_THRESHOLD };
}
