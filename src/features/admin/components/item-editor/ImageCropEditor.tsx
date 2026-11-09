import React, { useEffect, useRef, useState } from 'react';
import { Check, Minus, Plus, RotateCcw, X } from 'lucide-react';
import {
  CROP_MAX_ZOOM,
  CROP_MIN_ZOOM,
  clampZoom,
  panCropCenter,
  zoomedCropRect,
  type CropRect,
} from '@/src/lib/crop-math';

interface ImageCropEditorProps {
  source: ImageBitmap | HTMLImageElement;
  srcWidth: number;
  srcHeight: number;
  lang: 'en' | 'ar';
  onConfirm: (rect: CropRect) => void;
  onCancel: () => void;
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
  onConfirm,
  onCancel,
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

  // A new photo resets the framing (compare-and-adjust during render — the
  // endorsed pattern for prop-driven resets, no cascading effect).
  const [prevSource, setPrevSource] = useState(source);
  if (prevSource !== source) {
    setPrevSource(source);
    setZoom(CROP_MIN_ZOOM);
    setCenter({ cx: srcWidth / 2, cy: srcHeight / 2 });
  }

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

  const applyZoom = (next: number) => setZoom(clampZoom(next));

  const panBy = (dxPx: number, dyPx: number, viewportW: number) => {
    const v = viewRef.current;
    setCenter(panCropCenter(srcWidth, srcHeight, v.cx, v.cy, v.zoom, dxPx, dyPx, viewportW));
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
        <button
          type="button"
          onClick={() => {
            setZoom(CROP_MIN_ZOOM);
            setCenter({ cx: srcWidth / 2, cy: srcHeight / 2 });
          }}
          aria-label={isAr ? 'إعادة الضبط' : 'Reset crop'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-200 hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <p className="text-[10px] leading-relaxed text-neutral-500">
        {isAr
          ? 'اسحب الصورة لتحريكها وكبّر لاختيار الجزء الظاهر — اللي شايفه هنا هو اللي هيظهر للزباين.'
          : 'Drag to move, zoom to choose what shows — exactly what you see here is what customers get.'}
      </p>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onConfirm(zoomedCropRect(srcWidth, srcHeight, viewRef.current.cx, viewRef.current.cy, viewRef.current.zoom))}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-full bg-[var(--primary)] px-3 text-[12px] font-bold text-[#0A0A0A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Check size={14} aria-hidden="true" />
          {isAr ? 'استخدم القص ده' : 'Use this crop'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center gap-1 rounded-full bg-black/70 px-3 text-[12px] font-bold text-neutral-200 ring-1 ring-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
        >
          <X size={14} aria-hidden="true" />
          {isAr ? 'إلغاء' : 'Cancel'}
        </button>
      </div>
    </div>
  );
};
