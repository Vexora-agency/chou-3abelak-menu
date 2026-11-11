import { useState, useEffect, Suspense, lazy, useRef } from 'react';
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
import { SearchAndChips, FeaturedCarousel, MenuList, ItemDetailsModal, useMenuLoader } from '@/src/features/menu';
import { CartBar, CartDrawer } from '@/src/features/cart';
import { Footer } from '@/src/components/Footer';
import { useAdminSaveMenu } from '@/src/features/admin/hooks/useAdminSaveMenu';
import { useAdminSaveAuth } from '@/src/features/admin/hooks/useAdminSaveAuth';
import { scheduleIdle } from '@/src/utils/scheduleIdle';
import { loadCustomerOrders } from '@/src/utils/customerOrders';
// Admin UI is a separate chunk, downloaded only when /admin opens: customers
// never pay for the panel, editors and backup code. NOTE: these dynamic
// imports bypass the admin barrel ON PURPOSE — importing the barrel (even
// lazily) keeps it in the main chunk because the hooks above import it
// statically, which silently disables the split (verified: 1,164 kB stayed
// 1,164 kB). Static imports elsewhere still go through the barrel.
const AdminPanel = lazy(() => import('@/src/features/admin/components/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const AdminLogin = lazy(() => import('@/src/features/admin/components/AdminLogin'));
// One-time invite landing (/invite/<token>): its own chunk — customers never
// download it, and it downloads no admin code either.
const InvitePage = lazy(() =>
  import('@/src/features/invite/components/InvitePage').then((m) => ({ default: m.InvitePage }))
);
// Customer order tracking (?track=N&t=token): its own chunk — only tracking
// visitors download it.
const TrackView = lazy(() =>
  import('@/src/features/track/TrackView').then((m) => ({ default: m.TrackView }))
);
// Seasonal storefront layer (snow + greeting): its own chunk, downloaded
// ONLY while a seasonal theme is active — `off` costs zero bytes (the
// component below renders nothing and the import never fires).
const SeasonalEffects = lazy(() =>
  import('@/src/features/seasonal/SeasonalEffects').then((m) => ({ default: m.SeasonalEffects }))
);
// Floating order bell (12h shelf): tiny, lives in the main chunk — it must
// be present on the menu page itself. ReceivedButton stays out (only the
// bell + tracking page pull it, via their own imports).
import { OrdersBell } from '@/src/features/track/components/OrdersBell';
import { WifiOff } from 'lucide-react';
import { useShopCartState } from '@/src/features/cart';
import { useOrderingState } from '@/src/features/orders';
import { useAppPrefs } from '@/src/hooks/useAppPrefs';
import { MotionConfig } from 'motion/react';

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
        srcSet="/assets/logo-final-480.webp 480w, /assets/logo-final-880.webp 880w"
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

  // Cart Drawer
  const [isCartOpen, setIsCartOpen] = useState(false);

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
  });

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
  // Seasonal theme id (old docs lack the block → undefined → treated as off).
  // Equality against the known id (not `!== 'off'`): a future id an old
  // client doesn't know must NOT download the seasonal chunk — it renders
  // as plain `off` until the client learns it.
  const seasonalTheme: 'christmas' | null =
    displayMenu.settings.seasonal?.theme === 'christmas' ? 'christmas' : null;

  return (
    <MotionConfig reducedMotion="never">
    {/* Owner decision: every animation runs for every visitor, even when the
        OS requests reduced motion or the device is in power saving. */}
    <div
      ref={progressRef}
      style={{ transform: 'scaleX(0)', opacity: 0, background: themeConfig.colors.primary }}
      className="fixed top-0 inset-x-0 h-[3px] origin-left rtl:origin-right z-[60] pointer-events-none"
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
          orderingState={liveOrderingState}
          orderingEnabled={orderingOn}
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

        {/* Floating order bell (12h shelf, ordering plans only): mounted
            only while the customer actually has orders — otherwise it
            doesn't exist at all (no timers, no listeners, no audio). */}
        {orderingOn && bellReady && hasOrders && (
          <OrdersBell lang={lang} darkMode={darkMode} />
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

        {/* Item Details Bottom Sheet Modal (ordering plans only) */}
        {orderingOn && (
        <ItemDetailsModal
          item={activeItem}
          menu={displayMenu}
          onClose={() => setActiveItem(null)}
          onAddConfigured={handleAddConfigured}
          currency={currency}
          lang={lang}
          darkMode={darkMode}
        />
        )}

        {/* Full Cart Checkout Bottom Sheet (ordering plans only) */}
        {orderingOn && (
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
        />
        )}
      </div>
    </div>
    </MotionConfig>
  );
}
