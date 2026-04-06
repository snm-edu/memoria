import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { useApp } from '../../context/AppContext';
import { getCategoriesForGrade } from '../../services/gradeFilter';

export function ReviewSchedule() {
  const { state, dispatch } = useApp();
  const grade = state.profile?.grade ?? 3;
  const gradeCategories = getCategoriesForGrade(grade);

  // 学年範囲内のquestion_idセットを取得
  const gradeQuestionIds = useLiveQuery(async () => {
    const questions = await db.questionCache.toArray();
    return new Set(
      questions
        .filter(q => gradeCategories.includes(q.category))
        .map(q => q.question_id)
    );
  }, [gradeCategories], new Set<string>());

  // 今後7日間の復習予定を集計（学年範囲でフィルタ）
  const schedule = useLiveQuery(async () => {
    const cards = await db.cardStates.toArray();
    const filteredCards = cards.filter(c => gradeQuestionIds.has(c.questionId));
    if (filteredCards.length === 0) return [];

    const days: { date: string; count: number; label: string }[] = [];
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0]!;
      const count = filteredCards.filter((c) => c.nextReview === dateStr).length;
      const label = i === 0 ? '今日' : i === 1 ? '明日' : `${d.getMonth() + 1}/${d.getDate()}(${dayLabels[d.getDay()]})`;
      days.push({ date: dateStr, count, label });
    }

    return days;
  }, [gradeQuestionIds], []);

  // 全体の復習統計（学年範囲でフィルタ）
  const totalStats = useLiveQuery(async () => {
    const cards = await db.cardStates.toArray();
    const filteredCards = cards.filter(c => gradeQuestionIds.has(c.questionId));
    const today = new Date().toISOString().split('T')[0]!;
    const overdue = filteredCards.filter((c) => c.nextReview < today).length;
    const dueToday = filteredCards.filter((c) => c.nextReview === today).length;
    const upcoming = filteredCards.filter((c) => c.nextReview > today).length;
    return { total: filteredCards.length, overdue, dueToday, upcoming };
  }, [gradeQuestionIds], { total: 0, overdue: 0, dueToday: 0, upcoming: 0 });

  const maxCount = Math.max(...schedule.map((d) => d.count), 1);

  return (
    <div className="min-h-screen p-4 pb-20">
      <header className="flex items-center gap-3 mb-6">
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
          className="text-slate-400"
        >
          ← 戻る
        </button>
        <h2 className="text-xl font-bold">復習スケジュール</h2>
      </header>

      {/* 統計カード */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="card text-center">
          <p className="text-xs text-slate-400">遅延</p>
          <p className="text-xl font-bold text-red-500">{totalStats.overdue}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-slate-400">今日</p>
          <p className="text-xl font-bold text-primary-500">{totalStats.dueToday}</p>
        </div>
        <div className="card text-center">
          <p className="text-xs text-slate-400">予定</p>
          <p className="text-xl font-bold text-slate-600">{totalStats.upcoming}</p>
        </div>
      </div>

      {/* 7日間スケジュール */}
      <div className="card">
        <h3 className="font-bold text-sm text-slate-500 mb-4">今後7日間</h3>
        <div className="space-y-3">
          {schedule.map((day) => (
            <div key={day.date} className="flex items-center gap-3">
              <span className="text-sm w-20 text-slate-500 flex-shrink-0">
                {day.label}
              </span>
              <div className="flex-1 bg-slate-100 rounded-full h-6 relative">
                <div
                  className="bg-primary-400 h-6 rounded-full transition-all flex items-center justify-end pr-2"
                  style={{
                    width: `${Math.max((day.count / maxCount) * 100, day.count > 0 ? 15 : 0)}%`,
                  }}
                >
                  {day.count > 0 && (
                    <span className="text-xs text-white font-bold">
                      {day.count}
                    </span>
                  )}
                </div>
              </div>
              {day.count === 0 && (
                <span className="text-xs text-slate-300 w-6 text-right">0</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {totalStats.total === 0 && (
        <div className="card text-center text-slate-400 py-8 mt-4">
          まだ学習データがありません。<br />
          問題を解くと復習スケジュールが設定されます。
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
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'weakness' })}
          className="flex flex-col items-center text-slate-400"
        >
          <span className="text-lg">📊</span>
          <span className="text-xs">弱点</span>
        </button>
        <button className="flex flex-col items-center text-primary-500">
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
