/**
 * ナースメモリア 回答記録サービス
 */

const AnswerService = {
  /**
   * 回答を記録
   */
  submitAnswer({ studentId, questionId, answer, responseTime, department, grade }) {
    if (!studentId || !questionId) {
      return { error: 'studentId and questionId are required' };
    }

    const sheet = getOrCreateSheet(CONFIG.SHEETS.STUDENT_LOGS);

    // 正解を取得して判定
    const question = findQuestionById(questionId);
    if (!question) {
      return { error: 'Question not found: ' + questionId };
    }

    const selectedAnswer = Array.isArray(answer) ? answer : [answer];
    const correctAnswer = question.correct_answer;
    const isCorrect = arraysEqual(
      selectedAnswer.sort(),
      correctAnswer.sort()
    );

    // この問題の挑戦回数を取得
    const attemptCount = getAttemptCount(sheet, studentId, questionId) + 1;

    // ログ追記（LockServiceでシリアライズ）
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const logId = Utilities.getUuid();
      const timestamp = new Date().toISOString();

      sheet.appendRow([
        logId,
        studentId,
        department || '',
        grade || '',
        questionId,
        selectedAnswer.join(','),
        isCorrect,
        responseTime || 0,
        attemptCount,
        timestamp,
      ]);

      return {
        log_id: logId,
        is_correct: isCorrect,
        correct_answer: correctAnswer,
        attempt_count: attemptCount,
        explanation: question.explanation || '',
        // 3回目の連続誤答でAI分析フラグ
        should_analyze: !isCorrect && attemptCount >= 3,
      };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * バッチ回答記録（オフライン同期用）
   */
  submitAnswerBatch(answers) {
    if (!Array.isArray(answers) || answers.length === 0) {
      return { error: 'answers array is required' };
    }

    const results = [];
    for (const ans of answers) {
      const result = this.submitAnswer(ans);
      results.push(result);
    }
    return { results, count: results.length };
  },

  /**
   * 学生の統計情報
   */
  getStudentStats(studentId) {
    if (!studentId) {
      return { error: 'studentId is required' };
    }

    const sheet = getOrCreateSheet(CONFIG.SHEETS.STUDENT_LOGS);
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      return {
        totalAttempts: 0,
        correctCount: 0,
        accuracy: 0,
        uniqueQuestions: 0,
        streakDays: 0,
        categoryStats: {},
      };
    }

    const headers = data[0];
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    const studentLogs = data.slice(1).filter(row =>
      row[idx['student_id']] === studentId
    );

    if (studentLogs.length === 0) {
      return {
        totalAttempts: 0,
        correctCount: 0,
        accuracy: 0,
        uniqueQuestions: 0,
        streakDays: 0,
        categoryStats: {},
      };
    }

    const totalAttempts = studentLogs.length;
    const correctCount = studentLogs.filter(row =>
      row[idx['is_correct']] === true || row[idx['is_correct']] === 'TRUE'
    ).length;

    const uniqueQuestions = new Set(
      studentLogs.map(row => row[idx['question_id']])
    ).size;

    // 連続学習日数の計算
    const dates = [...new Set(
      studentLogs.map(row => {
        const ts = row[idx['timestamp']];
        return ts ? new Date(ts).toISOString().split('T')[0] : '';
      }).filter(d => d)
    )].sort().reverse();

    let streakDays = 0;
    const today = new Date().toISOString().split('T')[0];
    let checkDate = today;

    for (const date of dates) {
      if (date === checkDate) {
        streakDays++;
        // 前日に移動
        const d = new Date(checkDate);
        d.setDate(d.getDate() - 1);
        checkDate = d.toISOString().split('T')[0];
      } else if (date < checkDate) {
        break;
      }
    }

    // 分野別統計（問題のcategoryを取得して集計）
    const categoryStats = {};
    const questionSheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
    const qData = questionSheet.getDataRange().getValues();
    const qHeaders = qData[0];
    const qIdx = {};
    qHeaders.forEach((h, i) => { qIdx[h] = i; });

    const questionCategories = {};
    for (const row of qData.slice(1)) {
      questionCategories[row[qIdx['question_id']]] = row[qIdx['category']];
    }

    for (const row of studentLogs) {
      const qid = row[idx['question_id']];
      const cat = questionCategories[qid] || '未分類';
      if (!categoryStats[cat]) {
        categoryStats[cat] = { attempts: 0, correct: 0 };
      }
      categoryStats[cat].attempts++;
      if (row[idx['is_correct']] === true || row[idx['is_correct']] === 'TRUE') {
        categoryStats[cat].correct++;
      }
    }

    return {
      totalAttempts,
      correctCount,
      accuracy: totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0,
      uniqueQuestions,
      streakDays,
      categoryStats,
    };
  },
};

// === ヘルパー関数 ===

/**
 * 問題IDから問題を検索
 */
function findQuestionById(questionId) {
  const sheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
  const data = sheet.getDataRange().getValues();

  if (data.length <= 1) return null;

  const headers = data[0];
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });

  const row = data.slice(1).find(r => r[idx['question_id']] === questionId);
  if (!row) return null;

  return rowToQuestion(row, idx);
}

/**
 * 特定学生・問題の挑戦回数を取得
 */
function getAttemptCount(sheet, studentId, questionId) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 0;

  const headers = data[0];
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });

  return data.slice(1).filter(row =>
    row[idx['student_id']] === studentId &&
    row[idx['question_id']] === questionId
  ).length;
}

/**
 * 配列の等価比較
 */
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (String(a[i]).trim().toUpperCase() !== String(b[i]).trim().toUpperCase()) {
      return false;
    }
  }
  return true;
}
