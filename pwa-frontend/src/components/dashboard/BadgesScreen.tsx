import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { useApp } from '../../context/AppContext';
import { BADGE_DEFINITIONS, getLevelProgress, getLevelTitle, getCharacterStage } from '../../services/gamification';
import { CharacterDisplay } from '../character/CharacterDisplay';
import type { MessageContext } from '../../services/characterMessage';

export function BadgesScreen() {
  const { state, dispatch } = useApp();
  const profile = state.profile;

  const gamification = useLiveQuery(async () => {
    if (!profile) return null;
    return db.gamification.where('visitorId').equals(profile.studentId).first();
  }, [profile?.studentId]);

  // 文脈算出: 直近50問の正答率
  const recentAccuracy = useLiveQuery(async () => {
    const recent = await db.answerLog.orderBy('timestamp').reverse().limit(50).toArray();
    if (recent.length < 5) return null;
    const correct = recent.filter(l => l.isCorrect).length;
    return (correct / recent.length) * 100;
  }, []);

  const earnedBadges = gamification?.badges || [];
  const categories = [
    { key: 'quantity', label: '📚 学習量' },
    { key: 'streak', label: '🔥 継続' },
    { key: 'accuracy', label: '🎯 正答率' },
    { key: 'mastery', label: '📊 分野制覇' },
    { key: 'challenge', label: '💪 チャレンジ' },
  ];

  const levelInfo = gamification ? getLevelProgress(gamification.exp) : { level: 1, currentExp: 0, nextLevelExp: 25, progress: 0 };
  const title = getLevelTitle(levelInfo.level, profile?.department);
  const gp = gamification?.characterPoints ?? 0;
  const charInfo = getCharacterStage(gp);

  return (
    <div className="min-h-screen p-4 pb-20">
      <header className="flex items-center gap-3 mb-6">
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })} className="text-slate-400">← 戻る</button>
        <h2 className="text-xl font-bold">バッジコレクション</h2>
      </header>

      {/* レベル・EXP表示 */}
      <div className="card mb-4 text-center">
        <p className="text-sm text-slate-400">Lv.{levelInfo.level} {title}</p>
        <p className="text-2xl font-bold">{gamification?.exp || 0} <span className="text-sm text-slate-400">EXP</span></p>
        <div className="w-full bg-slate-100 rounded-full h-3 mt-2">
          <div className="bg-gradient-to-r from-blue-400 to-purple-500 h-3 rounded-full transition-all" style={{ width: `${levelInfo.progress * 100}%` }} />
        </div>
        <p className="text-xs text-slate-400 mt-1">次のレベルまで {levelInfo.nextLevelExp - levelInfo.currentExp} EXP</p>
      </div>

      {/* キャラクター成長 */}
      <div className="card mb-4 text-center py-4">
        {(() => {
          const now = new Date();
          const ctx: MessageContext = {
            streakDays: gamification?.streakDays ?? 0,
            recentAccuracy: recentAccuracy ?? null,
            lastStudyDate: gamification?.lastStudyDate ?? '',
            hour: now.getHours(),
            dayOfWeek: now.getDay(),
          };
          return (
            <CharacterDisplay
              stage={charInfo.current.stage}
              fallbackEmoji={charInfo.current.emoji}
              fallbackName={charInfo.current.name}
              context={ctx}
              size={200}
            />
          );
        })()}
        <p className="font-bold text-lg mt-2">{charInfo.current.name}</p>
        <p className="text-xs text-slate-400 mb-2">ステージ {charInfo.current.stage} / 7</p>
        <div className="w-full bg-slate-100 rounded-full h-2 mb-1">
          <div
            className="bg-gradient-to-r from-amber-400 to-orange-500 h-2 rounded-full transition-all"
            style={{ width: `${charInfo.progress * 100}%` }}
          />
        </div>
        <p className="text-xs text-slate-400">
          {charInfo.nextGP !== null
            ? `次の進化まで ${charInfo.nextGP - gp} GP`
            : '最高ステージ達成！'}
        </p>
        <p className="text-xs text-slate-300 mt-1">GP: {gp}</p>
      </div>

      {/* 獲得数 */}
      <div className="card mb-4 text-center">
        <p className="text-3xl font-bold">{earnedBadges.length} <span className="text-sm text-slate-400">/ {BADGE_DEFINITIONS.length}</span></p>
        <p className="text-sm text-slate-400">獲得バッジ</p>
      </div>

      {/* カテゴリ別バッジ */}
      {categories.map(cat => {
        const badges = BADGE_DEFINITIONS.filter(b => b.category === cat.key);
        return (
          <div key={cat.key} className="mb-4">
            <h3 className="text-sm font-bold text-slate-500 mb-2">{cat.label}</h3>
            <div className="grid grid-cols-3 gap-2">
              {badges.map(badge => {
                const earned = earnedBadges.includes(badge.id);
                return (
                  <div key={badge.id} className={`card text-center py-3 ${earned ? '' : 'opacity-30 grayscale'}`}>
                    <span className="text-2xl">{badge.icon}</span>
                    <p className="text-xs mt-1 truncate">{badge.name}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

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
