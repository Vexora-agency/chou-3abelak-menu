import React, { useState, useEffect } from 'react';
import { MenuData } from '../types/menu';
import { Clock, MapPin, Phone, ArrowUp, Instagram, Facebook, MessageCircle, Shield } from 'lucide-react';
import { sanitizeUrl, buildMapUrl, pickLangText } from '../utils/menuHelpers';

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

  const phoneLink = `tel:${menu.settings.phone || '+96170123456'}`;
  const whatsappNum = (menu.settings.whatsapp || '').replace(/[^0-9]/g, '');
  const whatsappLink = `https://wa.me/${whatsappNum || '96170123456'}`;
  const mapLink = buildMapUrl(menu.settings);
  const socialOn = menu.settings.socialEnabled || { instagram: true, facebook: true, tiktok: true };

  return (
    <footer className="relative isolate mt-12 bg-[#0A0A0A] text-white rounded-t-[32px] md:rounded-t-[44px] pt-11 px-5 sm:px-8 md:px-12 pb-8 shadow-[0_-24px_60px_-24px_rgba(0,0,0,0.6)]">
      <div className="header-grain" aria-hidden="true" />
      <div className="edge-line edge-line-t" aria-hidden="true" />
      {/* Floating Back to Top Button */}
      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="btn-tactile absolute right-5 sm:right-8 -top-6 w-12 h-12 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center shadow-lg hover:bg-[#ffd033] border-4 border-[#0A0A0A]"
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
                alt={isAr ? menu.settings.name.ar : menu.settings.name.en}
                className="w-full h-auto object-contain"
              />
            </div>
            <p className="text-xs text-neutral-400 font-medium leading-relaxed max-w-xs">
              {pickLangText(menu.settings.about, lang)}
            </p>
          </div>

          {/* Col 2: Restaurant Hours & Location */}
          <div className="space-y-3.5 text-xs text-neutral-300">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#FFC400] mb-2">
              {isAr ? 'معلومات المطعم' : 'Store Information'}
            </h3>

            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-[#1C1C1C] text-[#FFC400] flex items-center justify-center flex-shrink-0">
                <Clock size={16} />
              </span>
              <span>{isAr ? menu.settings.hoursText.ar : menu.settings.hoursText.en}</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-[#1C1C1C] text-[#FFC400] flex items-center justify-center flex-shrink-0">
                <MapPin size={16} />
              </span>
              <span>{isAr ? menu.settings.address.ar : menu.settings.address.en}</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-[#1C1C1C] text-[#FFC400] flex items-center justify-center flex-shrink-0">
                <Phone size={16} />
              </span>
              <a href={phoneLink} className="hover:text-[#FFC400] transition-colors font-medium">
                {menu.settings.phone}
              </a>
            </div>
          </div>

          {/* Col 3: Social Links & Directions CTA */}
          <div className="flex flex-col gap-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#FFC400]">
              {isAr ? 'تواصل معنا' : 'Connect with Us'}
            </h3>

            {/* Social Media Links */}
            <div className="flex gap-2.5">
              {socialOn.instagram && menu.settings.social.instagram && (
                <a
                  href={sanitizeUrl(menu.settings.social.instagram)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center hover:scale-105 transition-transform"
                  aria-label="Instagram"
                >
                  <Instagram size={18} />
                </a>
              )}

              {socialOn.facebook && menu.settings.social.facebook && (
                <a
                  href={sanitizeUrl(menu.settings.social.facebook)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center hover:scale-105 transition-transform"
                  aria-label="Facebook"
                >
                  <Facebook size={18} />
                </a>
              )}

              <a
                href={whatsappLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center hover:scale-105 transition-transform"
                aria-label="WhatsApp"
              >
                <MessageCircle size={18} />
              </a>
            </div>

            {/* Get Directions Button */}
            <a
              href={mapLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-tactile w-full h-11 rounded-full bg-[#FFC400] text-[#0A0A0A] flex items-center justify-center font-bold text-xs shadow-md hover:bg-[#ffd033]"
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
          {onOpenAdmin && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-[#FFC400] hover:border-[#FFC400] transition-colors"
            >
              <Shield size={12} />
              <span>{isAr ? 'لوحة التحكم للمطعم' : 'Admin Portal'}</span>
            </button>
          )}
        </div>
      </div>
    </footer>
  );
};
