import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

const GAS_API_URL = import.meta.env.VITE_GAS_API_URL || '';

interface WeakCategory {
  category: string;
  rate: number;
  count: number;
  subcategories?: { subcategory: string; rate: number; count: number }[];
}

interface WeeklyTrend {
  week: string;
  rate: number;
  count: number;
}

interface ErrorPattern {
  type: string;
  description: string;
  count: number;
}

interface DashboardData {
  totalQuestions: number;
  correctRate: number;
  streakDays: number;
  weakCategories: WeakCategory[];
  strongCategories: WeakCategory[];
  weeklyTrend: WeeklyTrend[];
  errorPatterns: ErrorPattern[];
  aiComment: string;
  updatedAt: string;
}

export function AiDashboard() {
  const { state, dispatch } = useApp();
  const profile = state.profile;
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile || !GAS_API_URL) {
      setLoading(false);
      setError(GAS_API_URL ? '' : 'API未設定');
      return;
    }

    const fetchDashboard = async () => {
      try {
        const url = `${GAS_API_URL}?action=getDashboard&studentId=${encodeURIComponent(profile.studentId)}`;
        const res = await fetch(url, { redirect: 'follow' });
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
        } else if (json.error) {
          setError(json.error);
        } else {
          setError('データの取得に失敗しました');
        }
      } catch {
        setError('通信エラー');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [profile]);

  function getBarColor(rate: number): string {
    if (rate < 40) return 'bg-red-400';
    if (rate < 60) return 'bg-amber-400';
    if (rate < 75) return 'bg-blue-400';
    return 'bg-green-400';
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
        <h2 className="text-xl font-bold">🤖 AI分析</h2>
      </header>

      {loading && (
        <div className="card text-center py-8 text-slate-400">
          <p className="animate-pulse">分析データを読み込み中...</p>
        </div>
      )}

      {error && (
        <div className="card text-center py-8">
          <p className="text-slate-400 mb-2">{error}</p>
          <p className="text-xs text-slate-300">
            分析データは毎日午前4時に自動更新されます。<br />
            問題を解いてデータを蓄積しましょう。
          </p>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {/* AIコメント */}
          {data.aiComment && (
            <div className="card bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-200">
              <p className="text-sm font-bold text-blue-600 mb-2">💡 AIからのアドバイス</p>
              <p className="text-sm text-slate-700 leading-relaxed">{data.aiComment}</p>
              <p className="text-xs text-slate-400 mt-2">
                更新: {data.updatedAt ? new Date(data.updatedAt).toLocaleDateString('ja-JP') : '---'}
              </p>
            </div>
          )}

          {/* 基本統計 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card text-center">
              <p className="text-xs text-slate-400">総回答数</p>
              <p className="text-xl font-bold">{data.totalQuestions}</p>
            </div>
            <div className="card text-center">
              <p className="text-xs text-slate-400">正答率</p>
              <p className="text-xl font-bold">{data.correctRate}%</p>
            </div>
            <div className="card text-center">
              <p className="text-xs text-slate-400">連続学習</p>
              <p className="text-xl font-bold">{data.streakDays}日</p>
            </div>
          </div>

          {/* 週次推移 */}
          {data.weeklyTrend.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-slate-500 mb-3">📈 正答率の推移</h3>
              <div className="space-y-2">
                {data.weeklyTrend.map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-16 flex-shrink-0">
                      {new Date(w.week).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                    </span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 relative">
                      <div
                        className={`${getBarColor(w.rate)} h-5 rounded-full transition-all flex items-center justify-end pr-2`}
                        style={{ width: `${Math.max(w.rate, 10)}%` }}
                      >
                        <span className="text-xs text-white font-bold">{w.rate}%</span>
                      </div>
                    </div>
                    <span className="text-xs text-slate-300 w-10 text-right">{w.count}問</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 苦手分野 */}
          {data.weakCategories.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-red-500 mb-3">⚠️ 苦手分野</h3>
              <div className="space-y-3">
                {data.weakCategories.map((cat, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold">{cat.category}</span>
                      <span className="text-sm font-bold text-red-500">{cat.rate}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 mb-1">
                      <div
                        className={`${getBarColor(cat.rate)} h-2 rounded-full`}
                        style={{ width: `${cat.rate}%` }}
                      />
                    </div>
                    {/* サブカテゴリ */}
                    {cat.subcategories && cat.subcategories.length > 0 && (
                      <div className="ml-4 mt-1 space-y-1">
                        {cat.subcategories.slice(0, 3).map((sub, j) => (
                          <div key={j} className="flex items-center justify-between">
                            <span className="text-xs text-slate-500 truncate flex-1">{sub.subcategory}</span>
                            <span className={`text-xs font-bold ${sub.rate < 50 ? 'text-red-500' : 'text-slate-500'}`}>
                              {sub.rate}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 得意分野 */}
          {data.strongCategories.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-green-500 mb-3">✅ 得意分野</h3>
              <div className="space-y-2">
                {data.strongCategories.map((cat, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-sm">{cat.category}</span>
                    <span className="text-sm font-bold text-green-500">{cat.rate}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 誤答パターン */}
          {data.errorPatterns.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-bold text-amber-500 mb-3">🔍 誤答パターン</h3>
              <div className="space-y-2">
                {data.errorPatterns.map((pat, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-lg">
                      {pat.type === 'hasty' ? '⚡' : '🤔'}
                    </span>
                    <p className="text-sm text-slate-600">{pat.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 注記 */}
          <p className="text-xs text-slate-300 text-center">
            ※ 分析データは毎日午前4時に自動更新されます
          </p>
        </div>
      )}

      {/* ナビゲーション */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-3 px-4">
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">🏠</span><span className="text-xs">ホーム</span>
        </button>
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'quiz' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">📝</span><span className="text-xs">クイズ</span>
        </button>
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'weakness' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">📊</span><span className="text-xs">弱点</span>
        </button>
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'schedule' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">📅</span><span className="text-xs">予定</span>
        </button>
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">⚙️</span><span className="text-xs">設定</span>
        </button>
      </nav>
    </div>
  );
}
