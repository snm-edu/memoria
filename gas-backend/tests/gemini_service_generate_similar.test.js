// Run: node --test tests/gemini_service_generate_similar.test.js
// （gas-backend/ ディレクトリから実行する）
//
// GeminiService.generateSimilar の永続化まわりを、GAS グローバルをスタブして実際に走らせる。
// 狙いは「1問につき最大3題」の契約が、同時実行・クライアント再送でも破られないこと。
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

const AI_GENERATED_HEADERS = [
  'gen_id', 'original_question_id', 'error_type',
  'question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d',
  'correct_answer', 'explanation', 'difficulty', 'created_at',
];

/** ai_generated シートの偽物。appendRow の結果が getDataRange から見える */
function makeSheet(existingRows) {
  const data = [AI_GENERATED_HEADERS.slice()].concat(existingRows || []);
  return {
    getDataRange: function () { return { getValues: function () { return data; } }; },
    appendRow: function (row) { data.push(row); },
    dataRowCount: function () { return data.length - 1; },
    rows: data,
  };
}

/** 既存の類題1行を作る */
function generatedRow(questionId, n) {
  return [
    'gen-' + n, questionId, 'knowledge_gap',
    '既存の類題' + n, 'A', 'B', 'C', 'D', 'A', '解説', 3, '2026-08-01T00:00:00.000Z',
  ];
}

/**
 * @param {Object} opts
 *   - existingRows: シートに最初から入っている行
 *   - onLock: waitLock が呼ばれた瞬間に走る処理（別リクエストの割り込みを再現）
 *   - lockThrows: waitLock が例外を投げる
 */
function makeSandbox(opts) {
  opts = opts || {};
  const sheet = makeSheet(opts.existingRows);
  const llmCalls = [];
  let released = 0;

  const sandbox = {
    CONFIG: {
      SHEETS: { AI_GENERATED: 'ai_generated' },
      AI_GENERATED_MAX_PER_QUESTION: 3,
    },
    // --- 他ファイルのグローバル（スタブ） ---
    findQuestionById: function (questionId) {
      return { question_id: questionId, question_text: '元の問題文', choices: ['A', 'B', 'C', 'D'], correct_answer: 'A' };
    },
    getDepartmentExpertName: function () { return '臨床工学技士'; },
    callLLM: function (prompt, retries, options) {
      llmCalls.push({ prompt, retries, options });
      return {
        text: JSON.stringify({
          question_text: '生成された類題', choice_a: 'あ', choice_b: 'い', choice_c: 'う', choice_d: 'え',
          correct_answer: 'A', explanation: '生成された解説', difficulty: 3,
        }),
      };
    },
    getOrCreateSheet: function () { return sheet; },
    Utilities: { getUuid: function () { return 'new-uuid'; } },
    LockService: {
      getScriptLock: function () {
        return {
          waitLock: function () {
            if (opts.lockThrows) throw new Error('Could not obtain lock');
            if (opts.onLock) opts.onLock(sheet);
          },
          releaseLock: function () { released += 1; },
        };
      },
    },
    console: { error: function () {}, log: function () {} },
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'GeminiService.gs'), 'utf8'), sandbox, { filename: 'GeminiService.gs' });

  // `const GeminiService = {...}` は字句束縛なのでグローバルオブジェクトには載らない。
  // 後続の runInContext で同じコンテキストの字句スコープから参照を取り出す。
  sandbox.GeminiService = vm.runInContext('GeminiService', sandbox);

  sandbox.__sheet = sheet;
  sandbox.__llmCalls = llmCalls;
  sandbox.__released = function () { return released; };
  return sandbox;
}

const ARGS = { questionId: 'CE-2024-001', errorType: 'knowledge_gap', department: 'clinical_eng' };

// ---------------------------------------------------------------------------

test('通常時は1行だけ追記し、生成結果を返す', () => {
  const box = makeSandbox({ existingRows: [] });
  const result = box.GeminiService.generateSimilar(ARGS);

  assert.strictEqual(box.__sheet.dataRowCount(), 1);
  assert.strictEqual(result.gen_id, 'new-uuid');
  assert.strictEqual(result.question_text, '生成された類題');
  assert.strictEqual(box.__llmCalls.length, 1, 'LLM は1回だけ呼ばれる');
  assert.strictEqual(box.__released(), 1, 'ロックは解放される');
});

