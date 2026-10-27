import { useState, useEffect } from 'react';
import { MenuItem } from '@/src/types/menu';
import { Header } from '@/src/components/Header';
import { AnnouncementBanner } from '@/src/components/AnnouncementBanner';
import { getOrderingState, type OrderingStatus } from '@/src/utils/status';
import { serverNow } from '@/src/utils/serverTime';
import { SearchAndChips } from '@/src/components/SearchAndChips';
import { FeaturedCarousel } from '@/src/components/FeaturedCarousel';
import { MenuList } from '@/src/components/MenuList';
import { ItemDetailsModal } from '@/src/components/ItemDetailsModal';
import { CartBar } from '@/src/components/CartBar';
import { CartDrawer } from '@/src/components/CartDrawer';
import { Footer } from '@/src/components/Footer';
import { AdminPanel } from '@/src/components/AdminPanel';
import AdminLogin from '@/src/components/AdminLogin';
import { WifiOff } from 'lucide-react';
import { useMenuLoader } from '@/src/hooks/useMenuLoader';
import { useShopCartState } from '@/src/hooks/useShopCartState';
import { useAdminSaveMenu } from '@/src/hooks/useAdminSaveMenu';
import { useAdminSaveAuth } from '@/src/hooks/useAdminSaveAuth';
import { useOrderingState } from '@/src/hooks/useOrderingState';
import { useAppPrefs } from '@/src/hooks/useAppPrefs';
import { MotionConfig, motion, useScroll, useSpring, useTransform } from 'motion/react';

export default function App() {
  const { menu, setMenu, loading } = useMenuLoader();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const { orderingState } = useOrderingState();
  const {
    showAdmin, setShowAdmin, adminUnlocked, authStatus, setAuthStatus,
    handleLoginSubmit, handleLogout, closeAdmin,
  } = useAdminSaveAuth();
  const { lang, setLang, darkMode, setDarkMode } = useAppPrefs(menu);
  const handleSaveMenuFromAdmin = useAdminSaveMenu(setMenu);

  // Thin reading-progress line at the top of the page
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  const progressOpacity = useTransform(scrollYProgress, [0, 0.01], [0, 1]);

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
    handleAddItem, handleAddConfigured, handleUpdateLine, handleRemoveLine, handleClearCart,
  } = useShopCartState(menu, setActiveItem);

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

  // Skeleton Loader while menu initial fetch happens
  if (loading || !menu) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center p-6 text-white text-center">
        <div className="w-16 h-16 rounded-full border-4 border-[#FFC400] border-t-transparent animate-spin mb-4" />
        <h2 className="text-xl font-bold tracking-wide">Chou 3abelak · شو عبالك</h2>
        <p className="text-xs text-neutral-400 mt-1">Loading delicious menu...</p>
      </div>
    );
  }

  // Admin View (gated by #admin + cookie session)
  if (showAdmin) {
    // TEMPORARY local preview shortcut (?dev-admin): compiled out of
    // production builds (import.meta.env.DEV is statically false there),
    // so it can never reach customers. REMOVE BEFORE COMMIT.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('dev-admin')) {
      return (
        <AdminPanel
          initialMenu={menu}
          onSaveMenu={handleSaveMenuFromAdmin}
          onClose={closeAdmin}
          onSignOut={closeAdmin}
          onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
          lang={lang}
        />
      );
    }
    if (authStatus === 'checking') {
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6 text-white">
          <img
            src="/assets/logo-final.png"
            alt="Chou 3abelak"
            width={1440}
            height={532}
            className="w-48 h-auto animate-pulse"
          />
        </div>
      );
    }
    if (authStatus === 'authed') {
      return (
        <AdminPanel
          initialMenu={menu}
          onSaveMenu={handleSaveMenuFromAdmin}
          onClose={closeAdmin}
          onSignOut={() => void handleLogout()}
          onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
          lang={lang}
        />
      );
    }
    return (
      <AdminLogin
        lang={lang}
        onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
        onSubmit={handleLoginSubmit}
        onSuccess={() => setAuthStatus('authed')}
        onBack={closeAdmin}
      />
    );
  }

  const isAr = lang === 'ar';
  const currency = isAr ? menu.settings.currency.ar : menu.settings.currency.en;
  const featuredItems = menu.items.filter((i) => i.featured && i.available);
  // Live endpoint state wins; the menu-derived state is the fail-open
  // fallback when the endpoint is unreachable (an outage never stops orders).
  const liveOrderingState: OrderingStatus | null = orderingState ?? getOrderingState(menu.settings, serverNow());

  return (
    <MotionConfig reducedMotion="user">
    <motion.div
      style={{ scaleX: progress, opacity: progressOpacity }}
      className="fixed top-0 inset-x-0 h-[3px] bg-[#FFC400] origin-left rtl:origin-right z-[60] pointer-events-none"
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

        {/* Announcement strip (menu-loaded only, no layout flicker) */}
        {menu && (
          <AnnouncementBanner settings={menu.settings} lang={lang} />
        )}

        {/* Hero Header */}
        <Header
          menu={menu}
          lang={lang}
          onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          onOpenAdmin={adminUnlocked ? () => setShowAdmin(true) : undefined}
          orderingState={liveOrderingState}
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
            onOpenItem={setActiveItem}
            currency={currency}
            lang={lang}
            darkMode={darkMode}
          />
        </main>

        {/* Footer */}
        <Footer
          menu={menu}
          onOpenAdmin={adminUnlocked ? () => setShowAdmin(true) : undefined}
          lang={lang}
        />

        {/* Floating Cart Bottom Bar */}
        <CartBar
          totalCount={totalCartCount}
          totalPrice={totalCartPrice}
          currency={currency}
          onOpenCart={() => setIsCartOpen(true)}
          onClearCart={handleClearCart}
          lang={lang}
          orderingState={liveOrderingState}
        />

        {/* Item Details Bottom Sheet Modal */}
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

        {/* Full Cart Checkout Bottom Sheet */}
        <CartDrawer
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          menu={menu}
          lines={cartLines}
          onUpdateLine={handleUpdateLine}
          onRemoveLine={handleRemoveLine}
          onClearCart={handleClearCart}
          currency={currency}
          lang={lang}
          darkMode={darkMode}
          orderingState={liveOrderingState}
        />
      </div>
    </div>
    </MotionConfig>
  );
}
