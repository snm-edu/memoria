// Run: node --test tests/llm_service.test.js
// （gas-backend/ ディレクトリから実行する）
//
// LlmService.gs は GAS グローバル（UrlFetchApp / Utilities / Logger / getOrCreateSheet）に
// 依存するため、vm でスタブ環境を作って実際に評価・実行する。
// HTTP は差し替えるが、リトライ判断・レスポンス解析・ログ行の組み立ては本物のコードが走る。
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

// vm コンテキスト内で生成されたオブジェクトは Object.prototype が別レルムのものになるため、
// deepStrictEqual が「構造は同じだが参照が違う」で落ちる。比較前にこちら側のプレーンな
// オブジェクトへ写す。
function plain(obj) {
  return Object.assign({}, obj);
}

/**
 * LlmServiceCore.gs + LlmService.gs を評価したサンドボックスを作る。
 * @param {Object} opts
 *   - responses: UrlFetchApp.fetch が順に返す {code, body} の配列
 *   - config: CONFIG の上書き
 *   - properties: スクリプトプロパティの中身（LLM_PROVIDER_<caller> の検証用）
 *   - propertiesThrows: true なら getProperties() が例外を投げる
 */
function makeSandbox(opts) {
  opts = opts || {};
  const queue = (opts.responses || []).slice();
  const calls = [];      // fetch に渡された引数
  const sleeps = [];     // Utilities.sleep の待ち時間
  const appended = [];   // ai_call_log に積まれた行
  const logs = [];
  const propertyReads = []; // getProperties() が呼ばれた回数

  const sandbox = {
    CONFIG: Object.assign({
      LLM_PROVIDER: 'gemini',
      GEMINI_MODEL: 'gemini-2.5-flash-lite',
      GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/',
      GEMINI_API_KEY: 'dummy-gemini-key',
      OPENAI_MODEL: 'gpt-5.6-luna',
      OPENAI_API_URL: 'https://api.openai.com/v1/responses',
      OPENAI_API_KEY: 'dummy-openai-key',
      OPENAI_REASONING_EFFORT: 'none',
      OPENAI_MAX_OUTPUT_TOKENS: 1024,
      SHEETS: { AI_CALL_LOG: 'ai_call_log' },
    }, opts.config || {}),

    UrlFetchApp: {
      fetch: function (url, params) {
        calls.push({ url, params });
        const next = queue.shift();
        if (!next) throw new Error('スタブのレスポンスが尽きた（想定より多く fetch された）');
        if (next.throws) throw new Error(next.throws);
        return {
          getResponseCode: function () { return next.code; },
          getContentText: function () { return next.body; },
        };
      },
    },

    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperties: function () {
            propertyReads.push(1);
            if (opts.propertiesThrows) throw new Error('properties unavailable');
            return Object.assign({}, opts.properties || {});
          },
        };
      },
    },

    Utilities: { sleep: function (ms) { sleeps.push(ms); } },
    Logger: { log: function (m) { logs.push(String(m)); } },
    getOrCreateSheet: function () {
      return { appendRow: function (row) { appended.push(row); } };
    },
    JSON, Date, Math, Number, String, Object,
  };

  vm.createContext(sandbox);
  for (const file of ['LlmServiceCore.gs', 'LlmService.gs']) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file });
  }

  sandbox.__calls = calls;
  sandbox.__sleeps = sleeps;
  sandbox.__appended = appended;
  sandbox.__logs = logs;
  sandbox.__propertyReads = propertyReads;
  return sandbox;
}

/** Responses API の成功応答（output[0] は reasoning） */
function okResponse(text, usage) {
  return {
    code: 200,
    body: JSON.stringify({
      status: 'completed',
      output: [
        { id: 'rs_1', type: 'reasoning', summary: [] },
        { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
      ],
      usage: usage || { input_tokens: 800, output_tokens: 250, output_tokens_details: { reasoning_tokens: 0 } },
    }),
  };
}

// ---------------------------------------------------------------------------
// プロバイダの振り分け
// ---------------------------------------------------------------------------

test('CONFIG.LLM_PROVIDER=gemini なら Gemini のエンドポイントを叩く', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    responses: [{ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ジェミニ応答' }] } }] }) }],
  });
  const result = box.callLLM('こんにちは', 3, { caller: 'test' });
  assert.deepStrictEqual(plain(result), { text: 'ジェミニ応答' });
  assert.match(box.__calls[0].url, /generativelanguage\.googleapis\.com/);
});

