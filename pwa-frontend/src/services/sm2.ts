import type { CardState } from '../types';
import { localDateString, addDays } from './date';

/**
 * SM-2 アルゴリズム
 *
 * quality:
 *   5 = 正答 + 10秒未満（即答）
 *   4 = 正答 + 10-30秒（通常）
 *   3 = 正答 + 30秒超（迷って正答）
 *   1 = 不正解
 *
 * quality はヒント量で補正される（adjustQualityForHint）。ヒントに頼った正答を
 * 「自力想起」と同じスケジュール進行にしないため。
 */

/** EaseFactor 下限（SM-2正典）。 */
export const MIN_EF = 1.3;
/** EaseFactor 上限。国試対策では過剰な間隔延長を避けるため既定値で頭打ちにする。 */
export const MAX_EF = 2.5;
/** interval 上限（日）。試験日までの現実的な復習間隔・爆発防止。 */
export const MAX_INTERVAL_DAYS = 180;

/** EaseFactor を許容範囲にクランプする。 */
export function clampEF(ef: number): number {
  return Math.max(MIN_EF, Math.min(MAX_EF, ef));
}

export function sm2Update(card: CardState, quality: number, now: Date = new Date()): CardState {
  const updated = { ...card };

  if (quality >= 3) {
    // 正答
    if (updated.repetitions === 0) {
      updated.interval = 1;
    } else if (updated.repetitions === 1) {
      updated.interval = 6;
    } else {
      updated.interval = Math.round(updated.interval * updated.easeFactor);
    }
    updated.interval = Math.min(updated.interval, MAX_INTERVAL_DAYS);
    updated.repetitions++;
    // EaseFactor更新は正答時のみ（正典SM-2: 誤答ではEF不変・repetitionsのみリセット）
    updated.easeFactor = clampEF(
      updated.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    );
  } else {
    // 不正解: repetitions と interval のみリセット、EaseFactor は変更しない
    updated.repetitions = 0;
    updated.interval = 1;
  }

  updated.nextReview = localDateString(addDays(now, updated.interval));
  updated.lastReview = localDateString(now);

  return updated;
}

/**
 * 回答結果からSM-2品質スコアを算出（ヒント量は考慮しない素点）
 */
export function calculateQuality(isCorrect: boolean, responseTimeMs: number): number {
  if (!isCorrect) return 1;
  if (responseTimeMs < 10000) return 5;  // 10秒未満
  if (responseTimeMs < 30000) return 4;  // 30秒未満
  return 3;                               // 30秒以上
}

/**
 * ヒント量で品質スコアを補正する。
 *
 * ヒントに頼った正答は自力想起の質が低いため、間隔進行を抑える。
 *   hintLevel 0     : 素点のまま（自力）
 *   hintLevel 1〜3  : 上限4（解説付き・3択・キーワードは補助つき想起）
 *   hintLevel 4以上 : 上限2（2択・穴埋め・解答表示＝ほぼ答えを見た → 自力想起とみなさない）
 * 素点を下げる方向にのみ働く（不正解=1 は常に1のまま）。
 */
export function adjustQualityForHint(baseQuality: number, hintLevel: number): number {
  if (hintLevel >= 4) return Math.min(baseQuality, 2);
  if (hintLevel >= 1) return Math.min(baseQuality, 4);
  return baseQuality;
}

/**
 * 新しいカード状態を作成
 */
export function createCardState(questionId: string): CardState {
  return {
    questionId,
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReview: localDateString(),
    lastReview: '',
    hintLevel: 0,
    consecutiveCorrectAtZero: 0,
  };
}

/**
 * 汚染・破損したカード状態を許容範囲へ是正する（マイグレーション/防御用）。
 *
 * 過去のバグ（EFペナルティ符号反転・interval複利爆発）で EF>2.5・interval巨大・
 * nextReview が遠未来（例: 西暦5081年）になったカードを、キャップ内へ丸める。
 * nextReview は「今日+MAX_INTERVAL_DAYS」を超える場合のみ引き戻す（正常カードは不変）。
 */
export function sanitizeCardState(card: CardState, now: Date = new Date()): CardState {
  const cap = localDateString(addDays(now, MAX_INTERVAL_DAYS));
  const nextReview =
    card.nextReview && card.nextReview > cap ? cap : card.nextReview;
  return {
    ...card,
    easeFactor: clampEF(card.easeFactor),
    interval: Math.min(Math.max(card.interval, 0), MAX_INTERVAL_DAYS),
    nextReview,
  };
}
