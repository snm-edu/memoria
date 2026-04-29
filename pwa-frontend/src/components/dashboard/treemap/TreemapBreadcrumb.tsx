interface TreemapBreadcrumbProps {
  segments: string[];
  onSegmentClick?: (index: number) => void;
  totalQuestions?: number;
  weakCount?: number;
}

export function TreemapBreadcrumb({
  segments,
  onSegmentClick,
  totalQuestions,
  weakCount,
}: TreemapBreadcrumbProps) {
  const showCount = typeof totalQuestions === 'number';

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-slate-500 whitespace-nowrap">
      <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          const clickable = !isLast && !!onSegmentClick;
          return (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-slate-300">/</span>}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSegmentClick(i)}
                className={
                  isLast
                    ? 'font-bold text-slate-700'
                    : clickable
                    ? 'text-slate-500 hover:text-primary-500 active:text-primary-600'
                    : 'text-slate-500'
                }
              >
                {seg}
              </button>
            </span>
          );
        })}
      </div>
      {showCount && (
        <div className="text-xs text-slate-400 flex-shrink-0">
          {totalQuestions}問
          {typeof weakCount === 'number' && weakCount > 0 && (
            <span className="text-red-400 ml-1">· 苦手{weakCount}</span>
          )}
        </div>
      )}
    </div>
  );
}
