/**
 * Memoria 回答記録サービス
 */

const AnswerService = {
  /**
   * 回答を記録
   */
  submitAnswer({ studentId, studentNumber, questionId, answer, isCorrect, responseTime, department, grade, timestamp }) {
    if (!studentId || !questionId) {
      return { error: 'studentId and questionId are required' };
    }

    const sheet = getOrCreateSheet(CONFIG.SHEETS.STUDENT_LOGS);

    // ヘッダー確認・作成
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'log_id', 'student_id', 'student_number', 'department', 'grade',
        'question_id', 'selected_answer', 'is_correct', 'response_time_ms',
        'attempt_count', 'timestamp'
      ]);
    }

    const selectedAnswer = Array.isArray(answer) ? answer : [answer];

    // isCorrectがPWAから送られていない場合は正解判定する
    if (isCorrect === undefined || isCorrect === null) {
      const question = findQuestionById(questionId);
      if (question) {
        const correctAnswer = question.correct_answer;
        isCorrect = arraysEqual(selectedAnswer.sort(), correctAnswer.sort());
      } else {
        isCorrect = false;
      }
    }

    // この問題の挑戦回数を取得
    const attemptCount = getAttemptCount(sheet, studentId, questionId) + 1;

    // ログ追記（LockServiceでシリアライズ）
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const logId = Utilities.getUuid();
      const ts = timestamp || new Date().toISOString();

      sheet.appendRow([
        logId,
        studentId,
        studentNumber || '',
        department || '',
        grade || '',
        questionId,
        selectedAnswer.join(','),
        isCorrect,
        responseTime || 0,
        attemptCount,
        ts,
      ]);

      return {
        log_id: logId,
        is_correct: isCorrect,
        attempt_count: attemptCount,
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
   * 学籍番号の変更（過去ログも一括更新）
   */
  updateStudentNumber({ oldStudentNumber, newStudentNumber, studentId }) {
    if (!newStudentNumber) {
      return { error: 'newStudentNumber is required' };
    }

    const sheet = getOrCreateSheet(CONFIG.SHEETS.STUDENT_LOGS);
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      return { updatedRows: 0 };
    }

    const headers = data[0];
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    const studentIdCol = idx['student_id'];
    const studentNumberCol = idx['student_number'];

    // student_number カラムが存在しない場合は追加
    if (studentNumberCol === undefined) {
      return { error: 'student_number column not found. Please update the sheet headers.' };
    }

    let updatedRows = 0;
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        // studentId（端末ID）で照合、または旧学籍番号で照合
        if (row[studentIdCol] === studentId ||
            (oldStudentNumber && row[studentNumberCol] === oldStudentNumber)) {
          sheet.getRange(i + 1, studentNumberCol + 1).setValue(newStudentNumber);
          updatedRows++;
        }
      }
    } finally {
      lock.releaseLock();
    }

    return { updatedRows };
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
        const d = new Date(checkDate);
        d.setDate(d.getDate() - 1);
        checkDate = d.toISOString().split('T')[0];
      } else if (date < checkDate) {
        break;
      }
    }

    // 分野別統計
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
