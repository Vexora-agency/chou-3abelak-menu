import React from 'react';

type RevealVariant = 'up' | 'down' | 'fade' | 'scale' | 'zoom' | 'blur';
type RevealTag = 'div' | 'section' | 'article' | 'header' | 'footer' | 'li' | 'span';

interface RevealProps extends React.HTMLAttributes<HTMLElement> {
  as?: RevealTag;
  /** Entry direction / feel. */
  variant?: RevealVariant;
  /** Delay in ms (stagger siblings by passing 0/60/120…). */
  delay?: number;
  /** Seconds. */
  duration?: number;
  /** Start offset in px. */
  distance?: number;
  scale?: number;
  blur?: number;
  children: React.ReactNode;
}

type MotionStyle = React.CSSProperties & Record<`--${string}`, string | number>;

/**
 * React Bits-style scroll reveal, adapted to the brand motion language.
 *
 * The heavy lifting lives in the global reveal runtime (one observer for the
 * whole site), so this wrapper is a plain element with data-attributes and
 * costs no extra listeners. Content stays visible when JS is unavailable.
 */
export function Reveal({
  as: Tag = 'div',
  variant = 'up',
  delay = 0,
  duration = 0.85,
  distance = 18,
  scale,
  blur,
  style,
  children,
  ...rest
}: RevealProps) {
  const vars: MotionStyle = {
    ...(style as MotionStyle),
    '--fx-delay': `${Math.max(0, delay)}ms`,
    '--fx-dur': `${Math.max(0.1, duration)}s`,
    '--fx-y': `${distance}px`,
  };
  if (typeof scale === 'number') vars['--fx-s'] = scale;
  if (typeof blur === 'number') vars['--fx-blur'] = `${blur}px`;

  return (
    <Tag
      {...rest}
      data-motion-reveal={variant}
      data-motion-delay={Math.max(0, delay)}
      data-motion-duration={Math.round(Math.max(0.1, duration) * 1000)}
      style={vars}
    >
      {children}
    </Tag>
  );
}
