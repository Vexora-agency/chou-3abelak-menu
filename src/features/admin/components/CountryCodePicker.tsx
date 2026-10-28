import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { DIAL_CODES, OTHER_ISO, filterDialCodes, flagEmoji } from '@/src/config/dialCodes';

interface CountryCodePickerProps {
  /** ISO from splitDialCode, or OTHER_ISO. */
  value: string;
  onChange: (iso: string) => void;
  lang: 'en' | 'ar';
}

// Google-style country picker: collapsed trigger (flag + calling code),
// expanding to a searchable list (flag + name + code, no ISO letters).
// Typing matches English name, Arabic alias, or dial digits.
export const CountryCodePicker: React.FC<CountryCodePickerProps> = ({ value, onChange, lang }) => {
  const isAr = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = DIAL_CODES.find((c) => c.iso === value);
  const rows = useMemo(() => filterDialCodes(query), [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open ]);

  // Filtered countries + the Other bucket at the end.
  const total = rows.length + 1;
  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active < rows.length ? rows[active].iso : OTHER_ISO);
    }
  };

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={isAr ? 'رمز الدولة' : 'Country code'}
        title={selected ? `${selected.name} +${selected.code}` : isAr ? 'دولة أخرى' : 'Other'}
        className="h-10 max-w-[132px] ps-2.5 pe-7 rounded-lg bg-black border border-neutral-700 text-sm focus:border-[var(--primary)] flex items-center gap-1.5 cursor-pointer"
      >
        <span aria-hidden="true" className="text-base leading-none">
          {selected ? flagEmoji(selected.iso) : '🌐'}
        </span>
        <span className="tabular-nums text-neutral-100">
          {selected ? `+${selected.code}` : '···'}
        </span>
        <ChevronDown size={14} className="absolute end-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 start-0 w-64 max-h-72 flex flex-col rounded-xl bg-[#141414] border border-neutral-700 shadow-2xl overflow-hidden anim-pop-in">
          <div className="flex items-center gap-2 px-3 border-b border-neutral-800">
            <Search size={14} className="text-neutral-500 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onListKey}
              placeholder={isAr ? 'ابحث بدولة أو رمز...' : 'Search name or code...'}
              aria-label={isAr ? 'ابحث عن دولة' : 'Search countries'}
              className="w-full h-10 bg-transparent text-sm text-white placeholder-neutral-500 focus:outline-none"
            />
          </div>
          <div role="listbox" aria-label={isAr ? 'الدول' : 'Countries'} className="overflow-y-auto py-1">
            {rows.map((c, i) => {
              const isSel = c.iso === value;
              return (
                <button
                  key={c.iso}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => pick(c.iso)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full flex items-center gap-2.5 px-3 h-10 text-sm text-start transition-colors ${
                    i === active ? 'bg-white/10' : ''
                  } ${isSel ? 'text-[var(--primary)] font-bold' : 'text-neutral-200'}`}
                >
                  <span aria-hidden="true" className="text-base leading-none w-6 text-center">
                    {flagEmoji(c.iso)}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="tabular-nums text-neutral-500 text-xs">+{c.code}</span>
                  {isSel && <Check size={14} className="shrink-0" />}
                </button>
              );
            })}
            <button
              type="button"
              role="option"
              aria-selected={value === OTHER_ISO}
              onClick={() => pick(OTHER_ISO)}
              onMouseEnter={() => setActive(rows.length)}
              className={`w-full flex items-center gap-2.5 px-3 h-10 text-sm text-start transition-colors ${
                active === rows.length ? 'bg-white/10' : ''
              } ${value === OTHER_ISO ? 'text-[var(--primary)] font-bold' : 'text-neutral-200'}`}
            >
              <span aria-hidden="true" className="text-base leading-none w-6 text-center">🌐</span>
              <span className="flex-1 truncate">{isAr ? 'دولة أخرى (رقم دولي كامل)' : 'Other (full international)'}</span>
              {value === OTHER_ISO && <Check size={14} className="shrink-0" />}
            </button>
            {rows.length === 0 && (
              <p className="px-3 py-4 text-xs text-neutral-500 text-center">
                {isAr ? 'لا نتائج — جرّب اسماً أو رمزاً آخر.' : 'No matches — try another name or code.'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
