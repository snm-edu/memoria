/**
 * 効果音（SFX）マネージャー — 正答/誤答などの短い音を BGM と重ねて再生
 *
 * - BGM とは独立した HTMLAudioElement を都度生成して再生
 * - ミュート状態は BgmManager と共有（ユーザの「音オン/オフ」は1本化）
 * - 初回ロード時にファイルをプリロード
 */

import { bgm } from './bgm';

export type SfxName = 'correct' | 'incorrect';

const SFX_FILES: Record<SfxName, string> = {
  correct: 'audio/quiz_correct.mp3',
  incorrect: 'audio/quiz_incorrect.mp3',
};

const SFX_VOLUME = 0.6;

class SfxManager {
  private preloaded: Partial<Record<SfxName, HTMLAudioElement>> = {};

  constructor() {
    // 初回ロード時にブラウザキャッシュへ投入
    const basePath = import.meta.env.BASE_URL || '/';
    for (const [name, path] of Object.entries(SFX_FILES) as [SfxName, string][]) {
      const audio = new Audio(`${basePath}${path}`);
      audio.preload = 'auto';
      this.preloaded[name] = audio;
    }
  }

  play(name: SfxName): void {
    if (bgm.isMuted) return;
    const basePath = import.meta.env.BASE_URL || '/';
    // 連続再生で途切れないよう都度新しいインスタンスを生成
    // （ブラウザキャッシュ済みなので追加のネットワーク取得は発生しない）
    const audio = new Audio(`${basePath}${SFX_FILES[name]}`);
    audio.volume = SFX_VOLUME;
    audio.play().catch(() => {
      // autoplay blocked もしくは未アンロック — 無視（ユーザ操作直後のためほぼ発生しない）
    });
  }
}

export const sfx = new SfxManager();
