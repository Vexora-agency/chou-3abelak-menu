import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Heart } from 'lucide-react';
import { useWishlist } from '../context/WishlistContext';
import { WISHLIST_STR } from '../strings';
import '../wishlist.css';

type WishlistButtonVariant = 'icon' | 'pill' | 'bare';
type WishlistButtonTone = 'overlay' | 'surface';

interface WishlistButtonProps {
  itemId: string;
  /** Dish name for a specific screen-reader label. */
  itemName: string;
  lang: 'en' | 'ar';
  darkMode: boolean;
  /** `icon` for cards/rows, `pill` for unavailable dishes, `bare` for the
      item sheet header (a heart with no surrounding chrome). */
  variant?: WishlistButtonVariant;
  /** `overlay` sits on a photo or a dark/gold card; `surface` on a page card. */
  tone?: WishlistButtonTone;
  /** `sm` keeps tight card headers balanced; `md` is the standard 44px target. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  size: number;
  delay: number;
  color: string;
}

// Eight directions, two distances: a compact celebratory burst that reads at
// 36–44px without overwhelming a food photo.
const PARTICLES: Particle[] = [
  { x: 0, y: -22, size: 5, delay: 0, color: 'var(--primary)' },
  { x: 16, y: -16, size: 3.5, delay: 0.03, color: '#FFFFFF' },
  { x: 22, y: 0, size: 4.5, delay: 0.05, color: 'var(--primary)' },
  { x: 14, y: 16, size: 3, delay: 0.02, color: '#8a6d00' },
  { x: 0, y: 22, size: 4, delay: 0.06, color: 'var(--primary)' },
  { x: -14, y: 16, size: 3.5, delay: 0.04, color: '#FFFFFF' },
  { x: -22, y: 0, size: 4.5, delay: 0.01, color: 'var(--primary)' },
  { x: -16, y: -16, size: 3, delay: 0.05, color: '#8a6d00' },
];

/**
 * Member-only wishlist heart.
 *
 * Input is optimistic in `WishlistProvider`, so the spring, gold fill and
 * particle burst start on the tap — never after the network round-trip. The
 * heart is hidden entirely for guests and in admin previews (no provider),
 * so the menu layout is unchanged for them.
 */
export const WishlistButton: React.FC<WishlistButtonProps> = ({
  itemId,
  itemName,
  lang,
  darkMode,
  variant = 'icon',
  tone = 'surface',
  size = 'md',
  className = '',
}) => {
  const t = WISHLIST_STR[lang];
  const { isMember, has, toggle } = useWishlist();
  const [burst, setBurst] = useState(0);
  const [pressKey, setPressKey] = useState(0);
  const [shake, setShake] = useState(0);
  const timerRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!isMember) return null;

  const saved = has(itemId);
  const label = saved ? t.remove(itemName) : t.add(itemName);

  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = !saved;
    setPressKey((key) => key + 1);

    if (target) {
      window.clearTimeout(timerRef.current);
      setBurst((n) => n + 1);
      timerRef.current = window.setTimeout(() => {
        if (mountedRef.current) setBurst(0);
      }, 760);
    }

    void toggle(itemId).then((next) => {
      // The optimistic result may be rolled back by a failed request. If the
      // heart ended up where it started, a quick shake explains the snap.
      if (mountedRef.current && next !== target) {
        setShake((n) => n + 1);
        window.setTimeout(() => {
          if (mountedRef.current) setShake(0);
        }, 420);
      }
    });
  };

  const iconSize =
    variant === 'pill'
      ? 15
      : variant === 'bare'
        ? size === 'lg' ? 24 : 22
        : size === 'sm' ? 17 : size === 'lg' ? 21 : 19;
  const isBare = variant === 'bare';

  const sizeShape =
    size === 'sm'
      ? "w-9 h-9 min-w-[36px] min-h-[36px] rounded-full after:absolute after:-inset-1 after:content-['']"
      : size === 'lg'
        ? 'w-12 h-12 min-w-[48px] min-h-[48px] rounded-full'
        : 'w-11 h-11 min-w-[44px] min-h-[44px] rounded-full';

  const inactiveTone = isBare
    ? darkMode
      ? 'border-transparent bg-transparent text-neutral-400 hover:bg-white/[0.06]'
      : 'border-transparent bg-transparent text-[#8a6d00] hover:bg-black/[0.05]'
    : tone === 'overlay'
      ? 'border-white/25 bg-black/40 text-white backdrop-blur-md hover:border-white/45 hover:bg-black/55'
      : darkMode
        ? 'border-[var(--primary)]/35 bg-[var(--primary)]/10 text-[var(--primary)] hover:border-[var(--primary)]/60 hover:bg-[var(--primary)]/15'
        : 'border-[#d9bc45]/70 bg-[#fff8dc] text-[#8a6d00] hover:border-[#c2a400] hover:bg-[#ffefb0]';

  const activeTone = isBare
    ? `border-transparent bg-transparent ${darkMode ? 'text-[var(--primary)] wishlist-bare-saved' : 'text-[#8a6d00]'}`
    : 'border-[var(--primary)] bg-[var(--primary)] text-[#0A0A0A] wishlist-heart-glow';

  const shape =
    variant === 'pill'
      ? "h-9 min-h-[36px] px-3 gap-1.5 rounded-full text-[11px] font-extrabold after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']"
      : sizeShape;

  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={label}
      aria-pressed={saved}
      title={label}
      data-wishlist-item={itemId}
      data-wishlist-saved={saved ? '1' : '0'}
      className={`relative z-20 inline-flex shrink-0 items-center justify-center border font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent ${shape} ${
        saved ? activeTone : inactiveTone
      }${shake ? ' wishlist-shake' : ''} ${className}`.trim()}
    >
      {variant === 'pill' && <span className="whitespace-nowrap">{saved ? t.shortSaved : t.shortSave}</span>}

      <motion.span
        key={pressKey}
        initial={{ scale: 1, rotate: 0 }}
        animate={
          saved
            ? { scale: [1, 1.38, 0.9, 1], rotate: [0, -9, 5, 0] }
            : { scale: [1, 0.82, 1], rotate: 0 }
        }
        transition={{ duration: 0.48, times: [0, 0.35, 0.7, 1], ease: 'easeOut' }}
        className="relative inline-flex items-center justify-center"
      >
        <Heart
          size={iconSize}
          strokeWidth={2.4}
          aria-hidden="true"
          fill={saved ? 'currentColor' : 'none'}
          className={saved && !isBare ? 'drop-shadow-[0_0_4px_rgba(0,0,0,0.25)]' : ''}
        />
      </motion.span>

      {burst > 0 && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 overflow-visible">
          {!isBare && (
            <motion.span
              key={`ring-${burst}`}
              initial={{ scale: 0.45, opacity: 0.7 }}
              animate={{ scale: 1.6, opacity: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              className="absolute inset-0 rounded-full border-2 border-[var(--primary)]"
            />
          )}
          {PARTICLES.map((particle, index) => (
            <motion.span
              key={`${burst}-${index}`}
              initial={{ x: 0, y: 0, opacity: 0.95, scale: 0.45 }}
              animate={{ x: particle.x, y: particle.y, opacity: 0, scale: 1.15 }}
              transition={{ duration: 0.62, ease: 'easeOut', delay: particle.delay }}
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: particle.size,
                height: particle.size,
                marginLeft: -particle.size / 2,
                marginTop: -particle.size / 2,
                backgroundColor: particle.color,
              }}
            />
          ))}
        </span>
      )}
    </button>
  );
};
