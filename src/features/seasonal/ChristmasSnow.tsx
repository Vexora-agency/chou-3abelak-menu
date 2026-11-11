import React from 'react';

/**
 * Christmas snowfall — guaranteed-visible DOM version (❄ ❅ ❆ glyphs).
 *
 * Why DOM and not canvas here: the owner asked for this exact look and for
 * certainty it renders. 12 flakes only (not 150): each flake is a single
 * compositor-friendly node animating `transform` exclusively (fall on the
 * outer span, sway on the inner one) — no `top`/`left` animation, no blur
 * filters, no layout, no paint per frame. `prefers-reduced-motion` and
 * save-data are handled by the parent (it doesn't render us at all).
 *
 * Siblings: greeting lives in SeasonGreeting.tsx; admin celebration bursts
 * live in confetti.ts (lazy canvas-confetti, admin only).
 */

interface FlakeSpec {
  ch: string;
  left: string;
  size: number;
  opacity: number;
  fall: number;
  fallDelay: number;
  sway: number;
  swayDelay: number;
  drift: number;
}

const CHARS = ['❅', '❆', '❄'];

function buildFlakes(count: number): FlakeSpec[] {
  // Deterministic pseudo-random (seeded) so SSR/first paint is stable and
  // every visitor sees the same balanced sky — no Math.random re-roll.
  let s = 20261225;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const out: FlakeSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      ch: CHARS[i % CHARS.length],
      left: `${Math.round(rnd() * 100)}%`,
      size: 14 + Math.round(rnd() * 18),
      opacity: 0.55 + rnd() * 0.45,
      fall: 9 + rnd() * 9,
      fallDelay: -rnd() * 18,
      sway: 2.2 + rnd() * 2.4,
      swayDelay: -rnd() * 5,
      drift: Math.round((rnd() - 0.35) * 120),
    });
  }
  return out;
}

const FLAKES: FlakeSpec[] = buildFlakes(12);

export const ChristmasSnow: React.FC = () => (
  <div className="xmas-snow" aria-hidden="true">
    {FLAKES.map((f, i) => (
      <span
        key={i}
        className="xmas-flake"
        style={{
          left: f.left,
          opacity: f.opacity,
          ['--xmas-drift' as string]: `${f.drift}px`,
          animationDuration: `${f.fall}s`,
          animationDelay: `${f.fallDelay}s`,
        } as React.CSSProperties}
      >
        <span
          className="xmas-flake-sway"
          style={{
            fontSize: f.size,
            animationDuration: `${f.sway}s`,
            animationDelay: `${f.swayDelay}s`,
          }}
        >
          {f.ch}
        </span>
      </span>
    ))}
  </div>
);
