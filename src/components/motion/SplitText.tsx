import React from 'react';

type SplitTag = 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';

interface SplitTextProps {
  text: string;
  as?: SplitTag;
  className?: string;
  /** Base delay before the first word, in ms. */
  delay?: number;
  /** Delay between words, in ms. */
  stagger?: number;
  /** Accessible name when the visible text needs punctuation/context. */
  ariaLabel?: string;
}

type WordStyle = React.CSSProperties & Record<`--${string}`, string | number>;

/**
 * React Bits-style split headline, word-level only.
 *
 * Why words, never characters: Arabic letters join inside a word — splitting
 * at spaces is the only safe unit for this bilingual UI. Each word rises with
 * a soft blur lift, staggered from the start index.
 *
 * Runs on mount (CSS animation), so there is no intersection flash and no
 * dependency on the GSAP chunk.
 */
export function SplitText({
  text,
  as: Tag = 'span',
  className = '',
  delay = 0,
  stagger = 55,
  ariaLabel,
}: SplitTextProps) {
  const words = text.split(/\s+/).filter(Boolean);

  return (
    <Tag className={className} aria-label={ariaLabel || text}>
      <span aria-hidden="true">
        {words.map((word, i) => (
          <React.Fragment key={`${word}-${i}`}>
            {i > 0 ? ' ' : null}
            <span
              className="fx-split-word"
              style={
                {
                  '--fx-i': i,
                  '--fx-delay': `${Math.max(0, delay)}ms`,
                  '--fx-stagger': `${Math.max(0, stagger)}ms`,
                } as WordStyle
              }
            >
              {word}
            </span>
          </React.Fragment>
        ))}
      </span>
    </Tag>
  );
}
