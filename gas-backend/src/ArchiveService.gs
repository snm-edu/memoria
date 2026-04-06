/**
 * Memoria 月次アーカイブサービス
 *
 * student_logsシートの古いデータを月別アーカイブシートに移動し、
 * メインシートのサイズを管理可能な範囲に保つ。
 *
 * アーカイブシート命名: student_logs_2026_04 など
 *
 * 【セットアップ】
 * GASエディタで以下を実行:
 *   1. setupMonthlyArchive() を実行 → 毎月1日午前3時に自動実行
 *   2. 手動実行: archiveOldLogs() を直接実行
 */

/**
 * 毎月1日に自動実行されるトリガーをセットアップ
 * ※ 一度だけ手動で実行してください
 */
function setupMonthlyArchive() {
  // 既存の月次トリガーを削除（重複防止）
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'archiveOldLogs') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // 毎月1日の午前3時に実行
  ScriptApp.newTrigger('archiveOldLogs')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .create();

  Logger.log('月次アーカイブトリガーをセットアップしました（毎月1日 午前3時）');
}

/**
 * 古いログをアーカイブ（前月以前のデータを移動）
 *
 * 処理内容:
 * 1. student_logsシートから前月以前のデータを検索
 * 2. 月別のアーカイブシートに移動
 * 3. 元のstudent_logsシートから移動済み行を削除
 */
function archiveOldLogs() {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    _doArchive();
  } catch (e) {
    Logger.log('アーカイブエラー: ' + e.toString());
  } finally {
    lock.releaseLock();
  }
}

function _doArchive() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEETS.STUDENT_LOGS);
  if (!sheet) {
    Logger.log('student_logsシートが見つかりません');
    return;
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    Logger.log('データなし（ヘッダーのみ）');
    return;
  }

  const headers = data[0];
  const timestampCol = headers.indexOf('timestamp');
  if (timestampCol === -1) {
    Logger.log('timestampカラムが見つかりません');
    return;
  }

  // 今月の初日（これより前のデータをアーカイブ）
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthStr = Utilities.formatDate(thisMonthStart, 'Asia/Tokyo', 'yyyy-MM-dd');

  Logger.log('アーカイブ基準日: ' + thisMonthStr + ' より前のデータを移動');

  // 月ごとにデータを振り分け
  const monthBuckets = {}; // "2026_04" => [row, row, ...]
  const rowsToDelete = []; // 削除する行番号（1-indexed、ヘッダー除く）

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const ts = row[timestampCol];
    if (!ts) continue;

    const date = new Date(ts);
    if (isNaN(date.getTime())) continue;

    // 今月のデータはスキップ
    if (date >= thisMonthStart) continue;

    // 月キーを生成: "2026_04"
    const monthKey = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy_MM');
    if (!monthBuckets[monthKey]) {
      monthBuckets[monthKey] = [];
    }
    monthBuckets[monthKey].push(row);
    rowsToDelete.push(i + 1); // シートの行番号（1-indexed）
  }

  if (rowsToDelete.length === 0) {
    Logger.log('アーカイブ対象のデータはありません');
    return;
  }

  Logger.log('アーカイブ対象: ' + rowsToDelete.length + '行');

  // 各月のアーカイブシートにデータを追加
  for (const [monthKey, rows] of Object.entries(monthBuckets)) {
    const archiveSheetName = CONFIG.SHEETS.STUDENT_LOGS + '_' + monthKey;
    let archiveSheet = ss.getSheetByName(archiveSheetName);

    if (!archiveSheet) {
      // 新規作成してヘッダーを設定
      archiveSheet = ss.insertSheet(archiveSheetName);
      archiveSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      archiveSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      Logger.log('アーカイブシート作成: ' + archiveSheetName);
    }

    // データを一括追加
    const startRow = archiveSheet.getLastRow() + 1;
    archiveSheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
    Logger.log(archiveSheetName + ': ' + rows.length + '行追加');
  }

  // 元シートから移動済み行を削除（下から削除して行番号がずれないようにする）
  rowsToDelete.sort((a, b) => b - a);
  for (const rowNum of rowsToDelete) {
    sheet.deleteRow(rowNum);
  }

  Logger.log('student_logsから ' + rowsToDelete.length + '行を削除しました');
  Logger.log('アーカイブ完了');
}

/**
 * アーカイブの状況を確認（デバッグ用）
 */
function checkArchiveStatus() {
  const ss = getSpreadsheet();
  const sheets = ss.getSheets();

  Logger.log('=== アーカイブ状況 ===');
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (name.startsWith(CONFIG.SHEETS.STUDENT_LOGS)) {
      const rowCount = Math.max(0, sheet.getLastRow() - 1); // ヘッダー除く
      Logger.log(name + ': ' + rowCount + '行');
    }
  }

  // 容量警告
  const mainSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENT_LOGS);
  if (mainSheet) {
    const mainRows = mainSheet.getLastRow() - 1;
    if (mainRows > 50000) {
      Logger.log('⚠️ 警告: student_logsが ' + mainRows + '行あります。アーカイブを実行してください。');
    } else {
      Logger.log('✅ student_logs: ' + mainRows + '行（正常範囲）');
    }
  }
}
