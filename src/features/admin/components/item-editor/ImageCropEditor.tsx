import React, { useEffect, useRef, useState } from 'react';
import { Check, FlipHorizontal2, FlipVertical2, Loader2, Maximize, Minus, Plus, RotateCcw, RotateCw, X } from 'lucide-react';
import {
  CROP_MAX_ZOOM,
  CROP_MIN_ZOOM,
  clampZoom,
  panCropCenter,
  zoomedCropRect,
  type CropRect,
} from '@/src/lib/crop-math';

interface ImageCropEditorProps {
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  srcWidth: number;
  srcHeight: number;
  lang: 'en' | 'ar';
  /** Every framing change (pan, zoom, reset, rotate, flip) — the parent
   *  auto-saves, so there is deliberately no confirm button. */
  onCropChange: (rect: CropRect) => void;
  /** Rotate the photo ±90° (framing resets — width/height swap). */
  onRotate: (dir: 1 | -1) => void;
  /** Mirror the photo (dimensions unchanged — framing is kept). */
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  /** Collapse the editor (the last auto-save is kept). */
  onClose: () => void;
  /** Auto-save indicator state from the parent. */
  saveState: 'idle' | 'saving' | 'saved';
}

const ZOOM_STEP = 0.25;

/**
 * 16:10 crop editor for item photos. The frame matches the photo-card image
 * exactly, so what the admin sees here is what customers get — drag to pan,
 * slider/buttons to zoom, arrows keys work too when the frame is focused.
 */
