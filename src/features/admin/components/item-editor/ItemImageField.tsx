import React, { useState } from 'react';
import { Image as ImageIcon, Link2, X } from 'lucide-react';
import type { MenuItem } from '@/src/types/menu';

interface ItemImageFieldProps {
  item: MenuItem;
  lang: 'en' | 'ar';
  onChange: (item: MenuItem) => void;
}

/** Accepts absolute http(s) URLs or root-relative paths, the only forms the
 *  server validator keeps. Data URLs are refused: the menu payload is capped
 *  at 256 KB, so an inline photo would break saving for the whole menu. */
const isValidImageUrl = (value: string): boolean => /^(https?:\/\/|\/)/i.test(value.trim());

/** Item photo URL + live preview (used by the "Photos" display layout). */
export const ItemImageField: React.FC<ItemImageFieldProps> = ({ item, lang, onChange }) => {
  const isAr = lang === 'ar';
  const value = item.imageUrl ?? '';
  const trimmed = value.trim();
  const valid = isValidImageUrl(trimmed);
  // `failedUrl` records WHICH url broke — editing the url retries the preview.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl !== null && failedUrl === trimmed;

  const setUrl = (next: string) => {
    const { imageUrl: _old, ...rest } = item;
    void _old;
    onChange(next.trim() ? { ...rest, imageUrl: next } : rest);
  };

  const showPreview = trimmed !== '' && valid && !failed;

  return (
    <div className="space-y-1.5">
      <label htmlFor="item-image-url" className="flex items-center gap-1.5 text-xs text-neutral-400">
        <ImageIcon size={13} className="text-[var(--primary)]" aria-hidden="true" />
        {isAr ? 'صورة الصنف (اختياري)' : 'Item photo (optional)'}
      </label>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
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
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/photo.jpg"
            aria-describedby="item-image-hint"
            className={`w-full h-10 ps-9 pe-9 rounded-lg bg-black border text-sm text-start ${
              trimmed !== '' && !valid ? 'border-red-500' : 'border-neutral-700'
            }`}
          />
          {value !== '' && (
            <button
              type="button"
              onClick={() => setUrl('')}
              aria-label={isAr ? 'إزالة الصورة' : 'Clear photo'}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-neutral-400 hover:text-white hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Preview: 16:10 matches the photo card frame, so what the owner sees
          here is exactly how the crop will land on the menu. */}
      {trimmed !== '' && (
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-neutral-800 bg-black">
          {showPreview ? (
            <img
              src={trimmed}
              alt={isAr ? 'معاينة صورة الصنف' : 'Item photo preview'}
              onError={() => setFailedUrl(trimmed)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center">
              <ImageIcon size={22} className="text-neutral-600" aria-hidden="true" />
              <span className="text-[11px] font-bold text-neutral-400">
                {failed
                  ? (isAr ? 'الصورة مش ظاهرة — تأكد من الرابط' : "Photo didn't load — check the URL")
                  : (isAr ? 'الرابط لازم يبدأ بـ https:// أو /' : 'URL must start with https:// or /')}
              </span>
              {failed && (
                <span className="text-[10px] text-neutral-500">
                  {isAr ? 'الصنف هيظهر بشعار القسم بدون صورة.' : 'The item will show the category mark instead.'}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <p id="item-image-hint" className="text-[10.5px] leading-relaxed text-neutral-500">
        {isAr
          ? 'الأفضل صورة أفقية (JPG أو WebP) بعرض 1200px تقريباً، ورابط عام يبدأ بـ https:// أو مسار يبدأ بـ /. بتظهر في عرض «صور» فقط.'
          : 'Best with a landscape JPG/WebP around 1200px wide, using a public https:// URL or a /-relative path. Shown in the "Photos" layout only.'}
      </p>
    </div>
  );
};
