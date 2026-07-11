import type { GeneratedQuestion, Question } from '../types';

/**
 * AI生成類題（generateSimilar）を出題キューへ接続するための変換関数群。
 *
 * GAS の generateSimilar は「新規生成＝GeneratedQuestion 単体」「生成済み3題到達＝
 * { questions: GeneratedQuestion[], cached: true }」「失敗＝{ error }」の3形状を返す。
 */

function isGeneratedQuestion(v: unknown): v is GeneratedQuestion {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['gen_id'] === 'string' &&
    typeof o['question_text'] === 'string' &&
    Array.isArray(o['choices']) &&
    (o['choices'] as unknown[]).length >= 2 &&
    Array.isArray(o['correct_answer']) &&
    (o['correct_answer'] as unknown[]).length > 0
  );
}

/** generateSimilar のレスポンスから類題を1問取り出す。取り出せなければ null */
export function normalizeGeneratedResponse(data: unknown): GeneratedQuestion | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  if (Array.isArray(o['questions'])) {
    const candidates = (o['questions'] as unknown[]).filter(isGeneratedQuestion);
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)]!;
  }
  return isGeneratedQuestion(data) ? data : null;
}

/**
 * 類題を出題キューに挿入できる Question へ変換する。
 * 分類・学科は元問題から継承し、question_id は `GEN-` 接頭辞で区別する
 * （GEN- 問題は SM-2 カードを作らない・questionCache にも入れない一時問題）。
 */
export function generatedToQuestion(gen: GeneratedQuestion, original: Question): Question {
  return {
    question_id: `GEN-${gen.gen_id}`,
    department: original.department,
    exam_year: original.exam_year,
    exam_number: 0,
    category: original.category,
    subcategory: original.subcategory,
    subtopic: original.subtopic,
    difficulty: gen.difficulty || original.difficulty,
    question_text: gen.question_text,
    choices: gen.choices,
    correct_answer: gen.correct_answer.map((l) => String(l).toUpperCase()),
    explanation: gen.explanation || '',
    has_image: false,
    image_url: '',
    is_multi_select: gen.correct_answer.length > 1,
    source: 'ai_generated',
    created_at: gen.created_at || new Date().toISOString(),
  };
}
