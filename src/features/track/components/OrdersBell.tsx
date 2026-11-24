import React, { useEffect, useRef, useState } from 'react';
import { useBodyScrollLock } from '@/src/hooks/useBodyScrollLock';
import { BellRing, Volume2, VolumeX, Check, X, Loader2, PackageSearch, ExternalLink } from 'lucide-react';
import {
  isSoundOff,
  loadCustomerOrders,
  loadRung,
  markRung,
  removeCustomerOrder,
  setSoundOff,
  type StoredCustomerOrder,
} from '@/src/utils/customerOrders';
import { formatPrice } from '@/src/utils/pricing';
import { ALARM_INTERVAL_MS, ALARM_SESSION_MS } from '@/src/utils/bellPatterns';
import { playBellChime, stopBellChime, unlockBellAudio, vibrateBell } from '@/src/utils/bellSound';
import { markFetchStart, shouldEventFetch } from '@/src/utils/refreshGate';
import { ReceivedButton } from './ReceivedButton';
import { CancelOrderButton } from './CancelOrderButton';
import { useNow } from '@/src/hooks/useNow';
import { formatMMSS } from '@/src/utils/countdown';
import { etaRange, formatEtaRangeWithDay } from '@/src/utils/etaFormat';
import { cancelWindowMsFromMenu, cancelWindowRemainingMs } from '../orderPhases';
import { publicPostRaw } from '@/src/lib/api-client';

/** Event-gate channel shared by this bell's interval + ambient refreshes. */
const BELL_KEY = 'orders-bell';
/** Coalescing window for focus/visibility/pageshow refreshes (see refreshGate). */
const EVENT_WINDOW_MS = 15000;

interface OrdersBellProps {
  lang: 'en' | 'ar';
  darkMode?: boolean;
}

interface BellOrder extends StoredCustomerOrder {
  status: 'new' | 'confirmed' | 'ready' | 'completed' | 'cancelled' | 'unknown';
  total: number | null;
  itemsCount: number | null;
  createdAt: string | null;
  /** Receive-unlock instant (server-computed); null = no lock info. */
  receivableAt: string | null;
  /** ETA instant (server-computed); null = kitchen hasn't confirmed yet. */
  etaAt: string | null;
  /** Follow-up link (server-computed joint delivery); null = standalone. */
  parentNumber: number | null;
  /** Joint group members (server-computed); empty = solo. One tap confirms all. */
  groupNumbers: number[];
}

function timeAgo(at: string, isAr: boolean, nowMs: number): string {
  const dt = Date.parse(at);
  if (Number.isNaN(dt)) return '';
  const mins = Math.max(0, Math.floor((nowMs - dt) / 60000));
  if (mins < 1) return isAr ? 'الآن' : 'now';
  if (mins < 60) return isAr ? `منذ ${mins} د` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return isAr ? `منذ ${hours} س` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return isAr ? `منذ ${days} يوم` : `${days}d ago`;
}

/** Single source of truth for batch validation + display: the 5 known
 *  batch statuses, anything else is `unknown`. Legacy `ready` stays a
 *  distinct value here — the display layer merges it into preparing. */
function toBellStatus(s: unknown): BellOrder['status'] {
  return s === 'new' || s === 'confirmed' || s === 'ready' || s === 'completed' || s === 'cancelled' ? s : 'unknown';
}

/** Delivery lock for the compact receive button: mirrors the track page's
 *  rule (same server-computed `receivableAt`). While locked the button stays
 *  disabled with a LIVE 1 s countdown (display clock below) until the lock
 *  lapses — never a dead tap, never a stall between 60 s polls. */
function isReceivableLocked(o: BellOrder, nowMs: number): boolean {
  if (o.status !== 'confirmed' && o.status !== 'ready') return false;
  if (typeof o.receivableAt !== 'string' || !o.receivableAt) return false;
  const ms = Date.parse(o.receivableAt);
  return Number.isFinite(ms) && ms > nowMs;
}

/** Phase-1 cancel-window countdown: a `new` order still inside the cancel
 *  window gets a live 1 s countdown in the bell (shared orderPhases rule
 *  with the track page). Prefers the server clock, falls back to the
 *  shelf timestamp when the row hasn't been fetched yet. */
function isInCancelCountdown(o: BellOrder, nowMs: number, windowMs?: number): boolean {
  if (o.status !== 'new') return false;
  const remaining = cancelWindowRemainingMs(o.createdAt ?? o.at, nowMs, windowMs);
  return remaining !== null && remaining > 0;
}

/** Single lookup for bell status copy: `confirmed` + `ready` share one
 *  object on purpose — both read as "Being prepared" (3-step timeline). */
