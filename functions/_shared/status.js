/**
 * Ordering availability state machine (no dependencies, pure + Intl).
 * Single source of truth for the client, the public /api/ordering-state
 * endpoint and POST /api/orders. All wall-clock math uses the business
 * IANA timezone via Intl — never the device timezone. DST-safe: offsets
 * are derived at the instant being evaluated, with a refinement pass.
 *
 * getOrderingState(settings, nowMs) ->
 *   { state: 'open'|'paused'|'closed'|'disabled', message: {en,ar}, reopensAt?: ISO }
 */

const DAY_MS = 86400000;

function tzOffsetMinutes(timeZone, utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUTC - utcMs) / 60000);
}

/** Wall-clock in `timeZone` -> UTC ms (converges across DST transitions). */
function zonedTimeToUTC(timeZone, y, monthIndex, day, hour = 0, minute = 0) {
  const wallAsUTC = Date.UTC(y, monthIndex, day, hour, minute, 0);
  let guess = wallAsUTC;
  for (let i = 0; i < 2; i++) guess = wallAsUTC - tzOffsetMinutes(timeZone, guess) * 60000;
  return guess;
}

function tzParts(timeZone, utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  return {
    weekday: String(parts.weekday || '').toLowerCase().slice(0, 3),
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function parseHM(s, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof s === 'string' ? s.trim() : '');
  if (!m) return fallback;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return fallback;
  return { h, mi };
}

const DAY_MAP = { sat: 'sat', sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri' };

const MSG = {
  paused: {
    en: 'We are not taking orders right now. Please try again soon.',
    ar: 'لا نستقبل الطلبات حالياً. حاول مرة أخرى بعد قليل.',
  },
  disabled: {
    en: 'Online ordering is currently disabled.',
    ar: 'الطلب أونلاين غير متاح حالياً.',
  },
  closedWithTime: (hour, minute) => ({
    en: `We are closed now. We open at ${fmt12h(hour, minute, 'en')}.`,
    ar: `نحن مغلقون الآن. نفتح الساعة ${fmt12h(hour, minute, 'ar')}.`,
  }),
  closedPlain: { en: 'We are closed now.', ar: 'نحن مغلقون الآن.' },
};

function pickText(v) {
  const en = v && typeof v.en === 'string' ? v.en.trim() : '';
  const ar = v && typeof v.ar === 'string' ? v.ar.trim() : '';
  return { en, ar };
}

/**
 * "13:05" -> "1:05 PM" / "1:05 م" — every human clock string in the system
 * is 12-hour (short Levantine م/ص in Arabic), mirroring the client's
 * formatTime12h. Never emits 13:00-style 24h text.
 */
function fmt12h(hour, minute, lang) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const m = String(Number(minute)).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (lang === 'ar') return `${h12}:${m} ${h < 12 ? 'ص' : 'م'}`;
  return `${h12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Next opening instant (UTC ms) at/after `nowMs`, scanning at most 8 days
 * over working days. Returns null when there is none (e.g. always closed).
 */
function nextOpening(timezone, workingDays, openHM, nowMs) {
  const days = Array.isArray(workingDays) && workingDays.length ? workingDays : ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
  for (let d = 0; d < 8; d++) {
    const probe = nowMs + d * DAY_MS;
    const p = tzParts(timezone, probe);
    const key = DAY_MAP[p.weekday] || '';
    if (key && !days.includes(key)) continue;
    const openUTC = zonedTimeToUTC(timezone, p.year, p.month - 1, p.day, openHM.h, openHM.mi);
    if (openUTC >= nowMs - 60000) return openUTC;
  }
  return null;
}

export function getOrderingState(settings, nowMs = Date.now()) {
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  const ordering = (settings && settings.ordering && typeof settings.ordering === 'object') ? settings.ordering : {};

  if (!ordering.enabled) {
    return { state: 'disabled', message: { ...MSG.disabled } };
  }

  // Paused (explicit switch). An expired pausedUntil auto-resumes.
  if (ordering.paused === true) {
    const until = typeof ordering.pausedUntil === 'string' && ordering.pausedUntil ? Date.parse(ordering.pausedUntil) : NaN;
    if (!Number.isFinite(until) || now < until) {
      const custom = pickText(ordering.pausedMessage);
      const message = custom.en || custom.ar ? { en: custom.en || MSG.paused.en, ar: custom.ar || MSG.paused.ar } : { ...MSG.paused };
      const out = { state: 'paused', message };
      if (Number.isFinite(until)) out.reopensAt = new Date(until).toISOString();
      return out;
    }
  }

  // Business open/closed.
  let timezone = typeof settings.timezone === 'string' && settings.timezone ? settings.timezone : 'Asia/Beirut';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    timezone = 'Asia/Beirut';
  }
  const mode = settings.statusMode === 'open' || settings.statusMode === 'closed' ? settings.statusMode : 'auto';
  const openHM = parseHM(settings.openTime, { h: 12, mi: 0 });
  const closeHM = parseHM(settings.closeTime, { h: 0, mi: 0 });

  let openNow;
  try {
    if (mode === 'open') {
      openNow = true;
    } else if (mode === 'closed') {
      openNow = false;
    } else {
      const p = tzParts(timezone, now);
      const key = DAY_MAP[p.weekday] || '';
      const days = Array.isArray(settings.workingDays) && settings.workingDays.length
        ? settings.workingDays
        : ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
      if (key && !days.includes(key)) {
        openNow = false;
      } else {
        const cur = p.hour * 60 + p.minute;
        const o = openHM.h * 60 + openHM.mi;
        let c = closeHM.h * 60 + closeHM.mi;
        if (c <= o) {
          // Overnight range (22:00-04:00) or midnight close (00:00).
          if (c === 0) c = 24 * 60;
          openNow = cur >= o || cur < c % (24 * 60);
        } else {
          openNow = cur >= o && cur < c;
        }
      }
    }
  } catch {
    // Fail open: a broken clock config must never block orders by itself.
    openNow = true;
  }

  if (openNow || ordering.acceptWhenClosed === true) {
    return { state: 'open', message: { en: '', ar: '' } };
  }
  let reopensAt = null;
  try {
    if (mode !== 'closed') reopensAt = nextOpening(timezone, settings.workingDays, openHM, now);
  } catch {}
  const out = { state: 'closed', message: { ...MSG.closedPlain } };
  if (reopensAt !== null) {
    const rp = tzParts(timezone, reopensAt);
    out.reopensAt = new Date(reopensAt).toISOString();
    out.message = MSG.closedWithTime(rp.hour, rp.minute);
  }
  return out;
}
