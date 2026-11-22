import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/src/lib/api-client';
import {
  fetchPhoneVerification,
  requestPhoneVerification,
  verifyPhoneSms,
  type PendingPhoneVerification,
} from '../services/account.api';
import { PHONE_VERIFIED_EVENT } from '../profile';
import { useCustomerSession } from './useCustomerSession';

/**
 * Reverse WhatsApp verification state for ONE number.
 *
 * The code is generated server-side and returned exactly once. The browser
 * caches it per member (localStorage) so closing the sheet or reloading the
 * page inside the 10-minute window does not force a new code. Only a hash is
 * stored on the server.
 */

export type PhoneVerificationPhase =
  | 'idle'
  | 'checking'
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'error';

export interface ActivePhoneCode extends PendingPhoneVerification {
  /** Missing for SMS requests (the code arrives by SMS). */
  code: string | null;
  message?: string;
  whatsappUrl?: string | null;
}

export interface PhoneVerificationState {
  phase: PhoneVerificationPhase;
  active: ActivePhoneCode | null;
  verifiedUntil: string | null;
  /** i18n key-ish error code: cooldown | rate_limited | phone_invalid | unavailable */
  error: string | null;
  /** SMS send/verify error: code_invalid | too_many_attempts | sms_unavailable | ... */
  smsError: string | null;
  retryAfter: number;
  requesting: boolean;
  verifying: boolean;
  request: (lang?: 'en' | 'ar', method?: 'whatsapp' | 'sms') => Promise<void>;
  verifySms: (code: string) => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  clearSmsError: () => void;
}

const CACHE_PREFIX = 'phone_verify_v2:';
const POLL_MS = 4000;

function readCache(userId: string | null): ActivePhoneCode | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActivePhoneCode>;
    if (
      !parsed ||
      typeof parsed.phone !== 'string' ||
      typeof parsed.reference !== 'string' ||
      typeof parsed.expiresAt !== 'string'
    ) {
      return null;
    }
    return {
      phone: parsed.phone,
      reference: parsed.reference,
      method: parsed.method === 'sms' ? 'sms' : 'whatsapp',
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : '',
      expiresAt: parsed.expiresAt,
      code: typeof parsed.code === 'string' ? parsed.code : null,
      message: typeof parsed.message === 'string' ? parsed.message : undefined,
      whatsappUrl: typeof parsed.whatsappUrl === 'string' ? parsed.whatsappUrl : null,
    };
  } catch {
    return null;
  }
}

