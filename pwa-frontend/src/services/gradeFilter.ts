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

// BASE_URL を取得（Vite の場合）
const BASE = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.BASE_URL
  : '/';

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

export async function getCategoriesForGrade(grade: number, department?: Department): Promise<string[]> {
  const dept = department || 'nursing';
  const curriculum = await loadCurriculum(dept);
  if (!curriculum) return [];
  const gradeData = curriculum.grades[String(grade)] ?? curriculum.grades['3'];
  return gradeData?.categories ?? [];
}

export async function getMaxDifficultyForGrade(grade: number, department?: Department): Promise<number> {
  const dept = department || 'nursing';
  const curriculum = await loadCurriculum(dept);
  if (!curriculum) return 5;
  const gradeData = curriculum.grades[String(grade)] ?? curriculum.grades['3'];
  return gradeData?.maxDifficulty ?? 5;
}

export async function isCategoryAvailableForGrade(category: string, grade: number, department?: Department): Promise<boolean> {
  const categories = await getCategoriesForGrade(grade, department);
  return categories.includes(category);
}
