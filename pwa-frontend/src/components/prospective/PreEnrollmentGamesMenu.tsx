import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEPARTMENT_LABELS } from '../../types';
import { logPreEnrollmentGame } from '../../services/api';

// prospective モードの "ホーム" は当画面なので、戻り先として設定画面を用意する

type GameId = 'basics' | 'kanji' | 'reading' | 'thinking';

interface GameMeta {
  id: GameId;
  label: string;
  description: string;
  emoji: string;
  accent: string; // Tailwind bg class
}

const GAMES: GameMeta[] = [
  { id: 'basics',   label: '基礎力', description: '入学前に押さえておきたい基礎知識', emoji: '📘', accent: 'from-sky-400 to-blue-500' },
  { id: 'kanji',    label: '漢字力', description: '医療で使われる漢字を読めるように',   emoji: '🈶', accent: 'from-emerald-400 to-green-500' },
  { id: 'reading',  label: '読解力', description: '長めの文章から要点を掴む練習',       emoji: '📖', accent: 'from-amber-400 to-orange-500' },
  { id: 'thinking', label: '思考力', description: 'ロジカルに考える力を鍛える',         emoji: '🧠', accent: 'from-fuchsia-400 to-pink-500' },
];

export function PreEnrollmentGamesMenu() {
  const { state, dispatch } = useApp();
  const { profile } = state;
  const [message, setMessage] = useState<string | null>(null);

  async function handleStart(game: GameMeta) {
    if (!profile) return;
    setMessage(`${game.label} は現在準備中です`);
    // 実施ログのみ送信（ゲーム本体は後続実装）
    try {
      await logPreEnrollmentGame({
        studentId: profile.studentId,
        studentNumber: profile.studentNumber,
        department: profile.department,
        gameId: game.id,
        status: 'started',
      });
    } catch (err) {
      console.warn('[prospective] log failed', err);
    }
  }

  return (
    <div className="min-h-[100dvh] p-4 pb-6">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}>Memoria</h1>
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

      <div className="card mb-5 text-center">
        <p className="text-sm text-slate-500 mb-1">入学前教育</p>
        <p className="text-base font-bold text-slate-700">
          入学までに 4 つの力を育てよう
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {GAMES.map((game) => (
          <button
            key={game.id}
            onClick={() => handleStart(game)}
            className={`rounded-2xl p-4 text-left text-white shadow-md
              active:scale-[0.98] transition-transform
              bg-gradient-to-br ${game.accent}`}
          >
            <div className="text-3xl mb-2">{game.emoji}</div>
            <div className="font-bold text-lg">{game.label}</div>
            <div className="text-xs opacity-90 mt-1 leading-snug">
              {game.description}
            </div>
          </button>
        ))}
      </div>

      {message && (
        <p className="text-center text-xs text-slate-500 mt-6">
          {message}
        </p>
      )}
    </div>
  );
}
