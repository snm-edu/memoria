/**
 * Memoria 回答記録サービス
 */

const AnswerService = {
  /**
   * 回答を記録
   */
  submitAnswer({ studentId, studentNumber, questionId, answer, isCorrect, responseTime, department, grade, studentType, timestamp }) {
    if (!studentId || !questionId) {
      return { error: 'studentId and questionId are required' };
    }

    const sheet = getOrCreateSheet(CONFIG.SHEETS.STUDENT_LOGS);

    // ヘッダー確認・作成（student_type 列を含む最新スキーマ）
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'log_id', 'student_id', 'student_number', 'department', 'grade',
        'student_type',
        'question_id', 'selected_answer', 'is_correct', 'response_time_ms',
        'attempt_count', 'timestamp'
      ]);
    }

    const selectedAnswer = Array.isArray(answer) ? answer : [answer];

    // is_correct は常にサーバ側で問題バンクと突合して判定する（クライアント申告を信頼しない。
    // 教員ダッシュボード・ランキング・弱点分析の元データ品質を守るため）。
    // 問題バンクに無いID（AI類題 GEN-* 等）のみクライアント値を採用する。
    const question = findQuestionById(questionId);
    if (question && question.correct_answer && question.correct_answer.length > 0) {
      isCorrect = arraysEqual(
        selectedAnswer.slice().sort(),
        question.correct_answer.slice().sort()
      );
    } else if (isCorrect === undefined || isCorrect === null) {
      isCorrect = false;
    }

    // この問題の挑戦回数を取得
    const attemptCount = getAttemptCount(sheet, studentId, questionId) + 1;

    // ログ追記（LockServiceでシリアライズ）
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const logId = Utilities.getUuid();
      // クライアント時計のズレ・過去日付申告によるstreak水増しを防ぐ:
      // 不正な形式または±48時間超の乖離はサーバ受信時刻で上書きする
      let ts = timestamp || new Date().toISOString();
      const parsedTs = Date.parse(ts);
      if (!isFinite(parsedTs) || Math.abs(Date.now() - parsedTs) > 48 * 3600 * 1000) {
        ts = new Date().toISOString();
      }

      // 既存シートの列順に依存しないよう、ヘッダー名で値をマッピング
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const valueByCol = {
        log_id: logId,
        student_id: studentId,
        student_number: studentNumber || '',
        department: department || '',
        grade: grade || '',
        student_type: studentType || 'enrolled',
        question_id: questionId,
        selected_answer: selectedAnswer.join(','),
        is_correct: isCorrect,
        response_time_ms: responseTime || 0,
        attempt_count: attemptCount,
        timestamp: ts,
      };
      const row = headers.map(h => (h in valueByCol ? valueByCol[h] : ''));

      sheet.appendRow(row);

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
    // studentId(UUID) を必須にする。学籍番号は連番で推測可能なため、
    // 旧学籍番号だけで他人のログ帰属を書き換えられる経路は認めない。
    if (!newStudentNumber || !studentId) {
      return { error: 'studentId and newStudentNumber are required' };
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
        // studentId（推測困難なUUID）の一致行のみ更新。
        // oldStudentNumber 単独一致での書き換えは廃止（他人のログ付け替え防止）
        if (row[studentIdCol] === studentId) {
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
 * 問題バンクの実行内キャッシュ。
 * is_correct のサーバ判定を全回答で行うため、バッチ50件でも
 * シート読み取りは実行あたり1回に抑える（GAS 6分制限対策）。
 */
let __questionTableCache = null;

function getQuestionTable_() {
  if (__questionTableCache) return __questionTableCache;
  const sheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
  const data = sheet.getDataRange().getValues();
  const idx = {};
  const rowById = {};
  if (data.length > 0) {
    data[0].forEach((h, i) => { idx[h] = i; });
    for (let i = 1; i < data.length; i++) {
      rowById[data[i][idx['question_id']]] = data[i];
    }
  }
  __questionTableCache = { idx, rowById, parsed: {} };
  return __questionTableCache;
}

/**
 * 問題IDから問題を検索（実行内メモ化つき）
 */
function findQuestionById(questionId) {
  const table = getQuestionTable_();
  if (Object.prototype.hasOwnProperty.call(table.parsed, questionId)) {
    return table.parsed[questionId];
  }
  const row = table.rowById[questionId];
  const question = row ? rowToQuestion(row, table.idx) : null;
  table.parsed[questionId] = question;
  return question;
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
