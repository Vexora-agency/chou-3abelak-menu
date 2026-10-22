import React, { useRef, useState, useEffect } from 'react';
import { Phone, MessageCircle, MapPin, Moon, Sun, Settings } from 'lucide-react';
import { MenuData } from '../types/menu';
import { isOpenNow, sanitizeUrl } from '../utils/menuHelpers';

interface HeaderProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  onToggleLang: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAdmin: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  menu,
  lang,
  onToggleLang,
  darkMode,
  onToggleDarkMode,
  onOpenAdmin,
  searchQuery,
  onSearchChange,
}) => {
  const isAr = lang === 'ar';
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasEnded, setHasEnded] = useState(false);

  const status = isOpenNow(menu.settings);

  // Real-time Canvas Alpha Extraction (removes 100% of black background from video)
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let animId: number;
    let isRunning = true;

    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;

    const renderTransparentFrame = () => {
      if (!isRunning) return;

      if (video.readyState >= 2 && !video.paused && !video.ended) {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(video, 0, 0, w, h);

        try {
          const frame = ctx.getImageData(0, 0, w, h);
          const data = frame.data;
          const len = data.length;

          // Process alpha channel: key out black/dark pixels completely
          for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const max = r > g ? (r > b ? r : b) : (g > b ? g : b);

            if (max < 30) {
              // Pure or near-black becomes completely transparent
              data[i + 3] = 0;
            } else if (max < 70) {
              // Smooth edge feathering
              data[i + 3] = Math.round(((max - 30) / 40) * 255);
            }
          }

          ctx.putImageData(frame, 0, 0);
        } catch {
          // Fallback if cross-origin restricts getImageData
        }
      }

      animId = requestAnimationFrame(renderTransparentFrame);
    };

    const startPlayback = () => {
      video.defaultMuted = true;
      video.muted = true;
      const promise = video.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            animId = requestAnimationFrame(renderTransparentFrame);
          })
          .catch(() => {
            const resumeOnInteraction = () => {
              video.defaultMuted = true;
              video.muted = true;
              video.play().then(() => {
                animId = requestAnimationFrame(renderTransparentFrame);
              }).catch(() => {});
              window.removeEventListener('click', resumeOnInteraction);
              window.removeEventListener('touchstart', resumeOnInteraction);
              window.removeEventListener('scroll', resumeOnInteraction);
            };
            window.addEventListener('click', resumeOnInteraction, { once: true });
            window.addEventListener('touchstart', resumeOnInteraction, { once: true });
            window.addEventListener('scroll', resumeOnInteraction, { once: true });
          });
      }
    };

    if (video.readyState >= 2) {
      startPlayback();
    } else {
      video.addEventListener('canplay', startPlayback, { once: true });
    }

    // Switch smoothly to the transparent PNG right at completion
    const handleTimeUpdate = () => {
      if (video.duration && video.currentTime >= video.duration - 0.25) {
        setHasEnded(true);
      }
    };
    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      isRunning = false;
      cancelAnimationFrame(animId);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, []);

  const handleVideoEnded = () => {
    setHasEnded(true);
    const video = videoRef.current;
    if (video) {
      video.pause();
    }
  };

  const phoneLink = `tel:${menu.settings.phone || '+201000000000'}`;
  const whatsappNum = (menu.settings.whatsapp || '').replace(/[^0-9]/g, '');
  const whatsappLink = `https://wa.me/${whatsappNum || '201000000000'}`;
  const mapLink = sanitizeUrl(menu.settings.mapUrl || 'https://maps.google.com');

  return (
    <header className="relative overflow-hidden bg-[#0A0A0A] text-[#FFFFFF] rounded-b-[28px] md:rounded-b-[36px] border-b-[5px] border-[#FFC400] pt-4 sm:pt-6 px-5 sm:px-8 md:px-12 pb-7 sm:pb-9 shadow-2xl">
      {/* Decorative ambient breathing ring */}
      <div
        className="absolute -right-16 -top-16 sm:-right-10 sm:-top-10 w-52 sm:w-64 md:w-80 h-52 sm:h-64 md:h-80 rounded-full border-[28px] sm:border-[36px] border-[#FFC400] opacity-15 anim-breathe pointer-events-none"
        aria-hidden="true"
      />

      {/* Decorative ambient hatch pattern */}
      <div
        className="absolute -left-3 bottom-16 sm:bottom-20 w-32 sm:w-44 h-24 sm:h-32 opacity-15 anim-glow pointer-events-none"
        style={{
          background: 'repeating-linear-gradient(135deg, #FFC400 0, #FFC400 2px, transparent 2px, transparent 12px)'
        }}
        aria-hidden="true"
      />

      {/* Top Utility Row */}
      <div className="relative flex justify-between items-center z-10 max-w-5xl mx-auto w-full">
        {/* Language Switcher Pill */}
        <div className="flex bg-[#1C1C1C] rounded-full p-1 border border-white/10 shadow-inner">
          <button
            type="button"
            onClick={lang === 'en' ? undefined : onToggleLang}
            className={`min-w-[44px] h-9 flex items-center justify-center rounded-full text-xs font-bold transition-all ${
              lang === 'en'
                ? 'bg-[#FFC400] text-[#0A0A0A] shadow-md'
                : 'text-white/80 hover:text-white'
            }`}
            aria-label="Switch to English"
          >
            EN
          </button>
          <button
            type="button"
            onClick={lang === 'ar' ? undefined : onToggleLang}
            className={`min-w-[44px] h-9 flex items-center justify-center rounded-full text-xs font-bold transition-all ${
              lang === 'ar'
                ? 'bg-[#FFC400] text-[#0A0A0A] shadow-md'
                : 'text-white/80 hover:text-white'
            }`}
            aria-label="التبديل إلى العربية"
          >
            عربي
          </button>
        </div>

        {/* Action Controls: Theme & Admin */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="w-11 h-11 rounded-full border border-[#FFC400] bg-[#1C1C1C]/60 text-[#FFC400] flex items-center justify-center transition-transform active:scale-95 hover:bg-[#FFC400]/10"
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={darkMode ? (isAr ? 'الوضع النهاري' : 'Light Mode') : (isAr ? 'الوضع الليلي' : 'Dark Mode')}
          >
            {darkMode ? <Sun size={19} /> : <Moon size={19} />}
          </button>

          <button
            type="button"
            onClick={onOpenAdmin}
            className="w-11 h-11 rounded-full border border-white/20 bg-[#1C1C1C]/60 text-white/80 hover:text-[#FFC400] hover:border-[#FFC400] flex items-center justify-center transition-transform active:scale-95"
            aria-label="Admin Control Panel"
            title={isAr ? 'لوحة التحكم الإدارية' : 'Admin Management'}
          >
            <Settings size={19} />
          </button>
        </div>
      </div>

      {/* Center Brand Identity Container */}
      <div className="relative text-center mt-3 sm:mt-5 z-10 flex flex-col items-center max-w-5xl mx-auto w-full">
        {/* Logo Container with 100% Zero-Black Background (Canvas Alpha Keyed) */}
        <div
          className="relative w-full max-w-[320px] sm:max-w-[380px] md:max-w-[440px] aspect-[720/266] mx-auto overflow-hidden rounded-xl"
          style={{ isolation: 'isolate', backgroundColor: 'transparent' }}
        >
          {/* Final 100% Transparent PNG shown once animation finishes */}
          <img
            src="/assets/logo-final.png"
            alt={isAr ? menu.settings.name.ar : menu.settings.name.en}
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 pointer-events-none ${
              hasEnded ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ backgroundColor: 'transparent' }}
            width={720}
            height={266}
          />

          {/* Real-time Alpha-Keyed Canvas (zero black box during playback) */}
          <canvas
            ref={canvasRef}
            width={720}
            height={266}
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 pointer-events-none ${
              hasEnded ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ backgroundColor: 'transparent' }}
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
        <h1 className="sr-only">
          {isAr ? menu.settings.name.ar : menu.settings.name.en}
        </h1>

        {/* Tagline */}
        <p className="text-[13px] font-medium tracking-[3px] uppercase text-[#FFC400] mt-1.5">
          {isAr ? menu.settings.tagline.ar : menu.settings.tagline.en}
        </p>

        {/* Live Operational Status Pill */}
        <div className="inline-flex items-center gap-2 mt-3 bg-[#1C1C1C] border border-white/10 rounded-full py-1.5 px-4 text-xs font-medium text-white shadow-sm">
          <span
            className={`w-2 h-2 rounded-full ${
              status.isOpen ? 'bg-[#FFC400] anim-dot shadow-[0_0_8px_#FFC400]' : 'bg-red-500'
            }`}
            aria-hidden="true"
          />
          <span>{isAr ? status.label.ar : status.label.en}</span>
        </div>
      </div>

      {/* Action Buttons Trio: Call, WhatsApp, Map */}
      <div className="relative flex justify-center gap-2.5 sm:gap-4 mt-6 z-10 w-full max-w-sm sm:max-w-md mx-auto">
        <a
          href={phoneLink}
          className="btn-tactile flex-1 h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center gap-1.5 text-sm font-bold shadow-md hover:bg-[#ffd033]"
        >
          <Phone size={17} className="stroke-[2.2]" />
          <span>{isAr ? 'اتصال' : 'Call'}</span>
        </a>

        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-tactile flex-1 h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center gap-1.5 text-sm font-bold shadow-md hover:bg-[#ffd033]"
        >
          <MessageCircle size={17} className="stroke-[2.2]" />
          <span>{isAr ? 'واتساب' : 'WhatsApp'}</span>
        </a>

        <a
          href={mapLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-tactile flex-1 h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center gap-1.5 text-sm font-bold shadow-md hover:bg-[#ffd033]"
        >
          <MapPin size={17} className="stroke-[2.2]" />
          <span>{isAr ? 'الموقع' : 'Map'}</span>
        </a>
      </div>
    </header>
  );
};
