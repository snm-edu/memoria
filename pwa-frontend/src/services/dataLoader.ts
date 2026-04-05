import { db } from './db';
import type { Question } from '../types';

const DATA_URL = import.meta.env.BASE_URL + 'data/questions.json';

/**
 * 問題データをIndexedDBに初期ロード
 * 既にデータがある場合はスキップ
 */
export async function loadQuestionsToCache(): Promise<number> {
  const existingCount = await db.questionCache.count();
  if (existingCount > 0) {
    return existingCount;
  }

  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) {
      console.error('問題データ取得失敗:', res.status);
      return 0;
    }

    const rawData: unknown[] = await res.json();
    const questions = (rawData as Question[]).filter(
      (q) => q.correct_answer && q.correct_answer.length > 0
    );

    await db.questionCache.bulkPut(questions);
    console.log(`✅ ${questions.length}問をIndexedDBにロード`);
    return questions.length;
  } catch (err) {
    console.error('問題データロードエラー:', err);
    return 0;
  }
}

/**
 * 問題データを強制再読み込み
 */
export async function reloadQuestions(): Promise<number> {
  await db.questionCache.clear();
  return loadQuestionsToCache();
}
