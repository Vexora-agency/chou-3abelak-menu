import React, { useState, useEffect, useMemo } from 'react';
import { MenuData, MenuItem, CartItem, CartLine, ResolvedCartLine, AdminSaveResult } from './types/menu';
import {
  normalizeMenu, cartLineKey, clampQty, isValidQty, lineTotal,
  perUnitPrice, hasOptions, normalizePricing,
} from './utils/pricing';
import { Header } from './components/Header';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { getOrderingState, type OrderingStatus } from './utils/status';
import { serverNow, setServerOffsetFromDateHeader } from './utils/serverTime';
import { SearchAndChips } from './components/SearchAndChips';
import { FeaturedCarousel } from './components/FeaturedCarousel';
import { MenuList } from './components/MenuList';
import { ItemDetailsModal } from './components/ItemDetailsModal';
import { CartBar } from './components/CartBar';
import { CartDrawer } from './components/CartDrawer';
import { Footer } from './components/Footer';
import { AdminPanel } from './components/AdminPanel';
import AdminLogin, { type LoginResult } from './components/AdminLogin';
import { WifiOff } from 'lucide-react';

/** Resolve one persisted line against the live menu (null when broken). */
function resolveLine(menu: MenuData, key: string, line: CartLine): ResolvedCartLine | null {
  const item = menu.items.find((i) => i.id === line.id);
  if (!item || !item.available) return null;
  try {
    const addonIds = Array.isArray(line.addonIds) ? line.addonIds : [];
    const unit = perUnitPrice(item, { variantId: line.variantId, addonIds });
    const total = lineTotal(item, { variantId: line.variantId, addonIds, qty: line.quantity });
    return { key, item, variantId: line.variantId, addonIds, quantity: line.quantity, unit, total };
  } catch {
    return null;
  }
}

/** Load the persisted cart, migrating the legacy id->qty shape. */
function loadCart(): Record<string, CartLine> {
  try {
    const saved = localStorage.getItem('cart_v1');
    if (!saved) return {};
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, CartLine> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number') {
        if (Number.isInteger(v) && (v as number) > 0) out[cartLineKey(k)] = { id: k, quantity: v as number };
      } else if (v && typeof v === 'object') {
        const l = v as Partial<CartLine>;
        if (typeof l.id === 'string' && Number.isInteger(l.quantity) && (l.quantity as number) > 0) {
          const line: CartLine = { id: l.id, quantity: l.quantity as number };
          if (typeof l.variantId === 'string' && l.variantId) line.variantId = l.variantId;
          if (Array.isArray(l.addonIds) && l.addonIds.length) line.addonIds = [...l.addonIds];
          out[cartLineKey(line.id, line.variantId, line.addonIds)] = line;
        }
      }
    }
    return out;
  } catch {
    return {};
  }
}
import { MotionConfig, motion, useScroll, useSpring, useTransform } from 'motion/react';

