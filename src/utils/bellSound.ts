/**
 * Premium bell chime — synthesized with WebAudio, zero audio assets.
 * Two soft strikes (E5 + B5, a gentle fifth) with inharmonic bell partials
 * and a long exponential decay: a warm "ding-ding", never a harsh beep.
 * Master gain is kept low on purpose.
 *
 * Why "plays once, then never" happens (documented platform behavior):
 * - iOS Safari kills the AudioContext when the page loses focus (state
 *   becomes "interrupted") and resume() afterwards is a documented no-op
 *   (WebKit bugs 276016/281566 — resume() never resolves after background).
 *   The ONLY documented recovery is birthing a brand-new AudioContext when
 *   the page regains focus.
 * - iOS resumes a context ONLY synchronously inside a UI-event call stack;
 *   an awaited resume() from a poll does nothing (StackOverflow 57510426).
 * - A context born while suspended tends to stay stuck; creating it inside
 *   a real gesture starts it running.
 *
 * WHY TWO ENGINES (WebKit bug 237322, MDN, Apple forums): iOS routes Web
 * Audio through the RINGER channel — with the silent switch ON, contexts
 * report state "running" while producing absolute silence: no error, no
 * warning, nothing to catch. HTML <audio> elements ride the MEDIA channel
 * instead and keep playing even on silent. That is the documented "works
 * once, then never" trap: the one audible ring happened while the switch
 * was off. So the primary engine is an <audio> element with a
 * runtime-generated WAV (silent-switch-proof), Web Audio stays as the
 * fallback, and navigator.audioSession.type = 'playback' is requested
 * where supported (Safari 16.4+, the documented one-line fix).
 * playBellChime() resolves true ONLY on a real strike; anything else keeps
 * the caller's pending queue, which re-flushes on every later gesture —
 * a chime is delayed, never dropped (unless muted). Never throws.
 */

let ctx: AudioContext | null = null;
let unlocked = false;
let interacted = false;

function audioCtor(): typeof AudioContext | null {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return AC ?? null;
  } catch {
    return null;
  }
}

/** Attach the watchdog: a stuck context is dropped so the next birth is fresh. */
function adopt(ac: AudioContext): AudioContext {
  try {
    ac.onstatechange = () => {
      try {
        if ((ac.state === 'interrupted' || ac.state === 'closed') && ctx === ac) {
          ctx = null;
        }
      } catch {}
    };
  } catch {}
  return ac;
}

function sharedContext(): AudioContext | null {
  try {
    if (ctx) {
      if (ctx.state === 'closed' || ctx.state === 'interrupted') {
        try {
          void ctx.close().catch(() => {});
        } catch {}
        ctx = null;
      } else {
        return ctx;
      }
    }
    // No doomed pre-gesture births: without a real interaction the new
    // context would start suspended and likely stay stuck on iOS.
    if (!interacted) return null;
    const AC = audioCtor();
    if (!AC) return null;
    ctx = adopt(new AC());
    return ctx;
  } catch {
    return null;
  }
}

/**
 * MUST run synchronously inside a user gesture (or on regaining focus):
 * drops any stuck context and births a fresh one, which starts running.
 * Never recreates a healthy context (a tap must not cut the decay tail).
 */
function ensureLiveInGesture(): void {
  try {
    interacted = true;
    if (ctx && ctx.state === 'running') {
      try {
        void ctx.resume().catch(() => {});
      } catch {}
      return;
    }
    if (ctx) {
      try {
        void ctx.close().catch(() => {});
      } catch {}
      ctx = null;
    }
    const AC = audioCtor();
    if (!AC) return;
    ctx = adopt(new AC());
    if (ctx.state === 'suspended') {
      try {
        void ctx.resume().catch(() => {});
      } catch {}
    }
  } catch {}
}

/**
 * Ask for the playback audio session where supported (Safari 16.4+,
 * feature-detected): the documented one-line fix that moves the page off
 * the ringer-governed ambient category, so Web Audio is not muted by the
 * silent switch. Silent no-op everywhere else.
 */
