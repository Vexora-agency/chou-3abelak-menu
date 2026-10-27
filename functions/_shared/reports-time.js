/**
 * Month/timezone math (DST-safe, all boundaries in the business timezone).
 * Split from reports.js — no dependencies, works in Cloudflare Workers and Node.
 * Re-exported from ./reports.js so existing importers keep working.
 */

export const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidMonth(ym) {
  return typeof ym === 'string' && MONTH_RE.test(ym);
}

export function prevMonth(ym) {
  const m = MONTH_RE.exec(ym);
  if (!m) throw new Error('bad_month');
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo === 0) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/* ---------------- 1. Month math (DST-safe) ---------------- */

/** UTC offset in minutes of `timeZone` at the given UTC instant. */
export function tzOffsetMinutes(timeZone, utcMs) {
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

/**
 * Convert a wall-clock time in `timeZone` to a UTC millisecond instant.
 * Two refinement passes converge even across a DST transition.
 */
export function zonedTimeToUTC(timeZone, y, monthIndex, day, hour = 0, minute = 0) {
  const wallAsUTC = Date.UTC(y, monthIndex, day, hour, minute, 0);
  let guess = wallAsUTC;
  for (let i = 0; i < 2; i++) {
    guess = wallAsUTC - tzOffsetMinutes(timeZone, guess) * 60000;
  }
  return guess;
}

/** [startISO, endISO) UTC bounds of month ym as seen in timeZone. */
export function monthBoundsUTC(timeZone, ym) {
  const m = MONTH_RE.exec(ym);
  if (!m) throw new Error('bad_month');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = zonedTimeToUTC(timeZone, y, mo - 1, 1);
  const endMonth = mo === 12 ? { y: y + 1, mo: 1 } : { y, mo: mo + 1 };
  const end = zonedTimeToUTC(timeZone, endMonth.y, endMonth.mo - 1, 1);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/** 'YYYY-MM' of `nowMs` as seen in timeZone. */
export function currentMonthInTZ(timeZone, nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${get('year')}-${get('month')}`;
}

/** Day-of-month (1-31) in timeZone, for the "run on/after day 1" guard. */
export function dayOfMonthInTZ(timeZone, nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric' }).formatToParts(new Date(nowMs));
  return Number((parts.find((p) => p.type === 'day') || {}).value || 1);
}

/** Cached business-TZ extractors: YYYY-MM-DD date and 0-23 hour of an ISO instant. */
export function makeTZExtractors(timeZone) {
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  return {
    day(iso) {
      return dayFmt.format(new Date(iso));
    },
    hour(iso) {
      return Number(hourFmt.format(new Date(iso)));
    },
    dateTime(iso) {
      const d = new Date(iso);
      return { date: dayFmt.format(d), time: `${String(Number(hourFmt.format(d))).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` };
    },
  };
}

/* Note: time below is derived from the TZ hour plus UTC minutes. Minutes are
   timezone-independent, so pairing them is exact. */
