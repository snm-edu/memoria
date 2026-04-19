#!/usr/bin/env node
/**
 * validate-data.mjs
 * データ整合性検証スクリプト — メモリア（Memoria）PWA
 *
 * 実行: node scripts/validate-data.mjs
 *
 * 検証項目:
 *   1. manifest.json と departments.ts の enabled:true 学科IDが一致
 *   2. questions/{dept}.json の存在 + レコード数が manifest.count と一致
 *   3. 各 Question オブジェクトの手書きバリデーション
 *   4. has_image:true の問題の image_url ファイル存在確認
 *   5. curriculum/{dept}.json の grades キーが departments.ts の grades[] と一致
 *   6. question_id の重複検出（全学科横断）
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

// __dirname 相当の取得（ESM）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..'); // pwa-frontend/ ルート

// ────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────

let hasError = false;

function pass(msg) {
  console.log(`  ✅ ${msg}`);
}

function fail(msg) {
  console.log(`  ❌ ${msg}`);
  hasError = true;
}

function warn(msg) {
  console.log(`  ⚠️  ${msg}`);
}

function section(title) {
  console.log(`\n🔍 ${title}`);
  console.log('─'.repeat(60));
}

// ────────────────────────────────────────────
// Question バリデーター（Zod 非依存、手書き）
// ────────────────────────────────────────────

/**
 * @typedef {{ error: string|null; warn: string|null }} ValidationResult
 */

/**
 * @param {unknown} q
 * @returns {ValidationResult}
 */
function validateQuestion(q) {
  if (!q || typeof q !== 'object') return { error: 'Question がオブジェクトではない', warn: null };
  if (!q.question_id || typeof q.question_id !== 'string') return { error: 'question_id が無効', warn: null };
  if (!q.department || typeof q.department !== 'string') return { error: 'department が無効', warn: null };
  if (q.exam_year == null) return { error: 'exam_year が未設定', warn: null };
  if (typeof q.exam_year !== 'number' && typeof q.exam_year !== 'string') return { error: 'exam_year の型が不正', warn: null };
  if (!q.question_text || typeof q.question_text !== 'string') return { error: 'question_text が空', warn: null };
  if (typeof q.difficulty !== 'number' || q.difficulty < 1 || q.difficulty > 5) return { error: `difficulty が範囲外 (${q.difficulty})`, warn: null };

  // correct_answer が空 = 国家試験上の「不備問題採点除外」として警告扱い
  if (!Array.isArray(q.correct_answer) || q.correct_answer.length === 0) {
    return { error: null, warn: 'correct_answer が空（不備問題・採点除外）' };
  }

  // choices < 4 = 計算問題（自由記述式回答）として警告扱い
  // ※ 選択肢なしの計算問題は正答が存在するが choices が空または少ない
  if (!Array.isArray(q.choices) || q.choices.length < 4) {
    return { error: null, warn: `choices が4未満 (${Array.isArray(q.choices) ? q.choices.length : 'not array'})（計算問題の可能性）` };
  }

  return { error: null, warn: null }; // OK
}

// ────────────────────────────────────────────
// departments.ts をテキストとして解析
// ────────────────────────────────────────────

/**
 * departments.ts から enabled:true の id を正規表現で抽出する
 * @returns {{ id: string; grades: number[] }[]}
 */
function parseEnabledDepartments() {
  const tsPath = join(ROOT, 'src/config/departments.ts');
  if (!existsSync(tsPath)) {
    throw new Error(`departments.ts が見つかりません: ${tsPath}`);
  }

  const src = readFileSync(tsPath, 'utf-8');
  const results = [];

  // REGISTRY_DATA の各エントリをブロック単位で抽出
  // { ... id: 'xxx' ... enabled: true/false ... grades: [...] ... }
  // ブロック境界は `{` / `}` の対応を追跡
  const blocks = extractObjectBlocks(src);

  for (const block of blocks) {
    // id を抽出
    const idMatch = block.match(/\bid:\s*['"](\w+)['"]/);
    if (!idMatch) continue;
    const id = idMatch[1];

    // enabled を抽出
    const enabledMatch = block.match(/\benabled:\s*(true|false)/);
    if (!enabledMatch || enabledMatch[1] !== 'true') continue;

    // grades を抽出: grades: [1, 2, 3]
    const gradesMatch = block.match(/\bgrades:\s*\[([^\]]+)\]/);
    let grades = [];
    if (gradesMatch) {
      grades = gradesMatch[1]
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n));
    }

    results.push({ id, grades });
  }

  return results;
}

/**
 * ソースコードから { ... } ブロックを抽出する（浅い1段階のみ）
 * REGISTRY_DATA の直下の配列要素を狙う
 */
