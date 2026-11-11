/**
 * Customer ETA formatting (track page).
 *
 * Pure helpers — no React, no DOM, only Date + Intl — so they run in plain
 * node too (scripts/test-eta-format.mjs imports this exact file via a
 * data: URL). Deliberately written with JSDoc instead of TS-only syntax so
 * the file stays valid JavaScript as well as valid TypeScript.
 *
 * Digits are always Latin in both languages (ordersDashUtils-style
 * `ar-u-nu-latn` locale): "7:37 م", never "٧:٣٧ م".
 */

/**
 * @param {'en' | 'ar'} lang
 * @returns {string}
 */
function localeFor(lang) {
  return lang === 'ar' ? 'ar-u-nu-latn' : 'en-US';
}

/**
 * Split an instant into 12-hour clock parts via Intl.
 * @param {number} ms epoch millis
 * @param {'en' | 'ar'} lang
 * @param {string} [timeZone] IANA zone (store zone). Omit = device zone.
 * @returns {{ time: string, period: string } | null} e.g. { time: '7:37', period: 'م' }
 */
function parts12(ms, lang, timeZone) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  // NOTE (repo lint): this file is JSDoc-typed JS-in-TS — helper params
  // arrive as `any`, so the parts loop must sit inline over an initialized
  // `const` (never behind a helper param). Inline literals keep TS literal
  // types (a hoisted `opts` object widens hour/minute to string and breaks
  // tsc). Bad zones fall back to the device zone.
  if (typeof timeZone === 'string' && timeZone) {
    try {
      /** @type {Intl.DateTimeFormatPart[]} */
      const zoned = new Intl.DateTimeFormat(localeFor(lang), {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone,
      }).formatToParts(d);
      let hour = '';
      let minute = '';
      let period = '';
      for (const p of zoned) {
        if (p.type === 'hour') hour = p.value;
        else if (p.type === 'minute') minute = p.value;
        else if (p.type === 'dayPeriod') period = p.value;
      }
      if (hour && minute && period) return { time: `${hour}:${minute}`, period };
    } catch {
      // Fall through to the device zone below.
    }
  }
  /** @type {Intl.DateTimeFormatPart[]} */
  const plain = new Intl.DateTimeFormat(localeFor(lang), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  let hour = '';
  let minute = '';
  let period = '';
  for (const p of plain) {
    if (p.type === 'hour') hour = p.value;
    else if (p.type === 'minute') minute = p.value;
    else if (p.type === 'dayPeriod') period = p.value;
  }
  if (!hour || !minute || !period) return null;
  return { time: `${hour}:${minute}`, period };
}

/**
 * Single instant as a 12-hour clock string, e.g. "7:37 م" (ar) / "7:37 PM" (en).
 * Latin digits in both languages. Returns '' when unparseable (caller hides).
 * @param {string} iso ISO instant
 * @param {'en' | 'ar'} lang
 * @param {string} [timeZone] IANA zone (store zone). Omit = device zone.
 * @returns {string}
 */
