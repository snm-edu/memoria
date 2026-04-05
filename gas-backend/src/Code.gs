/**
 * ナースメモリア GASバックエンド メインルーター
 *
 * GET  /exec?action=getQuestions&dept=nursing&category=...&limit=20&offset=0
 * GET  /exec?action=getReviewQueue&studentId=xxx
 * GET  /exec?action=getStudentStats&studentId=xxx
 * POST /exec?action=submitAnswer   { studentId, questionId, answer, responseTime, department, grade }
 * POST /exec?action=analyzeError   { questionId, studentAnswer, correctAnswer }
 * POST /exec?action=generateSimilar { questionId, errorType }
 */

function doGet(e) {
  try {
    const action = e.parameter.action;

    switch (action) {
      case 'getQuestions':
        return jsonResponse(QuestionService.getQuestions({
          dept: e.parameter.dept || '',
          category: e.parameter.category || '',
          limit: parseInt(e.parameter.limit) || CONFIG.DEFAULT_QUESTION_LIMIT,
          offset: parseInt(e.parameter.offset) || 0,
          year: parseInt(e.parameter.year) || 0,
        }));

      case 'getReviewQueue':
        return jsonResponse(QuestionService.getReviewQueue(
          e.parameter.studentId
        ));

      case 'getStudentStats':
        return jsonResponse(AnswerService.getStudentStats(
          e.parameter.studentId
        ));

      case 'ping':
        return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });

      default:
        return jsonResponse({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (error) {
    console.error('doGet error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch (action) {
      case 'submitAnswer':
        return jsonResponse(AnswerService.submitAnswer({
          studentId: body.studentId,
          questionId: body.questionId,
          answer: body.answer,
          responseTime: body.responseTime,
          department: body.department,
          grade: body.grade,
        }));

      case 'submitAnswerBatch':
        return jsonResponse(AnswerService.submitAnswerBatch(body.answers));

      case 'analyzeError':
        return jsonResponse(GeminiService.analyzeError({
          questionId: body.questionId,
          studentAnswer: body.studentAnswer,
          correctAnswer: body.correctAnswer,
          questionText: body.questionText,
          choices: body.choices,
        }));

      case 'generateSimilar':
        return jsonResponse(GeminiService.generateSimilar({
          questionId: body.questionId,
          errorType: body.errorType,
          originalQuestion: body.originalQuestion,
          analysis: body.analysis,
        }));

      default:
        return jsonResponse({ error: 'Unknown action: ' + action }, 400);
    }
  } catch (error) {
    console.error('doPost error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

/**
 * JSON レスポンスを生成（CORS対応）
 */
function jsonResponse(data, statusCode) {
  const output = ContentService
    .createTextOutput(JSON.stringify({
      success: !data.error,
      data: data.error ? undefined : data,
      error: data.error || undefined,
    }))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
