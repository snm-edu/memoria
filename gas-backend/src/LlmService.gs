/**
 * ナースメモリア LLM 共通レイヤ（GAS 依存部）
 *
 * 役割: プロンプト層（GeminiService / DashboardService）から見た唯一の送信口。
 * プロバイダの選択はスクリプトプロパティで決まるため、再デプロイなしに 'gemini' ⇄ 'openai' を
 * 切り替えられる（Head 駆動のトリガー経路の場合。Web アプリ経由の経路は
 * デプロイ版のコードが実行されるため、新しいバージョンの発行が別途必要）。
 *
 *   LLM_PROVIDER            … 全体設定
 *   LLM_PROVIDER_<caller>   … caller 単位の上書き（段階切替用。例 LLM_PROVIDER_analyzeError）
 *
 * 純粋関数（ペイロード組立・レスポンス解析・エラー分類）は LlmServiceCore.gs 側にあり、
 * tests/llm_service_core.test.js で Node から実行検証している。
 *
 * 自動フォールバックは意図的に実装しない。
 * generateSimilar の生成物は ai_generated シートへ永続化され他の学生にも配信されるため、
 * どちらのモデルが書いたか不明なまま黙って別プロバイダへ退避されると出所が追えなくなる。
 * 障害は隠さず ai_call_log に残して可視化する。
 */

/**
 * LLM を呼ぶ。戻り値の形は既存 callGeminiAPI と互換（{text} または {error}）。
 *
 * @param {string} prompt
 * @param {number} retries 既定 3
 * @param {Object} options
 *   - json: true なら JSON 出力を要求
 *   - provider: 'gemini' | 'openai'（省略時は LLM_PROVIDER_<caller> → LLM_PROVIDER の順で解決）
 *   - caller: ai_call_log に残す呼び出し元名
 *   - effort: OpenAI の reasoning effort（省略時は CONFIG.OPENAI_REASONING_EFFORT）
 */
