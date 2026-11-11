import React from 'react';
import './xmas-header.css';

interface XmasHeaderProps {
  /** Rendered only while the christmas seasonal theme is active. */
  festive?: boolean;
}

const BULB_TONES = ['gold', 'red', 'green'] as const;
const BULB_COUNT = 18;

interface BulbSpec {
  tone: (typeof BULB_TONES)[number];
  /** Staggered twinkle offset (opacity only — compositor-cheap). */
  delay: string;
  duration: string;
  /** Alternating hang depth so the strand reads as draped, not ruled. */
  drop: 0 | 1;
}

function buildBulbs(count: number): BulbSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    tone: BULB_TONES[i % BULB_TONES.length],
    delay: `${(i % 6) * 0.35}s`,
    duration: `${1.6 + (i % 3) * 0.55}s`,
    drop: i % 2 === 0 ? 0 : 1,
  }));
}

const BULBS: BulbSpec[] = buildBulbs(BULB_COUNT);

/**
 * Christmas header dressing: a draped string-light strand across the top of
 * the header plus a soft CSS-only frost on the header edges.
 *
 * Pure CSS/SVG — no images, no new libraries. Mounted by `Header` only while
 * the `christmas` seasonal theme is active. The whole layer is
 * `pointer-events: none` and lives behind the header content (z-index below
 * the brand/actions rows), so the intro canvases and all taps are untouched.
 */
export const XmasHeader: React.FC<XmasHeaderProps> = ({ festive = true }) => {
  if (!festive) return null;
  return (
    <div className="xmas-hdr" aria-hidden="true">
      {/* Draped string lights */}
      <div className="xmas-hdr-lights">
        <div className="xmas-hdr-wire" />
        <div className="xmas-hdr-bulbs">
          {BULBS.map((b, i) => (
            <span key={i} className={`xmas-hdr-drop xmas-hdr-drop-${b.drop}`}>
              <span
                className={`xmas-hdr-bulb xmas-hdr-${b.tone}`}
                style={{ animationDelay: b.delay, animationDuration: b.duration }}
              />
            </span>
          ))}
        </div>
      </div>
      {/* Soft frost on the header edges */}
      <div className="xmas-hdr-frost xmas-hdr-frost-top" />
      <div className="xmas-hdr-frost xmas-hdr-frost-bottom" />
    </div>
  );
};

/**
 * Tiny tilted Santa hat perched on the logo corner (inline SVG, no assets).
 * Rendered by `HeaderBrandBlock` inside the logo container — small enough to
 * never cover the brand name, clipped safely by the container if needed.
 */
export const XmasLogoHat: React.FC = () => (
  <span className="xmas-hdr-hat" aria-hidden="true">
    <svg viewBox="0 0 64 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Floppy cap sweeping up-right */}
      <path
        d="M10 44C16 30 30 18 55 12c-2 8-6 14-11 18 5 0 9 3 11 8-12-3-32 0-45 6Z"
        fill="#C93333"
      />
      <path
        d="M10 44c6-14 20-26 45-32-1 4-3 8-5 11-10 2-24 10-32 19l-8 2Z"
        fill="#E04848"
      />
      {/* White brim */}
      <rect x="4" y="40" width="46" height="11" rx="5.5" fill="#F7F3EA" />
      <rect x="4" y="40" width="46" height="11" rx="5.5" fill="black" fillOpacity="0.04" />
      {/* Pom-pom */}
      <circle cx="55" cy="12" r="7" fill="#F7F3EA" />
      <circle cx="55" cy="12" r="7" fill="black" fillOpacity="0.05" />
    </svg>
  </span>
);
