/**
 * ナースメモリア LLM 共通レイヤ（純粋関数）
 *
 * GAS API（UrlFetchApp / PropertiesService / SpreadsheetApp）に依存しない部分だけをここに置く。
 * Node から require してテストできるようにするため（tests/llm_service_core.test.js）。
 * GAS 依存の実処理は LlmService.gs 側。
 *
 * OpenAI 側は Responses API (`v1/responses`) を使う。
 * Chat Completions は reasoning モデルの effort 指定に非対応のため。
 * 出典: https://developers.openai.com/api/docs/guides/reasoning （2026-08-24 確認）
 */

// reasoning effort の許可値。モデルページ記載の none/low/medium/high/xhigh/max に
// reasoning ガイド記載の minimal を加えたもの。
var LLM_EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

// reasoning tokens は max_output_tokens の枠を食う（output tokens として課金される）。
// effort を上げたまま枠が小さいと、推論だけで枠を使い切って message アイテムが
// 1つも返らない（status=incomplete / incomplete_details.reason=max_output_tokens）。
var LLM_MIN_OUTPUT_TOKENS_WITH_REASONING = 4096;

/**
 * effort をホワイトリストで正規化する。
 * 不正値は 'none' に倒す（コストが最小になる安全側）。
 */
function llmSanitizeEffort_(effort) {
  var value = String(effort === null || effort === undefined ? '' : effort).trim().toLowerCase();
  return LLM_EFFORT_VALUES.indexOf(value) >= 0 ? value : 'none';
}

/**
 * max_output_tokens を決める。
 * effort が none 以外なら、推論で枠を食い潰して本文ゼロになるのを防ぐため下限を引き上げる。
 */
function llmResolveMaxOutputTokens_(effort, requested) {
  var base = Number(requested) > 0 ? Number(requested) : 1024;
  if (llmSanitizeEffort_(effort) === 'none') {
    return base;
  }
  return Math.max(base, LLM_MIN_OUTPUT_TOKENS_WITH_REASONING);
}

/**
 * OpenAI Responses API のリクエストボディを組み立てる。
 */
function llmBuildOpenAIPayload_(prompt, options, model, effort, maxOutputTokens) {
  options = options || {};
  var resolvedEffort = llmSanitizeEffort_(effort);

  var payload = {
    model: model,
    input: String(prompt === null || prompt === undefined ? '' : prompt),
    max_output_tokens: llmResolveMaxOutputTokens_(resolvedEffort, maxOutputTokens),
    reasoning: { effort: resolvedEffort },
  };

  if (options.json) {
    payload.text = { format: { type: 'json_object' } };
  }

  return payload;
}

/**
 * Responses API のレスポンスから本文テキストを取り出す。
 *
 * output[] には reasoning / message / *_call アイテムが混在する。
 * output[0] を決め打ちで読むと reasoning アイテムを掴んで空になるため、必ず走査する。
 * 出典: https://developers.openai.com/api/docs/api-reference/responses/create
 *
 * @return {{text: string, incomplete: boolean, incompleteReason: string, refusal: string}}
 */
function llmExtractOpenAIText_(json) {
  var result = { text: '', incomplete: false, incompleteReason: '', refusal: '' };
  if (!json || typeof json !== 'object') {
    return result;
  }

  if (json.status === 'incomplete') {
    result.incomplete = true;
    result.incompleteReason = (json.incomplete_details && json.incomplete_details.reason) || 'unknown';
  }

  var chunks = [];
  var refusals = [];
  var output = json.output;

  if (Object.prototype.toString.call(output) === '[object Array]') {
    for (var i = 0; i < output.length; i++) {
      var item = output[i];
      if (!item || item.type !== 'message') {
        continue;
      }
      var content = item.content;
      if (Object.prototype.toString.call(content) !== '[object Array]') {
        continue;
      }
      for (var j = 0; j < content.length; j++) {
        var part = content[j];
        if (!part) {
          continue;
        }
        if (part.type === 'output_text' && typeof part.text === 'string') {
          chunks.push(part.text);
        } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
          refusals.push(part.refusal);
        }
      }
    }
  }

  // output[] を歩いて何も取れなかった場合の保険。
  if (chunks.length === 0 && typeof json.output_text === 'string') {
    chunks.push(json.output_text);
  }

  result.text = chunks.join('');
  result.refusal = refusals.join('\n');
  return result;
}

