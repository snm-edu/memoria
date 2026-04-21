import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { DEPARTMENT_LABELS } from '../../types';
import { logPreEnrollmentGame } from '../../services/api';

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
  const { state, dispatch } = useApp();
  const { profile } = state;
  const [message, setMessage] = useState<string | null>(null);

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
    <div className="relative min-h-[100dvh] overflow-hidden p-4 pb-6">
      <style>{floatKeyframes}</style>

      <header className="relative z-10 mb-4 flex items-start justify-between">
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

      <p className="relative z-10 text-center text-sm font-bold text-slate-600 mb-3">
        入学までに 4 つの力を育てよう
      </p>

      <div className="relative z-10 grid grid-cols-2 grid-rows-2 gap-3"
           style={{ height: 'calc(100dvh - 9.5rem)' }}>
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

      {message && (
        <p className="relative z-10 text-center text-xs text-slate-500 mt-3">
          {message}
        </p>
      )}
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