test('CONFIG.LLM_PROVIDER=openai なら Responses API を叩き Bearer を付ける', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'openai' },
    responses: [okResponse('ルナ応答')],
  });
  const result = box.callLLM('こんにちは', 3, { caller: 'test' });
  assert.deepStrictEqual(plain(result), { text: 'ルナ応答' });

  const call = box.__calls[0];
  assert.strictEqual(call.url, 'https://api.openai.com/v1/responses');
  assert.strictEqual(call.params.headers.Authorization, 'Bearer dummy-openai-key');

  const sent = JSON.parse(call.params.payload);
  assert.strictEqual(sent.model, 'gpt-5.6-luna');
  assert.deepStrictEqual(sent.reasoning, { effort: 'none' });
  assert.strictEqual(sent.max_output_tokens, 1024);
});

test('options.provider は CONFIG より優先される', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    responses: [okResponse('明示指定')],
  });
  const result = box.callLLM('x', 3, { provider: 'openai', caller: 'test' });
  assert.deepStrictEqual(plain(result), { text: '明示指定' });
  assert.match(box.__calls[0].url, /api\.openai\.com/);
});

test('未知の provider 値は gemini に倒す', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'anthropic' },
    responses: [{ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }) }],
  });
  box.callLLM('x', 3, {});
  assert.match(box.__calls[0].url, /generativelanguage/);
});

test('LLM_PROVIDER_<caller> は全体設定を上書きする（バッチだけ先行切替できる）', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    properties: { 'LLM_PROVIDER_dashboard.teacherComment': 'openai' },
    responses: [okResponse('教員コメント')],
  });
  box.callLLM('x', 3, { caller: 'dashboard.teacherComment' });
  assert.match(box.__calls[0].url, /api\.openai\.com/);
});

test('LLM_PROVIDER_<caller> が無い caller は全体設定に従う', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    properties: { 'LLM_PROVIDER_dashboard.teacherComment': 'openai' },
    responses: [{ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }) }],
  });
  box.callLLM('x', 3, { caller: 'analyzeError' });
  assert.match(box.__calls[0].url, /generativelanguage/);
});

test('LLM_PROVIDER_<caller> は全体が openai でも個別に gemini へ据え置ける', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'openai' },
    properties: { LLM_PROVIDER_analyzeError: 'gemini' },
    responses: [{ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }) }],
  });
  box.callLLM('x', 3, { caller: 'analyzeError' });
  assert.match(box.__calls[0].url, /generativelanguage/);
});

test('LLM_PROVIDER_<caller> の値がタイプミスなら無視して全体設定に落ちる', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'openai' },
    properties: { LLM_PROVIDER_analyzeError: 'openal' },
    responses: [okResponse('ルナ応答')],
  });
  box.callLLM('x', 3, { caller: 'analyzeError' });
  assert.match(box.__calls[0].url, /api\.openai\.com/);
});

test('options.provider は LLM_PROVIDER_<caller> より優先される', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    properties: { LLM_PROVIDER_analyzeError: 'gemini' },
    responses: [okResponse('明示指定が最優先')],
  });
  box.callLLM('x', 3, { provider: 'openai', caller: 'analyzeError' });
  assert.match(box.__calls[0].url, /api\.openai\.com/);
});

test('スクリプトプロパティの読み出しは1実行で1回に抑える', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    properties: {},
    responses: [
      { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a' }] } }] }) },
      { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'b' }] } }] }) },
      { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'c' }] } }] }) },
    ],
  });
  box.callLLM('x', 3, { caller: 'dashboard.studentAdvice' });
  box.callLLM('y', 3, { caller: 'dashboard.studentAdvice' });
  box.callLLM('z', 3, { caller: 'dashboard.studentAdvice' });
  assert.strictEqual(box.__propertyReads.length, 1);
});

test('プロパティ読み出しが失敗しても本処理は止めず全体設定で続行する', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    propertiesThrows: true,
    responses: [{ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '続行' }] } }] }) }],
  });
  const result = box.callLLM('x', 3, { caller: 'analyzeError' });
  assert.deepStrictEqual(plain(result), { text: '続行' });
  assert.ok(box.__logs.some((l) => l.indexOf('LLM provider override') >= 0));
});

