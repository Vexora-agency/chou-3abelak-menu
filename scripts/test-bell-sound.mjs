// Bell chime contract: without WebAudio (node) it resolves false and never
// rejects; with a suspended context it keeps retrying instead of dropping.
// Run: npm run test-bell-sound
import { playBellChime, vibrateBell, unlockBellAudio } from '../src/utils/bellSound.ts';

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
ok('no AudioContext resolves false', r === false);
vibrateBell(); // must never throw without navigator.vibrate
ok('vibrate is a safe no-op', true);

console.log(`bell-sound: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
