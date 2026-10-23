// Generates a password hash for ADMIN_PASSWORD_HASH.
// Usage: node scripts/hash-password.mjs "YourStrongPasswordHere"
// Output format: pbkdf2$<iterations>$<saltB64>$<hashB64>  (PBKDF2-SHA256)
// Copy ONLY the output line into your Cloudflare Pages env var (or .dev.vars
// for local testing). Never commit real hashes to the repo.

import { randomBytes, pbkdf2Sync } from 'node:crypto';

const ITERATIONS = 260000;
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
