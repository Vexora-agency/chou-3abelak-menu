// Full Backup & History suite (docs reference this name).
// Runs domain splits sequentially; exit code mirrors the parts.
// Run: node scripts/test-backup.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const parts = ['./test-backup-diff.mjs', './test-backup-flows.mjs'];
let failed = false;
for (const f of parts) {
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: 'inherit' });
  if (r.error || r.status !== 0) failed = true;
}
if (failed) process.exit(1);
