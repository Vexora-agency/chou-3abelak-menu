import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { MenuSettings } from '@/src/types/menu';
import { serverNow } from '@/src/utils/serverTime';
import { annScroll, annSpeed, announcementStatus } from '@/src/utils/announcement';
import { useTickerLoop } from '@/src/hooks/useTickerLoop';

interface AnnouncementBannerProps {
  settings: MenuSettings;
  lang: 'en' | 'ar';
}

export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({ settings, lang }) => {
  const isAr = lang === 'ar';
  // Owner decision: every animation runs for every visitor, even when the
  // OS requests reduced motion or the device is in power saving.
  const reduce = false;
  const [, setTick] = useState(0);

  // Re-evaluate every 60 s so the strip disappears by itself at expiry.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  // NOTE: the banner used to hide on scroll-down via a height animation.
  // Collapsing a sticky bar changes the document height, which moves the
  // scroll position, which re-triggered the listener — a show/hide feedback
  // loop (visible flicker). The bar now stays sticky-visible whenever the
  // announcement is live: no scroll listener, no layout shift, no flicker.
  const { status, text } = announcementStatus(settings.announcement, lang, serverNow());
  const show = status === 'visible';
  const label = isAr ? 'إعلان' : 'Announcement';
  // Owner decision: the ticker ALWAYS scrolls when enabled — even when the
  // device requests reduced motion. (Hovering pauses it.) Entrance height
  // animation below still respects the OS setting.
  const marquee = show && annScroll(settings.announcement);
  const speed = annSpeed(settings.announcement);

  // Copies per half + loop duration, measured so the reading speed stays
  // constant: each half holds ≥1 viewport width, the track holds 2 halves
  // and loops 0 → -50% seamlessly.
  const { boxRef, half, duration, ready } = useTickerLoop(marquee, text, speed);

  const renderUnit = (key: number, hidden?: boolean) => (
    <span
      key={key}
      aria-hidden={hidden || undefined}
      className="ann-unit flex shrink-0 items-center"
    >
      <span dir={isAr ? 'rtl' : 'ltr'} className="text-[13px] font-extrabold tracking-wide leading-snug whitespace-nowrap">
        {text}
      </span>
      <span aria-hidden="true" className="mx-6 text-[10px] opacity-50 select-none">
        ✦
      </span>
    </span>
  );

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
          className="overflow-hidden bg-[var(--primary)] text-[#0A0A0A] sticky top-0 z-50 shadow-[0_1px_0_rgba(0,0,0,0.12)]"
        >
          {marquee ? (
            <div
              ref={boxRef}
              className="ann-mask overflow-hidden py-1.5 [mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]"
            >
              {/* Single readable copy for assistive tech; the loop is decorative. */}
              <p className="sr-only">{text}</p>
              <div
                aria-hidden="true"
                dir="ltr"
                className="ann-track"
                style={{ ['--ann-duration' as string]: `${Math.max(3, duration)}s`, animationName: ready ? 'annMarquee' : 'none' }}
              >
                {Array.from({ length: half * 2 }, (_, i) =>
                  renderUnit(i, true)
                )}
              </div>
            </div>
          ) : (
            <div className="px-3 py-1.5 max-w-5xl mx-auto">
              <p dir={isAr ? 'rtl' : 'ltr'} className="text-center text-[13px] font-extrabold tracking-wide leading-snug line-clamp-2">
                {text}
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
