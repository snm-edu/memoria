/**
 * 学年別カリキュラムに基づく出題範囲フィルター（JSON駆動版）
 *
 * public/data/curriculum/{dept}.json を fetch + メモリキャッシュで提供。
 */

import type { Department } from '../types';

interface GradeData {
  categories: string[];
  maxDifficulty: number;
}
interface CurriculumData {
  department: string;
  grades: Record<string, GradeData>;
}

// メモリキャッシュ
const curriculumCache: Partial<Record<Department, CurriculumData>> = {};

// BASE_URL を取得（Vite の場合）。末尾スラッシュを正規化
const _rawBase = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.BASE_URL
  : '/';
const BASE = _rawBase.endsWith('/') ? _rawBase : _rawBase + '/';

export async function loadCurriculum(dept: Department): Promise<CurriculumData | null> {
  if (curriculumCache[dept]) return curriculumCache[dept]!;
  try {
    const res = await fetch(`${BASE}data/curriculum/${dept}.json`);
    if (!res.ok) return null;
    const data = await res.json() as CurriculumData;
    curriculumCache[dept] = data;
    return data;
  } catch {
    return null;
  }
}

// curriculum 取得失敗時は null を返す（呼び出し元で「全問許可」にフォールバックさせる）
export async function getCategoriesForGrade(grade: number, department?: Department): Promise<string[] | null> {
  const dept = department || 'nursing';
  const curriculum = await loadCurriculum(dept);
  if (!curriculum) return null;
  // 学年データがない場合は grade:3（最終学年）へフォールバック
  const gradeData = curriculum.grades[String(grade)] ?? curriculum.grades['3'];
  return gradeData?.categories ?? [];
}

// curriculum 取得失敗時は null を返す（呼び出し元で難易度制限なしにフォールバックさせる）
export async function getMaxDifficultyForGrade(grade: number, department?: Department): Promise<number | null> {
  const dept = department || 'nursing';
  const curriculum = await loadCurriculum(dept);
  if (!curriculum) return null;
  const gradeData = curriculum.grades[String(grade)] ?? curriculum.grades['3'];
  return gradeData?.maxDifficulty ?? null;
}

export async function isCategoryAvailableForGrade(category: string, grade: number, department?: Department): Promise<boolean> {
  const categories = await getCategoriesForGrade(grade, department);
  if (categories === null) return true; // 取得失敗時はすべて許可
  return categories.includes(category);
}