const STATUS_PREPARING_LABEL = { en: 'Being prepared', ar: 'قيد التحضير' };
const STATUS_LABEL: Record<BellOrder['status'], { en: string; ar: string }> = {
  new: { en: 'Awaiting confirmation', ar: 'بانتظار التأكيد' },
  confirmed: STATUS_PREPARING_LABEL,
  ready: STATUS_PREPARING_LABEL,
  completed: { en: 'Delivered', ar: 'تم التوصيل' },
  cancelled: { en: 'Cancelled', ar: 'ملغي' },
  unknown: { en: '…', ar: '…' },
};

/** One batched fetch for the whole shelf: 1 KV probe + 1 D1 round-trip
 *  per tick instead of N× GET /api/track (see POST /api/track/batch).
 *  Same no-oracle contract: unknown numbers / bad tokens come back in the
 *  identical `unknown` shape, never distinguished. */
async function fetchOrderStates(list: StoredCustomerOrder[]): Promise<Record<number, BellOrder>> {
  const next: Record<number, BellOrder> = {};
  const unknown = (o: StoredCustomerOrder): BellOrder => ({
    ...o, status: 'unknown', total: null, itemsCount: null, createdAt: null, receivableAt: null, etaAt: null, parentNumber: null, groupNumbers: [],
  });
  if (list.length === 0) return next;
  try {
    // Shared public POST transport (same shape as ReceivedButton's
    // token-gated call): null = network/abort failure, else a Response
    // with `.ok`/`.json()` consumed exactly like a raw fetch Response.
    // Deliberate: the 4s default abort bounds hung polls; a timeout shows
    // `unknown`, identical to any failed fetch.
    const res = await publicPostRaw('/api/track/batch', { orders: list.map((o) => ({ number: o.n, t: o.t })) });
    if (!res || !res.ok) {
      for (const o of list) next[o.n] = unknown(o);
      return next;
    }
    const d = (await res.json()) as {
      results?: Array<{ number?: unknown; status?: unknown; total?: unknown; itemsCount?: unknown; createdAt?: unknown; receivableAt?: unknown; etaAt?: unknown; parentNumber?: unknown; groupNumbers?: unknown }>;
    };
    const byNum = new Map<number, { status: BellOrder['status']; total: number | null; itemsCount: number | null; createdAt: string | null; receivableAt: string | null; etaAt: string | null; parentNumber: number | null; groupNumbers: number[] }>();
    for (const r of Array.isArray(d?.results) ? d.results : []) {
      if (!r || typeof r.number !== 'number') continue;
      const st = typeof r.status === 'string' ? r.status : '';
      byNum.set(r.number, {
        status: toBellStatus(st),
        total: typeof r.total === 'number' ? r.total : null,
        itemsCount: typeof r.itemsCount === 'number' ? r.itemsCount : null,
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
        receivableAt: typeof r.receivableAt === 'string' ? r.receivableAt : null,
        etaAt: typeof r.etaAt === 'string' ? r.etaAt : null,
        parentNumber: typeof r.parentNumber === 'number' ? r.parentNumber : null,
        groupNumbers: Array.isArray(r.groupNumbers) ? r.groupNumbers.filter((n): n is number => typeof n === 'number') : [],
      });
    }
    for (const o of list) {
      const r = byNum.get(o.n);
      next[o.n] = r ? { ...o, ...r } : unknown(o);
    }
  } catch {
    for (const o of list) next[o.n] = unknown(o);
  }
  return next;
}

/**
 * Status chips: every state carries an explicit light AND dark treatment.
 * (The old single-theme red washed out on white backgrounds.)
 */
const STATUS_STYLE: Record<string, string> = {
  new: 'text-amber-700 border-amber-300 bg-amber-100 dark:text-amber-400 dark:border-amber-800 dark:bg-amber-950/60',
  confirmed: 'text-yellow-800 border-yellow-500 bg-yellow-100 dark:text-[var(--primary)] dark:border-[var(--primary)]/40 dark:bg-[var(--primary)]/10',
  ready: 'text-sky-700 border-sky-300 bg-sky-100 dark:text-sky-400 dark:border-sky-800 dark:bg-sky-950/60',
  completed: 'text-green-700 border-green-300 bg-green-50 dark:text-green-400 dark:border-green-800 dark:bg-green-950/60',
  cancelled: 'text-red-700 border-red-300 bg-red-50 dark:text-red-400 dark:border-red-800 dark:bg-red-950/60',
  unknown: 'text-neutral-500 border-neutral-300 bg-neutral-100 dark:text-neutral-400 dark:border-neutral-700 dark:bg-black',
};

