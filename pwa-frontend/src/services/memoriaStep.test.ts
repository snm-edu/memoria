import { describe, it, expect } from 'vitest';
import {
  shouldExtendInterval,
  applyAnswer,
  confirmUnderstanding,
  createFillInBlank,
  computePresentation,
} from './memoriaStep';
import type { CardState, Question } from '../types';

const NOW = new Date('2026-07-11T00:00:00Z'); // JST 2026-07-11 09:00

function card(over: Partial<CardState> = {}): CardState {
  return {
    questionId: 'q1', easeFactor: 2.5, interval: 6, repetitions: 2,
    nextReview: '2026-07-11', lastReview: '2026-07-05',
    hintLevel: 0, consecutiveCorrectAtZero: 0,
    updatedAt: '2026-07-01T00:00:00.000Z', ...over,
  };
}

describe('shouldExtendInterval — 1ストリークにつき1回だけ発動', () => {
  it('連続正答ちょうど3回で発動', () =>
    expect(shouldExtendInterval(card({ hintLevel: 0, consecutiveCorrectAtZero: 3 }))).toBe(true));
  it('4回以降は再発動しない（複利爆発防止）', () =>
    expect(shouldExtendInterval(card({ hintLevel: 0, consecutiveCorrectAtZero: 4 }))).toBe(false));
  it('3回未満は発動しない', () =>
    expect(shouldExtendInterval(card({ hintLevel: 0, consecutiveCorrectAtZero: 2 }))).toBe(false));
  it('ヒント使用中(hintLevel>0)は発動しない', () =>
    expect(shouldExtendInterval(card({ hintLevel: 1, consecutiveCorrectAtZero: 3 }))).toBe(false));
});

describe('applyAnswer — ヒント使用カードの正答でEFが「下がる」（符号バグ回帰）', () => {
  it('hintLevel4で正答してもEFは上がらず、ペナルティで下がる', () => {
    const r = applyAnswer(card({ easeFactor: 2.5, hintLevel: 4, repetitions: 2, interval: 6 }), true, 5000, NOW);
    expect(r.easeFactor).toBeLessThan(2.5);      // 修正前は 2.6 へ上昇していた
    expect(r.easeFactor).toBeCloseTo(2.3, 5);    // 2.5 + (-0.2)
    expect(r.interval).toBe(1);                  // 重いヒント正答は自力想起でないので翌日へ
    expect(r.hintLevel).toBe(2);                 // 段階は下降
  });
});

describe('applyAnswer — 誤答でもEFは不変（正典SM-2の合成）', () => {
  it('ヒントなし誤答はEFを変えずhintLevelを1段上げる', () => {
    const r = applyAnswer(card({ easeFactor: 2.5, hintLevel: 0, repetitions: 3, interval: 15 }), false, 3000, NOW);
    expect(r.easeFactor).toBe(2.5);
    expect(r.interval).toBe(1);
    expect(r.hintLevel).toBe(1);
    expect(r.repetitions).toBe(0);
  });
});

describe('applyAnswer — ヒントなし連続正答での延長は1回だけ', () => {
  it('連続正答3回到達でinterval×1.5が1度だけ乗る', () => {
    const r = applyAnswer(card({ easeFactor: 2.5, hintLevel: 0, repetitions: 2, interval: 6, consecutiveCorrectAtZero: 2 }), true, 5000, NOW);
    expect(r.consecutiveCorrectAtZero).toBe(3);
    expect(r.easeFactor).toBe(2.5);
    expect(r.interval).toBe(23);           // round(6*2.5)=15 → ×1.5 = 23
    expect(r.nextReview).toBe('2026-08-03'); // JST 2026-07-11 + 23日
  });
  it('連続正答4回目以降は×1.5が乗らない', () => {
    const r = applyAnswer(card({ easeFactor: 2.5, hintLevel: 0, repetitions: 5, interval: 30, consecutiveCorrectAtZero: 4 }), true, 5000, NOW);
    expect(r.consecutiveCorrectAtZero).toBe(5);
    expect(r.interval).toBe(75);           // round(30*2.5)=75、延長なし
  });
});