function requestPlaybackSession(): void {
  try {
    const nav = navigator as unknown as { audioSession?: { type?: string } };
    if (nav && nav.audioSession && typeof nav.audioSession.type === 'string') {
      nav.audioSession.type = 'playback';
    }
  } catch {}
}

/** Call once from the app shell: keeps audio born fresh on every gesture. */
export function unlockBellAudio(): void {
  if (unlocked) return;
  unlocked = true;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  requestPlaybackSession();
  warmHtmlChime();
  window.addEventListener('pointerdown', ensureLiveInGesture, { passive: true });
  // touchstart fires earliest on mobile; keydown covers desktop.
  window.addEventListener('touchstart', ensureLiveInGesture, { passive: true });
  window.addEventListener('touchend', ensureLiveInGesture, { passive: true });
  window.addEventListener('keydown', ensureLiveInGesture);
  window.addEventListener('focus', ensureLiveInGesture);
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    // Regaining focus after background: the old context is dead on iOS —
    // birth a fresh one (documented WebKit recovery) and retry.
    // visibilitychange is NOT a gesture, so also keep the poll/gesture
    // flush path as the guaranteed delivery net.
    try {
      ensureLiveInGesture();
    } catch {}
  };
  document.addEventListener('visibilitychange', onVisible);
  // bfcache restore: JS state survived but the audio pipeline did not.
  window.addEventListener('pageshow', onVisible);
}

function strike(ac: AudioContext, at: number, freq: number, volume: number): void {
  // Bell-ish partials: fundamental + inharmonic overtones, fast attack,
  // ~1.8s decay. All sine — smooth, no harsh harmonics.
  const partials: Array<[number, number]> = [
    [1, 1],
    [2.4, 0.35],
    [5.43, 0.12],
  ];
  for (const [ratio, amp] of partials) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume * amp, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + 1.9);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Full ding-ding with a mid-point guard: the second strike fires only
 * while the context is still running. If it died mid-chime (background
 * kill between the strikes), report failure so the caller retries the
 * WHOLE chime later instead of leaving a lonely half-ding.
 */
async function strikeFull(ac: AudioContext, stateOf: () => AudioContextState): Promise<boolean> {
  try {
    strike(ac, ac.currentTime + 0.02, 659.25, 0.16); // E5
  } catch {
    return false;
  }
  await sleep(350);
  if (stateOf() !== 'running') return false;
  try {
    strike(ac, ac.currentTime + 0.02, 987.77, 0.14); // B5 — a gentle fifth above
  } catch {
    return false;
  }
  await sleep(350);
  if (stateOf() !== 'running') return false;
  try {
    strike(ac, ac.currentTime + 0.02, 659.25, 0.14); // E5 again
  } catch {
    return false;
  }
  await sleep(350);
  if (stateOf() !== 'running') return false;
  try {
    strike(ac, ac.currentTime + 0.02, 987.77, 0.12); // B5 again
  } catch {
    return false;
  }
  await sleep(350);
  if (stateOf() !== 'running') return false;
  try {
    strike(ac, ac.currentTime + 0.02, 1318.5, 0.12); // E6 — the peak
  } catch {
    return false;
  }
  await sleep(350);
  return stateOf() === 'running';
}

/* ---------- HTML <audio> engine: silent-switch-proof ---------- */

let chimeUrl: string | null = null;
let chimeEl: HTMLAudioElement | null = null;

/**
 * Synthesize the same TRIPLE ding-ding as a 16-bit mono WAV data URI
 * (runtime generated, zero assets): three E5+B5 pairs with inharmonic
 * partials and exponential decays, ~4.6s total. An <audio> element rides
 * the MEDIA channel, so unlike Web Audio it keeps playing with the
 * ringer OFF.
 */
