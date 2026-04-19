import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { useApp } from '../../context/AppContext';
import { useBgm } from '../../hooks/useBgm';
import { DEPARTMENT_LABELS } from '../../types';
import { getCategoriesForGrade } from '../../services/gradeFilter';
import { getCharacterStage } from '../../services/gamification';
import { CharacterDisplay } from '../character/CharacterDisplay';

export function HomeScreen() {
  const { state, dispatch } = useApp();
  const { isMuted, toggleMute, play } = useBgm();

  // ホーム画面では home BGM を再生
  useEffect(() => {
    play('home');
  }, [play]);
  const { profile } = state;

  // 今日の復習予定数
  const today = new Date().toISOString().split('T')[0]!;
  const reviewCount = useLiveQuery(
    () => db.cardStates.where('nextReview').belowOrEqual(today).count(),
    [today],
    0
  );

  // 総問題数（キャッシュ）
  const totalQuestions = useLiveQuery(
    () => db.questionCache.count(),
    [],
    0
  );

  // 学習済み問題数
  const studiedCount = useLiveQuery(
    () => db.cardStates.count(),
    [],
    0
  );

  // 今日の回答数
  const todayAnswers = useLiveQuery(async () => {
    const todayStart = today + 'T00:00:00';
    return db.answerLog
      .where('timestamp')
      .above(todayStart)
      .count();
  }, [today], 0);

  // 正答率（直近100問）
  const recentAccuracy = useLiveQuery(async () => {
    const recent = await db.answerLog
      .orderBy('timestamp')
      .reverse()
      .limit(100)
      .toArray();
    if (recent.length === 0) return 0;
    const correct = recent.filter((a) => a.isCorrect).length;
    return Math.round((correct / recent.length) * 100);
  }, [], 0);

  // 弱点分野（正答率が低い上位3分野）
  const weakCategories = useLiveQuery(async () => {
    const logs = await db.answerLog.toArray();
    if (logs.length === 0) return [];

    const allQuestions = await db.questionCache.toArray();
    const questions = profile
      ? allQuestions.filter((q) => q.department === profile.department)
      : allQuestions;
    const categoryMap = new Map(questions.map((q) => [q.question_id, q.category]));

    const stats: Record<string, { correct: number; total: number }> = {};
    for (const log of logs) {
      const cat = categoryMap.get(log.questionId) || '未分類';
      if (!stats[cat]) stats[cat] = { correct: 0, total: 0 };
      stats[cat]!.total++;
      if (log.isCorrect) stats[cat]!.correct++;
    }

    return Object.entries(stats)
      .filter(([, s]) => s.total >= 3) // 最低3問以上
      .map(([cat, s]) => ({
        category: cat,
        accuracy: Math.round((s.correct / s.total) * 100),
        total: s.total,
      }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);
  }, [], []);

  // ホームからの「新しい問題に挑戦」→ 学年制限付き
  function startGradedQuiz() {
    dispatch({ type: 'SET_QUIZ_MODE', mode: 'graded' });
    dispatch({ type: 'SET_SCREEN', screen: 'quiz' });
  }

  // ナビの「クイズ」→ 全問題から自由選択
  function startFreeQuiz() {
    dispatch({ type: 'SET_QUIZ_MODE', mode: 'free' });
    dispatch({ type: 'SET_SCREEN', screen: 'quiz' });
  }

  // 学年の出題範囲にある問題数を計算
  const gradeQuestionCount = useLiveQuery(async () => {
    if (!profile) return 0;
    const gradeCategories = await getCategoriesForGrade(profile.grade, profile.department);
    const all = await db.questionCache.toArray();
    return all.filter(q =>
      q.department === profile.department &&
      (gradeCategories === null || gradeCategories.includes(q.category))
    ).length;
  }, [profile?.grade, profile?.department], 0);

  // ゲーミフィケーションデータ取得
  const gamification = useLiveQuery(async () => {
    if (!profile) return null;
    return db.gamification.where('visitorId').equals(profile.studentId).first();
  }, [profile?.studentId]);

  const streakDays = gamification?.streakDays || 0;
  const exp = gamification?.exp || 0;
  const badgeCount = gamification?.badges?.length || 0;
  const characterPoints = gamification?.characterPoints || 0;
  const charInfo = getCharacterStage(characterPoints);

  // レベル計算
  const level = Math.min(40, Math.floor(Math.sqrt(exp / 25)) + 1);
  const currentLevelExp = (level - 1) * (level - 1) * 25;
  const nextLevelExp = level * level * 25;
  const progress = nextLevelExp > currentLevelExp ? (exp - currentLevelExp) / (nextLevelExp - currentLevelExp) : 1;

  // 称号
  const TITLES = [[1,'見学生'],[5,'実習生'],[10,'新人'],[15,'一人前'],[20,'プリセプター'],[25,'主任'],[30,'師長'],[35,'専門家'],[40,'部長']] as const;
  let levelTitle = '見学生';
  for (const [lv, t] of TITLES) { if (level >= lv) levelTitle = t; }

  return (
    <div className="min-h-screen p-4 pb-20">
      {/* ヘッダー */}
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>Memoria</h1>
          {profile && (
            <p className="text-sm text-slate-400">
              {DEPARTMENT_LABELS[profile.department]} {profile.grade}年
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
            title={isMuted ? 'BGMオン' : 'BGMオフ'}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
          {!state.isOnline && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
              オフライン
            </span>
          )}
          {state.pendingSyncCount > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
              未同期 {state.pendingSyncCount}
            </span>
          )}
        </div>
      </header>

      {/* ストリーク & レベル */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 card flex items-center gap-2 py-2">
          <span className="text-xl">🔥</span>
          <div>
            <p className="text-lg font-bold">{streakDays}日</p>
            <p className="text-xs text-slate-400">連続学習</p>
          </div>
        </div>
        <div className="flex-1 card flex items-center gap-2 py-2">
          <span className="text-xl">⭐</span>
          <div>
            <p className="text-lg font-bold">Lv.{level}</p>
            <p className="text-xs text-slate-400">{levelTitle}</p>
          </div>
        </div>
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'badges' })} className="card flex items-center gap-2 py-2 px-3">
          <CharacterDisplay
            stage={charInfo.current.stage}
            fallbackEmoji={charInfo.current.emoji}
            fallbackName={charInfo.current.name}
            size={32}
            compact
          />
          <div>
            <p className="text-lg font-bold">{badgeCount}</p>
            <p className="text-xs text-slate-400">バッジ</p>
          </div>
        </button>
      </div>

      {/* EXPプログレスバー */}
      <div className="mb-4 px-1">
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>EXP {exp}</span>
          <span>次のレベルまで {nextLevelExp - exp}</span>
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2">
          <div className="bg-gradient-to-r from-blue-400 to-purple-500 h-2 rounded-full transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      {/* メイン学習ボタン */}
      <div className="card mb-4 text-center">
        <p className="text-slate-500 text-sm mb-1">今日の復習</p>
        <p className="text-4xl font-bold text-primary-600 mb-2">
          {reviewCount > 0 ? reviewCount : '0'}
          <span className="text-lg text-slate-400 ml-1">問</span>
        </p>
        <button onClick={startGradedQuiz} className="btn-primary w-full mt-2">
          {reviewCount > 0 ? '復習を始める' : '新しい問題に挑戦'}
        </button>
        {profile && (
          <p className="text-xs text-slate-400 mt-2">
            {profile.grade}年生の範囲から出題（{gradeQuestionCount}問）
          </p>
        )}
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card text-center">
          <p className="text-slate-400 text-xs">今日の回答</p>
          <p className="text-2xl font-bold">{todayAnswers}</p>
        </div>
        <div className="card text-center">
          <p className="text-slate-400 text-xs">正答率（直近100問）</p>
          <p className="text-2xl font-bold">
            {recentAccuracy}<span className="text-sm">%</span>
          </p>
        </div>
        <div className="card text-center">
          <p className="text-slate-400 text-xs">学習済み</p>
          <p className="text-2xl font-bold">{studiedCount}</p>
        </div>
        <div className="card text-center">
          <p className="text-slate-400 text-xs">問題バンク</p>
          <p className="text-2xl font-bold">{totalQuestions}</p>
        </div>
      </div>

      {/* AI分析ボタン */}
      <button
        onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'ai_dashboard' })}
        className="w-full card mb-4 flex items-center gap-3 active:bg-slate-50 transition-colors"
      >
        <span className="text-2xl">🤖</span>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold">AI分析ダッシュボード</p>
          <p className="text-xs text-slate-400">苦手分野の深掘り・学習アドバイス</p>
        </div>
        <span className="text-slate-300">→</span>
      </button>

      {/* 弱点分野 */}
      {weakCategories.length > 0 && (
        <div className="card">
          <h3 className="font-bold text-sm text-slate-500 mb-3">弱点分野</h3>
          <div className="space-y-2">
            {weakCategories.map((cat) => (
              <div key={cat.category} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{cat.category}</p>
                  <div className="w-full bg-slate-100 rounded-full h-2 mt-1">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${cat.accuracy}%`,
                        backgroundColor:
                          cat.accuracy < 40 ? '#ef4444' :
                          cat.accuracy < 60 ? '#f59e0b' :
                          '#22c55e',
                      }}
                    />
                  </div>
                </div>
                <span className="text-sm font-bold whitespace-nowrap">
                  {cat.accuracy}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ナビゲーション */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-3 px-4">
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
          className="flex flex-col items-center text-primary-500"
        >
          <span className="text-lg">🏠</span>
          <span className="text-xs">ホーム</span>
        </button>
        <button
          onClick={startFreeQuiz}
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
