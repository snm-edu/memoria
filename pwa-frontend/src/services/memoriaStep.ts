import type { CardState, Question } from '../types';
import {
  sm2Update,
  calculateQuality,
  adjustQualityForHint,
  clampEF,
  MAX_INTERVAL_DAYS,
} from './sm2';
import { localDateString, addDays } from './date';

/**
 * メモリアステップ — アダプティブ出題アルゴリズム
 *
 * hintLevel 0: 通常出題（ヒントなし）
 * hintLevel 1: 解説付きで再出題
 * hintLevel 2: 不正解1つ除外（3択化）
 * hintLevel 3: キーワードハイライト
 * hintLevel 4: 2択化（正答+不正解1つ）
 * hintLevel 5: 穴埋め形式
 * hintLevel 6: 解答表示→確認
 */

// ---- ヒントレベル更新 ----

/**
 * 正誤に応じてヒントレベルと連続正答数を更新する
 */
export function updateHintLevel(
  card: CardState,
  isCorrect: boolean
): Pick<CardState, 'hintLevel' | 'consecutiveCorrectAtZero'> {
  if (!isCorrect) {
    // 誤答: レベルを1段階上げる（最大6）、連続正答リセット
    return {
      hintLevel: Math.min(6, card.hintLevel + 1),
      consecutiveCorrectAtZero: 0,
    };
  }

  // 正答時: レベルに応じて降下
  let newHintLevel: number;
  if (card.hintLevel <= 2) {
    newHintLevel = 0;
  } else if (card.hintLevel <= 4) {
    newHintLevel = 2;
  } else {
    // レベル5〜6
    newHintLevel = 3;
  }

  // レベル0で正答した場合のみ連続正答数をインクリメント
  const newConsecutive =
    newHintLevel === 0 && card.hintLevel === 0
      ? card.consecutiveCorrectAtZero + 1
      : 0;

  return {
    hintLevel: newHintLevel,
    consecutiveCorrectAtZero: newConsecutive,
  };
}

// ---- 選択肢フィルタリング ----

export interface VisibleChoices {
  /** 表示する選択肢テキスト */
  choices: string[];
  /** 表示ラベル（A, B, C, ...） */
  labels: string[];
  /** 元の選択肢配列でのインデックス */
  originalIndices: number[];
}

/**
 * ヒントレベルに応じて表示する選択肢を決定する
 *
 * @param choices 全選択肢の配列
 * @param correctAnswer 正答ラベル（"A", "B", ...）の配列
 * @param hintLevel 現在のヒントレベル
 */
export function getVisibleChoices(
  choices: string[],
  correctAnswer: string[],
  hintLevel: number
): VisibleChoices {
  const allLabels = choices.map((_, i) => String.fromCharCode(65 + i)); // A, B, C, ...
  const allIndices = choices.map((_, i) => i);

  // 正答のインデックスを特定
  const correctIndices = new Set(
    correctAnswer.map((label) => label.charCodeAt(0) - 65)
  );

  // 不正解のインデックスを収集
  const incorrectIndices = allIndices.filter((i) => !correctIndices.has(i));

  // レベル2: 不正解1つを除外して3択にする
  if (hintLevel === 2 && incorrectIndices.length >= 2) {
    // ランダムに不正解を1つ選んで除外
    const removeIdx =
      incorrectIndices[Math.floor(Math.random() * incorrectIndices.length)]!;
    const kept = allIndices.filter((i) => i !== removeIdx);
    return {
      choices: kept.map((i) => choices[i]!),
      labels: kept.map((i) => allLabels[i]!),
      originalIndices: kept,
    };
  }

  // レベル4: 正答 + 不正解1つの2択にする
  if (hintLevel === 4 && incorrectIndices.length >= 1) {
    const keptIncorrect =
      incorrectIndices[Math.floor(Math.random() * incorrectIndices.length)]!;
    const kept = [...correctIndices, keptIncorrect].sort((a, b) => a - b);
    return {
      choices: kept.map((i) => choices[i]!),
      labels: kept.map((i) => allLabels[i]!),
      originalIndices: kept,
    };
  }

  // レベル0,1,3,5,6: 全選択肢を表示
  return {
    choices: [...choices],
    labels: allLabels,
    originalIndices: allIndices,
  };
}

// ---- キーワードハイライト（レベル3用） ----

/**
 * 問題文中の医療用語・漢字連続をキーワード候補として<strong>タグで囲む
 *
 * 対象パターン:
 *   - 漢字が2文字以上連続する箇所（医療用語の多くは漢字連続）
 *   - カタカナが3文字以上連続する箇所（外来医療用語）
 */
