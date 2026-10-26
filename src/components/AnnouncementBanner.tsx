import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'motion/react';
import { X, Megaphone } from 'lucide-react';
import type { MenuSettings } from '../types/menu';
import { serverNow } from '../utils/serverTime';

interface AnnouncementBannerProps {
  settings: MenuSettings;
  lang: 'en' | 'ar';
}

/** djb2 hash for the dismissal key (text + expiry => changed text reappears). */
function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `ann-dismiss-${(h >>> 0).toString(36)}`;
}

function isVisible(ann: MenuSettings['announcement'], lang: 'en' | 'ar', now: number): string {
  if (!ann || !ann.enabled) return '';
  const text = (lang === 'ar' ? ann.text.ar : ann.text.en) || (lang === 'ar' ? ann.text.en : ann.text.ar) || '';
  if (!text.trim()) return '';
  if (ann.startsAt) {
    const t = Date.parse(ann.startsAt);
    if (!Number.isFinite(t) || now < t) return '';
  }
  if (ann.expiresAt) {
    const t = Date.parse(ann.expiresAt);
    if (!Number.isFinite(t) || now >= t) return '';
  }
  return text;
}

export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({ settings, lang }) => {
  const isAr = lang === 'ar';
  const reduce = useReducedMotion();
  const [, setTick] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Re-evaluate every 60 s so the strip disappears by itself at expiry.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  const text = isVisible(settings.announcement, lang, serverNow());
  const key = text ? hashKey(`${text}|${settings.announcement.expiresAt || ''}`) : '';
  let stored = false;
  try {
    stored = !!key && window.sessionStorage.getItem(key) === '1';
  } catch {}
  const show = !!text && !stored && dismissed !== key;
  const label = isAr ? 'إعلان' : 'Announcement';

  const dismiss = () => {
    try {
      if (key) window.sessionStorage.setItem(key, '1');
    } catch {}
    setDismissed(key);
  };

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          role="region"
          aria-label={label}
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden bg-[#FFC400] text-[#0A0A0A] sticky top-0 z-50"
        >
          <div className="flex items-center gap-2 px-3 py-2 max-w-5xl mx-auto">
            <Megaphone size={15} className="shrink-0" aria-hidden="true" />
            <p className="flex-1 min-w-0 text-xs font-bold leading-snug line-clamp-2">{text}</p>
            <button
              type="button"
              onClick={dismiss}
              aria-label={isAr ? 'إغلاق الإعلان' : 'Dismiss announcement'}
              className="shrink-0 w-11 h-11 -my-2 flex items-center justify-center rounded-full hover:bg-black/10 active:bg-black/20 transition-colors"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
