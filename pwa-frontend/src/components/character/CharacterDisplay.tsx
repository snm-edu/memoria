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
  context: MessageContext;
  size?: number;
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

export function CharacterDisplay({ stage, fallbackEmoji, fallbackName, context, size = 200 }: Props) {
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

  // メッセージプールロード
  useEffect(() => {
    let cancelled = false;
    getMessagesForStage(stage).then(msgs => {
      if (!cancelled) setPool(msgs);
    });
    return () => {
      cancelled = true;
    };
  }, [stage]);

  // 初回 & プール変更時にメッセージを選定
  useEffect(() => {
    if (pool.length === 0) {
      setCurrentMsg(null);
      return;
    }
    const msg = selectMessage(stage, context, pool);
    setCurrentMsg(msg);
    // 少し遅延して吹き出しをフェードイン
    const t = setTimeout(() => setBubbleVisible(true), 400);
    return () => clearTimeout(t);
  }, [pool, stage]);

  function refreshMessage() {
    if (pool.length === 0) return;
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
          {currentMsg ? applyTemplate(currentMsg, context) : ''}
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
        {loadState === 'ready' ? (
          <div ref={containerRef} style={sizeStyle} />
        ) : loadState === 'loading' ? (
          <div style={sizeStyle} className="flex items-center justify-center text-slate-300">
            <span className="text-6xl animate-pulse">{fallbackEmoji}</span>
          </div>
        ) : (
          <div style={sizeStyle} className="flex items-center justify-center">
            <span className="text-7xl">{fallbackEmoji}</span>
          </div>
        )}
      </button>
    </div>
  );
}
