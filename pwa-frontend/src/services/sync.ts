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
  // synced === false のログを取得（boolean型で検索）
  const allLogs = await db.answerLog.toArray();
  const pending = allLogs.filter(log => log.synced === false || log.synced === 0 as unknown as boolean);

  console.log('[sync] 未同期ログ:', pending.length, '件 / 全ログ:', allLogs.length, '件');

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
    console.log('[sync] API応答:', JSON.stringify(res));
    if (res.success) {
      // 同期完了フラグを更新（各ログのIDで特定）
      const ids = pending.map(log => log.id!).filter(Boolean);
      for (const id of ids) {
        await db.answerLog.update(id, { synced: true });
      }
      return { synced: pending.length, failed: 0 };
    }
    console.warn('[sync] API失敗:', res.error);
    return { synced: 0, failed: pending.length };
  } catch (err) {
    console.error('[sync] 通信エラー:', err);
    return { synced: 0, failed: pending.length };
  }
}
