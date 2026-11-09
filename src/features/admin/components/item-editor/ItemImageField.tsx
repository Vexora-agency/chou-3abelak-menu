import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Crop, Image as ImageIcon, ImagePlus, Link2, Loader2, Upload, X } from 'lucide-react';
import type { MenuItem } from '@/src/types/menu';
import {
  ImagePrepareError,
  UploadError,
  decodeSourceImage,
  exportCrop,
  uploadItemImage,
  type DecodedSource,
} from '@/src/lib/image-upload';
import type { CropRect } from '@/src/lib/crop-math';
import { ImageCropEditor } from './ImageCropEditor';

interface ItemImageFieldProps {
  item: MenuItem;
  lang: 'en' | 'ar';
  onChange: (item: MenuItem) => void;
}

/** Accepts absolute http(s) URLs or root-relative paths, the only forms the
 *  server validator keeps. Data URLs are refused: the menu payload is capped
 *  at 256 KB, so an inline photo would break saving for the whole menu. */
const isValidImageUrl = (value: string): boolean => /^(https?:\/\/|\/)/i.test(value.trim());

type Status = 'idle' | 'preparing' | 'uploading' | 'error';

function errorText(code: string, isAr: boolean): string {
  const messages: Record<string, { ar: string; en: string }> = {
    source_too_large: {
      ar: 'الصورة أكبر من 25 ميجا — اختار صورة أصغر.',
      en: 'That photo is over 25 MB — pick a smaller one.',
    },
    unsupported_type: {
      ar: 'مسموح JPG أو PNG أو WebP فقط.',
      en: 'Only JPG, PNG or WebP photos are supported.',
    },
    unsupported_media_type: {
      ar: 'مسموح JPG أو PNG أو WebP فقط.',
      en: 'Only JPG, PNG or WebP photos are supported.',
    },
    decode_failed: {
      ar: 'مش قادرين نقرأ الصورة دي. جرّب صورة JPG من معرض الصور.',
      en: "We couldn't read that photo. Try a JPG from your gallery.",
    },
    encode_failed: {
      ar: 'حصلت مشكلة في تجهيز الصورة — جرّب صورة تانية.',
      en: 'Preparing the photo failed — try another one.',
    },
    too_large: {
      ar: 'الصورة كبيرة جدًا حتى بعد الضغط.',
      en: 'The photo is too large even after resizing.',
    },
    image_too_large: {
      ar: 'أبعاد الصورة كبيرة جدًا.',
      en: 'The photo dimensions are too large.',
    },
    animated_unsupported: {
      ar: 'الصور المتحركة مش مدعومة.',
      en: 'Animated images are not supported.',
    },
    malformed: {
      ar: 'الملف مش صورة سليمة.',
      en: 'That file is not a valid image.',
    },
    empty: {
      ar: 'الملف فاضي — جرّب صورة تانية.',
      en: 'The file is empty — try another photo.',
    },
    rate_limited: {
      ar: 'رفعت صور كتير في وقت قصير — استنى شوية وجرب تاني.',
      en: 'Too many uploads in a short time — wait a bit and try again.',
    },
    unavailable: {
      ar: 'الرفع مش متاح دلوقتي — جرّب تاني أو استخدم رابط صورة.',
      en: 'Upload is unavailable right now — retry or use an image URL.',
    },
    network: {
      ar: 'الاتصال اتقطع أثناء الرفع — جرّب تاني.',
      en: 'The connection dropped during upload — try again.',
    },
    aborted: {
      ar: 'تم إلغاء الرفع.',
      en: 'Upload cancelled.',
    },
    upload_failed: {
      ar: 'الرفع فشل — جرّب تاني.',
      en: 'Upload failed — try again.',
    },
  };
  const entry = messages[code] || messages.upload_failed;
  return isAr ? entry.ar : entry.en;
}

function codeOf(error: unknown): string {
  if (error instanceof ImagePrepareError || error instanceof UploadError) return error.code;
  return 'upload_failed';
}

/** Item photo: upload from the phone (primary) or paste a URL (advanced).
 *  Uploads go through the 16:10 crop editor first, so the admin frames
 *  exactly what customers see in the Photos layout / card backgrounds. */
