import { describe, it, expect } from 'vitest';
import { mergeCardStates } from './cardMerge';
import type { CardState } from '../../types';

function card(questionId: string, lastReview: string, easeFactor = 2.5, updatedAt = ''): CardState {
  return {
    questionId, easeFactor, interval: 1, repetitions: 1,
    nextReview: '2026-06-15', lastReview, hintLevel: 0, consecutiveCorrectAtZero: 0, updatedAt,
  };
}

describe('mergeCardStates', () => {
  it('ローカルにないカードはクラウドから採用される', () => {
    const merged = mergeCardStates([], [card('q1', '2026-06-01')]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.questionId).toBe('q1');
  });

  it('クラウドの方が新しければクラウドを採用', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-01', 2.5)],
      [card('q1', '2026-06-09', 2.8)],
    );
    expect(merged[0]!.easeFactor).toBe(2.8);
  });

  it('ローカルの方が新しければローカルを維持', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-09', 2.5)],
      [card('q1', '2026-06-01', 2.8)],
    );
    expect(merged[0]!.easeFactor).toBe(2.5);
  });

  it('同日はローカル優先', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-09', 2.5)],
      [card('q1', '2026-06-09', 2.8)],
    );
    expect(merged[0]!.easeFactor).toBe(2.5);
  });

  it('クラウドにないローカルカードはそのまま残る', () => {
    const merged = mergeCardStates([card('q1', '2026-06-01')], []);
    expect(merged).toHaveLength(1);
  });

  it('未学習（lastReview空文字）のローカルよりクラウドの学習済みを優先', () => {
    const merged = mergeCardStates(
      [card('q1', '', 2.5)],
      [card('q1', '2026-06-09', 2.8)],
    );
    expect(merged[0]!.easeFactor).toBe(2.8);
  });

  it('同日でも updatedAt が新しいクラウドを採用（マルチデバイス巻き戻り防止）', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-09', 2.5, '2026-06-09T08:00:00.000Z')], // 朝
      [card('q1', '2026-06-09', 2.8, '2026-06-09T12:00:00.000Z')], // 昼（新しい）
    );
    expect(merged[0]!.easeFactor).toBe(2.8);
  });

  it('同日で updatedAt がローカルの方が新しければローカルを維持', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-09', 2.5, '2026-06-09T15:00:00.000Z')],
      [card('q1', '2026-06-09', 2.8, '2026-06-09T12:00:00.000Z')],
    );
    expect(merged[0]!.easeFactor).toBe(2.5);
  });

  it('updatedAt が両方空ならlastReview日付比較にフォールバック（後方互換）', () => {
    const merged = mergeCardStates(
      [card('q1', '2026-06-01', 2.5, '')],
      [card('q1', '2026-06-09', 2.8, '')],
    );
    expect(merged[0]!.easeFactor).toBe(2.8);
  });
});
