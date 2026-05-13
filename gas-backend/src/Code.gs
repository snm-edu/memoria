/**
 * Memoria GASバックエンド メインルーター
 *
 * GET  /exec?action=getQuestions&dept=nursing&category=...&limit=20&offset=0
 * GET  /exec?action=getReviewQueue&studentId=xxx
 * GET  /exec?action=getStudentStats&studentId=xxx
 * GET  /exec?action=getStudentTreemap&studentId=xxx&studentNumber=snm&department=clinical_eng&grade=2&categories=cat1,cat2,...
 * GET  /exec?action=getTeacherComment&studentId=xxx (教員専用、HTML応答、Looker→新タブで開く想定)
 * GET  /exec?action=getMyRanking&studentId=xxx (同学年内 percentile + 段階表現)
 * GET  /exec?action=getWorksheet&studentId=xxx&token=YYY&count=20 (教員専用、トークン認証、補講ワークシートPDFを生成してsnmにメール送信)
 * POST /exec?action=submitAnswer   { studentId, studentNumber, questionId, answer, responseTime, department, grade, studentType }
 * POST /exec?action=submitAnswerBatch { answers: [...] }
 * POST /exec?action=updateStudentNumber { oldStudentNumber, newStudentNumber, studentId }
 * POST /exec?action=analyzeError   { questionId, studentAnswer, correctAnswer }
 * POST /exec?action=generateSimilar { questionId, errorType }
 * POST /exec?action=logPreEnrollmentGame { studentId, studentNumber, department, gameId, status }
 * POST /exec?action=getMyProfile   { studentId, studentNumber }
 * POST /exec?action=validateEnrollment { studentId, studentNumber, department }
 * POST /exec?action=refreshStudentTreemap { studentId, studentNumber, department, grade, categories }
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

      case 'getStudentTreemap':
        var categoriesParam = e.parameter.categories || '';
        var categories = categoriesParam ? categoriesParam.split(',') : [];
        return jsonResponse(TreemapService.getStudentTreemap({
          studentId: e.parameter.studentId || '',
          studentNumber: e.parameter.studentNumber || '',
          department: e.parameter.department || '',
          grade: parseInt(e.parameter.grade) || 0,
          categories: categories
        }));

      case 'getTeacherComment':
        // 教員専用エンドポイント。HTML応答 (HtmlOutput) を返すので jsonResponse でラップしない。
        // 認証は TeacherCommentService 内で Session.getActiveUser().getEmail() を allow-list 照合。
        // 学生PWAが叩いても allow-list 不一致で 403 ページが返る。
        return TeacherCommentService.generateAndDisplay(e.parameter.studentId || '');

      case 'getMyRanking':
        // 同学年内の自分の位置 (Phase D-3: 弱点マップで表示)
        // 個人特定を避けるため percentile + 段階表現のみ返却 (順位は返さない)
        return jsonResponse(RankingService.getMyRanking(e.parameter.studentId));

      case 'getWorksheet':
        // 教員専用エンドポイント: 補講ワークシート (Google Doc + PDF) を生成して教員にメール送信
        // HTML 応答 (HtmlOutput) を返す。認証は WorksheetService 内で WORKSHEET_TOKEN を照合する。
        return WorksheetService.generateAndDeliver(e.parameter.studentId || '', {
          count: e.parameter.count || '',
          token: e.parameter.token || ''
        });

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

      case 'refreshStudentTreemap':
        return jsonResponse(TreemapService.refreshStudentTreemap({
          studentId: body.studentId || '',
          studentNumber: body.studentNumber || '',
          department: body.department || '',
          grade: parseInt(body.grade) || 0,
          categories: Array.isArray(body.categories) ? body.categories : [],
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
