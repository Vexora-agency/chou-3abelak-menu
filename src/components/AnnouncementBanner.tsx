import React, { useEffect, useState } from 'react';
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
  const [, setTick] = useState(0);

  // Re-evaluate every 60 s so the strip disappears by itself at expiry.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  const { status, text } = announcementStatus(settings.announcement, lang, serverNow());
  const show = status === 'visible';
  // NOTE: the banner used to hide on scroll-down via a height animation.
  // Collapsing a sticky bar changes the document height, which moves the
  // scroll position, which re-triggered the listener — a show/hide feedback
  // loop (visible flicker). Hiding now uses transform + opacity ONLY: the
  // layout slot never changes, so the scroll position can't feed back into
  // the listener. The bar slides up and fades when scrolling down past the
  // hero, and glides back on any upward scroll or near the top.
  const [scrollHidden, setScrollHidden] = useState(false);
  useEffect(() => {
    if (!show) return;
    let lastY = window.scrollY;
    let ticking = false;
    // Change-guarded: the dead-zone ([-4, 4]) is preserved exactly — React
    // bails out on identical values, but skipping the setState call avoids
    // scheduling a render at all on every scroll frame.
    let hidden = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const dy = y - lastY;
        lastY = y;
        if (y > 140 && dy > 4) {
          if (!hidden) {
            hidden = true;
            setScrollHidden(true);
          }
        } else if (dy < -4 || y <= 140) {
          if (hidden) {
            hidden = false;
            setScrollHidden(false);
          }
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [show]);
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
      <span dir={isAr ? 'rtl' : 'ltr'} className={`text-[13px] font-extrabold whitespace-nowrap ${isAr ? 'leading-relaxed' : 'tracking-wide leading-snug'}`}>
        {text}
      </span>
      <span aria-hidden="true" className="mx-6 text-[10px] opacity-50 select-none">
        ✦
      </span>
    </span>
  );

  return (
    show ? (
      <div
        role="region"
        aria-label={label}
        className={`ann-enter overflow-hidden bg-[var(--primary)] text-[#0A0A0A] sticky top-0 z-50 shadow-[0_1px_0_rgba(0,0,0,0.12)] pt-[env(safe-area-inset-top)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          scrollHidden ? '-translate-y-[110%] opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
        }`}
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
                style={{
                  ['--ann-duration' as string]: `${Math.max(3, duration)}s`,
                  animationName: ready ? 'annMarquee' : 'none',
                  // The strip slides off-screen after 140px of scroll-down.
                  // Pause its infinite compositor loop there instead of keeping
                  // a hidden marquee running through the whole menu scroll.
                  animationPlayState: scrollHidden ? 'paused' : undefined,
                  willChange: scrollHidden ? 'auto' : undefined,
                }}
              >
                {Array.from({ length: half * 2 }, (_, i) =>
                  renderUnit(i, true)
                )}
              </div>
            </div>
          ) : (
            <div className="px-3 py-1.5 max-w-5xl mx-auto">
              <p dir={isAr ? 'rtl' : 'ltr'} className={`text-center text-[13px] font-extrabold line-clamp-2 ${isAr ? 'leading-relaxed' : 'tracking-wide leading-snug'}`}>
                {text}
              </p>
            </div>
          )}
      </div>
    ) : null
  );
};
