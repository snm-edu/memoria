interface ChallengeFabProps {
  onChallenge: () => void;
}

/**
 * ヘッダー右上に置く小さな丸 FAB。タップで現在スコープのクイズを開始する。
 * スコープの数値情報 (totalQuestions, weakCount) は TreemapBreadcrumb 側で表示する。
 */
export function ChallengeFab({ onChallenge }: ChallengeFabProps) {
  return (
    <button
      type="button"
      onClick={onChallenge}
      aria-label="このスコープを解く"
      className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-md active:scale-95 transition-transform flex items-center justify-center"
    >
      <span className="text-lg leading-none">🎯</span>
    </button>
  );
}