export function formatTime12(iso, lang, timeZone) {
  if (typeof iso !== 'string' || !iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const p = parts12(ms, lang, timeZone);
  if (!p) return '';
  return `${p.time} ${p.period}`;
}

/**
 * ETA window around one ETA instant: ±20% of the remaining wait, with a
 * minimum of ±5 minutes and a MAXIMUM of ±30 minutes on each side. Returns
 * symmetric ISO bounds, or null when the ETA is unparseable (caller hides
 * the banner — never trap).
 *
 * Why the cap: kitchen uncertainty does not grow with calendar distance —
 * a next-day ETA 30 h out is not ±6 h uncertain. An uncapped window prints a
 * start edge ("tomorrow 4:05 PM") that reads as a different promise than
 * the confirmation email's center instant ("tomorrow 10:04 PM") for the
 * SAME order, while both day labels still agree. The cap keeps the site
 * banner an honest "around the promised time" on every surface that shares
 * this helper (track page, order bell).
 * @param {string} etaIso ISO ETA instant
 * @param {number} [nowMs] defaults to Date.now()
 * @returns {{ fromIso: string, toIso: string } | null}
 */
export function etaRange(etaIso, nowMs) {
  const etaMs = typeof etaIso === 'string' ? Date.parse(etaIso) : NaN;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (Number.isNaN(etaMs) || Number.isNaN(now)) return null;
  const MIN_HALF_MS = 5 * 60 * 1000;
  const MAX_HALF_MS = 30 * 60 * 1000;
  const half = Math.min(MAX_HALF_MS, Math.max(MIN_HALF_MS, 0.2 * Math.max(0, etaMs - now)));
  return {
    fromIso: new Date(etaMs - half).toISOString(),
    toIso: new Date(etaMs + half).toISOString(),
  };
}

/**
 * Range as "7:37 – 7:47 م" (ar) / "7:37 – 7:47 PM" (en): the period marker
 * appears once when both ends share it, on BOTH sides across an AM/PM (or
 * midnight) boundary — "11:55 م – 12:05 ص" / "11:55 PM – 12:05 AM".
 * Returns '' when either end is unparseable (caller hides).
 * @param {string} fromIso ISO range start
 * @param {string} toIso ISO range end
 * @param {'en' | 'ar'} lang
 * @param {string} [timeZone] IANA zone (store zone). Omit = device zone.
 * @returns {string}
 */
export function formatEtaRange(fromIso, toIso, lang, timeZone) {
  let fromMs = typeof fromIso === 'string' ? Date.parse(fromIso) : NaN;
  let toMs = typeof toIso === 'string' ? Date.parse(toIso) : NaN;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return '';
  if (fromMs > toMs) {
    const t = fromMs;
    fromMs = toMs;
    toMs = t;
  }
  const a = parts12(fromMs, lang, timeZone);
  const b = parts12(toMs, lang, timeZone);
  if (!a || !b) return '';
  if (a.period === b.period) return `${a.time} – ${b.time} ${b.period}`;
  return `${a.time} ${a.period} – ${b.time} ${b.period}`;
}

/**
 * Day key (YYYY-MM-DD) of an instant in a zone — the unit "اليوم / غداً"
 * compares. Falls back to the device zone on a bad zone, '' on garbage.
 * @param {number} ms epoch millis
 * @param {string} [timeZone] IANA zone. Omit = device zone.
 * @returns {string}
 */
export function dayKeyInZone(ms, timeZone) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '';
  // Same inline-loop rule as parts12 above: the parts array must be consumed
  // in the scope of its initialized `const` (helper params arrive as `any`).
  if (typeof timeZone === 'string' && timeZone) {
    try {
      /** @type {Intl.DateTimeFormatPart[]} */
      const zoned = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone,
      }).formatToParts(new Date(ms));
      let y = '';
      let m = '';
      let d = '';
      for (const p of zoned) {
        if (p.type === 'year') y = p.value;
        else if (p.type === 'month') m = p.value;
        else if (p.type === 'day') d = p.value;
      }
      if (y && m && d) return `${y}-${m}-${d}`;
    } catch {
      // Fall through to the device zone below.
    }
  }
  try {
    /** @type {Intl.DateTimeFormatPart[]} */
    const plain = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));
    let y = '';
    let m = '';
    let d = '';
    for (const p of plain) {
      if (p.type === 'year') y = p.value;
      else if (p.type === 'month') m = p.value;
      else if (p.type === 'day') d = p.value;
    }
    if (!y || !m || !d) return '';
    return `${y}-${m}-${d}`;
  } catch {
    return '';
  }
}

/**
 * Short day label for an ETA instant in the store zone: "اليوم" / "غداً" /
 * "6 نوفمبر" (ar) or "Today" / "Tomorrow" / "Nov 6" (en). Same-zone day
 * comparison so the 30-hour ETA the owner saw reads "غداً" instead of a
 * bare time that looks like today. Returns '' on garbage (caller hides).
 * @param {string} iso ISO ETA instant
 * @param {'en' | 'ar'} lang
 * @param {string} [timeZone] IANA zone. Omit = device zone.
 * @param {number} [nowMs] defaults to Date.now()
 * @returns {string}
 */
