import type { CardState } from '../../types';

/**
 * ローカルとクラウドのカード状態をマージする。
 * 規則: updatedAt（ISO時刻）が新しい方を採用。両方に updatedAt があれば時刻比較なので
 * 同日マルチデバイスでも正しく解決する（従来の日単位比較では片方の更新が必ず消えていた）。
 * updatedAt が欠落（レガシー未移行）の場合のみ lastReview（YYYY-MM-DD）比較にフォールバック。
 * 同値・比較不能はローカル優先（その端末で学習中の状態を壊さない）。
 * 返り値は「Dexieにputすべき全カード」（ローカル既存＋クラウド由来の採用分）。
 */
export function mergeCardStates(local: CardState[], cloud: CardState[]): CardState[] {
  const byId = new Map<string, CardState>();
  for (const c of local) byId.set(c.questionId, c);
  for (const remote of cloud) {
    const mine = byId.get(remote.questionId);
    if (!mine) {
      byId.set(remote.questionId, remote);
    } else if (isRemoteNewer(remote, mine)) {
      byId.set(remote.questionId, remote);
    }
  }
  return [...byId.values()];
}

function isRemoteNewer(remote: CardState, mine: CardState): boolean {
  if (remote.updatedAt && mine.updatedAt) {
    return remote.updatedAt > mine.updatedAt; // ISO8601は辞書順比較がそのまま時刻順
  }
  // レガシー（updatedAt未移行）は従来の日付比較。空文字（未学習）は常に最古扱い。
  return remote.lastReview > mine.lastReview;
}
