import { describe, it, expect } from 'vitest';
import { rowToCardState, cardStateToRow } from './supabaseRpc';

describe('rowToCardState', () => {
  it('Supabase行をCardStateへ変換する', () => {
    const row = {
      question_id: 'CE-2021-001',
      ease_factor: 2.6,
      interval_days: 6,
      repetitions: 2,
      next_review: '2026-06-15',
      last_review: '2026-06-09',
      hint_level: 1,
      consecutive_correct_at_zero: 0,
      updated_at: '2026-06-09T10:00:00Z',
    };
    expect(rowToCardState(row)).toEqual({
      questionId: 'CE-2021-001',
      easeFactor: 2.6,
      interval: 6,
      repetitions: 2,
      nextReview: '2026-06-15',
      lastReview: '2026-06-09',
      hintLevel: 1,
      consecutiveCorrectAtZero: 0,
      updatedAt: '2026-06-09T10:00:00Z',
    });
  });

  it('last_review が null なら空文字にする', () => {
    const row = {
      question_id: 'x', ease_factor: 2.5, interval_days: 0, repetitions: 0,
      next_review: '2026-06-10', last_review: null, hint_level: 0,
      consecutive_correct_at_zero: 0, updated_at: '2026-06-10T00:00:00Z',
    };
    expect(rowToCardState(row).lastReview).toBe('');
  });
});

describe('cardStateToRow', () => {
  it('CardStateをSupabase行へ変換する（lastReview空文字→null・updatedAtを送る）', () => {
    const card = {
      questionId: 'CE-2021-001', easeFactor: 2.5, interval: 0, repetitions: 0,
      nextReview: '2026-06-10', lastReview: '', hintLevel: 0, consecutiveCorrectAtZero: 0,
      updatedAt: '2026-06-10T09:00:00.000Z',
    };
    expect(cardStateToRow(card)).toEqual({
      question_id: 'CE-2021-001',
      ease_factor: 2.5,
      interval_days: 0,
      repetitions: 0,
      next_review: '2026-06-10',
      last_review: null,
      hint_level: 0,
      consecutive_correct_at_zero: 0,
      updated_at: '2026-06-10T09:00:00.000Z',
    });
  });

  it('updatedAtが空なら updated_at を省略する（server の now() に委ねる）', () => {
    const card = {
      questionId: 'x', easeFactor: 2.5, interval: 0, repetitions: 0,
      nextReview: '2026-06-10', lastReview: '', hintLevel: 0, consecutiveCorrectAtZero: 0,
      updatedAt: '',
    };
    expect(cardStateToRow(card).updated_at).toBeUndefined();
  });
});
