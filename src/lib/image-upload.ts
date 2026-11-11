/**
 * Client-side phone photo pipeline for menu item images.
 *
 * Why re-encode in the browser?
 *  - a 12 MP phone photo is 3-6 MB and would eat the admin's data plan;
 *  - EXIF (GPS, device serial) is not carried into a fresh canvas export;
 *  - createImageBitmap applies EXIF orientation by default, so portrait
 *    photos stay upright after the metadata is gone.
 *
 * The server never trusts any of this: it sniffs magic bytes, re-checks
 * dimensions, strips metadata again and caps the body at 8 MB. This file is
 * purely about UX, bandwidth and privacy.
 */

import {
  CROP_ASPECT,
  type CropRect,
} from './crop-math';

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface UploadedImage {
  url: string;
  key: string;
  width: number;
  height: number;
  bytes: number;
  type: string;
}

/** Reject absurdly large source files before decoding them on a phone. */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 80 * 1000 * 1000;
const MAX_EDGE = 1600;
const QUALITY = 0.75;
const SERVER_MAX_BYTES = 8 * 1024 * 1024;

/** Responsive variant widths (px) derived from the same crop rect. The full
 *  image keeps the current behaviour (QUALITY 0.75); variants use a slightly
 *  lower quality since downscaling already removes detail. */
export const VARIANT_WIDTHS = { s: 400, m: 800 };
export const VARIANT_QUALITY = 0.70;
/** A variant is only generated when the crop rect is clearly wider than the
 *  variant (avoids uploading near-duplicate files of the same pixels). */
const VARIANT_MIN_MARGIN = 1.15;

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class ImagePrepareError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ImagePrepareError';
    this.code = code;
  }
}

export class UploadError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'UploadError';
    this.code = code;
    this.status = status;
  }
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to the <img> path (older Safari / odd formats).
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImagePrepareError('decode_failed'));
    };
    img.src = url;
  });
}

function renderToBlob(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement, width: number, height: number, type: string, quality: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  // White matte: a transparent PNG re-encoded as JPEG would turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/** A decoded photo, ready to draw. Call `close()` when done (frees the
 *  decoded pixels on browsers with ImageBitmap; no-op for <img>/<canvas>). */
export interface DecodedSource {
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  close: () => void;
}

function closeSource(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement): void {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();
}

/**
 * Validate + decode a picked file without resizing. Throws
 * ImagePrepareError with the same codes as prepareImage. Used by the crop
 * editor, which needs the full-resolution pixels.
 */
export async function decodeSourceImage(file: File): Promise<DecodedSource> {
  if (file.size > MAX_SOURCE_BYTES) throw new ImagePrepareError('source_too_large');
  if (file.type && !ACCEPTED_TYPES.has(file.type)) throw new ImagePrepareError('unsupported_type');

  const source = await decode(file);
  const width = 'width' in source ? source.width : 0;
  const height = 'height' in source ? source.height : 0;
  if (!width || !height) {
    closeSource(source);
    throw new ImagePrepareError('decode_failed');
  }
  if (width * height > MAX_SOURCE_PIXELS) {
    closeSource(source);
    throw new ImagePrepareError('too_large');
  }
  return { source, width, height, close: () => closeSource(source) };
}

/**
 * Rotate a decoded source ±90° (editor "flip"/rotate buttons). Renders onto a
 * fresh canvas — a 90° canvas transpose maps pixels exactly, no blur — then
 * re-wraps as a bitmap when possible. The old source is closed; the editor
 * resets its framing because width/height swap. Throws ImagePrepareError.
 */
export async function rotateSource90(decoded: DecodedSource, dir: 1 | -1): Promise<DecodedSource> {
  const { source, width, height } = decoded;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, height);
  canvas.height = Math.max(1, width);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImagePrepareError('encode_failed');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((dir * Math.PI) / 2);
  try {
    ctx.drawImage(source, -width / 2, -height / 2, width, height);
  } catch {
    throw new ImagePrepareError('encode_failed');
  }

  let next: ImageBitmap | HTMLImageElement | HTMLCanvasElement = canvas;
  if (typeof createImageBitmap === 'function') {
    try {
      next = await createImageBitmap(canvas);
    } catch {
      next = canvas;
    }
  }
  decoded.close();
  return { source: next, width: height, height: width, close: () => closeSource(next) };
}

