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
const FADE_MS = 600;
const TARGET_VOLUME = 0.25;

class BgmManager {
  private current: HTMLAudioElement | null = null;
  private currentTrack: BgmTrack = 'none';
  private muted: boolean;
  private unlocked = false;
  private pendingTrack: BgmTrack = 'none';
  private fadingOut = false;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.muted = localStorage.getItem(STORAGE_KEY) === 'true';
    // ユーザ操作でオーディオをアンロック
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      // ミュートでなく保留中のトラックがあれば再生開始
      if (!this.muted && this.pendingTrack !== 'none') {
        this.startAudio(this.pendingTrack);
      }
    };
    // 複数回呼ばれても安全なように once は使わない
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('click', unlock);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get track(): BgmTrack {
    return this.currentTrack;
  }

  /** ミュート切り替え */
  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(STORAGE_KEY, String(this.muted));

    // このクリック自体がユーザ操作なのでアンロック
    this.unlocked = true;

    if (this.muted) {
      // ミュートにする: 再生中なら停止
      if (this.current) {
        this.current.pause();
        this.current.src = '';
        this.current = null;
      }
      if (this.fadeTimer) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = null;
      }
      this.fadingOut = false;
    } else {
      // ミュート解除: 現在のトラックを再生開始
      const trackToPlay = this.currentTrack !== 'none' ? this.currentTrack : this.pendingTrack;
      if (trackToPlay !== 'none') {
        this.startAudio(trackToPlay);
      }
    }

    this.notify();
    return this.muted;
  }

  /** 指定トラックを再生（クロスフェード） */
  play(track: BgmTrack): void {
    if (track === 'none') {
      this.stop();
      return;
    }

    // 同じトラックが既に再生中ならスキップ
    if (track === this.currentTrack && this.current && !this.fadingOut) return;

    this.currentTrack = track;

    // ミュート中は再生せずトラック名だけ記録
    if (this.muted) {
      this.notify();
      return;
    }

    // モバイルで未アンロックの場合は保留
    if (!this.unlocked) {
      this.pendingTrack = track;
      this.notify();
      return;
    }

    this.startAudio(track);
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

  /** 実際にオーディオ再生を開始する内部メソッド */
  private startAudio(track: BgmTrack): void {
    if (track === 'none') return;

    // 現在再生中のトラックをフェードアウト
    if (this.current) {
      this.fadeOut(this.current);
    }

    this.pendingTrack = 'none';

    const basePath = import.meta.env.BASE_URL || '/';
    const src = `${basePath}${TRACK_FILES[track]}`;
    const audio = new Audio(src);
    audio.loop = LOOP_TRACKS.has(track);
    audio.volume = 0;
    audio.preload = 'auto';

    this.current = audio;
    this.currentTrack = track;

    audio.play().then(() => {
      this.fadeIn(audio);
    }).catch((err) => {
      console.warn('BGM autoplay blocked:', err);
      this.pendingTrack = track;
    });
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  private fadeIn(audio: HTMLAudioElement): void {
    if (this.muted) return;
    // 前のフェードタイマーをクリア
    if (this.fadeTimer) clearInterval(this.fadeTimer);

    const steps = 20;
    const stepMs = FADE_MS / steps;
    const increment = TARGET_VOLUME / steps;
    let vol = 0;
    this.fadeTimer = setInterval(() => {
      vol = Math.min(vol + increment, TARGET_VOLUME);
      try { audio.volume = vol; } catch { /* disposed */ }
      if (vol >= TARGET_VOLUME) {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
      }
    }, stepMs);
  }

  private fadeOut(audio: HTMLAudioElement): void {
    this.fadingOut = true;
    const steps = 15;
    const stepMs = FADE_MS / steps;
    const startVol = audio.volume;
    if (startVol <= 0) {
      // すでに無音なら即停止
      audio.pause();
      audio.src = '';
      this.fadingOut = false;
      return;
    }
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