function callLLM(prompt, retries, options) {
  retries = retries || 3;
  options = options || {};

  var provider = llmResolveProvider_(
    options.provider,
    llmReadCallerProviderOverride_(options.caller),
    CONFIG.LLM_PROVIDER
  );

  var startedAt = new Date().getTime();
  var outcome = provider === 'openai'
    ? llmCallOpenAI_(prompt, retries, options)
    : llmCallGemini_(prompt, retries, options);

  llmLogCall_({
    caller: options.caller || '',
    provider: provider,
    model: provider === 'openai' ? CONFIG.OPENAI_MODEL : CONFIG.GEMINI_MODEL,
    httpCode: outcome.httpCode || 0,
    latencyMs: new Date().getTime() - startedAt,
    promptChars: String(prompt || '').length,
    usage: outcome.usage || { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    attempts: outcome.attempts || 0,
    errorReason: outcome.errorReason || '',
  });

  // 呼び出し元へは既存互換の形だけ返す（診断用フィールドは漏らさない）
  if (outcome.error) {
    return { error: outcome.error };
  }
  return { text: outcome.text };
}

// caller 別上書きの読み出しキャッシュ。実行（＝1リクエスト / 1トリガー起動）の中では
// スクリプトプロパティを1回しか読まない。CONFIG がグローバル評価時に1回だけ読むのと
// 同じ粒度に揃える意図もある（同一実行の途中で解決結果が変わらない）。
var LLM_SCRIPT_PROPERTIES_CACHE_ = null;

/**
 * スクリプトプロパティ LLM_PROVIDER_<caller> を読む。
 * 未設定・caller 空・読み出し失敗はいずれも '' を返し、全体設定 LLM_PROVIDER に委ねる。
 *
 * プロパティの読み出しで本処理を落とさない。ここで例外を投げると、切替とは無関係な
 * 一時障害で誤答分析そのものが失敗するため。
 */
function llmReadCallerProviderOverride_(caller) {
  var name = String(caller === null || caller === undefined ? '' : caller).trim();
  if (!name) {
    return '';
  }

  if (LLM_SCRIPT_PROPERTIES_CACHE_ === null) {
    try {
      LLM_SCRIPT_PROPERTIES_CACHE_ = PropertiesService.getScriptProperties().getProperties() || {};
    } catch (e) {
      Logger.log('LLM provider override の読み出しに失敗（全体設定を使う）: ' + e);
      LLM_SCRIPT_PROPERTIES_CACHE_ = {};
    }
  }

  return LLM_SCRIPT_PROPERTIES_CACHE_['LLM_PROVIDER_' + name] || '';
}

/**
 * 後方互換エイリアス。
 * 本番プロジェクトにはリポジトリ未収載のファイルが存在するため、
 * 旧名で呼んでいる箇所が残っていても動くように残す。新規コードは callLLM を使うこと。
 */
function callGeminiAPI(prompt, retries, options) {
  return callLLM(prompt, retries, options);
}

// === Gemini ===

/**
 * Gemini API を呼ぶ。
 * 本体は旧 GeminiService.gs の callGeminiAPI から移設したもの（挙動は同一）。
 * エラー分類だけ llmClassifyHttpError_ に寄せた（429 と 5xx のみリトライ＝従来どおり）。
 */
function llmCallGemini_(prompt, retries, options) {
  options = options || {};

  var url = CONFIG.GEMINI_API_URL + CONFIG.GEMINI_MODEL + ':generateContent?key=' + CONFIG.GEMINI_API_KEY;

  var genConfig = {
    temperature: 0.7,
    maxOutputTokens: 1024,
  };
  if (options.json) {
    genConfig.responseMimeType = 'application/json';
  }

  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: genConfig,
  };

  var lastCode = 0;
  var lastReason = '';

  for (var attempt = 0; attempt < retries; attempt++) {
    try {
      var response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      var code = response.getResponseCode();
      lastCode = code;

      if (code === 200) {
        var json = JSON.parse(response.getContentText());
        var text = (json.candidates && json.candidates[0] && json.candidates[0].content
          && json.candidates[0].content.parts && json.candidates[0].content.parts[0]
          && json.candidates[0].content.parts[0].text) || '';
        return {
          text: text,
          httpCode: code,
          attempts: attempt + 1,
          usage: llmReadGeminiUsage_(json),
        };
      }

      var verdict = llmClassifyHttpError_('gemini', code, response.getContentText());
      lastReason = verdict.reason;
      if (verdict.retryable && attempt < retries - 1) {
        Utilities.sleep(Math.pow(2, attempt) * 1000);
        continue;
      }

      return {
        error: 'Gemini API error: ' + code + ' ' + response.getContentText(),
        httpCode: code,
        attempts: attempt + 1,
        errorReason: verdict.reason,
      };
    } catch (e) {
      lastReason = 'exception';
      if (attempt === retries - 1) {
        return {
          error: 'Gemini API call failed: ' + e.message,
          httpCode: lastCode,
          attempts: attempt + 1,
          errorReason: 'exception',
        };
      }
      Utilities.sleep(Math.pow(2, attempt) * 1000);
    }
  }

  return {
    error: 'Gemini API: max retries exceeded',
    httpCode: lastCode,
    attempts: retries,
    errorReason: lastReason || 'max_retries',
  };
}

/**
 * Gemini の usageMetadata を読む。
 * ※ フィールド名はこのエンドポイント版では未検証。取れなければ 0 のまま（ログ用途のみ）。
 */
function llmReadGeminiUsage_(json) {
  var meta = (json && json.usageMetadata) || {};
  return {
    inputTokens: Number(meta.promptTokenCount || 0),
    outputTokens: Number(meta.candidatesTokenCount || 0),
    reasoningTokens: Number(meta.thoughtsTokenCount || 0),
  };
}

// === OpenAI ===