/**
 * Mirror a decoded source (editor flip buttons): 'horizontal' turns right
 * into left, 'vertical' turns top into bottom. Pixel-exact like rotation,
 * dimensions unchanged so the editor keeps its framing. Throws
 * ImagePrepareError.
 */
export async function flipSource(
  decoded: DecodedSource,
  axis: 'horizontal' | 'vertical',
): Promise<DecodedSource> {
  const { source, width, height } = decoded;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImagePrepareError('encode_failed');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (axis === 'horizontal') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, canvas.height);
    ctx.scale(1, -1);
  }
  try {
    ctx.drawImage(source, 0, 0, width, height);
  } catch {
    throw new ImagePrepareError('encode_failed');
  }

  let next: ImageBitmap | HTMLImageElement | HTMLCanvasElement = canvas;
  if (typeof createImageBitmap === 'function') {
    try {
      next = await createImageBitmap(canvas);
    } catch {
      next = canvas;
    }
  }
  decoded.close();
  return { source: next, width, height, close: () => closeSource(next) };
}

/**
 * Export a 16:10 crop rect (source pixels, from the crop editor) to an
 * upload-ready blob. Output width follows the rect (320..1280px) so a deep
 * zoom never upscales into blur; the server re-validates everything anyway.
 */
export async function exportCrop(
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  rect: CropRect,
): Promise<PreparedImage> {
  const outW = Math.min(1280, Math.max(320, Math.round(rect.w)));
  const outH = Math.max(1, Math.round(outW / CROP_ASPECT));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImagePrepareError('encode_failed');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, outW, outH);

  const encode = (type: string, quality: number): Promise<Blob | null> =>
    new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });

  let blob = await encode('image/webp', QUALITY);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', QUALITY);
  if (!blob) throw new ImagePrepareError('encode_failed');
  if (blob.size > SERVER_MAX_BYTES) {
    // Oversized fallback (tighter quality; ~20-30% smaller than before).
    blob = await encode('image/webp', 0.68);
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.68);
  }
  if (!blob) throw new ImagePrepareError('encode_failed');
  if (blob.size > SERVER_MAX_BYTES) throw new ImagePrepareError('too_large');
  return { blob, width: outW, height: outH };
}

/**
 * Export the same crop rect at a smaller width (responsive variant). Never
 * upscales: when the rect is narrower than the target, the rect width itself
 * is used. WebP first, JPEG fallback — same policy as exportCrop, at
 * VARIANT_QUALITY.
 */
export async function exportCropVariant(
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  rect: CropRect,
  targetW: number,
): Promise<PreparedImage> {
  const outW = Math.max(1, Math.round(Math.min(targetW, rect.w)));
  const outH = Math.max(1, Math.round(outW / CROP_ASPECT));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImagePrepareError('encode_failed');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, outW, outH);

  const encode = (type: string, quality: number): Promise<Blob | null> =>
    new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });

  let blob = await encode('image/webp', VARIANT_QUALITY);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', VARIANT_QUALITY);
  if (!blob) throw new ImagePrepareError('encode_failed');
  if (blob.size > SERVER_MAX_BYTES) {
    blob = await encode('image/webp', 0.68);
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.68);
  }
  if (!blob) throw new ImagePrepareError('encode_failed');
  if (blob.size > SERVER_MAX_BYTES) throw new ImagePrepareError('too_large');
  return { blob, width: outW, height: outH };
}

/**
 * Encode one full-frame variant at `targetW` (direct downscale of an already
 * cropped photo — no rect involved). WebP first, JPEG fallback, same policy
 * as exportCropVariant, at VARIANT_QUALITY.
 */
