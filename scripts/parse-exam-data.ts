/**
 * ナースメモリア 国試データパーサー
 *
 * NRS国試まとめ_分類追加版.md → questions.json
 * NRS国試分野別まとめ2014-2024（新2）.md → 分類マスタとマージ
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === 型定義 ===

interface ParsedQuestion {
  question_id: string;
  department: string;
  exam_year: number;
  exam_number: number;
  category: string;          // 大分類（問題ファイルから）
  subcategory: string;       // 中分類（カテゴリタグ）
  subtopic: string;          // 小分類
  difficulty: number;
  question_text: string;
  choices: string[];
  correct_answer: string[];
  explanation: string;
  has_image: boolean;
  image_url: string;
  is_multi_select: boolean;
  source: string;
  created_at: string;
  // 分類マスタから追加
  master_category: string;   // 大分類（マスタ）
  master_subcategory: string; // 中分類（マスタ）
  master_subtopic: string;   // 小分類（マスタ）
}

interface ClassificationEntry {
  question_id: string;
  file_category: string;     // 大分類（問題ファイル）
  master_category: string;   // 大分類（マスタ）
  master_subcategory: string; // 中分類（マスタ）
  master_subtopic: string;   // 小分類（マスタ）
}

// === ユーティリティ ===

/** 全角→半角 正規化（数字・英字・記号） */
function normalizeWidth(str: string): string {
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    )
    .replace(/．/g, '.')
    .replace(/，/g, ',')
    .replace(/　/g, ' ');
}

/** 問題IDからexam_numberを抽出 (例: 2014_nrs_14_pm001 → 1) */
function extractExamNumber(questionId: string): number {
  const match = questionId.match(/(\d{3})$/);
  return match ? parseInt(match[1], 10) : 0;
}

/** 選択肢番号からアルファベットに変換 */
function choiceNumberToLetter(num: number): string {
  return String.fromCharCode(64 + num); // 1→A, 2→B, ...
}

// === CSVパース（クォート対応） ===

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// === メイン: 問題ファイルパーサー ===

type ParserState = 'AWAITING_METADATA' | 'AWAITING_QUESTION' | 'COLLECTING_CHOICES';

