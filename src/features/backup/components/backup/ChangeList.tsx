import React, { useState } from 'react';
import { ChevronDown, Minus, Pencil, Plus, ShieldAlert } from 'lucide-react';
import { STR } from './backupStrings';
import type { Change } from '../BackupPanel';

const KIND = {
  added: { icon: Plus, cls: 'bg-green-500/15 text-green-400' },
  removed: { icon: Minus, cls: 'bg-red-500/15 text-red-400' },
  changed: { icon: Pencil, cls: 'bg-[var(--primary)]/15 text-[var(--primary)]' },
} as const;

export const ChangeList: React.FC<{ changes: Change[]; lang: 'en' | 'ar' }> = ({ changes, lang }) => {
  const t = STR[lang];
  const [open, setOpen] = useState(false);
  const ordered = [...changes].sort((a, b) => Number(!!b.sensitive) - Number(!!a.sensitive)); // sensitive changes always come first
  const shown = open ? ordered : ordered.slice(0, 5);
  return (
    <div>
      <ul className="space-y-1.5">
        {shown.map((c, i) => {
          const K = KIND[c.kind];
          return (
            <li key={i} className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-[13px] ${c.sensitive ? 'border-red-400/40 bg-red-500/[0.06]' : 'border-neutral-800 bg-black/40'}`}>
              <span className={`mt-px w-6 h-6 shrink-0 rounded-lg flex items-center justify-center ${K.cls}`}><K.icon size={13} strokeWidth={2.6} /></span>
              <span className="min-w-0 flex-1">
                <span className="font-bold break-words">{c.label}</span>
                {c.sensitive && <span className="ms-2 inline-flex items-center gap-1 text-[10px] font-extrabold text-red-300"><ShieldAlert size={11} />{t.sensitive}</span>}
                {c.detail && <span className="block text-xs text-neutral-400 mt-0.5 break-words" dir="auto">{c.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {changes.length > 5 && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[var(--primary)]">
          <ChevronDown size={14} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />{open ? t.close : `+${changes.length - 5}`}
        </button>
      )}
    </div>
  );
};
