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
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional fetch trigger, see above
    void fetchOrderingState();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void fetchOrderingState();
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  return { orderingState };
}