export function highlightKeywords(questionText: string): string {
  // 漢字2文字以上の連続
  const kanjiPattern = /[\u4e00-\u9faf\u3400-\u4dbf]{2,}/g;
  // カタカナ3文字以上の連続（長音記号を含む）
  const katakanaPattern = /[\u30a0-\u30ff\u31f0-\u31ffー]{3,}/g;

  // まずマッチ位置を収集（重複回避のため）
  interface MatchInfo {
    start: number;
    end: number;
    text: string;
  }
  const matches: MatchInfo[] = [];

  let m: RegExpExecArray | null;
  while ((m = kanjiPattern.exec(questionText)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  while ((m = katakanaPattern.exec(questionText)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }

  // 開始位置でソートし、重複を除外
  matches.sort((a, b) => a.start - b.start);
  const merged: MatchInfo[] = [];
  for (const match of matches) {
    const last = merged[merged.length - 1];
    if (last && match.start < last.end) {
      // 重複: より長い方を採用
      if (match.end > last.end) {
        merged[merged.length - 1] = match;
      }
    } else {
      merged.push(match);
    }
  }

  // 後ろから置換して位置がずれないようにする
  let result = questionText;
  for (let i = merged.length - 1; i >= 0; i--) {
    const { start, end, text } = merged[i]!;
    result = result.slice(0, start) + `<strong>${text}</strong>` + result.slice(end);
  }

  return result;
}

// ---- 穴埋め形式（レベル5用） ----

export interface FillInBlank {
  /** 穴埋めされた解説テキスト */
  text: string;
  /** 穴に入る正答テキスト */
  answer: string;
  /** 穴を1つ以上作れたか。false の場合はレベル5を成立させず確認モードへフォールバックする */
  hasBlank: boolean;
}

/**
 * 「正解はB」「答え：C」「Cが適切」等、正答ラベルを明示する表現を伏せ字化する。
 * 穴埋め表示で解説文がそのまま見えるため、ラベル漏れを機械的に塞ぐ。
 */
function maskAnswerLabels(text: string): string {
  return text
    .replace(/(正解|正答|答え)(\s*(?:は|:|：)\s*)([A-Ea-eＡ-Ｅａ-ｅ])/g, '$1$2◯')
    .replace(/([A-EＡ-Ｅ])(\s*が\s*)(正解|正答|適切)/g, '◯$2$3');
}

/**
 * 解説文から正答選択肢テキストを[ __ ]に置換して穴埋め問題を作成する。
 *
 * - 各正答テキストの「全出現」を穴埋めする（1箇所だけだと2回目以降で答えが見える）
 * - 複数正答はすべて穴埋めし、回答は最初に見つかったテキストのみ要求する
 * - 正答ラベルの明示表現（「正解はB」等）は伏せ字化する
 * - どの正答も解説に含まれない場合は hasBlank=false（呼び出し側でレベル5をスキップ）
 *
 * @param explanation 解説文
 * @param correctChoiceTexts 正答の選択肢テキスト配列
 */
export function createFillInBlank(
  explanation: string,
  correctChoiceTexts: string[]
): FillInBlank {
  let text = explanation;
  let replacedAnswer = '';

  for (const choiceText of correctChoiceTexts) {
    if (choiceText && text.includes(choiceText)) {
      text = text.split(choiceText).join('[ __ ]');
      if (!replacedAnswer) replacedAnswer = choiceText;
    }
  }

  const hasBlank = replacedAnswer !== '';

  // どの正答テキストも解説文に見つからなかった場合はそのまま返す
  if (!hasBlank && correctChoiceTexts.length > 0) {
    replacedAnswer = correctChoiceTexts[0]!;
  }

  return { text: maskAnswerLabels(text), answer: replacedAnswer, hasBlank };
}

// ---- 出題時の表示状態（プレゼンテーション） ----

/** 選択肢ラベル（A〜E） */
const ALL_CHOICE_LABELS = ['A', 'B', 'C', 'D', 'E'];

export interface MemoriaPresentation {
  hintLevel: number;
  visibleChoices: string[];
  visibleLabels: string[];
  fillInBlank: FillInBlank | null;
  confirmationMode: boolean;
}

/**
 * ヒントレベルと問題データから、表示用の選択肢・穴埋め・確認モードを算出する純関数。
 *
 * - 複数選択問題はレベル2/4の選択肢削減をスキップしレベル1へフォールバック
 * - レベル5は穴埋めを作れた場合のみ成立。穴が作れない問題（解説に正答テキスト非含有）は
 *   全文タイプ一致を強いる無理ゲーになるため、レベル6（確認モード）へフォールバックする
 */
export function computePresentation(
  question: Question,
  hintLevel: number
): MemoriaPresentation {
  // 複数選択問題ではレベル2,4の選択肢削減をスキップ → レベル1(カテゴリヒント)にフォールバック
  let effectiveLevel =
    question.is_multi_select && (hintLevel === 2 || hintLevel === 4)
      ? 1
      : hintLevel;

  const allLabels = ALL_CHOICE_LABELS.slice(0, question.choices.length);

  // レベル5: 穴埋め変換（穴が作れなければレベル6へ）
  if (effectiveLevel === 5) {
    const correctChoiceTexts = question.correct_answer.map((label) => {
      const idx = ALL_CHOICE_LABELS.indexOf(label.toUpperCase());
      return idx >= 0 ? question.choices[idx] ?? '' : '';
    });
    const blank = createFillInBlank(question.explanation, correctChoiceTexts);
    if (blank.hasBlank) {
      return {
        hintLevel: 5,
        visibleChoices: question.choices,
        visibleLabels: allLabels,
        fillInBlank: blank,
        confirmationMode: false,
      };
    }
    effectiveLevel = 6;
  }

  // レベル6: 確認モード
  if (effectiveLevel === 6) {
    return {
      hintLevel: 6,
      visibleChoices: question.choices,
      visibleLabels: allLabels,
      fillInBlank: null,
      confirmationMode: true,
    };
  }

  // レベル2,4: 選択肢削減
  if (effectiveLevel === 2 || effectiveLevel === 4) {
    const result = getVisibleChoices(
      question.choices,
      question.correct_answer,
      effectiveLevel
    );
    return {
      hintLevel: effectiveLevel,
      visibleChoices: result.choices,
      visibleLabels: result.labels,
      fillInBlank: null,
      confirmationMode: false,
    };
  }

  // レベル0,1,3: 全選択肢表示
  return {
    hintLevel: effectiveLevel,
    visibleChoices: question.choices,
    visibleLabels: allLabels,
    fillInBlank: null,
    confirmationMode: false,
  };
}

// ---- SM-2 EaseFactor ペナルティ ----

/**
 * ヒントレベルに応じたEaseFactorペナルティを返す
 * ヒント付きで正答した場合、通常よりEaseFactorを下げるために使用
 */
export function getEaseFactorPenalty(hintLevel: number): number {
  if (hintLevel === 0) return 0;
  if (hintLevel <= 2) return -0.1;
  if (hintLevel <= 4) return -0.2;
  return -0.3; // レベル5〜6
}

// ---- インターバル延長判定 ----

/**
 * ヒントなし連続正答が「ちょうど3回目」に到達した回のみ延長する。
 *
 * 従来は `>= 3` だったため4回目以降も毎回発動し、interval×1.5が複利で乗って
 * interval が指数爆発していた（Date表現上限超過で沈黙クラッシュに至る）。
 * `=== 3` にすることで1ストリークにつき延長ボーナスは1回だけになる。
 */
export function shouldExtendInterval(card: CardState): boolean {
  return card.hintLevel === 0 && card.consecutiveCorrectAtZero === 3;
}

// ---- 回答確定時の合成（SM-2 × メモリアステップ） ----

/**
 * 1回の回答から、SM-2更新・ヒントレベル遷移・EFペナルティ・延長判定までを合成した
 * 次のカード状態を返す純関数。従来 useQuiz.confirmAnswer 内に埋もれていたロジックを
 * テスト可能な形に切り出したもの。
 *
 * ペナルティは「出題時（=更新前）のヒントレベル」で算出し、負値を加算して EF を下げる
 * （従来は更新後レベルを参照し、かつ負値を減算していたため符号が反転し、ヒントに頼った
 * 苦戦カードほど EF が上がる逆適応になっていた）。
 */
export function applyAnswer(
  card: CardState,
  isCorrect: boolean,
  responseTimeMs: number,
  now: Date = new Date()
): CardState {
  const quality = adjustQualityForHint(
    calculateQuality(isCorrect, responseTimeMs),
    card.hintLevel
  );
  const sm2Card = sm2Update(card, quality, now);
  const hintUpdate = updateHintLevel(sm2Card, isCorrect);
  const next: CardState = { ...sm2Card, ...hintUpdate };

  // 出題時のヒントレベルに応じた減点（getEaseFactorPenalty は負値を返す）
  const penalty = getEaseFactorPenalty(card.hintLevel);
  next.easeFactor = clampEF(next.easeFactor + penalty);

  // ヒントなし連続正答3回到達時のみインターバルを1.5倍延長（上限キャップつき）
  if (shouldExtendInterval(next)) {
    next.interval = Math.min(Math.round(next.interval * 1.5), MAX_INTERVAL_DAYS);
    next.nextReview = localDateString(addDays(now, next.interval));
  }

  return next;
}

/**
 * レベル6（確認モード）で解答を見た後の自己申告を反映する。
 *
 * 「理解できた」を自力正答（sm2Update quality=3）として扱うと repetitions++ で
 * interval が満額進行してしまうため、専用に短期再出題へ固定する。
 *   understood=true  : 2日後に再出題・repetitions据え置き・hintLevel3へ
 *   understood=false : 翌日に再出題・hintLevel6維持
 * いずれも EaseFactor は変更しない。
 */
export function confirmUnderstanding(
  card: CardState,
  understood: boolean,
  now: Date = new Date()
): CardState {
  const interval = understood ? 2 : 1;
  return {
    ...card,
    interval,
    hintLevel: understood ? 3 : 6,
    consecutiveCorrectAtZero: understood ? 0 : card.consecutiveCorrectAtZero,
    nextReview: localDateString(addDays(now, interval)),
    lastReview: localDateString(now),
    updatedAt: now.toISOString(),
  };
}
