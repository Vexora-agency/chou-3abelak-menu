/**
 * Image metadata helpers used by the admin upload route.
 *
 * Everything here works on the raw bytes only — the Worker never decodes an
 * image. That keeps CPU/memory flat and lets us reject decompression bombs
 * from the header before they reach R2.
 *
 *   sniff      -> which format the bytes really are (never trust the name or
 *                 Content-Type the client sent)
 *   dimensions -> header-only width/height (JPEG SOF, PNG IHDR, WebP VP8/VP8L/VP8X)
 *   sanitize   -> rebuild the file without metadata blocks (EXIF/GPS/XMP/comments)
 *                 and without bytes appended after the logical end of the image.
 *
 * Accepted formats: JPEG, PNG, WebP. SVG/GIF/AVIF are rejected on purpose:
 * SVG can execute script in our origin, the other two are not needed for menu
 * photos and would need a real decoder to be safe.
 */

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB request body
export const MAX_IMAGE_PIXELS = 40 * 1000 * 1000; // 40 MP decoded ceiling
export const MAX_IMAGE_SIDE = 8000; // px per side
export const MAX_ASPECT_RATIO = 10; // 10:1 panorama guard

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasBytes(bytes, signature, offset = 0) {
  if (!bytes || bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function asciiAt(bytes, offset, length) {
  if (offset + length > bytes.length) return '';
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function readU16BE(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readU16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32LE(bytes, offset) {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    ((bytes[offset + 3] << 24) >>> 0)
  );
}

/** Real content type from magic bytes, or null when unsupported. */
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (hasBytes(bytes, PNG_SIGNATURE)) return 'png';
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'webp';
  return null;
}

export function extensionFor(type) {
  if (type === 'jpeg') return 'jpg';
  if (type === 'png') return 'png';
  if (type === 'webp') return 'webp';
  return null;
}

export function contentTypeFor(type) {
  if (type === 'jpeg') return 'image/jpeg';
  if (type === 'png') return 'image/png';
  if (type === 'webp') return 'image/webp';
  return null;
}

/** Walk JPEG markers up to the first SOF and read its dimensions. */
function readJpegSize(bytes) {
  let i = 2;
  const stop = Math.min(bytes.length - 9, 1024 * 1024);
  while (i < stop) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1];
    while (marker === 0xff) {
      i += 1;
      marker = bytes[i + 1];
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xd8) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // no SOF before scan start
    const segmentLength = readU16BE(bytes, i + 2);
    if (segmentLength < 2) return null;
    // SOF0-SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > bytes.length) return null;
      return { width: readU16BE(bytes, i + 7), height: readU16BE(bytes, i + 5) };
    }
    i += 2 + segmentLength;
  }
  return null;
}

function readPngSize(bytes) {
  if (bytes.length < 24 || asciiAt(bytes, 12, 4) !== 'IHDR') return null;
  return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}

function readWebpSize(bytes) {
  let i = 12;
  while (i + 8 <= bytes.length) {
    const fourcc = asciiAt(bytes, i, 4);
    const size = readU32LE(bytes, i + 4);
    const data = i + 8;
    if (data + size > bytes.length) return null;
    if (fourcc === 'VP8X') {
      if (size < 10) return null;
      return { width: 1 + readU24LE(bytes, data + 4), height: 1 + readU24LE(bytes, data + 7) };
    }
    if (fourcc === 'VP8L') {
      if (size < 5 || bytes[data] !== 0x2f) return null;
      const bits = readU32LE(bytes, data + 1);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (fourcc === 'VP8 ') {
      if (size < 10) return null;
      if (!(bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a)) return null;
      return {
        width: readU16LE(bytes, data + 6) & 0x3fff,
        height: readU16LE(bytes, data + 8) & 0x3fff,
      };
    }
    i = data + size + (size & 1);
  }
  return null;
}

/** Header-only dimensions for an already-sniffed type. */
export function readImageSize(bytes, type) {
  try {
    if (type === 'jpeg') return readJpegSize(bytes);
    if (type === 'png') return readPngSize(bytes);
    if (type === 'webp') return readWebpSize(bytes);
  } catch {
    return null;
  }
  return null;
}

function pngHasChunk(bytes, name) {
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = readU32BE(bytes, i);
    if (length > 0x7fffffff || i + 12 + length > bytes.length) return false;
    if (asciiAt(bytes, i + 4, 4) === name) return true;
    if (asciiAt(bytes, i + 4, 4) === 'IEND') return false;
    i += 12 + length;
  }
  return false;
}

function webpIsAnimated(bytes) {
  let i = 12;
  while (i + 8 <= bytes.length) {
    const fourcc = asciiAt(bytes, i, 4);
    const size = readU32LE(bytes, i + 4);
    if (fourcc === 'ANIM' || fourcc === 'ANMF') return true;
    if (fourcc === 'VP8X' && size >= 1 && (bytes[i + 8] & 0x02) !== 0) return true;
    i += 8 + size + (size & 1);
  }
  return false;
}

/**
 * Remove metadata and trailing bytes without decoding pixels.
 * Returns a new Uint8Array, or null when the structure is malformed.
 */
export function sanitizeImage(bytes, type) {
  if (type === 'jpeg') return sanitizeJpeg(bytes);
  if (type === 'png') return sanitizePng(bytes);
  if (type === 'webp') return sanitizeWebp(bytes);
  return null;
}