/**
 * Floating order bell: every order placed on this device stays reachable
 * for 12h ("Track live", "Did you receive it?") with zero accounts.
 * Signature touch: gold bell with a live count badge, opening a dark
 * bottom card in the brand's voice. Hidden when the shelf is empty.
 */
export const OrdersBell: React.FC<OrdersBellProps> = ({ lang, darkMode = true }) => {
  const isAr = lang === 'ar';
  const [shelf, setShelf] = useState<StoredCustomerOrder[]>(() => loadCustomerOrders());
  const [open, setOpen] = useState(false);
  const [states, setStates] = useState<Record<number, BellOrder>>({});
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [soundOff, setSoundOffState] = useState<boolean>(() => isSoundOff());
  const [ringing, setRinging] = useState(false);
  // Order numbers already seen: only a number appearing AFTER mount rings
  // (sound fires at order time only — a fresh order rings normally).
  const knownRef = useRef<Set<number> | null>(null);
  const ringTimerRef = useRef(0);
  const activeRef = useRef(false);
  const lastChimeRef = useRef(0);
  // Alarm session: continuous chiming runs at most 30 minutes per session;
  // a fresh order starts a new session. 0 = no active session.
  const alarmStartRef = useRef(0);
  // Orders whose chime could not play yet (context still locked). Flushed
  // on every later gesture/visibility/tick until one strike lands — the
  // sound is never dropped, only muted orders are skipped.
  const pendingSoundRef = useRef<Set<number>>(new Set());
  // Last seen batch status per order number: edge-detects the new ->
  // confirmed/ready ("being prepared") transition so that moment chimes
  // exactly once. Unknowns never overwrite memory — a failed poll must not
  // fake an edge when the next tick recovers.
  const prevStatusRef = useRef<Map<number, BellOrder['status']>>(new Map());
  // Owner-picked customer chime id (menu settings.sounds.customer).
  const [customerSound, setCustomerSound] = useState<string>('classic');
  const soundRef = useRef(customerSound);
  soundRef.current = customerSound;
  // Menu currency for the compact totals (same /api/menu read as the chime).
  const [menuCurrency, setMenuCurrency] = useState<{ en: string; ar: string } | null>(null);
  const bellCurrency = menuCurrency ? (isAr ? menuCurrency.ar || menuCurrency.en : menuCurrency.en || menuCurrency.ar) : '';
  // Owner-tuned customer-cancel window (ms): same /api/menu read,
  // default 5 min so old menus behave exactly as today.
  const [cancelWindowMs, setCancelWindowMs] = useState<number>(() => cancelWindowMsFromMenu(null));
  // Store zone: ETA day + clock share ONE zone with the confirmation email.
  const [storeTz, setStoreTz] = useState<string | undefined>(undefined);

  // Load the picked chime once + refresh every 5 min (the owner may change
  // it mid-day in settings). Unknown ids fall back to classic in the engine.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch('/api/menu');
        if (!res.ok || stop) return;
        const m = (await res.json()) as { settings?: { sounds?: { customer?: unknown }; currency?: { en?: unknown; ar?: unknown }; timezone?: unknown; ordering?: unknown } };
        const s = m?.settings?.sounds?.customer;
        if (!stop && typeof s === 'string' && s) setCustomerSound(s);
        const cc = m?.settings?.currency;
        if (!stop && cc && typeof cc.en === 'string' && typeof cc.ar === 'string') {
          setMenuCurrency({ en: cc.en, ar: cc.ar });
        }
        const tz = m?.settings?.timezone;
        if (!stop && typeof tz === 'string' && tz.trim()) setStoreTz(tz.trim());
        if (!stop) setCancelWindowMs(cancelWindowMsFromMenu(m));
      } catch {}
    };
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5 * 60 * 1000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  /** Visual swing only — never any sound (sound is order-time-only). */
  const dance = (ms: number) => {
    setRinging(true);
    window.clearTimeout(ringTimerRef.current);
    ringTimerRef.current = window.setTimeout(() => setRinging(false), ms);
  };

  // Every setState below runs after an await (TrackView shape) so the
  // mount fetch never cascades renders.
  // Try the pending chimes; clears on the first landed strike (one
  // ding-ding per flush no matter how many orders queued). While the
  // master switch is off the queue is dropped silently.
  const flushPendingSound = async () => {
    if (pendingSoundRef.current.size === 0) return;
    if (isSoundOff()) {
      pendingSoundRef.current.clear();
      return;
    }
    try {
      if (await playBellChime(soundRef.current)) {
        pendingSoundRef.current.clear();
        lastChimeRef.current = Date.now();
      }
    } catch {}
  };

  useEffect(() => {
    unlockBellAudio();
    let stop = false;
    const tick = async () => {
      // Stamp every poll start so ambient focus/visibility refreshes below
      // dedupe against it (see refreshGate) instead of doubling it.
      markFetchStart(BELL_KEY);
      const list = loadCustomerOrders();
      const next = list.length ? await fetchOrderStates(list) : {};
      if (stop) return;
      // New arrivals (never seen since mount) → premium ring: chime +
      // vibration + swing. Mount-time orders never ring here (catch-up
      // below covers them). The attention loop keeps re-chiming while
      // orders stay active. The master switch gates everything: off =
      // visual only, no chime, no queue.
      const known = knownRef.current;
      if (known) {
        const fresh = list.filter((o) => !known.has(o.n));
        for (const o of fresh) known.add(o.n);
        if (fresh.length > 0 && !isSoundOff()) {
          // Vibration never waits on audio: even a blocked chime still
          // buzzes, so the new order is never missed silently.
          vibrateBell();
          for (const o of fresh) pendingSoundRef.current.add(o.n);
          dance(2000);
          void flushPendingSound();
        }
      } else {
        knownRef.current = new Set(list.map((o) => o.n));
        // Catch-up on (re)mount: orders never rung on THIS device ring once
        // — this covers leaving the browser and coming back, even if the OS
        // killed the tab (a fresh mount would otherwise stay silent).
        // Skipped entirely while the master switch is off. Only ACTIVE
        // orders (new/confirmed/ready) may chime: after a storage wipe,
        // finished (completed/cancelled) shelf entries must never ring —
        // ringing for a dead order is the classic ghost chime.
        if (!isSoundOff()) {
          const rung = loadRung();
          const missedActive = list.filter((o) => {
            if (rung.includes(o.n)) return false;
            const s = next[o.n]?.status;
            return s === 'new' || s === 'confirmed' || s === 'ready';
          });
          // Mark everything seen (so finished orders never re-trigger),
          // but queue sound for active ones only.
          markRung(list.map((o) => o.n));
          if (missedActive.length > 0) {
            for (const o of missedActive) pendingSoundRef.current.add(o.n);
            vibrateBell();
            dance(2000);
            void flushPendingSound();
          }
        } else {
          markRung(list.map((o) => o.n));
        }
      }
      activeRef.current = Object.values(next).some((s) => s.status === 'new' || s.status === 'confirmed' || s.status === 'ready');
      // Edge-triggered "now preparing" chime: any tracked order moving from
      // a non-preparing state into confirmed/ready since the previous tick
      // queues ONE chime through the shared pending queue (same cooldown +
      // flush path as new arrivals — no second chime engine, so this can
      // never fight the 3s engine cooldown or the 4s alarm loop). Mount-time
      // sightings are skipped (prev === undefined): the rung catch-up above
      // already covers them, so a long-confirmed order never double-rings.
      // Gated by the master switch like everything else: off = silent.
      if (!isSoundOff()) {
        let edge = false;
        for (const o of list) {
          const cur = next[o.n]?.status;
          if (cur !== 'confirmed' && cur !== 'ready') continue;
          const prev = prevStatusRef.current.get(o.n);
          if (prev === undefined) continue;
          if (prev !== 'confirmed' && prev !== 'ready') {
            pendingSoundRef.current.add(o.n);
            edge = true;
          }
        }
        if (edge) {
          vibrateBell();
          dance(1500);
          void flushPendingSound();
        }
      }
      // Advance edge memory: unknowns never overwrite (failed polls stay
      // invisible), numbers that left the shelf are pruned.
      {
        const seen = new Set<number>();
        for (const o of list) {
          seen.add(o.n);
          const cur = next[o.n]?.status ?? 'unknown';
          if (cur !== 'unknown') prevStatusRef.current.set(o.n, cur);
        }
        for (const k of [...prevStatusRef.current.keys()]) {
          if (!seen.has(k)) prevStatusRef.current.delete(k);
        }
      }
      setShelf(list);
      setStates(next);
      // A brand-new order re-arms a muted bell (see saveCustomerOrder) —
      // reflect it on the toggle so the icon never lies.
      setSoundOffState(isSoundOff());
      setLoading(false);
      setNowMs(Date.now());
      // Retry anything still queued (audio may have unlocked since).
      void flushPendingSound();
    };
    void tick();
    // 60 s ambient cadence (was 30 s): the open tracking page still polls
    // fast for the order being watched — the bell is background awareness,
    // so a minute granularity is plenty and halves its track + KV reads.
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, 60000);
    // Same-tab saves don't emit storage events — the store pings us.
    // Order-placed/changed pings stay immediate and ungated (rare +
    // meaningful, never a storm source).
    const onLocal = () => void tick();
    const onStorage = () => void tick();
    // Desktop tab switches / bfcache restores don't always fire
    // visibilitychange first — belt and suspenders for the flush.
    // Ambient refreshes (focus / restore / return) are throttled +
    // visible-only via refreshGate: iOS fires focus on every keyboard
    // show/hide and app switch, each of which used to mean N order-track
    // fetches. Sound flush stays outside the gate (local-only unlock).
    const ambientRefresh = () => {
      if (!shouldEventFetch(BELL_KEY, EVENT_WINDOW_MS)) return;
      markFetchStart(BELL_KEY);
      void tick();
    };
    const onFocus = () => {
      ambientRefresh();
      void flushPendingSound();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      // bfcache restore only: the initial (non-persisted) pageshow would
      // just duplicate the mount tick above.
      if (!e.persisted) return;
      ambientRefresh();
      void flushPendingSound();
    };
    // Any real interaction may have just unlocked audio: flush chimes
    // that were queued while the context was suspended.
    const onGesture = () => void flushPendingSound();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        ambientRefresh();
        void flushPendingSound();
      }
    };
    window.addEventListener('customer-orders-changed', onLocal);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('touchend', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      // Unmounting = bell gone: kill any chime already in flight so no
      // ghost rings after the orders resolve.
      stopBellChime();
      pendingSoundRef.current.clear();
      window.clearInterval(id);
      window.clearTimeout(ringTimerRef.current);
      window.removeEventListener('customer-orders-changed', onLocal);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('touchend', onGesture);
      window.removeEventListener('keydown', onGesture);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Attention loop (same mechanism as the admin kitchen bell): while an
  // order still needs the customer, the bell dances AND re-chimes on a 4s
  // cycle — 2s chime + 2s silence — like a real kitchen bell, it does not
  // go quiet until the order is done or muted. A 30-minute session cap
  // stops the alarm eventually; a fresh order starts a new one.
  // Skipped while the panel is open (the customer is already looking).
  useEffect(() => {
    if (open) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (!activeRef.current) {
        alarmStartRef.current = 0;
        return;
      }
      dance(2000);
      if (isSoundOff()) return;
      const now = Date.now();
      if (!alarmStartRef.current) alarmStartRef.current = now;
      if (now - alarmStartRef.current > ALARM_SESSION_MS) return;
      if (now - lastChimeRef.current < 3500) return;
      vibrateBell();
      void playBellChime(soundRef.current).then((ok) => {
        if (ok) {
          lastChimeRef.current = Date.now();
        } else {
          pendingSoundRef.current.add(0);
        }
      }).catch(() => {
        pendingSoundRef.current.add(0);
      });
    }, ALARM_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [open ]);

  // Per-sheet scroll lock (iOS-safe, nested-sheet aware).
  useBodyScrollLock(open, 'orders-bell');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  // The bell lives only while something needs attention: the moment every
  // order on the shelf is completed/cancelled it vanishes at once (the
  // confirm button already flips local state, so this is instant — the
  // next poll just confirms it). Unknown (not yet fetched) counts as
  // active so the bell never flickers on mount.
  const orders = shelf.map((o) => states[o.n] ?? { ...o, status: 'unknown' as const, total: null, itemsCount: null, createdAt: null, receivableAt: null, etaAt: null, parentNumber: null, groupNumbers: [] });
  const allTerminal = orders.length > 0 && orders.every((o) => o.status === 'completed' || o.status === 'cancelled');
  // Live display clock (1 s) while any shelf order needs a live countdown:
  // either a delivery lock (60 s batch poll only re-stamps `nowMs`, so
  // without this the locked countdown would visibly stall between polls)
  // or a phase-1 cancel-window countdown. Enabled on any qualifying shelf
  // order regardless of panel state (the badge shows with it closed);
  // fetching stays exactly at 60 s — only the display speeds up. Read
  // displayNowMs in render (never Date.now() inline — hooks purity rule).
  const anyLocked = orders.some((o) => isReceivableLocked(o, nowMs));
  const anyCancelling = orders.some((o) => isInCancelCountdown(o, nowMs, cancelWindowMs));
  const anyLive = anyLocked || anyCancelling;
  const tickNowMs = useNow(anyLive, 1000);
  const displayNowMs = anyLive ? tickNowMs : nowMs;
  // The moment everything resolves, drop the queued chimes and silence any
  // in-flight one: nothing may ring after the bell is gone (ghost-chime
  // bug — a chime started seconds before the last poll must not finish).
  useEffect(() => {
    if (!allTerminal) return;
    pendingSoundRef.current.clear();
    stopBellChime();
  }, [allTerminal]);
  // Never unmount mid-use: if the last order resolves while the panel is
  // open, keep the shell so focus and scroll are not lost to <body>.
  if ((!shelf.length || allTerminal) && !open) return null;

  // Dismiss a finished or orphaned order from the shelf. Only terminal
  // (completed/cancelled) or unreachable (unknown) orders are dismissible —
  // live ones keep their cancel/received flows. Dismissing the last order
  // closes the panel too, and an empty shelf unmounts the bell entirely.
  const dismissOrder = (n: number) => {
    const next = removeCustomerOrder(n);
    setShelf(next);
    setStates((prev) => {
      if (!prev[n]) return prev;
      const { [n]: _dropped, ...rest } = prev;
      return rest;
    });
    if (next.length === 0) {
      stopBellChime();
      pendingSoundRef.current.clear();
      setOpen(false);
    }
  };

  // Master sound switch: off = visual bell only, never a chime.
  // Unmuting plays a chime at once (a tap always unlocks audio).
  const toggleSound = () => {
    const off = !soundOff;
    setSoundOff(off);
    setSoundOffState(off);
    if (off) {
      pendingSoundRef.current.clear();
    } else {
      vibrateBell();
      dance(1700);
      void playBellChime(soundRef.current).then((ok) => {
        if (ok) lastChimeRef.current = Date.now();
      }).catch(() => {});
    }
  };

  const activeCount = orders.filter((o) => o.status === 'new' || o.status === 'confirmed' || o.status === 'ready').length;

  // new = placed, owner hasn't confirmed yet; confirmed = the place
  // confirmed receipt and is preparing it; completed = delivered to you.
  // Legacy `ready` orders (pre-simplification) read exactly like confirmed:
  // the customer timeline is 3 steps now, so the bell shows no 4th state.
  // (The sky chip color for `ready` is kept — styling only, not a step.)
  const statusLabel = (s: string) => { const l = STATUS_LABEL[toBellStatus(s)]; return isAr ? l.ar : l.en; };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={isAr ? 'طلباتك' : 'Your orders'}
        aria-expanded={open}
        className={`btn-tactile fixed bottom-[max(5.5rem,calc(env(safe-area-inset-bottom)+5.5rem))] end-4 z-40 w-14 h-14 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 ${
          darkMode
            ? 'shadow-[0_8px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/20'
            : 'shadow-[0_10px_28px_-6px_rgba(0,0,0,0.35)] ring-2 ring-[#0A0A0A]/15'
        }`}
      >
        {ringing && (
          <span aria-hidden="true" className="anim-bell-glow absolute inset-0 rounded-full bg-[var(--primary)]" />
        )}
        <span className={ringing ? 'anim-bell-ring inline-flex' : 'inline-flex'}>
          <BellRing size={24} strokeWidth={2.5} />
        </span>
        {activeCount > 0 && (
          <span className="absolute -top-1 -start-1 min-w-6 h-6 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-black flex items-center justify-center tabular-nums ring-2 ring-[#0A0A0A]">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={isAr ? 'طلباتك' : 'Your orders'}>
          <div className="absolute inset-0 bg-black/60 anim-fade-in" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className={`anim-drawer-in relative z-10 w-full max-w-md max-h-[78dvh] flex flex-col rounded-t-[28px] border border-b-0 border-t-[3px] border-t-[var(--primary)] shadow-2xl overflow-hidden ${
              darkMode ? 'bg-[#141414] border-neutral-700 text-white' : 'bg-white border-neutral-200 text-[#0A0A0A]'
            }`}
          >
          {/* Fixed header: pinned above the scroll area on every browser.
              (A sticky header inside the scroller proved unreliable on
              phones — it scrolled away with the content.) */}
          <div
            className={`shrink-0 px-5 sm:px-6 pt-3 border-b ${darkMode ? 'bg-[#141414] border-neutral-700' : 'bg-white border-neutral-200'}`}
          >
            <div aria-hidden="true" className={`mx-auto mb-2 h-1.5 w-12 rounded-full ${darkMode ? 'bg-neutral-700' : 'bg-neutral-300'}`} />
            <div className="py-2 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black">{isAr ? 'طلباتك' : 'Your orders'}</h2>
                <p className={`text-[11px] ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  {isAr ? 'تظهر هنا لمدة 12 ساعة' : 'Kept here for 12 hours'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleSound}
                  aria-pressed={!soundOff}
                  aria-label={isAr ? (soundOff ? 'تشغيل صوت الجرس' : 'كتم صوت الجرس') : (soundOff ? 'Unmute bell' : 'Mute bell')}
                  title={isAr ? (soundOff ? 'تشغيل الصوت' : 'كتم الصوت') : (soundOff ? 'Unmute' : 'Mute')}
                  className={`btn-tactile w-11 h-11 min-w-[44px] min-h-[44px] rounded-full border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                    soundOff
                      ? (darkMode
                        ? 'border-red-800 text-red-400 bg-red-950/40 hover:text-red-300'
                        : 'border-red-300 text-red-600 bg-red-50 hover:bg-red-100')
                      : darkMode
                        ? 'border-[var(--primary)]/60 text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20'
                        : 'border-[var(--primary)] text-[#0A0A0A] bg-[var(--primary)]/15 hover:bg-[var(--primary)]/30'
                  }`}
                >
                  {soundOff ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={isAr ? 'إغلاق' : 'Close'}
                  className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'text-neutral-400 hover:bg-white/10' : 'text-neutral-500 hover:bg-black/5'}`}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
          <div
            data-lenis-prevent
            className="overflow-y-auto overscroll-contain smooth-scroll-touch no-scrollbar flex-1 min-h-0 px-5 sm:px-6 pt-3 pb-[max(1.75rem,env(safe-area-inset-bottom))] overflow-x-clip"
          >
            {loading && !orders.length ? (
              <div className="flex justify-center py-8">
                <Loader2 size={24} className="animate-spin text-[var(--primary)]" />
              </div>
            ) : (
              <div className="mt-2 space-y-2.5 pb-1">
                {orders.map((o) => {
                  // Per-order live values (display clock, never Date.now()):
                  // cancel-window countdown while the order is still `new`
                  // and inside its window; ETA range once confirmed.
                  const cancelMs = o.status === 'new' ? cancelWindowRemainingMs(o.createdAt ?? o.at, displayNowMs, cancelWindowMs) : null;
                  const inCancelWindow = cancelMs !== null && cancelMs > 0;
                  const locked = isReceivableLocked(o, displayNowMs);
                  const etaWin = (o.status === 'confirmed' || o.status === 'ready') && typeof o.etaAt === 'string' && o.etaAt
                    ? etaRange(o.etaAt, displayNowMs)
                    : null;
                  const etaText = etaWin ? formatEtaRangeWithDay(etaWin.fromIso, etaWin.toIso, lang, storeTz, displayNowMs) : '';
                  return (
                  <div
                    key={o.n}
                  className={`relative overflow-hidden rounded-2xl border p-3 ${darkMode ? 'border-neutral-800 bg-black/40' : 'border-neutral-200 bg-neutral-50'}`}
                >
                  {(o.status === 'new' || o.status === 'confirmed' || o.status === 'ready') && (
                    <span aria-hidden="true" className="absolute top-0 inset-x-10 h-[2px] rounded-full bg-gradient-to-r from-transparent via-[var(--primary)] to-transparent" />
                  )}
                  <div className="flex items-center justify-between gap-2">
                      <span className="text-base font-black tabular-nums" dir="ltr">#{o.n}</span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-black px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${STATUS_STYLE[o.status]}`}>
                          {o.status === 'completed' && <Check size={11} strokeWidth={3.5} aria-hidden="true" />}
                          {statusLabel(o.status)}
                        </span>
                        {(o.status === 'completed' || o.status === 'cancelled' || o.status === 'unknown') && (
                          <button
                            type="button"
                            onClick={() => dismissOrder(o.n)}
                            aria-label={isAr ? `إزالة الطلب ${o.n} من القائمة` : `Dismiss order ${o.n}`}
                            title={isAr ? 'إزالة' : 'Dismiss'}
                            className={`group relative w-8 h-8 after:absolute after:-inset-2 after:content-[""] rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${darkMode ? 'text-neutral-500 hover:text-neutral-200 hover:bg-white/10' : 'text-neutral-400 hover:text-neutral-700 hover:bg-black/5'}`}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className={`mt-0.5 text-xs tabular-nums ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                      <bdi>{timeAgo(o.at, isAr, displayNowMs)}</bdi>
                      {typeof o.itemsCount === 'number' && typeof o.total === 'number' && (
                        <bdi> · <bdi dir="ltr" className="tabular-nums">{o.itemsCount}</bdi> {isAr ? 'أصناف' : 'items'} · <bdi dir="ltr" className="tabular-nums">{formatPrice(o.total)}</bdi>{bellCurrency ? <> <span dir="auto">{bellCurrency}</span></> : null}</bdi>
                      )}
                      {o.status === 'unknown' && (
                        <span className="inline-flex items-center gap-1 ms-1"><PackageSearch size={11} />{isAr ? 'تعذر التحديث' : 'Update unavailable'}</span>
                      )}
                    </p>
                    {/* Top-aligned (not centered): the received button carries
                        the waiting hint underneath it, so centering would drag
                        "track live" out of line with it — tops stay parallel. */}
                    <div className="mt-2 flex items-start gap-2 flex-wrap">
                      {o.status === 'new' && (
                        <CancelOrderButton
                          number={o.n}
                          token={o.t}
                          createdAt={o.createdAt ?? o.at}
                          status={o.status}
                          lang={lang}
                          darkMode={darkMode}
                          cancelWindowMs={cancelWindowMs}
                          onCancelled={() =>
                            setStates((prev) => (prev[o.n] ? { ...prev, [o.n]: { ...prev[o.n], status: 'cancelled' } } : prev))
                          }
                        />
                      )}
                      <a
                        href={`/?track=${o.n}&t=${encodeURIComponent(o.t)}`}
                        className={`h-11 min-h-[44px] px-5 rounded-full border text-xs font-extrabold inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] ${
                          darkMode ? 'border-neutral-700 text-neutral-200 hover:border-[var(--primary)] hover:text-[var(--primary)]' : 'border-neutral-300 text-neutral-700 hover:border-[var(--primary)]'
                        }`}
                      >
                        <ExternalLink size={13} />
                        {isAr ? 'تتبع الطلب' : 'Track live'}
                      </a>
                      {(o.status === 'new' || o.status === 'confirmed' || o.status === 'ready') && (
                        <ReceivedButton
                          number={o.n}
                          token={o.t}
                          lang={lang}
                          darkMode={darkMode}
                          compact
                          groupCount={Array.isArray(o.groupNumbers) && o.groupNumbers.length > 0 ? o.groupNumbers.length + 1 : undefined}
                          disabled={o.status === 'new' || locked}
                          waitingHint={o.status === 'new' ? (
                            inCancelWindow ? (
                              isAr ? (
                                <>سيُقبَل طلبك بعد انتهاء مهلة الإلغاء (المتبقي <span dir="ltr" className="tabular-nums">{formatMMSS(cancelMs ?? 0)}</span>)</>
                              ) : (
                                <>Your order will be accepted after the cancellation window ends (<span dir="ltr" className="tabular-nums">{formatMMSS(cancelMs ?? 0)}</span> left)</>
                              )
                            ) : undefined
                          ) : locked ? (
                            isAr ? (
                              <>تم قبول طلبك وهو قيد التحضير الآن — الوصول المتوقع {etaText ? <span dir="ltr" className="tabular-nums">{etaText}</span> : null}<br />سيتم تفعيل زر التأكيد بعد التوصيل (المتبقي <span dir="ltr" className="tabular-nums">{formatMMSS(Math.max(0, Date.parse(o.receivableAt as string) - displayNowMs))}</span>)</>
                            ) : (
                              <>Your order is accepted and being prepared — arriving around {etaText ? <span dir="ltr" className="tabular-nums">{etaText}</span> : null}<br />Confirm unlocks after delivery (<span dir="ltr" className="tabular-nums">{formatMMSS(Math.max(0, Date.parse(o.receivableAt as string) - displayNowMs))}</span> left)</>
                            )
                          ) : undefined}
                          onConfirmed={() =>
                            setStates((prev) => {
                              const next = { ...prev };
                              // Joint receipt flips the whole group server-side:
                              // mirror every member locally so no stale row
                              // lingers until the next 60 s poll.
                              const ids = [o.n, ...(Array.isArray(o.groupNumbers) ? o.groupNumbers : [])];
                              for (const n of ids) {
                                if (next[n]) next[n] = { ...next[n], status: 'completed' };
                              }
                              return next;
                            })
                          }
                        />
                      )}
                    </div>
                    {/* Phased hints (shared orderPhases rule with the track page):
                        phase-1 cancel countdown for `new` orders inside the
                        window (live 1 s ticks), static phase-2 line after it
                        (the default copy under the disabled button), and the
                        accepted + ETA-range + live countdown line while the
                        button is locked. This caption renders solely for the
                        unlocked "did you receive" state, where the enabled
                        button shows no hint at all. */}
                    {(o.status === 'confirmed' || o.status === 'ready') && !locked && (
                      <p className={`mt-2 text-[11px] font-bold ${darkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                        {isAr ? 'هل استلمت طلبك؟' : 'Did you receive your order?'}
                      </p>
                    )}
                  </div>
                );
                })}
              </div>
            )}
          </div>
          </div>
        </div>
      )}
    </>
  );
};
