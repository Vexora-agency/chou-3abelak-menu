import React, { useState } from 'react';
import type { MenuItem } from '@/src/types/menu';

/**
 * Responsive variants produced by the upload pipeline: s ≈ 400w, m ≈ 800w.
 * `imageUrl` stays the largest rendition (≈ 1280w).
 */
export interface MenuImageVariants {
  s?: string;
  m?: string;
}

/**
 * Minimal shape SmartMenuImage needs. MenuItem satisfies this today (no
 * imageVariants field yet) and will carry variants once the upload pipeline
 * lands — no change needed here when that happens.
 */
export type MenuImageItem = Pick<MenuItem, 'id' | 'imageUrl'> & {
  imageVariants?: MenuImageVariants;
};

interface SmartMenuImageProps {
  item: MenuImageItem;
  /** Alt text: dish name for content photos, '' for decorative backgrounds. */
  name: string;
  /** Kept verbatim from each layout (they already match their grid). */
  sizes: string;
  /** Above-the-fold images: eager load + high fetch priority. */
  eager?: boolean;
  className?: string;
  /** Force fetchpriority="high" even when lazy (rare; eager already implies it). */
  fetchPriorityHigh?: boolean;
  width?: number;
  height?: number;
  /** Defaults to false: dragging an image mid-scroll hijacks the gesture
      and breaks scroll smoothness, especially on touch. */
  draggable?: boolean;
  /** Parent fallback (failedSrc → placeholder) — called when the image errors. */
  onError?: () => void;
  /**
   * Skip the shimmer/fade motion. Used where an existing entrance owns the
   * element's `animation` (e.g. dish-pop on round cards) — a second animation
   * would override it and change the motion.
   */
  plain?: boolean;
}

/** Width descriptor for the full rendition (imageUrl is the largest). */
const LARGE_W = 1280;

/**
 * Responsive dish photo: builds a srcset from imageVariants (400w / 800w /
 * 1280w) for internal /api/images/ URLs only. External or legacy URLs without
 * variants fall back to a plain imageUrl <img> — same as today.
 * Default 400×250 reserves the real 16:10 frame most cards paint
 * (aspect-[16/10]), so no layout shift when the photo decodes.
 */
export const SmartMenuImage: React.FC<SmartMenuImageProps> = ({
  item,
  name,
  sizes,
  eager = false,
  className = '',
  fetchPriorityHigh = false,
  width = 400,
  height = 250,
  draggable = false,
  onError,
  plain = false,
}) => {
  const [loaded, setLoaded] = useState(false);
  const src = item.imageUrl ?? '';
  const variants = item.imageVariants;
  const internal = src.startsWith('/api/images/');

  let srcSet: string | undefined;
  if (internal && variants && (variants.s || variants.m)) {
    const parts: string[] = [];
    if (variants.s) parts.push(`${variants.s} 400w`);
    if (variants.m) parts.push(`${variants.m} 800w`);
    parts.push(`${src} ${LARGE_W}w`);
    srcSet = parts.join(', ');
  }

  const motionClass = plain ? '' : loaded ? 'smart-img-loaded' : 'smart-img-loading';

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      alt={name}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager || fetchPriorityHigh ? 'high' : undefined}
      width={width}
      height={height}
      draggable={draggable}
      onLoad={() => setLoaded(true)}
      onError={onError}
      className={`${className} smart-img ${motionClass}`.trim().replace(/\s+/g, ' ')}
    />
  );
};
