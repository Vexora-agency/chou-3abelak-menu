import React, { useRef, useState, useEffect } from 'react';
import { Phone, MessageCircle, MapPin, Moon, Sun, Settings } from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import { MenuData } from '../types/menu';
import { isOpenNow, buildMapUrl, pickLangText } from '../utils/menuHelpers';

interface HeaderProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  onToggleLang: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAdmin?: () => void;
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
  const { scrollY } = useScroll();
  // Gentle depth on scroll: brand block drifts down a touch, the glow drifts up
  // (always on - site owner decision).
  const parY = useTransform(scrollY, [0, 320], [0, 46]);
  const glowY = useTransform(scrollY, [0, 320], [0, -30]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smokeCanvasRef = useRef<HTMLCanvasElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [hasEnded, setHasEnded] = useState(false);
  // True once the intro engine has fully stopped: canvases are unmounted so
  // they cost zero compositing / main-thread time during scroll.
  const [engineDone, setEngineDone] = useState(false);

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

    // The intro always plays for everyone (site owner decision): no reduced-motion
    // skip here. If playback is truly blocked, the catch/stall fallbacks below
    // still show the final logo so the header never stays blank.

    // Enable high-definition image smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = 'high';

    let animId = 0;
    let isRunning = true;
    let finished = false;

    // Particle pools
    const smokeParticles: SmokeParticle[] = [];
    const sparkParticles: SparkParticle[] = [];

    video.defaultMuted = true;
    video.muted = true;
    video.playsInline = true;

    let tick = 0;

    const renderLoop = () => {
      if (!isRunning) {
        animId = 0;
        return;
      }
      // Skip all canvas work while the tab is hidden.
      if (document.hidden) {
        animId = requestAnimationFrame(renderLoop);
        return;
      }
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

        // 2. Spawn Dynamic Gourmet Smoke & Sizzle Sparks in 720x266 coordinate
        // space (buffers run at half resolution for performance; CSS upscales).
        const curTime = video.currentTime;
        if (curTime > 0.3 && curTime < 4.8) {
          // Coordinate tracking scaled to 720x266
          let spawnXMin = 100;
          let spawnXMax = 240;
          let spawnY = 140;

          if (curTime < 1.6) {
            // Pan handle drawing on left
            spawnXMin = 90;
            spawnXMax = 230;
            spawnY = 135;
          } else if (curTime < 3.4) {
            // "CHOU" and lower numbers forming
            spawnXMin = 210;
            spawnXMax = 480;
            spawnY = 140;
          } else {
            // Full letters & Arabic "شو" top-right accent
            spawnXMin = 260;
            spawnXMax = 620;
            spawnY = 120;
          }

          // Spawn smoke puff every 2-3 frames
          if (tick % 3 === 0 && smokeParticles.length < 35) {
            smokeParticles.push({
              x: spawnXMin + Math.random() * (spawnXMax - spawnXMin),
              y: spawnY + (Math.random() * 20 - 10),
              vx: (Math.random() - 0.5) * 0.45,
              vy: -0.7 - Math.random() * 0.9, // rising up
              radius: 10 + Math.random() * 9,
              maxRadius: 37 + Math.random() * 20,
              alpha: 0.24 + Math.random() * 0.12,
              decay: 0.0035 + Math.random() * 0.003,
              wobbleSpeed: 0.03 + Math.random() * 0.03,
              wobbleAmount: 0.6 + Math.random() * 0.75,
              seed: Math.random() * 100,
            });
          }

          // Spawn sizzle spark ember every 4-5 frames
          if (tick % 4 === 0 && sparkParticles.length < 25) {
            sparkParticles.push({
              x: spawnXMin + Math.random() * (spawnXMax - spawnXMin),
              y: spawnY + (Math.random() * 15 - 7),
              vx: (Math.random() - 0.5) * 1.1,
              vy: -1.1 - Math.random() * 1.3,
              size: 1 + Math.random() * 1.6,
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

        if (p.alpha <= 0.01 || p.y < -40) {
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

      // Render spark embers (two-pass plain fill glow: same look as shadowBlur
      // at a fraction of the cost - shadowBlur re-blurs the layer per spark)
      for (let i = sparkParticles.length - 1; i >= 0; i--) {
        const sp = sparkParticles[i];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.alpha -= sp.decay;

        if (sp.alpha <= 0.02 || sp.y < -15) {
          sparkParticles.splice(i, 1);
          continue;
        }

        sCtx.globalAlpha = sp.alpha * 0.35;
        sCtx.fillStyle = sp.color;
        sCtx.beginPath();
        sCtx.arc(sp.x, sp.y, sp.size * 2.2, 0, Math.PI * 2);
        sCtx.fill();
        sCtx.globalAlpha = sp.alpha;
        sCtx.beginPath();
        sCtx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        sCtx.fill();
        sCtx.globalAlpha = 1;
      }

      // The intro is over and every particle has faded: stop the loop for good
      // and unmount the canvases (they are already invisible via opacity-0).
      // This frees the main thread for scroll / hover for the rest of the visit.
      if (video.ended && smokeParticles.length === 0 && sparkParticles.length === 0) {
        finished = true;
        animId = 0;
        setEngineDone(true);
        return;
      }

      animId = requestAnimationFrame(renderLoop);
    };

    // (Re)starts the loop only if it is not already running or finished.
    const kick = () => {
      if (animId === 0 && !finished && isRunning) {
        animId = requestAnimationFrame(renderLoop);
      }
    };

    const startPlayback = () => {
      video.defaultMuted = true;
      video.muted = true;
      const promise = video.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            kick();
          })
          .catch(() => {
            // Autoplay blocked (e.g. iOS Low Power Mode): show the final logo right away
            isRunning = false;
            finished = true;
            setHasEnded(true);
            setEngineDone(true);
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

    // Safety net: if the video never starts moving, show the final logo
    const stallTimer = window.setTimeout(() => {
      if (video.currentTime === 0 && !finished) {
        isRunning = false;
        finished = true;
        setHasEnded(true);
        setEngineDone(true);
      }
    }, 3500);

    // Pause the whole engine while the header is scrolled out of view and
    // resume when it comes back: zero canvas cost during menu scrolling,
    // with visuals identical whenever the header is visible.
    const io = new IntersectionObserver(
      (entries) => {
        isRunning = entries[0]?.isIntersecting ?? true;
        headerRef.current?.setAttribute('data-paused', isRunning ? 'false' : 'true');
        if (isRunning) kick();
      },
      { threshold: 0 }
    );
    if (headerRef.current) io.observe(headerRef.current);

    return () => {
      isRunning = false;
      window.clearTimeout(stallTimer);
      io.disconnect();
      cancelAnimationFrame(animId);
      animId = 0;
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

  const phoneLink = `tel:${menu.settings.phone || '+96170123456'}`;
  const whatsappNum = (menu.settings.whatsapp || '').replace(/[^0-9]/g, '');
  const whatsappLink = `https://wa.me/${whatsappNum || '96170123456'}`;
  const mapLink = buildMapUrl(menu.settings);

  // Entrance choreography: content rises in while the logo video draws itself
  // (always on - site owner decision).
  const intro = 1.5;
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <header
      ref={headerRef}
      className="header-shell relative isolate overflow-hidden bg-[#0A0A0A] text-white rounded-b-[32px] md:rounded-b-[44px] pt-4 sm:pt-6 px-5 sm:px-8 md:px-12 pb-10 sm:pb-12 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.6)]"
    >
      {/* Warm spotlight behind the logo (replaces the old ring + hatch pattern) */}
      <motion.div style={{ y: glowY }} className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="header-spot" />
      </motion.div>
      <div className="header-grain" aria-hidden="true" />
      <div className="edge-line edge-line-b" aria-hidden="true" />

      {/* Top Utility Row */}
      <motion.div
        {...rise(0.1)}
        className="relative z-10 flex justify-between items-center max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full"
      >
        <div className="glass-pill flex p-1 rounded-full">
          {(['en', 'ar'] as const).map((code) => {
            const active = lang === code;
            return (
              <button
                key={code}
                type="button"
                onClick={active ? undefined : onToggleLang}
                className={`relative min-w-[48px] h-9 px-3 rounded-full text-xs font-bold transition-colors ${
                  active ? 'text-[#0A0A0A]' : 'text-white/75 hover:text-white'
                }`}
                aria-label={code === 'en' ? 'Switch to English' : 'التبديل إلى العربية'}
                aria-pressed={active}
              >
                {active && (
                  <motion.span
                    layoutId="lang-pill"
                    className="absolute inset-0 rounded-full bg-[#FFC400] shadow-[0_4px_14px_-2px_rgba(255,196,0,0.6)]"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10">{code === 'en' ? 'EN' : 'عربي'}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="glass-pill btn-tactile w-11 h-11 rounded-full text-[#FFC400] flex items-center justify-center"
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            title={darkMode ? (isAr ? 'الوضع النهاري' : 'Light Mode') : (isAr ? 'الوضع الليلي' : 'Dark Mode')}
          >
            <motion.span
              key={darkMode ? 'sun' : 'moon'}
              initial={{ rotate: -80, opacity: 0, scale: 0.6 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="flex"
            >
              {darkMode ? <Sun size={19} /> : <Moon size={19} />}
            </motion.span>
          </button>

          {onOpenAdmin && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="glass-pill btn-tactile w-11 h-11 rounded-full text-white/80 hover:text-[#FFC400] flex items-center justify-center"
              aria-label="Admin Control Panel"
              title={isAr ? 'لوحة التحكم الإدارية' : 'Admin Management'}
            >
              <Settings size={19} />
            </button>
          )}
        </div>
      </motion.div>

      {/* Center Brand Identity */}
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
            {pickLangText(menu.settings.tagline, lang)}
          </p>
          <span className="h-px w-8 sm:w-12 bg-gradient-to-l from-transparent to-[#FFC400]/70" aria-hidden="true" />
        </motion.div>

        {/* Live Operational Status Pill */}
        <motion.div
          {...rise(intro + 0.2)}
          className="glass-pill inline-flex items-center gap-2.5 mt-4 rounded-full py-1.5 px-4 text-xs font-medium text-white"
        >
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {status.isOpen && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#FFC400] opacity-70 animate-ping" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${status.isOpen ? 'bg-[#FFC400]' : 'bg-red-500'}`} />
          </span>
          <span>{isAr ? status.label.ar : status.label.en}</span>
        </motion.div>
      </motion.div>

      {/* Actions: WhatsApp is the primary call to action, Call and Map are secondary */}
      <div className="relative z-10 flex flex-col min-[360px]:flex-row justify-center gap-2.5 sm:gap-3.5 mt-7 w-full max-w-sm sm:max-w-md mx-auto">
        <motion.a
          {...rise(intro + 0.35)}
          href={phoneLink}
          className="btn-tactile btn-glass w-full min-[360px]:w-auto min-[360px]:flex-1 h-12 rounded-full flex items-center justify-center gap-1.5 text-sm font-bold"
        >
          <Phone size={17} className="stroke-[2.2]" />
          <span>{isAr ? 'اتصال' : 'Call'}</span>
        </motion.a>

        <motion.a
          {...rise(intro + 0.45)}
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-tactile btn-primary-shine w-full min-[360px]:w-auto min-[360px]:flex-[1.35] h-12 rounded-full flex items-center justify-center gap-1.5 text-sm font-extrabold"
        >
          <MessageCircle size={17} className="stroke-[2.4]" />
          <span>{isAr ? 'واتساب' : 'WhatsApp'}</span>
        </motion.a>

        <motion.a
          {...rise(intro + 0.55)}
          href={mapLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-tactile btn-glass w-full min-[360px]:w-auto min-[360px]:flex-1 h-12 rounded-full flex items-center justify-center gap-1.5 text-sm font-bold"
        >
          <MapPin size={17} className="stroke-[2.2]" />
          <span>{isAr ? 'الموقع' : 'Map'}</span>
        </motion.a>
      </div>
    </header>
  );
};
