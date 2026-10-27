import { useEffect, useMemo, useState } from 'react';

export function useOrdersDashClock() {
  // Fresh clock for the stats window + relative times (refreshed every minute
  // so "today" and "x min ago" never go stale while the panel stays open).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  return { now };
}
