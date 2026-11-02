import { useState, useEffect, useRef } from 'react';
import { fetchOrderingStatusVersioned, type OrderingStatus } from '@/src/utils/status';
import { isPollStale, pollIntervalMs } from '@/src/utils/ordering';
import { markFetchStart, shouldEventFetch } from '@/src/utils/refreshGate';
import { scheduleIdle } from '@/src/utils/scheduleIdle';

/** Event-gate channel shared by this hook's tick + ambient refreshes. */
const ORDERING_KEY = 'ordering-state';
/** Coalescing window for focus/visibility/pageshow refreshes (see refreshGate). */
const EVENT_WINDOW_MS = 15000;

export function useOrderingState() {
  const [orderingState, setOrderingState] = useState<OrderingStatus | null>(null);
  // Server-clock ms of the last successful poll (null until the first one).
  const lastOkRef = useRef<number | null>(null);
  // Latest state mirror for the self-scheduling poller below.
  const stateRef = useRef<OrderingStatus | null>(null);
  // Last mount/return instant: drives the fast window after opening.
  const lastReturnRef = useRef<number>(Date.now());
  // Last server ETag: echoed as If-None-Match so unchanged polls answer
  // 304 with no body (see ordering-state endpoint + refreshGate).
  const etagRef = useRef<string | null>(null);

  const fetchOrderingState = async () => {
    const r = await fetchOrderingStatusVersioned(undefined, etagRef.current);
    // 304 (unchanged) still proves liveness: refresh the freshness clock
    // without touching state, so the staleness guard below never drops
    // good data just because nothing changed for a while.
    if (r.notModified) {
      lastOkRef.current = Date.now();
      return;
    }
    if (!r.state) return;
    if (r.etag) etagRef.current = r.etag;
    lastOkRef.current = Date.now();
    stateRef.current = r.state;
    setOrderingState(r.state);
  };

  // Ordering availability refreshes with the menu and on a self-scheduling
  // poller: the effect itself only starts async work, all setStates happen
  // after awaits (no cascading render by construction). Cadence adapts to
  // the state (3 s while paused, 60 s when open — see pollIntervalMs), so a
  // resume surfaces in seconds instead of up to a minute.
  // Return-to-tab refreshes (visibility/pageshow/focus) keep this channel in
  // lockstep with the menu channel: without them an already-open page shows
  // the previous pause's resume time for up to a minute after a re-pause.
  // The poller is deliberately NOT gated on visibility: a visibility-API
  // quirk (or a suspended tab that never refires it) would otherwise freeze
  // the state forever while timers visibly keep running. The staleness guard
  // below drops dead data back to the local machine instead.
  useEffect(() => {
    let alive = true;
    let timer = 0;
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
  const tick = async () => {
    if (!alive) return;
    markFetchStart(ORDERING_KEY);
    await fetchOrderingState();
    if (!alive) return;
    timer = window.setTimeout(tick, pollIntervalMs(stateRef.current, Date.now(), lastReturnRef.current));
  };
  // First poll waits for an idle window (2 s ceiling) so the boot-critical
  // /api/menu fetch wins the connection and the CPU; the header shows the
  // menu-derived fail-open state meanwhile, and all later polls keep their
  // normal cadence once the first tick runs.
  const cancelIdle = scheduleIdle(() => {
    if (alive) void tick();
  }, 2000);
  // Event-driven top-up (focus / visible-return / persisted restore):
  // throttled + visible-only via refreshGate — a tap-storm collapses to
  // one fetch per window instead of one per event. Plain focus does NOT
  // reset the fast window anymore: only genuine returns (hidden ->
  // visible, persisted restore) extend 5 s polling, otherwise every tap
  // would pin the fast cadence forever.
  const eventRefresh = () => {
    if (!shouldEventFetch(ORDERING_KEY, EVENT_WINDOW_MS)) return;
    markFetchStart(ORDERING_KEY);
    void fetchOrderingState();
  };
  const markReturn = () => {
    lastReturnRef.current = Date.now();
  };
  const onVisibleReturn = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    markReturn();
    eventRefresh();
  };
  const onFocusReturn = () => {
    eventRefresh();
  };
  const onPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    markReturn();
    eventRefresh();
  };
    // Freshness checker: drop data older than two poll periods so a frozen
    // poller can never pin the UI (or a ticking countdown) on dead data.
    const guard = window.setInterval(() => {
      if (isPollStale(lastOkRef.current, Date.now())) {
        lastOkRef.current = null;
        stateRef.current = null;
        setOrderingState(null);
      }
    }, 5000);
    document.addEventListener('visibilitychange', onVisibleReturn);
    // pageshow fires on window (never on document) — document-level here
    // would silently never run, verified live with a synthetic event.
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocusReturn);
    return () => {
      alive = false;
      cancelIdle();
      window.clearTimeout(timer);
      window.clearInterval(guard);
      document.removeEventListener('visibilitychange', onVisibleReturn);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocusReturn);
    };
  }, []);

  return { orderingState };
}
