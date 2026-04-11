/**
 * メモリア GAS — 問題データ一括インポートサービス
 *
 * 使い方:
 * 1. Google Sheetsを開く → メニュー「メモリア管理」→「CE問題をインポート」
 *
 * または手動手順:
 * 1. CE_questions_for_sheets.csv を Googleドライブにアップロード
 * 2. スプレッドシートを開き「ce_import」シートを作成してCSVの内容を貼り付け
 * 3. GASエディタからimportFromStagingSheet()を実行
 */

/**
 * スプレッドシートを開いたときにカスタムメニューを追加
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('メモリア管理')
    .addItem('AIダッシュボード更新', 'updateAllDashboards')
    .addSeparator()
    .addItem('📥 CE問題をインポート（ce_importシートから）', 'importFromStagingSheet')
    .addItem('📥 CO問題をインポート（co_importシートから）', 'importCOFromStagingSheet')
    .addSeparator()
    .addItem('🔍 questions件数を確認', 'countQuestions')
    .addToUi();
}

/**
 * ステージングシート（ce_import）からquestionsシートへデータをインポート
 *
 * 手順:
 * 1. CE_questions_for_sheets.csv の内容をスプレッドシートの「ce_import」シートに貼り付ける
 *    （ファイル→インポート→アップロード→既存のシートに置き換え→シート名:ce_import）
 * 2. このメニュー「CE問題をインポート」を実行する
 */
function importFromStagingSheet() {
  importDepartmentFromStagingSheet_('ce_import', 'CE');
}

/**
 * co_importシートからCO問題をインポート
 */
function importCOFromStagingSheet() {
  importDepartmentFromStagingSheet_('co_import', 'CO');
}

/**
 * 内部関数: 指定ステージングシートからquestionsシートへインポート
 */
function importDepartmentFromStagingSheet_(stagingSheetName, prefix) {
  const ss = getSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // ステージングシートの確認
  const stagingSheet = ss.getSheetByName(stagingSheetName);
  if (!stagingSheet) {
    ui.alert(
      'シートが見つかりません',
      `「${stagingSheetName}」シートが存在しません。\n\n` +
      `手順:\n` +
      `1. ファイル > インポート > アップロード\n` +
      `2. ${prefix === 'CE' ? 'CE' : 'CO'}_questions_for_sheets.csv を選択\n` +
      `3. 「既存のシートを置き換える」を選び、シート名を「${stagingSheetName}」に設定\n` +
      `4. インポート完了後、再度このメニューを実行してください。`,
      ui.ButtonSet.OK
    );
    return;
  }

  // questionsシートを取得
  const questSheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
  const questHeaders = questSheet.getRange(1, 1, 1, questSheet.getLastColumn()).getValues()[0];

  // ステージングシートのヘッダー確認
  const stagingHeaders = stagingSheet.getRange(1, 1, 1, stagingSheet.getLastColumn()).getValues()[0];

  // ヘッダーが一致しているか確認
  const expectedHeaders = getSheetHeaders(CONFIG.SHEETS.QUESTIONS);
  const headersMatch = expectedHeaders.every((h, i) => stagingHeaders[i] === h);
  if (!headersMatch) {
    ui.alert(
      'ヘッダー不一致',
      `ステージングシートのヘッダーがquestionsシートと異なります。\n` +
      `期待値: ${expectedHeaders.slice(0, 5).join(', ')}...\n` +
      `実際値: ${stagingHeaders.slice(0, 5).join(', ')}...`,
      ui.ButtonSet.OK
    );
    return;
  }

  // 既存のquestion_idセットを作成（重複防止）
  const questLastRow = questSheet.getLastRow();
  const existingIds = new Set();
  if (questLastRow > 1) {
    const idCol = questHeaders.indexOf('question_id') + 1;
    const existingIdValues = questSheet.getRange(2, idCol, questLastRow - 1, 1).getValues();
    existingIdValues.forEach(([id]) => { if (id) existingIds.add(String(id)); });
  }
  console.log(`既存問題数: ${existingIds.size}`);

  // ステージングシートからデータを読み込み
  const stagingLastRow = stagingSheet.getLastRow();
  if (stagingLastRow < 2) {
    ui.alert('データなし', 'ステージングシートにデータがありません。', ui.ButtonSet.OK);
    return;
  }

  const stagingData = stagingSheet.getRange(2, 1, stagingLastRow - 1, stagingHeaders.length).getValues();
  const idColIdx = stagingHeaders.indexOf('question_id');

  // 重複を除いた新規データのみ抽出
  const newRows = stagingData.filter(row => {
    const id = String(row[idColIdx] || '');
    return id && !existingIds.has(id);
  });

  console.log(`新規インポート対象: ${newRows.length}問（重複スキップ: ${stagingData.length - newRows.length}問）`);

  if (newRows.length === 0) {
    ui.alert(
      'インポート不要',
      `すべての${prefix}問題（${stagingData.length}問）は既にインポート済みです。`,
      ui.ButtonSet.OK
    );
    return;
  }

  // 確認ダイアログ
  const result = ui.alert(
    'インポート確認',
    `${prefix}問題を${newRows.length}問インポートします。\n（重複スキップ: ${stagingData.length - newRows.length}問）\n\n続けますか？`,
    ui.ButtonSet.YES_NO
  );
  if (result !== ui.Button.YES) return;

  // questionsシートに追記（500行ずつバッチ処理）
  const BATCH_SIZE = 500;
  const targetStartRow = questLastRow + 1;

  for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
    const batch = newRows.slice(i, i + BATCH_SIZE);
    questSheet.getRange(
      targetStartRow + i,
      1,
      batch.length,
      expectedHeaders.length
    ).setValues(batch);

    // レート制限対策
    if (i + BATCH_SIZE < newRows.length) {
      Utilities.sleep(500);
    }
  }

  // 完了通知
  ui.alert(
    'インポート完了 ✅',
    `${prefix}問題を${newRows.length}問インポートしました。\n` +
    `questionsシート総件数: ${questLastRow - 1 + newRows.length}問`,
    ui.ButtonSet.OK
  );

  console.log(`インポート完了: ${newRows.length}問を追加（合計 ${questLastRow - 1 + newRows.length}問）`);
}

/**
 * questionsシートの件数を学科別に確認
 */
function countQuestions() {
  const sheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('questionsシートにデータがありません。');
    return;
  }

  // department列のインデックス
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const deptCol = headers.indexOf('department') + 1;

  // データ全取得
  const depts = sheet.getRange(2, deptCol, lastRow - 1, 1).getValues().flat();

  // 集計
  const counts = {};
  depts.forEach(d => {
    const key = d || '(不明)';
    counts[key] = (counts[key] || 0) + 1;
  });

  const total = lastRow - 1;
  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([dept, count]) => `  ${dept}: ${count}問`)
    .join('\n');

  SpreadsheetApp.getUi().alert(
    'questions件数サマリー',
    `合計: ${total}問\n\n学科別:\n${summary}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * AIダッシュボード手動更新（メニューから呼び出し）
 */
function updateAllDashboards() {
  DashboardService.updateAll();
  SpreadsheetApp.getUi().alert('AIダッシュボード更新完了', 'すべての学生のAIコメントを更新しました。', SpreadsheetApp.getUi().ButtonSet.OK);
}
