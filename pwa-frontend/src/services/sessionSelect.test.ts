import { describe, it, expect } from 'vitest';
import { overdueDays, isWeakCard, scoreCard, rankReviewCards } from './sessionSelect';
import type { CardState } from '../types';

function card(over: Partial<CardState> = {}): CardState {
  return {
    questionId: 'q1', easeFactor: 2.5, interval: 6, repetitions: 3,
    nextReview: '2026-07-11', lastReview: '2026-07-05',
    hintLevel: 0, consecutiveCorrectAtZero: 0, ...over,
  };
}

describe('overdueDays', () => {
  it('期限超過日数を返す', () => expect(overdueDays('2026-07-01', '2026-07-11')).toBe(10));
  it('当日期限は0', () => expect(overdueDays('2026-07-11', '2026-07-11')).toBe(0));
  it('未来の期限は0（負にしない）', () => expect(overdueDays('2026-07-20', '2026-07-11')).toBe(0));
});

describe('isWeakCard（card_statesベースの弱点判定・端末を跨いで持続）', () => {
  it('hintLevel>=2 は弱点', () => expect(isWeakCard(card({ hintLevel: 2 }))).toBe(true));
  it('easeFactor<=2.0 は弱点', () => expect(isWeakCard(card({ easeFactor: 1.9 }))).toBe(true));
  it('直近で誤答リセットされたカード（rep0かつ学習済み）は弱点', () =>
    expect(isWeakCard(card({ repetitions: 0, lastReview: '2026-07-01' }))).toBe(true));
  it('順調なカード（hint0/EF2.5/rep3）は弱点でない', () =>
    expect(isWeakCard(card({ hintLevel: 0, easeFactor: 2.5, repetitions: 3 }))).toBe(false));
  it('未学習カード（lastReview空）は弱点でない', () =>
    expect(isWeakCard(card({ repetitions: 0, lastReview: '' }))).toBe(false));
});

describe('scoreCard（優先度: 期限超過×2 + hintLevel×3 + (2.5-EF)×4）', () => {
  it('期限超過10日・hint3・EF2.0 → 31', () => {
    expect(scoreCard(card({ nextReview: '2026-07-01', hintLevel: 3, easeFactor: 2.0 }), '2026-07-11')).toBe(31);
  });
  it('期限超過は30日で頭打ち', () => {
    const s = scoreCard(card({ nextReview: '2026-01-01', hintLevel: 0, easeFactor: 2.5 }), '2026-07-11');
    expect(s).toBe(60); // min(超過,30)*2、hint0/EF2.5で他は0
  });
});

describe('rankReviewCards（優先度降順・純関数）', () => {
  it('苦戦カード（高スコア）を先頭に並べる', () => {
    const easy = card({ questionId: 'easy', nextReview: '2026-07-11', hintLevel: 0, easeFactor: 2.5 });
    const hard = card({ questionId: 'hard', nextReview: '2026-07-01', hintLevel: 4, easeFactor: 1.6 });
    const ranked = rankReviewCards([easy, hard], '2026-07-11');
    expect(ranked.map((c) => c.questionId)).toEqual(['hard', 'easy']);
  });
  it('同スコアは入力順を保つ（安定ソート）', () => {
    const a = card({ questionId: 'a' });
    const b = card({ questionId: 'b' });
    const ranked = rankReviewCards([a, b], '2026-07-11');
    expect(ranked.map((c) => c.questionId)).toEqual(['a', 'b']);
  });
  it('入力配列を破壊しない', () => {
    const input = [card({ questionId: 'x' }), card({ questionId: 'y', hintLevel: 5 })];
    rankReviewCards(input, '2026-07-11');
    expect(input.map((c) => c.questionId)).toEqual(['x', 'y']);
  });
});