function extractObjectBlocks(src) {
  // REGISTRY_DATA の `[` の後から探す
  const startIdx = src.indexOf('const REGISTRY_DATA');
  if (startIdx === -1) return [];

  const blocks = [];
  let depth = 0;
  let blockStart = -1;
  let inRegistry = false;

  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[' && !inRegistry && depth === 0) {
      inRegistry = true;
      continue;
    }
    if (!inRegistry) continue;

    if (ch === '{') {
      if (depth === 0) blockStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && blockStart !== -1) {
        blocks.push(src.slice(blockStart, i + 1));
        blockStart = -1;
      }
      if (depth < 0) break; // 配列の ] を超えた
    }
  }

  return blocks;
}

// ────────────────────────────────────────────
// メイン検証ロジック
// ────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('  メモリア（Memoria）データ整合性チェック');
  console.log('='.repeat(60));

  // manifest.json を読み込む
  const manifestPath = join(ROOT, 'public/data/manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`❌ manifest.json が見つかりません: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // departments.ts を解析
  let enabledDepts;
  try {
    enabledDepts = parseEnabledDepartments();
  } catch (e) {
    console.error(`❌ departments.ts の解析に失敗: ${e.message}`);
    process.exit(1);
  }

  // ────────────────────────────────────────────
  // 検証1: manifest と departments.ts の enabled ID が一致
  // ────────────────────────────────────────────
  section('検証1: manifest ↔ departments.ts (enabled:true) の学科ID一致');

  const manifestIds = new Set(manifest.departments.map(d => d.id));
  const enabledIds = new Set(enabledDepts.map(d => d.id));

  if (manifestIds.size === 0) {
    fail('manifest.departments が空です');
  }
  if (enabledIds.size === 0) {
    fail('departments.ts に enabled:true の学科が見つかりませんでした');
  }

  for (const id of manifestIds) {
    if (!enabledIds.has(id)) {
      fail(`manifest にある "${id}" が departments.ts に存在しない（または enabled:false）`);
    } else {
      pass(`"${id}" — manifest と departments.ts で一致`);
    }
  }
  for (const id of enabledIds) {
    if (!manifestIds.has(id)) {
      fail(`departments.ts の "${id}" が manifest に存在しない`);
    }
  }

  // ────────────────────────────────────────────
  // 検証2 + 3 + 4 + 6: questions/{dept}.json 検証
  // ────────────────────────────────────────────
  section('検証2: questions/{dept}.json の存在 + レコード数確認');

  const allQuestions = []; // 全学科の問題（重複検出用）

  for (const deptMeta of manifest.departments) {
    const { id, count, path } = deptMeta;
    const qPath = join(ROOT, 'public/data', path);

    console.log(`\n  📂 ${id} (期待: ${count}問)`);

    if (!existsSync(qPath)) {
      fail(`ファイルが存在しない: ${qPath}`);
      continue;
    }

    let questions;
    try {
      questions = JSON.parse(readFileSync(qPath, 'utf-8'));
    } catch (e) {
      fail(`JSON パースエラー: ${e.message}`);
      continue;
    }

    if (!Array.isArray(questions)) {
      fail(`JSON がArrayではない（型: ${typeof questions}）`);
      continue;
    }

    // 検証2: レコード数
    if (questions.length === count) {
      pass(`レコード数一致: ${questions.length}問`);
    } else {
      fail(`レコード数不一致: 実際=${questions.length}問 / manifest.count=${count}問`);
    }

    // 検証3: 各 Question を手書きバリデーション
    section(`検証3: ${id} の各 Question バリデーション`);
    let qErrors = 0;
    let qWarns = 0;
    const firstErrors = [];
    const firstWarns = [];
    for (const q of questions) {
      const result = validateQuestion(q);
      if (result.error) {
        qErrors++;
        if (firstErrors.length < 5) {
          firstErrors.push(`question_id=${q?.question_id ?? '(不明)'}: ${result.error}`);
        }
      } else if (result.warn) {
        qWarns++;
        if (firstWarns.length < 3) {
          firstWarns.push(`question_id=${q?.question_id ?? '(不明)'}: ${result.warn}`);
        }
      }
    }
    if (qErrors === 0 && qWarns === 0) {
      pass(`全 ${questions.length} 問 バリデーションOK`);
    } else if (qErrors === 0) {
      pass(`エラーなし（不備問題 ${qWarns} 件は採点除外として警告扱い）`);
      firstWarns.forEach(e => console.log(`    └ ⚠️  ${e}`));
      if (qWarns > 3) console.log(`    └ ⚠️  （他 ${qWarns - 3} 件省略）`);
    } else {
      fail(`${qErrors} 問にバリデーションエラー`);
      firstErrors.forEach(e => console.log(`    └ ❌ ${e}`));
      if (qErrors > 5) console.log(`    └ （他 ${qErrors - 5} 件省略）`);
      if (qWarns > 0) {
        console.log(`    └ ⚠️  不備問題（correct_answer 空）: ${qWarns} 件`);
      }
    }

    // 検証4: has_image:true の image_url ファイル存在確認
    // image_url はセミコロン区切りで複数ファイルを含む場合がある
    section(`検証4: ${id} の has_image:true 問題の画像ファイル確認`);
    const imageProblems = questions.filter(q => q.has_image === true && q.image_url);
    if (imageProblems.length === 0) {
      pass(`has_image:true の問題なし（スキップ）`);
    } else {
      let imgErrors = 0;
      const imgFirstErrors = [];
      for (const q of imageProblems) {
        // セミコロン区切りで複数パスに対応
        const imgPaths = q.image_url.split(';').map(p => p.trim()).filter(Boolean);
        for (const imgRelPath of imgPaths) {
          const imgPath = join(ROOT, 'public', imgRelPath);
          if (!existsSync(imgPath)) {
            imgErrors++;
            if (imgFirstErrors.length < 10) {
              imgFirstErrors.push(`question_id=${q.question_id}: ${imgRelPath}`);
            }
          }
        }
      }
      if (imgErrors === 0) {
        pass(`${imageProblems.length} 件（画像付き問題）のファイルすべて存在`);
      } else {
        fail(`${imgErrors} 件の画像ファイルが存在しない（has_image:true の問題 ${imageProblems.length} 件中）`);
        imgFirstErrors.forEach(e => console.log(`    └ ❌ ${e}`));
        if (imgErrors > 10) console.log(`    └ （他 ${imgErrors - 10} 件省略）`);
      }
    }

    // 重複検出用に蓄積
    allQuestions.push(...questions);
  }

  // ────────────────────────────────────────────
  // 検証5: curriculum/{dept}.json の grades キー確認
  // ────────────────────────────────────────────
  section('検証5: curriculum/{dept}.json の grades キー ↔ departments.ts の grades[] 一致');

  for (const deptEntry of enabledDepts) {
    const { id, grades } = deptEntry;
    const currPath = join(ROOT, `public/data/curriculum/${id}.json`);

    console.log(`\n  📂 ${id} (departments.ts grades: [${grades.join(', ')}])`);

    if (!existsSync(currPath)) {
      fail(`curriculum/${id}.json が存在しない`);
      continue;
    }

    let curr;
    try {
      curr = JSON.parse(readFileSync(currPath, 'utf-8'));
    } catch (e) {
      fail(`JSON パースエラー: ${e.message}`);
      continue;
    }

    if (!curr.grades || typeof curr.grades !== 'object') {
      fail(`curriculum の "grades" キーが存在しないか不正`);
      continue;
    }

    const currGradeKeys = Object.keys(curr.grades).map(Number).sort((a, b) => a - b);
    const deptGradesSorted = [...grades].sort((a, b) => a - b);

    const match =
      currGradeKeys.length === deptGradesSorted.length &&
      currGradeKeys.every((k, i) => k === deptGradesSorted[i]);

    if (match) {
      pass(`grades キー一致: [${currGradeKeys.join(', ')}]`);
    } else {
      fail(`grades キー不一致: curriculum=[${currGradeKeys.join(', ')}] / departments.ts=[${deptGradesSorted.join(', ')}]`);
    }
  }

  // ────────────────────────────────────────────
  // 検証6: question_id の重複検出（全学科横断）
  // ────────────────────────────────────────────
  section('検証6: question_id 重複検出（全学科横断）');

  const idCount = new Map();
  for (const q of allQuestions) {
    if (q.question_id) {
      idCount.set(q.question_id, (idCount.get(q.question_id) ?? 0) + 1);
    }
  }

  const duplicates = [...idCount.entries()].filter(([, c]) => c > 1);
  if (duplicates.length === 0) {
    pass(`全 ${allQuestions.length} 問で question_id の重複なし`);
  } else {
    fail(`${duplicates.length} 件の question_id 重複を検出`);
    duplicates.slice(0, 10).forEach(([id, count]) => {
      console.log(`    └ ❌ "${id}" が ${count} 回出現`);
    });
    if (duplicates.length > 10) console.log(`    └ （他 ${duplicates.length - 10} 件省略）`);
  }

  // ────────────────────────────────────────────
  // 最終結果
  // ────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  if (hasError) {
    console.log('  ❌ データ整合性チェック: 失敗（上記のエラーを修正してください）');
    console.log('='.repeat(60));
    process.exit(1);
  } else {
    console.log('  ✅ データ整合性チェック: 全て正常');
    console.log('='.repeat(60));
    process.exit(0);
  }
}

main().catch(e => {
  console.error(`\n❌ 予期しないエラー: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
