/**
 * Pure validation library for restaurant menu document.
 * Usable both inside Cloudflare Pages Functions and admin client.
 *
 * Split by domain (each file has a single reason to change):
 * - validate-core.js: shared primitives (regexes, string sanitizers).
 * - validate.js (this file): validateMenu orchestrator.
 * - validate-settings.js: settings block + feature library.
 * - validate-catalog.js: categories, legacy addon groups, items.
 */

import { validateSettings } from './validate-settings.js';
import { validateCategories, validateLegacyGroups, validateItems } from './validate-catalog.js';

export function validateMenu(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['Document must be a JSON object'], value: null };
  }
  // Size check
  const jsonStr = JSON.stringify(doc);
  if (jsonStr.length > 256 * 1024) {
    errors.push('Menu document exceeds maximum size of 256 KB');
  }
  // Version (optimistic-concurrency counter — never repurposed).
  // schemaVersion is the separate data-model marker (2 = variants/add-ons).
  const version = typeof doc.version === 'number' && Number.isInteger(doc.version) && doc.version >= 1
    ? doc.version
    : 1;
  const schemaVersion = typeof doc.schemaVersion === 'number' && Number.isInteger(doc.schemaVersion) && doc.schemaVersion >= 2
    ? doc.schemaVersion
    : 2;
  // UpdatedAt
  let updatedAt = new Date().toISOString();
  if (typeof doc.updatedAt === 'string') {
    const d = new Date(doc.updatedAt);
    if (!isNaN(d.getTime())) {
      updatedAt = d.toISOString();
    }
  }
  // Settings validation
  const s = doc.settings;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    errors.push('Missing or invalid settings object');
    return { ok: false, errors, value: null };
  }
  const { cleanSettings, featureById, groupById, ensureFeature } = validateSettings(s, errors);
  // Categories validation
  if (!Array.isArray(doc.categories)) {
    errors.push('categories must be an array');
    return { ok: false, errors, value: null };
  }
  const { cleanCategories, categoryIds } = validateCategories(doc.categories, errors);
  const legacyGroups = validateLegacyGroups(doc.addonGroups, errors, categoryIds, ensureFeature);
  // Items validation
  if (!Array.isArray(doc.items)) {
    errors.push('items must be an array');
    return { ok: false, errors, value: null };
  }
  const cleanItems = validateItems(doc.items, errors, categoryIds, legacyGroups, featureById, ensureFeature, groupById);
  return {
    ok: errors.length === 0,
    errors,
    value: {
      version,
      schemaVersion,
      updatedAt,
      settings: cleanSettings,
      categories: cleanCategories,
      items: cleanItems,
    },
  };
}
