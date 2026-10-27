import React, { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { MenuData } from '@/src/types/menu';
import { isOpenNow, buildMapUrl } from '@/src/utils/menuHelpers';
import type { OrderingStatus } from '@/src/utils/status';
import { useHeaderIntroEngine } from '@/src/hooks/useHeaderIntroEngine';
import { useHeaderMotion } from '@/src/hooks/useHeaderMotion';
import { HeaderTopBar } from '@/src/components/header/HeaderTopBar';
import { HeaderBrandBlock } from '@/src/components/header/HeaderBrandBlock';
import { HeaderActions } from '@/src/components/header/HeaderActions';

interface HeaderProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  onToggleLang: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenAdmin?: () => void;
  orderingState?: OrderingStatus | null;
}

export const Header: React.FC<HeaderProps> = ({
  menu,
  lang,
  onToggleLang,
  darkMode,
  onToggleDarkMode,
  onOpenAdmin,
  orderingState,
}) => {
  const { parY, glowY, intro, rise } = useHeaderMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smokeCanvasRef = useRef<HTMLCanvasElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [hasEnded, setHasEnded] = useState(false);
  // True once the intro engine has fully stopped: canvases are unmounted so
  // they cost zero compositing / main-thread time during scroll.
  const [engineDone, setEngineDone] = useState(false);

  const status = isOpenNow(menu.settings);

  useHeaderIntroEngine(videoRef, canvasRef, smokeCanvasRef, headerRef, setHasEnded, setEngineDone);

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
      <HeaderTopBar
        lang={lang}
        onToggleLang={onToggleLang}
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
        onOpenAdmin={onOpenAdmin}
        rise={rise}
      />

      {/* Center Brand Identity */}
      <HeaderBrandBlock
        menu={menu}
        lang={lang}
        parY={parY}
        rise={rise}
        intro={intro}
        status={status}
        orderingState={orderingState}
        videoRef={videoRef}
        canvasRef={canvasRef}
        smokeCanvasRef={smokeCanvasRef}
        hasEnded={hasEnded}
        engineDone={engineDone}
        handleVideoEnded={handleVideoEnded}
      />

      {/* Actions: WhatsApp is the primary call to action, Call and Map are secondary */}
      <HeaderActions
        phoneLink={phoneLink}
        whatsappLink={whatsappLink}
        mapLink={mapLink}
        lang={lang}
        rise={rise}
        intro={intro}
      />
    </header>
  );
};
