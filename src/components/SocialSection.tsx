import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import type { MenuSettings, SocialPlatform } from '@/src/types/menu';

type SocialValues = Pick<MenuSettings, 'social' | 'socialEnabled'>;

interface SocialSectionProps extends SocialValues {
  lang: 'en' | 'ar';
  order: SocialPlatform[];
  whatsappNumber: string;
  onMove: (key: SocialPlatform, dir: 'up' | 'down') => void;
  onUpdate: (updater: (prev: SocialValues) => SocialValues) => void;
}

const LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
};

/** Social Media card of the admin Settings tab (toggle + link per platform, reorderable). */
export const SocialSection: React.FC<SocialSectionProps> = ({
  social,
  socialEnabled,
  lang,
  order,
  whatsappNumber,
  onMove,
  onUpdate,
}) => {
  const isAr = lang === 'ar';
  const waDigits = (whatsappNumber || '').replace(/[^0-9]/g, '');
  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-4">
      <div>
        <h2 className="text-sm font-extrabold text-[var(--primary)] uppercase tracking-wider">
          {isAr ? 'التواصل الاجتماعي' : 'Social Media'}
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          {isAr ? 'شغّل المنصة وحط الرابط بتاعها — ورتّبهم بالأسهم' : 'Turn on a platform and paste its link — reorder with the arrows'}
        </p>
      </div>

      {order.map((network, idx) => {
        const on = !!socialEnabled?.[network];
        const label = LABELS[network];
        const linkHint =
          network === 'whatsapp' && !(social?.[network] || '').trim() && waDigits
            ? isAr
              ? `فارغ = يستخدم رقم الواتساب المحفوظ (wa.me/${waDigits})`
              : `Empty = uses the saved WhatsApp number (wa.me/${waDigits})`
            : null;
        return (
          <div key={network} className="rounded-xl border border-neutral-800 bg-black/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={label}
                onClick={() =>
                  onUpdate((prev) => ({
                    ...prev,
                    socialEnabled: { ...prev.socialEnabled, [network]: !prev.socialEnabled?.[network] },
                  }))
                }
                className="flex-1 flex items-center justify-between gap-3 text-start"
              >
                <span className="text-xs font-bold">{label}</span>
                <span className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-200 ${on ? 'bg-[var(--primary)]' : 'bg-neutral-700'}`}>
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                      on ? (isAr ? 'left-0.5' : 'left-5') : (isAr ? 'left-5' : 'left-0.5')
                    }`}
                  />
                </span>
              </button>
              <span className="flex items-center gap-1 flex-shrink-0" role="group" aria-label={isAr ? `ترتيب ${label}` : `Reorder ${label}`}>
                <button
                  type="button"
                  onClick={() => onMove(network, 'up')}
                  disabled={idx === 0}
                  aria-label={isAr ? `حرّك ${label} لأعلى` : `Move ${label} up`}
                  title={isAr ? 'لأعلى' : 'Move up'}
                  className="w-7 h-7 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-[var(--primary)] hover:border-[var(--primary)]/60 disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center justify-center"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(network, 'down')}
                  disabled={idx === order.length - 1}
                  aria-label={isAr ? `حرّك ${label} لأسفل` : `Move ${label} down`}
                  title={isAr ? 'لأسفل' : 'Move down'}
                  className="w-7 h-7 rounded-lg bg-neutral-800 border border-neutral-700 text-neutral-300 hover:text-[var(--primary)] hover:border-[var(--primary)]/60 disabled:opacity-30 disabled:pointer-events-none transition-colors flex items-center justify-center"
                >
                  <ArrowDown size={14} />
                </button>
              </span>
            </div>
            <div className={on ? '' : 'opacity-40 pointer-events-none'}>
              <label className="block text-xs text-neutral-400 mb-1">{label} URL (https://…)</label>
              <input
                type="text"
                dir="ltr"
                value={social?.[network] || ''}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    social: { ...prev.social, [network]: e.target.value },
                  }))
                }
                placeholder={network === 'whatsapp' ? 'https://wa.me/…' : `https://${network}.com/…`}
                className="w-full h-10 px-3 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)]"
              />
              {linkHint && (
                <p className="text-[11px] text-neutral-500 mt-1">{linkHint}</p>
              )}
              {on && !(social?.[network] || '').trim() && !linkHint && (
                <p className="text-[11px] text-amber-400/90 font-bold mt-1.5">
                  {isAr ? 'مفعّل لكن بدون رابط — لن يظهر في الموقع قبل لصق الرابط' : 'On but linkless — it will stay hidden until you paste the link'}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
