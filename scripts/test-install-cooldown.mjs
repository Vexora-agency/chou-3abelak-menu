// Cooldown-helper checks for the track install card.
// Run: npx tsx scripts/test-install-cooldown.mjs
import { strict as assert } from 'node:assert';
import {
  INSTALL_DISMISS_COOLDOWN_MS,
  isCooldownActive,
} from '../src/features/track/components/installCooldown.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

assert.equal(INSTALL_DISMISS_COOLDOWN_MS, 7 * DAY, 'cooldown is exactly 7 days');
assert.equal(isCooldownActive(null, NOW), false, 'null = not dismissed');
assert.equal(isCooldownActive(undefined, NOW), false, 'undefined = not dismissed');
assert.equal(isCooldownActive('', NOW), false, 'empty = not dismissed');
assert.equal(isCooldownActive('garbage', NOW), false, 'non-numeric = not dismissed');
assert.equal(isCooldownActive('0', NOW), false, 'zero = not dismissed');
assert.equal(isCooldownActive('-5', NOW), false, 'negative = not dismissed');
assert.equal(isCooldownActive(String(NOW), NOW), true, 'just dismissed = active');
assert.equal(isCooldownActive(String(NOW - 6 * DAY), NOW), true, '6 days ago = still active');
assert.equal(
  isCooldownActive(String(NOW - (7 * DAY - 1000)), NOW),
  true,
  'just under 7 days = still active'
);
assert.equal(isCooldownActive(String(NOW - 7 * DAY), NOW), false, 'exactly 7 days = expired');
assert.equal(isCooldownActive(String(NOW - 8 * DAY), NOW), false, '8 days ago = expired');
assert.equal(isCooldownActive(String(NOW + 60_000), NOW), true, 'future stamp (clock skew) = hidden');

console.log('install-cooldown: all assertions passed');
