/**
 * Unknown-first JSON helpers for untrusted boundaries (fetch, storage).
 *
 * `Response.json()` and `JSON.parse()` are typed `any`, which hides shape
 * bugs until runtime. These helpers force every boundary through `unknown`
 * plus explicit narrowing, so malformed payloads degrade to defaults
 * instead of throwing halfway through a render or a save.
 */

/** Plain-object guard (arrays excluded). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read a fetch body as `unknown` (never throws — null on bad JSON). */
export async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Parse text as `unknown` (never throws — null on bad JSON). */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** String field with fallback (empty string by default). */
export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** Numeric field with fallback. */
export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Bilingual `{ en, ar }` text field with per-language fallback. */
export function langText(v: unknown): { en: string; ar: string } {
  const r = isRecord(v) ? v : {};
  return { en: str(r.en), ar: str(r.ar) };
}
