/**
 * メモリア GAS — バックアップサービス
 *
 * 機能:
 *   1. スプレッドシートをGoogleドライブにコピー保存（直近5件保持）
 *   2. questionsシートのデータをJSONファイルとしてドライブに保存
 *   3. 毎週日曜 午前2時に自動実行するトリガーを設定/解除
 */

const BACKUP_FOLDER_NAME = 'メモリア_バックアップ';
const BACKUP_MAX_KEEP    = 5;   // ドライブに残すバックアップ件数

// ============================================================
// メニューから呼び出す関数
// ============================================================

/** スプレッドシートを今すぐコピーバックアップ */
function backupNow() {
  const ui = SpreadsheetApp.getUi();
  try {
    const fileName = backupSpreadsheet_();
    ui.alert('✅ バックアップ完了', `「${fileName}」として\n「${BACKUP_FOLDER_NAME}」フォルダに保存しました。`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ バックアップ失敗', e.message, ui.ButtonSet.OK);
    console.error('backupNow error:', e);
  }
}

/** questionsシートをJSONファイルとして今すぐエクスポート */
function exportQuestionsJson() {
  const ui = SpreadsheetApp.getUi();
  try {
    const fileName = exportQuestionsToJson_();
    ui.alert('✅ JSONエクスポート完了', `「${fileName}」として\n「${BACKUP_FOLDER_NAME}」フォルダに保存しました。`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ エクスポート失敗', e.message, ui.ButtonSet.OK);
    console.error('exportQuestionsJson error:', e);
  }
}

/** 毎週日曜 午前2時の自動バックアップトリガーを設定 */
function setupWeeklyBackupTrigger() {
  const ui = SpreadsheetApp.getUi();
  try {
    // 既存の同名トリガーを削除して重複防止
    deleteBackupTriggers_();

    ScriptApp.newTrigger('autoWeeklyBackup')
      .timeBased()
      .onWeekDay(ScriptApp.WeekDay.SUNDAY)
      .atHour(2)
      .create();

    ui.alert('✅ 自動バックアップ設定完了', '毎週日曜 午前2時に自動バックアップを実行します。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ トリガー設定失敗', e.message, ui.ButtonSet.OK);
    console.error('setupWeeklyBackupTrigger error:', e);
  }
}

/** 自動バックアップトリガーを解除 */
function deleteWeeklyBackupTrigger() {
  const ui = SpreadsheetApp.getUi();
  try {
    const count = deleteBackupTriggers_();
    ui.alert('✅ 自動バックアップ解除', `${count}件のトリガーを削除しました。`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ トリガー解除失敗', e.message, ui.ButtonSet.OK);
    console.error('deleteWeeklyBackupTrigger error:', e);
  }
}

// ============================================================
// 自動実行（トリガー経由）
// ============================================================

/** 毎週日曜 自動バックアップ（トリガーから呼び出される） */
function autoWeeklyBackup() {
  try {
    const ssFile = backupSpreadsheet_();
    const jsonFile = exportQuestionsToJson_();
    console.log(`週次自動バックアップ完了: ${ssFile} / ${jsonFile}`);
  } catch (e) {
    console.error('autoWeeklyBackup error:', e);
  }
}

// ============================================================
// 内部実装
// ============================================================

/**
 * スプレッドシートをGoogleドライブのバックアップフォルダにコピー
 * 古いコピーは BACKUP_MAX_KEEP 件を超えたら削除
 * @return {string} 作成したファイル名
 */
function backupSpreadsheet_() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const date = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd_HH-mm');
  const name = `メモリア問題バンク_backup_${date}`;

  // コピーを作成（ルートに作られる）
  const copy = ss.copy(name);
  const file = DriveApp.getFileById(copy.getId());

  // バックアップフォルダへ移動
  const folder = getOrCreateBackupFolder_();
  folder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  // 古いバックアップを削除（スプレッドシート形式のもののみ）
  pruneBackups_(folder, 'メモリア問題バンク_backup_', BACKUP_MAX_KEEP);

  console.log(`スプレッドシートバックアップ: ${name}`);
  return name;
}

/**
 * questionsシートをJSONファイルとしてバックアップフォルダに保存
 * 古いJSONは BACKUP_MAX_KEEP 件を超えたら削除
 * @return {string} 作成したファイル名
 */
function exportQuestionsToJson_() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheet  = ss.getSheetByName(CONFIG.SHEETS.QUESTIONS);
  if (!sheet) throw new Error('questionsシートが見つかりません');

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows    = data.slice(1).filter(row => row[0]); // question_idが空の行をスキップ

  const questions = rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });

  const date     = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const fileName = `questions_backup_${date}.json`;
  const json     = JSON.stringify(questions, null, 2);

  const folder = getOrCreateBackupFolder_();

  // 同じ日付のファイルがあれば上書き（削除して再作成）
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) existing.next().setTrashed(true);

  folder.createFile(fileName, json, MimeType.PLAIN_TEXT);

  // 古いJSONを削除
  pruneBackups_(folder, 'questions_backup_', BACKUP_MAX_KEEP);

  console.log(`JSONエクスポート: ${fileName}（${questions.length}問）`);
  return fileName;
}

/**
 * バックアップフォルダを取得または作成
 * @return {Folder}
 */
function getOrCreateBackupFolder_() {
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(BACKUP_FOLDER_NAME);
}

/**
 * 指定プレフィックスを持つファイルを更新日降順で並べ、
 * maxKeep 件を超えた古いものをゴミ箱へ
 * @param {Folder} folder
 * @param {string} prefix
 * @param {number} maxKeep
 */
function pruneBackups_(folder, prefix, maxKeep) {
  const files = [];
  const iter  = folder.getFiles();
  while (iter.hasNext()) {
    const f = iter.next();
    if (f.getName().startsWith(prefix)) files.push(f);
  }
  // 新しい順にソート
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  // maxKeep 件より古いものを削除
  files.slice(maxKeep).forEach(f => {
    console.log(`古いバックアップを削除: ${f.getName()}`);
    f.setTrashed(true);
  });
}

/**
 * autoWeeklyBackup トリガーを全削除
 * @return {number} 削除件数
 */
function deleteBackupTriggers_() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'autoWeeklyBackup');
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  return triggers.length;
}
