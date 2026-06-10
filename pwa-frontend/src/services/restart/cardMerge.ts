import type { CardState } from '../../types';

/**
 * ローカルとクラウドのカード状態をマージする。
 * 規則: lastReview（YYYY-MM-DD）が新しい方を採用。同値・比較不能はローカル優先
 * （その端末で学習中の状態を壊さない）。
 * 返り値は「Dexieにputすべき全カード」（ローカル既存＋クラウド由来の採用分）。
 */
export function mergeCardStates(local: CardState[], cloud: CardState[]): CardState[] {
  const byId = new Map<string, CardState>();
  for (const c of local) byId.set(c.questionId, c);
  for (const remote of cloud) {
    const mine = byId.get(remote.questionId);
    if (!mine) {
      byId.set(remote.questionId, remote);
    } else if (remote.lastReview > mine.lastReview) {
      // YYYY-MM-DD は辞書順比較がそのまま日付比較になる。空文字（未学習）は常に最古扱い。
      byId.set(remote.questionId, remote);
    }
  }
  return [...byId.values()];
}
