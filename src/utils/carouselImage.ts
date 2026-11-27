import type { CarouselImageAdjust } from '@/src/types/menu';

export const CAROUSEL_IMAGE_MIN_SCALE = 0.8;
export const CAROUSEL_IMAGE_MAX_SCALE = 2.5;
export const CAROUSEL_IMAGE_MAX_PAN = 50;
export const CAROUSEL_IMAGE_MAX_ROTATE = 180;

export const CAROUSEL_IMAGE_DEFAULTS: CarouselImageAdjust = {
  scale: 1,
  x: 0,
  y: 0,
  rotate: 0,
  flipX: false,
  flipY: false,
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Never throws: legacy/corrupt stored values fall back to cover framing. */
export function normalizeCarouselImage(raw: unknown): CarouselImageAdjust {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  return {
    scale: Math.round(clamp(finiteOr(source.scale, 1), CAROUSEL_IMAGE_MIN_SCALE, CAROUSEL_IMAGE_MAX_SCALE) * 100) / 100,
    x: Math.round(clamp(finiteOr(source.x, 0), -CAROUSEL_IMAGE_MAX_PAN, CAROUSEL_IMAGE_MAX_PAN) * 10) / 10,
    y: Math.round(clamp(finiteOr(source.y, 0), -CAROUSEL_IMAGE_MAX_PAN, CAROUSEL_IMAGE_MAX_PAN) * 10) / 10,
    rotate: Math.round(clamp(finiteOr(source.rotate, 0), -CAROUSEL_IMAGE_MAX_ROTATE, CAROUSEL_IMAGE_MAX_ROTATE)),
    flipX: source.flipX === true,
    flipY: source.flipY === true,
  };
}

export function isDefaultCarouselImage(adjust: CarouselImageAdjust): boolean {
  return (
    adjust.scale === 1 &&
    adjust.x === 0 &&
    adjust.y === 0 &&
    adjust.rotate === 0 &&
    adjust.flipX !== true &&
    adjust.flipY !== true
  );
}

/** CSS transform shared by the storefront carousel and the admin preview. */
export function carouselImageTransform(raw: unknown): string | undefined {
  const adjust = normalizeCarouselImage(raw);
  if (isDefaultCarouselImage(adjust)) return undefined;
  const flipX = adjust.flipX ? -1 : 1;
  const flipY = adjust.flipY ? -1 : 1;
  return `translate(${adjust.x}%, ${adjust.y}%) scale(${adjust.scale}) rotate(${adjust.rotate}deg) scaleX(${flipX}) scaleY(${flipY})`;
}