/**
 * OpenAI Responses API を呼ぶ。
 *
 * Chat Completions ではなく Responses を使う理由:
 * reasoning モデルの effort 指定は Chat Completions では非対応のため。
 * 出典: https://developers.openai.com/api/docs/guides/reasoning
 */
function llmCallOpenAI_(prompt, retries, options) {
  options = options || {};

  if (!CONFIG.OPENAI_API_KEY) {
    return {
      error: 'OpenAI API key is not set (script property OPENAI_API_KEY)',
      httpCode: 0,
      attempts: 0,
      errorReason: 'missing_api_key',
    };
  }

  var effort = options.effort || CONFIG.OPENAI_REASONING_EFFORT;
  var payload = llmBuildOpenAIPayload_(
    prompt,
    options,
    CONFIG.OPENAI_MODEL,
    effort,
    CONFIG.OPENAI_MAX_OUTPUT_TOKENS
  );

  var lastCode = 0;
  var lastReason = '';

  for (var attempt = 0; attempt < retries; attempt++) {
    try {
      var response = UrlFetchApp.fetch(CONFIG.OPENAI_API_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + CONFIG.OPENAI_API_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      var code = response.getResponseCode();
      var body = response.getContentText();
      lastCode = code;

      if (code === 200) {
        var json = JSON.parse(body);
        var extracted = llmExtractOpenAIText_(json);
        var usage = llmExtractOpenAIUsage_(json);

        if (extracted.refusal) {
          return {
            error: 'OpenAI refused: ' + extracted.refusal,
            httpCode: code,
            attempts: attempt + 1,
            usage: usage,
            errorReason: 'refusal',
          };
        }

        // 推論だけで出力枠を使い切ると本文が空で返る。空文字を成功として下流に流さない。
        if (!extracted.text) {
          return {
            error: 'OpenAI returned no text'
              + (extracted.incomplete ? ' (incomplete: ' + extracted.incompleteReason + ')' : ''),
            httpCode: code,
            attempts: attempt + 1,
            usage: usage,
            errorReason: extracted.incomplete ? ('incomplete_' + extracted.incompleteReason) : 'empty_output',
          };
        }

        return {
          text: extracted.text,
          httpCode: code,
          attempts: attempt + 1,
          usage: usage,
        };
      }

      var verdict = llmClassifyHttpError_('openai', code, body);
      lastReason = verdict.reason;

      // 残高切れ・認証エラーは待っても通らないので即座に諦める
      if (verdict.retryable && attempt < retries - 1) {
        Utilities.sleep(Math.pow(2, attempt) * 1000);
        continue;
      }

      return {
        error: 'OpenAI API error: ' + code + ' [' + verdict.reason + '] ' + body,
        httpCode: code,
        attempts: attempt + 1,
        errorReason: verdict.reason,
      };
    } catch (e) {
      lastReason = 'exception';
      if (attempt === retries - 1) {
        return {
          error: 'OpenAI API call failed: ' + e.message,
          httpCode: lastCode,
          attempts: attempt + 1,
          errorReason: 'exception',
        };
      }
      Utilities.sleep(Math.pow(2, attempt) * 1000);
    }
  }

  return {
    error: 'OpenAI API: max retries exceeded',
    httpCode: lastCode,
    attempts: retries,
    errorReason: lastReason || 'max_retries',
  };
}

// === 呼び出しログ ===

/**
 * ai_call_log シートへ1行追記する。
 * ログの失敗で本処理（学生の回答フロー）を落とさないため、例外は握り潰して Logger に残す。
 * 同期経路（誤答分析・類題生成）に入るためロックは取らない。
 */
function llmLogCall_(entry) {
  try {
    var sheet = getOrCreateSheet(CONFIG.SHEETS.AI_CALL_LOG);
    var usage = entry.usage || {};
    sheet.appendRow([
      new Date().toISOString(),
      entry.caller || '',
      entry.provider || '',
      entry.model || '',
      entry.httpCode || 0,
      entry.latencyMs || 0,
      entry.promptChars || 0,
      Number(usage.inputTokens || 0),
      Number(usage.outputTokens || 0),
      Number(usage.reasoningTokens || 0),
      entry.attempts || 0,
      entry.errorReason || '',
    ]);
  } catch (e) {
    Logger.log('llmLogCall_ failed (本処理は継続): ' + e.message);
  }
}

// === 疎通確認 ===

/**
 * OpenAI 側の未検証事項をまとめて実測する。GAS エディタから手動実行する。
 *
 * 確認する項目:
 *   probe1 最小 — UrlFetchApp から api.openai.com へ到達できるか / キーが有効か
 *   probe2 +max_output_tokens — パラメータ名が正しいか
 *   probe3 +reasoning.effort=none — gpt-5.6-luna が none を受理するか
 *   probe4 +text.format=json_object — JSON 出力指定のフィールド名が正しいか
 *
 * 各プローブの HTTP コード・エラーコード・本文・usage を返す。
 * 課金は4回分（Luna は $0.20/1M in・$1.20/1M out なので実質ゼロ）。
 */
function verifyOpenAIConnectivity() {
  if (!CONFIG.OPENAI_API_KEY) {
    var msg = 'OPENAI_API_KEY が未設定です。スクリプトプロパティに登録してください。';
    Logger.log(msg);
    return { ok: false, error: msg };
  }

  var probes = [
    { name: 'probe1_minimal', body: { model: CONFIG.OPENAI_MODEL, input: '1+1は？数字だけ答えて。' } },
    { name: 'probe2_max_output_tokens', body: { model: CONFIG.OPENAI_MODEL, input: '1+1は？数字だけ答えて。', max_output_tokens: 256 } },
    { name: 'probe3_effort_none', body: { model: CONFIG.OPENAI_MODEL, input: '1+1は？数字だけ答えて。', max_output_tokens: 256, reasoning: { effort: 'none' } } },
    { name: 'probe4_json_format', body: { model: CONFIG.OPENAI_MODEL, input: '{"answer": 2} という形のJSONだけを返して。', max_output_tokens: 256, reasoning: { effort: 'none' }, text: { format: { type: 'json_object' } } } },
  ];

  var results = [];

  for (var i = 0; i < probes.length; i++) {
    var probe = probes[i];
    var startedAt = new Date().getTime();
    var record = { name: probe.name };

    try {
      var response = UrlFetchApp.fetch(CONFIG.OPENAI_API_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + CONFIG.OPENAI_API_KEY },
        payload: JSON.stringify(probe.body),
        muteHttpExceptions: true,
      });

      var code = response.getResponseCode();
      var body = response.getContentText();

      record.httpCode = code;
      record.latencyMs = new Date().getTime() - startedAt;

      if (code === 200) {
        var json = JSON.parse(body);
        var extracted = llmExtractOpenAIText_(json);
        record.ok = true;
        record.text = extracted.text;
        record.incomplete = extracted.incomplete;
        record.incompleteReason = extracted.incompleteReason;
        record.usage = llmExtractOpenAIUsage_(json);
      } else {
        record.ok = false;
        record.errorCode = llmReadOpenAIErrorCode_(body);
        record.body = body.slice(0, 500);
      }
    } catch (e) {
      record.ok = false;
      record.latencyMs = new Date().getTime() - startedAt;
      record.exception = e.message;
    }

    results.push(record);
    Logger.log(probe.name + ' → ' + JSON.stringify(record));
  }

  var summary = {
    model: CONFIG.OPENAI_MODEL,
    endpoint: CONFIG.OPENAI_API_URL,
    results: results,
    // 「その形が通った最後のプローブ」が、そのまま採用してよい形
    lastPassing: (function () {
      var name = '';
      for (var i = 0; i < results.length; i++) {
        if (results[i].ok) name = results[i].name;
      }
      return name;
    })(),
  };

  Logger.log('=== verifyOpenAIConnectivity 結果 === ' + JSON.stringify(summary));
  return summary;
}
