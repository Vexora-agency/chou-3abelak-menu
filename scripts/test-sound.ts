// Kitchen-bell audio path test: stubbed AudioContext records every call.
// Proves a locked playNewOrderBeep schedules NOTHING (no silent consume),
// the ladder replays exactly once on unlock, and concurrent triggers ring
// once (2s single-flight). Unlock path: first tap resumes the context.
// Usage: npx tsx scripts/test-sound.ts
const calls: string[] = [];
let ctxState = 'suspended';

class FakeOsc {
  type = '';
  frequency = { value: 0 };
  connect(t: unknown) { calls.push(`osc.connect->${t === (globalThis as unknown as { g: unknown }).g ? 'gain' : '?'}`); }
  start(t: number) { calls.push(`osc.start@${t.toFixed(2)} f=${this.frequency.value}`); }
  stop(t: number) { calls.push(`osc.stop@${t.toFixed(2)}`); }
}
class FakeGain {
  gain = {
    setValueAtTime: (v: number, t: number) => calls.push(`gain.set@${t.toFixed(2)}`),
    exponentialRampToValueAtTime: (v: number, t: number) => calls.push(`gain.ramp@${t.toFixed(2)}`),
  };
  connect(t: unknown) { (globalThis as unknown as { g: unknown }).g = this; calls.push('gain.connect->destination'); }
}
class FakeCtx {
  currentTime = 10;
  destination = {};
  get state() { return ctxState; }
  // No-gesture resume stays pending (like a real poll callback); a resume
  // issued from a gesture (flag) completes. Models autoplay policy.
  async resume() {
    calls.push('ctx.resume');
    if ((globalThis as unknown as { __gesture: boolean }).__gesture) ctxState = 'running';
  }
  createOscillator() { return new FakeOsc(); }
  createGain() { return new FakeGain(); }
}
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };

const { playNewOrderBeep, unlockOrderSound, isAudioLocked } = await import('@/src/features/orders/hooks/useNewOrderSound');
const { bellPatternById } = await import('@/src/utils/bellPatterns');

// Locked ctx: NOTHING is scheduled — oscillators on a frozen currentTime
// are inaudible, so the beep stays owned by the retry ladder instead of
// being silently consumed. Resume is still requested (browser decides).
// Engine contract (bellPatterns.ts + useNewOrderSound.ts): the default
// (classic) pattern renders every strike with 3 partial oscillators each;
// every oscillator is stopped (+0.5s). Retired two-tone expectations
// (880Hz + 1174.66Hz @+0.17s) belonged to the pre-library engine.
const classic = bellPatternById(undefined);
const EXPECTED_STARTS = classic.strikes.length * 3;
playNewOrderBeep();
ok(calls.includes('ctx.resume'), 'resume requested when suspended');
ok(
  calls.filter((c) => c.startsWith('osc.start')).length === 0,
  'nothing scheduled while locked (no silent consume)',
  calls.join('|')
);

// Unlock path (dashboard toggle / first tap = real gesture).
calls.length = 0;
ctxState = 'suspended';
(globalThis as unknown as { __gesture: boolean }).__gesture = true;
unlockOrderSound();
ok(ctxState === 'running' && calls.includes('ctx.resume'), 'unlock resumes context');
(globalThis as unknown as { __gesture: boolean }).__gesture = false;

(globalThis as unknown as { __gesture: boolean }).__gesture = false;

// Drain BOTH retry timers armed by the first phase, then test the ladder alone.
await new Promise((r) => setTimeout(r, 2700));
calls.length = 0;
ctxState = 'suspended';
// Locked ladder: the trigger itself stays silent; the first retry after an
// unlock landing mid-ladder replays the full chime exactly once, and the
// second retry finds played=true (no double-chime).
playNewOrderBeep();
ok(
  calls.filter((c) => c.startsWith('osc.start')).length === 0,
  'locked trigger schedules nothing itself',
  calls.join('|')
);
await new Promise((r) => setTimeout(r, 300));
(globalThis as unknown as { __gesture: boolean }).__gesture = true; // unlock lands
await new Promise((r) => setTimeout(r, 600)); // 600ms retry fires...
ok(
  calls.filter((c) => c.startsWith('osc.start')).length === EXPECTED_STARTS,
  'ladder replays once unlocked',
  calls.join('|')
);
await new Promise((r) => setTimeout(r, 2200)); // ...past the 2500ms retry
ok(
  calls.filter((c) => c.startsWith('osc.start')).length === EXPECTED_STARTS,
  'no second replay (single chime)',
  calls.join('|')
);
ok(calls.filter((c) => c === 'gain.connect->destination').length === EXPECTED_STARTS, 'every partial reaches speakers');
{
  const starts = calls.filter((c) => c.startsWith('osc.start')).length;
  const stops = calls.filter((c) => c.startsWith('osc.stop')).length;
  ok(starts === stops && starts === EXPECTED_STARTS, 'oscillators stopped (no leak)');
}
(globalThis as unknown as { __gesture: boolean }).__gesture = false;

// Single-flight: two triggers inside 2s ring once, never stacked.
// (Cooldown from the ladder trigger above expired during the 3s waits.)
calls.length = 0;
playNewOrderBeep();
playNewOrderBeep();
ok(
  calls.filter((c) => c.startsWith('osc.start')).length === EXPECTED_STARTS,
  'concurrent triggers ring once',
  calls.join('|')
);

// Lock sensor for the dashboard hint.
ctxState = 'suspended';
ok(isAudioLocked() === true, 'locked while suspended');
ctxState = 'running';
ok(isAudioLocked() === false, 'unlocked when running');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