function writeCache(userId: string | null, value: ActivePhoneCode | null) {
  if (!userId || typeof window === 'undefined') return;
  try {
    const key = `${CACHE_PREFIX}${userId}`;
    if (!value) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function mergePending(
  pending: PendingPhoneVerification,
  cached: ActivePhoneCode | null,
): ActivePhoneCode {
  const same = cached && cached.reference === pending.reference && cached.phone === pending.phone;
  return {
    phone: pending.phone,
    reference: pending.reference,
    method: pending.method === 'sms' ? 'sms' : 'whatsapp',
    createdAt: pending.createdAt,
    expiresAt: pending.expiresAt,
    code: same ? cached.code : null,
    message: same ? cached.message : undefined,
    whatsappUrl: same ? cached.whatsappUrl : null,
  };
}

function errorCode(err: unknown): { code: string; retryAfter: number; pending?: PendingPhoneVerification } {
  if (err instanceof ApiError) {
    const body = err.body as Record<string, unknown> | null;
    const code = body && typeof body.error === 'string' ? body.error : 'unavailable';
    const retryAfter = body && typeof body.retryAfter === 'number' && Number.isFinite(body.retryAfter)
      ? Math.max(0, Math.round(body.retryAfter))
      : 0;
    const rawPending = body && body.pending;
    let pending: PendingPhoneVerification | undefined;
    if (rawPending && typeof rawPending === 'object') {
      const p = rawPending as Record<string, unknown>;
      if (
        typeof p.phone === 'string' &&
        typeof p.reference === 'string' &&
        typeof p.expiresAt === 'string'
      ) {
        pending = {
          phone: p.phone,
          reference: p.reference,
          method: p.method === 'sms' ? 'sms' : 'whatsapp',
          createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
          expiresAt: p.expiresAt,
        };
      }
    }
    return { code, retryAfter, pending };
  }
  return { code: 'unavailable', retryAfter: 0 };
}

export function usePhoneVerification(
  phone: string | null,
  enabled = true,
): PhoneVerificationState {
  const { user } = useCustomerSession();
  const userId = user?.id ?? null;
  const normalized = typeof phone === 'string' && phone ? phone : null;

  const [phase, setPhase] = useState<PhoneVerificationPhase>('idle');
  const [active, setActive] = useState<ActivePhoneCode | null>(null);
  const [verifiedUntil, setVerifiedUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const requestingRef = useRef(false);
  const verifyingRef = useRef(false);

  const phoneRef = useRef<string | null>(normalized);
  const phaseRef = useRef<PhoneVerificationPhase>('idle');
  const requestSeqRef = useRef(0);
  phoneRef.current = normalized;
  phaseRef.current = phase;

  const clearError = useCallback(() => {
    setError(null);
    setRetryAfter(0);
  }, []);

  const clearSmsError = useCallback(() => setSmsError(null), []);

  const applyVerified = useCallback((until: string | null) => {
    setVerifiedUntil(until);
    setActive(null);
    setPhase('verified');
    setError(null);
    setSmsError(null);
    setRetryAfter(0);
    writeCache(userId, null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(PHONE_VERIFIED_EVENT));
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    const target = phoneRef.current;
    if (!enabled || !userId || !target) {
      setPhase('idle');
      return;
    }
    const seq = requestSeqRef.current;
    // Silent poll while a code is live: never flash the checking skeleton.
    if (phaseRef.current !== 'pending') setPhase('checking');
    try {
      const state = await fetchPhoneVerification(target);
      // A newer request (or a different number) owns the state now; a stale
      // status read must never wipe the code the member is looking at.
      if (phoneRef.current !== target || requestSeqRef.current !== seq) return;
      if (state.verified) {
        applyVerified(state.verifiedUntil);
        return;
      }
      if (state.pending) {
        const cached = readCache(userId);
        const merged = mergePending(state.pending, cached);
        // Drop a cached code that belongs to an older request.
        if (cached && cached.reference !== merged.reference) writeCache(userId, merged);
        setActive(merged);
        setPhase('pending');
        return;
      }
      setActive(null);
      setVerifiedUntil(null);
      setPhase('unverified');
      const cached = readCache(userId);
      if (cached && cached.phone === target && Date.parse(cached.expiresAt) <= Date.now()) {
        writeCache(userId, null);
      }
    } catch {
      if (phoneRef.current !== target || requestSeqRef.current !== seq) return;
      // A status read failure must not destroy an active code the member can
      // still send; keep the sheet usable and let the next poll recover.
      if (phaseRef.current !== 'pending') setPhase('error');
      setError('unavailable');
    }
  }, [applyVerified, enabled, userId]);

  const request = useCallback(async (lang: 'en' | 'ar' = 'en', method: 'whatsapp' | 'sms' = 'whatsapp') => {
    const target = phoneRef.current;
    if (!enabled || !userId || !target || requestingRef.current) return;
    requestSeqRef.current += 1;
    requestingRef.current = true;
    setRequesting(true);
    clearError();
    setSmsError(null);
    setPhase((p) => (p === 'pending' ? p : 'checking'));
    try {
      const result = await requestPhoneVerification(target, lang, method);
      if (phoneRef.current !== target) return;
      if (result.verified) {
        applyVerified(result.verifiedUntil ?? null);
        return;
      }
      const pending = result.pending;
      if (result.method === 'sms' || pending?.method === 'sms') {
        if (!pending) {
          await refresh();
          return;
        }
        const next: ActivePhoneCode = {
          phone: pending.phone,
          reference: pending.reference,
          method: 'sms',
          createdAt: pending.createdAt,
          expiresAt: pending.expiresAt,
          code: null,
          whatsappUrl: null,
        };
        setActive(next);
        writeCache(userId, next);
        setPhase('pending');
        return;
      }
      const v = result.verification;
      if (v) {
        const next: ActivePhoneCode = {
          phone: v.phone,
          reference: v.reference,
          method: 'whatsapp',
          createdAt: v.createdAt,
          expiresAt: v.expiresAt,
          code: v.code,
          message: v.message,
          whatsappUrl: v.whatsappUrl,
        };
        setActive(next);
        writeCache(userId, next);
        setPhase('pending');
      } else {
        await refresh();
      }
    } catch (err) {
      const parsed = errorCode(err);
      if (phoneRef.current !== target) return;
      if (parsed.pending) {
        const cached = readCache(userId);
        setActive(mergePending(parsed.pending, cached));
        setPhase('pending');
      } else if (phaseRef.current !== 'pending') {
        setPhase('error');
      }
      setError(parsed.code);
      setRetryAfter(parsed.retryAfter);
    } finally {
      requestingRef.current = false;
      setRequesting(false);
    }
  }, [applyVerified, clearError, enabled, refresh, userId]);

  /** Submit the 6-digit code received by SMS. */
  const verifySms = useCallback(async (code: string) => {
    const target = phoneRef.current;
    if (!enabled || !userId || !target || verifyingRef.current) return;
    if (!active || active.method !== 'sms') return;
    const digits = String(code || '').replace(/[^0-9]/g, '');
    if (digits.length < 4 || digits.length > 8) {
      setSmsError('code_invalid');
      return;
    }
    verifyingRef.current = true;
    setVerifying(true);
    setSmsError(null);
    try {
      const result = await verifyPhoneSms(target, digits);
      if (phoneRef.current !== target) return;
      if (result.verified) {
        applyVerified(result.verifiedUntil ?? null);
      } else {
        setSmsError('code_invalid');
      }
    } catch (err) {
      const parsed = errorCode(err);
      if (phoneRef.current !== target) return;
      setSmsError(parsed.code);
    } finally {
      verifyingRef.current = false;
      setVerifying(false);
    }
  }, [active, applyVerified, enabled, userId]);

  // Reset + status read whenever the watched number changes.
  useEffect(() => {
    requestSeqRef.current += 1;
    setError(null);
    setSmsError(null);
    setRetryAfter(0);
    setActive(null);
    setVerifiedUntil(null);
    if (!enabled || !userId || !normalized) {
      setPhase('idle');
      return;
    }
    const cached = readCache(userId);
    if (cached && cached.phone === normalized && Date.parse(cached.expiresAt) > Date.now()) {
      setActive(cached);
      setPhase('pending');
    } else {
      setPhase('checking');
    }
    // Debounce the status read: in the cart the number changes per keystroke,
    // and a status request per digit would be pure noise. Cached state still
    // paints immediately; the network answers after the typing pause.
    const timer = window.setTimeout(() => {
      void refresh();
    }, 350);
    return () => window.clearTimeout(timer);
    // `refresh` is stable for a given user; number/enabled drive the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, enabled, userId]);

  // Poll while a code is waiting for owner approval. Pauses on a hidden tab
  // (same visibility contract as the track/bell polls) and catches up on return.
  useEffect(() => {
    if (!enabled || phase !== 'pending') return;
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [enabled, phase, refresh]);

  // Returning from WhatsApp (tab switch, bfcache restore, app resume) must
  // ALWAYS re-read the status — even if the sheet was left in 'checking'.
  // Otherwise the old "Checking this number…" spinner can survive forever
  // after the message was already approved server-side.
  useEffect(() => {
    if (!enabled || !userId || !normalized) return;
    const recheck = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void refresh();
      }
    };
    const onPageShow = () => void refresh();
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', recheck);
    };
  }, [enabled, userId, normalized, refresh]);

  // Safety valve: a stalled status/POST request must never leave the sheet
  // spinning at "Checking this number…". After 15s, surface the retry state.
  useEffect(() => {
    if (phase !== 'checking') return;
    const id = window.setTimeout(() => {
      if (phaseRef.current !== 'checking') return;
      requestSeqRef.current += 1;
      setPhase('error');
      setError('unavailable');
    }, 15_000);
    return () => window.clearTimeout(id);
  }, [phase]);

  // Another surface (settings vs cart) approved this number: adopt it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onVerified = () => {
      if (phaseRef.current === 'pending') void refresh();
    };
    window.addEventListener(PHONE_VERIFIED_EVENT, onVerified);
    return () => window.removeEventListener(PHONE_VERIFIED_EVENT, onVerified);
  }, [refresh]);

  // Keep the countdown honest: when the active code expires, drop it so the
  // UI offers a fresh one instead of counting below zero.
  useEffect(() => {
    if (phase !== 'pending' || !active) return;
    const left = Date.parse(active.expiresAt) - Date.now();
    if (!(left > 0)) {
      setPhase('unverified');
      setActive(null);
      writeCache(userId, null);
      return;
    }
    const id = window.setTimeout(() => {
      setPhase('unverified');
      setActive(null);
      writeCache(userId, null);
    }, left + 250);
    return () => window.clearTimeout(id);
  }, [phase, active, userId]);

  return {
    phase,
    active,
    verifiedUntil,
    error,
    smsError,
    retryAfter,
    requesting,
    verifying,
    request,
    verifySms,
    refresh,
    clearError,
    clearSmsError,
  };
}
