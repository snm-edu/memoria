import { useEffect, useRef, useState } from 'react';
import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_light';
import {
  getMessagesForStage,
  selectMessage,
  applyTemplate,
  type CharacterMessage,
  type MessageContext,
} from '../../services/characterMessage';

interface Props {
  stage: number;
  fallbackEmoji: string;
  fallbackName: string;
  context?: MessageContext;
  size?: number;
  compact?: boolean;
}

type LoadState = 'loading' | 'ready' | 'missing';

const STAGE_FILES: Record<number, string> = {
  1: 'stage1.json',
  2: 'stage2_hatch.json',
  3: 'stage3_chick.json',
  4: 'stage4_bird.json',
  5: 'stage5_eagle.json',
  6: 'stage6_owl.json',
  7: 'stage7_wise.json',
};

const characterBaseUrl = () => `${import.meta.env.BASE_URL}assets/character/`;
const stageAssetUrl = (stage: number) =>
  `${characterBaseUrl()}${STAGE_FILES[stage] ?? `stage${stage}.json`}`;

export function CharacterDisplay({ stage, fallbackEmoji, fallbackName, context, size = 200, compact = false }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [pool, setPool] = useState<CharacterMessage[]>([]);
  const [currentMsg, setCurrentMsg] = useState<CharacterMessage | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(false);

  // Lottie アニメーションのロード
  useEffect(() => {
    let cancelled = false;
    let anim: AnimationItem | null = null;

    async function load() {
      setLoadState('loading');
      try {
        const res = await fetch(stageAssetUrl(stage));
        if (!res.ok) {
          if (!cancelled) setLoadState('missing');
          return;
        }
        const data = await res.json();
        if (cancelled || !containerRef.current) return;
        anim = lottie.loadAnimation({
          container: containerRef.current,
          renderer: 'svg',
          loop: true,
          autoplay: true,
          animationData: data,
          assetsPath: `${characterBaseUrl()}images/`,
        });
        animRef.current = anim;
        setLoadState('ready');
      } catch {
        if (!cancelled) setLoadState('missing');
      }
    }

    load();
    return () => {
      cancelled = true;
      if (anim) {
        anim.destroy();
      }
      animRef.current = null;
    };
  }, [stage]);

  // メッセージプールロード（compact 時は吹き出し不要なのでスキップ）
  useEffect(() => {
    if (compact) return;
    let cancelled = false;
    getMessagesForStage(stage).then(msgs => {
      if (!cancelled) setPool(msgs);
    });
    return () => {
      cancelled = true;
    };
  }, [stage, compact]);

  // 初回 & プール変更時にメッセージを選定
  useEffect(() => {
    if (compact || !context) return;
    if (pool.length === 0) {
      setCurrentMsg(null);
      return;
    }
    const msg = selectMessage(stage, context, pool);
    setCurrentMsg(msg);
    // 少し遅延して吹き出しをフェードイン
    const t = setTimeout(() => setBubbleVisible(true), 400);
    return () => clearTimeout(t);
  }, [pool, stage, compact, context]);

  function refreshMessage() {
    if (pool.length === 0 || !context) return;
    setBubbleVisible(false);
    setTimeout(() => {
      const next = selectMessage(stage, context, pool, currentMsg?.id);
      setCurrentMsg(next);
      setBubbleVisible(true);
      // タップで Lottie を最初から再生
      if (animRef.current) {
        animRef.current.goToAndPlay(0, true);
      }
    }, 200);
  }

  const sizeStyle = { width: size, height: size };

  if (compact) {
    return (
      <div style={sizeStyle} className="relative inline-block shrink-0" aria-label={fallbackName}>
        <div
          ref={containerRef}
          style={{ ...sizeStyle, visibility: loadState === 'ready' ? 'visible' : 'hidden' }}
        />
        {loadState !== 'ready' && (
          <div
            style={sizeStyle}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span style={{ fontSize: Math.round(size * 0.75), lineHeight: 1 }}>
              {fallbackEmoji}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center select-none">
      {/* 吹き出し */}
      <div
        className={`relative mb-2 max-w-[260px] transition-opacity duration-300 ${
          bubbleVisible && currentMsg ? 'opacity-100' : 'opacity-0'
        }`}
        aria-live="polite"
      >
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm px-4 py-2 text-sm text-slate-700 leading-snug">
          {currentMsg && context ? applyTemplate(currentMsg, context) : ''}
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-3 h-3 bg-white border-r border-b border-slate-200 rotate-45" />
      </div>

      {/* キャラクター本体（Lottie or 絵文字フォールバック） */}
      <button
        type="button"
        onClick={refreshMessage}
        className="active:scale-95 transition-transform"
        aria-label={`${fallbackName} に話しかける`}
      >
        <div style={sizeStyle} className="relative">
          {/* Lottie コンテナ: ref を常にマウントして useEffect の loadAnimation に渡せるようにする */}
          <div
            ref={containerRef}
            style={{ ...sizeStyle, visibility: loadState === 'ready' ? 'visible' : 'hidden' }}
          />
          {loadState !== 'ready' && (
            <div
              style={sizeStyle}
              className={`absolute inset-0 flex items-center justify-center ${
                loadState === 'loading' ? 'text-slate-300' : ''
              }`}
            >
              <span className={loadState === 'loading' ? 'text-6xl animate-pulse' : 'text-7xl'}>
                {fallbackEmoji}
              </span>
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
