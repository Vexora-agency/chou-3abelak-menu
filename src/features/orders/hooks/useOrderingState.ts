import { useState, useEffect, useRef } from 'react';
import { fetchOrderingStatus, type OrderingStatus } from '@/src/utils/status';
import { isPollStale, pollIntervalMs } from '@/src/utils/ordering';

export function useOrderingState() {
  const [orderingState, setOrderingState] = useState<OrderingStatus | null>(null);
  // Server-clock ms of the last successful poll (null until the first one).
  const lastOkRef = useRef<number | null>(null);
  // Latest state mirror for the self-scheduling poller below.
  const stateRef = useRef<OrderingStatus | null>(null);
  // Last mount/return instant: drives the fast window after opening.
  const lastReturnRef = useRef<number>(Date.now());

  const fetchOrderingState = async () => {
    const state = await fetchOrderingStatus();
    if (state) {
      lastOkRef.current = Date.now();
      stateRef.current = state;
      setOrderingState(state);
    }
  };

  // Ordering availability refreshes with the menu and on a self-scheduling
  // poller: the effect itself only starts async work, all setStates happen
  // after awaits (no cascading render by construction). Cadence adapts to
  // the state (5 s while paused, 60 s when open — see pollIntervalMs), so a
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
      await fetchOrderingState();
      if (!alive) return;
      timer = window.setTimeout(tick, pollIntervalMs(stateRef.current, Date.now(), lastReturnRef.current));
    };
    void tick();
    const markReturn = () => {
      lastReturnRef.current = Date.now();
    };
    const onReturn = () => {
      markReturn();
      void fetchOrderingState();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      markReturn();
      void fetchOrderingState();
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
    document.addEventListener('visibilitychange', onReturn);
    // pageshow fires on window (never on document) — document-level here
    // would silently never run, verified live with a synthetic event.
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onReturn);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearInterval(guard);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onReturn);
    };
  }, []);

  return { orderingState };
}
