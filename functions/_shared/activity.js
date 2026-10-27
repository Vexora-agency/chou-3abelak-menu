/**
 * Admin activity log — a single capped, newest-first JSON list in KV.
 * Complements versions (snapshots) and trash (undo storage) with a
 * human-readable "who did what" feed for the admin Activity tab.
 * Writes never fail the calling endpoint (best-effort, guarded).
 */

export const ACT_KEY = 'menu:activity';
const ACT_MAX = 200;

function cleanText(v, max = 120) {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanName(v) {
  if (!v || typeof v !== 'object') return { en: '', ar: '' };
  return {
    en: cleanText(v.en, 80),
    ar: cleanText(v.ar, 80),
  };
}

/**
 * Append one entry. entry = { actor, action, label: {en, ar}, ref? }.
 * ref is optional (e.g. { kind: 'trash', id } enables one-tap undo).
 */
export async function logActivity(env, entry) {
  try {
    const kv = env && env.MENU_KV;
    if (!kv || !entry || typeof entry !== 'object') return false;
    const action = typeof entry.action === 'string' ? entry.action.slice(0, 32) : 'update';
    const actor = typeof entry.actor === 'string' && entry.actor ? entry.actor.slice(0, 64) : 'owner';
    const label = cleanName(entry.label);
    if (!label.en && !label.ar) return false;
    let ref = null;
    if (entry.ref && typeof entry.ref === 'object' && typeof entry.ref.id === 'string' && entry.ref.id) {
      ref = { kind: entry.ref.kind === 'trash' ? 'trash' : 'version', id: String(entry.ref.id).slice(0, 128) };
    }
    let list = [];
    try {
      const raw = await kv.get(ACT_KEY, { type: 'json' });
      if (Array.isArray(raw)) list = raw;
    } catch {}
    const now = new Date().toISOString();
    list.unshift({
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      t: now,
      actor,
      action,
      label,
      ref,
    });
    await kv.put(ACT_KEY, JSON.stringify(list.slice(0, ACT_MAX)));
    return true;
  } catch {
    return false;
  }
}

/** Newest-first entries (validated shape, capped). */
export async function listActivity(env, limit = 100) {
  try {
    const kv = env && env.MENU_KV;
    if (!kv) return [];
    const raw = await kv.get(ACT_KEY, { type: 'json' });
    if (!Array.isArray(raw)) return [];
    const n = typeof limit === 'number' && limit > 0 ? Math.min(Math.floor(limit), ACT_MAX) : 100;
    return raw
      .filter((e) => e && typeof e === 'object' && e.label && (e.label.en || e.label.ar))
      .slice(0, n)
      .map((e) => ({
        id: typeof e.id === 'string' ? e.id : '',
        t: typeof e.t === 'string' ? e.t : '',
        actor: typeof e.actor === 'string' ? e.actor : 'owner',
        action: typeof e.action === 'string' ? e.action : 'update',
        label: { en: String(e.label.en || ''), ar: String(e.label.ar || '') },
        ref: e.ref && typeof e.ref.id === 'string' ? { kind: e.ref.kind === 'trash' ? 'trash' : 'version', id: e.ref.id } : null,
      }));
  } catch {
    return [];
  }
}
