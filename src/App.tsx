import React, { useState, useEffect, useMemo } from 'react';
import { MenuData, MenuItem, CartItem } from './types/menu';
import { Header } from './components/Header';
import { SearchAndChips } from './components/SearchAndChips';
import { FeaturedCarousel } from './components/FeaturedCarousel';
import { MenuList } from './components/MenuList';
import { ItemDetailsModal } from './components/ItemDetailsModal';
import { CartBar } from './components/CartBar';
import { CartDrawer } from './components/CartDrawer';
import { Footer } from './components/Footer';
import { AdminPanel } from './components/AdminPanel';
import { WifiOff } from 'lucide-react';
import { MotionConfig, motion, useScroll, useSpring, useTransform } from 'motion/react';

export default function App() {
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Language state: 'en' | 'ar'
  const [lang, setLang] = useState<'en' | 'ar'>(() => {
    try {
      const saved = localStorage.getItem('menu_lang_v1');
      if (saved === 'ar' || saved === 'en') return saved;
    } catch {}
    return 'en';
  });

  // Dark mode state
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('menu_theme_v1');
      if (saved !== null) return saved === 'dark';
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Admin view toggle. The admin entry points are hidden from customers:
  // the owner opens the site with #admin at the end of the address.
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(() => window.location.hash === '#admin');

  useEffect(() => {
    const syncAdminHash = () => {
      const unlocked = window.location.hash === '#admin';
      setAdminUnlocked(unlocked);
      if (unlocked) setShowAdmin(true);
    };
    syncAdminHash();
    window.addEventListener('hashchange', syncAdminHash);
    return () => window.removeEventListener('hashchange', syncAdminHash);
  }, []);

  const closeAdmin = () => {
    setShowAdmin(false);
    setAdminUnlocked(false);
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  // Thin reading-progress line at the top of the page
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, mass: 0.4 });
  const progressOpacity = useTransform(scrollYProgress, [0, 0.01], [0, 1]);

  // Search & Category Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Modal Item Details
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);

  // Cart Drawer
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Cart Items State (id -> quantity)
  const [cart, setCart] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('cart_v1');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  // Sync HTML lang, dir, and dark classes
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('menu_lang_v1', lang);
    } catch {}
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('menu_theme_v1', darkMode ? 'dark' : 'light');
    } catch {}
  }, [darkMode]);

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

  // Fetch Menu on load
  useEffect(() => {
    const loadMenu = async () => {
      // 1. Check local storage cache
      let cached: MenuData | null = null;
      try {
        const raw = localStorage.getItem('menu_cache_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.settings?.currency?.en === 'EGP' || (parsed?.version || 1) < 2) {
            localStorage.removeItem('menu_cache_v1');
          } else {
            cached = parsed;
          }
        }
      } catch {}

      try {
        // Try to fetch from /api/menu or fallback to /menu.seed.json
        const res = await fetch('/api/menu').catch(() => null);
        if (res && res.ok) {
          const data: MenuData = await res.json();
          setMenu(data);
          try {
            localStorage.setItem('menu_cache_v1', JSON.stringify(data));
          } catch {}
          setLoading(false);
          return;
        }
      } catch {}

      // Fallback to cache if available
      if (cached) {
        setMenu(cached);
        setLoading(false);
        return;
      }

      // Fallback to /menu.seed.json
      try {
        const seedRes = await fetch('/menu.seed.json');
        if (seedRes.ok) {
          const seedData: MenuData = await seedRes.json();
          setMenu(seedData);
          try {
            localStorage.setItem('menu_cache_v1', JSON.stringify(seedData));
          } catch {}
        }
      } catch (err) {
        console.error('Failed to load menu seed', err);
      } finally {
        setLoading(false);
      }
    };

    loadMenu();
  }, []);

  // Sync Cart to LocalStorage and clean unavailable items
  useEffect(() => {
    try {
      localStorage.setItem('cart_v1', JSON.stringify(cart));
    } catch {}
  }, [cart]);

  // Clean invalid items if menu loaded
  useEffect(() => {
    if (!menu) return;
    setCart((prev) => {
      const cleaned: Record<string, number> = {};
      let changed = false;
      Object.entries(prev).forEach(([id, qty]) => {
        const exists = menu.items.find((i) => i.id === id && i.available);
        if (exists && qty > 0) {
          cleaned[id] = Math.min(qty, 20);
        } else {
          changed = true;
        }
      });
      return changed ? cleaned : prev;
    });
  }, [menu]);

  // Cart operations
  const handleAddToCart = (item: MenuItem) => {
    if (!item.available) return;
    setCart((prev) => ({
      ...prev,
      [item.id]: Math.min((prev[item.id] || 0) + 1, 20),
    }));
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prev) => {
      const current = prev[itemId] || 0;
      const next = current + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return {
        ...prev,
        [itemId]: Math.min(next, 20),
      };
    });
  };

  const handleRemoveFromCart = (itemId: string) => {
    setCart((prev) => {
      const copy = { ...prev };
      delete copy[itemId];
      return copy;
    });
  };

  const handleClearCart = () => {
    setCart({});
  };

  const handleSaveMenuFromAdmin = (newMenu: MenuData) => {
    setMenu(newMenu);
    try {
      localStorage.setItem('menu_cache_v1', JSON.stringify(newMenu));
    } catch {}
    // Send to the backend and surface any failure instead of hiding it
    fetch('/api/admin/menu', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'menu-admin',
      },
      body: JSON.stringify(newMenu),
    })
      .then(async (res) => {
        if (res.ok) {
          // Adopt the server copy so the next save carries the right version number
          const saved: MenuData | null = await res.json().catch(() => null);
          if (saved && saved.settings && Array.isArray(saved.items)) {
            setMenu(saved);
            try {
              localStorage.setItem('menu_cache_v1', JSON.stringify(saved));
            } catch {}
          }
          return;
        }
        const detail = await res.text().catch(() => '');
        window.alert(
          res.status === 409
            ? 'The menu was changed somewhere else. Reload the page and try again.'
            : `Save failed (${res.status}). The change is visible only on this device.\n${detail.slice(0, 160)}`
        );
      })
      .catch(() => {
        window.alert('Network error: the change was NOT saved to the server.');
      });
  };

  // Cart Totals and items list
  const cartItemsList = useMemo(() => {
    if (!menu) return [];
    return Object.entries(cart)
      .map(([id, quantity]) => {
        const item = menu.items.find((i) => i.id === id);
        return item ? { item, quantity } : null;
      })
      .filter((entry): entry is { item: MenuItem; quantity: number } => entry !== null);
  }, [menu, cart]);

  const totalCartCount = useMemo(() => {
    return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  }, [cart]);

  const totalCartPrice = useMemo(() => {
    return cartItemsList.reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0);
  }, [cartItemsList]);

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

  // Admin View
  if (showAdmin) {
    return (
      <AdminPanel
        initialMenu={menu}
        onSaveMenu={handleSaveMenuFromAdmin}
        onClose={closeAdmin}
        lang={lang}
      />
    );
  }

  const isAr = lang === 'ar';
  const currency = isAr ? menu.settings.currency.ar : menu.settings.currency.en;
  const featuredItems = menu.items.filter((i) => i.featured && i.available);

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

        {/* Hero Header */}
        <Header
          menu={menu}
          lang={lang}
          onToggleLang={() => setLang(lang === 'en' ? 'ar' : 'en')}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          onOpenAdmin={adminUnlocked ? () => setShowAdmin(true) : undefined}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {/* Main Content Area */}
        <main className="flex-1">
          {/* Overlapping Search and Sticky Category Chips */}
          <SearchAndChips
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            categories={menu.categories}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
            lang={lang}
            darkMode={darkMode}
          />

          {/* Featured Horizontal Carousel (visible when 'all' is selected and no search) */}
          {selectedCategory === 'all' && !searchQuery.trim() && (
            <FeaturedCarousel
              items={featuredItems}
              onOpenItem={setActiveItem}
              onAddToCart={handleAddToCart}
              currency={currency}
              lang={lang}
              darkMode={darkMode}
            />
          )}

          {/* Menu Items List and Categorized Grids */}
          <MenuList
            categories={menu.categories}
            items={menu.items}
            selectedCategory={selectedCategory}
            searchQuery={searchQuery}
            cartQuantities={cart}
            onAddToCart={handleAddToCart}
            onUpdateQuantity={handleUpdateQuantity}
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
        />

        {/* Item Details Bottom Sheet Modal */}
        <ItemDetailsModal
          item={activeItem}
          onClose={() => setActiveItem(null)}
          cartQuantity={activeItem ? cart[activeItem.id] || 0 : 0}
          onAddToCart={handleAddToCart}
          onUpdateQuantity={handleUpdateQuantity}
          currency={currency}
          lang={lang}
          darkMode={darkMode}
        />

        {/* Full Cart Checkout Bottom Sheet */}
        <CartDrawer
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          menu={menu}
          cartItems={cartItemsList}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveFromCart}
          onClearCart={handleClearCart}
          currency={currency}
          lang={lang}
          darkMode={darkMode}
        />
      </div>
    </div>
    </MotionConfig>
  );
}
