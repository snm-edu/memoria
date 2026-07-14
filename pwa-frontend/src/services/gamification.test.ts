import { describe, it, expect } from 'vitest';
import {
  calculateExpGain,
  getExpLevelMultiplier,
  calculateLevel,
  getLevelProgress,
  getLevelTitle,
  LEVEL_TITLES_BY_DEPT,
  MAX_LEVEL,
} from './gamification';

describe('calculateExpGain — 正誤', () => {
  it('不正解は経験値ゼロ（ヒント量・連続数に関わらず）', () => {
    expect(calculateExpGain(false, false, 0, 0)).toBe(0);
    expect(calculateExpGain(false, true, 9, 0)).toBe(0);
    expect(calculateExpGain(false, true, 9, 5)).toBe(0);
  });

  it('新規問題の自力正答は10EXP', () => {
    expect(calculateExpGain(true, false, 1, 0)).toBe(10);
  });

  it('復習の自力正答は15EXP', () => {
    expect(calculateExpGain(true, true, 1, 0)).toBe(15);
  });

  it('連続正答ボーナスは最大+10で頭打ち', () => {
    expect(calculateExpGain(true, false, 3, 0)).toBe(13);
    expect(calculateExpGain(true, false, 10, 0)).toBe(20);
    expect(calculateExpGain(true, false, 50, 0)).toBe(20); // +10 で頭打ち
  });

  it('連続1問目にはボーナスがつかない', () => {
    expect(calculateExpGain(true, false, 1, 0)).toBe(10);
  });
});

describe('getExpLevelMultiplier — 提示レベル傾斜', () => {
  it('sm2の品質補正と同じ区切り（0 / 1-2 / 3-4 / 5-6）で減衰する', () => {
    expect(getExpLevelMultiplier(0)).toBe(1.0);
    expect(getExpLevelMultiplier(1)).toBe(0.8);
    expect(getExpLevelMultiplier(2)).toBe(0.8);
    expect(getExpLevelMultiplier(3)).toBe(0.6);
    expect(getExpLevelMultiplier(4)).toBe(0.6);
    expect(getExpLevelMultiplier(5)).toBe(0.4);
    expect(getExpLevelMultiplier(6)).toBe(0.4);
  });

  it('支援が増えるほど単調に減る', () => {
    const levels = [0, 1, 2, 3, 4, 5, 6];
    const mults = levels.map(getExpLevelMultiplier);
    for (let i = 1; i < mults.length; i++) {
      expect(mults[i]!).toBeLessThanOrEqual(mults[i - 1]!);
    }
  });
});

describe('calculateExpGain — 提示レベル傾斜の適用', () => {
  it('3択化（Lv2）の新規正答は8EXP', () => {
    expect(calculateExpGain(true, false, 1, 2)).toBe(8);
  });

  it('2択化（Lv4）の新規正答は6EXP', () => {
    expect(calculateExpGain(true, false, 1, 4)).toBe(6);
  });

  it('穴埋め（Lv5）の新規正答は4EXP', () => {
    expect(calculateExpGain(true, false, 1, 5)).toBe(4);
  });

  it('同条件ならヒントなしの方が必ず多くもらえる', () => {
    const noHint = calculateExpGain(true, true, 5, 0);
    const twoChoice = calculateExpGain(true, true, 5, 4);
    expect(noHint).toBeGreaterThan(twoChoice);
  });

  it('最大は復習×連続10×ヒントなしの25EXP', () => {
    expect(calculateExpGain(true, true, 10, 0)).toBe(25);
  });

  it('正答した以上は最低1EXPを保証する', () => {
    expect(calculateExpGain(true, false, 0, 6)).toBeGreaterThanOrEqual(1);
  });

  it('presentedLevel 省略時はヒントなし扱い（既存呼び出しの互換）', () => {
    expect(calculateExpGain(true, false, 1)).toBe(calculateExpGain(true, false, 1, 0));
  });
});

describe('calculateLevel / getLevelProgress — 表示の正本', () => {
  it('Lv2 到達は200EXP（正解20問相当）', () => {
    expect(calculateLevel(199)).toBe(1);
    expect(calculateLevel(200)).toBe(2);
  });

  it('報告時のEXP97はLv1・次まで103（旧ホーム画面の /25 実装はLv2と誤表示していた）', () => {
    const p = getLevelProgress(97);
    expect(p.level).toBe(1);
    expect(p.nextLevelExp - p.currentExp).toBe(103);
  });

  it('レベル境界は (level-1)^2 * 200', () => {
    expect(calculateLevel(3200)).toBe(5);
    expect(calculateLevel(3199)).toBe(4);
    expect(calculateLevel(16200)).toBe(10);
  });

  it('称号テーブルの expRequired が実際の到達EXPと一致する', () => {
    for (const entries of Object.values(LEVEL_TITLES_BY_DEPT)) {
      for (const e of entries) {
        expect(calculateLevel(e.expRequired)).toBe(e.level);
      }
    }
  });

  it('レベル上限で頭打ちになり、進捗が1を超えない', () => {
    expect(calculateLevel(304200)).toBe(MAX_LEVEL);
    expect(calculateLevel(99_999_999)).toBe(MAX_LEVEL);
    expect(getLevelProgress(99_999_999).progress).toBe(1);
  });

  it('progress は 0〜1 に収まる', () => {
    for (const exp of [0, 1, 97, 200, 3200, 50_000, 304_200]) {
      const p = getLevelProgress(exp);
      expect(p.progress).toBeGreaterThanOrEqual(0);
      expect(p.progress).toBeLessThanOrEqual(1);
    }
  });
});

describe('getLevelTitle — 学科別称号', () => {
  it('臨床工学技士のLv5は「実習技士」（看護版ハードコードでは「実習生」だった）', () => {
    expect(getLevelTitle(5, 'clinical_eng')).toBe('実習技士');
  });

  it('学科ごとに称号が分かれる', () => {
    expect(getLevelTitle(10, 'nursing')).toBe('新人');
    expect(getLevelTitle(10, 'clinical_eng')).toBe('新人CE');
    expect(getLevelTitle(10, 'dental_hyg')).toBe('新人DH');
    expect(getLevelTitle(10, 'orthoptist')).toBe('新人CO');
  });

  it('学科未指定・未知の学科は看護版にフォールバックする', () => {
    expect(getLevelTitle(1)).toBe('見学生');
    expect(getLevelTitle(10, 'unknown_dept')).toBe('新人');
  });

  it('次の閾値に届くまでは称号を据え置く', () => {
    expect(getLevelTitle(4, 'clinical_eng')).toBe('見学生');
    expect(getLevelTitle(9, 'clinical_eng')).toBe('実習技士');
  });
});
