// Run: node --test tests/llm_service_core.test.js
// （gas-backend/ ディレクトリから実行する。ディレクトリ自体を渡すと .gs を実行しようとして失敗するので、
//   必ずファイルを指定すること）
const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../src/LlmServiceCore.gs');

// ---------------------------------------------------------------------------
// llmSanitizeEffort_ — 不正値はコスト最小の 'none' に倒す
// ---------------------------------------------------------------------------

test('llmSanitizeEffort_ は許可値をそのまま通す', () => {
  assert.strictEqual(core.llmSanitizeEffort_('none'), 'none');
  assert.strictEqual(core.llmSanitizeEffort_('low'), 'low');
  assert.strictEqual(core.llmSanitizeEffort_('max'), 'max');
  assert.strictEqual(core.llmSanitizeEffort_('  HIGH  '), 'high');
});

test('llmSanitizeEffort_ は未知の値・空値を none に倒す', () => {
  assert.strictEqual(core.llmSanitizeEffort_('ultra'), 'none'); // codex 側の語彙が紛れ込んでも落ちない
  assert.strictEqual(core.llmSanitizeEffort_(''), 'none');
  assert.strictEqual(core.llmSanitizeEffort_(null), 'none');
  assert.strictEqual(core.llmSanitizeEffort_(undefined), 'none');
  assert.strictEqual(core.llmSanitizeEffort_(123), 'none');
});

// ---------------------------------------------------------------------------
// llmResolveMaxOutputTokens_ — 推論で枠を食い潰して本文ゼロになるのを防ぐ
// ---------------------------------------------------------------------------

test('llmResolveMaxOutputTokens_ は effort=none なら要求値をそのまま使う', () => {
  assert.strictEqual(core.llmResolveMaxOutputTokens_('none', 1024), 1024);
  assert.strictEqual(core.llmResolveMaxOutputTokens_('none', 256), 256);
});

test('llmResolveMaxOutputTokens_ は effort が none 以外なら下限まで引き上げる', () => {
  // 現行 Gemini 設定と同じ 1024 のまま medium で投げると推論だけで枠を使い切る
  assert.strictEqual(core.llmResolveMaxOutputTokens_('medium', 1024), 4096);
  assert.strictEqual(core.llmResolveMaxOutputTokens_('high', 512), 4096);
});

test('llmResolveMaxOutputTokens_ は下限より大きい要求値は尊重する', () => {
  assert.strictEqual(core.llmResolveMaxOutputTokens_('medium', 8000), 8000);
});

test('llmResolveMaxOutputTokens_ は不正な要求値を既定値に落とす', () => {
  assert.strictEqual(core.llmResolveMaxOutputTokens_('none', 0), 1024);
  assert.strictEqual(core.llmResolveMaxOutputTokens_('none', -5), 1024);
  assert.strictEqual(core.llmResolveMaxOutputTokens_('none', undefined), 1024);
});

// ---------------------------------------------------------------------------
// llmBuildOpenAIPayload_
// ---------------------------------------------------------------------------

test('llmBuildOpenAIPayload_ は Responses API の形を組む', () => {
  const payload = core.llmBuildOpenAIPayload_('テスト', {}, 'gpt-5.6-luna', 'none', 1024);
  assert.deepStrictEqual(payload, {
    model: 'gpt-5.6-luna',
    input: 'テスト',
    max_output_tokens: 1024,
    reasoning: { effort: 'none' },
  });
});

test('llmBuildOpenAIPayload_ は options.json のときだけ format を足す', () => {
  const plain = core.llmBuildOpenAIPayload_('x', {}, 'gpt-5.6-luna', 'none', 1024);
  assert.strictEqual(plain.text, undefined);

  const asJson = core.llmBuildOpenAIPayload_('x', { json: true }, 'gpt-5.6-luna', 'none', 1024);
  assert.deepStrictEqual(asJson.text, { format: { type: 'json_object' } });
});

test('llmBuildOpenAIPayload_ は effort を正規化した上で枠も連動させる', () => {
  const payload = core.llmBuildOpenAIPayload_('x', {}, 'gpt-5.6-luna', 'ULTRA', 1024);
  assert.strictEqual(payload.reasoning.effort, 'none'); // 未知値 → none
  assert.strictEqual(payload.max_output_tokens, 1024);

  const thinking = core.llmBuildOpenAIPayload_('x', {}, 'gpt-5.6-luna', 'medium', 1024);
  assert.strictEqual(thinking.reasoning.effort, 'medium');
  assert.strictEqual(thinking.max_output_tokens, 4096);
});

