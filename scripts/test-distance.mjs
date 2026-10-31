// Distance math verification: haversine accuracy against independent
// references, every map-URL shape, and customer-facing formatting.
// Run: npm run test:distance (or: npx tsx scripts/test-distance.mjs)
import { haversineMeters, parseMapUrlCoords, formatDistance } from '../src/utils/menuHelpers.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

// 1. Haversine vs independent references (WGS-84, R = 6371km).
// One equatorial degree of longitude = R * pi/180 ≈ 111,194.93 m.
const eq = haversineMeters(0, 0, 0, 1);
ok('equatorial degree ≈ 111195m', Math.abs(eq - 111194.93) < 1, String(eq));
// Same spot = 0, and symmetry both ways.
ok('zero distance', haversineMeters(33.87, 35.54, 33.87, 35.54) === 0);
const ab = haversineMeters(33.87, 35.54, 33.98, 35.61);
const ba = haversineMeters(33.98, 35.61, 33.87, 35.54);
ok('symmetric', Math.abs(ab - ba) < 1e-9);
// Small east-west hop at Beirut latitude: 0.01° lng × cos(33.87°) × 111.32km
// ≈ 924.5 m (independent planar check, ±5 m tolerance for curvature).
const hop = haversineMeters(33.87, 35.54, 33.87, 35.55);
ok('Beirut 0.01° hop ≈ 924.5m', Math.abs(hop - 924.5) < 5, String(hop));
// Beirut → Jounieh ≈ 14.3 km (cross-checked with an external calculator).
const jounieh = haversineMeters(33.8938, 35.5018, 33.9802, 35.6178);
ok('Beirut-Jounieh ≈ 14.3km', Math.abs(jounieh - 14300) < 400, String(jounieh));

// 2. Restaurant URL parsing — every shape an owner might paste.
const eq2 = (a, b) => a !== null && b !== null && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
const BEIRUT = { lat: 33.87476, lng: 35.545704 };
const shapes = [
  '33.87476, 35.545704',
  'https://www.google.com/maps?q=33.87476,35.545704',
  'https://www.google.com/maps/search/?api=1&query=33.87476,35.545704',
  'https://maps.google.com/?ll=33.87476,35.545704',
  'https://www.google.com/maps?center=33.87476,35.545704',
  'https://www.google.com/maps/dir/?api=1&destination=33.87476,35.545704',
  'https://www.google.com/maps/dir/?api=1&origin=33.87476,35.545704',
  'https://www.google.com/maps/place/X/@33.87476,35.545704,17z',
  'https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x0!3d33.87476!4d35.545704',
];
ok('all URL shapes parse', shapes.every((u) => {
  const c = parseMapUrlCoords(u);
  return eq2(c, BEIRUT);
}));
ok('short link has no coords', parseMapUrlCoords('https://maps.app.goo.gl/AbC123xYz') === null);
ok('garbage rejected', parseMapUrlCoords('Hamra, Beirut') === null && parseMapUrlCoords('') === null && parseMapUrlCoords(undefined) === null);
ok('out-of-range rejected', parseMapUrlCoords('91, 200') === null);

// 3. Customer-facing formatting (Western digits, both languages).
ok('meters ar', formatDistance(999, 'ar') === '≈ 999 م');
ok('km ar', formatDistance(1500, 'ar') === '≈ 1.5 كم');
ok('meters en', formatDistance(250, 'en') === '≈ 250 m');
ok('km en', formatDistance(2300, 'en') === '≈ 2.3 km');
ok('clamped at zero', formatDistance(-5, 'en') === '≈ 0 m');

console.log(`distance: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
