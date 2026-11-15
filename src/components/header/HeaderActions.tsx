import React from 'react';
import { MapPin, MessageCircle, Phone } from 'lucide-react';
import { motion } from 'motion/react';
import type { useHeaderMotion } from '@/src/hooks/useHeaderMotion';
import { useMagnetic } from '@/src/components/motion';

interface HeaderActionsProps {
  phoneLink: string;
  whatsappLink: string;
  mapLink: string;
  lang: 'en' | 'ar';
  rise: ReturnType<typeof useHeaderMotion>['rise'];
  intro: number;
  /** Menu-only mode (starter): WhatsApp CTA hidden, Call becomes primary. */
  orderingEnabled?: boolean;
}

export const HeaderActions: React.FC<HeaderActionsProps> = ({
  phoneLink,
  whatsappLink,
  mapLink,
  lang,
  rise,
  intro,
  orderingEnabled = true,
}) => {
  const isAr = lang === 'ar';
  const callRef = useMagnetic<HTMLAnchorElement>(0.1, 4);
  const whatsappRef = useMagnetic<HTMLAnchorElement>(0.16, 6);
  const mapRef = useMagnetic<HTMLAnchorElement>(0.1, 4);

  return (
    <div className="relative z-10 flex flex-col min-[360px]:flex-row justify-center gap-2.5 sm:gap-3.5 mt-7 w-full max-w-sm sm:max-w-md mx-auto">
      <motion.a
        {...rise(intro + 0.35)}
        ref={callRef}
        href={phoneLink}
        className={`btn-tactile fx-magnetic w-full min-[360px]:w-auto min-[360px]:flex-1 h-12 rounded-full flex items-center justify-center gap-1.5 text-sm ${
          orderingEnabled
            ? 'btn-glass font-bold'
            : 'btn-primary-shine font-extrabold min-[360px]:flex-[1.35]'
        }`}
      >
        <Phone size={17} className="stroke-[2.2]" />
        <span>{isAr ? 'اتصال' : 'Call'}</span>
      </motion.a>

      {orderingEnabled && (
      <motion.a
        {...rise(intro + 0.45)}
        ref={whatsappRef}
        href={whatsappLink}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-tactile fx-magnetic btn-primary-shine w-full min-[360px]:w-auto min-[360px]:flex-[1.35] h-12 rounded-full flex items-center justify-center gap-1.5 text-sm font-extrabold"
      >
        <MessageCircle size={17} className="stroke-[2.4]" />
        <span>{isAr ? 'واتساب' : 'WhatsApp'}</span>
      </motion.a>
      )}

      <motion.a
        {...rise(intro + 0.55)}
        ref={mapRef}
        href={mapLink}
        target="_blank"
        rel="noopener noreferrer"
        className="btn-tactile fx-magnetic btn-glass w-full min-[360px]:w-auto min-[360px]:flex-1 h-12 rounded-full flex items-center justify-center gap-1.5 text-sm font-bold"
      >
        <MapPin size={17} className="stroke-[2.2]" />
        <span>{isAr ? 'الموقع' : 'Map'}</span>
      </motion.a>
    </div>
  );
};
