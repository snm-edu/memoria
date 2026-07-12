import type { ErrorAnalysis } from '../../types';

const ERROR_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  knowledge_gap: { label: '知識不足', color: 'bg-blue-100 text-blue-700' },
  misread: { label: '読み違い', color: 'bg-amber-100 text-amber-700' },
  confusion: { label: '概念混同', color: 'bg-purple-100 text-purple-700' },
};

interface Props {
  analysis: ErrorAnalysis;
  onClose: () => void;
  /** 類題生成を起動する（未指定なら挑戦ボタンを出さない） */
  onChallenge?: () => void;
  /** 類題生成の進行状態 */
  challengeStatus?: 'idle' | 'loading' | 'added' | 'error';
}

export function AnalysisCard({ analysis, onClose, onChallenge, challengeStatus = 'idle' }: Props) {
  const errorInfo = ERROR_TYPE_LABELS[analysis.error_type] || {
    label: '分析',
    color: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg">AI分析</h3>
        <span className={`text-xs px-2 py-1 rounded-full font-bold ${errorInfo.color}`}>
          {errorInfo.label}
        </span>
      </div>

      {analysis.cheer && (
        <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg">
          <p className="text-sm leading-relaxed text-amber-900">{analysis.cheer}</p>
        </div>
      )}

      <div>
        <p className="text-sm text-slate-500 mb-1">なぜ間違えやすいか</p>
        <p className="text-sm leading-relaxed">{analysis.analysis}</p>
      </div>

      <div>
        <p className="text-sm text-slate-500 mb-1">ここだけ覚えよう</p>
        <p className="text-sm font-medium text-primary-600">{analysis.key_concept}</p>
      </div>

      <div className="bg-blue-50 p-3 rounded-lg">
        <p className="text-sm text-slate-500 mb-1">次への作戦</p>
        <p className="text-sm leading-relaxed">{analysis.study_hint}</p>
      </div>

      {onChallenge && challengeStatus === 'idle' && (
        <button onClick={onChallenge} className="btn-primary w-full">
          この弱点の類題に挑戦 →
        </button>
      )}
      {challengeStatus === 'loading' && (
        <p className="text-sm text-blue-600 text-center animate-pulse">
          {'\u{1F916}'} 類題を用意しています...
        </p>
      )}
      {challengeStatus === 'added' && (
        <p className="text-sm text-green-600 text-center font-medium">
          {'✅'} 類題を次の問題に追加しました。「次の問題へ」で挑戦できます
        </p>
      )}
      {challengeStatus === 'error' && (
        <p className="text-sm text-slate-500 text-center">
          類題を用意できませんでした。また後で試してください
        </p>
      )}

      <button onClick={onClose} className="btn-secondary w-full">
        閉じる
      </button>
    </div>
  );
}