export function formatEtaDay(iso, lang, timeZone, nowMs) {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return '';
  const now = typeof nowMs === 'number' && !Number.isNaN(nowMs) ? nowMs : Date.now();
  const tz = typeof timeZone === 'string' && timeZone ? timeZone : undefined;
  const etaDay = dayKeyInZone(ms, tz);
  const today = dayKeyInZone(now, tz);
  if (!etaDay || !today) return '';
  if (etaDay === today) return lang === 'ar' ? 'اليوم' : 'Today';
  // Tomorrow = today + 1 calendar day in the same zone (DST-safe: compares
  // keys instead of adding 24h).
  try {
    const tomorrowKey = dayKeyInZone(now + 24 * 60 * 60 * 1000, tz);
    // A 24h jump can skip a day across a DST fall-back; walk forward/back a
    // second day to be sure before falling through to the date form.
    if (etaDay === tomorrowKey) return lang === 'ar' ? 'غدًا' : 'Tomorrow';
    if (tomorrowKey !== today) {
      const dayAfter = dayKeyInZone(now + 2 * 24 * 60 * 60 * 1000, tz);
      if (etaDay === dayAfter && dayAfter !== tomorrowKey && dayAfter !== today) {
        // The day after tomorrow still renders as a date (no "بعد غداً"
        // special-case — keeps the banner short and unambiguous).
      }
    }
  } catch {}
  // Farther out: short date in the same zone, latin digits both languages.
  try {
    return (tz
      ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', {
          day: 'numeric',
          month: 'short',
          timeZone: tz,
        })
      : new Intl.DateTimeFormat(lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', {
          day: 'numeric',
          month: 'short',
        })
    ).format(new Date(ms));
  } catch {
    return '';
  }
}

/**
 * Range with a day prefix — what the track page and the bell now render:
 * "اليوم 7:37 – 7:47 م" / "غداً 7:37 – 7:47 م" / "6 نوفمبر، 7:37 – 7:47 م"
 * (en: "Today 7:37 – 7:47 PM" / "Tomorrow …" / "Nov 6, 7:37 – 7:47 PM").
 * Day and clock share ONE zone so the date and the time can never disagree
 * (the email-vs-track mismatch the owner reported). Returns '' on garbage.
 * @param {string} fromIso ISO range start
 * @param {string} toIso ISO range end
 * @param {'en' | 'ar'} lang
 * @param {string} [timeZone] IANA zone. Omit = device zone.
 * @param {number} [nowMs] defaults to Date.now()
 * @returns {string}
 */
export function formatEtaRangeWithDay(fromIso, toIso, lang, timeZone, nowMs) {
  const range = formatEtaRange(fromIso, toIso, lang, timeZone);
  if (!range) return '';
  // Day anchor = window MIDPOINT (= the ETA center: the window is symmetric),
  // not the window start — a wide far-ETA window can start a day early.
  // typeof-guards first (repo convention: untrusted strings never go raw
  // into Date.parse — same shape as etaRange/formatTime12 above).
  const fromStr = typeof fromIso === 'string' ? fromIso : '';
  const toStr = typeof toIso === 'string' ? toIso : '';
  let anchor = fromStr || toStr;
  try {
    const a = fromStr ? Date.parse(fromStr) : NaN;
    const b = toStr ? Date.parse(toStr) : NaN;
    if (!Number.isNaN(a) && !Number.isNaN(b)) anchor = new Date((a + b) / 2).toISOString();
  } catch {}
  const day = formatEtaDay(anchor, lang, timeZone, nowMs);
  if (!day) return range;
  return lang === 'ar' ? `${day}، ${range}` : `${day}, ${range}`;
}

/**
 * Single instant with a day prefix — what the confirmation email now shows
 * so it points at the SAME calendar day as the track range:
 * "اليوم 7:37 م" / "غداً 7:37 م" / "6 نوفمبر، 7:37 م".
 * @param {string} iso ISO ETA instant
 * @param {'en' | 'ar'} lang
 * @param {string} [timeZone] IANA zone. Omit = device zone.
 * @param {number} [nowMs] defaults to Date.now()
 * @returns {string}
 */
export function formatEtaInstantWithDay(iso, lang, timeZone, nowMs) {
  const clock = formatTime12(iso, lang, timeZone);
  if (!clock) return '';
  const day = formatEtaDay(iso, lang, timeZone, nowMs);
  if (!day) return clock;
  return lang === 'ar' ? `${day}، ${clock}` : `${day}, ${clock}`;
}
