/**
 * Premium bell chime — synthesized with WebAudio, zero audio assets.
 * One of the 5 owner-picked patterns from bellPatterns.ts (default:
 * classic E5 + B5), rendered with inharmonic bell partials and a fast
 * exponential decay — never a harsh beep. Same library and same mechanism
 * (2s chime + 2s silence, 30-minute session) on the menu page and in the
 * dashboard; `sound` picks the pattern (unknown -> classic).
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

import {
  BELL_SOUNDS,
  bellPatternById,
  bellPatternDuration,
  type BellSoundId,
} from '@/src/utils/bellPatterns';

let ctx: AudioContext | null = null;
let unlocked = false;
let interacted = false;
// Chime generation: bumped by stopBellChime() so strikes scheduled but not
// yet fired (or an <audio>.play() still awaiting) abort instead of ringing
// as a ghost AFTER the bell vanished (order completed mid-chime).
let chimeEpoch = 0;

/**
 * Silence any in-flight chime immediately: pauses every cached <audio>
 * element and invalidates strikes still queued between WebAudio strikes.
 * Idempotent — safe to call on unmount and on terminal transitions.
 * Never throws.
 */
export function stopBellChime(): void {
  chimeEpoch += 1;
  try {
    for (const el of chimeEls.values()) {
      try {
        el.pause();
      } catch {}
    }
  } catch {}
}

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
  // ~0.45s decay (same envelope as the admin kitchen bell so both sound
  // identical). All sine — smooth, no harsh harmonics.
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
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + 0.5);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Full chime for one pattern: each strike fires only while the context is
 * still running. If it died mid-chime (background kill between the
 * strikes), report failure so the caller retries the WHOLE chime later
 * instead of leaving a lonely half-ding.
 */
async function strikeFull(
  ac: AudioContext,
  stateOf: () => AudioContextState,
  sound?: BellSoundId | string | null,
): Promise<boolean> {
  const pattern = bellPatternById(sound);
  const epoch = chimeEpoch;
  const dead = () => chimeEpoch !== epoch || stateOf() !== 'running';
  const strikes = [...pattern.strikes].sort((a, b) => a.at - b.at);
  for (let i = 0; i < strikes.length; i++) {
    if (dead()) return false;
    const s = strikes[i];
    try {
      strike(ac, ac.currentTime + 0.02, s.freq, s.vol);
    } catch {
      return false;
    }
    const next = strikes[i + 1];
    await sleep(next ? Math.max(120, (next.at - s.at) * 1000) : 400);
    if (dead()) return false;
  }
  return !dead();
}

/* ---------- HTML <audio> engine: silent-switch-proof ---------- */

// One cached WAV + element per pattern id (each ~40-80KB in memory, zero
// bytes over the network — built lazily on first play).
const chimeUrls = new Map<string, string>();
const chimeEls = new Map<string, HTMLAudioElement>();

/**
 * Synthesize one pattern as a 16-bit mono WAV data URI (runtime
 * generated, zero assets): the pattern's strikes with inharmonic partials
 * and fast decays, ~2-2.7s total. An <audio> element rides the MEDIA
 * channel, so unlike Web Audio it keeps playing with the ringer OFF.
 * WAV gains run ~3x the Web Audio gains so both engines sound identical.
 */
function buildChimeDataUri(sound?: BellSoundId | string | null): string | null {
  try {
    const pattern = bellPatternById(sound);
    const rate = 16000;
    const dur = bellPatternDuration(pattern);
    const len = Math.floor(rate * dur);
    const data = new Float32Array(len);
    const addStrike = (startSec: number, freq: number, vol: number) => {
      const partials: Array<[number, number]> = [[1, 1], [2.4, 0.35], [5.43, 0.12]];
      const start = Math.floor(startSec * rate);
      for (let i = 0; i + start < len; i++) {
        const t = i / rate;
        const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.18);
        let s = 0;
        for (const [ratio, amp] of partials) s += Math.sin(2 * Math.PI * freq * ratio * t) * amp;
        data[start + i] += (s * vol * env) / partials.length;
      }
    };
    for (const s of pattern.strikes) addStrike(s.at, s.freq, s.vol * 3);
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

function chimeElement(sound?: BellSoundId | string | null): HTMLAudioElement | null {
  try {
    if (typeof Audio === 'undefined') return null;
    const id = bellPatternById(sound).id;
    let el = chimeEls.get(id) ?? null;
    if (!el) {
      let url = chimeUrls.get(id) ?? null;
      if (!url) {
        url = buildChimeDataUri(id);
        if (!url) return null;
        chimeUrls.set(id, url);
      }
      el = new Audio();
      el.preload = 'auto';
      el.src = url;
      try {
        el.load();
      } catch {}
      chimeEls.set(id, el);
    }
    return el;
  } catch {
    return null;
  }
}

/**
 * Pre-build the elements inside a gesture so later plays start instantly
 * (zero first-chime delay). Warms ALL 5 patterns — each is ~40-80KB once,
 * so the owner's picked chime never pays synthesis cost on first ring.
 */
function warmHtmlChime(sound?: BellSoundId | string | null): void {
  try {
    if (sound) {
      chimeElement(sound);
      return;
    }
    for (const p of BELL_SOUNDS) {
      try {
        chimeElement(p.id);
      } catch {}
    }
  } catch {}
}

/**
 * Play via the <audio> element. Resolves true only when playback actually
 * starts (play() resolves) — a rejection (no gesture yet, no decoder)
 * resolves false so the caller keeps the chime queued.
 */
async function playHtmlChime(sound?: BellSoundId | string | null): Promise<boolean> {
  try {
    const el = chimeElement(sound);
    if (!el) return false;
    const epoch = chimeEpoch;
    try {
      el.pause();
    } catch {}
    try {
      el.currentTime = 0;
    } catch {}
    await el.play();
    // Stopped while play() was awaiting (order completed mid-chime):
    // silence at once instead of ringing as a ghost.
    if (chimeEpoch !== epoch) {
      try {
        el.pause();
      } catch {}
      return false;
    }
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
export async function playBellChime(sound?: BellSoundId | string | null): Promise<boolean> {
  try {
    requestPlaybackSession();
    try {
      if (await playHtmlChime(sound)) return true;
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
      return strikeFull(ac, stateOf, sound);
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
        return strikeFull(ac, stateOf, sound);
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Buzz vibration matching the chime (mobile only, guarded). */
export function vibrateBell(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([90, 70, 90, 70, 120]);
    }
  } catch {}
}
