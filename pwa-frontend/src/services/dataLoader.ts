import { db } from './db';
import type { Question } from '../types';
import type { Department } from '../config/departments';

// manifest のスキーマ
interface ManifestDept {
  id: string;
  version: number;
  count: number;
  path: string;
  checksum?: string;
  lastUpdated: string;
}
interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  departments: ManifestDept[];
}

const BASE = import.meta.env.BASE_URL;
const MANIFEST_URL = BASE + 'data/manifest.json';
const VERSION_KEY_PREFIX = 'memoria-data-version-'; // + dept

// manifest をキャッシュ（セッション中に一度だけ fetch）
let manifestCache: Manifest | null = null;

// 並列実行ガード: 同一学科に対して同時に複数の ensureCacheFor が走るのを防ぐ
const inflight = new Map<string, Promise<number>>();

export async function loadManifest(): Promise<Manifest | null> {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) {
      console.error('manifest.json 取得失敗:', res.status);
      return null;
    }
    manifestCache = await res.json() as Manifest;
    return manifestCache;
  } catch (err) {
    console.error('manifest.json ロードエラー:', err);
    return null;
  }
}

export async function loadQuestionsForDepartment(dept: Department): Promise<number> {
  const manifest = await loadManifest();
  if (!manifest) {
    // manifest が取得できない場合は既存キャッシュを使う
    const count = await db.questionCache.where('department').equals(dept).count();
    return count;
  }

  const deptMeta = manifest.departments.find(d => d.id === dept);
  if (!deptMeta) {
    console.error(`manifest に学科 ${dept} が見つかりません`);
    return 0;
  }

  // バージョン比較
  const storedVersion = localStorage.getItem(VERSION_KEY_PREFIX + dept);
  const needsReload = storedVersion !== String(deptMeta.version);

  if (needsReload) {
    console.log(`データ更新: ${dept} v${storedVersion ?? '0'} → v${deptMeta.version}`);
  }

  // delete 前に existingCount を取得（fetch 失敗時のフォールバック用）
  const existingCount = await db.questionCache.where('department').equals(dept).count();

  if (existingCount > 0 && !needsReload) {
    return existingCount;
  }

  try {
    const url = BASE + 'data/' + deptMeta.path;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`${dept} 問題データ取得失敗:`, res.status);
      return existingCount; // fetch 失敗: 既存データ維持
    }

    const rawData: unknown[] = await res.json();

    // Array バリデーション
    if (!Array.isArray(rawData)) {
      console.error(`${dept}: 不正なデータ形式`);
      return existingCount;
    }

    const questions = (rawData as Question[]).filter(
      (q) => q.correct_answer && q.correct_answer.length > 0
        && !q.question_id.includes('不備問題')
    );

    // fetch 成功後にトランザクション内で delete → bulkPut をアトミックに実行
    await db.transaction('rw', db.questionCache, async () => {
      if (needsReload) {
        await db.questionCache.where('department').equals(dept).delete();
      }
      await db.questionCache.bulkPut(questions);
    });

    localStorage.setItem(VERSION_KEY_PREFIX + dept, String(deptMeta.version));
    console.log(`${dept}: ${questions.length}問ロード (v${deptMeta.version})`);
    return questions.length;
  } catch (err) {
    console.error(`${dept} 問題データロードエラー:`, err);
    return existingCount;
  }
}

export async function ensureCacheFor(dept: Department): Promise<number> {
  const existing = inflight.get(dept);
  if (existing) return existing;
  const promise = loadQuestionsForDepartment(dept).finally(() => {
    inflight.delete(dept);
  });
  inflight.set(dept, promise);
  return promise;
}

export async function reloadDepartment(dept: Department): Promise<number> {
  localStorage.removeItem(VERSION_KEY_PREFIX + dept);
  await db.questionCache.where('department').equals(dept).delete();
  return loadQuestionsForDepartment(dept);
}

// 後方互換: 既存の呼び出し元（loadQuestionsToCache）向け
// profile が取得できない場合は何もしない（呼び出し元で dept を渡すように移行）
export async function loadQuestionsToCache(dept?: Department): Promise<number> {
  if (!dept) return 0;
  return ensureCacheFor(dept);
}

// 後方互換
export async function reloadQuestions(dept?: Department): Promise<number> {
  if (!dept) return 0;
  return reloadDepartment(dept);
}
