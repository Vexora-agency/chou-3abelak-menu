import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Images, Loader2, OctagonX, Square } from 'lucide-react';
import type { MenuData } from '@/src/types/menu';
import {
  ImagePrepareError,
  UploadError,
  decodeSourceImage,
  uploadItemImage,
  variantsFromBitmap,
} from '@/src/lib/image-upload';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

interface ImageOptimizeSectionProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  onUpdateMenu: (updater: (prev: MenuData) => MenuData) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/** Pause between two uploads so the server rate limit (60 / 10 min) is not hit in bursts. */
const UPLOAD_GAP_MS = 800;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Internal uploads only — external links are never fetched or touched. */
const isInternalImage = (url?: string): boolean => !!url && url.startsWith('/api/images/');

interface Failure {
  name: string;
  reason: string;
}

interface Summary {
  total: number;
  succeeded: number;
  tooSmall: number;
  failures: Failure[];
  stoppedEarly: boolean;
  rateLimited: boolean;
}

function errorCodeOf(error: unknown): string {
  if (error instanceof ImagePrepareError || error instanceof UploadError) return error.code;
  if (error instanceof Error && error.message) return error.message;
  return 'upload_failed';
}

function errorText(code: string, isAr: boolean): string {
  const messages: Record<string, { ar: string; en: string }> = {
    fetch_failed: {
      ar: 'تعذر تحميل الصورة من الخادم.',
      en: 'Could not download the photo from the server.',
    },
    decode_failed: {
      ar: 'تعذر قراءة الصورة.',
      en: 'Could not read the photo.',
    },
    unsupported_type: {
      ar: 'نوع الملف غير مدعوم (JPG / PNG / WebP فقط).',
      en: 'Unsupported file type (JPG / PNG / WebP only).',
    },
    encode_failed: {
      ar: 'فشل تجهيز النسخ المصغرة.',
      en: 'Failed to prepare the smaller copies.',
    },
    too_large: {
      ar: 'الصورة كبيرة جدًا حتى بعد الضغط.',
      en: 'The photo is too large even after resizing.',
    },
    network: {
      ar: 'انقطع الاتصال أثناء الرفع.',
      en: 'The connection dropped during upload.',
    },
    upload_failed: {
      ar: 'فشل الرفع.',
      en: 'Upload failed.',
    },
  };
  const entry = messages[code] || messages.upload_failed;
  return isAr ? entry.ar : entry.en;
}

/** One-shot backfill: turns old internal item photos (full-size only, no
 *  imageVariants) into responsive 400w/800w copies. Nothing is deleted, no
 *  file is re-picked — each photo is downloaded, downscaled in the browser
 *  and re-uploaded as variants, then the item is updated in place. */
