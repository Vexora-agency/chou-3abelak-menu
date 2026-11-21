import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useCustomerSession } from '@/src/features/auth';
import {
  addWishlistItem,
  fetchWishlist,
  removeWishlistItem,
  type WishlistEntry,
} from '../services/wishlist.api';

export interface WishlistContextValue {
  /** True only for a signed-in customer; guests never see hearts. */
  isMember: boolean;
  loading: boolean;
  error: boolean;
  entries: WishlistEntry[];
  count: number;
  has: (itemId: string) => boolean;
  /** Optimistic toggle. Resolves to the server-confirmed saved state. */
  toggle: (itemId: string) => Promise<boolean>;
  refresh: () => void;
}

/**
 * Safe default: the menu cards are also reused inside admin previews where
 * no provider exists. Outside the storefront provider the wishlist simply
 * behaves as a guest surface (no hearts, no requests).
 */
const EMPTY_WISHLIST: WishlistContextValue = {
  isMember: false,
  loading: false,
  error: false,
  entries: [],
  count: 0,
  has: () => false,
  toggle: async () => false,
  refresh: () => {},
};

const WishlistContext = createContext<WishlistContextValue>(EMPTY_WISHLIST);

export function useWishlist(): WishlistContextValue {
  return useContext(WishlistContext);
}

/**
 * One shared member wishlist for every heart on the page. Fetching happens
 * once per signed-in user; every toggle is optimistic and then adopts the
 * server's authoritative list (order + count included).
 */
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { user } = useCustomerSession();
  const userId = user?.id ?? null;
  const isMember = !!userId;

  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);

  // Toggles in flight per item: a double-tap must not fire two opposite
  // writes and leave the UI disagreeing with the server. The value is the
  // optimistic target state (true = saved), so a late response can merge
  // around other hearts still in flight.
  const pendingRef = useRef<Map<string, boolean>>(new Map());
  const activeUserRef = useRef<string | null>(userId);
  activeUserRef.current = userId;
  const lastUserRef = useRef<string | null>(null);
  // A refresh that started before a heart tap must not overwrite the newer
  // optimistic/mutated list when it lands late.
  const mutationSeqRef = useRef(0);

  const savedIds = useMemo(() => new Set(entries.map((entry) => entry.itemId)), [entries]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!userId) {
      lastUserRef.current = null;
      pendingRef.current.clear();
      setEntries([]);
      setLoading(false);
      setError(false);
      return;
    }
    // Never flash the previous account's saved dishes after an account swap.
    if (lastUserRef.current !== userId) {
      lastUserRef.current = userId;
      pendingRef.current.clear();
      setEntries([]);
    }
    let alive = true;
    const startedAtSeq = mutationSeqRef.current;
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const data = await fetchWishlist();
        if (!alive || mutationSeqRef.current !== startedAtSeq) return;
        setEntries(Array.isArray(data.items) ? data.items : []);
      } catch {
        if (!alive) return;
        if (mutationSeqRef.current === startedAtSeq) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId, version]);

  const has = useCallback((itemId: string) => savedIds.has(itemId), [savedIds]);

  const toggle = useCallback(
    async (itemId: string): Promise<boolean> => {
      if (!userId) return false;
      if (!itemId || pendingRef.current.has(itemId)) {
        return pendingRef.current.get(itemId) ?? savedIds.has(itemId);
      }

      const wasSaved = savedIds.has(itemId);
      mutationSeqRef.current += 1;
      pendingRef.current.set(itemId, !wasSaved);
      setError(false);

      // Optimistic flip: the heart animates immediately, even on a slow
      // connection. The request below replaces the list with server truth.
      setEntries((prev) => {
        if (wasSaved) return prev.filter((entry) => entry.itemId !== itemId);
        if (prev.some((entry) => entry.itemId === itemId)) return prev;
        return [{ itemId, createdAt: new Date().toISOString() }, ...prev];
      });

      try {
        const data = wasSaved
          ? await removeWishlistItem(itemId)
          : await addWishlistItem(itemId);
        if (activeUserRef.current !== userId) return wasSaved;
        if (Array.isArray(data.items)) {
          setEntries((prev) => {
            const server = data.items;
            // With another heart still in flight, adopting this response
            // alone could visually drop that optimistic change. Merge around
            // it; the next response/fetch reconciles the final order.
            if (pendingRef.current.size <= 1) return server;
            const byId = new Map(server.map((entry) => [entry.itemId, entry]));
            const pendingAdds: WishlistEntry[] = [];
            for (const [id, target] of pendingRef.current) {
              if (id === itemId) continue;
              if (target) {
                if (byId.has(id)) continue;
                const optimistic = prev.find((entry) => entry.itemId === id);
                pendingAdds.push(optimistic ?? { itemId: id, createdAt: new Date().toISOString() });
                byId.set(id, pendingAdds[pendingAdds.length - 1]);
              } else {
                byId.delete(id);
              }
            }
            const rest = server.filter((entry) => byId.has(entry.itemId));
            return [...pendingAdds, ...rest];
          });
        }
        return !wasSaved;
      } catch {
        if (activeUserRef.current === userId) {
          // Revert only THIS item: another heart may be toggling in parallel.
          setEntries((prev) => {
            if (wasSaved) {
              if (prev.some((entry) => entry.itemId === itemId)) return prev;
              return [{ itemId, createdAt: new Date().toISOString() }, ...prev];
            }
            return prev.filter((entry) => entry.itemId !== itemId);
          });
          setError(true);
        }
        return wasSaved;
      } finally {
        pendingRef.current.delete(itemId);
      }
    },
    [userId, savedIds],
  );

  const value = useMemo<WishlistContextValue>(
    () => ({
      isMember,
      loading,
      error,
      entries,
      count: entries.length,
      has,
      toggle,
      refresh,
    }),
    [isMember, loading, error, entries, has, toggle, refresh],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}
