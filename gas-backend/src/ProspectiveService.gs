/**
 * Memoria 入学前（prospective）サービス
 *
 * - logPreEnrollmentGame: 入学前教育ゲームの実施ログを prospective_logs シートに記録
 * - getMyProfile: 教員が Sheets で更新したプロフィール（学年・区分）を返す
 */

const ProspectiveService = {
  /**
   * 入学前ゲームの実施ログを記録
   */
  logPreEnrollmentGame({ studentId, studentNumber, department, gameId, status }) {
    if (!studentId || !gameId) {
      return { error: 'studentId and gameId are required' };
    }

    const allowedGames = ['basics', 'kanji', 'reading', 'thinking'];
    if (allowedGames.indexOf(gameId) === -1) {
      return { error: 'invalid gameId: ' + gameId };
    }

    const allowedStatus = ['started', 'completed'];
    const resolvedStatus = allowedStatus.indexOf(status) !== -1 ? status : 'started';

    const sheet = getOrCreateSheet(CONFIG.SHEETS.PROSPECTIVE_LOGS);

    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);

      const logId = Utilities.getUuid();
      const ts = new Date().toISOString();

      sheet.appendRow([
        logId,
        studentId,
        studentNumber || '',
        department || '',
        gameId,
        resolvedStatus,
        ts,
      ]);

      return { log_id: logId };
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * 最新プロフィール（教員が Sheets で更新した状態）を返す
   * - profile シートが存在し、student_id と student_number の両方が一致する行を返す
   * - 片方しか一致しない場合は null を返す（なりすまし防止）
   */
  getMyProfile({ studentId, studentNumber }) {
    if (!studentId || !studentNumber) {
      return { error: 'studentId and studentNumber are required' };
    }

    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEETS.PROFILE);
    if (!sheet) {
      return { profile: null };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { profile: null };
    }

    const headers = data[0];
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });

    const required = ['student_id', 'student_number', 'department', 'grade', 'student_type'];
    for (let k = 0; k < required.length; k++) {
      if (idx[required[k]] === undefined) {
        return { error: 'profile sheet missing column: ' + required[k] };
      }
    }

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const sid = String(row[idx['student_id']] || '');
      const snum = String(row[idx['student_number']] || '');
      // 両方一致で初めて返す（studentId 単独でのなりすましを拒否）
      if (sid === studentId && snum === studentNumber) {
        return {
          profile: {
            studentNumber: snum,
            department: String(row[idx['department']] || ''),
            grade: Number(row[idx['grade']]) || 0,
            studentType: String(row[idx['student_type']] || 'enrolled'),
          },
        };
      }
    }

    return { profile: null };
  },
};
