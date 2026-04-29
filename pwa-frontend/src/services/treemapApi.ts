import type { ApiResponse } from '../types';
import type { TreemapResponse } from '../components/dashboard/treemap/treemapTypes';

const GAS_API_URL = import.meta.env.VITE_GAS_API_URL || '';

interface CurriculumData {
  department: string;
  grades: Record<string, { categories: string[]; maxDifficulty: number }>;
}

/**
 * 学生プロファイルから curriculum.json を読み込み、
 * その学年までに累積される大分類リストを返す。
 *
 * 例: grade=2 の場合、grade 1 と 2 の categories の和集合を返す。
 */
export async function loadAllowedCategories(
  department: string,
  grade: number
): Promise<string[]> {
  const url = `${import.meta.env.BASE_URL || '/'}data/curriculum/${department}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`curriculum.json fetch failed: ${res.status}`);
  const data = (await res.json()) as CurriculumData;

  const accumulated = new Set<string>();
  for (let g = 1; g <= grade; g++) {
    const entry = data.grades[String(g)];
    if (!entry) continue;
    for (const cat of entry.categories) accumulated.add(cat);
  }
  return Array.from(accumulated);
}

/**
 * GAS API: ツリーマップ取得
 *
 * studentNumber を渡すと GAS 側で学籍番号で集約され、端末・UUID 変更を跨いだ
 * 全学習履歴がまとまる (教員 Looker と共通言語化)。空文字なら studentId フォールバック。
 */
export async function fetchStudentTreemap(params: {
  studentId: string;
  studentNumber: string;
  department: string;
  grade: number;
}): Promise<ApiResponse<TreemapResponse>> {
  if (!GAS_API_URL) {
    return { success: false, error: 'API URL not configured' };
  }

  let categories: string[];
  try {
    categories = await loadAllowedCategories(params.department, params.grade);
  } catch (err) {
    return { success: false, error: 'curriculum 読み込み失敗: ' + String(err) };
  }
  if (categories.length === 0) {
    return { success: false, error: '対象学年の出題範囲が空です' };
  }

  const url = new URL(GAS_API_URL);
  url.searchParams.set('action', 'getStudentTreemap');
  url.searchParams.set('studentId', params.studentId);
  url.searchParams.set('studentNumber', params.studentNumber);
  url.searchParams.set('department', params.department);
  url.searchParams.set('grade', String(params.grade));
  url.searchParams.set('categories', categories.join(','));

  try {
    const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * GAS API (POST): 1学生分の category_stats を即時再計算してから取得。
 * ⟳ ボタンから呼び出す。GAS の同時実行制限・短期連打を避けるため、
 * 呼び出し側でデバウンス (60秒) を実装する。
 */
export async function refreshStudentTreemap(params: {
  studentId: string;
  studentNumber: string;
  department: string;
  grade: number;
}): Promise<ApiResponse<TreemapResponse>> {
  if (!GAS_API_URL) {
    return { success: false, error: 'API URL not configured' };
  }

  let categories: string[];
  try {
    categories = await loadAllowedCategories(params.department, params.grade);
  } catch (err) {
    return { success: false, error: 'curriculum 読み込み失敗: ' + String(err) };
  }
  if (categories.length === 0) {
    return { success: false, error: '対象学年の出題範囲が空です' };
  }

  try {
    const res = await fetch(GAS_API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'refreshStudentTreemap',
        studentId: params.studentId,
        studentNumber: params.studentNumber,
        department: params.department,
        grade: params.grade,
        categories,
      }),
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
