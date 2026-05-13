// pwa-frontend/src/config/examDates.ts
// 国家試験日程の概算と、学生 (department × grade) からの残日数算出

import type { Department } from './departments';

/**
 * 各学科の国家試験 概算開催日 (月日)
 *
 * 公式日程は前年9月頃に厚労省から公示されるため、それまでは例年傾向に基づく推定値を使う。
 * 公示後は本ファイルの値を更新するか、年度別マップに切り替える運用。
 *
 * 例年の傾向:
 * - 看護師国家試験: 2月第3日曜日付近 (例: 2024-02-11, 2025-02-16, 2026-02-15)
 * - 臨床工学技士国家試験: 3月第1日曜日付近 (例: 2024-03-03, 2025-03-02)
 * - 歯科衛生士国家試験: 3月第1日曜日付近 (例: 2024-03-03, 2025-03-02)
 * - 視能訓練士国家試験: 2月最終木曜日付近 (例: 2024-02-22, 2025-02-20)
 */
export const EXAM_DATE_ESTIMATES: Record<Department, { month: number; day: number }> = {
  nursing: { month: 2, day: 15 },
  clinical_eng: { month: 3, day: 3 },
  dental_hyg: { month: 3, day: 3 },
  orthoptist: { month: 2, day: 22 },
};

export const EXAM_NAMES: Record<Department, string> = {
  nursing: '看護師国家試験',
  clinical_eng: '臨床工学技士国家試験',
  dental_hyg: '歯科衛生士国家試験',
  orthoptist: '視能訓練士国家試験',
};

/**
 * 学生 (department × grade) の次回受験する国試の Date を返す。
 *
 * 学年度判定: 4月-3月。4月以降は当年度として扱う。
 * 卒業年度 = 入学年度 + 3 (3年制前提)
 * 国試年 = 卒業する年 (= enrollmentYear + 3)
 */
export function computeNextExamDate(
  department: Department,
  grade: number,
  now: Date = new Date()
): Date {
  const date = EXAM_DATE_ESTIMATES[department];
  const month = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // 4月以降は当年度、1-3月は前年度
  const academicYear = month >= 4 ? currentYear : currentYear - 1;
  const enrollmentYear = academicYear - (grade - 1);
  const examYear = enrollmentYear + 3;

  return new Date(examYear, date.month - 1, date.day);
}

/**
 * 次回国試までの残り日数 (整数、当日 = 0)
 */
export function daysUntilExam(
  department: Department,
  grade: number,
  now: Date = new Date()
): number {
  const examDate = computeNextExamDate(department, grade, now);
  const diff = examDate.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * 残り日数を「N年Mヶ月D日」形式に整形する。
 * 30日未満は「あとN日」、当日は「いよいよ本日」、過ぎていれば「終了」。
 */
export function formatExamCountdown(
  department: Department,
  grade: number,
  now: Date = new Date()
): string {
  const days = daysUntilExam(department, grade, now);
  if (days < 0) return '終了';
  if (days === 0) return 'いよいよ本日';
  if (days < 30) return `あと${days}日`;

  // 365/30 で大まかに年月換算 (うるう年/月ごとの誤差は許容)
  const years = Math.floor(days / 365);
  const remainAfterYears = days - years * 365;
  const months = Math.floor(remainAfterYears / 30);
  const remainDays = remainAfterYears - months * 30;

  const parts: string[] = [];
  if (years > 0) parts.push(`${years}年`);
  if (months > 0) parts.push(`${months}ヶ月`);
  if (remainDays > 0 || parts.length === 0) parts.push(`${remainDays}日`);
  return parts.join('');
}
