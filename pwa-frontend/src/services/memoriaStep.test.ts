import { describe, it, expect } from 'vitest';
import {
  shouldExtendInterval,
  applyAnswer,
  confirmUnderstanding,
  createFillInBlank,
  computePresentation,
  resolveEffectiveLevel,
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

  it('レベル4は2択になる', () => {
    const p = computePresentation(question(), 4);
    expect(p.hintLevel).toBe(4);
    expect(p.visibleChoices).toHaveLength(2);
  });
});

/** 複数選択（5肢2択）フィクスチャ: 不正解3つ → Lv2/4とも削減成立 */
function multiQuestion(over: Partial<Question> = {}): Question {
  return question({
    question_id: 'DH-2023-001',
    is_multi_select: true,
    question_text: '身体診察で正しいのはどれか。2つ選べ。',
    choices: ['聴診を行う', '触診を行う', '打診のみで判断する', '視診は省略する', '問診は不要である'],
    correct_answer: ['A', 'B'],
    explanation: '聴診を行うことと触診を行うことが基本である。',
    ...over,
  });
}

describe('resolveEffectiveLevel — 提示レベルの決定（表示と評価の一致点）', () => {
  it('単一選択4択: Lv2/Lv4はそのまま成立', () => {
    expect(resolveEffectiveLevel(question(), 2)).toBe(2);
    expect(resolveEffectiveLevel(question(), 4)).toBe(4);
  });

  it('複数選択5択2正解（不正解3）: Lv2/Lv4とも削減成立', () => {
    expect(resolveEffectiveLevel(multiQuestion(), 2)).toBe(2);
    expect(resolveEffectiveLevel(multiQuestion(), 4)).toBe(4);
  });

  it('複数選択3択2正解（不正解1）: 削減不能なのでLv1へ', () => {
    const q3 = multiQuestion({ choices: ['聴診を行う', '触診を行う', '打診のみで判断する'] });
    expect(resolveEffectiveLevel(q3, 2)).toBe(1);
    expect(resolveEffectiveLevel(q3, 4)).toBe(1);
  });

  it('単一選択2択（不正解1）: 削減不能なのでLv1へ', () => {
    const q2 = question({ choices: ['正しい', '誤り'], correct_answer: ['A'] });
    expect(resolveEffectiveLevel(q2, 2)).toBe(1);
    expect(resolveEffectiveLevel(q2, 4)).toBe(1);
  });

  it('Lv5: 穴が作れれば5、作れなければ6', () => {
    expect(resolveEffectiveLevel(question(), 5)).toBe(5);
    expect(resolveEffectiveLevel(question({ explanation: '早期発見が重要である。' }), 5)).toBe(6);
  });

  it('Lv0/1/3/6 はそのまま通す', () => {
    for (const lv of [0, 1, 3, 6]) {
      expect(resolveEffectiveLevel(multiQuestion(), lv)).toBe(lv);
    }
  });
});

describe('computePresentation — 複数選択でも選択肢削減が成立する', () => {
  it('Lv2: 不正解1つを除外（正解2つは必ず残る・ラベルは元のまま）', () => {
    const p = computePresentation(multiQuestion(), 2);
    expect(p.hintLevel).toBe(2);
    expect(p.visibleChoices).toHaveLength(4);
    expect(p.visibleLabels).toContain('A');
    expect(p.visibleLabels).toContain('B');
  });

  it('Lv4: 全正解+不正解1つに絞り込む', () => {
    const p = computePresentation(multiQuestion(), 4);
    expect(p.hintLevel).toBe(4);
    expect(p.visibleChoices).toHaveLength(3);
    expect(p.visibleLabels).toContain('A');
    expect(p.visibleLabels).toContain('B');
  });

  it('削減不能（3択2正解）はLv1提示にフォールバック', () => {
    const q3 = multiQuestion({ choices: ['聴診を行う', '触診を行う', '打診のみで判断する'] });
    const p = computePresentation(q3, 4);
    expect(p.hintLevel).toBe(1);
    expect(p.visibleChoices).toHaveLength(3);
  });

  it('単一選択2択のLv2は偽装せずLv1提示になる（偽バッジ解消）', () => {
    const q2 = question({ choices: ['正しい', '誤り'], correct_answer: ['A'] });
    const p = computePresentation(q2, 2);
    expect(p.hintLevel).toBe(1);
    expect(p.visibleChoices).toHaveLength(2);
  });
});

