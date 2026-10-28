// Generates a password hash for ADMIN_PASSWORD_HASH.
// Usage: node scripts/hash-password.mjs "YourStrongPasswordHere"
// Output format: pbkdf2$<iterations>$<saltB64>$<hashB64>  (PBKDF2-SHA256)
// Copy ONLY the output line into your Cloudflare Pages env var (or .dev.vars
// for local testing). Never commit real hashes to the repo.

import { randomBytes, pbkdf2Sync } from 'node:crypto';

// 50,000 iterations, NOT the OWASP 600k: Cloudflare's free tier kills any
// request past 50 ms CPU, and 260k measured ~173 ms (laptop OpenSSL; edge
// proportional). 50k (~12-15 ms edge) keeps 3-4x headroom while staying 5x
// above the NIST 800-63B 10k minimum — plenty behind a 5-fail/15-min lockout,
// unique 16 B salts, and strong generated passwords. Verified end-to-end:
// higher counts 401 on production free tier (CPU-killed derive, silent catch).
const ITERATIONS = 50000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "YourStrongPasswordHere"');
  process.exit(1);
}

const salt = randomBytes(SALT_BYTES);
const hash = pbkdf2Sync(password, salt, ITERATIONS, HASH_BYTES, 'sha256');

const b64 = (buf) => Buffer.from(buf).toString('base64');
console.log(`pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`);
