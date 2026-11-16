import React from 'react';
import type { RefObject } from 'react';
import type { MenuData } from '@/src/types/menu';
import { pickLangText } from '@/src/utils/menuHelpers';
import { taglineOrDefault } from '@/src/utils/settingsDefaults';
import type { OrderingStatus } from '@/src/utils/status';
import type { useHeaderMotion } from '@/src/hooks/useHeaderMotion';
import { XmasLogoHat, XmasLogoMelt } from '@/src/features/seasonal/XmasHeader';

interface HeaderBrandBlockProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  brandY: ReturnType<typeof useHeaderMotion>['brandY'];
  intro: number;
  status: { isOpen: boolean; label: { en: string; ar: string } };
  orderingState?: OrderingStatus | null;
  introStageRef: RefObject<HTMLDivElement | null>;
  introCanvasRef: RefObject<HTMLCanvasElement | null>;
  introSmokeRef: RefObject<HTMLCanvasElement | null>;
  hasEnded: boolean;
  engineDone: boolean;
  /** Christmas theme: perches a small Santa hat on the logo corner. */
  festive?: boolean;
}

export const HeaderBrandBlock: React.FC<HeaderBrandBlockProps> = ({
  menu,
  lang,
  brandY,
  intro,
  status,
  orderingState,
  introStageRef,
  introCanvasRef,
  introSmokeRef,
  hasEnded,
  engineDone,
  festive = false,
}) => {
  const isAr = lang === 'ar';

  return (
    <div
      ref={brandY}
      className="relative text-center mt-3 sm:mt-5 flex flex-col items-center max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full"
    >
      {/* Logo Container with Transparent Video & Atmospheric Sizzle Smoke */}
      <div
        className="relative w-full max-w-[320px] sm:max-w-[380px] md:max-w-[440px] aspect-[1440/532] mx-auto"
        style={{ backgroundColor: 'transparent' }}
      >
        {/* Santa hat (finale reveal once the intro ends) + melting snow */}
        {festive && hasEnded ? <XmasLogoHat /> : null}
        {festive ? <XmasLogoMelt /> : null}

        {/* Final 100% Transparent PNG shown once animation completes (1440x532 HD) */}
        {/* WebP srcset (same artwork, ~80% smaller): 480w covers DPR 1,
            880w DPR 2, 1440w DPR 3. src is the smallest WebP (not PNG) so
            legacy / no-srcset clients download ~42 KiB less.
            sizes mirrors the container (px-5/sm:px-8/md:px-12 accounted):
            mobile is min(100vw-40px, 320px) -> split at 360px where
            100vw-40px hits 320px; sm/md are always capped.
            fetchpriority=high + loading=eager: this is the LCP image. */}
        <img
          src="/assets/logo-final-480.webp"
          srcSet="/assets/logo-final-480.webp 480w, /assets/logo-final-640.webp 640w, /assets/logo-final-880.webp 880w, /assets/logo-final-1440.webp 1440w"
          sizes="(max-width: 360px) calc(100vw - 40px), (max-width: 640px) 320px, (max-width: 768px) 380px, 440px"
          fetchPriority="high"
          loading="eager"
          alt={pickLangText(menu.settings.name, lang)}
          className={`absolute inset-0 w-full h-full object-contain pointer-events-none ${
            hasEnded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ backgroundColor: 'transparent' }}
          width={1440}
          height={532}
          decoding="async"
        />

        {/* The old deployment's intro effect, rebuilt off the main thread:
            alpha-keyed logo frames (24 fps) + the gold/gray steam & ember
            particles (60 fps). The worker owns both canvases; the smoke canvas
            is screen-blended so the gold sparks add light over the header. */}
        <div
          ref={introStageRef}
          className={`intro-stage absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-700 ${
            hasEnded ? 'opacity-0' : 'opacity-100'
          } ${engineDone ? 'hidden' : ''}`}
          aria-hidden="true"
        >
          <canvas
            ref={introCanvasRef}
            width={720}
            height={266}
            aria-hidden="true"
            className="intro-sheet absolute inset-0 w-full h-full"
            style={{
              backgroundColor: 'transparent',
              backgroundImage: 'url("/assets/intro-poster.webp")',
              backgroundRepeat: 'no-repeat',
              backgroundSize: '400% 900%',
            }}
          />
          <canvas
            ref={introSmokeRef}
            width={720}
            height={266}
            aria-hidden="true"
            className="intro-smoke absolute inset-0 w-full h-full pointer-events-none"
            style={{ backgroundColor: 'transparent', mixBlendMode: 'screen' }}
          />
        </div>

      </div>

      {/* Visually Hidden Semantic H1 for SEO / Screen Readers */}
      <h1 className="sr-only">{pickLangText(menu.settings.name, lang)}</h1>

      {/* Tagline flanked by hairlines */}
      <div
        className="rise-in mt-2 flex items-center justify-center gap-3"
        style={{ '--rise-delay': `${intro}s` } as React.CSSProperties}
      >
        <span className="h-px w-8 sm:w-12 bg-gradient-to-r from-transparent to-[var(--primary)]/70" aria-hidden="true" />
        <p
          className={`font-semibold text-[var(--primary)] ${
            isAr ? 'text-[14px] sm:text-[15px] tracking-normal' : 'text-[12px] sm:text-[13px] tracking-[3px] uppercase'
          }`}
        >
          {taglineOrDefault(menu.settings.tagline, lang)}
        </p>
        <span className="h-px w-8 sm:w-12 bg-gradient-to-l from-transparent to-[var(--primary)]/70" aria-hidden="true" />
      </div>

      {/* Live Operational Status Pill */}
      <div
        className="rise-in glass-pill inline-flex items-center gap-2.5 mt-4 rounded-full py-1.5 px-4 text-xs font-medium text-white"
        style={{ '--rise-delay': `${intro + 0.2}s` } as React.CSSProperties}
      >
        {(() => {
          // Every state gets its own truthful face: a disabled store must
          // never wear the green "open" pill, and a closed one shows the
          // server's own message (with reopen time) instead of a guess.
          const live = orderingState && typeof orderingState.state === 'string' ? orderingState.state : null;
          const srvMsg = orderingState && orderingState.message && typeof orderingState.message === 'object'
            ? (orderingState.message[lang] || orderingState.message.en || '')
            : '';
          if (live === 'paused') {
            return (
              <>
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" />
                </span>
                <span>{isAr ? 'الطلبات متوقفة مؤقتًا' : 'Orders paused'}</span>
              </>
            );
          }
          if (live === 'disabled') {
            return (
              <>
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span>{srvMsg || (isAr ? 'الطلب غير متاح حاليًا' : 'Ordering unavailable')}</span>
              </>
            );
          }
          if (live === 'closed') {
            return (
              <>
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span>{srvMsg || (isAr ? status.label.ar : status.label.en)}</span>
              </>
            );
          }
          return (
            <>
              <span className="relative flex h-2 w-2" aria-hidden="true">
                {status.isOpen && (
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--primary)] opacity-70 animate-ping" />
                )}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${status.isOpen ? 'bg-[var(--primary)]' : 'bg-red-500'}`} />
              </span>
              <span>{isAr ? status.label.ar : status.label.en}</span>
            </>
          );
        })()}
      </div>
    </div>
  );
};
