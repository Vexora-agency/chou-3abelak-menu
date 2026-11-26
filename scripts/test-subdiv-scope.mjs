/**
 * Delivery-subdivision scope contract.
 * Run: node scripts/test-subdiv-scope.mjs
 *
 * No network. Proves: subdivision extraction (selected/ALL/garbage),
 * fail-open scope building (unknown boxes never filter), box matching,
 * and row filtering that keeps coord-less rows for pick-time enforcement.
 */

import { createAsserts } from './_helpers/shared.mjs';
import {
  SUBDIV_BBOXES,
  buildZoneScope,
  extractServiceSubdivisions,
  filterRowsByScope,
  inScopeBoxes,
} from '../functions/_shared/subdiv-scope.js';

const { ok: check, summary } = createAsserts();

const menuSel = (countries) => ({ settings: { ordering: { deliveryZones: { mode: 'selected', countries } } } });

check('non-selected mode means worldwide', JSON.stringify(extractServiceSubdivisions({ settings: { ordering: { deliveryZones: { mode: 'all', countries: [] } } } })) === '{}');
check('missing menu means worldwide', JSON.stringify(extractServiceSubdivisions(null)) === '{}');
check('garbage menu means worldwide', JSON.stringify(extractServiceSubdivisions({})) === '{}');
check('ALL stays ALL', JSON.stringify(extractServiceSubdivisions(menuSel([{ cc: 'lb' }]))) === '{"LB":"ALL"}');
check('explicit codes normalize + dedupe',
  JSON.stringify(extractServiceSubdivisions(menuSel([{ cc: 'lb', subdivisions: ['LB-JL', ' lb-ba ', 'LB-JL'] }]))) === '{"LB":["LB-JL","LB-BA"]}');
check('empty code list falls back to ALL',
  JSON.stringify(extractServiceSubdivisions(menuSel([{ cc: 'lb', subdivisions: [] }]))) === '{"LB":"ALL"}');
check('bad entries skipped', JSON.stringify(extractServiceSubdivisions(menuSel([null, { cc: 'xx1' }, { cc: 'eg', subdivisions: ['EG-C'] }]))) === '{"EG":["EG-C"]}');

const scopeLB = [{ cc: 'LB', bboxes: [[[33.8, 35.4, 33.95, 35.55]]] }];
check('point inside box matches', inScopeBoxes(33.88, 35.5, scopeLB[0].bboxes) === true);
check('point outside every box misses', inScopeBoxes(34.5, 36.0, scopeLB[0].bboxes) === false);
check('garbage coords never match', inScopeBoxes(NaN, 35.5, scopeLB[0].bboxes) === false && inScopeBoxes(33.88, null, scopeLB[0].bboxes) === false);
check('garbage boxes never match', inScopeBoxes(33.88, 35.5, null) === false && inScopeBoxes(33.88, 35.5, []) === false);

const rows = [
  { label: 'in', lat: 33.88, lng: 35.5 },
  { label: 'out', lat: 34.5, lng: 36.0 },
  { label: 'coordless', lat: null, lng: null },
];
check('filter keeps in-scope + coord-less, drops out-of-scope',
  (() => {
    const out = filterRowsByScope(rows, scopeLB);
    return out.length === 2 && out[0].label === 'in' && out[1].label === 'coordless';
  })());
check('null scope returns input untouched', filterRowsByScope(rows, null) === rows);
check('empty scope returns input untouched', filterRowsByScope(rows, []).length === 3);
check('garbage rows filtered safely', filterRowsByScope(null, scopeLB).length === 0);

check('scope is null without a menu', buildZoneScope(null) === null);
check('scope is null for whole-country service', buildZoneScope(menuSel([{ cc: 'lb' }])) === null);
check('scope is null for unknown boxes (fail open)',
  buildZoneScope(menuSel([{ cc: 'eg', subdivisions: ['EG-C'] }])) === null);
{
  const scope = buildZoneScope(menuSel([{ cc: 'lb', subdivisions: ['LB-JL', 'LB-XX'] }]));
  check('scope carries known boxes, skips unknown codes',
    Array.isArray(scope) && scope.length === 1 && scope[0].cc === 'LB'
    && scope[0].bboxes.length === 1
    && JSON.stringify(scope[0].bboxes[0]) === JSON.stringify([33.4922, 35.3849, 34.2113, 36.0139]));
}

const src = (await import('node:fs')).readFileSync(
  (await import('node:path')).join((await import('node:path')).dirname((await import('node:url')).fileURLToPath(import.meta.url)), '..', 'functions', '_shared', 'subdiv-scope.js'),
  'utf8',
);
check('shared helper never logs', !src.includes('console.'));

summary();