function parseQuestionFile(filePath: string): ParsedQuestion[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const questions: ParsedQuestion[] = [];
  const seenIds = new Set<string>();

  let state: ParserState = 'AWAITING_METADATA';
  let currentQuestion: Partial<ParsedQuestion> = {};
  let choiceNumber = 0;
  let multilineBuffer = '';
  let inMultilineQuestion = false;

  function finalizeQuestion() {
    if (!currentQuestion.question_id) return;
    if (seenIds.has(currentQuestion.question_id)) return; // 重複排除

    const q = currentQuestion as ParsedQuestion;

    // 「2つ選べ」検出
    q.is_multi_select = /2つ選べ/.test(q.question_text);

    // 図表参照検出
    q.has_image = /図に示す|図を示す|写真を示す|別冊/.test(q.question_text);

    // デフォルト値
    q.explanation = q.explanation || '';
    q.image_url = q.image_url || '';
    q.difficulty = q.difficulty || 3;
    q.source = 'notebooklm';
    q.created_at = new Date().toISOString();
    q.master_category = q.master_category || '';
    q.master_subcategory = q.master_subcategory || '';
    q.master_subtopic = q.master_subtopic || '';

    if (q.correct_answer.length === 0) {
      console.warn(`⚠️  正解なし: ${q.question_id} - ${q.question_text.substring(0, 30)}`);
    }

    seenIds.add(q.question_id);
    questions.push(q);
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\r$/, '');

    // 複数行問題文の処理
    if (inMultilineQuestion) {
      multilineBuffer += '\n' + line;
      // 閉じクォートの検出
      if (line.includes('"')) {
        // クォート内のフィールドが閉じた
        const fields = parseCSVLine(multilineBuffer);
        // fieldsの3番目（index 2）が問題文
        currentQuestion.question_text = fields[2]?.trim() || multilineBuffer;
        inMultilineQuestion = false;
        multilineBuffer = '';
        state = 'COLLECTING_CHOICES';
        choiceNumber = 0;
      }
      continue;
    }

    // 空行・全空CSV行のスキップ
    if (line.trim() === '' || /^,+$/.test(line.trim())) {
      continue;
    }

    const fields = parseCSVLine(line);

    switch (state) {
      case 'AWAITING_METADATA': {
        // メタデータ行: 看護師,年度,大分類,...
        if (fields[0] === '看護師' || fields[0]?.startsWith('看護師')) {
          // 前の問題を保存
          if (currentQuestion.question_id) {
            finalizeQuestion();
          }

          const year = parseInt(fields[1], 10);
          const category = fields[2]?.trim() || '';
          // fields[3]はサブカテゴリ（あれば）
          // question_idはfields[6]
          const questionId = fields[6]?.trim() || '';
          const subcategory = fields[7]?.trim() || '';
          const subtopic = fields[8]?.trim() || '';

          currentQuestion = {
            question_id: questionId,
            department: 'nursing',
            exam_year: year,
            exam_number: extractExamNumber(questionId),
            category: category,
            subcategory: subcategory,
            subtopic: subtopic,
            question_text: '',
            choices: [],
            correct_answer: [],
            has_image: false,
            image_url: '',
            is_multi_select: false,
            difficulty: 3,
            explanation: '',
            source: 'notebooklm',
            created_at: '',
            master_category: '',
            master_subcategory: '',
            master_subtopic: '',
          };

          state = 'AWAITING_QUESTION';
        }
        break;
      }

      case 'AWAITING_QUESTION': {
        // 問題文行: ,,問題文,,,,,,
        if (fields[0] === '' && fields[1] === '' && fields[2]) {
          const questionText = fields[2].trim();

          // 複数行問題文の開始検出（開きクォートがあるが閉じていない）
          const quoteCount = (line.match(/"/g) || []).length;
          if (quoteCount % 2 !== 0) {
            inMultilineQuestion = true;
            multilineBuffer = line;
            break;
          }

          currentQuestion.question_text = questionText;
          state = 'COLLECTING_CHOICES';
          choiceNumber = 0;
        }
        break;
      }

      case 'COLLECTING_CHOICES': {
        // 選択肢行: ,,N,テキスト,,,正解（あれば）,,
        if (fields[0] === '' && fields[1] === '') {
          const choiceNum = parseInt(fields[2], 10);

          if (choiceNum >= 1 && choiceNum <= 5) {
            const choiceText = fields[3]?.trim() || '';
            const isCorrect = fields[6]?.trim() === '正解';

            currentQuestion.choices = currentQuestion.choices || [];
            currentQuestion.choices.push(choiceText);

            if (isCorrect) {
              currentQuestion.correct_answer = currentQuestion.correct_answer || [];
              currentQuestion.correct_answer.push(choiceNumberToLetter(choiceNum));
            }

            choiceNumber = choiceNum;
          }
        }

        // 次のメタデータ行が来たら、この問題は終了
        if (fields[0] === '看護師' || fields[0]?.startsWith('看護師')) {
          finalizeQuestion();

          // このメタデータ行を処理
          const year = parseInt(fields[1], 10);
          const category = fields[2]?.trim() || '';
          const questionId = fields[6]?.trim() || '';
          const subcategory = fields[7]?.trim() || '';
          const subtopic = fields[8]?.trim() || '';

          currentQuestion = {
            question_id: questionId,
            department: 'nursing',
            exam_year: year,
            exam_number: extractExamNumber(questionId),
            category: category,
            subcategory: subcategory,
            subtopic: subtopic,
            question_text: '',
            choices: [],
            correct_answer: [],
            has_image: false,
            image_url: '',
            is_multi_select: false,
            difficulty: 3,
            explanation: '',
            source: 'notebooklm',
            created_at: '',
            master_category: '',
            master_subcategory: '',
            master_subtopic: '',
          };

          state = 'AWAITING_QUESTION';
        }
        break;
      }
    }
  }

  // 最後の問題を保存
  if (currentQuestion.question_id) {
    finalizeQuestion();
  }

  return questions;
}

// === 分類マスタ パーサー ===

function parseClassificationFile(filePath: string): Map<string, ClassificationEntry> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const map = new Map<string, ClassificationEntry>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '').trim();
    if (!line || line.startsWith('問題ID')) continue; // ヘッダースキップ

    const fields = line.split(',');
    const questionId = fields[0]?.trim();
    if (!questionId) continue;

    map.set(questionId, {
      question_id: questionId,
      file_category: normalizeWidth(fields[1]?.trim() || ''),
      master_category: normalizeWidth(fields[2]?.trim() || ''),
      master_subcategory: normalizeWidth(fields[3]?.trim() || ''),
      master_subtopic: normalizeWidth(fields[4]?.trim() || ''),
    });
  }

  return map;
}

// === マージ & 出力 ===

