#!/usr/bin/env node
// questions.json を学科別に分割し manifest.json を生成する（一度だけ実行）
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDataDir = join(__dirname, '../public/data');
const questionsDir = join(publicDataDir, 'questions');

// ディレクトリ作成
mkdirSync(questionsDir, { recursive: true });

// 全問題を読み込み
console.log('questions.json を読み込み中...');
const questionsFilePath = join(publicDataDir, 'questions.json');

// questions.json の存在チェック
if (!existsSync(questionsFilePath)) {
  console.error(`ERROR: ${questionsFilePath} が見つかりません`);
  process.exit(1);
}

let allQuestions;
try {
  const fileContent = readFileSync(questionsFilePath, 'utf-8');
  allQuestions = JSON.parse(fileContent);

  // 配列かどうかの検証
  if (!Array.isArray(allQuestions)) {
    console.error('ERROR: questions.json は配列である必要があります');
    process.exit(1);
  }
} catch (err) {
  console.error('ERROR: questions.json の解析に失敗しました');
  console.error(err.message);
  process.exit(1);
}

console.log(`総問題数: ${allQuestions.length}`);

// 学科ごとにグループ化
const byDept = {};
for (const q of allQuestions) {
  // department フィールドなし問題のスキップ処理
  if (!q.department) {
    console.warn(`WARNING: department フィールドなし: ${q.question_id || 'unknown'} → スキップ`);
    continue;
  }

  if (!byDept[q.department]) byDept[q.department] = [];
  byDept[q.department].push(q);
}

// 各学科ファイルを書き出し
const now = new Date().toISOString();
const manifestDepts = [];

for (const [dept, questions] of Object.entries(byDept)) {
  const filePath = join(questionsDir, `${dept}.json`);
  const content = JSON.stringify(questions);

  try {
    writeFileSync(filePath, content, 'utf-8');
    const checksum = 'sha256-' + createHash('sha256').update(content).digest('hex');
    console.log(`${dept}: ${questions.length}問 → questions/${dept}.json`);

    manifestDepts.push({
      id: dept,
      version: 1,
      count: questions.length,
      path: `questions/${dept}.json`,
      checksum,
      lastUpdated: now,
    });
  } catch (err) {
    console.error(`ERROR: ${filePath} の書き込みに失敗しました`);
    console.error(err.message);
    process.exit(1);
  }
}

// manifest.json を書き出し
const manifest = {
  schemaVersion: 1,
  generatedAt: now,
  departments: manifestDepts.sort((a, b) => a.id.localeCompare(b.id)),
};

try {
  writeFileSync(join(publicDataDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log('\nmanifest.json を生成しました:');
  console.log(JSON.stringify(manifest, null, 2));
} catch (err) {
  console.error('ERROR: manifest.json の書き込みに失敗しました');
  console.error(err.message);
  process.exit(1);
}
