import type { ErrorAnalysis } from '../../types';

const ERROR_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  knowledge_gap: { label: '知識不足', color: 'bg-blue-100 text-blue-700' },
  misread: { label: '読み違い', color: 'bg-amber-100 text-amber-700' },
  confusion: { label: '概念混同', color: 'bg-purple-100 text-purple-700' },
};

interface Props {
  analysis: ErrorAnalysis;
  onClose: () => void;
}

export function AnalysisCard({ analysis, onClose }: Props) {
  const errorInfo = ERROR_TYPE_LABELS[analysis.error_type] || {
    label: '分析',
    color: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg">AI誤答分析</h3>
        <span className={`text-xs px-2 py-1 rounded-full font-bold ${errorInfo.color}`}>
          {errorInfo.label}
        </span>
      </div>

      <div>
        <p className="text-sm text-slate-500 mb-1">間��えた原因</p>
        <p className="text-sm leading-relaxed">{analysis.analysis}</p>
      </div>

      <div>
        <p className="text-sm text-slate-500 mb-1">重要概念</p>
        <p className="text-sm font-medium text-primary-600">{analysis.key_concept}</p>
      </div>

      <div className="bg-blue-50 p-3 rounded-lg">
        <p className="text-sm text-slate-500 mb-1">学習アドバイス</p>
        <p className="text-sm leading-relaxed">{analysis.study_hint}</p>
      </div>

      <button onClick={onClose} className="btn-secondary w-full">
        閉じる
      </button>
    </div>
  );
}
