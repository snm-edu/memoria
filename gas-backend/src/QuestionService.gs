/**
 * ナースメモリア 問題取得サービス
 */

const QuestionService = {
  /**
   * 問題を取得（フィルタ付き）
   */
  getQuestions({ dept, category, limit, offset, year }) {
    const sheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
    const data = sheet.getDataRange().getValues();

    if (data.length <= 1) {
      return { questions: [], total: 0 };
    }

    const headers = data[0];
    const rows = data.slice(1);

    // ヘッダーからインデックスを取得
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    // フィルタ適用
    let filtered = rows;

    if (dept) {
      filtered = filtered.filter(row => row[idx['department']] === dept);
    }
    if (category) {
      filtered = filtered.filter(row =>
        String(row[idx['category']]).includes(category)
      );
    }
    if (year) {
      filtered = filtered.filter(row =>
        parseInt(row[idx['exam_year']]) === year
      );
    }

    // 計算問題（正解なし）を除外
    filtered = filtered.filter(row =>
      row[idx['correct_answer']] && String(row[idx['correct_answer']]).trim() !== ''
    );

    const total = filtered.length;

    // ページネーション
    const safeLimit = Math.min(limit || CONFIG.DEFAULT_QUESTION_LIMIT, CONFIG.MAX_QUESTION_LIMIT);
    const safeOffset = Math.max(offset || 0, 0);
    const paged = filtered.slice(safeOffset, safeOffset + safeLimit);

    // 行データをオブジェクトに変換
    const questions = paged.map(row => rowToQuestion(row, idx));

    return { questions, total, limit: safeLimit, offset: safeOffset };
  },

  /**
   * 復習対象の問題IDリストを返す
   * （PWA側でSM-2を管理しているため、全問題IDを返し、PWA側でフィルタ）
   */
  getReviewQueue(studentId) {
    if (!studentId) {
      return { error: 'studentId is required' };
    }

    // student_logsから学生の解答履歴を取得
    const logSheet = getOrCreateSheet(CONFIG.SHEETS.STUDENT_LOGS);
    const logData = logSheet.getDataRange().getValues();

    if (logData.length <= 1) {
      return { questionIds: [], stats: {} };
    }

    const headers = logData[0];
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    // この学生のログをフィルタ
    const studentLogs = logData.slice(1).filter(row =>
      row[idx['student_id']] === studentId
    );

    // 問題ごとの統計を集計
    const questionStats = {};
    for (const row of studentLogs) {
      const qid = row[idx['question_id']];
      if (!questionStats[qid]) {
        questionStats[qid] = {
          attempts: 0,
          correct: 0,
          lastAttempt: '',
          consecutiveErrors: 0,
        };
      }
      const stat = questionStats[qid];
      stat.attempts++;
      const isCorrect = row[idx['is_correct']] === true || row[idx['is_correct']] === 'TRUE';
      if (isCorrect) {
        stat.correct++;
        stat.consecutiveErrors = 0;
      } else {
        stat.consecutiveErrors++;
      }
      stat.lastAttempt = row[idx['timestamp']];
    }

    return {
      questionIds: Object.keys(questionStats),
      stats: questionStats,
    };
  },
};

/**
 * シートの行データをQuestionオブジェクトに変換
 */
function rowToQuestion(row, idx) {
  return {
    question_id: row[idx['question_id']],
    department: row[idx['department']],
    exam_year: parseInt(row[idx['exam_year']]) || 0,
    exam_number: parseInt(row[idx['exam_number']]) || 0,
    category: row[idx['category']],
    subcategory: row[idx['subcategory']],
    subtopic: row[idx['subtopic']],
    difficulty: parseInt(row[idx['difficulty']]) || 3,
    question_text: row[idx['question_text']],
    choices: [
      row[idx['choice_a']],
      row[idx['choice_b']],
      row[idx['choice_c']],
      row[idx['choice_d']],
      row[idx['choice_e']] || '',
    ].filter(c => c !== ''),
    correct_answer: String(row[idx['correct_answer']]).split(',').map(s => s.trim()),
    explanation: row[idx['explanation']] || '',
    has_image: row[idx['has_image']] === true || row[idx['has_image']] === 'TRUE',
    image_url: row[idx['image_url']] || '',
    is_multi_select: row[idx['is_multi_select']] === true || row[idx['is_multi_select']] === 'TRUE',
    source: row[idx['source']],
    created_at: row[idx['created_at']],
  };
}
