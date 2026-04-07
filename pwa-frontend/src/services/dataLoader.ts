import { db } from './db';
import type { Question } from '../types';

const DATA_URL = import.meta.env.BASE_URL + 'data/questions.json';

/**
 * データバージョン — questions.jsonを更新したら必ずインクリメントする
 * これによりIndexedDBの古いキャッシュが自動的に再読み込みされる
 */
const DATA_VERSION = 2; // v1→v2: 画像URL追加、解説更新
const VERSION_KEY = 'memoria-data-version';

/**
 * 問題データをIndexedDBに初期ロード
 * バージョンが変わった場合は強制再読み込み
 */
export async function loadQuestionsToCache(): Promise<number> {
  const currentVersion = localStorage.getItem(VERSION_KEY);
  const needsReload = currentVersion !== String(DATA_VERSION);

  if (needsReload) {
    // バージョン変更 → キャッシュクリア＆再読み込み
    console.log(`データ更新: v${currentVersion || '0'} → v${DATA_VERSION}`);
    await db.questionCache.clear();
  }

  const existingCount = await db.questionCache.count();
  if (existingCount > 0 && !needsReload) {
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
    localStorage.setItem(VERSION_KEY, String(DATA_VERSION));
    console.log(`問題データ: ${questions.length}問ロード (v${DATA_VERSION})`);
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
  localStorage.removeItem(VERSION_KEY);
  await db.questionCache.clear();
  return loadQuestionsToCache();
}