export const ImageCropEditor: React.FC<ImageCropEditorProps> = ({
  source,
  srcWidth,
  srcHeight,
  lang,
  onCropChange,
  onRotate,
  onFlip,
  onClose,
  saveState,
}) => {
  const isAr = lang === 'ar';
  const [zoom, setZoom] = useState(CROP_MIN_ZOOM);
  const [center, setCenter] = useState({ cx: srcWidth / 2, cy: srcHeight / 2 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  // Handlers read the latest view without re-binding on every render (synced
  // in an effect — never assigned during render).
  const viewRef = useRef({ zoom, cx: center.cx, cy: center.cy });
  useEffect(() => {
    viewRef.current = { zoom, cx: center.cx, cy: center.cy };
  });
  // The parent auto-saves through this ref (stable identity — the
  // source-change effect below must not refire on parent re-renders).
  const cbRef = useRef(onCropChange);
  useEffect(() => {
    cbRef.current = onCropChange;
  });

  // A new photo (or a rotation) resets the framing. Keyed on dimensions —
  // flips keep the identity change but not the size, so zoom/pan survive a
  // mirror (compare-and-adjust during render, no cascading effect).
  const dimsKey = `${srcWidth}x${srcHeight}`;
  const [prevDims, setPrevDims] = useState(dimsKey);
  if (prevDims !== dimsKey) {
    setPrevDims(dimsKey);
    setZoom(CROP_MIN_ZOOM);
    setCenter({ cx: srcWidth / 2, cy: srcHeight / 2 });
  }

  // A swapped source means new pixels (rotated/mirrored photo): report the
  // current framing so it auto-saves. Skipped on first mount — the parent
  // saves the default framing itself when opening the editor.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const v = viewRef.current;
    cbRef.current(zoomedCropRect(srcWidth, srcHeight, v.cx, v.cy, v.zoom));
  }, [source, srcWidth, srcHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (!(cssW > 0) || !(cssH > 0)) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = zoomedCropRect(srcWidth, srcHeight, viewRef.current.cx, viewRef.current.cy, viewRef.current.zoom);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    } catch {
      // A torn-down bitmap (cancelled mid-draw) paints white; harmless.
    }
  }, [source, srcWidth, srcHeight, zoom, center]);

  const applyZoom = (next: number) => {
    const z = clampZoom(next);
    const v = viewRef.current;
    setZoom(z);
    cbRef.current(zoomedCropRect(srcWidth, srcHeight, v.cx, v.cy, z));
  };

  const panBy = (dxPx: number, dyPx: number, viewportW: number) => {
    const v = viewRef.current;
    const nc = panCropCenter(srcWidth, srcHeight, v.cx, v.cy, v.zoom, dxPx, dyPx, viewportW);
    setCenter(nc);
    cbRef.current(zoomedCropRect(srcWidth, srcHeight, nc.cx, nc.cy, v.zoom));
  };

  const resetView = () => {
    const c = { cx: srcWidth / 2, cy: srcHeight / 2 };
    setZoom(CROP_MIN_ZOOM);
    setCenter(c);
    cbRef.current(zoomedCropRect(srcWidth, srcHeight, c.cx, c.cy, CROP_MIN_ZOOM));
  };

  return (
    <div className="space-y-2">
      <div
        className="relative aspect-[16/10] w-full cursor-grab overflow-hidden rounded-lg border border-neutral-700 bg-black touch-none select-none active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        role="application"
        tabIndex={0}
        aria-label={isAr ? 'إطار قص الصورة — اسحب للتحريك وأسهم للتحريك الدقيق' : 'Photo crop frame — drag to move, arrow keys for fine moves'}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const last = dragRef.current;
          if (!last) return;
          const canvas = canvasRef.current;
          const viewportW = canvas ? canvas.clientWidth : 0;
          panBy(e.clientX - last.x, e.clientY - last.y, viewportW);
          dragRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onKeyDown={(e) => {
          const canvas = canvasRef.current;
          const viewportW = canvas ? canvas.clientWidth : 300;
          const step = Math.max(2, viewportW * 0.02);
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            panBy(-step, 0, viewportW);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            panBy(step, 0, viewportW);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            panBy(0, -step, viewportW);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            panBy(0, step, viewportW);
          } else if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            applyZoom(viewRef.current.zoom + ZOOM_STEP);
          } else if (e.key === '-' || e.key === '_') {
            e.preventDefault();
            applyZoom(viewRef.current.zoom - ZOOM_STEP);
          }
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {/* Rule-of-thirds guides for framing the dish. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/25" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/25" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/25" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/25" />
        </div>
        {/* Collapse the editor — the last auto-save is kept. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={isAr ? 'إغلاق محرر الصورة (الصورة محفوظة)' : 'Close photo editor (photo is saved)'}
          className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-neutral-200 hover:bg-black/90 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-2" dir="ltr">
        <button
          type="button"
          onClick={() => applyZoom(viewRef.current.zoom - ZOOM_STEP)}
          disabled={zoom <= CROP_MIN_ZOOM}
          aria-label={isAr ? 'تصغير' : 'Zoom out'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <Minus size={14} />
        </button>
        <input
          type="range"
          min={CROP_MIN_ZOOM}
          max={CROP_MAX_ZOOM}
          step={0.05}
          value={zoom}
          onChange={(e) => applyZoom(Number(e.target.value))}
          aria-label={isAr ? 'مستوى التقريب' : 'Zoom level'}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-neutral-800 accent-[var(--primary)]"
        />
        <button
          type="button"
          onClick={() => applyZoom(viewRef.current.zoom + ZOOM_STEP)}
          disabled={zoom >= CROP_MAX_ZOOM}
          aria-label={isAr ? 'تكبير' : 'Zoom in'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <Plus size={14} />
        </button>
        <span className="w-11 shrink-0 text-center text-[11px] font-bold tabular-nums text-neutral-300">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Rotate / mirror / reset row. Wraps on narrow phones. */}
      <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
        <button
          type="button"
          onClick={() => onRotate(-1)}
          aria-label={isAr ? 'تدوير 90 درجة عكس عقارب الساعة' : 'Rotate 90° counter-clockwise'}
          title={isAr ? 'تدوير شمال' : 'Rotate left'}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-800 px-3 text-[11px] font-bold text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <RotateCcw size={14} aria-hidden="true" />
          90°
        </button>
        <button
          type="button"
          onClick={() => onRotate(1)}
          aria-label={isAr ? 'تدوير 90 درجة مع عقارب الساعة' : 'Rotate 90° clockwise'}
          title={isAr ? 'تدوير يمين' : 'Rotate right'}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-800 px-3 text-[11px] font-bold text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <RotateCw size={14} aria-hidden="true" />
          90°
        </button>
        <button
          type="button"
          onClick={() => onFlip('horizontal')}
          aria-label={isAr ? 'عكس الصورة أفقيًا (اليمين يبقى شمال)' : 'Mirror photo horizontally (right becomes left)'}
          title={isAr ? 'عكس أفقي' : 'Flip horizontal'}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-800 px-3 text-[11px] font-bold text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <FlipHorizontal2 size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onFlip('vertical')}
          aria-label={isAr ? 'عكس الصورة رأسيًا (فوق يبقى تحت)' : 'Mirror photo vertically (top becomes bottom)'}
          title={isAr ? 'عكس رأسي' : 'Flip vertical'}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-800 px-3 text-[11px] font-bold text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <FlipVertical2 size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={resetView}
          aria-label={isAr ? 'إعادة الضبط للإطار الكامل' : 'Reset to full frame'}
          title={isAr ? 'إعادة الضبط' : 'Reset'}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-neutral-800 px-3 text-[11px] font-bold text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <Maximize size={14} aria-hidden="true" />
          {isAr ? 'كامل الصورة' : 'Full photo'}
        </button>
      </div>

      <p className="text-[10px] leading-relaxed text-neutral-500">
        {isAr
          ? 'اسحب الصورة لتحريكها وكبّر لاختيار الجزء الظاهر، ودوّرها إذا ظهرت مقلوبة — يُحفظ أي تعديل تلقائيًا.'
          : 'Drag to move, zoom to choose what shows, rotate if sideways — every change saves automatically.'}
      </p>

      <div aria-live="polite" className="flex min-h-[18px] items-center gap-1.5 text-[10.5px] font-bold">
        {saveState === 'saving' ? (
          <>
            <Loader2 size={12} className="animate-spin text-[var(--primary)]" aria-hidden="true" />
            <span className="text-neutral-300">{isAr ? 'جاري الحفظ تلقائيًا…' : 'Auto-saving…'}</span>
          </>
        ) : saveState === 'saved' ? (
          <>
            <Check size={12} className="text-emerald-400" aria-hidden="true" />
            <span className="text-emerald-400">{isAr ? 'تم الحفظ تلقائيًا' : 'Saved automatically'}</span>
          </>
        ) : (
          <span className="text-neutral-500">{isAr ? 'يُحفظ أي تعديل تلقائيًا' : 'Every change saves by itself'}</span>
        )}
      </div>
    </div>
  );
};
