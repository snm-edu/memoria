import type { CardState } from '../types';

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
}

/**
 * 解説文から正答選択肢テキストを[ __ ]に置換して穴埋め問題を作成する
 *
 * @param explanation 解説文
 * @param correctChoiceTexts 正答の選択肢テキスト配列
 */
export function createFillInBlank(
  explanation: string,
  correctChoiceTexts: string[]
): FillInBlank {
  let text = explanation;
  // 最初に見つかった正答テキストを置換対象にする
  let replacedAnswer = '';

  for (const choiceText of correctChoiceTexts) {
    if (choiceText && text.includes(choiceText)) {
      text = text.replace(choiceText, '[ __ ]');
      replacedAnswer = choiceText;
      break;
    }
  }

  // どの正答テキストも解説文に見つからなかった場合はそのまま返す
  if (!replacedAnswer && correctChoiceTexts.length > 0) {
    replacedAnswer = correctChoiceTexts[0]!;
  }

  return { text, answer: replacedAnswer };
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
 * ヒントなしで3回以上連続正答している場合、インターバルを延長すべきか判定
 */
export function shouldExtendInterval(card: CardState): boolean {
  return card.hintLevel === 0 && card.consecutiveCorrectAtZero >= 3;
}
