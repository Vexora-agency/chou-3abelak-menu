import React from 'react';
import type { RefObject } from 'react';
import type { MenuData } from '@/src/types/menu';
import { pickLangText } from '@/src/utils/menuHelpers';
import { taglineOrDefault } from '@/src/utils/settingsDefaults';
import type { OrderingStatus } from '@/src/utils/status';
import { XmasLogoHat, XmasLogoMelt } from '@/src/features/seasonal/XmasHeader';

interface HeaderBrandBlockProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  intro: number;
  status: { isOpen: boolean; label: { en: string; ar: string } };
  orderingState?: OrderingStatus | null;
  introStageRef: RefObject<HTMLDivElement | null>;
  introCanvasRef: RefObject<HTMLCanvasElement | null>;
  introVideoRef: RefObject<HTMLVideoElement | null>;
  hasEnded: boolean;
  engineDone: boolean;
  /** Christmas theme: perches a small Santa hat on the logo corner. */
  festive?: boolean;
}

/** Inline custom properties are not in React.CSSProperties's type. */
type IntroParticleStyle = React.CSSProperties & Record<`--${string}`, string>;

/**
 * CSS-only smoke/sparks: 12 soft puffs and 8 embers drift upward on the
 * compositor (transform/opacity only). They replace the old per-frame canvas
 * particle loop, so the 6 s intro costs zero main-thread frames.
 */
const INTRO_PUFFS: IntroParticleStyle[] = [
  { left: '15%', top: '48%', '--w': '8%', '--dx': '2%', '--dur': '4.8s', '--delay': '0.35s' },
  { left: '22%', top: '55%', '--w': '6.5%', '--dx': '-1%', '--dur': '5.2s', '--delay': '0.9s' },
  { left: '30%', top: '50%', '--w': '9%', '--dx': '3%', '--dur': '4.4s', '--delay': '1.3s' },
  { left: '38%', top: '56%', '--w': '7%', '--dx': '-2%', '--dur': '5s', '--delay': '0.5s' },
  { left: '46%', top: '48%', '--w': '8.5%', '--dx': '1%', '--dur': '4.6s', '--delay': '1.8s' },
  { left: '54%', top: '54%', '--w': '6.5%', '--dx': '2%', '--dur': '5.4s', '--delay': '1.1s' },
  { left: '62%', top: '49%', '--w': '9.5%', '--dx': '-2%', '--dur': '4.9s', '--delay': '2.2s' },
  { left: '70%', top: '55%', '--w': '7.5%', '--dx': '2%', '--dur': '5.1s', '--delay': '0.7s' },
  { left: '78%', top: '50%', '--w': '8%', '--dx': '-1%', '--dur': '4.5s', '--delay': '1.6s' },
  { left: '26%', top: '60%', '--w': '6%', '--dx': '1%', '--dur': '5.6s', '--delay': '2.6s' },
  { left: '58%', top: '60%', '--w': '7%', '--dx': '-2%', '--dur': '5s', '--delay': '3s' },
  { left: '44%', top: '58%', '--w': '7.5%', '--dx': '2%', '--dur': '4.7s', '--delay': '3.5s' },
];

const INTRO_SPARKS: IntroParticleStyle[] = [
  { left: '30%', top: '54%', '--s': '2px', '--dx': '3px', '--dur': '1.6s', '--delay': '0.6s' },
  { left: '37%', top: '50%', '--s': '2px', '--dx': '-2px', '--dur': '1.9s', '--delay': '1.2s' },
  { left: '45%', top: '56%', '--s': '3px', '--dx': '2px', '--dur': '1.4s', '--delay': '0.9s' },
  { left: '52%', top: '52%', '--s': '2px', '--dx': '-3px', '--dur': '1.8s', '--delay': '1.7s' },
  { left: '60%', top: '55%', '--s': '2px', '--dx': '2px', '--dur': '1.5s', '--delay': '2.1s' },
  { left: '67%', top: '50%', '--s': '3px', '--dx': '-1px', '--dur': '2s', '--delay': '1.4s' },
  { left: '74%', top: '56%', '--s': '2px', '--dx': '3px', '--dur': '1.7s', '--delay': '2.6s' },
  { left: '40%', top: '60%', '--s': '2px', '--dx': '-2px', '--dur': '1.6s', '--delay': '3.1s' },
];

export const HeaderBrandBlock: React.FC<HeaderBrandBlockProps> = ({
  menu,
  lang,
  intro,
  status,
  orderingState,
  introStageRef,
  introCanvasRef,
  introVideoRef,
  hasEnded,
  engineDone,
  festive = false,
}) => {
  const isAr = lang === 'ar';

  return (
    <div
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

        {/* Compositor-driven intro: a <canvas> (never an LCP candidate) carries
            an alpha-keyed 4×9 sprite sheet as a CSS background. A step-held
            background-position animation walks the 36 frames at 24 fps; zero
            JavaScript runs per frame. The sheets carry real alpha: no black
            box, no blend-mode approximation. */}
        {/* Logo film: the original 1440×532 animation, hardware-decoded by a
            visible <video> and screen-blended over the dark header (its
            background is pure black, so screen keeps every spark/smoke pixel).
            The canvas below is the alpha-sprite fallback when autoplay or the
            codec is unavailable; the static logo is the last resort. */}
        <div
          ref={introStageRef}
          data-mode="video"
          className={`intro-stage absolute inset-0 overflow-hidden pointer-events-none transition-opacity duration-700 ${
            hasEnded ? 'opacity-0' : 'opacity-100'
          } ${engineDone ? 'hidden' : ''}`}
          aria-hidden="true"
        >
          <div className="absolute inset-0" aria-hidden="true">
            {INTRO_PUFFS.map((style, i) => (
              <span key={`puff-${i}`} className="intro-puff" style={style} />
            ))}
            {INTRO_SPARKS.map((style, i) => (
              <span key={`spark-${i}`} className="intro-spark" style={style} />
            ))}
          </div>
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
          <video
            ref={introVideoRef}
            muted
            playsInline
            preload="none"
            poster="/assets/intro-poster.webp"
            width={1440}
            height={532}
            aria-hidden="true"
            tabIndex={-1}
            className="intro-video absolute inset-0 w-full h-full object-contain pointer-events-none"
            style={{
              mixBlendMode: 'screen',
              backgroundColor: 'transparent',
              // Chrome promotes <video> to a hardware overlay that ignores
              // mix-blend-mode, leaving the film's black background visible.
              // Forcing its own compositing layer keeps screen blending on the
              // GPU and removes the black rectangle (verified on mobile).
              transform: 'translateZ(0)',
              willChange: 'transform',
            }}
          >
            <source src="/assets/logo-intro.webm" type="video/webm" />
            <source src="/assets/logo-intro.mp4" type="video/mp4" />
          </video>
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