function buildChimeDataUri(): string | null {
  try {
    const rate = 16000;
    const dur = 4.6;
    const len = Math.floor(rate * dur);
    const data = new Float32Array(len);
    const addStrike = (startSec: number, freq: number, vol: number) => {
      const partials: Array<[number, number]> = [[1, 1], [2.4, 0.35], [5.43, 0.12]];
      const start = Math.floor(startSec * rate);
      for (let i = 0; i + start < len; i++) {
        const t = i / rate;
        const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.45);
        let s = 0;
        for (const [ratio, amp] of partials) s += Math.sin(2 * Math.PI * freq * ratio * t) * amp;
        data[start + i] += (s * vol * env) / partials.length;
      }
    };
    // Triple ding-ding: three E5+B5 pairs, ~0.75s apart, matching the
    // Web Audio engine's timing so both engines sound identical.
    const pairs: Array<[number, number]> = [[659.25, 0.5], [987.77, 0.42]];
    [0, 1.5, 3.0].forEach((base) => {
      addStrike(base, pairs[0][0], pairs[0][1]);
      addStrike(base + 0.35, pairs[1][0], pairs[1][1]);
    });
    const bytes = new Uint8Array(44 + len * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + len * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) {
      const v = Math.max(-1, Math.min(1, data[i]));
      view.setInt16(44 + i * 2, Math.round(v * 32767), true);
    }
    let bin = '';
    const CH = 8192;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
    }
    if (typeof btoa !== 'function') return null;
    return `data:audio/wav;base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

function chimeElement(): HTMLAudioElement | null {
  try {
    if (typeof Audio === 'undefined') return null;
    if (!chimeEl) {
      if (!chimeUrl) chimeUrl = buildChimeDataUri();
      if (!chimeUrl) return null;
      chimeEl = new Audio();
      chimeEl.preload = 'auto';
      chimeEl.src = chimeUrl;
      try {
        chimeEl.load();
      } catch {}
    }
    return chimeEl;
  } catch {
    return null;
  }
}

/** Pre-build the element inside a gesture so later plays start instantly. */
function warmHtmlChime(): void {
  try {
    chimeElement();
  } catch {}
}

/**
 * Play via the <audio> element. Resolves true only when playback actually
 * starts (play() resolves) — a rejection (no gesture yet, no decoder)
 * resolves false so the caller keeps the chime queued.
 */
async function playHtmlChime(): Promise<boolean> {
  try {
    const el = chimeElement();
    if (!el) return false;
    try {
      el.pause();
    } catch {}
    try {
      el.currentTime = 0;
    } catch {}
    await el.play();
    return true;
  } catch {
    return false;
  }
}

/**
 * Ring the chime. HTML <audio> first (silent-switch-proof), Web Audio
 * oscillators as the fallback. Resolves true ONLY on real playback;
 * anything else resolves false so the caller keeps it queued and retries
 * on the next gesture/poll. Retry path uses the suspend-then-resume-with-
 * delay trick WebKit reporters found unblocks backgrounded contexts.
 * Never rejects.
 */
export async function playBellChime(): Promise<boolean> {
  try {
    requestPlaybackSession();
    try {
      if (await playHtmlChime()) return true;
    } catch {
      // Fall through to the Web Audio engine below.
    }
    const ac = sharedContext();
    if (!ac) return false;
    // Read fresh each call (a function defeats TS property narrowing —
    // resume() genuinely flips suspended -> running at runtime).
    const stateOf = (): AudioContextState => {
      try {
        return ac.state;
      } catch {
        return 'suspended';
      }
    };
    if (stateOf() === 'running') {
      return strikeFull(ac, stateOf);
    }
    for (let i = 0; i < 4; i++) {
      try {
        // The documented unstick sequence: suspend first, then resume
        // after a beat — a bare resume() on a backgrounded context
        // is the call iOS ignores.
        void ac.suspend().catch(() => {});
      } catch {}
      await sleep(200);
      try {
        void ac.resume().catch(() => {});
      } catch {}
      await sleep(200);
      if (stateOf() === 'running') {
        return strikeFull(ac, stateOf);
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Triple-buzz vibration matching the triple chime (mobile only, guarded). */
export function vibrateBell(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([90, 70, 90, 70, 120]);
    }
  } catch {}
}
