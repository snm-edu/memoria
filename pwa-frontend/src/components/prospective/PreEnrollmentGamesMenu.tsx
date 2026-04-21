import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEPARTMENT_LABELS } from '../../types';
import { logPreEnrollmentGame, updateStudentNumber } from '../../services/api';
import { db } from '../../services/db';

type GameId = 'basics' | 'kanji' | 'reading' | 'thinking';

interface GameMeta {
  id: GameId;
  label: string;
  image: string;
  href?: string;
  comingSoon?: boolean;
  /** 浮遊アニメ開始のずらし秒。各カードがバラバラに揺れるように */
  delay: string;
}

const BASE_PATH = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
const img = (name: string) => `${BASE_PATH}/images/${name}`;

const GAMES: GameMeta[] = [
  { id: 'kanji',    label: '漢字力', image: img('漢字力.jpg'), href: 'https://iryopapa.itch.io/kartelis', delay: '0s' },
  { id: 'basics',   label: '基礎力', image: img('基礎力.jpg'), href: 'https://iryopapa.itch.io/orgamon',  delay: '0.6s' },
  { id: 'thinking', label: '思考力', image: img('思考力.jpg'), comingSoon: true, delay: '1.2s' },
  { id: 'reading',  label: '読解力', image: img('読解力.jpg'), comingSoon: true, delay: '1.8s' },
];

export function PreEnrollmentGamesMenu() {
  const { state, dispatch, triggerSync } = useApp();
  const { profile } = state;
  const [message, setMessage] = useState<string | null>(null);
  const [showEnrollModal, setShowEnrollModal] = useState(false);

  function handleComingSoon(game: GameMeta) {
    setMessage(`${game.label} は現在準備中です`);
  }

  function handleLinkClick(game: GameMeta) {
    if (!profile) return;
    setMessage(null);
    // fire-and-forget: リンク遷移は <a> が処理するのでログ完了を待たない
    logPreEnrollmentGame({
      studentId: profile.studentId,
      studentNumber: profile.studentNumber,
      department: profile.department,
      gameId: game.id,
      status: 'started',
    }).catch((err) => console.warn('[prospective] log failed', err));
  }

  return (
    <div className="relative min-h-[100dvh] overflow-hidden p-4 pb-6 flex flex-col">
      <style>{floatKeyframes}</style>

      <header className="relative z-10 mb-3 flex items-start justify-between flex-shrink-0">
        <div>
          <h1
            className="text-xl font-extrabold tracking-tight"
            style={{
              background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Memoria
          </h1>
          {profile && (
            <p className="text-sm text-slate-400">
              {DEPARTMENT_LABELS[profile.department]} 入学前コース
            </p>
          )}
        </div>
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })}
          className="w-10 h-10 flex items-center justify-center rounded-full
            bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
          title="設定"
          aria-label="設定"
        >
          ⚙️
        </button>
      </header>

      <p className="relative z-10 text-center text-sm font-bold text-slate-600 mb-2 flex-shrink-0">
        入学までに 4 つの力を育てよう
      </p>

      <div className="relative z-10 grid grid-cols-2 grid-rows-2 gap-3 flex-1 min-h-0">
        {GAMES.map((game) => {
          const cardClass =
            'relative block overflow-hidden rounded-3xl shadow-xl active:scale-[0.97] transition-transform';
          const cardStyle = {
            animation: 'floatY 5s ease-in-out infinite',
            animationDelay: game.delay,
          } as const;

          const inner = (
            <>
              <img
                src={game.image}
                alt={game.label}
                className="absolute inset-0 w-full h-full object-cover"
                draggable={false}
              />
              {/* 下部に文字を読みやすくするためのグラデーション */}
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
              <div className="absolute inset-x-0 bottom-2 text-center">
                <div className="inline-block px-3 py-1 text-white font-extrabold text-lg drop-shadow-md">
                  {game.label}
                </div>
                {game.comingSoon && (
                  <div className="mt-1">
                    <span className="inline-block rounded-full bg-white/85 text-slate-700 text-[10px] font-bold px-2 py-0.5">
                      Coming soon
                    </span>
                  </div>
                )}
              </div>
            </>
          );

          return game.href ? (
            <a
              key={game.id}
              href={game.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => handleLinkClick(game)}
              className={cardClass}
              style={cardStyle}
              aria-label={game.label}
            >
              {inner}
            </a>
          ) : (
            <button
              key={game.id}
              type="button"
              onClick={() => handleComingSoon(game)}
              className={`${cardClass} text-left`}
              style={cardStyle}
              aria-label={`${game.label}（準備中）`}
            >
              {inner}
            </button>
          );
        })}
      </div>

      {/* 国試対策へ移動ボタン */}
      <button
        type="button"
        onClick={() => setShowEnrollModal(true)}
        className="relative z-10 mt-3 w-full py-3 rounded-2xl font-bold text-white shadow-lg
          active:scale-[0.98] transition-transform flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)',
        }}
      >
        🎓 国試対策へ移動
      </button>

      {message && (
        <p className="relative z-10 text-center text-xs text-slate-500 mt-2 flex-shrink-0">
          {message}
        </p>
      )}

      {showEnrollModal && (
        <EnrollModal
          onClose={() => setShowEnrollModal(false)}
          onEnrolled={async (newStudentNumber, newGrade) => {
            if (!profile) return;
            // 未同期ログを先に送信
            try { await triggerSync(); } catch { /* noop */ }

            // GAS 側の学籍番号を更新（失敗してもローカル更新は続行）
            if (profile.studentNumber && profile.studentNumber !== newStudentNumber) {
              try {
                await updateStudentNumber({
                  oldStudentNumber: profile.studentNumber,
                  newStudentNumber,
                  studentId: profile.studentId,
                });
              } catch (err) {
                console.warn('[enroll] GAS updateStudentNumber failed', err);
              }
            }

            // ローカル DB を更新
            await db.profile.update(profile.id!, {
              studentNumber: newStudentNumber,
              grade: newGrade,
              studentType: 'enrolled',
            });

            // AppContext を更新 → studentType='enrolled' になるので自動的に HomeScreen へ
            dispatch({
              type: 'SET_PROFILE',
              profile: {
                ...profile,
                studentNumber: newStudentNumber,
                grade: newGrade,
                studentType: 'enrolled',
              },
            });
            dispatch({ type: 'SET_SCREEN', screen: 'home' });
          }}
        />
      )}
    </div>
  );
}

