import { useState, useEffect } from 'react';
import { MenuData } from '@/src/types/menu';

export function useAppPrefs(menu: MenuData | null) {
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
  // Render-phase adjustment (blessed pattern): applies before paint, so a
  // first visit never flashes the fallback theme. Re-applies if the menu
  // doc itself changes, mirroring the old effect's [menu] dependency.
  const [prefsMenuVersion, setPrefsMenuVersion] = useState<number | null>(null);
  if (menu && menu.version !== prefsMenuVersion) {
    setPrefsMenuVersion(menu.version);
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
  }

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

  return { lang, setLang, darkMode, setDarkMode };
}
