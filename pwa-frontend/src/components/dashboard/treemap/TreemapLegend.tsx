import { interpolateRdYlGn } from 'd3-scale-chromatic';

interface TreemapLegendProps {
  updatedAt: string;
}

const STOPS = 11;

export function TreemapLegend({ updatedAt }: TreemapLegendProps) {
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    : '---';

  const gradientStops = Array.from({ length: STOPS }, (_, i) => {
    const t = i / (STOPS - 1);
    return interpolateRdYlGn(t);
  });
  const gradient = `linear-gradient(to right, ${gradientStops.join(', ')})`;

  return (
    <div className="flex items-center gap-3 px-4 py-1 text-xs text-slate-500">
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 rounded-sm bg-slate-300" />
        <span>未着手</span>
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span>苦手</span>
        <div
          className="flex-1 h-3 rounded-sm border border-slate-200"
          style={{ background: gradient }}
        />
        <span>得意</span>
      </div>
      <span className="text-slate-400 flex-shrink-0">最終更新: {updatedLabel}</span>
    </div>
  );
}
