// Kitchen-bell audio path test: stubbed AudioContext records every call.
// Proves playNewOrderBeep schedules the two-tone bell and unlock resumes.
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

const { playNewOrderBeep, unlockOrderSound } = await import('@/src/features/orders/hooks/useNewOrderSound');

// Suspended ctx: schedules anyway + asks resume (browser decides).
playNewOrderBeep();
ok(calls.includes('ctx.resume'), 'resume requested when suspended');
ok(calls.some((c) => c === 'osc.start@10.00 f=880'), 'first tone 880Hz scheduled', calls.join('|'));
ok(calls.some((c) => c === 'osc.start@10.17 f=1174.66'), 'second tone scheduled +0.17s', calls.join('|'));
ok(calls.filter((c) => c === 'gain.connect->destination').length === 2, 'both tones reach speakers');
ok(calls.filter((c) => c.startsWith('osc.stop')).length === 2, 'oscillators stopped (no leak)');

// Unlock path (dashboard toggle / first tap = real gesture).
calls.length = 0;
ctxState = 'suspended';
(globalThis as unknown as { __gesture: boolean }).__gesture = true;
unlockOrderSound();
ok(ctxState === 'running' && calls.includes('ctx.resume'), 'unlock resumes context');
(globalThis as unknown as { __gesture: boolean }).__gesture = false;

(globalThis as unknown as { __gesture: boolean }).__gesture = false;

// Drain the retry timer armed by the first phase, then test the retry alone.
await new Promise((r) => setTimeout(r, 700));
calls.length = 0;
ctxState = 'suspended';
// Suspended retry: tones scheduled again ~600ms later (unlock landing mid-poll).
playNewOrderBeep();
const first = calls.filter((c) => c.startsWith('osc.start')).length;
await new Promise((r) => setTimeout(r, 800));
const total = calls.filter((c) => c.startsWith('osc.start')).length;
ok(first === 2 && total === 4, 'retry replays bell after suspend', `${first}->${total}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
