// Bell chime contract: without WebAudio (node) it resolves false and never
// rejects; with a suspended context it keeps retrying instead of dropping.
// Run: npm run test-bell-sound
import { playBellChime, vibrateBell, unlockBellAudio } from '../src/utils/bellSound.ts';
import { ALARM_INTERVAL_MS, ALARM_SESSION_MS, BELL_SOUNDS, bellPatternById, bellPatternDuration, isBellSoundId } from '../src/utils/bellPatterns.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.error(`FAIL: ${name}`);
  }
};

unlockBellAudio(); // must be a safe no-op without DOM audio
const r = await playBellChime();
ok('no audio without DOM audio', r === false);
const r2 = await playBellChime();
const r3 = await playBellChime();
ok('repeated calls stay safe + boolean', r2 === false && r3 === false);
vibrateBell(); // must never throw without navigator.vibrate
ok('vibrate is a safe no-op', true);

// Sound library: exactly 5 sane patterns + safe fallback.
ok('five sounds in the library', BELL_SOUNDS.length === 5 && new Set(BELL_SOUNDS.map((p) => p.id)).size === 5);
ok('every pattern has strikes in range', BELL_SOUNDS.every((p) =>
  p.strikes.length >= 3 && p.strikes.length <= 6 &&
  p.strikes.every((s) => s.freq >= 200 && s.freq <= 2000 && s.at >= 0 && s.at <= 2 && s.vol > 0 && s.vol <= 0.3) &&
  typeof p.name.en === 'string' && typeof p.name.ar === 'string'));
ok('pattern durations fit the 4s cycle', BELL_SOUNDS.every((p) => bellPatternDuration(p) <= 3));
ok('unknown id falls back to classic', bellPatternById('nope').id === 'classic' && bellPatternById(null).id === 'classic' && bellPatternById('gong').id === 'gong');
ok('isBellSoundId gates ids', isBellSoundId('soft') && !isBellSoundId('hack') && !isBellSoundId(42));
ok('30-minute session, 4s cycle', ALARM_SESSION_MS === 30 * 60 * 1000 && ALARM_INTERVAL_MS === 4000);

console.log(`bell-sound: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
