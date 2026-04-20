import { db } from './db';
import { submitAnswerBatch } from './api';
import type { StudentType } from '../types';

/**
 * 未同期の回答ログをGASに送信
 */
export async function syncPendingAnswers(
  studentId: string,
  department: string,
  grade: number,
  studentNumber?: string,
  studentType: StudentType = 'enrolled'
): Promise<{ synced: number; failed: number }> {
  // 全ログから未同期を抽出
  const allLogs = await db.answerLog.toArray();
  const pending = allLogs.filter(log => !log.synced);

  console.log('[sync] 未同期:', pending.length, '件');

  if (pending.length === 0) {
    return { synced: 0, failed: 0 };
  }

  const batch = pending.map((log) => ({
    studentId,
    studentNumber: studentNumber || '',
    questionId: log.questionId,
    answer: log.selectedAnswer,
    isCorrect: log.isCorrect,
    responseTime: log.responseTimeMs,
    department,
    grade,
    studentType,
    timestamp: log.timestamp,
  }));

  try {
    const res = await submitAnswerBatch(batch);
    console.log('[sync] API応答:', JSON.stringify(res).substring(0, 200));

    if (res.success) {
      // 同期完了フラグを更新
      const ids = pending.map(log => log.id).filter((id): id is number => id !== undefined);
      console.log('[sync] 更新するID:', ids.length, '件');

      // 一括更新
      await db.transaction('rw', db.answerLog, async () => {
        for (const id of ids) {
          await db.answerLog.update(id, { synced: true });
        }
      });

      // 更新確認
      const remaining = (await db.answerLog.toArray()).filter(log => !log.synced);
      console.log('[sync] 更新後の未同期:', remaining.length, '件');

      return { synced: pending.length, failed: 0 };
    }
    console.warn('[sync] API失敗:', res.error);
    return { synced: 0, failed: pending.length };
  } catch (err) {
    console.error('[sync] エラー:', err);
    return { synced: 0, failed: pending.length };
  }
}