function question(over: Partial<Question> = {}): Question {
  return {
    question_id: 'NRS-2023-001', department: 'nursing', exam_year: 2023, exam_number: 1,
    category: '基礎看護学', subcategory: '', subtopic: '', difficulty: 3,
    question_text: '高血圧の治療で正しいのはどれか。',
    choices: ['利尿薬を用いる', '安静のみとする', '水分を制限しない', '塩分を多く摂る'],
    correct_answer: ['A'],
    explanation: '高血圧の治療では利尿薬を用いることがある。',
    has_image: false, image_url: '', is_multi_select: false,
    source: 'notebooklm', created_at: '2026-01-01T00:00:00Z', ...over,
  };
}

describe('createFillInBlank — 答えの露出防止', () => {
  it('正答テキストの全出現を穴埋めする（従来は最初の1箇所のみ）', () => {
    const r = createFillInBlank('利尿薬を用いる治療が基本。利尿薬を用いるのは体液量を減らすため。', ['利尿薬を用いる']);
    expect(r.text).toBe('[ __ ]治療が基本。[ __ ]のは体液量を減らすため。');
    expect(r.answer).toBe('利尿薬を用いる');
    expect(r.hasBlank).toBe(true);
  });

  it('複数正答はすべて穴埋めし、answerは最初に見つかったテキスト', () => {
    const r = createFillInBlank('聴診と触診の両方を行う。', ['聴診', '触診']);
    expect(r.text).toBe('[ __ ]と[ __ ]の両方を行う。');
    expect(r.answer).toBe('聴診');
    expect(r.hasBlank).toBe(true);
  });

  it('解説に正答テキストが含まれない場合は hasBlank=false', () => {
    const r = createFillInBlank('この疾患では早期発見が重要である。', ['配偶者暴力相談支援センターに通報する']);
    expect(r.hasBlank).toBe(false);
    expect(r.text).toBe('この疾患では早期発見が重要である。');
  });

  it('「正解はB」等の正答ラベル明示を伏せ字化する', () => {
    const r = createFillInBlank('正解はBである。安静が必要。答え：C も誤り。', ['安静']);
    expect(r.text).not.toMatch(/正解は\s*B/);
    expect(r.text).not.toMatch(/答え：\s*C/);
    expect(r.text).toContain('[ __ ]');
  });

  it('「Cが適切」形式も伏せ字化する', () => {
    const r = createFillInBlank('Cが適切である。聴診を行う。', ['聴診']);
    expect(r.text).not.toMatch(/C\s*が適切/);
  });
});

describe('computePresentation — レベル5で穴が作れない問題は確認モードへフォールバック', () => {
  it('穴が作れる問題はレベル5の穴埋めを出す', () => {
    const p = computePresentation(question(), 5);
    expect(p.hintLevel).toBe(5);
    expect(p.fillInBlank?.hasBlank).toBe(true);
    expect(p.confirmationMode).toBe(false);
  });

  it('解説に正答テキストがない問題はレベル6（確認モード）にする', () => {
    const p = computePresentation(question({ explanation: '早期発見が重要である。' }), 5);
    expect(p.hintLevel).toBe(6);
    expect(p.fillInBlank).toBeNull();
    expect(p.confirmationMode).toBe(true);
  });

  it('複数選択問題はレベル2/4で選択肢削減せずレベル1へフォールバック（既存挙動）', () => {
    const p = computePresentation(question({ is_multi_select: true }), 4);
    expect(p.hintLevel).toBe(1);
    expect(p.visibleChoices).toHaveLength(4);
  });

  it('レベル4は2択になる', () => {
    const p = computePresentation(question(), 4);
    expect(p.hintLevel).toBe(4);
    expect(p.visibleChoices).toHaveLength(2);
  });
});

describe('confirmUnderstanding — レベル6「理解できた」は満額進行しない', () => {
  it('理解できた: 短期再出題・repetitions据え置き・hintLevel3へ', () => {
    const r = confirmUnderstanding(card({ easeFactor: 2.5, repetitions: 3, interval: 30, hintLevel: 6 }), true, NOW);
    expect(r.interval).toBe(2);
    expect(r.repetitions).toBe(3);   // 進行させない
    expect(r.hintLevel).toBe(3);
    expect(r.easeFactor).toBe(2.5);
    expect(r.nextReview).toBe('2026-07-13');
    expect(r.lastReview).toBe('2026-07-11');
  });
  it('まだ不安: 翌日に再出題・hintLevel6維持', () => {
    const r = confirmUnderstanding(card({ repetitions: 3, interval: 30, hintLevel: 6 }), false, NOW);
    expect(r.interval).toBe(1);
    expect(r.hintLevel).toBe(6);
    expect(r.nextReview).toBe('2026-07-12');
  });
});
