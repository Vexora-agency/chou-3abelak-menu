/**
 * Pure crop math for the admin photo crop editor. No DOM anywhere in
 * this file, so it runs in node (scripts/test-crop-math.ts) as well as the
 * browser. The editor (ImageCropEditor.tsx) and the exporter
 * (exportCrop in image-upload.ts) both build on these three functions.
 *
 * Model: the source photo is srcW × srcH px. The viewport shows a rect with
 * the requested aspect (16:10 by default, 1:1 for round cards). zoom = 1 shows
 * the largest fitting rect (exactly what `object-fit: cover` would show);
 * zoom > 1 narrows the rect around the center (cx, cy). Pan moves the center;
 * it is clamped so the rect never leaves the photo (no letterboxing, no matte
 * in the export).
 */

export const CROP_ASPECT = 16 / 10;
export const CROP_MIN_ZOOM = 1;
export const CROP_MAX_ZOOM = 4;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CropCenter {
  cx: number;
  cy: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return CROP_MIN_ZOOM;
  return Math.min(CROP_MAX_ZOOM, Math.max(CROP_MIN_ZOOM, zoom));
}

/** Largest 16:10 (or custom-aspect) rect that fits inside the source. */
export function baseCropRect(srcW: number, srcH: number, aspect: number = CROP_ASPECT): CropRect {
  if (!(srcW > 0) || !(srcH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : CROP_ASPECT;
  let w: number;
  let h: number;
  if (srcW / srcH >= a) {
    h = srcH;
    w = srcH * a;
  } else {
    w = srcW;
    h = srcW / a;
  }
  return { x: (srcW - w) / 2, y: (srcH - h) / 2, w, h };
}

/** Clamp a center so a w × h rect stays fully inside srcW × srcH. */
export function clampCropCenter(
  srcW: number,
  srcH: number,
  rectW: number,
  rectH: number,
  cx: number,
  cy: number,
): CropCenter {
  const cxSafe = Number.isFinite(cx) ? cx : srcW / 2;
  const cySafe = Number.isFinite(cy) ? cy : srcH / 2;
  if (rectW >= srcW) return { cx: srcW / 2, cy: rectH >= srcH ? srcH / 2 : Math.min(srcH - rectH / 2, Math.max(rectH / 2, cySafe)) };
  if (rectH >= srcH) return { cx: Math.min(srcW - rectW / 2, Math.max(rectW / 2, cxSafe)), cy: srcH / 2 };
  return {
    cx: Math.min(srcW - rectW / 2, Math.max(rectW / 2, cxSafe)),
    cy: Math.min(srcH - rectH / 2, Math.max(rectH / 2, cySafe)),
  };
}

/** Visible source rect for a zoom + center (the exact export region). */
export function zoomedCropRect(
  srcW: number,
  srcH: number,
  cx: number,
  cy: number,
  zoom: number,
  aspect: number = CROP_ASPECT,
): CropRect {
  const base = baseCropRect(srcW, srcH, aspect);
  const z = clampZoom(zoom);
  const w = base.w / z;
  const h = base.h / z;
  const c = clampCropCenter(srcW, srcH, w, h, cx, cy);
  return { x: c.cx - w / 2, y: c.cy - h / 2, w, h };
}

/**
 * Drag the photo by a canvas-pixel delta: dragging right moves the image
 * right, i.e. the visible window moves left through the source.
 * viewportW is the canvas CSS width in px.
 */
export function panCropCenter(
  srcW: number,
  srcH: number,
  cx: number,
  cy: number,
  zoom: number,
  dxPx: number,
  dyPx: number,
  viewportW: number,
  aspect: number = CROP_ASPECT,
): CropCenter {
  if (!(viewportW > 0)) return clampCropCenter(srcW, srcH, 0, 0, cx, cy);
  const rect = zoomedCropRect(srcW, srcH, cx, cy, zoom, aspect);
  const scale = rect.w / viewportW;
  return clampCropCenter(srcW, srcH, rect.w, rect.h, cx - dxPx * scale, cy - dyPx * scale);
}