/**
 * usage を取り出す。reasoning_tokens は output_tokens の内訳として課金される。
 */
function llmExtractOpenAIUsage_(json) {
  var usage = (json && json.usage) || {};
  var details = usage.output_tokens_details || {};
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    reasoningTokens: Number(details.reasoning_tokens || 0),
  };
}

/**
 * エラーボディから OpenAI の error.code を読む。JSON でなくても投げない。
 */
function llmReadOpenAIErrorCode_(bodyText) {
  if (!bodyText) {
    return '';
  }
  try {
    var parsed = JSON.parse(bodyText);
    if (parsed && parsed.error) {
      return String(parsed.error.code || parsed.error.type || '');
    }
  } catch (e) {
    // JSON でないエラーボディ（HTML のゲートウェイエラー等）は分類不能として扱う
  }
  return '';
}

/**
 * HTTP ステータスをリトライ可否へ分類する。
 *
 * OpenAI の 429 は「レート制限」と「残高切れ(insufficient_quota)」の両方で返る。
 * 後者はリトライしても永久に通らないため、待って叩き直してはいけない。
 *
 * @return {{retryable: boolean, reason: string}}
 */
function llmClassifyHttpError_(provider, code, bodyText) {
  var status = Number(code);

  if (status >= 500) {
    return { retryable: true, reason: 'server_error' };
  }

  if (provider === 'openai') {
    var errorCode = llmReadOpenAIErrorCode_(bodyText);
    if (status === 429) {
      if (errorCode === 'insufficient_quota') {
        return { retryable: false, reason: 'insufficient_quota' };
      }
      return { retryable: true, reason: errorCode || 'rate_limit' };
    }
    if (status === 401 || status === 403) {
      return { retryable: false, reason: errorCode || 'auth' };
    }
    return { retryable: false, reason: errorCode || ('http_' + status) };
  }

  // Gemini は現行 GeminiService.gs の挙動を踏襲（429 と 5xx のみリトライ）
  if (status === 429) {
    return { retryable: true, reason: 'rate_limit' };
  }
  return { retryable: false, reason: 'http_' + status };
}

// 有効なプロバイダ名。ここに無い値は「指定されなかった」ものとして次の候補へ落とす。
var LLM_PROVIDER_VALUES = ['gemini', 'openai'];

/**
 * 使用するプロバイダを決める。
 *
 * 優先順位: 明示指定(options.provider) > caller 別の上書き > 全体設定 > 'gemini'
 *
 * caller 別の上書きを挟むのは、切替を段階的に行うため。
 * 夜間バッチ（dashboard.*）だけ先に新プロバイダへ移し、学生が同期で待つ
 * analyzeError / generateSimilar は品質を確認するまで据え置く、という運用ができる。
 *
 * 不正値は無視して次の候補へ落とす（最後は 'gemini'）。プロパティ名や値のタイプミスで
 * 学生向け経路が止まるより、既知のプロバイダで動き続けるほうが安全なため。
 */
function llmResolveProvider_(explicit, callerOverride, globalProvider) {
  var candidates = [explicit, callerOverride, globalProvider];
  for (var i = 0; i < candidates.length; i++) {
    var raw = candidates[i];
    var value = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
    if (LLM_PROVIDER_VALUES.indexOf(value) >= 0) {
      return value;
    }
  }
  return 'gemini';
}

if (typeof module !== 'undefined') {
  module.exports = {
    LLM_EFFORT_VALUES,
    LLM_PROVIDER_VALUES,
    LLM_MIN_OUTPUT_TOKENS_WITH_REASONING,
    llmSanitizeEffort_,
    llmResolveMaxOutputTokens_,
    llmBuildOpenAIPayload_,
    llmExtractOpenAIText_,
    llmExtractOpenAIUsage_,
    llmReadOpenAIErrorCode_,
    llmClassifyHttpError_,
    llmResolveProvider_,
  };
}
