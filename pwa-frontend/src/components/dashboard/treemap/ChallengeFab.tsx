import type { FocusPath } from './treemapTypes';

interface ChallengeFabProps {
  focusPath: FocusPath;
  totalQuestions: number;
  weakCount: number;
  onChallenge: () => void;
}

function scopeLabel(focusPath: FocusPath): string {
  if (focusPath.length === 0) return '全範囲を解く';
  const last = focusPath[focusPath.length - 1];
  return `「${last}」を解く`;
}

export function ChallengeFab({
  focusPath,
  totalQuestions,
  weakCount,
  onChallenge,
}: ChallengeFabProps) {
  const label = scopeLabel(focusPath);
  const subLabel = `${totalQuestions}問 · 苦手${weakCount}問`;

  return (
    <div className="fixed bottom-16 left-0 right-0 px-4 pointer-events-none z-10">
      <div className="max-w-lg mx-auto pointer-events-auto">
        <button
          type="button"
          onClick={onChallenge}
          className="w-full bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl py-3 px-4 shadow-lg active:scale-95 transition-transform"
        >
          <div className="text-base font-bold">🎯 {label}</div>
          <div className="text-xs opacity-90 mt-0.5">{subLabel}</div>
        </button>
      </div>
    </div>
  );
}
