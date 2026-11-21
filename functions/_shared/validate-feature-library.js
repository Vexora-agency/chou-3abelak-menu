/**
 * Feature-library parsing for restaurant menu documents.
 * Builds the groups/defs lookup maps plus the ensure* mutators that the
 * items phase uses for legacy migration. Single consumer: validateSettings.
 */
import { validateBilingual, stripControls, ID_REGEX } from './validate-core.js';
import { normalizeFeatureColor } from './feature-colors.js';

/**
 * Parses settings.featureGroups + settings.featureDefs.
 * Returns the cleaned lists plus the live library (lookup maps with
 * their ensure* helpers). Appends to `errors` in document order.
 */
export function buildFeatureLibrary(s, errors) {
  // Feature groups (library sections). The kind lives here once per
  // section — features inside inherit it. Missing entirely in old docs →
  // default Sizes/Add-ons sections are created when features need them.
  const cleanPrompt = (raw) => ({
    en: typeof raw.en === 'string' ? stripControls(raw.en).trim().slice(0, 120) : '',
    ar: typeof raw.ar === 'string' ? stripControls(raw.ar).trim().slice(0, 120) : '',
  });
  const featureGroups = [];
  const groupById = new Map();
  if (s.featureGroups !== undefined) {
    if (!Array.isArray(s.featureGroups)) {
      errors.push('settings.featureGroups must be an array');
    } else {
      if (s.featureGroups.length > 20) errors.push('Maximum 20 feature groups allowed');
      for (const g of s.featureGroups) {
        if (!g || typeof g !== 'object') continue;
        const gid = typeof g.id === 'string' ? g.id.trim() : '';
        if (!ID_REGEX.test(gid)) {
          errors.push(`Invalid feature group ID: "${gid}"`);
          continue;
        }
        if (groupById.has(gid)) {
          errors.push(`Duplicate feature group ID: "${gid}"`);
          continue;
        }
        const grp = { id: gid, name: validateBilingual(errors, g.name, `group[${gid}].name`, 80) };
        // Split-quantity rule for ADD-ONS only (default 'multi'). Invalid →
        // error, kept as 'multi' so remaining validation can proceed.
        if (g.selection === undefined) {
          grp.selection = 'multi';
        } else if (g.selection === 'single' || g.selection === 'multi') {
          grp.selection = g.selection;
        } else {
          errors.push(`Invalid feature group selection: "${gid}"`);
          grp.selection = 'multi';
        }
        // Optional customer-facing title/note (absent/empty = legacy).
        if (g.prompt !== undefined) {
          if (!g.prompt || typeof g.prompt !== 'object' || Array.isArray(g.prompt)) {
            errors.push(`Invalid feature group prompt for "${gid}"`);
          } else {
            grp.prompt = cleanPrompt(g.prompt);
          }
        }
        // Optional admin-only section color. Unknown values are ignored
        // (forward-compatible: a future color never blocks a save).
        const color = normalizeFeatureColor(g.color);
        if (color) grp.color = color;
        featureGroups.push(grp);
        groupById.set(gid, grp);
      }
    }
  }
  const ensureGroup = (gid, name) => {
    if (groupById.has(gid)) return groupById.get(gid);
    const grp = { id: gid, name: validateBilingual(errors, name, `group[${gid}].name`, 80) };
    grp.selection = 'multi';
    featureGroups.push(grp);
    groupById.set(gid, grp);
    return grp;
  };

  // Feature library (names only; prices live per item).
  // Parsed here (before cleanSettings) so settings can carry it;
  // legacy docs migrate into it during items validation below.
  const featureDefs = [];
  const featureById = new Map();
  if (s.featureDefs !== undefined) {
    if (!Array.isArray(s.featureDefs)) {
      errors.push('settings.featureDefs must be an array');
    } else {
      if (s.featureDefs.length > 100) errors.push('Maximum 100 features allowed');
      for (const f of s.featureDefs) {
        if (!f || typeof f !== 'object') continue;
        const fid = typeof f.id === 'string' ? f.id.trim() : '';
        if (!ID_REGEX.test(fid)) {
          errors.push(`Invalid feature ID: "${fid}"`);
          continue;
        }
        if (featureById.has(fid)) {
          errors.push(`Duplicate feature ID: "${fid}"`);
          continue;
        }
        const fgid = typeof f.groupId === 'string' ? f.groupId.trim() : '';
        if (!groupById.has(fgid)) {
          errors.push(`Feature "${fid}" group "${fgid}" does not exist`);
          continue;
        }
        // A legacy kind on the feature is ignored (kind now lives per item row)
        const def = { id: fid, groupId: fgid, name: validateBilingual(errors, f.name, `feature[${fid}].name`, 80) };
        // Optional admin-only option color. Unknown values are ignored
        // (forward-compatible: a future color never blocks a save).
        const fcolor = normalizeFeatureColor(f.color);
        if (fcolor) def.color = fcolor;
        featureDefs.push(def);
        featureById.set(fid, def);
      }
    }
  }
  const ensureFeature = (fid, kind, name, groupId) => {
    if (featureById.has(fid)) return featureById.get(fid);
    // Migrated features land in the default section of their kind
    const wantGroup = (typeof groupId === 'string' && groupById.has(groupId))
      ? groupId
      : (kind === 'addon' ? 'addons' : 'sizes');
    if (!groupById.has(wantGroup)) {
      ensureGroup(wantGroup, wantGroup === 'addons' ? { en: 'Add-ons', ar: 'إضافات' } : { en: 'Sizes', ar: 'أحجام' });
    }
    const def = { id: fid, groupId: wantGroup, name: validateBilingual(errors, name, `feature[${fid}].name`, 80) };
    featureDefs.push(def);
    featureById.set(fid, def);
    return def;
  };

  return { featureGroups, featureDefs, featureById, groupById, ensureFeature };
}
