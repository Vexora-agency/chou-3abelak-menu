import { useState, useEffect, Suspense, useRef } from 'react';
import { MenuData, MenuItem } from '@/src/types/menu';
import { normalizeMenu } from '@/src/utils/pricing';
import { clientConfig } from '@/src/config/client.config';
import { themeConfig } from '@/src/config/theme.config';
import { featuresConfig } from '@/src/config/features.config';
import { Header } from '@/src/components/Header';
import { AnnouncementBanner } from '@/src/components/AnnouncementBanner';
import { type OrderingStatus } from '@/src/utils/status';
import { resolveLiveOrdering } from '@/src/utils/ordering';
import { serverNow } from '@/src/utils/serverTime';
import { refreshMotionRuntime } from '@/src/lib/motion';
import { dialFromSettings } from '@/src/utils/phoneCountry';import { SearchAndChips, FeaturedCarousel, MenuList, useMenuLoader } from '@/src/features/menu';
// Item modal, cart drawer and order bell load lazily (own chunks): none of
// them renders before interaction, so Suspense fallback={null} is
// pixel-identical. Direct paths (not the barrels) keep them out of main.
const ItemDetailsModal = lazyWithReload(() =>
  import('@/src/features/menu/components/ItemDetailsModal').then((m) => ({ default: m.ItemDetailsModal }))
);
import { CartBar } from '@/src/features/cart';
const CartDrawer = lazyWithReload(() =>
  import('@/src/features/cart/components/CartDrawer').then((m) => ({ default: m.CartDrawer }))
);
import { Footer } from '@/src/components/Footer';
import { useAdminSaveMenu } from '@/src/features/admin/hooks/useAdminSaveMenu';
import { useAdminSaveAuth } from '@/src/features/admin/hooks/useAdminSaveAuth';
import { scheduleIdle } from '@/src/utils/scheduleIdle';
import { lazyWithReload } from '@/src/utils/lazyRetry';
import { loadCustomerOrders } from '@/src/utils/customerOrders';
// Admin UI is a separate chunk, downloaded only when /admin opens: customers
// never pay for the panel, editors and backup code. NOTE: these dynamic
// imports bypass the admin barrel ON PURPOSE — importing the barrel (even
// lazily) keeps it in the main chunk because the hooks above import it
// statically, which silently disables the split (verified: 1,164 kB stayed
// 1,164 kB). Static imports elsewhere still go through the barrel.
const AdminPanel = lazyWithReload(() => import('@/src/features/admin/components/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const AdminLogin = lazyWithReload(() => import('@/src/features/admin/components/AdminLogin'));
// One-time invite landing (/invite/<token>): its own chunk — customers never
// download it, and it downloads no admin code either.
const InvitePage = lazyWithReload(() =>
  import('@/src/features/invite/components/InvitePage').then((m) => ({ default: m.InvitePage }))
);
// Customer order tracking (?track=N&t=token): its own chunk — only tracking
// visitors download it.
const TrackView = lazyWithReload(() =>
  import('@/src/features/track/TrackView').then((m) => ({ default: m.TrackView }))
);
// Customer auth/account sheets: own chunks, downloaded only when the profile
// button is used. The header itself reads the shared Better Auth store.
const AuthSheet = lazyWithReload(() =>
  import('@/src/features/auth/components/AuthSheet').then((m) => ({ default: m.AuthSheet }))
);
const AccountSheet = lazyWithReload(() =>
  import('@/src/features/auth/components/AccountSheet').then((m) => ({ default: m.AccountSheet }))
);
// Seasonal storefront layer (snow + greeting): its own chunk, downloaded
// ONLY while a seasonal theme is active — `off` costs zero bytes (the
// component below renders nothing and the import never fires).
const SeasonalEffects = lazyWithReload(() =>
  import('@/src/features/seasonal/SeasonalEffects').then((m) => ({ default: m.SeasonalEffects }))
);
// Floating order bell (12h shelf): tiny, lazy chunk — it only downloads when
// the customer actually has orders. ReceivedButton stays out (only the
// bell + tracking page pull it, via their own imports).
const OrdersBell = lazyWithReload(() =>
  import('@/src/features/track/components/OrdersBell').then((m) => ({ default: m.OrdersBell }))
);
import { WifiOff } from 'lucide-react';
import { useShopCartState } from '@/src/features/cart';
// Storefront availability must not ride the orders barrel: that barrel also
// exports the admin OrdersDashboard, which would drag the whole admin/motion
// graph into the customer entry chunk. Deep import is intentional here.
import { useOrderingState } from '@/src/features/orders/hooks/useOrderingState';
import { useCustomerSession } from '@/src/features/auth';
import { cancelWindowMsFromMenu } from '@/src/features/track/orderPhases';
import { useAppPrefs } from '@/src/hooks/useAppPrefs';

/**
 * Static shell menu: brand identity from clientConfig + safe defaults for
 * everything else (via normalizeMenu), zero items. Lets the header/hero and
 * footer paint on the very first frame instead of waiting ~900 ms for
 * /api/menu — the LCP logo is a static asset, it never needed the network.
 * version 0 + epoch date guarantee the real doc always wins the swap in
 * useMenuLoader (same version/updatedAt rule as the background refresh).
 */
const staticFallbackMenu: MenuData = normalizeMenu({
  version: 0,
  updatedAt: '1970-01-01T00:00:00.000Z',
  settings: {
    name: { en: clientConfig.companyNameEn, ar: clientConfig.companyNameAr },
    tagline: { en: '', ar: '' },
    currency: { en: 'LBP', ar: 'ل.ل' },
    defaultTheme: 'dark',
    defaultLang: 'en',
    ordering: { enabled: false },
  },
  categories: [],
  items: [],
} as unknown as MenuData);

/**
 * Menu-section skeleton: reserves the <main> slot while /api/menu is in
 * flight. Header/hero + footer above/below it are already the real thing
 * (static shell), so only the menu sections shimmer — the page never shows
 * a full-screen spinner that blocks LCP.
 */
function MenuSectionsSkeleton({ lang, darkMode }: { lang: 'en' | 'ar'; darkMode: boolean }) {
  const pulse = darkMode ? 'bg-neutral-800' : 'bg-neutral-200';
  const label = lang === 'ar' ? 'جارٍ تحميل القائمة…' : 'Loading menu…';
  return (
    <div className="px-5 sm:px-8 md:px-12 pt-6 pb-10" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <div className={`h-12 rounded-full ${pulse} animate-pulse mb-4`} />
        <div className="flex gap-2 mb-6">
          {[96, 72, 120, 84].map((w) => (
            <div key={w} className={`h-9 rounded-full ${pulse} animate-pulse`} style={{ width: w }} />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`rounded-2xl ${pulse} animate-pulse`} style={{ height: 180 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Splash while the admin chunk loads or the session is being checked (same look). */
function AdminLoadingSplash() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-white">
      <img
        src={clientConfig.logo}
        srcSet="/assets/logo-final-480.webp 480w, /assets/logo-final-640.webp 640w, /assets/logo-final-880.webp 880w"
        sizes="192px"
        alt={clientConfig.companyNameEn}
        width={clientConfig.logoWidth}
        height={clientConfig.logoHeight}
        className="w-48 h-auto animate-pulse"
      />
    </div>
  );
}

export default function App() {  const { menu, setMenu, loading } = useMenuLoader();
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== 'undefined' && !navigator.onLine
  );
  const { orderingState } = useOrderingState();
  const {
    showAdmin, openAdmin, adminUnlocked, authStatus, setAuthStatus,
    handleLoginSubmit, handleLogout, closeAdmin,
  } = useAdminSaveAuth();
    const { lang, setLang, darkMode, setDarkMode } = useAppPrefs(menu, showAdmin);
  const handleSaveMenuFromAdmin = useAdminSaveMenu(setMenu, lang === 'ar');

  // Boot splash served its purpose (first React paint is on screen) — stays
  // synchronous with this effect so a slow device never sits on the splash.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.getElementById('boot-splash')?.remove();
  }, [showAdmin]);

  // Per-route install manifest: iOS Home Screen icons open the manifest's
  // start_url (NOT the page added from), so the admin needs its own manifest
  // (start_url /admin, distinct "Admin" name) while the storefront keeps the
  // menu one. Deferred to idle (2 s ceiling): the share sheet reads the DOM
  // at tap time, so a later swap is invisible — only the first paint matters,
  // and this effect must not spend boot time on a querySelector + write.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    return scheduleIdle(() => {
      const href = showAdmin ? '/manifest-admin.webmanifest' : '/manifest.webmanifest';
      let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'manifest';
        document.head.appendChild(link);
      }
      if (link.getAttribute('href') !== href) link.setAttribute('href', href);
    }, 2000);
  }, [showAdmin]);

  // Warm the four click-driven sheets after the intro/LCP window. The first
  // item tap / cart open / sign-in then has its chunk + motion runtime ready,
  // so the sheet emerges immediately instead of stalling on a download.
  useEffect(() => {
    const id = window.setTimeout(() => {
      void import('@/src/features/menu/components/ItemDetailsModal');
      void import('@/src/features/cart/components/CartDrawer');
      void import('@/src/features/auth/components/AuthSheet');
      void import('@/src/features/auth/components/AccountSheet');
    }, 7000);
    return () => window.clearTimeout(id);
  }, []);
  // Scroll-restoration hygiene (iOS jump-to-top fix): the track page sets
  // history.scrollRestoration='manual' while it is showing, but leaving it
  // is ALWAYS a full navigation (back button = location.href), so its React
  // cleanup never runs and the tab stays poisoned on 'manual' forever —
  // swipe-back to the menu / reload after iOS discards the background tab
  // then lands at the TOP instead of the previous position. Healing it here
  // on every full app load covers all return flows (menu, admin, invite).
  // Child effects run first, so on a track visit TrackView still applies
  // its own 'manual' + explicit scrollTo(0,0) AFTER this — mount behavior
  // there is unchanged; only the leftover value is gone.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'auto';
      }
    } catch {}
  }, []);

  // Thin reading-progress line at the top of the page — hand-rolled on purpose:
  // motion's useScroll measures document geometry on every scroll (forced
  // reflow ~235 ms on a low-end phone, the top flagged offender in traces).
  // This version reads scrollY only (a free read that never forces layout)
  // against a cached page height, with the same buttery lag the spring gave
  // (lerp inside rAF) and the same fade-in over the first 1% of scroll.
  const progressRef = useRef<HTMLDivElement>(null);
  const pageHeightRef = useRef(1);
  const measuredRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    let raf = 0;
    let running = false;
    let current = 0;
    let target = 0;
    const paint = () => {
      current += (target - current) * 0.18;
      if (Math.abs(target - current) < 0.001) current = target;
      const el = progressRef.current;
      if (el) {
        el.style.transform = `scaleX(${current})`;
        el.style.opacity = current > 0.004 ? String(Math.min(1, current / 0.01)) : '0';
      }
      if (current !== target) {
        raf = requestAnimationFrame(paint);
      } else {
        running = false;
      }
    };
    const kick = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(paint);
      }
    };
    const measure = () => {
      const se = document.scrollingElement || document.documentElement;
      pageHeightRef.current = Math.max(1, se.scrollHeight - window.innerHeight);
      measuredRef.current = true;
    };
    const update = () => {
      // A pre-idle scroll measures on the spot (one-time ~cost) instead of
      // pinning the bar full (scrollY / 1 clamps to 1 = wrong).
      if (!measuredRef.current) measure();
      target = Math.min(1, Math.max(0, window.scrollY / pageHeightRef.current));
      kick();
    };
    // First measure on idle (settled tree), 2 s ceiling — a scroll indicator
    // needs no geometry before the first scroll anyway.
    const cancelIdle = scheduleIdle(() => {
      measure();
      update();
    }, 2000);
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        update();
      });
    };
    // Resize/load/fonts invalidate the cached page height. Coalesced to one
    // measure per frame: back-to-back resize events share a single
    // scrollHeight read instead of forcing a layout per event.
    let resizeTicking = false;
    const onResize = () => {
      if (resizeTicking) return;
      resizeTicking = true;
      requestAnimationFrame(() => {
        resizeTicking = false;
        measure();
        update();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('load', onResize);
    const fonts = (document as Document).fonts;
    if (fonts) fonts.ready.then(onResize).catch(() => {});
    return () => {
      cancelIdle();
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('load', onResize);
    };
  }, [menu?.version]);

  // Menu swap / version change: new sections mount, page height changes.
  // Re-arming reveals + Lenis dimensions here keeps the glide accurate and
  // lets newly mounted GSAP parallax accents attach on the same idle beat.
  useEffect(() => {
    refreshMotionRuntime();
  }, [menu?.version]);

  // Search & Category Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  // Badge quick-filter (new / spicy / top) — single-select, mutually exclusive
  // with categories: picking a badge resets the category to All and vice versa
  const [selectedBadge, setSelectedBadge] = useState<string | null>(null);
  const toggleBadge = (b: string) => {
    setSelectedBadge((prev) => (prev === b ? null : b));
    setSelectedCategory('all');
  };
  const selectCategory = (id: string) => {
    setSelectedCategory(id);
    setSelectedBadge(null);
  };

  // Modal Item Details
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);

  // Signed-in members get their live order surface inside "My orders";
  // the floating guest bell is hidden for them (guests keep it).
  const customerSession = useCustomerSession();

  // Cart Drawer
  const [isCartOpen, setIsCartOpen] = useState(false);
  // One-shot landing marker: every add opens the drawer, and the drawer
  // reveals the exact row that grew (gold ring + scroll into view). The
  // marker is named AFTER the cart commit (configured adds can merge and
  // re-key), then clears itself so reopening the cart never replays it.
  const [justAddedLine, setJustAddedLine] = useState<{ key: string; at: number } | null>(null);
  const prevCartQtyRef = useRef<Record<string, number> | null>(null);
  const addPendingRef = useRef(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authEntry, setAuthEntry] = useState<'account' | 'checkout'>('account');
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [accountInitialTab, setAccountInitialTab] = useState<'orders' | 'settings'>('orders');
  const [resetToken, setResetToken] = useState<string | null>(null);

  const openAccount = (tab: 'orders' | 'settings' = 'orders') => {
    setAccountInitialTab(tab);
    setIsAccountOpen(true);
  };

  // Floating order bell mounts after first paint (idle, 2 s ceiling): on
  // mount it polls statuses, installs audio-gesture listeners and vibrates —
  // none of which the hero/LCP needs, and none of which may exist without
  // a real order. So the bell mounts ONLY while the 12h shelf is non-empty
  // (an order was placed on this device and hasn't expired/been dismissed):
  // no orders = no timers, no listeners, no audio footprint at all. A new
  // order (same tab or another one) flips hasOrders and mounts it instantly.
  const [bellReady, setBellReady] = useState(false);
  useEffect(() => scheduleIdle(() => setBellReady(true), 2000), []);
  const [hasOrders, setHasOrders] = useState<boolean>(() => {
    try {
      return loadCustomerOrders().length > 0;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      try {
        setHasOrders(loadCustomerOrders().length > 0);
      } catch {}
    };
    window.addEventListener('customer-orders-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('customer-orders-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const {
    cart, cartLines, totalCartCount, totalCartPrice,
    handleAddItem, handleAddConfigured, handleUpdateLine, handleRemoveLine, handleRemoveAddon, handleClearCart,
  } = useShopCartState(menu, setActiveItem, () => {
    // Every successful add (plain, or configured with variants/add-ons)
    // lands the customer in the cart: close the item sheet (if open) and
    // open the cart drawer on top.
    setActiveItem(null);
    setIsCartOpen(true);
    addPendingRef.current = true;
  });

  // Diff the committed cart against the previous snapshot to name the line
  // that just grew. Gated on a real add, so boot, stored-cart cleanup and
  // stepper taps INSIDE the drawer never fake a landing.
  useEffect(() => {
    const prev = prevCartQtyRef.current;
    const next: Record<string, number> = {};
    for (const [key, line] of Object.entries(cart)) next[key] = line.quantity;
    prevCartQtyRef.current = next;
    if (!addPendingRef.current) return;
    addPendingRef.current = false;
    if (!prev) return;
    let landedKey = '';
    let landedGrowth = 0;
    for (const [key, qty] of Object.entries(next)) {
      const growth = qty - (prev[key] ?? 0);
      if (growth > landedGrowth) {
        landedGrowth = growth;
        landedKey = key;
      }
    }
    if (landedKey) setJustAddedLine({ key: landedKey, at: Date.now() });
  }, [cart]);

  // The ring is a landing, not a badge: drop the marker once it has played
  // (a later reopen must not replay it).
  useEffect(() => {
    if (!justAddedLine) return;
    const timer = window.setTimeout(() => setJustAddedLine(null), 1500);
    return () => window.clearTimeout(timer);
  }, [justAddedLine]);

  // Online / Offline listener
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // A stale-chunk recovery navigates with a one-time `_r` cache-buster so the
  // fresh entry HTML is fetched. Strip it as soon as the new app boots so the
  // address stays clean (other query markers are preserved for the effect
  // below).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('_r')) return;
    params.delete('_r');
    const qs = params.toString();
    const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', next);
  }, []);

  // OAuth/reset return markers:
  // - Google returns to /?account=1 → open the account sheet.
  // - Password-reset email returns to /?reset=1&token=... → open the reset form.
  // Both markers are stripped from the address bar immediately (the reset
  // token is a credential; it must not linger in history/screenshots).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const token = (params.get('token') || '').trim();
    if (params.get('reset') === '1' && token) {
      setResetToken(token);
      setIsAuthOpen(true);
      params.delete('reset');
      params.delete('token');
      const qs = params.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState(null, '', next);
      return;
    }
    if (params.get('account') !== '1' && params.get('checkout') !== '1') return;
    if (params.get('checkout') === '1') {
      setIsCartOpen(true);
      params.delete('checkout');
      const qs = params.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState(null, '', next);
      return;
    }
    openAccount();
    params.delete('account');
    const qs = params.toString();
    const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', next);
    // One-shot on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // DOM-safe route parsing (standalone pages need no menu data, so they
  // resolve BEFORE any menu gate — the storefront shell below paints
  // instantly while /api/menu is still in flight).
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const searchString = typeof window !== 'undefined' ? window.location.search : '';

  // One-time client invite (/invite/<token>): standalone page, needs no
  // menu data and shares no state with the storefront or the admin.
  // A bare /invite shows the same page in its invalid state (never the menu).
  const inviteMatch = /^\/invite(?:\/([^/]+))?\/?$/.exec(pathname);
  if (inviteMatch) {
    return (
      <Suspense fallback={<AdminLoadingSplash />}>
        <InvitePage token={inviteMatch[1] || ''} />
      </Suspense>
    );
  }

  // Customer order tracking (?track=N&t=token): standalone page, needs no
  // menu data and shares no state with the storefront or the admin.
  const trackQ = new URLSearchParams(searchString);
  const trackN = Number.parseInt(trackQ.get('track') || '', 10);
  const trackT = (trackQ.get('t') || '').trim();
  if (Number.isInteger(trackN) && trackN > 0 && /^[0-9a-f]{32}$/.test(trackT)) {
    return (
      <Suspense fallback={<AdminLoadingSplash />}>
        <TrackView
          number={trackN}
          token={trackT}
          onBack={() => {
            if (typeof window !== 'undefined') window.location.href = '/';
          }}
        />
      </Suspense>
    );
  }

  // Admin View (gated by /admin path + cookie session)
  if (showAdmin) {
    // The admin console needs the real doc (edits + version fencing), so it
    // keeps its splash — only the storefront shell renders menu-less.
    if (loading || !menu) {
      return <AdminLoadingSplash />;
    }
    // TEMPORARY local preview shortcut (?dev-admin): compiled out of
    // production builds (import.meta.env.DEV is statically false there), so it
    // can never reach customers. REMOVE BEFORE COMMIT.
    if (import.meta.env.DEV && new URLSearchParams(searchString).has('dev-admin')) {
      return (
        <Suspense fallback={<AdminLoadingSplash />}>
          <AdminPanel
            initialMenu={menu}
            onSaveMenu={handleSaveMenuFromAdmin}
            onClose={closeAdmin}
            onSignOut={closeAdmin}
            onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
            lang={lang}
          />
        </Suspense>
      );
    }
    if (authStatus === 'checking') {
      return <AdminLoadingSplash />;
    }
    if (authStatus === 'authed') {
      return (
        <Suspense fallback={<AdminLoadingSplash />}>
          <AdminPanel
            initialMenu={menu}
            onSaveMenu={handleSaveMenuFromAdmin}
            onClose={closeAdmin}
            onSignOut={() => void handleLogout()}
            onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
            lang={lang}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<AdminLoadingSplash />}>
        <AdminLogin
          lang={lang}
          onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
          onSubmit={handleLoginSubmit}
          onSuccess={() => setAuthStatus('authed')}
          onBack={closeAdmin}
        />
      </Suspense>
    );
  }

  // Static shell until the real doc lands: header/hero + footer paint on the
  // first frame (LCP logo is a static asset), only the menu sections below
  // wait behind the skeleton. resolveLiveOrdering needs a MenuData — the
  // shell carries safe defaults, the real doc swaps in with identical rules.
  const menuReady = !loading && !!menu;
  const displayMenu: MenuData = menu ?? staticFallbackMenu;
  const isAr = lang === 'ar';
  const currency = isAr ? displayMenu.settings.currency.ar : displayMenu.settings.currency.en;
  // Menu-only mode (starter): no cart, no checkout, no item modal — the menu
  // is display-only with a call CTA. Gated in one place, passed down.
  const orderingOn = featuresConfig.enableOrdering;
  const featuredItems = displayMenu.items.filter((i) => i.featured && i.available);
  // Live endpoint state wins; the menu-derived state is the fail-open
  // fallback when the endpoint is unreachable (an outage never stops orders).
  // resolveLiveOrdering additionally discards a provably-stale paused value
  // so bar and drawer flip in the same second the deadline passes.
  const liveOrderingState: OrderingStatus | null = resolveLiveOrdering(orderingState, displayMenu, serverNow());
  // Seasonal theme id + go-live flag. Effects render only when a known
  // season is armed AND the dashboard flipped it live (old docs lack the
  // block → treated as off). Equality against the known id (not `!== 'off'`):
  // a future id an old client doesn't know must NOT download the seasonal
  // chunk — it renders as plain `off` until the client learns it.
  const seasonalTheme: 'christmas' | null =
    displayMenu.settings.seasonal?.theme === 'christmas' && displayMenu.settings.seasonal?.live === true
      ? 'christmas'
      : null;

  return (
    <>
    {/* Owner decision: every animation runs for every visitor, even when the
        OS requests reduced motion or the device is in power saving. */}
    <div
      ref={progressRef}
      style={{ transform: 'scaleX(0)', opacity: 0, background: themeConfig.colors.primary }}
      className="fixed top-[env(safe-area-inset-top)] inset-x-0 h-[3px] origin-left rtl:origin-right z-[60] pointer-events-none"
      aria-hidden="true"
    />
    {/* Seasonal layer (customer site only — the admin path returned above):
        lazy chunk, mounts only while a theme is active; `off` = zero bytes. */}
    {seasonalTheme && (
      <Suspense fallback={null}>
        <SeasonalEffects theme={seasonalTheme} lang={lang} />
      </Suspense>
    )}
    <div
      className={`min-h-screen min-h-dvh transition-colors duration-300 font-sans ${
        darkMode ? 'bg-[#0A0A0A] text-white' : 'bg-[#0A0A0A]'
      }`}
    >
      {/* Responsive Luxury Canvas: fluid on mobile, expanding gracefully on tablet/desktop */}
      <div
        className={`w-full min-h-screen min-h-dvh mx-auto flex flex-col overflow-x-hidden overflow-x-clip transition-colors duration-300 relative ${
          darkMode ? 'bg-[#0A0A0A] text-white' : 'bg-[#FFFFFF] text-[#0A0A0A]'
        }`}
      >
        {/* Offline Banner Indicator */}
        {isOffline && (
          <div className="bg-amber-500 text-black px-4 py-1.5 text-xs font-bold flex items-center justify-center gap-2 sticky top-0 z-50">
            <WifiOff size={14} />
            <span>{isAr ? 'أنت في وضع عدم الاتصال (يعمل من الذاكرة المخزنة)' : 'You are offline (cached menu)'}</span>
          </div>
        )}

        {/* Announcement strip (menu-loaded only, no layout flicker).
            Plan-gated: starter builds hide it entirely (backend also freezes
            the stored block on save, so an upgrade restores it untouched). */}
        {menu && featuresConfig.enableAnnouncements && (
          <AnnouncementBanner settings={menu.settings} lang={lang} />
        )}

        {/* Hero Header (static shell: paints instantly, no menu wait) */}
        <Header
          menu={displayMenu}
          lang={lang}
          onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          onOpenAdmin={adminUnlocked ? () => openAdmin() : undefined}
          onOpenAuth={() => { setAuthEntry('account'); setIsAuthOpen(true); }}
          onOpenAccount={() => openAccount()}
          orderingState={liveOrderingState}
          orderingEnabled={orderingOn}
          festive={seasonalTheme === 'christmas'}
        />

        {/* Main Content Area: skeleton reserves the slot until the real doc
            lands; search/chips/carousel/list mount only with real data so no
            filter state or animation ever re-runs on the swap. */}
        <main className="flex-1">
          {!menuReady ? (
            <MenuSectionsSkeleton lang={lang} darkMode={darkMode} />
          ) : (
            <>
              {/* Overlapping Search and Sticky Category Chips */}
              <SearchAndChips
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                categories={menu.categories}
                selectedCategory={selectedCategory}
                onSelectCategory={selectCategory}
                selectedBadge={selectedBadge}
                onToggleBadge={toggleBadge}
                lang={lang}
                darkMode={darkMode}
              />

              {/* Featured Horizontal Carousel (visible when 'all' is selected and no search) */}
              {selectedCategory === 'all' && !searchQuery.trim() && !selectedBadge && (
                <FeaturedCarousel
                  key={featuredItems.map((i) => i.id).join('|')}
                  items={featuredItems}
                  menu={menu}
                  onOpenItem={setActiveItem}
                  onAddToCart={handleAddItem}
                  currency={currency}
                  lang={lang}
                  darkMode={darkMode}
                  autoplay={menu.settings.featuredAutoplay !== false}
                  autoplayInterval={menu.settings.featuredAutoplayInterval || 4}
                  orderingEnabled={orderingOn}
                />
              )}

              {/* Menu Items List and Categorized Grids */}
              <MenuList
                categories={menu.categories}
                items={menu.items}
                menu={menu}
                selectedCategory={selectedCategory}
                searchQuery={searchQuery}
                selectedBadge={selectedBadge}
                cart={cart}
                onAddItem={handleAddItem}
                onUpdateLine={handleUpdateLine}
                onOpenItem={orderingOn ? setActiveItem : () => {}}
                currency={currency}
                lang={lang}
                darkMode={darkMode}
                orderingEnabled={orderingOn}
              />
            </>
          )}
        </main>

        {/* Footer (static shell: paints instantly, no menu wait) */}
        <Footer
          menu={displayMenu}
          onOpenAdmin={adminUnlocked ? () => openAdmin() : undefined}
          lang={lang}
        />

        {/* Floating order bell (12h shelf, ordering plans only): guests only.
            Signed-in members track the same orders inside "My orders", so the
            bell never mounts for them. For guests it mounts only while the
            shelf is non-empty (no timers, listeners or audio otherwise). */}
        {orderingOn && bellReady && hasOrders && !customerSession.isPending && !customerSession.user && (
          <Suspense fallback={null}>
            <OrdersBell lang={lang} darkMode={darkMode} />
          </Suspense>
        )}

        {/* Floating Cart Bottom Bar (ordering plans only) */}
        {orderingOn && (
        <CartBar
          totalCount={totalCartCount}
          totalPrice={totalCartPrice}
          currency={currency}
          onOpenCart={() => setIsCartOpen(true)}
          onClearCart={handleClearCart}
          lang={lang}
          orderingState={liveOrderingState}
        />
        )}

        {/* Item Details Bottom Sheet Modal (ordering plans only). Mounted only
            while an item is open so its lazy chunk never loads at boot. */}
        {orderingOn && activeItem && (
        <Suspense fallback={null}>
        <ItemDetailsModal
          item={activeItem}
          menu={displayMenu}
          onClose={() => setActiveItem(null)}
          onAddConfigured={handleAddConfigured}
          currency={currency}
          lang={lang}
          darkMode={darkMode}
        />
        </Suspense>
        )}

        {/* Full Cart Checkout Bottom Sheet (ordering plans only). Mounted once
            the cart is opened or has lines, so an empty cold visit never fetches
            the checkout chunk. */}
        {orderingOn && (isCartOpen || totalCartCount > 0) && (
        <Suspense fallback={null}>
        <CartDrawer
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          menu={displayMenu}
          lines={cartLines}
          onUpdateLine={handleUpdateLine}
          onRemoveLine={handleRemoveLine}
          onRemoveAddon={handleRemoveAddon}
          onClearCart={handleClearCart}
          currency={currency}
          lang={lang}
          darkMode={darkMode}
          orderingState={liveOrderingState}
          justAddedKey={justAddedLine?.key ?? null}
          onRequireAccount={() => {
            setAuthEntry('checkout');
            setIsAuthOpen(true);
          }}
          onRequireProfile={() => openAccount('settings')}
        />
        </Suspense>
        )}

        {/* Customer auth sheet (lazy chunk, mounted only while open) */}
        {isAuthOpen && (
        <Suspense fallback={null}>
          <AuthSheet
            open={isAuthOpen}
            onClose={() => {
              setIsAuthOpen(false);
              setResetToken(null);
              setAuthEntry('account');
            }}
            onSuccess={() => {
              setIsAuthOpen(false);
              if (authEntry === 'checkout') {
                setAuthEntry('account');
                setIsCartOpen(true);
                return;
              }
              openAccount();
            }}
            lang={lang}
            darkMode={darkMode}
            resetToken={resetToken}
            onResetComplete={() => setResetToken(null)}
            initialMode={authEntry === 'checkout' ? 'signup' : 'signin'}
            googleCallback={authEntry === 'checkout' ? '/?checkout=1' : '/?account=1'}
          />
        </Suspense>
        )}

        {/* Customer account sheet: orders + saved details (lazy chunk, mounted
            only while open) */}
        {isAccountOpen && (
        <Suspense fallback={null}>
          <AccountSheet
            open={isAccountOpen}
            onClose={() => setIsAccountOpen(false)}
            onSignIn={() => {
              setIsAccountOpen(false);
              setAuthEntry('account');
              setIsAuthOpen(true);
            }}
            lang={lang}
            darkMode={darkMode}
            currency={currency}
            cancelWindowMs={cancelWindowMsFromMenu(displayMenu)}
            phoneDial={dialFromSettings(displayMenu.settings)}
            initialTab={accountInitialTab}
          />
        </Suspense>
        )}
      </div>
    </div>
    </>
  );
}
