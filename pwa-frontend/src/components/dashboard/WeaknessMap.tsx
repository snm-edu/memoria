import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { useApp } from '../../context/AppContext';

interface CategoryStat {
  category: string;
  correct: number;
  total: number;
  accuracy: number;
}

export function WeaknessMap() {
  const { dispatch } = useApp();

  const stats = useLiveQuery(async (): Promise<CategoryStat[]> => {
    const logs = await db.answerLog.toArray();
    if (logs.length === 0) return [];

    const questions = await db.questionCache.toArray();
    const catMap = new Map(questions.map((q) => [q.question_id, q.category]));

    const acc: Record<string, { correct: number; total: number }> = {};
    for (const log of logs) {
      const cat = catMap.get(log.questionId) || '未分類';
      if (!acc[cat]) acc[cat] = { correct: 0, total: 0 };
      acc[cat]!.total++;
      if (log.isCorrect) acc[cat]!.correct++;
    }

    return Object.entries(acc)
      .map(([category, s]) => ({
        category,
        correct: s.correct,
        total: s.total,
        accuracy: Math.round((s.correct / s.total) * 100),
      }))
      .sort((a, b) => a.accuracy - b.accuracy);
  }, [], []);

  function getColorForAccuracy(accuracy: number): string {
    if (accuracy < 30) return 'bg-red-500';
    if (accuracy < 50) return 'bg-red-400';
    if (accuracy < 60) return 'bg-amber-400';
    if (accuracy < 70) return 'bg-amber-300';
    if (accuracy < 80) return 'bg-green-300';
    if (accuracy < 90) return 'bg-green-400';
    return 'bg-green-500';
  }

  return (
    <div className="min-h-screen p-4 pb-20">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
          className="text-slate-400"
        >
          ← 戻る
        </button>
        <h2 className="text-xl font-bold">弱点マップ</h2>
      </header>

      {stats.length === 0 ? (
        <div className="card text-center text-slate-400 py-8">
          まだ学習データがありません。<br />
          問題を解くと分野別の正答率が表示されます。
        </div>
      ) : (
        <div className="space-y-2">
          {stats.map((stat) => (
            <div key={stat.category} className="card flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full flex-shrink-0 ${getColorForAccuracy(
                  stat.accuracy
                )}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{stat.category}</p>
                <div className="w-full bg-slate-100 rounded-full h-2 mt-1">
                  <div
                    className={`h-2 rounded-full ${getColorForAccuracy(
                      stat.accuracy
                    )}`}
                    style={{ width: `${stat.accuracy}%` }}
                  />
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold">{stat.accuracy}%</p>
                <p className="text-xs text-slate-400">
                  {stat.correct}/{stat.total}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ナビゲーション */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-3 px-4">
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
          className="flex flex-col items-center text-slate-400"
        >
          <span className="text-lg">🏠</span>
          <span className="text-xs">ホーム</span>
        </button>
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'quiz' })}
          className="flex flex-col items-center text-slate-400"
        >
          <span className="text-lg">📝</span>
          <span className="text-xs">クイズ</span>
        </button>
        <button className="flex flex-col items-center text-primary-500">
          <span className="text-lg">📊</span>
          <span className="text-xs">弱点</span>
        </button>
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'schedule' })}
          className="flex flex-col items-center text-slate-400"
        >
          <span className="text-lg">📅</span>
          <span className="text-xs">予定</span>
        </button>
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })}
          className="flex flex-col items-center text-slate-400"
        >
          <span className="text-lg">⚙️</span>
          <span className="text-xs">設定</span>
        </button>
      </nav>
    </div>
  );
}
