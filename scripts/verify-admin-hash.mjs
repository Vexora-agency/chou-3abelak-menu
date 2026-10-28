// Verifies an admin password against a hash using the REAL server code
// (functions/_shared/session.js verifyLogin). Use BEFORE saving any hash:
// if this says false, do NOT put it in Cloudflare.
// Usage: node scripts/verify-admin-hash.mjs "<hash>" <username> "<password>"
import { verifyLogin } from '../functions/_shared/session.js';

const [, , hash, username, password] = process.argv;
if (!hash || !username || !password) {
  console.error('Usage: node scripts/verify-admin-hash.mjs "<hash>" <username> "<password>"');
  process.exit(2);
}
console.log('shape ok:', /^pbkdf2\$\d+\$[^$]{20,30}\$[^$]{40,50}$/.test(hash));
console.log('verify result:', await verifyLogin(username, password, username, hash));
