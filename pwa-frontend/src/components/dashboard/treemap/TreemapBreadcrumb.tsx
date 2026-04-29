interface TreemapBreadcrumbProps {
  segments: string[];
}

export function TreemapBreadcrumb({ segments }: TreemapBreadcrumbProps) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 text-sm text-slate-500 overflow-x-auto whitespace-nowrap">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-300">/</span>}
          <span className={i === segments.length - 1 ? 'font-bold text-slate-700' : ''}>
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}
