import type { CardState } from '../types';

/**
 * SM-2 アルゴリズム
 *
 * quality:
 *   5 = 正答 + 10秒未満（即答）
 *   4 = 正答 + 10-30秒（通常）
 *   3 = 正答 + 30秒超（迷って正答）
 *   1 = 不正解
 */
export function sm2Update(card: CardState, quality: number): CardState {
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
    updated.repetitions++;
  } else {
    // 不正解
    updated.repetitions = 0;
    updated.interval = 1;
  }

  // EaseFactor更新
  updated.easeFactor = Math.max(
    1.3,
    updated.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  );

  // 次回復習日を設定
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + updated.interval);
  updated.nextReview = nextDate.toISOString().split('T')[0]!;
  updated.lastReview = new Date().toISOString().split('T')[0]!;

  return updated;
}

/**
 * 回答結果からSM-2品質スコアを算出
 */
export function calculateQuality(isCorrect: boolean, responseTimeMs: number): number {
  if (!isCorrect) return 1;
  if (responseTimeMs < 10000) return 5;  // 10秒未満
  if (responseTimeMs < 30000) return 4;  // 30秒未満
  return 3;                               // 30秒以上
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
    nextReview: new Date().toISOString().split('T')[0]!,
    lastReview: '',
    hintLevel: 0,
    consecutiveCorrectAtZero: 0,
  };
}
