import React, { useState } from 'react';
import type { MenuSettings } from '@/src/types/menu';
import { BELL_SOUNDS, bellPatternById, type BellSoundId } from '@/src/utils/bellPatterns';
import { playNewOrderBeep, unlockOrderSound } from '@/src/features/orders';
import { playBellChime } from '@/src/utils/bellSound';
import { BellRing, Play, Store, ChefHat } from 'lucide-react';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

type SoundsValues = Pick<MenuSettings, 'sounds'>;

interface SoundsSectionProps extends SoundsValues {
  lang: 'en' | 'ar';
  onUpdate: (updater: (prev: SoundsValues) => SoundsValues) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Bell-sound picker of the admin Settings tab: one chime for the kitchen
 *  alarm (this dashboard) and one for the customer bell (menu page).
 *  Every option has its own preview button playing THAT sound through the
 *  same engine the bell uses — what you hear is what rings. */
export const SoundsSection: React.FC<SoundsSectionProps> = ({ sounds, lang, onUpdate, collapsed = false, onToggleCollapse }) => {
  const isAr = lang === 'ar';
  const [playing, setPlaying] = useState<string | null>(null);
  const cur = {
    kitchen: bellPatternById(sounds?.kitchen).id,
    customer: bellPatternById(sounds?.customer).id,
  };

  const preview = async (which: 'kitchen' | 'customer', id: BellSoundId) => {
    const key = `${which}:${id}`;
    if (playing) return;
    setPlaying(key);
    try {
      unlockOrderSound();
      if (which === 'kitchen') playNewOrderBeep(id);
      else await playBellChime(id);
    } catch {
      // Preview is best-effort only — never breaks the settings form.
    } finally {
      window.setTimeout(() => setPlaying(null), 2300);
    }
  };

  const groups: Array<{ key: 'kitchen' | 'customer'; title: string; desc: string; icon: typeof Store }> = [
    {
      key: 'kitchen',
      title: isAr ? 'جرس المطبخ (شاشتك)' : 'Kitchen bell (your screen)',
      desc: isAr ? 'يرن هنا عند كل طلب جديد لمدة 30 دقيقة' : 'Rings here on every new order for 30 minutes',
      icon: ChefHat,
    },
    {
      key: 'customer',
      title: isAr ? 'جرس العميل (صفحة القائمة)' : 'Customer bell (menu page)',
      desc: isAr ? 'يسمعه العميل عند طلبه لمدة 30 دقيقة' : 'The customer hears it for their order for 30 minutes',
      icon: Store,
    },
  ];

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'أصوات الجرس' : 'Bell sounds'}
        subtitle={isAr ? 'اختر صوتًا لكل جرس — جرّب قبل أن تختار' : 'Pick a chime per bell — preview before you choose'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
      {groups.map((g) => {
        const Icon = g.icon;
        return (
          <div key={g.key} className="rounded-xl border border-neutral-800 bg-black/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">
                <Icon size={16} />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-black text-white leading-snug">{g.title}</p>
                <p className={`text-[11px] text-neutral-500 ${isAr ? 'leading-relaxed' : 'leading-snug'}`}>{g.desc}</p>
              </div>
            </div>
            <div className="space-y-1.5" role="radiogroup" aria-label={g.title}>
              {BELL_SOUNDS.map((p) => {
                const active = cur[g.key] === p.id;
                const busy = playing === `${g.key}:${p.id}`;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors ${
                      active ? 'border-[var(--primary)]/60 bg-[var(--primary)]/[0.06]' : 'border-neutral-800 hover:border-neutral-600'
                    }`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => onUpdate((prev) => ({ sounds: { ...prev.sounds, [g.key]: p.id } }))}
                      className="flex-1 min-w-0 text-start flex items-center gap-2"
                    >
                      <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${active ? 'border-[var(--primary)]' : 'border-neutral-600'}`}>
                        {active && <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-black text-white truncate">
                          {isAr ? p.name.ar : p.name.en}
                        </span>
                        <span className="block text-[10px] text-neutral-500 truncate">
                          {isAr ? p.hint.ar : p.hint.en}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void preview(g.key, p.id)}
                      disabled={busy}
                      aria-label={`${isAr ? 'جرّب' : 'Preview'} ${isAr ? p.name.ar : p.name.en}`}
                      title={isAr ? 'جرّب الصوت' : 'Preview sound'}
                      className="btn-tactile shrink-0 w-11 h-11 min-w-[44px] min-h-[44px] rounded-full border border-[var(--primary)]/50 text-[var(--primary)] flex items-center justify-center hover:bg-[var(--primary)]/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    >
                      {busy ? <BellRing size={15} className="animate-pulse" /> : <Play size={15} className="ms-0.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </SettingsGroupBody>
    </div>
  );
};
