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
 * The design, from those facts:
 * 1. Never birth a context before the first real user gesture (otherwise
 *    the first context is doomed from birth).
 * 2. Every gesture rebirths a stuck context (close + new, synchronously
 *    in the handler) — plus the suspend-then-resume-with-delay trick that
 *    WebKit reporters found unsticks backgrounded contexts.
 * 3. pageshow (bfcache restore) and visibilitychange also rebirth/retry.
 * 4. playBellChime() reports honestly; callers keep un-rung orders queued
 *    and re-flush on every gesture/poll — a chime is delayed, never lost
 *    (unless muted). Never throws, never rejects.
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

/** Call once from the app shell: keeps audio born fresh on every gesture. */
export function unlockBellAudio(): void {
  if (unlocked) return;
  unlocked = true;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
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
    return true;
  } catch {
    return false;
  }
}

/**
 * Ring the chime. Resolves true ONLY on a real strike.
 * Retry path uses the suspend-then-resume-with-delay trick WebKit
 * reporters found unblocks backgrounded contexts; anything still stuck
 * resolves false so the caller keeps it queued. Never rejects.
 */
export async function playBellChime(): Promise<boolean> {
  try {
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

/** Short double-tap vibration on new orders (mobile only, guarded). */
export function vibrateBell(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([70, 60, 70]);
    }
  } catch {}
}