function sanitizeJpeg(bytes) {
  const out = [0xff, 0xd8];
  let i = 2;
  let sawScan = false;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1];
    while (marker === 0xff) {
      i += 1;
      marker = bytes[i + 1];
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      return new Uint8Array(out);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    if (i + 3 >= bytes.length) return null;
    const segmentLength = readU16BE(bytes, i + 2);
    if (segmentLength < 2 || i + 2 + segmentLength > bytes.length) return null;

    if (marker === 0xda) {
      // Start of scan: header, then entropy-coded data. Walk it until the
      // next real marker so progressive scans and EOI are handled correctly.
      for (let k = i; k < i + 2 + segmentLength; k++) out.push(bytes[k]);
      i += 2 + segmentLength;
      const entropyStart = i;
      let end = -1;
      while (i + 1 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i += 1;
          continue;
        }
        const next = bytes[i + 1];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          i += 2;
          continue;
        }
        end = i;
        break;
      }
      if (end < 0) return null;
      for (let k = entropyStart; k < end; k++) out.push(bytes[k]);
      i = end;
      sawScan = true;
      continue;
    }

    // Keep everything except APP1-APP15 (EXIF/XMP/IPTC) and comments.
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) {
      for (let k = i; k < i + 2 + segmentLength; k++) out.push(bytes[k]);
    }
    i += 2 + segmentLength;
  }
  if (!sawScan) return null;
  return null;
}

function sanitizePng(bytes) {
  if (!hasBytes(bytes, PNG_SIGNATURE)) return null;
  const out = [];
  for (const b of PNG_SIGNATURE) out.push(b);
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = readU32BE(bytes, i);
    if (length > 0x7fffffff || i + 12 + length > bytes.length) return null;
    const name = asciiAt(bytes, i + 4, 4);
    if (name === 'IEND') {
      for (let k = i; k < i + 12; k++) out.push(bytes[k]);
      return new Uint8Array(out);
    }
    const drop =
      name === 'eXIf' || name === 'tEXt' || name === 'zTXt' || name === 'iTXt' || name === 'tIME' || name === 'dSIG';
    if (!drop) {
      for (let k = i; k < i + 12 + length; k++) out.push(bytes[k]);
    }
    i += 12 + length;
  }
  return null;
}

function sanitizeWebp(bytes) {
  if (asciiAt(bytes, 0, 4) !== 'RIFF' || asciiAt(bytes, 8, 4) !== 'WEBP') return null;
  const declaredSize = readU32LE(bytes, 4);
  const total = 8 + declaredSize;
  if (declaredSize < 12 || total > bytes.length) return null;

  const kept = [];
  let bodySize = 4; // 'WEBP'
  let i = 12;
  let sawImageChunk = false;
  while (i + 8 <= total) {
    const fourcc = asciiAt(bytes, i, 4);
    const size = readU32LE(bytes, i + 4);
    const end = i + 8 + size + (size & 1);
    if (end > total) return null;
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') {
      const chunk = bytes.subarray(i, end);
      kept.push(chunk);
      bodySize += chunk.length;
      if (fourcc === 'VP8 ' || fourcc === 'VP8L' || fourcc === 'VP8X') sawImageChunk = true;
    }
    i = end;
  }
  if (!sawImageChunk) return null;

  const out = new Uint8Array(8 + bodySize);
  out[0] = 0x52;
  out[1] = 0x49;
  out[2] = 0x46;
  out[3] = 0x46;
  out[4] = bodySize & 0xff;
  out[5] = (bodySize >>> 8) & 0xff;
  out[6] = (bodySize >>> 16) & 0xff;
  out[7] = (bodySize >>> 24) & 0xff;
  out[8] = 0x57;
  out[9] = 0x45;
  out[10] = 0x42;
  out[11] = 0x50;
  let offset = 12;
  for (const chunk of kept) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Full server-side analysis: type, animation, dimensions, metadata strip.
 * Returns { ok: true, type, ext, contentType, width, height, bytes } or
 * { ok: false, error } with a machine-readable error code.
 */
export function analyzeImage(bytes) {
  if (!bytes || bytes.length === 0) return { ok: false, error: 'empty' };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: 'too_large' };

  const type = sniffImageType(bytes);
  if (!type) return { ok: false, error: 'unsupported_type' };

  if (type === 'png' && pngHasChunk(bytes, 'acTL')) {
    return { ok: false, error: 'animated_unsupported' };
  }
  if (type === 'webp' && webpIsAnimated(bytes)) {
    return { ok: false, error: 'animated_unsupported' };
  }

  const size = readImageSize(bytes, type);
  if (!size || !size.width || !size.height) return { ok: false, error: 'malformed' };
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
    return { ok: false, error: 'image_too_large' };
  }
  if (size.width * size.height > MAX_IMAGE_PIXELS) {
    return { ok: false, error: 'image_too_large' };
  }
  const longSide = Math.max(size.width, size.height);
  const shortSide = Math.min(size.width, size.height);
  if (shortSide > 0 && longSide / shortSide > MAX_ASPECT_RATIO) {
    return { ok: false, error: 'image_too_large' };
  }

  const clean = sanitizeImage(bytes, type);
  if (!clean) return { ok: false, error: 'malformed' };

  return {
    ok: true,
    type,
    ext: extensionFor(type),
    contentType: contentTypeFor(type),
    width: size.width,
    height: size.height,
    bytes: clean,
  };
}

/** Strict key shape for reads/deletes: menu/<YYYY>/<MM>/<uuid>.<ext> */
export const IMAGE_KEY_RE =
  /^menu\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** /api/images/<key> -> key, or null when the path is not a valid key. */
export function keyFromPath(pathname) {
  const prefix = '/api/images/';
  if (!pathname.startsWith(prefix)) return null;
  let key;
  try {
    key = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
  return IMAGE_KEY_RE.test(key) ? key : null;
}
