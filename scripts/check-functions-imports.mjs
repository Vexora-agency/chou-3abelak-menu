// Repo-wide: every relative import under functions/ must resolve on disk.
// (A broken one fails the whole Pages deploy.) Usage: node scripts/check-functions-imports.mjs
import fs from 'node:fs';
import path from 'node:path';
const roots = ['functions'];
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) files.push(p);
  }
};
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /(?:from|import)\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const p = path.normalize(path.join(path.dirname(f), m[1]));
    if (!fs.existsSync(p)) { bad++; console.log('BROKEN', f, '->', m[1]); }
  }
}
console.log(`${files.length} function files scanned, ${bad ? bad + ' BROKEN' : 'all imports resolve'}`);
if (bad) process.exit(1);
