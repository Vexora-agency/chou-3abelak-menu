import { useState, useEffect } from 'react';
import { fetchOrderingStatus, type OrderingStatus } from '@/src/utils/status';

export function useOrderingState() {
  const [orderingState, setOrderingState] = useState<OrderingStatus | null>(null);

  const fetchOrderingState = async () => {
    const state = await fetchOrderingStatus();
    if (state) setOrderingState(state);
  };

  // Ordering availability refreshes with the menu and every minute after.
  // Fetch-on-mount + poller: the effect itself only starts async work, all
  // setStates happen after awaits (no cascading render by construction).
  // Return-to-tab refreshes (visibility/pageshow/focus) keep this channel in
  // lockstep with the menu channel: without them an already-open page shows
  // the previous pause's resume time for up to a minute after a re-pause.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
    void fetchOrderingState();
    const onReturn = () => {
      if (document.visibilityState === 'visible') void fetchOrderingState();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void fetchOrderingState();
    };
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchOrderingState();
    }, 60000);
    document.addEventListener('visibilitychange', onReturn);
    document.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onReturn);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onReturn);
      document.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onReturn);
    };
  }, []);

  return { orderingState };
}
