import { describe, it, expect } from 'vitest';
import {
  shouldExtendInterval,
  applyAnswer,
  confirmUnderstanding,
} from './memoriaStep';
import type { CardState } from '../types';

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
