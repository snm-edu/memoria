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
 */
export async function fetchStudentTreemap(params: {
  studentId: string;
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
