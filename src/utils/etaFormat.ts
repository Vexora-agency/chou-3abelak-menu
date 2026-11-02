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
 * @returns {{ time: string, period: string } | null} e.g. { time: '7:37', period: 'م' }
 */
function parts12(ms, lang) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  /** @type {Intl.DateTimeFormatPart[]} */
  const list = new Intl.DateTimeFormat(localeFor(lang), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  let hour = '';
  let minute = '';
  let period = '';
  for (const p of list) {
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
 * @returns {string}
 */
export function formatTime12(iso, lang) {
  if (typeof iso !== 'string' || !iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const p = parts12(ms, lang);
  if (!p) return '';
  return `${p.time} ${p.period}`;
}

/**
 * ETA window around one ETA instant: ±20% of the remaining wait, with a
 * minimum of ±5 minutes on each side. Returns symmetric ISO bounds, or null
 * when the ETA is unparseable (caller hides the banner — never trap).
 * @param {string} etaIso ISO ETA instant
 * @param {number} [nowMs] defaults to Date.now()
 * @returns {{ fromIso: string, toIso: string } | null}
 */
export function etaRange(etaIso, nowMs) {
  const etaMs = typeof etaIso === 'string' ? Date.parse(etaIso) : NaN;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (Number.isNaN(etaMs) || Number.isNaN(now)) return null;
  const MIN_HALF_MS = 5 * 60 * 1000;
  const half = Math.max(MIN_HALF_MS, 0.2 * Math.max(0, etaMs - now));
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
 * @returns {string}
 */
export function formatEtaRange(fromIso, toIso, lang) {
  let fromMs = typeof fromIso === 'string' ? Date.parse(fromIso) : NaN;
  let toMs = typeof toIso === 'string' ? Date.parse(toIso) : NaN;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return '';
  if (fromMs > toMs) {
    const t = fromMs;
    fromMs = toMs;
    toMs = t;
  }
  const a = parts12(fromMs, lang);
  const b = parts12(toMs, lang);
  if (!a || !b) return '';
  if (a.period === b.period) return `${a.time} – ${b.time} ${b.period}`;
  return `${a.time} ${a.period} – ${b.time} ${b.period}`;
}
