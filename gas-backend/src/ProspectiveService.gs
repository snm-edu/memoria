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

/**
 * ワンショット: student_logs の student_type 列の空セルを 'enrolled' で埋める
 *
 * GAS エディタから手動で 1 回だけ実行してください。
 * 実行後、以降の書き込みは AnswerService.submitAnswer が自動的に埋めます。
 */
function backfillStudentTypeEnrolled() {
  const sheet = getOrCreateSheet(CONFIG.SHEETS.STUDENT_LOGS);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow <= 1) {
    console.log('[backfill] データ行なし');
    return;
  }

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const typeColIdx = headers.indexOf('student_type');
  if (typeColIdx === -1) {
    throw new Error('student_type 列が見つかりません。先にヘッダー行に student_type を追加してください。');
  }

  const range = sheet.getRange(2, typeColIdx + 1, lastRow - 1, 1);
  const values = range.getValues();
  let filled = 0;
  for (let i = 0; i < values.length; i++) {
    if (!values[i][0]) {
      values[i][0] = 'enrolled';
      filled++;
    }
  }
  range.setValues(values);
  console.log('[backfill] ' + filled + ' 行を enrolled で埋めました');
}
