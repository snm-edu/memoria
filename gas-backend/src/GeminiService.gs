/**
 * ナースメモリア Gemini API連携サービス
 */

const GeminiService = {
  /**
   * 誤��分析
   */
  analyzeError({ questionId, studentAnswer, correctAnswer, questionText, choices, department, studyHour }) {
    if (!questionId || !studentAnswer || !correctAnswer) {
      return { error: 'questionId, studentAnswer, correctAnswer are required' };
    }

    // キャッシュチェック（ai_generatedシートで同一エラーを検索）
    const cached = findCachedAnalysis(questionId, studentAnswer);
    if (cached) {
      return cached;
    }

    // 学科に応じた専門家名を決定
    const expertName = getDepartmentExpertName(department || '');

    const choiceLabels = ['A', 'B', 'C', 'D', 'E'];
    const choiceText = (choices || []).map((c, i) =>
      `${choiceLabels[i]}: ${c}`
    ).join('\n');

    // 深夜判定（0〜5時台）
    const hour = (studyHour !== undefined && studyHour !== null) ? studyHour : new Date().getHours();
    const isLateNight = hour >= 0 && hour < 6;

    const lateNightNote = isLateNight
      ? `【時刻メモ】今は深夜${hour}時です。まず「こんな時間まで頑張ってるね！」と労い、カラダを心配してください。そして「眠ってる間に脳が今日の勉強を整理してくれるから、少し休むのも大事な勉強法だよ」とやさしく伝えてください。`
      : '';

    const cheerInstruction = isLateNight
      ? '深夜なので：労い＋カラダ心配＋眠りで脳が整理する話＋励まし、全体150字以内'
      : '悔しさへの共感＋大丈夫という励まし、100字以内';

    const prompt = `あなたは${expertName}の勉強を一緒に頑張る、優しくて熱い先輩です。
学生が問題を間違えました。まず気持ちに寄り添い、前向きになれるよう励ましてから、勉強のヒントを伝えてください。
難しい専門用語や硬い言葉は使わず、友達に話しかけるような自然な言葉で書いてください。
すべての出力は必ず日本語のみで書いてください。他の言語を混ぜないでください。

${lateNightNote}

【問題】${questionText}
【選択肢】
${choiceText}
【正答】${Array.isArray(correctAnswer) ? correctAnswer.join(',') : correctAnswer}
【学生の回答】${Array.isArray(studentAnswer) ? studentAnswer.join(',') : studentAnswer}

以下のJSON形式で回答してください:
{
  "error_type": "knowledge_gap | misread | confusion",
  "cheer": "${cheerInstruction}",
  "analysis": "なぜ間違えやすいかをやさしく一言で（80字以内）",
  "key_concept": "ここだけ覚えようというキーポイント（30字以内）",
  "study_hint": "次に活かせる具体的なコツ（80字以内）"
}

error_typeの判定基準（内部分類用）:
- knowledge_gap: その知識がまだ定着していない
- misread: 問題文や選択肢の読み違い（「ではない」の見落とし等）
- confusion: 似た概念との混同`;

    const result = callGeminiAPI(prompt, 3, { json: true });
    if (result.error) return result;

    // レスポンスをパース
    const analysis = parseJsonResponse(result.text);
    if (!analysis) {
      return { error: 'Failed to parse Gemini response' };
    }

    return {
      question_id: questionId,
      error_type: analysis.error_type || 'knowledge_gap',
      cheer: analysis.cheer || '',
      analysis: analysis.analysis || '',
      key_concept: analysis.key_concept || '',
      study_hint: analysis.study_hint || '',
    };
  },

  /**
   * 類題生成
   */
  generateSimilar({ questionId, errorType, originalQuestion, analysis, department }) {
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

    const expertName = getDepartmentExpertName(department || '');
    const prompt = `あなたは${expertName}の問題作成者です。
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

    const result = callGeminiAPI(prompt, 3, { json: true });
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

// === 学科名マッピング ===

/**
 * departmentコードから国家試験名を返す
 */
function getDepartmentExpertName(department) {
  const map = {
    nursing: '看護師国家試験',
    clinical_eng: '臨床工学技士国家試験',
    dental_hyg: '歯科衛生士国家試験',
    orthoptist: '視能訓練士国家試験',
  };
  return map[department] || '国家試験';
}

// === Gemini API ヘルパー ===

/**
 * Gemini APIを呼び出す
 */
function callGeminiAPI(prompt, retries, options) {
  retries = retries || 3;
  options = options || {};

  const url = CONFIG.GEMINI_API_URL + CONFIG.GEMINI_MODEL + ':generateContent?key=' + CONFIG.GEMINI_API_KEY;

  var genConfig = {
    temperature: 0.7,
    maxOutputTokens: 1024,
  };
  // JSON出力が必要な場合のみ設定（デフォルトはテキスト）
  if (options.json) {
    genConfig.responseMimeType = 'application/json';
  }

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: genConfig,
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