test('llmBuildOpenAIPayload_ は null/undefined のプロンプトでも落ちない', () => {
  assert.strictEqual(core.llmBuildOpenAIPayload_(null, {}, 'm', 'none', 1024).input, '');
  assert.strictEqual(core.llmBuildOpenAIPayload_(undefined, null, 'm', 'none', 1024).input, '');
});

// ---------------------------------------------------------------------------
// llmExtractOpenAIText_ — ここが本命。output[] に reasoning が混ざる
// ---------------------------------------------------------------------------

test('llmExtractOpenAIText_ は reasoning アイテムを飛ばして message の本文を取る', () => {
  const json = {
    status: 'completed',
    output: [
      { id: 'rs_1', type: 'reasoning', summary: [] },
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '{"error_type":"misread"}', annotations: [] }],
      },
    ],
  };
  const got = core.llmExtractOpenAIText_(json);
  assert.strictEqual(got.text, '{"error_type":"misread"}');
  assert.strictEqual(got.incomplete, false);
});

test('llmExtractOpenAIText_ は output[0] 決め打ちだと壊れるケースを吸収する', () => {
  // output[0] は reasoning。素朴に output[0].content[0].text を読むと落ちる形
  const json = {
    output: [
      { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: '内部推論' }] },
      { id: 'msg_1', type: 'message', content: [{ type: 'output_text', text: 'OK' }] },
    ],
  };
  assert.strictEqual(core.llmExtractOpenAIText_(json).text, 'OK');
});

test('llmExtractOpenAIText_ は複数の message / 複数の output_text を連結する', () => {
  const json = {
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: '前半' }, { type: 'output_text', text: '後半' }] },
      { type: 'message', content: [{ type: 'output_text', text: '追記' }] },
    ],
  };
  assert.strictEqual(core.llmExtractOpenAIText_(json).text, '前半後半追記');
});

test('llmExtractOpenAIText_ は incomplete と理由を拾う（推論で枠を使い切った形）', () => {
  // effort を上げたまま max_output_tokens が小さいと message アイテムが1つも返らない
  const json = {
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    output: [{ id: 'rs_1', type: 'reasoning', summary: [] }],
    usage: { input_tokens: 800, output_tokens: 1024, output_tokens_details: { reasoning_tokens: 1024 } },
  };
  const got = core.llmExtractOpenAIText_(json);
  assert.strictEqual(got.text, '');
  assert.strictEqual(got.incomplete, true);
  assert.strictEqual(got.incompleteReason, 'max_output_tokens');
});

test('llmExtractOpenAIText_ は refusal を本文と分けて返す', () => {
  const json = {
    output: [{ type: 'message', content: [{ type: 'refusal', refusal: '対応できません' }] }],
  };
  const got = core.llmExtractOpenAIText_(json);
  assert.strictEqual(got.text, '');
  assert.strictEqual(got.refusal, '対応できません');
});

test('llmExtractOpenAIText_ は output[] が無い場合 output_text へフォールバックする', () => {
  assert.strictEqual(core.llmExtractOpenAIText_({ output_text: '保険' }).text, '保険');
});

test('llmExtractOpenAIText_ は壊れた入力でも例外を投げない', () => {
  assert.strictEqual(core.llmExtractOpenAIText_(null).text, '');
  assert.strictEqual(core.llmExtractOpenAIText_(undefined).text, '');
  assert.strictEqual(core.llmExtractOpenAIText_('文字列').text, '');
  assert.strictEqual(core.llmExtractOpenAIText_({ output: 'not-array' }).text, '');
  assert.strictEqual(core.llmExtractOpenAIText_({ output: [null, { type: 'message' }] }).text, '');
  assert.strictEqual(core.llmExtractOpenAIText_({ output: [{ type: 'message', content: 'x' }] }).text, '');
});

// ---------------------------------------------------------------------------
// llmExtractOpenAIUsage_
// ---------------------------------------------------------------------------

test('llmExtractOpenAIUsage_ は reasoning_tokens を内訳として取り出す', () => {
  const got = core.llmExtractOpenAIUsage_({
    usage: { input_tokens: 812, output_tokens: 1750, output_tokens_details: { reasoning_tokens: 1500 } },
  });
  assert.deepStrictEqual(got, { inputTokens: 812, outputTokens: 1750, reasoningTokens: 1500 });
});

test('llmExtractOpenAIUsage_ は usage が無くても 0 を返す', () => {
  assert.deepStrictEqual(core.llmExtractOpenAIUsage_({}), {
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
  });
  assert.deepStrictEqual(core.llmExtractOpenAIUsage_(null), {
    inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
  });
});

