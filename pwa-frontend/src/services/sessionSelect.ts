import type { CardState } from '../types';

/**
 * 出題選抜の純関数群。
 *
 * 従来の startSession は「期限到来カードをシャッフルして20問」だけで、期限超過日数・
 * hintLevel・EaseFactor・弱点かどうかを一切考慮しない無優先ランダムだった。
 * ここに優先度スコアと弱点判定を切り出し、テスト可能かつ端末を跨いで一貫させる。
 */

/** 1セッションで導入する新規カードの上限（復習負荷の雪だるま防止）。 */
export const NEW_PER_SESSION = 10;

/** today から見た nextReview の超過日数（未来なら0）。JST日付文字列前提。 */
export function overdueDays(nextReview: string, today: string): number {
  const diff = (Date.parse(today) - Date.parse(nextReview)) / 86_400_000;
  return Math.max(0, Math.round(diff));
}

/**
 * card_states だけで判定できる弱点定義（answerLog非依存＝Supabase復元で端末を跨いで持続）。
 *   - hintLevel>=2   : 段階ヒントを2つ以上要している
 *   - easeFactor<=2.0 : 定着が悪くEFが下がっている
 *   - repetitions===0 かつ学習済み : 直近で誤答してリセットされた（未学習カードは除外）
 */
export function isWeakCard(card: CardState): boolean {
  return (
    card.hintLevel >= 2 ||
    card.easeFactor <= 2.0 ||
    (card.repetitions === 0 && card.lastReview !== '')
  );
}

/**
 * 復習カードの優先度スコア。高いほど先に出す。
 * 期限超過（最大30日で頭打ち）・ヒント段階・EFの低さを重み付けする。
 */
export function scoreCard(card: CardState, today: string): number {
  return (
    Math.min(overdueDays(card.nextReview, today), 30) * 2 +
    card.hintLevel * 3 +
    (2.5 - card.easeFactor) * 4
  );
}

/** 優先度スコア降順に並べ替える（同スコアは入力順を維持・入力配列は破壊しない）。 */
export function rankReviewCards(cards: CardState[], today: string): CardState[] {
  return cards
    .map((card, index) => ({ card, index, score: scoreCard(card, today) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.card);
}
