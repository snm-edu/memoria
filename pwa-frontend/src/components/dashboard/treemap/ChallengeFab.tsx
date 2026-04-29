import type { FocusPath } from './treemapTypes';

interface ChallengeFabProps {
  focusPath: FocusPath;
  onChallenge: () => void;
}

/**
 * ヘッダー右上に置く状態遷移ボタン。
 * - 未選択 (focusPath が空): グレー無効「分野をタップ」
 * - 選択あり: ブルー有効「『◯◯』を解く」(長い分野名は truncate)
 * 数値情報 (totalQuestions, weakCount) はパンくず行に表示する。
 */
export function ChallengeFab({ focusPath, onChallenge }: ChallengeFabProps) {
  const isSelected = focusPath.length > 0;

  if (!isSelected) {
    return (
      <button
        type="button"
        disabled
        className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-400 text-xs font-bold border border-dashed border-slate-300 cursor-not-allowed flex-shrink-0"
      >
        分野をタップ
      </button>
    );
  }

  const lastSeg = focusPath[focusPath.length - 1];
  return (
    <button
      type="button"
      onClick={onChallenge}
      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-primary-500 to-primary-600 text-white text-xs font-bold shadow-sm active:scale-95 transition-transform flex-shrink-0 max-w-[180px]"
    >
      <span className="truncate inline-block max-w-full align-middle">
        🎯「{lastSeg}」を解く
      </span>
    </button>
  );
}
