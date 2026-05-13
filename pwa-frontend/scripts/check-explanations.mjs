/**
 * 解説と正答の整合性チェック
 *
 * チェック内容:
 * 1. 解説中に「正解はX」「Xが正しい」等の明示的な答え言及がある場合、correct_answerと一致するか
 * 2. correct_answerの選択肢テキストが解説中に登場しているか（不在なら要確認）
 * 3. 不正解の選択肢テキストが解説中で「正解」として誤って示されていないか
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../public/data/questions');

const DEPTS = ['nursing', 'clinical_eng', 'dental_hyg', 'orthoptist'];
const LETTER_TO_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };

// 解説中で「これが正解」を示すパターン
const ANSWER_PATTERNS = [
  /正解は([A-E])/g,
  /正答は([A-E])/g,
  /答えは([A-E])/g,
  /([A-E])が正解/g,
  /([A-E])が正答/g,
  /([A-E])が正しい/g,
  /([A-E])が適切/g,
  /([A-E])が最も適切/g,
  /([A-E])が妥当/g,
  /([A-E])が最も妥当/g,
  /選択肢([A-E])が正/g,
];

function extractMentionedAnswers(text) {
  const mentioned = new Set();
  for (const pattern of ANSWER_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      mentioned.add(m[1]);
    }
  }
  return [...mentioned];
}

function checkQuestion(q) {
  const issues = [];
  const correct = q.correct_answer ?? [];
  const choices = q.choices ?? [];
  const expl = q.explanation ?? '';

  if (!expl) {
    issues.push({ type: 'NO_EXPLANATION', detail: '解説なし' });
    return issues;
  }

  // --- チェック1: 解説中の明示的な答え言及と correct_answer の照合 ---
  const mentioned = extractMentionedAnswers(expl);
  if (mentioned.length > 0) {
    const wrongMentions = mentioned.filter(l => !correct.includes(l));
    if (wrongMentions.length > 0) {
      issues.push({
        type: 'LETTER_MISMATCH',
        detail: `解説が "${wrongMentions.join(',')}" を正解と示しているが correct_answer は "${correct.join(',')}"`,
      });
    }
  }

  // --- チェック2: correct_answer の選択肢テキストが解説に登場しているか ---
  for (const letter of correct) {
    const idx = LETTER_TO_INDEX[letter];
    if (idx === undefined || idx >= choices.length) continue;
    const choiceText = (choices[idx] ?? '').trim();
    // 短すぎる選択肢（数字1文字など）は除外
    if (choiceText.length <= 2) continue;
    if (!expl.includes(choiceText)) {
      issues.push({
        type: 'CORRECT_CHOICE_ABSENT',
        detail: `正解${letter}「${choiceText.slice(0, 30)}」が解説に見当たらない`,
      });
    }
  }

  // --- チェック3: 不正解の選択肢テキストが「正解」として言及されていないか ---
  const wrongLetters = Object.keys(LETTER_TO_INDEX).filter(l => !correct.includes(l));
  for (const letter of wrongLetters) {
    const idx = LETTER_TO_INDEX[letter];
    if (idx === undefined || idx >= choices.length) continue;
    const choiceText = (choices[idx] ?? '').trim();
    if (choiceText.length <= 2) continue;
    // その選択肢テキストが解説内で「正解」と紐付けられていないか
    const dangerPatterns = [
      `正解は${choiceText}`,
      `${choiceText}が正解`,
      `${choiceText}が正しい`,
      `${choiceText}が正答`,
      `正答は${choiceText}`,
    ];
    for (const dp of dangerPatterns) {
      if (expl.includes(dp)) {
        issues.push({
          type: 'WRONG_CHOICE_AS_CORRECT',
          detail: `不正解${letter}「${choiceText.slice(0, 30)}」が解説で正解として言及されている`,
        });
        break;
      }
    }
  }

  return issues;
}

let totalQuestions = 0;
let totalIssues = 0;
const report = [];

for (const dept of DEPTS) {
  const path = join(dataDir, `${dept}.json`);
  const questions = JSON.parse(readFileSync(path, 'utf-8'));
  let deptIssues = 0;

  for (const q of questions) {
    totalQuestions++;
    const issues = checkQuestion(q);
    if (issues.length > 0) {
      deptIssues += issues.length;
      totalIssues += issues.length;
      report.push({
        dept,
        question_id: q.question_id,
        correct_answer: q.correct_answer,
        question_text: (q.question_text ?? '').slice(0, 60),
        issues,
      });
    }
  }

  console.log(`[${dept}] ${questions.length}問チェック完了 — 要確認: ${deptIssues}件`);
}

console.log(`\n===== 合計: ${totalQuestions}問中 ${report.length}問に要確認事項 =====\n`);

// 種別ごとに集計
const byType = {};
for (const r of report) {
  for (const issue of r.issues) {
    byType[issue.type] = (byType[issue.type] ?? 0) + 1;
  }
}
console.log('種別内訳:');
for (const [type, count] of Object.entries(byType)) {
  console.log(`  ${type}: ${count}件`);
}

// LETTER_MISMATCH と WRONG_CHOICE_AS_CORRECT のみ詳細表示（深刻なもの）
const serious = report.filter(r =>
  r.issues.some(i => i.type === 'LETTER_MISMATCH' || i.type === 'WRONG_CHOICE_AS_CORRECT')
);

if (serious.length > 0) {
  console.log(`\n===== 深刻な不一致（要修正）: ${serious.length}件 =====`);
  for (const r of serious) {
    const seriousIssues = r.issues.filter(i =>
      i.type === 'LETTER_MISMATCH' || i.type === 'WRONG_CHOICE_AS_CORRECT'
    );
    console.log(`\n[${r.dept}] ${r.question_id}`);
    console.log(`  問題: ${r.question_text}...`);
    console.log(`  正解: ${r.correct_answer?.join(',')}`);
    for (const i of seriousIssues) {
      console.log(`  ⚠️  ${i.type}: ${i.detail}`);
    }
  }
} else {
  console.log('\n深刻な不一致（LETTER_MISMATCH / WRONG_CHOICE_AS_CORRECT）: 0件 ✅');
}

// CORRECT_CHOICE_ABSENT の詳細（多い場合は先頭30件のみ）
const absent = report.filter(r => r.issues.some(i => i.type === 'CORRECT_CHOICE_ABSENT'));
if (absent.length > 0) {
  console.log(`\n===== 正解テキスト不在（解説に正解の選択肢文が見当たらない）: ${absent.length}件 =====`);
  console.log('（解説が概念的な説明のみの場合もあるため参考情報として表示）');
  const show = absent.slice(0, 30);
  for (const r of show) {
    const issues = r.issues.filter(i => i.type === 'CORRECT_CHOICE_ABSENT');
    console.log(`\n[${r.dept}] ${r.question_id} 正解:${r.correct_answer?.join(',')}`);
    console.log(`  問題: ${r.question_text}...`);
    for (const i of issues) {
      console.log(`  ℹ️  ${i.detail}`);
    }
  }
  if (absent.length > 30) {
    console.log(`\n... 他 ${absent.length - 30} 件（多すぎるため省略）`);
  }
}