interface EnrollModalProps {
  onClose: () => void;
  onEnrolled: (studentNumber: string, grade: number) => void | Promise<void>;
}

function EnrollModal({ onClose, onEnrolled }: EnrollModalProps) {
  const [studentNumber, setStudentNumber] = useState('');
  const [grade, setGrade] = useState(1);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit() {
    const num = studentNumber.trim();
    if (!num || isSaving) return;
    setIsSaving(true);
    try {
      await onEnrolled(num, grade);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-extrabold text-center mb-2">🎓 国試対策モードへ切り替え</h2>
        <p className="text-xs text-slate-500 text-center mb-5 leading-relaxed">
          ご入学おめでとうございます！<br />
          本学籍番号を入力すると、国試対策モードに切り替わります。<br />
          これまでの学習履歴は引き継がれます。
        </p>

        <label className="block text-xs font-bold text-slate-500 mb-1">学籍番号</label>
        <input
          type="text"
          value={studentNumber}
          onChange={(e) => setStudentNumber(e.target.value)}
          placeholder="例: 25N001"
          autoFocus
          className="w-full p-3 rounded-xl border-2 border-slate-200 text-center text-lg font-bold mb-4
            focus:border-primary-400 focus:outline-none transition-all"
        />

        <label className="block text-xs font-bold text-slate-500 mb-2">学年</label>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[1, 2, 3].map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              className={`p-3 rounded-xl text-center font-bold transition-all
                ${grade === g
                  ? 'bg-primary-500 text-white shadow'
                  : 'bg-slate-100 border-2 border-slate-200 text-slate-600'
                }`}
            >
              {g}年
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!studentNumber.trim() || isSaving}
          className={`w-full p-3 rounded-xl font-bold text-white transition-all
            ${!studentNumber.trim() || isSaving
              ? 'bg-slate-300 cursor-not-allowed'
              : 'bg-primary-500 active:bg-primary-600 shadow-lg'
            }`}
        >
          {isSaving ? '切り替え中...' : '国試対策モードへ切り替える'}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="w-full text-center text-slate-400 py-2 mt-2 text-sm"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

const floatKeyframes = `
@keyframes floatY {
  0%   { transform: translateY(0px) rotate(0deg); }
  50%  { transform: translateY(-8px) rotate(-0.6deg); }
  100% { transform: translateY(0px) rotate(0deg); }
}
`;
