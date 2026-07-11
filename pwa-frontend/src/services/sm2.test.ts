import { describe, it, expect } from 'vitest';
import {
  sm2Update,
  calculateQuality,
  adjustQualityForHint,
  createCardState,
  sanitizeCardState,
  MIN_EF,
  MAX_EF,
  MAX_INTERVAL_DAYS,
} from './sm2';
import type { CardState } from '../types';

const NOW = new Date('2026-07-11T00:00:00Z'); // JST 2026-07-11 09:00

function card(over: Partial<CardState> = {}): CardState {
  return {
    questionId: 'q1', easeFactor: 2.5, interval: 6, repetitions: 2,
    nextReview: '2026-07-11', lastReview: '2026-07-05',
    hintLevel: 0, consecutiveCorrectAtZero: 0, ...over,
  };
}

describe('calculateQuality', () => {
  it('不正解は1', () => expect(calculateQuality(false, 1000)).toBe(1));
  it('即答正解は5', () => expect(calculateQuality(true, 5000)).toBe(5));
  it('30秒超の正解は3', () => expect(calculateQuality(true, 40000)).toBe(3));
});

describe('adjustQualityForHint（ヒント量で自力想起の質を補正）', () => {
  it('ヒントなしは変えない', () => expect(adjustQualityForHint(5, 0)).toBe(5));
  it('軽いヒント(1-3)は上限4', () => {
    expect(adjustQualityForHint(5, 1)).toBe(4);
    expect(adjustQualityForHint(5, 3)).toBe(4);
    expect(adjustQualityForHint(4, 2)).toBe(4);
  });
  it('重いヒント(>=4:2択/穴埋め/解答表示)は自力想起とみなさず上限2', () => {
    expect(adjustQualityForHint(5, 4)).toBe(2);
    expect(adjustQualityForHint(3, 5)).toBe(2);
    expect(adjustQualityForHint(5, 6)).toBe(2);
  });
  it('不正解(1)はどのヒント量でも1のまま', () => {
    expect(adjustQualityForHint(1, 0)).toBe(1);
    expect(adjustQualityForHint(1, 6)).toBe(1);
  });
});

describe('sm2Update — 誤答時はEF不変（正典SM-2）', () => {
  it('不正解ではeaseFactorを変えない', () => {
    const r = sm2Update(card({ easeFactor: 2.5 }), 1, NOW);
    expect(r.easeFactor).toBe(2.5); // 従来は1.96へ急落していた
  });
  it('不正解はrepetitions=0・interval=1', () => {
    const r = sm2Update(card({ repetitions: 3, interval: 30 }), 1, NOW);
    expect(r.repetitions).toBe(0);
    expect(r.interval).toBe(1);
  });
  it('正解(quality3)はEFを下げる', () => {
    const r = sm2Update(card({ easeFactor: 2.5 }), 3, NOW);
    expect(r.easeFactor).toBeCloseTo(2.36, 5);
  });
});

describe('sm2Update — EF/interval のキャップ', () => {
  it('EFはMAX_EFを超えない', () => {
    const r = sm2Update(card({ easeFactor: 2.5 }), 5, NOW); // +0.1 → 2.6 だが上限
    expect(r.easeFactor).toBe(MAX_EF);
  });
  it('EFはMIN_EFを下回らない', () => {
    const r = sm2Update(card({ easeFactor: 1.35 }), 3, NOW); // -0.14 → 1.21 だが下限
    expect(r.easeFactor).toBe(MIN_EF);
  });
  it('intervalはMAX_INTERVAL_DAYSを超えない（爆発防止）', () => {
    const r = sm2Update(card({ repetitions: 2, interval: 200, easeFactor: 2.5 }), 5, NOW);
    expect(r.interval).toBe(MAX_INTERVAL_DAYS); // round(200*2.5)=500 → 180
  });
});

describe('sm2Update — 日付はJST基準', () => {
  it('lastReview/nextReviewがJST日付になる', () => {
    const r = sm2Update(createCardState('q9'), 5, NOW); // 新規: interval=1
    expect(r.lastReview).toBe('2026-07-11');
    expect(r.nextReview).toBe('2026-07-12');
  });
});

describe('sanitizeCardState（汚染カードの是正）', () => {
  it('爆発カードをキャップ内に丸める', () => {
    const r = sanitizeCardState(
      card({ easeFactor: 3.5, interval: 999999, nextReview: '5081-06-01' }),
      NOW,
    );
    expect(r.easeFactor).toBe(MAX_EF);
    expect(r.interval).toBe(MAX_INTERVAL_DAYS);
    expect(r.nextReview).toBe('2027-01-07'); // 2026-07-11 + 180日
  });
  it('正常カードはnextReviewを変えない', () => {
    const r = sanitizeCardState(card({ easeFactor: 2.2, interval: 6, nextReview: '2026-07-20' }), NOW);
    expect(r.easeFactor).toBe(2.2);
    expect(r.interval).toBe(6);
    expect(r.nextReview).toBe('2026-07-20');
  });
});
