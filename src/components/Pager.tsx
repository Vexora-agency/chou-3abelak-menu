// Compact pager: ‹ prev · numbered buttons with ellipsis · next › + "Showing X–Y of Z"
export function Pager({
  page,
  pageCount,
  onChange,
  from,
  to,
  total,
  unit,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
  from: number;
  to: number;
  total: number;
  unit: string;
}) {
  if (pageCount <= 1) return null;
  const pages: (number | '…')[] = [];
  const push = (p: number) => {
    if (!pages.includes(p)) pages.push(p);
  };
  push(0);
  for (let p = page - 1; p <= page + 1; p++) if (p > 0 && p < pageCount - 1) push(p);
  if (pageCount > 1) push(pageCount - 1);
  pages.sort((a, b) => (a === '…' || b === '…' ? 0 : (a) - (b)));
  const withGaps: (number | '…')[] = [];
  pages.forEach((p, i) => {
    if (i > 0 && typeof p === 'number' && typeof pages[i - 1] === 'number' && (p) - (pages[i - 1] as number) > 1) withGaps.push('…');
    withGaps.push(p);
  });
  const btn = 'min-w-[32px] h-8 px-2 rounded-lg text-xs font-bold transition-colors';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <span className="text-[11px] text-neutral-500">
        {from}–{to} {unit} {total}
      </span>
      <div className="flex items-center gap-1" role="navigation" aria-label="Pagination">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          className={`${btn} bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-white disabled:opacity-30`}
          aria-label="Previous page"
        >
          ‹
        </button>
        {withGaps.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="text-neutral-600 text-xs px-1">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`${btn} ${
                p === page
                  ? 'bg-[var(--primary)] text-[#0A0A0A]'
                  : 'bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-white'
              }`}
            >
              {(p) + 1}
            </button>
          )
        )}
        <button
          type="button"
          disabled={page === pageCount - 1}
          onClick={() => onChange(page + 1)}
          className={`${btn} bg-neutral-900 border border-neutral-700 text-neutral-300 hover:text-white disabled:opacity-30`}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}
