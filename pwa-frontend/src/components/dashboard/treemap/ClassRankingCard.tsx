// pwa-frontend/src/components/dashboard/treemap/ClassRankingCard.tsx
// 弱点マップ画面の上部に表示する同学年比較カード (メーター型)

import type { MyRankingPayload, RankBand } from '../../../services/rankingApi';

const BAND_INFO: Record<RankBand, { label: string; emoji: string; pillClass: string }> = {
  top:        { label: 'トップ層', emoji: '🏆', pillClass: 'bg-amber-100 text-amber-700' },
  upper:      { label: '上位',     emoji: '↑',  pillClass: 'bg-blue-100 text-blue-700' },
  middle:     { label: '中位',     emoji: '→',  pillClass: 'bg-slate-100 text-slate-600' },
  developing: { label: '育成中',   emoji: '🌱', pillClass: 'bg-emerald-100 text-emerald-700' },
};

interface ClassRankingCardProps {
  ranking: MyRankingPayload;
}

export function ClassRankingCard({ ranking }: ClassRankingCardProps) {
  if (!ranking.available || !ranking.rankBand || ranking.myPercentile == null) {
    return null;
  }

  const band = BAND_INFO[ranking.rankBand];
  // percentile が小さいほど上位 → メーター上は右寄り
  const markerLeftPct = Math.min(99, Math.max(1, 100 - ranking.myPercentile));

  return (
    <div className="mx-4 my-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-slate-500">
          📊 同学年比較 ({ranking.cohortName})
        </span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${band.pillClass}`}>
          {band.emoji} {band.label}
        </span>
      </div>
      <div className="relative h-2 bg-gradient-to-r from-rose-200 via-amber-200 to-emerald-300 rounded-full">
        <div
          className="absolute top-1/2 w-3 h-3 rounded-full bg-slate-700 border-2 border-white shadow"
          style={{
            left: `${markerLeftPct}%`,
            transform: 'translate(-50%, -50%)',
          }}
          aria-label={`同学年内 上位${ranking.myPercentile}%`}
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>育成中</span>
        <span>中位</span>
        <span>上位</span>
      </div>
    </div>
  );
}