test('caller が空ならプロパティを読まない', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    properties: { LLM_PROVIDER_analyzeError: 'openai' },
    responses: [{ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'g' }] } }] }) }],
  });
  box.callLLM('x', 3, {});
  assert.strictEqual(box.__propertyReads.length, 0);
  assert.match(box.__calls[0].url, /generativelanguage/);
});

test('後方互換エイリアス callGeminiAPI は callLLM と同じ経路を通る', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'openai' },
    responses: [okResponse('エイリアス経由')],
  });
  assert.deepStrictEqual(plain(box.callGeminiAPI('x', 3, {})), { text: 'エイリアス経由' });
  assert.match(box.__calls[0].url, /api\.openai\.com/);
});

// ---------------------------------------------------------------------------
// options.json の写像
// ---------------------------------------------------------------------------

test('options.json は Gemini では responseMimeType、OpenAI では text.format になる', () => {
  const gem = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    responses: [{ code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) }],
  });
  gem.callLLM('x', 3, { json: true });
  assert.strictEqual(JSON.parse(gem.__calls[0].params.payload).generationConfig.responseMimeType, 'application/json');

  const oai = makeSandbox({ config: { LLM_PROVIDER: 'openai' }, responses: [okResponse('{}')] });
  oai.callLLM('x', 3, { json: true });
  assert.deepStrictEqual(JSON.parse(oai.__calls[0].params.payload).text, { format: { type: 'json_object' } });
});

// ---------------------------------------------------------------------------
// 失敗分類 — ここが Gemini からの最大の差分
// ---------------------------------------------------------------------------

test('OpenAI の残高切れ(429/insufficient_quota)はリトライせず即エラーにする', () => {
  const body = JSON.stringify({ error: { code: 'insufficient_quota', message: 'quota' } });
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'openai' },
    responses: [{ code: 429, body }],   // 1回分しか用意しない＝2回目を叩いたら例外で落ちる
  });
  const result = box.callLLM('x', 3, { caller: 'test' });
  assert.ok(result.error, '残高切れはエラーとして返る');
  assert.match(result.error, /insufficient_quota/);
  assert.strictEqual(box.__calls.length, 1, 'リトライしていない');
  assert.strictEqual(box.__sleeps.length, 0, 'バックオフの待ちも発生しない');
});

test('OpenAI のレート制限(429/rate_limit_exceeded)はバックオフして再試行する', () => {
  const rate = JSON.stringify({ error: { code: 'rate_limit_exceeded' } });
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'openai' },
    responses: [{ code: 429, body: rate }, { code: 429, body: rate }, okResponse('3回目で成功')],
  });
  const result = box.callLLM('x', 3, { caller: 'test' });
  assert.deepStrictEqual(plain(result), { text: '3回目で成功' });
  assert.strictEqual(box.__calls.length, 3);
  assert.deepStrictEqual(box.__sleeps, [1000, 2000], '指数バックオフ');
});

test('OpenAI の認証エラー(401)はリトライしない', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'openai' },
    responses: [{ code: 401, body: JSON.stringify({ error: { code: 'invalid_api_key' } }) }],
  });
  const result = box.callLLM('x', 3, {});
  assert.match(result.error, /invalid_api_key/);
  assert.strictEqual(box.__calls.length, 1);
});

test('APIキー未設定なら1度も fetch せずエラーを返す', () => {
  const box = makeSandbox({ config: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: '' }, responses: [] });
  const result = box.callLLM('x', 3, {});
  assert.match(result.error, /OPENAI_API_KEY|OpenAI API key/);
  assert.strictEqual(box.__calls.length, 0);
});

// ---------------------------------------------------------------------------
// 推論で出力枠を使い切ったケース — 空文字を成功として下流に流さない
// ---------------------------------------------------------------------------

test('推論だけで枠を使い切った応答(incomplete)は成功扱いにせずエラーにする', () => {
  const incomplete = {
    code: 200,
    body: JSON.stringify({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ id: 'rs_1', type: 'reasoning', summary: [] }],
      usage: { input_tokens: 800, output_tokens: 1024, output_tokens_details: { reasoning_tokens: 1024 } },
    }),
  };
  const box = makeSandbox({ config: { LLM_PROVIDER: 'openai' }, responses: [incomplete] });
  const result = box.callLLM('x', 3, { caller: 'analyzeError' });

  assert.ok(result.error, 'HTTP 200 でも本文が無ければエラー');
  assert.match(result.error, /incomplete: max_output_tokens/);
  assert.strictEqual(result.text, undefined);

  // 課金は発生しているのでログには残る
  const row = box.__appended[0];
  assert.strictEqual(row[11], 'incomplete_max_output_tokens'); // error_reason
  assert.strictEqual(row[9], 1024);                            // reasoning_tokens
});