describe('resolveEffectiveLevel / getVisibleChoices — 非正規ラベル・不備データへの耐性（敵対レビュー回帰）', () => {
  it('小文字ラベル correct_answer=[a,b] でも両関数の解釈が一致し、正解肢は削減で必ず保持される', () => {
    const q = multiQuestion({ correct_answer: ['a', 'b'] });
    expect(resolveEffectiveLevel(q, 2)).toBe(2);
    expect(resolveEffectiveLevel(q, 4)).toBe(4);
    // 乱数でどの不正解を消すかが変わるため反復して正解保持を確認
    for (let i = 0; i < 30; i++) {
      const p2 = computePresentation(q, 2);
      expect(p2.visibleLabels).toContain('A');
      expect(p2.visibleLabels).toContain('B');
      expect(p2.visibleChoices).not.toContain(undefined);
      const p4 = computePresentation(q, 4);
      expect(p4.visibleLabels).toContain('A');
      expect(p4.visibleLabels).toContain('B');
      expect(p4.visibleChoices).toHaveLength(3);
      expect(p4.visibleChoices).not.toContain(undefined);
    }
  });

  it('範囲外ラベル correct_answer=[E]（4択）は有効正解ゼロ扱いでLv1へ（undefined肢を混入させない）', () => {
    const q = question({ correct_answer: ['E'] }); // choicesは4つ
    expect(resolveEffectiveLevel(q, 2)).toBe(1);
    expect(resolveEffectiveLevel(q, 4)).toBe(1);
    const p = computePresentation(q, 4);
    expect(p.hintLevel).toBe(1);
    expect(p.visibleChoices).not.toContain(undefined);
  });

  it('正解肢ゼロ（不備問題・採点除外）はLv2/4を成立させずLv1へ', () => {
    const q = multiQuestion({ correct_answer: [] });
    expect(resolveEffectiveLevel(q, 2)).toBe(1);
    expect(resolveEffectiveLevel(q, 4)).toBe(1);
    expect(computePresentation(q, 4).visibleChoices).toHaveLength(5);
  });

  it('重複ラベル correct_answer=[A,A] はSetで重複排除され削減成立', () => {
    const q = question({ correct_answer: ['A', 'A'] });
    expect(resolveEffectiveLevel(q, 4)).toBe(4);
    const p = computePresentation(q, 4);
    expect(p.visibleChoices).toHaveLength(2);
    expect(p.visibleLabels).toContain('A');
  });

  it('全肢正解（不正解0）はLv1へ', () => {
    const q = multiQuestion({ correct_answer: ['A', 'B', 'C', 'D', 'E'] });
    expect(resolveEffectiveLevel(q, 2)).toBe(1);
    expect(resolveEffectiveLevel(q, 4)).toBe(1);
  });

  it('空choicesでもクラッシュしない（Lv2/4→1・Lv5→6）', () => {
    const q = question({ choices: [], correct_answer: [] });
    expect(resolveEffectiveLevel(q, 2)).toBe(1);
    expect(resolveEffectiveLevel(q, 5)).toBe(6);
    expect(computePresentation(q, 4).visibleChoices).toHaveLength(0);
  });

  it('5肢3正解（不正解2）: Lv4は全正解3+不正解1の4択・正解全保持', () => {
    const q = multiQuestion({ correct_answer: ['A', 'B', 'C'] });
    expect(resolveEffectiveLevel(q, 4)).toBe(4);
    for (let i = 0; i < 20; i++) {
      const p = computePresentation(q, 4);
      expect(p.visibleChoices).toHaveLength(4);
      expect(p.visibleLabels).toContain('A');
      expect(p.visibleLabels).toContain('B');
      expect(p.visibleLabels).toContain('C');
    }
  });

  it('5肢4正解（不正解1）は削減不能でLv1・全5肢表示', () => {
    const q = multiQuestion({ correct_answer: ['A', 'B', 'C', 'D'] });
    expect(resolveEffectiveLevel(q, 4)).toBe(1);
    expect(computePresentation(q, 4).visibleChoices).toHaveLength(5);
  });

  it('単一選択5択: Lv2は4肢化・Lv4は2肢化（既存挙動の明示回帰）', () => {
    const q = question({
      choices: ['利尿薬を用いる', '安静のみとする', '水分を制限しない', '塩分を多く摂る', '運動を禁止する'],
    });
    const p2 = computePresentation(q, 2);
    expect(p2.hintLevel).toBe(2);
    expect(p2.visibleChoices).toHaveLength(4);
    const p4 = computePresentation(q, 4);
    expect(p4.hintLevel).toBe(4);
    expect(p4.visibleChoices).toHaveLength(2);
    expect(p4.visibleLabels).toContain('A');
  });

  it('範囲外hintLevel（7/-1）は素通しされ表示はクラッシュしない', () => {
    expect(resolveEffectiveLevel(question(), 7)).toBe(7);
    expect(resolveEffectiveLevel(question(), -1)).toBe(-1);
    expect(computePresentation(question(), 7).visibleChoices).toHaveLength(4);
  });
});

describe('applyAnswer — 評価は提示レベル基準（表示と評価の不整合解消）', () => {
  it('保存Lv4・提示Lv1（削減不能フォールバック）での正答は満額に近く進行する', () => {
    const r = applyAnswer(
      card({ easeFactor: 2.5, hintLevel: 4, repetitions: 2, interval: 6 }),
      true, 5000, NOW, 1
    );
    expect(r.interval).toBe(15);              // quality4 → 成功ブランチ round(6×2.5)
    expect(r.repetitions).toBe(3);
    expect(r.easeFactor).toBeCloseTo(2.4, 5); // ペナルティは提示Lv1の-0.1（-0.2ではない）
    expect(r.hintLevel).toBe(2);              // 段階降下は保存レベル基準を維持
  });

  it('保存Lv4・提示Lv1での誤答はEF-0.1のみ（-0.2ではない）で段階は5へ', () => {
    const r = applyAnswer(
      card({ easeFactor: 2.5, hintLevel: 4, repetitions: 2, interval: 6 }),
      false, 3000, NOW, 1
    );
    expect(r.interval).toBe(1);
    expect(r.easeFactor).toBeCloseTo(2.4, 5);
    expect(r.hintLevel).toBe(5);
  });

  it('presentedLevel省略時は保存レベル基準（後方互換）', () => {
    const r = applyAnswer(
      card({ easeFactor: 2.5, hintLevel: 4, repetitions: 2, interval: 6 }),
      true, 5000, NOW
    );
    expect(r.easeFactor).toBeCloseTo(2.3, 5); // 従来通り -0.2
    expect(r.interval).toBe(1);               // quality上限2 → 失敗ブランチ
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