export const ImageOptimizeSection: React.FC<ImageOptimizeSectionProps> = ({
  menu,
  lang,
  onUpdateMenu,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; name: string } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const stopRef = useRef(false);

  // Eligible = internal photo with s AND m both missing. External URLs and
  // already-optimized items are never touched.
  const targets = menu.items.filter(
    (item) => isInternalImage(item.imageUrl) && !(item.imageVariants?.s && item.imageVariants?.m),
  );

  const commitVariant = (itemId: string, key: 's' | 'm', url: string) => {
    onUpdateMenu((m) => ({
      ...m,
      items: m.items.map((it) =>
        it.id === itemId ? { ...it, imageVariants: { ...(it.imageVariants || {}), [key]: url } } : it,
      ),
    }));
  };

  const run = async () => {
    if (running || targets.length === 0) return;
    const list = [...targets];
    const ok = isAr
      ? `سيتم تحسين ${list.length} صورة: تُحمَّل كل صورة ثم تُرفع نسختاها (400 و800) وتُحدَّث الأصناف فورًا. لن يُحذف أي شيء. متابعة؟`
      : `This will optimize ${list.length} photos: each is downloaded, re-uploaded as 400/800 copies and items update immediately. Nothing is deleted. Continue?`;
    if (!window.confirm(ok)) return;

    stopRef.current = false;
    setRunning(true);
    setSummary(null);
    let succeeded = 0;
    let tooSmall = 0;
    const failures: Failure[] = [];
    let stoppedEarly = false;
    let rateLimited = false;

    try {
      for (let idx = 0; idx < list.length; idx += 1) {
        if (stopRef.current) {
          stoppedEarly = true;
          break;
        }
        const item = list[idx];
        const name = (isAr ? item.name.ar : item.name.en) || item.name.en || item.id;
        setProgress({ index: idx + 1, total: list.length, name });
        try {
          // 1. Download the stored full-size photo.
          let blob: Blob;
          try {
            const res = await fetch(item.imageUrl as string);
            if (!res.ok) throw new Error('fetch_failed');
            blob = await res.blob();
          } catch {
            throw new Error('fetch_failed');
          }
          // 2. Decode (reuse the phone-pipeline decoder via a File wrapper).
          const file = new File([blob], 'optimize', { type: blob.type || 'image/jpeg' });
          const decoded = await decodeSourceImage(file);
          let prepared: { s?: { blob: Blob }; m?: { blob: Blob } };
          try {
            prepared = await variantsFromBitmap(decoded.source, decoded.width, decoded.height);
          } finally {
            decoded.close();
          }
          // 3. Skip photos too small to downscale (no upscale, no near-dupes).
          const needS = !item.imageVariants?.s && prepared.s;
          const needM = !item.imageVariants?.m && prepared.m;
          if (!needS && !needM) {
            tooSmall += 1;
            continue;
          }
          // 4. Upload sequentially (~800ms apart), committing each copy
          //    to the item immediately so progress survives any stop.
          if (needS) {
            const up = await uploadItemImage(needS.blob);
            commitVariant(item.id, 's', up.url);
            await sleep(UPLOAD_GAP_MS);
          }
          if (stopRef.current) {
            stoppedEarly = true;
            break;
          }
          if (needM) {
            const up = await uploadItemImage(needM.blob);
            commitVariant(item.id, 'm', up.url);
            if (idx < list.length - 1) await sleep(UPLOAD_GAP_MS);
          }
          succeeded += 1;
        } catch (error) {
          if (error instanceof UploadError && (error.code === 'rate_limited' || error.status === 429)) {
            rateLimited = true;
            stoppedEarly = true;
            break;
          }
          failures.push({ name, reason: errorText(errorCodeOf(error), isAr) });
        }
      }
    } finally {
      setProgress(null);
      setRunning(false);
      setSummary({ total: list.length, succeeded, tooSmall, failures, stoppedEarly, rateLimited });
    }
  };

  const pct = progress ? Math.round((progress.index / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'تحسين الصور القديمة' : 'Optimize old photos'}
        subtitle={isAr
          ? 'يحوّل صور الأصناف الداخلية القديمة إلى نسخ متجاوبة (400 و800) دون حذف أي شيء ودون إعادة اختيار الملفات.'
          : 'Turns old internal item photos into responsive (400/800) copies without deleting anything or re-picking files.'}
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
        <p className="text-[11px] leading-relaxed text-neutral-500">
          {isAr
            ? 'تُستهدف فقط الصور الداخلية (/api/images/…) التي لا تملك نسخًا بعد. الروابط الخارجية والأصناف المحسّنة تُتخطى تلقائيًا، وكل صنف يُحدَّث فور انتهائه.'
            : 'Only internal photos (/api/images/…) without variants yet are targeted. External links and optimized items are skipped automatically; each item updates as soon as it finishes.'}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || targets.length === 0}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--primary)] px-4 text-sm font-bold text-[#0A0A0A] disabled:opacity-40"
          >
            {running ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Images size={15} aria-hidden="true" />}
            {isAr ? `تحسين الصور (${targets.length})` : `Optimize photos (${targets.length})`}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => {
                stopRef.current = true;
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-black px-4 text-sm font-bold text-neutral-200 ring-1 ring-neutral-700"
            >
              <Square size={13} aria-hidden="true" />
              {isAr ? 'إيقاف' : 'Stop'}
            </button>
          )}
          {!running && targets.length === 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <CheckCircle2 size={14} aria-hidden="true" />
              {isAr ? 'كل الصور الداخلية محسّنة بالفعل.' : 'All internal photos are already optimized.'}
            </span>
          )}
        </div>

        {progress && (
          <div className="space-y-1.5" aria-live="polite">
            <p className="text-xs font-bold text-white">
              {isAr
                ? `جاري التحسين ${progress.index} / ${progress.total} — ${progress.name}`
                : `Optimizing ${progress.index} / ${progress.total} — ${progress.name}`}
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={isAr ? 'تقدم تحسين الصور' : 'Photo optimization progress'}
              className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
            >
              <div className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {summary && !running && (
          <div className="space-y-2 rounded-xl border border-neutral-800 bg-black/40 p-3" aria-live="polite">
            <p className="flex items-start gap-1.5 text-xs font-bold text-white">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
              <span>
                {isAr
                  ? `انتهى التحسين: نجح ${summary.succeeded} من ${summary.total}`
                  : `Optimization finished: ${summary.succeeded} of ${summary.total} succeeded`}
                {summary.tooSmall > 0 && (isAr ? ` — تُخطي ${summary.tooSmall} (صغيرة جدًا)` : ` — ${summary.tooSmall} skipped (too small)`)}
                {summary.failures.length > 0 && (isAr ? ` — فشل ${summary.failures.length}` : ` — ${summary.failures.length} failed`)}
              </span>
            </p>
            {summary.rateLimited && (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-400">
                <OctagonX size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {isAr
                    ? 'توقفنا بسبب حد الرفع (60 رفع / 10 دقائق) — التقدم محفوظ، أكمل لاحقًا من نفس الزر.'
                    : 'Stopped on the upload rate limit (60 uploads / 10 min) — progress is kept, continue later from the same button.'}
                </span>
              </p>
            )}
            {summary.stoppedEarly && !summary.rateLimited && (
              <p className="text-xs text-neutral-400">
                {isAr ? 'توقفت قبل النهاية — التقدم محفوظ، أكمل لاحقًا.' : 'Stopped before the end — progress is kept, continue later.'}
              </p>
            )}
            {summary.failures.length > 0 && (
              <ul className="space-y-1">
                {summary.failures.map((f) => (
                  <li key={f.name} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-red-400">
                    <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{f.name} — {f.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {(summary.succeeded > 0 || summary.stoppedEarly || summary.rateLimited) && (
              <p className="text-[11px] leading-relaxed text-neutral-500">
                {isAr
                  ? 'الأصناف المحدّثة تُحفظ تلقائيًا خلال ثوانٍ — إن كان الحفظ التلقائي متوقفًا عندك، اضغط «حفظ» في الأعلى.'
                  : 'Updated items auto-save within seconds — if you turned auto-save off, press “Save” at the top.'}
              </p>
            )}
          </div>
        )}
      </SettingsGroupBody>
    </div>
  );
};