async function encodeDirectVariant(
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  targetW: number,
): Promise<PreparedImage> {
  const outW = Math.max(1, Math.round(Math.min(targetW, srcW)));
  const outH = Math.max(1, Math.round(outW / CROP_ASPECT));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImagePrepareError('encode_failed');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, outW, outH);
  } catch {
    throw new ImagePrepareError('encode_failed');
  }

  const encode = (type: string, quality: number): Promise<Blob | null> =>
    new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    });

  let blob = await encode('image/webp', VARIANT_QUALITY);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', VARIANT_QUALITY);
  if (!blob) throw new ImagePrepareError('encode_failed');
  if (blob.size > SERVER_MAX_BYTES) {
    blob = await encode('image/webp', 0.68);
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', 0.68);
  }
  if (!blob) throw new ImagePrepareError('encode_failed');
  if (blob.size > SERVER_MAX_BYTES) throw new ImagePrepareError('too_large');
  return { blob, width: outW, height: outH };
}

/**
 * Build responsive variants from an already-cropped photo (e.g. an old
 * internal item image re-downloaded from /api/images/…). The source keeps
 * its own framing — it is only downscaled, never upscaled: a variant is
 * produced only when the source is wider than the target by
 * VARIANT_MIN_MARGIN (same near-duplicate guard as exportResponsiveSet).
 * A variant that fails to encode is skipped. Returns possibly-empty.
 */
export async function variantsFromBitmap(
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  srcW: number,
  srcH: number,
): Promise<{ s?: PreparedImage; m?: PreparedImage }> {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    throw new ImagePrepareError('decode_failed');
  }
  const out: { s?: PreparedImage; m?: PreparedImage } = {};
  const targets = [
    { key: 's', w: VARIANT_WIDTHS.s },
    { key: 'm', w: VARIANT_WIDTHS.m },
  ] as const;
  for (const { key, w } of targets) {
    if (srcW < w * VARIANT_MIN_MARGIN) continue;
    try {
      out[key] = await encodeDirectVariant(source, srcW, srcH, w);
    } catch (error) {
      console.warn('[image-upload] direct variant skipped.', error);
    }
  }
  return out;
}

/** One full export plus the optional smaller variants of the same crop. */
export interface ResponsiveImageSet {
  full: PreparedImage;
  s?: PreparedImage;
  m?: PreparedImage;
}

/**
 * Build the upload set for a crop rect: `full` is exactly what exportCrop
 * produces today (unchanged behaviour); `s`/`m` are only included when the
 * rect is wider than the variant by VARIANT_MIN_MARGIN, so small crops don't
 * produce near-duplicate files. A variant that fails to encode is skipped —
 * `full` is always returned.
 */
export async function exportResponsiveSet(
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  rect: CropRect,
): Promise<ResponsiveImageSet> {
  const full = await exportCrop(source, rect);
  const set: ResponsiveImageSet = { full };
  if (rect.w >= VARIANT_WIDTHS.s * VARIANT_MIN_MARGIN) {
    try {
      set.s = await exportCropVariant(source, rect, VARIANT_WIDTHS.s);
    } catch (error) {
      console.warn('[image-upload] small variant skipped.', error);
    }
  }
  if (rect.w >= VARIANT_WIDTHS.m * VARIANT_MIN_MARGIN) {
    try {
      set.m = await exportCropVariant(source, rect, VARIANT_WIDTHS.m);
    } catch (error) {
      console.warn('[image-upload] medium variant skipped.', error);
    }
  }
  return set;
}

/** Downscale, re-encode and drop metadata. Throws ImagePrepareError. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const decoded = await decodeSourceImage(file);
  const { source, width: sourceWidth, height: sourceHeight } = decoded;

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  let blob = await renderToBlob(source, width, height, 'image/webp', QUALITY);
  if (!blob || blob.type !== 'image/webp') {
    blob = await renderToBlob(source, width, height, 'image/jpeg', QUALITY);
  }
  if (!blob) throw new ImagePrepareError('encode_failed');

  let finalWidth = width;
  let finalHeight = height;
  if (blob.size > SERVER_MAX_BYTES) {
    const retryScale = Math.min(scale, 1280 / Math.max(sourceWidth, sourceHeight));
    finalWidth = Math.max(1, Math.round(sourceWidth * retryScale));
    finalHeight = Math.max(1, Math.round(sourceHeight * retryScale));
    blob = await renderToBlob(source, finalWidth, finalHeight, 'image/webp', 0.68);
    if (!blob || blob.type !== 'image/webp') {
      blob = await renderToBlob(source, finalWidth, finalHeight, 'image/jpeg', 0.68);
    }
  }
  if (!blob) throw new ImagePrepareError('encode_failed');
  if (blob.size > SERVER_MAX_BYTES) throw new ImagePrepareError('too_large');

  decoded.close();

  return { blob, width: finalWidth, height: finalHeight };
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

interface UploadResponse {
  ok?: boolean;
  error?: string;
  url?: string;
  key?: string;
  width?: number;
  height?: number;
  bytes?: number;
  type?: string;
}

/**
 * Raw-body POST to /api/admin/images. XHR (not fetch) because only
 * xhr.upload reports progress. The custom header is the repo's CSRF gate;
 * the browser adds Origin and the session cookie automatically.
 */
