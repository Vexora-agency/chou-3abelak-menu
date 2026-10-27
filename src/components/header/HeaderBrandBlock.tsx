import React from 'react';
import type { RefObject } from 'react';
import { motion } from 'motion/react';
import type { MenuData } from '@/src/types/menu';
import { pickLangText } from '@/src/utils/menuHelpers';
import { taglineOrDefault } from '@/src/utils/settingsDefaults';
import type { OrderingStatus } from '@/src/utils/status';
import type { useHeaderMotion } from '@/src/hooks/useHeaderMotion';

interface HeaderBrandBlockProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  parY: ReturnType<typeof useHeaderMotion>['parY'];
  rise: ReturnType<typeof useHeaderMotion>['rise'];
  intro: number;
  status: { isOpen: boolean; label: { en: string; ar: string } };
  orderingState?: OrderingStatus | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  smokeCanvasRef: RefObject<HTMLCanvasElement | null>;
  hasEnded: boolean;
  engineDone: boolean;
  handleVideoEnded: () => void;
}

export const HeaderBrandBlock: React.FC<HeaderBrandBlockProps> = ({
  menu,
  lang,
  parY,
  rise,
  intro,
  status,
  orderingState,
  videoRef,
  canvasRef,
  smokeCanvasRef,
  hasEnded,
  engineDone,
  handleVideoEnded,
}) => {
  const isAr = lang === 'ar';

  return (
    <motion.div
      style={{ y: parY }}
      className="relative z-10 text-center mt-3 sm:mt-5 flex flex-col items-center max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full"
    >
      {/* Logo Container with Transparent Video & Atmospheric Sizzle Smoke */}
      <div
        className="relative w-full max-w-[320px] sm:max-w-[380px] md:max-w-[440px] aspect-[1440/532] mx-auto overflow-hidden rounded-xl"
        style={{ isolation: 'isolate', backgroundColor: 'transparent' }}
      >
        {/* Final 100% Transparent PNG shown once animation completes (1440x532 HD) */}
        <img
          src="/assets/logo-final.png"
          alt={pickLangText(menu.settings.name, lang)}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 pointer-events-none ${
            hasEnded ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ backgroundColor: 'transparent' }}
          width={1440}
          height={532}
          decoding="async"
        />

        {/* Real-time Alpha-Keyed Video Canvas (720x266 buffer, CSS-upscaled) */}
        <canvas
          ref={canvasRef}
          width={720}
          height={266}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 pointer-events-none ${
            hasEnded ? 'opacity-0' : 'opacity-100'
          } ${engineDone ? 'hidden' : ''}`}
          style={{ backgroundColor: 'transparent' }}
        />

        {/* Smoke & Sizzle Sparks Overlay Canvas (720x266 buffer) */}
        <canvas
          ref={smokeCanvasRef}
          width={720}
          height={266}
          className={`absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-1000 ${
            hasEnded ? 'opacity-0' : 'opacity-100'
          } ${engineDone ? 'hidden' : ''}`}
          style={{ backgroundColor: 'transparent', mixBlendMode: 'screen' }}
        />

        {/* Hidden Source Video Engine */}
        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          preload="auto"
          width={720}
          height={266}
          onEnded={handleVideoEnded}
          style={{ display: 'none' }}
        >
          <source src="/assets/logo-intro.webm" type="video/webm" />
          <source src="/assets/logo-intro.mp4" type="video/mp4" />
        </video>
      </div>

      {/* Visually Hidden Semantic H1 for SEO / Screen Readers */}
      <h1 className="sr-only">{pickLangText(menu.settings.name, lang)}</h1>

      {/* Tagline flanked by hairlines */}
      <motion.div {...rise(intro)} className="mt-2 flex items-center justify-center gap-3">
        <span className="h-px w-8 sm:w-12 bg-gradient-to-r from-transparent to-[#FFC400]/70" aria-hidden="true" />
        <p
          className={`font-semibold text-[#FFC400] ${
            isAr ? 'text-[14px] sm:text-[15px] tracking-normal' : 'text-[12px] sm:text-[13px] tracking-[3px] uppercase'
          }`}
        >
          {taglineOrDefault(menu.settings.tagline, lang)}
        </p>
        <span className="h-px w-8 sm:w-12 bg-gradient-to-l from-transparent to-[#FFC400]/70" aria-hidden="true" />
      </motion.div>

      {/* Live Operational Status Pill */}
      <motion.div
        {...rise(intro + 0.2)}
        className="glass-pill inline-flex items-center gap-2.5 mt-4 rounded-full py-1.5 px-4 text-xs font-medium text-white"
      >
        {orderingState && orderingState.state === 'paused' ? (
          <>
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-400" />
            </span>
            <span>{isAr ? 'الطلبات متوقفة مؤقتاً' : 'Orders paused'}</span>
          </>
        ) : (
          <>
            <span className="relative flex h-2 w-2" aria-hidden="true">
              {status.isOpen && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-[#FFC400] opacity-70 animate-ping" />
              )}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${status.isOpen ? 'bg-[#FFC400]' : 'bg-red-500'}`} />
            </span>
            <span>{isAr ? status.label.ar : status.label.en}</span>
          </>
        )}
      </motion.div>
    </motion.div>
  );
};
