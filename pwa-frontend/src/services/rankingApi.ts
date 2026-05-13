// pwa-frontend/src/services/rankingApi.ts
// 同学年内ランキング API クライアント

import type { ApiResponse } from '../types';

const GAS_API_URL = import.meta.env.VITE_GAS_API_URL || '';

export type RankBand = 'top' | 'upper' | 'middle' | 'developing';

export interface MyRankingPayload {
  cohortName: string;
  cohortSize: number;
  myPercentile?: number;
  rankBand?: RankBand;
  available: boolean;
}

/**
 * GAS API: 同学年内の自分の位置を取得
 * 5名未満コホートや該当学生不在の場合は available: false で返る
 */
export async function fetchMyRanking(
  studentId: string
): Promise<ApiResponse<MyRankingPayload>> {
  if (!GAS_API_URL) {
    return { success: false, error: 'API URL not configured' };
  }
  if (!studentId) {
    return { success: false, error: 'studentId is required' };
  }

  const url = new URL(GAS_API_URL);
  url.searchParams.set('action', 'getMyRanking');
  url.searchParams.set('studentId', studentId);

  try {
    const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
