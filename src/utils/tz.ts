/**
 * Business-timezone helpers for the admin dashboard.
 * Mirrors the month math in functions/_shared/reports.js (DST-safe):
 * wall-clock midnight in the business timezone is resolved to a UTC
 * instant with two offset-refinement passes.
 */

export function tzOffsetMinutes(timeZone: string, utcMs: number): number {
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
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
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
 * UTC ISO instant of 00:00 on the first day of the PREVIOUS month,
 * as seen in `timeZone`. Used as `from=` for the dashboard orders fetch
 * so Today / 7 days / This month / Last month all work.
 */
export function prevMonthStartISO(timeZone: string, nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  let y = Number(get('year'));
  let m = Number(get('month')) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  const wall = Date.UTC(y, m - 1, 1);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - tzOffsetMinutes(timeZone, guess) * 60000;
  return new Date(guess).toISOString();
}

/**
 * Wall-clock in the business timezone -> UTC ISO instant. Used to convert
 * datetime-local admin inputs (which carry no zone) without ever touching
 * the device timezone. DST-safe via offset refinement.
 */
export function zonedTimeToUTC(
  timeZone: string,
  y: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0
): string {
  const wall = Date.UTC(y, monthIndex, day, hour, minute, 0);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - tzOffsetMinutes(timeZone, guess) * 60000;
  return new Date(guess).toISOString();
}

/**
 * Format a UTC ISO instant as "YYYY-MM-DDTHH:mm" wall time in the DEVICE
 * timezone. Used for admin schedule pickers so the admin always sees and
 * edits in their own clock. Storage stays UTC (server-compatible).
 */
export function toDatetimeLocalDeviceValue(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * "YYYY-MM-DDTHH:mm" device-wall parts -> UTC ISO instant. The engine
 * resolves the parts in the device timezone (same behavior as every
 * native date picker on the web).
 */
export function deviceWallPartsToUTC(p: { y: number; mo: number; d: number; h: number; mi: number }): string {
  return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, 0).toISOString();
}

/** Parse a "YYYY-MM-DDTHH:mm" datetime-local value into parts (or null). */
export function parseDatetimeLocal(v: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(typeof v === 'string' ? v : '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return { y, mo, d, h, mi };
}

/** Format a UTC ISO instant as "YYYY-MM-DDTHH:mm" wall time in the timezone. */
export function toDatetimeLocalValue(timeZone: string, iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(t));
    const get = (ty: string): string => parts.find((p) => p.type === ty)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    return '';
  }
}
