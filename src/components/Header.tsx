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

interface SmokeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  decay: number;
  wobbleSpeed: number;
  wobbleAmount: number;
  seed: number;
}

interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  decay: number;
  color: string;
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
  const smokeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hasEnded, setHasEnded] = useState(false);

  const status = isOpenNow(menu.settings);

  // Real-time High-Definition Canvas Alpha Extraction + Cinematic Steam & Ember Engine
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const smokeCanvas = smokeCanvasRef.current;
    if (!video || !canvas || !smokeCanvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const sCtx = smokeCanvas.getContext('2d');
    if (!ctx || !sCtx) return;

    // Enable high-definition image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';

    let animId: number;
    let isRunning = true;

    // Particle pools
    const smokeParticles: SmokeParticle[] = [];
    const sparkParticles: SparkParticle[] = [];

    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;

    let tick = 0;

    const renderLoop = () => {
      if (!isRunning) return;
      tick++;

      const w = canvas.width;
      const h = canvas.height;

      // 1. Process Video Frame with Crisp Subpixel Alpha Keying & Edge Luminosity Restoration
      if (video.readyState >= 2 && !video.paused && !video.ended) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(video, 0, 0, w, h);

        try {
          const frame = ctx.getImageData(0, 0, w, h);
          const data = frame.data;
          const len = data.length;

          for (let i = 0; i < len; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const max = r > g ? (r > b ? r : b) : (g > b ? g : b);

            if (max <= 12) {
              // Complete transparent zero floor (cleans video compression black artifacts)
              data[i + 3] = 0;
            } else if (max < 52) {
              // Smooth cubic Hermite anti-aliasing curve: eliminates jagged pixels
              const t = (max - 12) / 40;
              const smooth = t * t * (3 - 2 * t);
              data[i + 3] = (smooth * 255) | 0;

              // De-darken boundary pixels so edges stay vibrant & razor-sharp rather than dark/blurry
              const factor = Math.min(2.4, 1 / (smooth * 0.75 + 0.25));
              data[i] = Math.min(255, (r * factor) | 0);
              data[i + 1] = Math.min(255, (g * factor) | 0);
              data[i + 2] = Math.min(255, (b * factor) | 0);
            } else {
              // Fully solid letter stroke
              data[i + 3] = 255;
              // Clean pure luminous whites
              if (r > 200 && g > 200 && b > 200) {
                data[i] = 255;
                data[i + 1] = 255;
                data[i + 2] = 255;
              }
            }
          }
          ctx.putImageData(frame, 0, 0);
        } catch {
          // Fallback if cross-origin restricts
        }

        // 2. Spawn Dynamic Gourmet Smoke & Sizzle Sparks in 1440x532 coordinate space
        const curTime = video.currentTime;
        if (curTime > 0.3 && curTime < 4.8) {
          // Coordinate tracking scaled to 1440x532
          let spawnXMin = 200;
          let spawnXMax = 480;
          let spawnY = 280;

          if (curTime < 1.6) {
            // Pan handle drawing on left
            spawnXMin = 180;
            spawnXMax = 460;
            spawnY = 270;
          } else if (curTime < 3.4) {
            // "CHOU" and lower numbers forming
            spawnXMin = 420;
            spawnXMax = 960;
            spawnY = 280;
          } else {
            // Full letters & Arabic "شو" top-right accent
            spawnXMin = 520;
            spawnXMax = 1240;
            spawnY = 240;
          }

          // Spawn smoke puff every 2-3 frames
          if (tick % 3 === 0 && smokeParticles.length < 35) {
            smokeParticles.push({
              x: spawnXMin + Math.random() * (spawnXMax - spawnXMin),
              y: spawnY + (Math.random() * 40 - 20),
              vx: (Math.random() - 0.5) * 0.9,
              vy: -1.4 - Math.random() * 1.8, // rising up
              radius: 20 + Math.random() * 18,
              maxRadius: 75 + Math.random() * 40,
              alpha: 0.24 + Math.random() * 0.12,
              decay: 0.0035 + Math.random() * 0.003,
              wobbleSpeed: 0.03 + Math.random() * 0.03,
              wobbleAmount: 1.2 + Math.random() * 1.5,
              seed: Math.random() * 100,
            });
          }

          // Spawn sizzle spark ember every 4-5 frames
          if (tick % 4 === 0 && sparkParticles.length < 25) {
            sparkParticles.push({
              x: spawnXMin + Math.random() * (spawnXMax - spawnXMin),
              y: spawnY + (Math.random() * 30 - 15),
              vx: (Math.random() - 0.5) * 2.2,
              vy: -2.2 - Math.random() * 2.6,
              size: 2 + Math.random() * 3.2,
              alpha: 0.85 + Math.random() * 0.15,
              decay: 0.015 + Math.random() * 0.015,
              color: Math.random() > 0.3 ? '#FFC400' : '#FFFFFF',
            });
          }
        }
      }

      // 3. Render Smoke & Embers on the overlay canvas
      sCtx.clearRect(0, 0, w, h);

      // Render smoke particles with soft radial dissipation
      for (let i = smokeParticles.length - 1; i >= 0; i--) {
        const p = smokeParticles[i];
        p.x += p.vx + Math.sin(tick * p.wobbleSpeed + p.seed) * p.wobbleAmount * 0.5;
        p.y += p.vy;
        p.radius += (p.maxRadius - p.radius) * 0.03;
        p.alpha -= p.decay;

        if (p.alpha <= 0.01 || p.y < -80) {
          smokeParticles.splice(i, 1);
          continue;
        }

        // Soft steam / smoke radial gradient
        const grad = sCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
        grad.addColorStop(0, `rgba(255, 235, 190, ${p.alpha * 0.55})`);
        grad.addColorStop(0.35, `rgba(220, 220, 220, ${p.alpha * 0.32})`);
        grad.addColorStop(0.75, `rgba(180, 180, 180, ${p.alpha * 0.1})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        sCtx.fillStyle = grad;
        sCtx.beginPath();
        sCtx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        sCtx.fill();
      }

      // Render spark embers
      for (let i = sparkParticles.length - 1; i >= 0; i--) {
        const sp = sparkParticles[i];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.alpha -= sp.decay;

        if (sp.alpha <= 0.02 || sp.y < -30) {
          sparkParticles.splice(i, 1);
          continue;
        }

        sCtx.save();
        sCtx.globalAlpha = sp.alpha;
        sCtx.fillStyle = sp.color;
        sCtx.shadowColor = sp.color;
        sCtx.shadowBlur = 10;
        sCtx.beginPath();
        sCtx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        sCtx.fill();
        sCtx.restore();
      }

      animId = requestAnimationFrame(renderLoop);
    };

    const startPlayback = () => {
      video.defaultMuted = true;
      video.muted = true;
      const promise = video.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            animId = requestAnimationFrame(renderLoop);
          })
          .catch(() => {
            const resumeOnInteraction = () => {
              video.defaultMuted = true;
              video.muted = true;
              video.play().then(() => {
                animId = requestAnimationFrame(renderLoop);
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
        {/* Logo Container with Transparent Video & Atmospheric Sizzle Smoke */}
        <div
          className="relative w-full max-w-[320px] sm:max-w-[380px] md:max-w-[440px] aspect-[1440/532] mx-auto overflow-hidden rounded-xl"
          style={{ isolation: 'isolate', backgroundColor: 'transparent' }}
        >
          {/* Final 100% Transparent PNG shown once animation completes (1440x532 HD) */}
          <img
            src="/assets/logo-final.png"
            alt={isAr ? menu.settings.name.ar : menu.settings.name.en}
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 pointer-events-none ${
              hasEnded ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              backgroundColor: 'transparent',
              imageRendering: '-webkit-optimize-contrast',
            }}
            width={1440}
            height={532}
          />

          {/* Real-time Alpha-Keyed Video Canvas (1440x532 HD Buffer) */}
          <canvas
            ref={canvasRef}
            width={1440}
            height={532}
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 pointer-events-none ${
              hasEnded ? 'opacity-0' : 'opacity-100'
            }`}
            style={{
              backgroundColor: 'transparent',
              imageRendering: '-webkit-optimize-contrast',
            }}
          />

          {/* Cinematic Gourmet Smoke & Sizzle Sparks Overlay Canvas (1440x532 HD Buffer) */}
          <canvas
            ref={smokeCanvasRef}
            width={1440}
            height={532}
            className={`absolute inset-0 w-full h-full object-contain pointer-events-none transition-opacity duration-1000 ${
              hasEnded ? 'opacity-0' : 'opacity-100'
            }`}
            style={{
              backgroundColor: 'transparent',
              mixBlendMode: 'screen',
              imageRendering: '-webkit-optimize-contrast',
            }}
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