test('事前チェックで上限に達していれば LLM を呼ばずに既存を返す', () => {
  const rows = [1, 2, 3].map((n) => generatedRow(ARGS.questionId, n));
  const box = makeSandbox({ existingRows: rows });
  const result = box.GeminiService.generateSimilar(ARGS);

  assert.strictEqual(result.cached, true);
  assert.strictEqual(result.questions.length, 3);
  assert.strictEqual(box.__llmCalls.length, 0, '課金される呼び出しが発生しない');
  assert.strictEqual(box.__sheet.dataRowCount(), 3, '追記されない');
});

test('ロック待ちの間に別リクエストが3件目を積んだら、追記せず既存を返す（4件目を作らない）', () => {
  // 開始時点は2件 → 事前チェック（ロック外）を通過 → LLM を呼ぶ
  // その間に別リクエストが3件目を書き込み、こちらがロックを取れたときには既に上限
  const rows = [1, 2].map((n) => generatedRow(ARGS.questionId, n));
  const box = makeSandbox({
    existingRows: rows,
    onLock: function (sheet) { sheet.appendRow(generatedRow(ARGS.questionId, 3)); },
  });

  const result = box.GeminiService.generateSimilar(ARGS);

  assert.strictEqual(box.__sheet.dataRowCount(), 3, '契約どおり3件で止まる（修正前はここが4になる）');
  assert.strictEqual(result.cached, true);
  assert.strictEqual(result.questions.length, 3);
  assert.strictEqual(box.__released(), 1, '早期 return でもロックは解放される');
});

test('別 questionId の行は上限の数に入れない', () => {
  const rows = [
    generatedRow('CE-2024-999', 1),
    generatedRow('CE-2024-999', 2),
    generatedRow('CE-2024-999', 3),
    generatedRow(ARGS.questionId, 4),
  ];
  const box = makeSandbox({ existingRows: rows });
  const result = box.GeminiService.generateSimilar(ARGS);

  assert.strictEqual(result.gen_id, 'new-uuid', '対象問題はまだ1件なので生成される');
  assert.strictEqual(box.__sheet.dataRowCount(), 5);
});

test('ロックが取れなければ追記せずエラーを返す（部分実行を残さない）', () => {
  const box = makeSandbox({ existingRows: [], lockThrows: true });
  const result = box.GeminiService.generateSimilar(ARGS);

  assert.ok(result.error, 'エラーとして返る');
  assert.match(result.error, /busy/);
  assert.strictEqual(box.__sheet.dataRowCount(), 0, '追記されていない');
  assert.strictEqual(box.__released(), 0, '取れていないロックを解放しにいかない');
});

// ---------------------------------------------------------------------------
// 既存のバリデーション（回帰）
// ---------------------------------------------------------------------------

test('questionId / errorType が無ければ何もしない', () => {
  const box = makeSandbox({ existingRows: [] });
  assert.match(box.GeminiService.generateSimilar({ questionId: '', errorType: 'knowledge_gap' }).error, /required/);
  assert.match(box.GeminiService.generateSimilar({ questionId: 'x', errorType: '' }).error, /required/);
  assert.strictEqual(box.__llmCalls.length, 0);
});

test('問題バンクに無い questionId は拒否する（任意テキスト注入・無制限課金の防止）', () => {
  const box = makeSandbox({ existingRows: [] });
  box.findQuestionById = function () { return null; };
  const result = box.GeminiService.generateSimilar(ARGS);
  assert.match(result.error, /unknown questionId/);
  assert.strictEqual(box.__llmCalls.length, 0);
  assert.strictEqual(box.__sheet.dataRowCount(), 0);
});

test('errorType はホワイトリスト外なら knowledge_gap に落とす', () => {
  const box = makeSandbox({ existingRows: [] });
  const result = box.GeminiService.generateSimilar({ ...ARGS, errorType: '<script>alert(1)</script>' });
  assert.strictEqual(result.error_type, 'knowledge_gap');
  assert.strictEqual(box.__sheet.rows[1][2], 'knowledge_gap');
});