export function uploadItemImage(blob: Blob, options: UploadOptions = {}): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/images', true);
    xhr.setRequestHeader('X-Requested-With', 'menu-admin');
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.responseType = 'text';

    const onAbort = () => xhr.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        reject(new UploadError('aborted', 0));
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }
    const cleanup = () => {
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
    };

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !options.onProgress) return;
      options.onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new UploadError('network', 0));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new UploadError('aborted', 0));
    };
    xhr.onload = () => {
      cleanup();
      let data: UploadResponse | null;
      try {
        data = JSON.parse(xhr.responseText || '{}') as UploadResponse;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.ok && data.url && data.key) {
        resolve({
          url: data.url,
          key: data.key,
          width: Number(data.width) || 0,
          height: Number(data.height) || 0,
          bytes: Number(data.bytes) || blob.size,
          type: String(data.type || ''),
        });
        return;
      }
      reject(new UploadError(String((data && data.error) || 'upload_failed'), xhr.status));
    };

    xhr.send(blob);
  });
}

/** Upload result for a responsive set: `full` always present, variants only
 *  when they were generated and their upload succeeded. */
export interface VariantUploadResult {
  full: UploadedImage;
  s?: UploadedImage;
  m?: UploadedImage;
}

/**
 * Upload a responsive set: full first, then s, then m (sequentially, over
 * the same AbortSignal). Progress is aggregated by bytes across all parts.
 * Variant uploads are best-effort — a variant failure is logged and skipped
 * while `full` still resolves. An abort always rejects, even mid-variant, so
 * a superseded auto-save never commits a stale photo.
 */
export async function uploadVariantSet(
  set: ResponsiveImageSet,
  options: UploadOptions = {},
): Promise<VariantUploadResult> {
  const throwIfAborted = (): void => {
    if (options.signal?.aborted) throw new UploadError('aborted', 0);
  };
  throwIfAborted();

  const variants: Array<{ key: 's' | 'm'; prepared: PreparedImage }> = [];
  if (set.s) variants.push({ key: 's', prepared: set.s });
  if (set.m) variants.push({ key: 'm', prepared: set.m });

  const fullSize = set.full.blob.size || 1;
  const total = variants.reduce((sum, v) => sum + (v.prepared.blob.size || 1), fullSize) || 1;
  let completed = 0;
  const scopedProgress = (size: number) => (percent: number) => {
    if (!options.onProgress) return;
    const overall = ((completed + (size * percent) / 100) / total) * 100;
    options.onProgress(Math.max(0, Math.min(100, Math.round(overall))));
  };

  const full = await uploadItemImage(set.full.blob, {
    signal: options.signal,
    onProgress: scopedProgress(fullSize),
  });
  completed += fullSize;

  const result: VariantUploadResult = { full };
  for (const { key, prepared } of variants) {
    throwIfAborted();
    const size = prepared.blob.size || 1;
    try {
      result[key] = await uploadItemImage(prepared.blob, {
        signal: options.signal,
        onProgress: scopedProgress(size),
      });
    } catch (error) {
      if (options.signal?.aborted || (error instanceof UploadError && error.code === 'aborted')) {
        throw error;
      }
      console.warn('[image-upload] variant upload skipped (full kept).', error);
    }
    completed += size;
  }
  options.onProgress?.(100);
  return result;
}
