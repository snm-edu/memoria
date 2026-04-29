import { interpolateRdYlGn } from 'd3-scale-chromatic';
import type { TreemapLeaf } from './treemapTypes';

interface LeafDetailSheetProps {
  leaf: TreemapLeaf;
  pathLabel: string;
  onClose: () => void;
  onChallenge: (scope: 'all' | 'weak' | 'unstudied') => void;
  onExpandAggregate?: () => void;
}

function leafColor(leaf: TreemapLeaf): string {
  if (leaf.confidence === 'none' || leaf.correctRate === null) return '#cbd5e1';
  return interpolateRdYlGn(leaf.correctRate / 100);
}

export function LeafDetailSheet({
  leaf,
  pathLabel,
  onClose,
  onChallenge,
  onExpandAggregate,
}: LeafDetailSheetProps) {
  const isAggregate = !!leaf.isAggregate;
  const dateLabel = leaf.lastDate
    ? new Date(leaf.lastDate).toLocaleDateString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
      })
    : '---';

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-end z-30"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-4 h-4 rounded-sm flex-shrink-0 mt-1"
            style={{ backgroundColor: leafColor(leaf) }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 truncate">{pathLabel}</p>
            <p className="text-lg font-bold text-slate-700">{leaf.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">
            ×
          </button>
        </div>

        {!isAggregate && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-400">出題数</p>
              <p className="text-base font-bold">{leaf.totalQuestions}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-400">解答数</p>
              <p className="text-base font-bold">{leaf.answered}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-400">正答率</p>
              <p className="text-base font-bold">
                {leaf.correctRate !== null ? `${leaf.correctRate}%` : '—'}
              </p>
            </div>
          </div>
        )}

        {!isAggregate && (
          <p className="text-xs text-slate-400 mb-4">最終学習日: {dateLabel}</p>
        )}

        {isAggregate && (
          <p className="text-sm text-slate-600 mb-4">
            この中分類には未着手の小分類が {leaf.aggregateLeaves?.length ?? 0} 件あります。
          </p>
        )}

        <div className="space-y-2">
          {isAggregate ? (
            <>
              <button
                onClick={() => onExpandAggregate?.()}
                className="w-full bg-slate-100 text-slate-700 py-3 rounded-lg font-bold active:bg-slate-200"
              >
                個別に表示する
              </button>
              <button
                onClick={() => onChallenge('unstudied')}
                className="w-full bg-primary-500 text-white py-3 rounded-lg font-bold active:bg-primary-600"
              >
                未着手をまとめて解く ({leaf.totalQuestions}問)
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onChallenge('all')}
                className="w-full bg-primary-500 text-white py-3 rounded-lg font-bold active:bg-primary-600"
              >
                この分野を解く
              </button>
              {leaf.answered > 0 && (
                <button
                  onClick={() => onChallenge('weak')}
                  className="w-full bg-red-500 text-white py-3 rounded-lg font-bold active:bg-red-600"
                >
                  苦手だけ解く
                </button>
              )}
              {leaf.confidence === 'none' && (
                <button
                  onClick={() => onChallenge('unstudied')}
                  className="w-full bg-amber-500 text-white py-3 rounded-lg font-bold active:bg-amber-600"
                >
                  初挑戦する
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
