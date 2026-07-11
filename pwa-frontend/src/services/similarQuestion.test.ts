import { describe, it, expect } from 'vitest';
import { normalizeGeneratedResponse, generatedToQuestion } from './similarQuestion';
import type { Question } from '../types';

const GEN = {
  gen_id: 'abc-123',
  original_question_id: 'NRS-2023-001',
  error_type: 'knowledge_gap' as const,
  question_text: '利尿薬の作用で正しいのはどれか。',
  choices: ['体液量を減らす', '心拍数を上げる', '血糖を上げる', '気道を広げる'],
  correct_answer: ['A'],
  explanation: '利尿薬は体液量を減らし血圧を下げる。',
  difficulty: 3,
  created_at: '2026-07-12T00:00:00Z',
};

function original(over: Partial<Question> = {}): Question {
  return {
    question_id: 'NRS-2023-001', department: 'nursing', exam_year: 2023, exam_number: 1,
    category: '基礎看護学', subcategory: '循環器', subtopic: '薬理', difficulty: 3,
    question_text: '高血圧の治療で正しいのはどれか。',
    choices: ['利尿薬を用いる', 'B', 'C', 'D'], correct_answer: ['A'],
    explanation: '解説', has_image: false, image_url: '', is_multi_select: false,
    source: 'notebooklm', created_at: '2026-01-01T00:00:00Z', ...over,
  };
}

describe('normalizeGeneratedResponse', () => {
  it('新規生成レスポンス（単体）をそのまま返す', () => {
    expect(normalizeGeneratedResponse(GEN)?.gen_id).toBe('abc-123');
  });
  it('キャッシュレスポンス（questions配列）から1問返す', () => {
    const r = normalizeGeneratedResponse({ questions: [GEN], cached: true });
    expect(r?.gen_id).toBe('abc-123');
  });
  it('エラー・不正形状は null', () => {
    expect(normalizeGeneratedResponse({ error: 'quota' })).toBeNull();
    expect(normalizeGeneratedResponse(null)).toBeNull();
    expect(normalizeGeneratedResponse({ gen_id: 'x' })).toBeNull(); // 必須フィールド欠落
    expect(normalizeGeneratedResponse({ questions: [] })).toBeNull();
  });
});

describe('generatedToQuestion', () => {
  it('類題を出題キューに挿入できる Question へ変換する（分類は元問題から継承）', () => {
    const q = generatedToQuestion(GEN, original());
    expect(q.question_id).toBe('GEN-abc-123');
    expect(q.department).toBe('nursing');
    expect(q.category).toBe('基礎看護学');
    expect(q.subcategory).toBe('循環器');
    expect(q.question_text).toBe(GEN.question_text);
    expect(q.choices).toEqual(GEN.choices);
    expect(q.correct_answer).toEqual(['A']);
    expect(q.source).toBe('ai_generated');
    expect(q.is_multi_select).toBe(false);
  });
});
