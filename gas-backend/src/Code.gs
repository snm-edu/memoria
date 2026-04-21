/**
 * Memoria GASバックエンド メインルーター
 *
 * GET  /exec?action=getQuestions&dept=nursing&category=...&limit=20&offset=0
 * GET  /exec?action=getReviewQueue&studentId=xxx
 * GET  /exec?action=getStudentStats&studentId=xxx
 * POST /exec?action=submitAnswer   { studentId, studentNumber, questionId, answer, responseTime, department, grade, studentType }
 * POST /exec?action=submitAnswerBatch { answers: [...] }
 * POST /exec?action=updateStudentNumber { oldStudentNumber, newStudentNumber, studentId }
 * POST /exec?action=analyzeError   { questionId, studentAnswer, correctAnswer }
 * POST /exec?action=generateSimilar { questionId, errorType }
 * POST /exec?action=logPreEnrollmentGame { studentId, studentNumber, department, gameId, status }
 * POST /exec?action=getMyProfile   { studentId, studentNumber }
 * POST /exec?action=validateEnrollment { studentId, studentNumber, department }
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

      case 'getDashboard':
        return jsonResponse(DashboardService.getStudentDashboard(
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
          studentNumber: body.studentNumber || '',
          questionId: body.questionId,
          answer: body.answer,
          isCorrect: body.isCorrect,
          responseTime: body.responseTime,
          department: body.department,
          grade: body.grade,
          studentType: body.studentType || 'enrolled',
          timestamp: body.timestamp || '',
        }));

      case 'logPreEnrollmentGame':
        return jsonResponse(ProspectiveService.logPreEnrollmentGame({
          studentId: body.studentId,
          studentNumber: body.studentNumber || '',
          department: body.department || '',
          gameId: body.gameId,
          status: body.status,
        }));

      case 'getMyProfile':
        return jsonResponse(ProspectiveService.getMyProfile({
          studentId: body.studentId,
          studentNumber: body.studentNumber,
        }));

      case 'validateEnrollment':
        return jsonResponse(ProspectiveService.validateEnrollment({
          studentId: body.studentId,
          studentNumber: body.studentNumber,
          department: body.department,
        }));

      case 'submitAnswerBatch':
        return jsonResponse(AnswerService.submitAnswerBatch(body.answers));

      case 'updateStudentNumber':
        return jsonResponse(AnswerService.updateStudentNumber({
          oldStudentNumber: body.oldStudentNumber,
          newStudentNumber: body.newStudentNumber,
          studentId: body.studentId,
        }));

      case 'analyzeError':
        return jsonResponse(GeminiService.analyzeError({
          questionId: body.questionId,
          studentAnswer: body.studentAnswer,
          correctAnswer: body.correctAnswer,
          questionText: body.questionText,
          choices: body.choices,
          department: body.department,
        }));

      case 'generateSimilar':
        return jsonResponse(GeminiService.generateSimilar({
          questionId: body.questionId,
          errorType: body.errorType,
          originalQuestion: body.originalQuestion,
          analysis: body.analysis,
          department: body.department,
        }));

      case 'refreshDashboard':
        return jsonResponse(DashboardService.refreshStudent(body.studentId));

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
