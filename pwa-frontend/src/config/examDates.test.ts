import { describe, it, expect } from 'vitest';
import { computeNextExamDate, daysUntilExam, formatExamCountdown } from './examDates';

// 臨床工学技士の想定日は 3/3、看護は 2/15（EXAM_DATE_ESTIMATES）
const JULY_2026 = new Date(2026, 6, 15); // 2026-07-15（学年度2026）

describe('computeNextExamDate — 在校生（学年から逆算）', () => {
  it('3年生は今年度末＝翌年3月の国試を指す', () => {
    const d = computeNextExamDate('clinical_eng', 3, 'enrolled', JULY_2026);
    expect(d).toEqual(new Date(2027, 2, 3));
  });

  it('1年生は2年後の国試を指す', () => {
    const d = computeNextExamDate('clinical_eng', 1, 'enrolled', JULY_2026);
    expect(d).toEqual(new Date(2029, 2, 3));
  });

  it('1-3月は前年度扱いになる（3年生の直前期）', () => {
    const jan = new Date(2027, 0, 20); // 2027-01-20 は学年度2026
    expect(computeNextExamDate('clinical_eng', 3, 'enrolled', jan)).toEqual(new Date(2027, 2, 3));
  });
});

describe('computeNextExamDate — 卒業生（学年に依存せず直近の国試）', () => {
  // 卒業生の grade は名簿値で 3 と 4 のどちらにもなりうる（StudentProfile.grade）。
  // どちらでも在校3年生と同じ日付に揃うことが本質。
  it('grade=4 でも「終了」にならず翌年の国試を指す', () => {
    const d = computeNextExamDate('clinical_eng', 4, 'graduate', JULY_2026);
    expect(d).toEqual(new Date(2027, 2, 3));
  });

  it('grade=3 でも同じ日付になる', () => {
    const d = computeNextExamDate('clinical_eng', 3, 'graduate', JULY_2026);
    expect(d).toEqual(new Date(2027, 2, 3));
  });

  it('在校3年生と同一の日付になる（学年に関わらず）', () => {
    const enrolled3 = computeNextExamDate('clinical_eng', 3, 'enrolled', JULY_2026);
    const graduate4 = computeNextExamDate('clinical_eng', 4, 'graduate', JULY_2026);
    expect(graduate4).toEqual(enrolled3);
  });

  it('国試前（1月）は当年の国試を指す（翌年に飛ばさない）', () => {
    const jan = new Date(2027, 0, 20);
    expect(computeNextExamDate('clinical_eng', 4, 'graduate', jan)).toEqual(new Date(2027, 2, 3));
  });

  it('国試当日は当日を指す', () => {
    const examDay = new Date(2027, 2, 3, 7, 47);
    expect(computeNextExamDate('clinical_eng', 4, 'graduate', examDay)).toEqual(new Date(2027, 2, 3));
  });

  it('国試翌日は翌年へ繰り上がる', () => {
    const dayAfter = new Date(2027, 2, 4);
    expect(computeNextExamDate('clinical_eng', 4, 'graduate', dayAfter)).toEqual(new Date(2028, 2, 3));
  });

  it('学科ごとの想定日を尊重する（看護は2/15）', () => {
    expect(computeNextExamDate('nursing', 4, 'graduate', JULY_2026)).toEqual(new Date(2027, 1, 15));
  });
});

describe('daysUntilExam / formatExamCountdown', () => {
  it('卒業生に「終了」を出さない（報告された不具合の回帰テスト）', () => {
    expect(daysUntilExam('clinical_eng', 4, 'graduate', JULY_2026)).toBeGreaterThan(0);
    expect(formatExamCountdown('clinical_eng', 4, 'graduate', JULY_2026)).not.toBe('終了');
  });

  it('卒業生と在校3年生の表示が一致する', () => {
    expect(formatExamCountdown('clinical_eng', 4, 'graduate', JULY_2026))
      .toBe(formatExamCountdown('clinical_eng', 3, 'enrolled', JULY_2026));
  });

  it('国試当日は「いよいよ本日」', () => {
    const examDay = new Date(2027, 2, 3, 7, 47);
    expect(formatExamCountdown('clinical_eng', 4, 'graduate', examDay)).toBe('いよいよ本日');
  });

  it('30日未満は「あとN日」', () => {
    const feb = new Date(2027, 1, 20); // 3/3まで11日
    expect(formatExamCountdown('clinical_eng', 4, 'graduate', feb)).toBe('あと11日');
  });

  it('受験済みの在校3年生には従来どおり「終了」を出す（3月の卒業直前）', () => {
    const afterExam = new Date(2027, 2, 10); // 学年度2026・3年生・国試(3/3)後
    expect(formatExamCountdown('clinical_eng', 3, 'enrolled', afterExam)).toBe('終了');
  });
});
