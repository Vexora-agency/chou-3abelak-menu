import React from 'react';
import type { ResolvedMark, CardMarkStyleId } from '@/src/utils/cardMark';
import { BRAND_MARK_SRC } from '@/src/utils/cardMark';

/* ------------------------------------------------------------------ */
/* CardMarkView: single source of truth for watermark rendering.       */
/* Used by the live menu (full size) and the admin preview (mini).     */
/* ------------------------------------------------------------------ */

interface CardMarkViewProps {
  mark: ResolvedMark;
  style: CardMarkStyleId;
  opacity01: number;
  x: number;
  y: number;
  /** Rotation degrees for the mark / pattern field. */
  rotate: number;
  /** Card theme: gold mark on dark, black mark on light (always legible). */
  dark: boolean;
  /** Size multiplier (1 = 100%). */
  scale01?: number;
  size?: 'full' | 'mini';
  /** Hover scale (menu only — off while dragging in preview). */
  interactive?: boolean;
}

/* Base px sizes (before scale). Mini previews render at half. */
const SIZES = {
  corner: { img: 96, glyph: 84 },
  center: { img: 144, glyph: 128 },
  cover: { img: 280, glyph: 240 },
  tile: { img: 28, glyph: 26 },
} as const;

export const CardMarkView: React.FC<CardMarkViewProps> = ({
  mark,
  style,
  opacity01,
  x,
  y,
  rotate,
  dark,
  scale01 = 1,
  size = 'full',
  interactive = true,
}) => {
  if (!mark) return null;
  const f = scale01 * (size === 'mini' ? 0.5 : 1);
  const hover = interactive
    ? 'transition-transform duration-500 group-hover:scale-110'
    : '';
  // Theme-adaptive artwork: luminous gold on dark cards, black silhouette
  // on light cards (same trick as the featured carousel's yellow cards).
  const isBrand = mark.kind === 'img' && mark.src === BRAND_MARK_SRC;
  const imgTone = isBrand && !dark ? '[filter:brightness(0)]' : '';
  const glyphTone = dark ? 'text-[var(--primary)]' : 'text-[#0A0A0A]';

  if (style === 'pattern') {
    const t = Math.max(8, Math.round(SIZES.tile.img * f));
    // Tiled wallpaper. x/y drift the whole field (bounded by the bleed).
    const drift = 30;
    const dx = (((x ?? 50) - 50) / 50) * drift;
    const dy = (((y ?? 50) - 50) / 50) * drift;
    return (
      <div
        aria-hidden="true"
        className="absolute -inset-10 overflow-hidden pointer-events-none select-none"
        style={{ opacity: opacity01 }}
      >
        <div
          className={`grid ${size === 'mini' ? 'grid-cols-4 gap-3' : 'grid-cols-5 gap-5'}`}
          style={{ transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg) scale(1.15)` }}
        >
          {Array.from({ length: size === 'mini' ? 24 : 30 }).map((_, k) =>
            mark.kind === 'img' ? (
              <img
                key={k}
                src={mark.src}
                alt=""
                draggable={false}
                style={{ width: t, height: t }}
                className={`object-contain ${imgTone}`}
              />
            ) : (
              <mark.Comp
                key={k}
                size={Math.max(8, Math.round(SIZES.tile.glyph * f))}
                strokeWidth={1}
                className={glyphTone}
              />
            )
          )}
        </div>
      </div>
    );
  }

  const s = SIZES[style] || SIZES.corner;
  // Three nested layers: anchor position → user rotation → hover scale.
  // (Inline transforms would clobber each other on one element.)
  const anchor = {
    left: `${x}%`,
    top: `${y}%`,
    opacity: opacity01,
    transform: 'translate(-50%, -50%)',
  } as React.CSSProperties;
  const spin = { transform: `rotate(${rotate}deg)` } as React.CSSProperties;

  if (mark.kind === 'img') {
    return (
      <div aria-hidden="true" className="absolute pointer-events-none select-none" style={anchor}>
        <div style={spin}>
          <img
            src={mark.src}
            alt=""
            draggable={false}
            style={{ width: Math.round(s.img * f) }}
            className={`${hover} ${imgTone}`}
          />
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="absolute pointer-events-none select-none" style={anchor}>
      <div style={spin}>
        <mark.Comp
          size={Math.round(s.glyph * f)}
          strokeWidth={1}
          className={`${hover} ${glyphTone}`}
        />
      </div>
    </div>
  );
};