test('refusal はエラーとして返し本文として流さない', () => {
  const refusal = {
    code: 200,
    body: JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: '対応できません' }] }],
    }),
  };
  const box = makeSandbox({ config: { LLM_PROVIDER: 'openai' }, responses: [refusal] });
  const result = box.callLLM('x', 3, {});
  assert.match(result.error, /refused/);
});

// ---------------------------------------------------------------------------
// ai_call_log
// ---------------------------------------------------------------------------

test('成功時に ai_call_log へ1行積む（列順と内容）', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'openai' },
    responses: [okResponse('こんにちは', {
      input_tokens: 812, output_tokens: 1750, output_tokens_details: { reasoning_tokens: 1500 },
    })],
  });
  box.callLLM('プロンプト本文', 3, { caller: 'analyzeError' });

  assert.strictEqual(box.__appended.length, 1);
  const row = box.__appended[0];
  assert.strictEqual(row.length, 12, 'Config.gs の ai_call_log ヘッダと同じ列数');
  assert.strictEqual(row[1], 'analyzeError');   // caller
  assert.strictEqual(row[2], 'openai');         // provider
  assert.strictEqual(row[3], 'gpt-5.6-luna');   // model
  assert.strictEqual(row[4], 200);              // http_code
  assert.strictEqual(row[6], 7);                // prompt_chars（'プロンプト本文'）
  assert.strictEqual(row[7], 812);              // input_tokens
  assert.strictEqual(row[8], 1750);             // output_tokens
  assert.strictEqual(row[9], 1500);             // reasoning_tokens
  assert.strictEqual(row[10], 1);               // attempts
  assert.strictEqual(row[11], '');              // error_reason
});

test('ログ書き込みが失敗しても本処理の戻り値は壊れない', () => {
  const box = makeSandbox({ config: { LLM_PROVIDER: 'openai' }, responses: [okResponse('本文')] });
  box.getOrCreateSheet = function () { throw new Error('シートが開けない'); };
  const result = box.callLLM('x', 3, {});
  assert.deepStrictEqual(plain(result), { text: '本文' });
  assert.ok(box.__logs.some((l) => /llmLogCall_ failed/.test(l)), 'Logger には記録される');
});

test('診断用フィールドは呼び出し元へ漏らさない（既存の戻り値互換を保つ）', () => {
  const box = makeSandbox({ config: { LLM_PROVIDER: 'openai' }, responses: [okResponse('本文')] });
  const result = box.callLLM('x', 3, {});
  assert.deepStrictEqual(Object.keys(result), ['text']);
});

// ---------------------------------------------------------------------------
// Gemini 側の挙動が変わっていないこと（回帰）
// ---------------------------------------------------------------------------

test('Gemini は 429 で再試行し、400 では即座に諦める（従来どおり）', () => {
  const retry = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    responses: [
      { code: 429, body: 'rate' },
      { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) },
    ],
  });
  assert.deepStrictEqual(plain(retry.callLLM('x', 3, {})), { text: 'ok' });
  assert.deepStrictEqual(retry.__sleeps, [1000]);

  const fail = makeSandbox({ config: { LLM_PROVIDER: 'gemini' }, responses: [{ code: 400, body: 'bad' }] });
  const result = fail.callLLM('x', 3, {});
  assert.match(result.error, /Gemini API error: 400/);
  assert.strictEqual(fail.__calls.length, 1);
});

test('Gemini の応答形が想定外でも例外にせずエラー扱いにしない（空文字）', () => {
  const box = makeSandbox({
    config: { LLM_PROVIDER: 'gemini' },
    responses: [{ code: 200, body: JSON.stringify({ candidates: [] }) }],
  });
  // 従来の callGeminiAPI と同じく空文字を返す（挙動を変えていないことの確認）
  assert.deepStrictEqual(plain(box.callLLM('x', 3, {})), { text: '' });
});
