import { useState, useEffect, Suspense, lazy, useRef } from 'react';
import { MenuItem } from '@/src/types/menu';
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
// Admin UI is a separate chunk, downloaded only when /admin opens: customers
// never pay for the panel, editors and backup code. NOTE: these dynamic
// imports bypass the admin barrel ON PURPOSE — importing the barrel (even
// lazily) keeps it in the main chunk because the hooks above import it
// statically, which silently disables the split (verified: 1,164 kB stayed
// 1,164 kB). Static imports elsewhere still go through the barrel.
const AdminPanel = lazy(() => import('@/src/features/admin/components/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const AdminLogin = lazy(() => import('@/src/features/admin/components/AdminLogin'));
import { WifiOff } from 'lucide-react';
import { useShopCartState } from '@/src/features/cart';
import { useOrderingState } from '@/src/features/orders';
import { useAppPrefs } from '@/src/hooks/useAppPrefs';
import { MotionConfig } from 'motion/react';

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
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const { orderingState } = useOrderingState();
  const {
    showAdmin, openAdmin, adminUnlocked, authStatus, setAuthStatus,
    handleLoginSubmit, handleLogout, closeAdmin,
  } = useAdminSaveAuth();
  const { lang, setLang, darkMode, setDarkMode } = useAppPrefs(menu);
  const handleSaveMenuFromAdmin = useAdminSaveMenu(setMenu);

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
    const onResize = () => {
      measure();
      update();
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
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Skeleton Loader while menu initial fetch happens (white-label: logo + colors from config)
  if (loading || !menu) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-white text-center" style={{ background: themeConfig.colors.background }}>
        <div className="w-16 h-16 rounded-full border-4 border-t-transparent animate-spin mb-4" style={{ borderColor: themeConfig.colors.primary, borderTopColor: 'transparent' }} />
        <h2 className="text-xl font-bold tracking-wide">{clientConfig.companyNameEn} · {clientConfig.companyNameAr}</h2>
        <p className="text-xs text-neutral-400 mt-1">Loading delicious menu...</p>
      </div>
    );
  }

  // Admin View (gated by /admin path + cookie session)
  if (showAdmin) {
    // TEMPORARY local preview shortcut (?dev-admin): compiled out of
    // production builds (import.meta.env.DEV is statically false there),
    // so it can never reach customers. REMOVE BEFORE COMMIT.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev-admin')) {
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

  const isAr = lang === 'ar';
  const currency = isAr ? menu.settings.currency.ar : menu.settings.currency.en;
  // Menu-only mode (starter): no cart, no checkout, no item modal — the menu
  // is display-only with a call CTA. Gated in one place, passed down.
  const orderingOn = featuresConfig.enableOrdering;
  const featuredItems = menu.items.filter((i) => i.featured && i.available);
  // Live endpoint state wins; the menu-derived state is the fail-open
  // fallback when the endpoint is unreachable (an outage never stops orders).
  // resolveLiveOrdering additionally discards a provably-stale paused value
  // so bar and drawer flip in the same second the deadline passes.
  const liveOrderingState: OrderingStatus | null = resolveLiveOrdering(orderingState, menu, serverNow());

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
    <div
      className={`min-h-screen transition-colors duration-300 font-sans ${
        darkMode ? 'bg-[#0A0A0A] text-white' : 'bg-[#0A0A0A]'
      }`}
    >
      {/* Responsive Luxury Canvas: fluid on mobile, expanding gracefully on tablet/desktop */}
      <div
        className={`w-full min-h-screen mx-auto flex flex-col overflow-x-clip transition-colors duration-300 relative ${
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

        {/* Hero Header */}
        <Header
          menu={menu}
          lang={lang}
          onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          onOpenAdmin={adminUnlocked ? () => openAdmin() : undefined}
          orderingState={liveOrderingState}
          orderingEnabled={orderingOn}
        />

        {/* Main Content Area */}
        <main className="flex-1">
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
        </main>

        {/* Footer */}
        <Footer
          menu={menu}
          onOpenAdmin={adminUnlocked ? () => openAdmin() : undefined}
          lang={lang}
        />

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
          menu={menu}
          onClose={() => setActiveItem(null)}
          cart={cart}
          onAddItem={handleAddItem}
          onAddConfigured={handleAddConfigured}
          onUpdateLine={handleUpdateLine}
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
          menu={menu}
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
