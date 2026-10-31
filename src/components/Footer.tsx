import React, { useState, useEffect } from 'react';
import { MenuData } from '@/src/types/menu';
import { Clock, MapPin, Phone, ArrowUp, Instagram, Facebook, MessageCircle, Shield } from 'lucide-react';
import { sanitizeUrl, buildMapUrl, looksLikeMapInput } from '@/src/utils/menuHelpers';
import { aboutOrDefault, socialOrderOrDefault } from '@/src/utils/settingsDefaults';
import type { SocialPlatform } from '@/src/types/menu';

interface FooterProps {
  menu: MenuData;
  onOpenAdmin?: () => void;
  lang: 'en' | 'ar';
}

export const Footer: React.FC<FooterProps> = ({ menu, onOpenAdmin, lang }) => {
  const isAr = lang === 'ar';
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const phoneDigits = (menu.settings.phone || '').replace(/[^0-9]/g, '');
  const phoneLink = phoneDigits ? `tel:+${phoneDigits}` : 'tel:+96170123456';
  const mapLink = buildMapUrl(menu.settings);
  const socialOn = menu.settings.socialEnabled || { instagram: true, facebook: true, whatsapp: true };
  const socialOrder = socialOrderOrDefault(menu.settings.socialOrder);
  const waDigits = (menu.settings.whatsapp || '').replace(/[^0-9]/g, '');

  const platformMeta: Record<SocialPlatform, { label: string; Icon: typeof Instagram }> = {
    instagram: { label: 'Instagram', Icon: Instagram },
    facebook: { label: 'Facebook', Icon: Facebook },
    whatsapp: { label: 'WhatsApp', Icon: MessageCircle },
  };

  /** Resolved link for a platform, or null when nothing to show. */
  const socialUrl = (key: SocialPlatform): string | null => {
    if (key === 'whatsapp') {
      const custom = (menu.settings.social?.whatsapp || '').trim();
      if (custom) return sanitizeUrl(custom) === '#' ? null : sanitizeUrl(custom);
      return waDigits ? `https://wa.me/${waDigits}` : null;
    }
    const raw = (menu.settings.social?.[key] || '').trim();
    if (!raw) return null;
    const url = sanitizeUrl(raw);
    return url === '#' ? null : url;
  };

  return (
    <footer className="relative isolate mt-12 bg-[#0A0A0A] text-white rounded-t-[32px] md:rounded-t-[44px] pt-11 px-5 sm:px-8 md:px-12 pb-8 shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.6)]">
      <div className="header-grain" aria-hidden="true" />
      <div className="edge-line edge-line-t" aria-hidden="true" />
      {/* Floating Back to Top Button */}
      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="btn-tactile absolute right-5 sm:right-8 -top-6 w-12 h-12 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center shadow-lg hover:brightness-110 border-4 border-[#0A0A0A]"
          aria-label={isAr ? 'العودة لأعلى الصفحة' : 'Back to top'}
        >
          <ArrowUp size={20} className="stroke-[2.5]" />
        </button>
      )}

      <div className="relative z-10 max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto w-full">
        {/* Responsive Grid: 1-col mobile, 3-col tablet & desktop */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start mb-6">
          {/* Col 1: Brand Logo & Tagline */}
          <div>
            <div className="w-48 max-w-[80%] mb-3">
              <img
                src="/assets/logo-final.png"
                srcSet="/assets/logo-final-480.webp 480w, /assets/logo-final-880.webp 880w"
                sizes="192px"
                loading="lazy"
                width={480}
                height={177}
                alt={isAr ? menu.settings.name.ar : menu.settings.name.en}
                className="w-full h-auto object-contain"
              />
            </div>
            <p className="text-xs text-neutral-400 font-medium leading-relaxed max-w-xs">
              {aboutOrDefault(menu.settings.about, lang)}
            </p>
          </div>

          {/* Col 2: Hours & Location */}
          <div className="space-y-3.5 text-xs text-neutral-300">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--primary)] mb-2">
              {isAr ? 'معلومات المتجر' : 'Store Information'}
            </h3>

            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-[#1C1C1C] text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                <Clock size={16} />
              </span>
              <span>{isAr ? menu.settings.hoursText.ar : menu.settings.hoursText.en}</span>
            </div>

            {/* Written address (hidden when empty — the Map button below
                always carries the saved work location instead). A pasted
                link is NEVER rendered as text (the admin converts it); if
                one slipped into storage, hide it rather than show a URL. */}
            {(() => {
              const raw = isAr ? menu.settings.address?.ar : menu.settings.address?.en || '';
              const text = (raw || '').trim();
              if (!text || looksLikeMapInput(text)) return null;
              return (
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-[#1C1C1C] text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                    <MapPin size={16} />
                  </span>
                  <span>{text}</span>
                </div>
              );
            })()}

            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-[#1C1C1C] text-[var(--primary)] flex items-center justify-center flex-shrink-0">
                <Phone size={16} />
              </span>
                <a href={phoneLink} dir="ltr" className="hover:text-[var(--primary)] transition-colors font-medium">
                {menu.settings.phone}
              </a>
            </div>
          </div>

          {/* Col 3: Social Links & Directions CTA */}
          <div className="flex flex-col gap-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--primary)]">
              {isAr ? 'تواصل معنا' : 'Connect with Us'}
            </h3>

            {/* Social Media Links (admin-ordered) */}
            <div className="flex gap-2.5">
              {socialOrder.map((key) => {
                const meta = platformMeta[key];
                if (!meta || !socialOn[key]) return null;
                const url = socialUrl(key);
                if (!url) return null;
                const { label, Icon } = meta;
                return (
                  <a
                    key={key}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-10 h-10 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center hover:scale-105 transition-transform"
                    aria-label={label}
                  >
                    <Icon size={18} />
                  </a>
                );
              })}
            </div>

            {/* Get Directions Button */}
            <a
              href={mapLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-tactile w-full h-11 rounded-full bg-[var(--primary)] text-[#0A0A0A] flex items-center justify-center font-bold text-xs shadow-md hover:brightness-110"
            >
              {isAr ? 'الاتجاهات على الخريطة' : 'Get Directions'}
            </a>
          </div>
        </div>

        {/* Divider */}
        <div className="h-[1px] bg-neutral-800 my-6" />

        {/* Bottom Copyright & Admin Trigger */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-neutral-400 text-center">
          <div>
            © 2026 {isAr ? menu.settings.name.ar : menu.settings.name.en} · All Rights Reserved
          </div>
          <div className="flex items-center gap-2">
            <a
              href="privacy"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-[var(--primary)] hover:border-[var(--primary)] transition-colors"
            >
              <Shield size={12} />
              <span>{isAr ? 'الخصوصية' : 'Privacy'}</span>
            </a>
          {onOpenAdmin && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-[var(--primary)] hover:border-[var(--primary)] transition-colors"
            >
              <Shield size={12} />
              <span>{isAr ? 'لوحة التحكم' : 'Admin Portal'}</span>
            </button>
          )}
          </div>
        </div>
      </div>
    </footer>
  );
};
