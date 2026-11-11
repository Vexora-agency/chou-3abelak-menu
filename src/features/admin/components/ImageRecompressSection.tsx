import React, { useEffect, useRef, useState } from 'react';
import { ImageDown, Loader2, Square } from 'lucide-react';
import type { MenuData } from '@/src/types/menu';
import {
  decodeSourceImage,
  exportResponsiveSet,
  UploadError,
  uploadVariantSet,
} from '@/src/lib/image-upload';
import { SettingsGroupBody, SettingsGroupHeader } from './SettingsCollapsible';

interface ImageRecompressSectionProps {
  menu: MenuData;
  lang: 'en' | 'ar';
  onUpdateMenu: (updater: (prev: MenuData) => MenuData) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

type RunStatus = 'idle' | 'running' | 'stopped' | 'rate_limited' | 'done';

/** Same-origin uploads only (the crop pipeline's own files) — external
 *  URLs are left untouched. Mirrors the GC's reference rule: internal means
 *  the /api/images/ path the uploader itself minted. */
const isInternalImage = (url: unknown): url is string =>
  typeof url === 'string' && url.startsWith('/api/images/');

// Gentle pacing between items: every item uploads up to 3 files (full+s+m)
// against the 120-uploads/10-min gate, so a breath between items keeps a big
// menu from tripping it mid-run.
const BETWEEN_ITEMS_MS = 250;

/**
 * One-shot maintenance: re-exports every internal dish photo (full + s + m)
 * at the current encoder qualities and re-uploads the set, so older photos
 * shrink to the new ~20-30% smaller files. Reuses the exact upload path the
 * crop editor uses (decode → full-frame exportResponsiveSet → uploadVariantSet)
 * — no parallel logic. Already-done items are skipped on resume (in-session),
 * a stop button aborts safely, and a 429 ends the run keeping what saved
 * (autosave persists each item as it lands).
 */
export const ImageRecompressSection: React.FC<ImageRecompressSectionProps> = ({
  menu,
  lang,
  onUpdateMenu,
  collapsed = false,
  onToggleCollapse,
}) => {
  const isAr = lang === 'ar';
  const [status, setStatus] = useState<RunStatus>('idle');
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [current, setCurrent] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  // Items finished earlier in this session — a resume run skips them instead
  // of re-uploading identical files.
  const doneIdsRef = useRef<Set<string>>(new Set());

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const pending = menu.items.filter((i) => isInternalImage(i.imageUrl) && !doneIdsRef.current.has(i.id));

  const stop = () => {
    abortRef.current?.abort();
  };

  const start = async () => {
    if (pending.length === 0) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('running');
    setDone(0);
    setSkipped(0);
    setTotal(pending.length);
    setCurrent('');
    let finished = 0;
    let skippedCount = 0;

    for (const item of pending) {
      if (controller.signal.aborted) break;
      const label = isAr ? item.name.ar || item.name.en : item.name.en || item.name.ar;
      setCurrent(label);
      try {
        // Re-download the stored full file and run it through the standard
        // pipeline as a full-frame "crop" (stored photos are 16:10 crops, so
        // the full frame IS the framing — dimensions come out unchanged).
        const res = await fetch(item.imageUrl as string, { signal: controller.signal });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], 'recompress', { type: blob.type || 'image/webp' });
        const decoded = await decodeSourceImage(file);
        try {
          const set = await exportResponsiveSet(decoded.source, {
            x: 0,
            y: 0,
            w: decoded.width,
            h: decoded.height,
          });
          const uploaded = await uploadVariantSet(set, { signal: controller.signal });
          const imageVariants: { s?: string; m?: string } = {};
          if (uploaded.s?.url) imageVariants.s = uploaded.s.url;
          if (uploaded.m?.url) imageVariants.m = uploaded.m.url;
          const fullUrl = uploaded.full.url;
          const hasVariants = Object.keys(imageVariants).length > 0;
          onUpdateMenu((m) => ({
            ...m,
            items: m.items.map((it) => {
              if (it.id !== item.id) return it;
              const { imageUrl: _old, ...rest } = it;
              void _old;
              const { imageVariants: _prev, ...restNoVariants } = rest;
              void _prev;
              return hasVariants
                ? { ...restNoVariants, imageUrl: fullUrl, imageVariants }
                : { ...restNoVariants, imageUrl: fullUrl };
            }),
          }));
        } finally {
          decoded.close();
        }
        doneIdsRef.current.add(item.id);
        finished += 1;
        setDone(finished);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof UploadError && error.code === 'aborted')) break;
        // Upload gate tripped: stop safely, keep everything saved so far —
        // the owner waits ~10 minutes and resumes; done items are skipped.
        if (error instanceof UploadError && error.code === 'rate_limited') {
          setStatus('rate_limited');
          setCurrent('');
          abortRef.current = null;
          return;
        }
        console.warn('[image-recompress] item skipped.', item.id, error);
        skippedCount += 1;
        setSkipped(skippedCount);
      }
      if (controller.signal.aborted) break;
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, BETWEEN_ITEMS_MS);
        controller.signal.addEventListener('abort', () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }

    abortRef.current = null;
    setCurrent('');
    setStatus(controller.signal.aborted ? 'stopped' : 'done');
  };

  const running = status === 'running';
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800">
      <SettingsGroupHeader
        title={isAr ? 'ضغط الصور القديمة' : 'Recompress Old Photos'}
        subtitle={
          isAr
            ? 'يعيد توليد نسخ (full+s+m) كل صور الأصناف الداخلية بالجودة الجديدة — توفير ~20-30% من الحجم بفرق بصري طفيف.'
            : 'Regenerates full+s+m for every internal dish photo at the new quality — ~20-30% smaller files, tiny visual difference.'
        }
        lang={lang}
        collapsed={collapsed}
        onToggle={() => onToggleCollapse?.()}
      />
      <SettingsGroupBody open={!collapsed}>
        <p className="text-[11px] leading-relaxed text-neutral-500">
          {isAr
            ? `الأصناف ذات الصور الداخلية: ${pending.length} — كل صنف يُحفظ تلقائيًا فور انتهائه، والإيقاف أو حد الرفع يُبقي ما تم.`
            : `Items with internal photos: ${pending.length} — each item auto-saves when done; stopping or hitting the upload limit keeps what finished.`}
        </p>
        {running ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-bold text-white">
              <Loader2 size={14} className="animate-spin text-[var(--primary)]" aria-hidden="true" />
              <span aria-live="polite">
                {isAr ? `جاري الضغط ${done}/${total}` : `Recompressing ${done}/${total}`}
                {current ? ` — ${current}` : ''}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={isAr ? 'تقدم ضغط الصور' : 'Recompress progress'}
              className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
            >
              <div
                className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300"
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={stop}
              className="h-11 min-h-[44px] px-5 rounded-full bg-black border border-neutral-700 text-xs font-extrabold hover:border-red-400/60 flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <Square size={14} />
              {isAr ? 'إيقاف' : 'Stop'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending.length === 0}
              onClick={() => void start()}
              className="h-11 min-h-[44px] px-5 rounded-full bg-[var(--primary)] text-[#0A0A0A] text-xs font-extrabold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ImageDown size={15} />
              {doneIdsRef.current.size > 0 && pending.length > 0
                ? isAr
                  ? `استكمال الضغط (${pending.length})`
                  : `Resume recompress (${pending.length})`
                : isAr
                  ? 'ضغط الصور القديمة'
                  : 'Recompress old photos'}
            </button>
            {status === 'done' && (
              <span className="text-[11px] font-bold text-emerald-400" role="status">
                {isAr
                  ? `تم: ${done} من ${total}${skipped > 0 ? ` — تُخطي: ${skipped}` : ''}`
                  : `Done: ${done} of ${total}${skipped > 0 ? ` — skipped: ${skipped}` : ''}`}
              </span>
            )}
            {status === 'stopped' && (
              <span className="text-[11px] font-bold text-amber-300" role="status">
                {isAr
                  ? `توقف عند ${done} من ${total} — ما تم محفوظ، ويمكن الاستكمال.`
                  : `Stopped at ${done} of ${total} — progress kept, resume anytime.`}
              </span>
            )}
            {status === 'rate_limited' && (
              <span className="text-[11px] font-bold text-amber-300" role="alert">
                {isAr
                  ? `توقف حد الرفع عند ${done} من ${total} — استنى ~10 دقايق من غير رفع ثم استكمل (ما تم محفوظ).`
                  : `Upload limit hit at ${done} of ${total} — wait ~10 min without uploading, then resume (progress kept).`}
              </span>
            )}
            {status === 'idle' && pending.length === 0 && (
              <span className="text-[11px] text-neutral-500" role="status">
                {isAr ? 'لا توجد صور داخلية تحتاج ضغطًا.' : 'No internal photos need recompressing.'}
              </span>
            )}
          </div>
        )}
      </SettingsGroupBody>
    </div>
  );
};
