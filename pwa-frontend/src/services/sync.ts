import { db } from './db';
import { submitAnswerBatch } from './api';

/**
 * 未同期の回答ログをGASに送信
 */
export async function syncPendingAnswers(
  studentId: string,
  department: string,
  grade: number,
  studentNumber?: string
): Promise<{ synced: number; failed: number }> {
  const pending = await db.answerLog
    .where('synced')
    .equals(0) // Dexieではbooleanは0/1
    .toArray();

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
    timestamp: log.timestamp,
  }));

  try {
    const res = await submitAnswerBatch(batch);
    if (res.success) {
      // 同期完了フラグを更新
      await db.answerLog
        .where('synced')
        .equals(0)
        .modify({ synced: true });
      return { synced: pending.length, failed: 0 };
    }
    return { synced: 0, failed: pending.length };
  } catch {
    return { synced: 0, failed: pending.length };
  }
}
