/**
 * ナースメモリア Gemini API連携サービス
 */

const GeminiService = {
  /**
   * 誤��分析
   */
  analyzeError({ questionId, studentAnswer, correctAnswer, questionText, choices }) {
    if (!questionId || !studentAnswer || !correctAnswer) {
      return { error: 'questionId, studentAnswer, correctAnswer are required' };
    }

    // キャッシュチェック（ai_generatedシートで同一エラーを検索）
    const cached = findCachedAnalysis(questionId, studentAnswer);
    if (cached) {
      return cached;
    }

    // レート制限チェックは呼び出し側（PWA）で行う

    const choiceLabels = ['A', 'B', 'C', 'D', 'E'];
    const choiceText = (choices || []).map((c, i) =>
      `${choiceLabels[i]}: ${c}`
    ).join('\n');

    const prompt = `あなたは���護師国家試験の教育専門家です。
学生が以下の問題に間違えました。間違えた原因を分析してくだ��い。

【問題】${questionText}
【選択肢】
${choiceText}
【正答】${Array.isArray(correctAnswer) ? correctAnswer.join(',') : correctAnswer}
【学生の回答】${Array.isArray(studentAnswer) ? studentAnswer.join(',') : studentAnswer}

以下のJSON形式で回答してください:
{
  "error_type": "knowledge_gap | misread | confusion",
  "analysis": "間違えた原因の説明（学生向け、200字以内）",
  "key_concept": "理解すべき重要概念",
  "study_hint": "学習のアドバイス（100字以内）"
}

error_typeの判定基準:
- knowledge_gap: 正答の知識自体が不足している
- misread: 問題文や選択肢の読み違い（否定語の見落とし等）
- confusion: 類似概念との混同（例: 交感神経と副交感神経）`;

    const result = callGeminiAPI(prompt);
    if (result.error) return result;

    // レスポンスをパース
    const analysis = parseJsonResponse(result.text);
    if (!analysis) {
      return { error: 'Failed to parse Gemini response' };
    }

    return {
      question_id: questionId,
      error_type: analysis.error_type || 'knowledge_gap',
      analysis: analysis.analysis || '',
      key_concept: analysis.key_concept || '',
      study_hint: analysis.study_hint || '',
    };
  },

  /**
   * 類題生成
   */
  generateSimilar({ questionId, errorType, originalQuestion, analysis }) {
    if (!questionId || !errorType) {
      return { error: 'questionId and errorType are required' };
    }

    // 既存の類題をチェック（最大3題まで）
    const existing = findGeneratedQuestions(questionId);
    if (existing.length >= 3) {
      return { questions: existing, cached: true };
    }

    const errorGuidance = {
      knowledge_gap: '同じ概念のより基礎的な問題を出す',
      misread: '設問の言い回しを変え、注意深く読む必要がある問題にする',
      confusion: '混同しやすい概念を明確に弁別させる問題にする',
    };

    const prompt = `あなたは看護師国家試験の問題作成者です。
以下の問題で学生が${errorType}のミスをしました。
この弱点を克服するための類題を1問作成してください。

【元の問題】${originalQuestion}
【誤答タイプ】${errorType}
【分析結果】${analysis || ''}

出題方針: ${errorGuidance[errorType] || errorGuidance.knowledge_gap}

以下のJSON形式で回答:
{
  "question_text": "問題文",
  "choice_a": "選択肢A",
  "choice_b": "選択肢B",
  "choice_c": "選択肢C",
  "choice_d": "選択肢D",
  "correct_answer": "A|B|C|D",
  "explanation": "解説文（300字以内）",
  "difficulty": 3
}`;

    const result = callGeminiAPI(prompt);
    if (result.error) return result;

    const generated = parseJsonResponse(result.text);
    if (!generated) {
      return { error: 'Failed to parse Gemini response' };
    }

    // ai_generatedシートに保存
    const genId = Utilities.getUuid();
    const now = new Date().toISOString();

    const sheet = getOrCreateSheet(CONFIG.SHEETS.AI_GENERATED);
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      sheet.appendRow([
        genId,
        questionId,
        errorType,
        generated.question_text || '',
        generated.choice_a || '',
        generated.choice_b || '',
        generated.choice_c || '',
        generated.choice_d || '',
        generated.correct_answer || '',
        generated.explanation || '',
        generated.difficulty || 3,
        now,
      ]);
    } finally {
      lock.releaseLock();
    }

    return {
      gen_id: genId,
      original_question_id: questionId,
      error_type: errorType,
      question_text: generated.question_text,
      choices: [
        generated.choice_a,
        generated.choice_b,
        generated.choice_c,
        generated.choice_d,
      ].filter(c => c),
      correct_answer: [generated.correct_answer],
      explanation: generated.explanation || '',
      difficulty: generated.difficulty || 3,
      created_at: now,
    };
  },
};

// === Gemini API ヘルパー ===

/**
 * Gemini APIを呼び出す
 */
function callGeminiAPI(prompt, retries) {
  retries = retries || 3;

  const url = CONFIG.GEMINI_API_URL + CONFIG.GEMINI_MODEL + ':generateContent?key=' + CONFIG.GEMINI_API_KEY;

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });

      const code = response.getResponseCode();
      if (code === 200) {
        const json = JSON.parse(response.getContentText());
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { text };
      }

      if (code === 429 || code >= 500) {
        // レート制限 or サーバーエラー → リトライ
        const backoff = Math.pow(2, attempt) * 1000;
        Utilities.sleep(backoff);
        continue;
      }

      return { error: 'Gemini API error: ' + code + ' ' + response.getContentText() };
    } catch (e) {
      if (attempt === retries - 1) {
        return { error: 'Gemini API call failed: ' + e.message };
      }
      Utilities.sleep(Math.pow(2, attempt) * 1000);
    }
  }

  return { error: 'Gemini API: max retries exceeded' };
}

/**
 * JSONレスポンスをパース（Markdownコードブロック対応）
 */
function parseJsonResponse(text) {
  if (!text) return null;

  // ```json ... ``` を除去
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('JSON parse error:', e.message, 'text:', cleaned.substring(0, 200));
    return null;
  }
}

/**
 * キャッシュ済み分析を検索
 */
function findCachedAnalysis(questionId, studentAnswer) {
  // 現在はキャッシュなし（将来的にai_generatedシートから検索）
  return null;
}

/**
 * 生成済み類題を検索
 */
function findGeneratedQuestions(questionId) {
  const sheet = getOrCreateSheet(CONFIG.SHEETS.AI_GENERATED);
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return [];

  const headers = data[0];
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });

  return data.slice(1)
    .filter(row => row[idx['original_question_id']] === questionId)
    .map(row => ({
      gen_id: row[idx['gen_id']],
      original_question_id: row[idx['original_question_id']],
      error_type: row[idx['error_type']],
      question_text: row[idx['question_text']],
      choices: [
        row[idx['choice_a']],
        row[idx['choice_b']],
        row[idx['choice_c']],
        row[idx['choice_d']],
      ].filter(c => c),
      correct_answer: [row[idx['correct_answer']]],
      explanation: row[idx['explanation']],
      difficulty: row[idx['difficulty']],
      created_at: row[idx['created_at']],
    }));
}
