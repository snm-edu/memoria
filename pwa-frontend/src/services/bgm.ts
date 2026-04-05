/**
 * BGM マネージャー — シングルトンで全画面の BGM を統合管理
 *
 * - クロスフェード切り替え
 * - ループ再生（finish-bgm 以外）
 * - ミュート状態を localStorage に永続化
 * - モバイル autoplay 制限を考慮（ユーザ操作後に再生開始）
 */

/** 利用可能なトラック名 */
export type BgmTrack = 'home' | 'quiz1' | 'quiz2' | 'quiz3' | 'finish' | 'none';

const TRACK_FILES: Record<Exclude<BgmTrack, 'none'>, string> = {
  home: 'audio/home-bgm.mp3',
  quiz1: 'audio/quiz-bgm1.mp3',
  quiz2: 'audio/quiz-bgm2.mp3',
  quiz3: 'audio/quiz-bgm3.mp3',
  finish: 'audio/finish-bgm.mp3',
};

/** finish-bgm 以外はループ */
const LOOP_TRACKS: Set<BgmTrack> = new Set(['home', 'quiz1', 'quiz2', 'quiz3']);

const STORAGE_KEY = 'memoria-bgm-muted';
const FADE_MS = 600; // クロスフェード時間
const TARGET_VOLUME = 0.25; // 最大音量（控えめ）

class BgmManager {
  private current: HTMLAudioElement | null = null;
  private currentTrack: BgmTrack = 'none';
  private muted: boolean;
  private unlocked = false; // ユーザ操作後に true
  private pendingTrack: BgmTrack = 'none';
  private fadingOut = false;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.muted = localStorage.getItem(STORAGE_KEY) === 'true';
    // ユーザ操作でオーディオをアンロック
    const unlock = () => {
      this.unlocked = true;
      // 保留中のトラックがあれば再生開始
      if (this.pendingTrack !== 'none') {
        this.play(this.pendingTrack);
      }
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchstart', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
  }

  /** ミュート状態を取得 */
  get isMuted(): boolean {
    return this.muted;
  }

  /** 現在のトラック名を取得 */
  get track(): BgmTrack {
    return this.currentTrack;
  }

  /** ミュート切り替え */
  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(STORAGE_KEY, String(this.muted));
    if (this.current) {
      if (this.muted) {
        this.current.volume = 0;
      } else {
        this.current.volume = TARGET_VOLUME;
      }
    }
    this.notify();
    return this.muted;
  }

  /** 指定トラックを再生（クロスフェード） */
  play(track: BgmTrack): void {
    if (track === this.currentTrack && !this.fadingOut) return;
    if (track === 'none') {
      this.stop();
      return;
    }

    // モバイルで未アンロックの場合は保留
    if (!this.unlocked) {
      this.pendingTrack = track;
      this.currentTrack = track;
      this.notify();
      return;
    }

    this.pendingTrack = 'none';

    // 現在再生中のトラックをフェードアウト
    if (this.current) {
      this.fadeOut(this.current);
    }

    // 新しいトラック
    const basePath = import.meta.env.BASE_URL || '/';
    const src = `${basePath}${TRACK_FILES[track]}`;
    const audio = new Audio(src);
    audio.loop = LOOP_TRACKS.has(track);
    audio.volume = this.muted ? 0 : 0;
    audio.preload = 'auto';

    this.current = audio;
    this.currentTrack = track;

    audio.play().then(() => {
      this.fadeIn(audio);
    }).catch((err) => {
      // autoplay blocked — 次のユーザ操作で再試行
      console.warn('BGM autoplay blocked:', err);
      this.pendingTrack = track;
    });

    this.notify();
  }

  /** 停止（フェードアウト） */
  stop(): void {
    if (this.current) {
      this.fadeOut(this.current);
      this.current = null;
    }
    this.currentTrack = 'none';
    this.pendingTrack = 'none';
    this.notify();
  }

  /** 状態変更リスナー登録 */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  private fadeIn(audio: HTMLAudioElement): void {
    if (this.muted) return;
    const steps = 20;
    const stepMs = FADE_MS / steps;
    const increment = TARGET_VOLUME / steps;
    let vol = 0;
    const timer = setInterval(() => {
      vol = Math.min(vol + increment, TARGET_VOLUME);
      try { audio.volume = vol; } catch { /* disposed */ }
      if (vol >= TARGET_VOLUME) clearInterval(timer);
    }, stepMs);
  }

  private fadeOut(audio: HTMLAudioElement): void {
    this.fadingOut = true;
    const steps = 15;
    const stepMs = FADE_MS / steps;
    const startVol = audio.volume;
    const decrement = startVol / steps;
    let vol = startVol;
    const timer = setInterval(() => {
      vol = Math.max(vol - decrement, 0);
      try { audio.volume = vol; } catch { /* disposed */ }
      if (vol <= 0) {
        clearInterval(timer);
        audio.pause();
        audio.src = '';
        this.fadingOut = false;
      }
    }, stepMs);
  }
}

/** グローバルシングルトン */
export const bgm = new BgmManager();