export default function App() {
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [orderingState, setOrderingState] = useState<OrderingStatus | null>(null);

  const fetchOrderingState = async () => {
    try {
      const res = await fetch('/api/ordering-state').catch(() => null);
      if (!res || !res.ok) return;
      setServerOffsetFromDateHeader(res.headers.get('Date'));
      const data = await res.json().catch(() => null);
      if (data && (data.state === 'open' || data.state === 'paused' || data.state === 'closed' || data.state === 'disabled')) {
        setOrderingState({
          state: data.state,
          message: data.message && typeof data.message === 'object' ? { en: data.message.en || '', ar: data.message.ar || '' } : { en: '', ar: '' },
          ...(typeof data.reopensAt === 'string' ? { reopensAt: data.reopensAt } : {}),
        });
      }
    } catch {}
  };

  // Ordering availability refreshes with the menu and every minute after.
  useEffect(() => {
    fetchOrderingState();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') fetchOrderingState();
    }, 60000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Language state: 'en' | 'ar' (first visit falls back to the admin default)
  const [lang, setLang] = useState<'en' | 'ar'>(() => {
    try {
      const saved = localStorage.getItem('menu_lang_v1');
      if (saved === 'ar' || saved === 'en') return saved;
    } catch {}
    return 'en';
  });

  // Dark mode state (first visit falls back to the admin default: dark)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('menu_theme_v1');
      if (saved !== null) return saved === 'dark';
    } catch {}
    return true;
  });

  // Apply the admin-configured defaults for first-time visitors only:
  // anyone who already picked a theme/language keeps their own choice.
  useEffect(() => {
    if (!menu) return;
    try {
      if (!localStorage.getItem('menu_lang_v1')) {
        setLang(menu.settings.defaultLang === 'ar' ? 'ar' : 'en');
      }
      if (!localStorage.getItem('menu_theme_v1')) {
        setDarkMode(menu.settings.defaultTheme !== 'light');
      }
    } catch {
      setLang(menu.settings.defaultLang === 'ar' ? 'ar' : 'en');
      setDarkMode(menu.settings.defaultTheme !== 'light');
    }
  }, [menu]);

  // Admin view toggle. The admin entry points are hidden from customers:
  // the owner opens the site with #admin at the end of the address.
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(() => window.location.hash === '#admin');
  // Cookie-session auth state for the admin area
  const [authStatus, setAuthStatus] = useState<'checking' | 'authed' | 'guest'>('checking');

  useEffect(() => {
    let cancelled = false;
    const checkSession = async () => {
      if (!adminUnlocked) {
        setAuthStatus('guest');
        return;
      }
      setAuthStatus('checking');
      try {
        const res = await fetch('/api/auth/session', {
          headers: { 'X-Requested-With': 'menu-admin' },
          credentials: 'same-origin',
        });
        // Require the exact shape, not just HTTP 200 (dev servers may
        // answer unknown /api routes with HTML and a 200 status).
        const data = await res.json().catch(() => null);
        if (!cancelled) setAuthStatus(res.ok && data && data.authenticated === true ? 'authed' : 'guest');
      } catch {
        if (!cancelled) setAuthStatus('guest');
      }
    };
    checkSession();
    return () => {
      cancelled = true;
    };
  }, [adminUnlocked]);

  const handleLoginSubmit = async (values: { username: string; password: string; remember: boolean }): Promise<LoginResult> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'menu-admin' },
        credentials: 'same-origin',
        body: JSON.stringify(values).slice(0, 4096),
      });
      if (res.ok) return { ok: true };
      if (res.status === 429) {
        let minutes = 10;
        try {
          const data = await res.json();
          if (typeof data.retryAfter === 'number' && data.retryAfter > 0) minutes = Math.ceil(data.retryAfter);
        } catch {}
        return { ok: false, error: 'locked', retryAfter: minutes };
      }
      if (res.status === 401) return { ok: false, error: 'invalid' };
      return { ok: false, error: 'network' };
    } catch {
      return { ok: false, error: 'network' };
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Requested-With': 'menu-admin' },
        credentials: 'same-origin',
      });
    } catch {}
    setAuthStatus('guest');
    closeAdmin();
  };

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

  // Cart lines keyed by id + variantId + sorted addonIds (legacy id->qty
  // carts migrate on load).
  const [cart, setCart] = useState<Record<string, CartLine>>(loadCart);

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
          setServerOffsetFromDateHeader(res.headers.get('Date'));
          const data: MenuData = await res.json();
          const normalized = normalizeMenu(data);
          setMenu(normalized);
          try {
            localStorage.setItem('menu_cache_v1', JSON.stringify(normalized));
          } catch {}
          setLoading(false);
          return;
        }
      } catch {}

      // Fallback to cache if available
      if (cached) {
        setMenu(normalizeMenu(cached));
        setLoading(false);
        return;
      }

      // Fallback to /menu.seed.json
      try {
        const seedRes = await fetch('/menu.seed.json');
        if (seedRes.ok) {
          const seedData: MenuData = await seedRes.json();
          const normalized = normalizeMenu(seedData);
          setMenu(normalized);
          try {
            localStorage.setItem('menu_cache_v1', JSON.stringify(normalized));
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

  // Clean lines that no longer resolve (item removed/unavailable, variant or
  // add-on gone) and snap quantities back onto the item's min/step/max grid.
  useEffect(() => {
    if (!menu) return;
    setCart((prev) => {
      const entries = Object.entries(prev);
      if (entries.length === 0) return prev;
      let changed = false;
      const out: Record<string, CartLine> = {};
      for (const [, line] of entries) {
        const item = menu.items.find((i) => i.id === line.id);
        if (!item || !item.available) {
          changed = true;
          continue;
        }
        try {
          perUnitPrice(item, { variantId: line.variantId, addonIds: line.addonIds });
        } catch {
          changed = true;
          continue;
        }
        if (!isValidQty(item, line.quantity)) {
          const fixed = clampQty(item, line.quantity);
          if (fixed !== line.quantity) {
            changed = true;
            out[cartLineKey(line.id, line.variantId, line.addonIds)] = { ...line, quantity: fixed };
            continue;
          }
        }
        out[cartLineKey(line.id, line.variantId, line.addonIds)] = line;
      }
      return changed ? out : prev;
    });
  }, [menu]);

  // Cart operations (quantity grid: minQty start, step increments,
  // dropping below minQty removes the line).
  const handleAddItem = (item: MenuItem) => {
    if (!item.available || !menu) return;
    if (hasOptions(item)) {
      setActiveItem(item);
      return;
    }
    const p = normalizePricing(item);
    const key = cartLineKey(item.id);
    setCart((prev) => {
      const ex = prev[key];
      const next = ex ? Math.min(ex.quantity + p.step, p.maxQty) : p.minQty;
      return { ...prev, [key]: { id: item.id, quantity: next } };
    });
  };

  const snapDown = (item: MenuItem, qty: number) => {
    const p = normalizePricing(item);
    const capped = Math.min(qty, p.maxQty);
    return p.minQty + Math.floor((capped - p.minQty) / p.step) * p.step;
  };

  const handleAddConfigured = (item: MenuItem, variantId: string | undefined, addonIds: string[], qty: number) => {
    if (!item.available) return;
    const key = cartLineKey(item.id, variantId, addonIds);
    setCart((prev) => {
      const ex = prev[key];
      const quantity = ex ? snapDown(item, ex.quantity + qty) : qty;
      const line: CartLine = { id: item.id, quantity };
      if (variantId) line.variantId = variantId;
      if (addonIds.length) line.addonIds = [...addonIds];
      return { ...prev, [key]: line };
    });
  };

  const handleUpdateLine = (key: string, dir: 1 | -1) => {
    setCart((prev) => {
      const line = prev[key];
      if (!line) return prev;
      const item = menu?.items.find((i) => i.id === line.id);
      if (!item) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      const p = normalizePricing(item);
      const next = line.quantity + dir * p.step;
      if (next < p.minQty) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      if (next > p.maxQty) return prev;
      return { ...prev, [key]: { ...line, quantity: next } };
    });
  };

  const handleRemoveLine = (key: string) => {
    setCart((prev) => {
      if (!prev[key]) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const handleClearCart = () => {
    setCart({});
  };

  // Sends the admin's filled copy to the server and resolves with the
  // authoritative doc. The admin screen keeps its raw text on screen
  // (autofill appears after reload); only the version is adopted there.
  const handleSaveMenuFromAdmin = (newMenu: MenuData, source?: 'manual' | 'autosave'): Promise<AdminSaveResult | null> => {
    // Send to the backend and surface any failure instead of hiding it
    return fetch(`/api/admin/menu${source === 'autosave' ? '?source=autosave' : ''}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'menu-admin',
      },
      credentials: 'same-origin',
      body: JSON.stringify(newMenu),
    })
      .then(async (res): Promise<AdminSaveResult | null> => {
        if (res.ok) {
          // Adopt the server copy so the customer view is current
          const saved: MenuData | null = await res.json().catch(() => null);
          if (saved && saved.settings && Array.isArray(saved.items)) {
            setMenu(saved);
            try {
              localStorage.setItem('menu_cache_v1', JSON.stringify(saved));
            } catch {}
            return { doc: saved, saved: true };
          }
          return null;
        }
        const detail = await res.text().catch(() => '');
        if (res.status === 409) {
          let latest: MenuData | null = null;
          try {
            const data = JSON.parse(detail);
            if (data && data.latest && data.latest.settings && Array.isArray(data.latest.items)) {
              latest = data.latest;
            }
          } catch {}
          window.alert('The menu was changed somewhere else. Reload the page and try again.');
          return latest ? { doc: latest, saved: false } : null;
        }
        window.alert(
          `Save failed (${res.status}). The change is visible only on this device.\n${detail.slice(0, 160)}`
        );
        return null;
      })
      .catch((): AdminSaveResult | null => {
        window.alert('Network error: the change was NOT saved to the server.');
        return null;
      });
  };

  // Cart lines with real money, and totals
  const cartLines = useMemo(() => {
    if (!menu) return [];
    const out: ResolvedCartLine[] = [];
    for (const [key, line] of Object.entries(cart)) {
      const r = resolveLine(menu, key, line);
      if (r) out.push(r);
    }
    return out;
  }, [menu, cart]);

  const totalCartCount = useMemo(() => {
    return cartLines.reduce((sum, l) => sum + l.quantity, 0);
  }, [cartLines]);

  const totalCartPrice = useMemo(() => {
    return cartLines.reduce((sum, l) => sum + l.total, 0);
  }, [cartLines]);

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
          onSignOut={handleLogout}
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
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
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