function mergeAndExport(
  questions: ParsedQuestion[],
  classification: Map<string, ClassificationEntry>
): void {
  let mergedCount = 0;
  let unmatchedCount = 0;

  for (const q of questions) {
    const cls = classification.get(q.question_id);
    if (cls) {
      q.master_category = cls.master_category;
      q.master_subcategory = cls.master_subcategory;
      q.master_subtopic = cls.master_subtopic;
      // subcategoryとsubtopicをマスタで上書き（より正確）
      if (cls.master_subcategory) q.subcategory = cls.master_subcategory;
      if (cls.master_subtopic) q.subtopic = cls.master_subtopic;
      mergedCount++;
    } else {
      unmatchedCount++;
    }
  }

  console.log(`✅ 分類マスタマージ: ${mergedCount}問マッチ, ${unmatchedCount}問マッチなし`);

  // Google Sheets互換のフラット形式も生成
  const sheetsFormat = questions.map((q) => ({
    question_id: q.question_id,
    department: q.department,
    exam_year: q.exam_year,
    exam_number: q.exam_number,
    category: q.master_category || q.category,
    subcategory: q.subcategory,
    subtopic: q.subtopic,
    difficulty: q.difficulty,
    question_text: q.question_text,
    choice_a: q.choices[0] || '',
    choice_b: q.choices[1] || '',
    choice_c: q.choices[2] || '',
    choice_d: q.choices[3] || '',
    choice_e: q.choices[4] || '',
    correct_answer: q.correct_answer.join(','),
    explanation: q.explanation,
    has_image: q.has_image,
    image_url: q.image_url,
    is_multi_select: q.is_multi_select,
    source: q.source,
    created_at: q.created_at,
  }));

  // 出力ディレクトリ
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // JSON出力
  fs.writeFileSync(
    path.join(outputDir, 'questions.json'),
    JSON.stringify(questions, null, 2),
    'utf-8'
  );

  // Sheets用フラット形式
  fs.writeFileSync(
    path.join(outputDir, 'questions-sheets.json'),
    JSON.stringify(sheetsFormat, null, 2),
    'utf-8'
  );

  // CSV出力（Sheets直接インポート用）
  const csvHeader = [
    'question_id', 'department', 'exam_year', 'exam_number',
    'category', 'subcategory', 'subtopic', 'difficulty',
    'question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'choice_e',
    'correct_answer', 'explanation', 'has_image', 'image_url', 'is_multi_select',
    'source', 'created_at'
  ].join(',');

  const csvRows = sheetsFormat.map((row) => {
    return [
      row.question_id,
      row.department,
      row.exam_year,
      row.exam_number,
      csvEscape(row.category),
      csvEscape(row.subcategory),
      csvEscape(row.subtopic),
      row.difficulty,
      csvEscape(row.question_text),
      csvEscape(row.choice_a),
      csvEscape(row.choice_b),
      csvEscape(row.choice_c),
      csvEscape(row.choice_d),
      csvEscape(row.choice_e),
      row.correct_answer,
      csvEscape(row.explanation),
      row.has_image,
      row.image_url,
      row.is_multi_select,
      row.source,
      row.created_at,
    ].join(',');
  });

  fs.writeFileSync(
    path.join(outputDir, 'questions.csv'),
    '\uFEFF' + csvHeader + '\n' + csvRows.join('\n'),
    'utf-8'
  );

  console.log(`📁 出力先: ${outputDir}/`);
  console.log(`   - questions.json (${questions.length}問)`);
  console.log(`   - questions-sheets.json (Sheets用フラット形式)`);
  console.log(`   - questions.csv (Sheetsインポート用)`);
}

function csvEscape(str: string): string {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// === 統計レポート ===

function printStats(questions: ParsedQuestion[]): void {
  console.log('\n📊 パース統計:');
  console.log(`   総問題数: ${questions.length}`);

  // 年度別
  const byYear = new Map<number, number>();
  for (const q of questions) {
    byYear.set(q.exam_year, (byYear.get(q.exam_year) || 0) + 1);
  }
  console.log('\n   年度別:');
  for (const [year, count] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`     ${year}年: ${count}問`);
  }

  // 大分類別
  const byCategory = new Map<string, number>();
  for (const q of questions) {
    const cat = q.master_category || q.category;
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
  }
  console.log('\n   大分類別:');
  for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${cat}: ${count}問`);
  }

  // エッジケース
  const multiSelect = questions.filter((q) => q.is_multi_select).length;
  const hasImage = questions.filter((q) => q.has_image).length;
  const fiveChoice = questions.filter((q) => q.choices.length === 5).length;
  const noCorrect = questions.filter((q) => q.correct_answer.length === 0).length;

  console.log('\n   エッジケース:');
  console.log(`     「2つ選べ」: ${multiSelect}問`);
  console.log(`     図表参照: ${hasImage}問`);
  console.log(`     5択: ${fiveChoice}問`);
  console.log(`     正解なし: ${noCorrect}問`);
}

// === エントリポイント ===

function main() {
  const dataDir = path.join(__dirname, '..', 'NRS国試data');
  const questionFile = path.join(dataDir, 'NRS国試まとめ_分類追加版.md');
  const classificationFile = path.join(dataDir, 'NRS国試分野別まとめ2014-2024（新2）.md');

  console.log('🔄 国試データパーサー 開始\n');

  // 1. 問題ファイル解析
  console.log('📖 問題ファイル解析中...');
  const questions = parseQuestionFile(questionFile);
  console.log(`   → ${questions.length}問をパース（重複排除済み）`);

  // 2. 分類マスタ読み込み
  console.log('\n📖 分類マスタ読み込み中...');
  const classification = parseClassificationFile(classificationFile);
  console.log(`   → ${classification.size}エントリ`);

  // 3. マージ
  console.log('\n🔗 マージ中...');
  mergeAndExport(questions, classification);

  // 4. 統計
  printStats(questions);

  console.log('\n✅ 完了');
}

main();
