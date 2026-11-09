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
const QUALITY = 0.82;
const SERVER_MAX_BYTES = 8 * 1024 * 1024;

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

function renderToBlob(source: ImageBitmap | HTMLImageElement, width: number, height: number, type: string, quality: number): Promise<Blob | null> {
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

/** Downscale, re-encode and drop metadata. Throws ImagePrepareError. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size > MAX_SOURCE_BYTES) throw new ImagePrepareError('source_too_large');
  if (file.type && !ACCEPTED_TYPES.has(file.type)) throw new ImagePrepareError('unsupported_type');

  const source = await decode(file);
  const sourceWidth = 'width' in source ? source.width : 0;
  const sourceHeight = 'height' in source ? source.height : 0;
  if (!sourceWidth || !sourceHeight) throw new ImagePrepareError('decode_failed');
  if (sourceWidth * sourceHeight > MAX_SOURCE_PIXELS) throw new ImagePrepareError('too_large');

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
    blob = await renderToBlob(source, finalWidth, finalHeight, 'image/webp', 0.75);
    if (!blob || blob.type !== 'image/webp') {
      blob = await renderToBlob(source, finalWidth, finalHeight, 'image/jpeg', 0.75);
    }
  }
  if (!blob) throw new ImagePrepareError('encode_failed');
  if (blob.size > SERVER_MAX_BYTES) throw new ImagePrepareError('too_large');

  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) source.close();

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
