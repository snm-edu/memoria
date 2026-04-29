interface TreemapBreadcrumbProps {
  segments: string[];
  onSegmentClick?: (index: number) => void;
}

export function TreemapBreadcrumb({ segments, onSegmentClick }: TreemapBreadcrumbProps) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 text-sm text-slate-500 overflow-x-auto whitespace-nowrap">
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
  );
}