export const ItemImageField: React.FC<ItemImageFieldProps> = ({ item, lang, onChange }) => {
  const isAr = lang === 'ar';
  const value = item.imageUrl ?? '';
  const trimmed = value.trim();
  const valid = isValidImageUrl(trimmed);

  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  // `failedUrl` records WHICH url broke — editing the url retries the preview.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // Open crop editor for this decoded source (full-resolution pixels).
  const [cropSrc, setCropSrc] = useState<DecodedSource | null>(null);
  // A confirmed file exists that the crop editor can reopen (adjust flow).
  const [canRecrop, setCanRecrop] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<string | null>(null);
  // Newly picked file (not yet cropped) vs last confirmed file (re-crop).
  const pickedRef = useRef<File | null>(null);
  const pendingRef = useRef<File | null>(null);

  const replacePreview = (url: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setLocalPreview(url);
  };

  const closeCropSrc = () => {
    if (!cropSrc) return;
    try {
      cropSrc.close();
    } catch {
      // Bitmap already closed — harmless.
    }
    setCropSrc(null);
  };

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  // The decoded source holds full-resolution pixels: release them when the
  // editor closes for any reason, or if the field unmounts mid-edit.
  useEffect(
    () => () => {
      if (cropSrc) {
        try {
          cropSrc.close();
        } catch {
          // Already closed.
        }
      }
    },
    [cropSrc],
  );

  const setUrl = (next: string) => {
    const { imageUrl: _old, ...rest } = item;
    void _old;
    setFailedUrl(null);
    onChange(next.trim() ? { ...rest, imageUrl: next } : rest);
  };

  const clear = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    closeCropSrc();
    pickedRef.current = null;
    pendingRef.current = null;
    setCanRecrop(false);
    replacePreview(null);
    setStatus('idle');
    setProgress(0);
    setErrorCode(null);
    setUrl('');
  };

  const fail = (error: unknown) => {
    abortRef.current = null;
    const code = codeOf(error);
    if (code === 'aborted') {
      replacePreview(null);
      setStatus('idle');
      setProgress(0);
      return;
    }
    setStatus('error');
    setErrorCode(code);
  };

  const uploadBlob = async (blob: Blob) => {
    replacePreview(URL.createObjectURL(blob));
    setStatus('uploading');

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const uploaded = await uploadItemImage(blob, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      abortRef.current = null;
      setUrl(uploaded.url);
      replacePreview(null);
      setProgress(100);
      setStatus('idle');
    } catch (error) {
      fail(error);
    }
  };

  /** Pick → decode → crop editor (upload happens after confirming a crop). */
  const handleFile = async (file: File) => {
    setErrorCode(null);
    setProgress(0);
    setStatus('preparing');
    try {
      const decoded = await decodeSourceImage(file);
      pickedRef.current = file;
      setCropSrc(decoded);
      setStatus('idle');
    } catch (error) {
      pickedRef.current = null;
      fail(error);
    }
  };

  const handleCropConfirm = async (rect: CropRect) => {
    const current = cropSrc;
    if (!current) return;
    setErrorCode(null);
    setProgress(0);
    setStatus('preparing');
    try {
      const cropped = await exportCrop(current.source, rect);
      pendingRef.current = pickedRef.current;
      pickedRef.current = null;
      setCanRecrop(pendingRef.current !== null);
      closeCropSrc();
      await uploadBlob(cropped.blob);
    } catch (error) {
      closeCropSrc();
      fail(error);
    }
  };

  const handleCropCancel = () => {
    pickedRef.current = null;
    closeCropSrc();
    setStatus('idle');
    setErrorCode(null);
  };

  /** Reopen the editor on the last confirmed file to adjust the framing. */
  const openRecrop = async () => {
    const file = pendingRef.current;
    if (!file || cropSrc) return;
    setErrorCode(null);
    setStatus('preparing');
    try {
      const decoded = await decodeSourceImage(file);
      pickedRef.current = file;
      setCropSrc(decoded);
      setStatus('idle');
    } catch (error) {
      fail(error);
    }
  };

  const openPicker = () => {
    if (fileRef.current) {
      fileRef.current.value = '';
      fileRef.current.click();
    }
  };

  const showLocal = localPreview !== null;
  const remoteOk = !showLocal && trimmed !== '' && valid && failedUrl !== trimmed;
  const previewSrc = showLocal ? localPreview : remoteOk ? trimmed : null;
  const busy = status === 'preparing' || status === 'uploading';
  const editing = cropSrc !== null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-neutral-400">
          <ImageIcon size={13} className="text-[var(--primary)]" aria-hidden="true" />
          {isAr ? 'صورة الصنف (اختياري)' : 'Item photo (optional)'}
        </span>
        {trimmed !== '' && valid && !busy && failedUrl !== trimmed && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 size={11} aria-hidden="true" />
            {isAr ? 'صورة مضافة' : 'Photo set'}
          </span>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={isAr ? 'اختيار صورة الصنف من الجهاز' : 'Choose item photo from this device'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleFile(file);
        }}
      />

      {editing && cropSrc ? (
        <ImageCropEditor
          source={cropSrc.source}
          srcWidth={cropSrc.width}
          srcHeight={cropSrc.height}
          lang={lang}
          onConfirm={(rect) => void handleCropConfirm(rect)}
          onCancel={handleCropCancel}
        />
      ) : (
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-neutral-800 bg-black">
          {previewSrc ? (
            <img
              src={previewSrc}
              alt={isAr ? 'معاينة صورة الصنف' : 'Item photo preview'}
              onError={() => {
                if (!showLocal) setFailedUrl(trimmed);
              }}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <button
              type="button"
              onClick={openPicker}
              disabled={busy}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center hover:bg-neutral-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[var(--primary)]">
                <ImagePlus size={18} aria-hidden="true" />
              </span>
              <span className="text-xs font-bold text-white">
                {isAr ? 'ارفع صورة من الجهاز' : 'Upload a photo'}
              </span>
              <span className="text-[10px] text-neutral-500">
                {isAr ? 'من الكاميرا أو المعرض — JPG / PNG / WebP' : 'Camera or gallery — JPG / PNG / WebP'}
              </span>
            </button>
          )}

          {previewSrc && !busy && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/90 to-transparent p-2">
              <button
                type="button"
                onClick={openPicker}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-[var(--primary)] px-3 text-[11px] font-bold text-[#0A0A0A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <Upload size={12} aria-hidden="true" />
                {isAr ? 'تغيير الصورة' : 'Change photo'}
              </button>
              {canRecrop && (
                <button
                  type="button"
                  onClick={() => void openRecrop()}
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-black/70 px-3 text-[11px] font-bold text-neutral-200 ring-1 ring-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                >
                  <Crop size={12} aria-hidden="true" />
                  {isAr ? 'ضبط القص' : 'Adjust crop'}
                </button>
              )}
              <button
                type="button"
                onClick={clear}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-black/70 px-3 text-[11px] font-bold text-neutral-200 ring-1 ring-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <X size={12} aria-hidden="true" />
                {isAr ? 'إزالة' : 'Remove'}
              </button>
            </div>
          )}

          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6">
              <Loader2 size={20} className="animate-spin text-[var(--primary)]" aria-hidden="true" />
              <span className="text-[11px] font-bold text-white" aria-live="polite">
                {status === 'preparing'
                  ? isAr
                    ? 'جاري تجهيز الصورة…'
                    : 'Preparing photo…'
                  : isAr
                    ? `جاري الرفع ${progress}%`
                    : `Uploading ${progress}%`}
              </span>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={status === 'preparing' ? 0 : progress}
                aria-label={isAr ? 'تقدم رفع الصورة' : 'Photo upload progress'}
                className="h-1.5 w-2/3 overflow-hidden rounded-full bg-neutral-800"
              >
                <div
                  className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-200"
                  style={{ width: `${status === 'preparing' ? 8 : Math.max(progress, 4)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {status === 'error' && errorCode && (
        <p role="alert" className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-red-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{errorText(errorCode, isAr)}</span>
        </p>
      )}

      <p className="text-[10px] leading-relaxed text-neutral-500">
        {isAr
          ? 'بتختار إطار الصورة قبل الرفع، وبنضغطها ونشيل بيانات الموقع (GPS). لو رفعت صورة غلط، غيّرها — الصور القديمة بتتنضف تلقائيًا.'
          : 'You frame the photo before upload; it is resized and stripped of location metadata. Replaced photos are cleaned up automatically.'}
      </p>

      <details className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-2.5 py-2">
        <summary className="cursor-pointer select-none text-[10.5px] font-bold text-neutral-400 hover:text-neutral-200">
          {isAr ? 'أو استخدم رابط صورة بدل الرفع' : 'Or use an image URL instead'}
        </summary>
        <div className="mt-2 space-y-1.5">
          <div className="relative">
            <Link2
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-neutral-500"
            />
            <input
              id="item-image-url"
              type="url"
              dir="ltr"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => {
                replacePreview(null);
                setStatus('idle');
                setErrorCode(null);
                setUrl(event.target.value);
              }}
              placeholder="https://example.com/photo.jpg"
              aria-label={isAr ? 'رابط صورة الصنف' : 'Item photo URL'}
              aria-describedby="item-image-hint"
              className={`h-10 w-full rounded-lg border bg-black pe-9 ps-9 text-start text-sm text-white ${
                trimmed !== '' && !valid ? 'border-red-500' : 'border-neutral-700'
              }`}
            />
            {value !== '' && (
              <button
                type="button"
                onClick={clear}
                aria-label={isAr ? 'إزالة رابط الصورة' : 'Clear photo URL'}
                className="absolute end-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <p id="item-image-hint" className="text-[10px] leading-relaxed text-neutral-500">
            {isAr
              ? 'الرابط لازم يبدأ بـ https:// أو /. بيظهر في عرض «صور» وخلفية «بطاقات».'
              : 'The URL must start with https:// or /. Shown in the "Photos" layout and as "Cards" backgrounds.'}
          </p>
        </div>
      </details>
    </div>
  );
};