// ---------------------------------------------------------------------------
// llmClassifyHttpError_ — 429 の two-faced 問題
// ---------------------------------------------------------------------------

test('llmClassifyHttpError_ は OpenAI の残高切れをリトライ不可に分類する', () => {
  const body = JSON.stringify({
    error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' },
  });
  assert.deepStrictEqual(core.llmClassifyHttpError_('openai', 429, body), {
    retryable: false,
    reason: 'insufficient_quota',
  });
});

test('llmClassifyHttpError_ は OpenAI のレート制限をリトライ可に分類する', () => {
  const body = JSON.stringify({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } });
  assert.deepStrictEqual(core.llmClassifyHttpError_('openai', 429, body), {
    retryable: true,
    reason: 'rate_limit_exceeded',
  });
});

test('llmClassifyHttpError_ は認証エラーをリトライ不可にする', () => {
  const body = JSON.stringify({ error: { code: 'invalid_api_key' } });
  assert.deepStrictEqual(core.llmClassifyHttpError_('openai', 401, body), {
    retryable: false,
    reason: 'invalid_api_key',
  });
});

test('llmClassifyHttpError_ は 5xx をリトライ可にする（両プロバイダ）', () => {
  assert.strictEqual(core.llmClassifyHttpError_('openai', 503, '').retryable, true);
  assert.strictEqual(core.llmClassifyHttpError_('gemini', 500, '').retryable, true);
});

test('llmClassifyHttpError_ は Gemini の現行挙動（429と5xxのみリトライ）を保つ', () => {
  assert.deepStrictEqual(core.llmClassifyHttpError_('gemini', 429, ''), {
    retryable: true, reason: 'rate_limit',
  });
  assert.deepStrictEqual(core.llmClassifyHttpError_('gemini', 400, ''), {
    retryable: false, reason: 'http_400',
  });
  assert.deepStrictEqual(core.llmClassifyHttpError_('gemini', 404, ''), {
    retryable: false, reason: 'http_404',
  });
});

test('llmClassifyHttpError_ は JSON でないエラーボディでも落ちない', () => {
  const html = '<html><body>502 Bad Gateway</body></html>';
  assert.deepStrictEqual(core.llmClassifyHttpError_('openai', 400, html), {
    retryable: false, reason: 'http_400',
  });
  assert.strictEqual(core.llmReadOpenAIErrorCode_(html), '');
  assert.strictEqual(core.llmReadOpenAIErrorCode_(''), '');
  assert.strictEqual(core.llmReadOpenAIErrorCode_(null), '');
});

// ---------------------------------------------------------------------------
// llmResolveProvider_ — 明示指定 > caller別上書き > 全体設定 > gemini
// ---------------------------------------------------------------------------

test('llmResolveProvider_ は明示指定を最優先する', () => {
  assert.strictEqual(core.llmResolveProvider_('openai', 'gemini', 'gemini'), 'openai');
  assert.strictEqual(core.llmResolveProvider_('gemini', 'openai', 'openai'), 'gemini');
});

test('llmResolveProvider_ は明示指定が無ければ caller 別上書きを使う', () => {
  assert.strictEqual(core.llmResolveProvider_('', 'openai', 'gemini'), 'openai');
  assert.strictEqual(core.llmResolveProvider_(undefined, 'gemini', 'openai'), 'gemini');
});

test('llmResolveProvider_ は上書きが無ければ全体設定を使う', () => {
  assert.strictEqual(core.llmResolveProvider_('', '', 'openai'), 'openai');
  assert.strictEqual(core.llmResolveProvider_(null, null, 'gemini'), 'gemini');
});

test('llmResolveProvider_ は不正値を無視して次の候補へ落とす', () => {
  // プロパティ名や値のタイプミスで学生向け経路が止まらないことの確認
  assert.strictEqual(core.llmResolveProvider_('anthropic', 'openai', 'gemini'), 'openai');
  assert.strictEqual(core.llmResolveProvider_('', 'openal', 'openai'), 'openai');
  assert.strictEqual(core.llmResolveProvider_('', '', 'grok'), 'gemini');
});

test('llmResolveProvider_ は表記ゆれを正規化する', () => {
  assert.strictEqual(core.llmResolveProvider_('  OpenAI  ', '', ''), 'openai');
  assert.strictEqual(core.llmResolveProvider_('', ' GEMINI', ''), 'gemini');
});

test('llmResolveProvider_ は全候補が空なら gemini を返す', () => {
  assert.strictEqual(core.llmResolveProvider_(undefined, undefined, undefined), 'gemini');
  assert.strictEqual(core.llmResolveProvider_(0, false, {}), 'gemini');
});
