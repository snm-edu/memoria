import type { FocusPath } from './treemapTypes';

interface ChallengeFabProps {
  focusPath: FocusPath;
  totalQuestions: number;
  weakCount: number;
  onChallenge: () => void;
}

/**
 * パンくず・凡例の直下に置くアクションバー。
 * - 未選択 (focusPath が空): グレー・無効・「マップから分野をタップして選ぼう」
 * - 選択あり: ブルー・有効・「『◯◯』を解く · ◯問 · 苦手◯問」
 */
export function ChallengeFab({
  focusPath,
  totalQuestions,
  weakCount,
  onChallenge,
}: ChallengeFabProps) {
  const isSelected = focusPath.length > 0;

  if (!isSelected) {
    return (
      <div className="px-4 py-2">
        <div className="w-full bg-slate-100 text-slate-400 rounded-xl py-3 px-4 text-center text-sm border border-dashed border-slate-300">
          🗺️ マップから分野をタップして選ぼう
        </div>
      </div>
    );
  }

  const lastSeg = focusPath[focusPath.length - 1];
  return (
    <div className="px-4 py-2">
      <button
        type="button"
        onClick={onChallenge}
        className="w-full bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl py-3 px-4 shadow-md active:scale-95 transition-transform"
      >
        <div className="text-base font-bold">🎯 「{lastSeg}」を解く</div>
        <div className="text-xs opacity-90 mt-0.5">
          {totalQuestions}問
          {weakCount > 0 && <span> · 苦手{weakCount}問</span>}
        </div>
      </button>
    </div>
  );
}
