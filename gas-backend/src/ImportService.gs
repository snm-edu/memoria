/**
 * メモリア GAS — 問題データ一括インポートサービス
 *
 * GitHub Pages上のquestions.jsonを直接フェッチして
 * questionsシートに自動インポートする。
 * CSVファイルの手動操作は不要。
 */

// GitHub Pages の questions.json URL
const QUESTIONS_JSON_URL = 'https://memoria-flame.vercel.app/data/questions.json';

/**
 * スプレッドシートを開いたときにカスタムメニューを追加
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const importMenu = ui.createMenu('📥 問題インポート')
    .addItem('CE（臨床工学技士）', 'importCEQuestions')
    .addItem('CO（視能訓練士）',   'importCOQuestions')
    .addItem('DH（歯科衛生士）',   'importDHQuestions')
    .addItem('NRS（看護師）',      'importNRSQuestions');

  const updateMenu = ui.createMenu('🔄 カテゴリ一括更新')
    .addItem('全学科を更新',         'updateAllCategories')
    .addSeparator()
    .addItem('CE（臨床工学技士）',   'updateCECategories')
    .addItem('CO（視能訓練士）',     'updateCOCategories')
    .addItem('DH（歯科衛生士）',     'updateDHCategories')
    .addItem('NRS（看護師）',        'updateNRSCategories');

  const backupMenu = ui.createMenu('🔒 バックアップ')
    .addItem('今すぐバックアップ（スプレッドシートコピー）', 'backupNow')
    .addItem('questionsをJSONでエクスポート',                'exportQuestionsJson')
    .addSeparator()
    .addItem('週次自動バックアップを設定（毎週日曜2時）',   'setupWeeklyBackupTrigger')
    .addItem('週次自動バックアップを解除',                   'deleteWeeklyBackupTrigger');

  ui.createMenu('メモリア管理')
    .addItem('🤖 AIダッシュボード更新', 'updateAllDashboards')
    .addSeparator()
    .addSubMenu(importMenu)
    .addSubMenu(updateMenu)
    .addSubMenu(backupMenu)
    .addSeparator()
    .addItem('🔍 questions件数を確認', 'countQuestions')
    .addToUi();
}

/** CE（臨床工学技士）問題をインポート */
function importCEQuestions() {
  importDepartmentFromGitHub_('clinical_eng', 'CE（臨床工学技士）');
}

/** CO（視能訓練士）問題をインポート */
function importCOQuestions() {
  importDepartmentFromGitHub_('orthoptist', 'CO（視能訓練士）');
}

/** DH（歯科衛生士）問題をインポート */
function importDHQuestions() {
  importDepartmentFromGitHub_('dental_hyg', 'DH（歯科衛生士）');
}

/** NRS（看護師）問題をインポート */
function importNRSQuestions() {
  importDepartmentFromGitHub_('nursing', 'NRS（看護師）');
}

/**
 * GitHub Pages の questions.json から指定学科の問題をインポート
 * @param {string} department - 'clinical_eng' | 'orthoptist' | 'nursing' | 'dental_hyg'
 * @param {string} label - 表示用学科名
 */
function importDepartmentFromGitHub_(department, label) {
  const ui = SpreadsheetApp.getUi();

  // 進行中メッセージ
  ui.alert(
    `${label}問題インポート開始`,
    `GitHub Pagesからデータを取得しています...\nしばらくお待ちください（30秒〜1分程度）`,
    ui.ButtonSet.OK
  );

  try {
    // questions.json を GitHub Pages からフェッチ
    console.log(`フェッチ開始: ${QUESTIONS_JSON_URL}`);
    const response = UrlFetchApp.fetch(QUESTIONS_JSON_URL, {
      muteHttpExceptions: true,
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (response.getResponseCode() !== 200) {
      ui.alert('取得エラー', `GitHub Pages からの取得に失敗しました（HTTP ${response.getResponseCode()}）\nしばらく待ってから再試行してください。`, ui.ButtonSet.OK);
      return;
    }

    const allQuestions = JSON.parse(response.getContentText());
    console.log(`全問題数: ${allQuestions.length}`);

    // 対象学科のみフィルタ
    const deptQuestions = allQuestions.filter(q => q.department === department);
    console.log(`${label}問題数: ${deptQuestions.length}`);

    if (deptQuestions.length === 0) {
      ui.alert('データなし', `${label}の問題が見つかりませんでした。\nquestions.jsonに${department}のデータが含まれているか確認してください。`, ui.ButtonSet.OK);
      return;
    }

    // questionsシートを取得
    const questSheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
    const questLastRow = questSheet.getLastRow();
    const expectedHeaders = getSheetHeaders(CONFIG.SHEETS.QUESTIONS);

    // 既存のquestion_idセット（重複防止）
    const existingIds = new Set();
    if (questLastRow > 1) {
      const idValues = questSheet.getRange(2, 1, questLastRow - 1, 1).getValues();
      idValues.forEach(([id]) => { if (id) existingIds.add(String(id)); });
    }
    console.log(`既存問題数: ${existingIds.size}`);

    // questions.json形式 → Sheets行形式に変換（重複除外）
    const newRows = [];
    for (const q of deptQuestions) {
      if (existingIds.has(String(q.question_id))) continue;

      // choices配列 → choice_a〜choice_e
      const choices = q.choices || [];
      const choice_a = choices[0] || '';
      const choice_b = choices[1] || '';
      const choice_c = choices[2] || '';
      const choice_d = choices[3] || '';
      const choice_e = choices[4] || '';

      // correct_answer配列 → カンマ区切り文字列
      const correct_answer = Array.isArray(q.correct_answer)
        ? q.correct_answer.join(',')
        : (q.correct_answer || '');

      // Sheetsヘッダー順に並べた行データ
      // ['question_id','department','exam_year','exam_number','category','subcategory',
      //  'subtopic','difficulty','question_text','choice_a'〜'choice_e',
      //  'correct_answer','explanation','has_image','image_url','is_multi_select','source','created_at']
      newRows.push([
        q.question_id   || '',
        q.department    || department,
        q.exam_year     || '',
        q.exam_number   || '',
        q.category      || '',
        q.subcategory   || '',
        q.subtopic      || '',
        q.difficulty    || 3,
        q.question_text || '',
        choice_a,
        choice_b,
        choice_c,
        choice_d,
        choice_e,
        correct_answer,
        q.explanation   || '',
        q.has_image     ? 'True' : 'False',
        q.image_url     || '',
        q.is_multi_select ? 'True' : 'False',
        q.source        || 'past_exam',
        q.created_at    || new Date().toISOString(),
      ]);
    }

    console.log(`新規インポート対象: ${newRows.length}問（重複スキップ: ${deptQuestions.length - newRows.length}問）`);

    if (newRows.length === 0) {
      ui.alert(
        'インポート不要',
        `${label}の全問題（${deptQuestions.length}問）はすでにインポート済みです。`,
        ui.ButtonSet.OK
      );
      return;
    }

    // 確認ダイアログ
    const result = ui.alert(
      'インポート確認',
      `${label}の問題を ${newRows.length}問 インポートします。\n` +
      `（重複スキップ: ${deptQuestions.length - newRows.length}問）\n\n続けますか？`,
      ui.ButtonSet.YES_NO
    );
    if (result !== ui.Button.YES) return;

    // 500行ずつバッチ書き込み（GASのタイムアウト対策）
    const BATCH_SIZE = 500;
    const startRow = questLastRow + 1;

    for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
      const batch = newRows.slice(i, i + BATCH_SIZE);
      questSheet.getRange(startRow + i, 1, batch.length, expectedHeaders.length)
        .setValues(batch);
      if (i + BATCH_SIZE < newRows.length) Utilities.sleep(300);
    }

    ui.alert(
      'インポート完了 ✅',
      `${label}の問題を ${newRows.length}問 インポートしました。\n` +
      `questionsシート総件数: ${questLastRow - 1 + newRows.length}問`,
      ui.ButtonSet.OK
    );

    console.log(`完了: ${newRows.length}問追加（合計 ${questLastRow - 1 + newRows.length}問）`);

  } catch (e) {
    console.error('インポートエラー:', e);
    ui.alert('エラー', `インポート中にエラーが発生しました:\n${e.message}`, ui.ButtonSet.OK);
  }
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

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const deptCol = headers.indexOf('department') + 1;
  const depts = sheet.getRange(2, deptCol, lastRow - 1, 1).getValues().flat();

  const counts = {};
  depts.forEach(d => {
    const key = d || '(不明)';
    counts[key] = (counts[key] || 0) + 1;
  });

  const total = lastRow - 1;
  const labelMap = {
    nursing: '看護学科',
    clinical_eng: '臨床工学科',
    dental_hyg: '歯科衛生学科',
    orthoptist: '視能訓練学科',
  };
  const summary = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([dept, count]) => `  ${labelMap[dept] || dept}: ${count}問`)
    .join('\n');

  SpreadsheetApp.getUi().alert(
    'questions件数サマリー',
    `合計: ${total}問\n\n学科別:\n${summary}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * 既存問題のcategory/subcategory/subtopicを最新JSONで一括更新
 * @param {string} department - 'clinical_eng' | 'orthoptist' | 'nursing' | 'dental_hyg'
 * @param {string} label - 表示用学科名
 */
function updateCategoriesFromGitHub_(department, label) {
  const ui = SpreadsheetApp.getUi();

  ui.alert(
    `${label} カテゴリ更新開始`,
    `GitHub Pagesからデータを取得して既存問題のカテゴリを更新します...\nしばらくお待ちください。`,
    ui.ButtonSet.OK
  );

  try {
    const response = UrlFetchApp.fetch(QUESTIONS_JSON_URL, {
      muteHttpExceptions: true,
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (response.getResponseCode() !== 200) {
      ui.alert('取得エラー', `HTTP ${response.getResponseCode()}`, ui.ButtonSet.OK);
      return;
    }

    const allQuestions = JSON.parse(response.getContentText());
    const deptQuestions = allQuestions.filter(q => q.department === department);

    // JSON側のlookup: question_id -> {category, subcategory, subtopic}
    const jsonLookup = {};
    deptQuestions.forEach(q => {
      jsonLookup[String(q.question_id)] = {
        category: q.category || '',
        subcategory: q.subcategory || '',
        subtopic: q.subtopic || '',
      };
    });

    const sheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      ui.alert('データなし', 'questionsシートが空です。', ui.ButtonSet.OK);
      return;
    }

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colIdx = {};
    headers.forEach((h, i) => { colIdx[h] = i + 1; }); // 1-indexed

    // 必要なカラムの列番号
    const idCol = colIdx['question_id'];
    const deptCol = colIdx['department'];
    const catCol = colIdx['category'];
    const subCol = colIdx['subcategory'];
    const topCol = colIdx['subtopic'];

    if (!idCol || !deptCol || !catCol || !subCol || !topCol) {
      ui.alert('エラー', '必要なカラムが見つかりません。', ui.ButtonSet.OK);
      return;
    }

    // 全行読み込み
    const allData = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    // 対象行を特定して更新
    let updatedCount = 0;
    const updates = []; // {row, cat, sub, top}

    allData.forEach((row, i) => {
      const rowDept = String(row[deptCol - 1] || '');
      if (rowDept !== department) return;

      const qid = String(row[idCol - 1] || '');
      const newData = jsonLookup[qid];
      if (!newData) return;

      const sheetRow = i + 2; // 1-indexed, +1 for header
      updates.push({ sheetRow, newData });
    });

    // バッチ更新（1行ずつ）
    const BATCH = 100;
    for (let i = 0; i < updates.length; i++) {
      const { sheetRow, newData } = updates[i];
      sheet.getRange(sheetRow, catCol).setValue(newData.category);
      sheet.getRange(sheetRow, subCol).setValue(newData.subcategory);
      sheet.getRange(sheetRow, topCol).setValue(newData.subtopic);
      updatedCount++;
      if (i % BATCH === BATCH - 1) Utilities.sleep(200);
    }

    ui.alert(
      '更新完了 ✅',
      `${label}の ${updatedCount}問 のカテゴリを更新しました。`,
      ui.ButtonSet.OK
    );

  } catch (e) {
    console.error('カテゴリ更新エラー:', e);
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

/** DH問題のカテゴリを更新 */
function updateDHCategories() {
  updateCategoriesFromGitHub_('dental_hyg', 'DH（歯科衛生士）');
}

/** CE問題のカテゴリを更新 */
function updateCECategories() {
  updateCategoriesFromGitHub_('clinical_eng', 'CE（臨床工学技士）');
}

/** CO問題のカテゴリを更新 */
function updateCOCategories() {
  updateCategoriesFromGitHub_('orthoptist', 'CO（視能訓練士）');
}

/** NRS問題のカテゴリを更新 */
function updateNRSCategories() {
  updateCategoriesFromGitHub_('nursing', 'NRS（看護師）');
}

/** 全学科のカテゴリを一括更新 */
function updateAllCategories() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    '全学科カテゴリ一括更新',
    '全学科（CE/CO/DH/NRS）のcategory/subcategory/subtopicを最新データで更新します。\n続けますか？',
    ui.ButtonSet.YES_NO
  );
  if (result !== ui.Button.YES) return;

  const depts = [
    { code: 'clinical_eng', label: 'CE（臨床工学技士）' },
    { code: 'orthoptist',   label: 'CO（視能訓練士）'   },
    { code: 'dental_hyg',   label: 'DH（歯科衛生士）'   },
    { code: 'nursing',      label: 'NRS（看護師）'       },
  ];

  // questions.json を1回だけ取得して使いまわす
  const response = UrlFetchApp.fetch(QUESTIONS_JSON_URL, {
    muteHttpExceptions: true,
    headers: { 'Cache-Control': 'no-cache' }
  });
  if (response.getResponseCode() !== 200) {
    ui.alert('取得エラー', `HTTP ${response.getResponseCode()}`, ui.ButtonSet.OK);
    return;
  }
  const allQuestions = JSON.parse(response.getContentText());

  const sheet = getOrCreateSheet(CONFIG.SHEETS.QUESTIONS);
  const lastRow = sheet.getLastRow();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const colIdx = {};
  headers.forEach((h, i) => { colIdx[h] = i + 1; });

  const idCol  = colIdx['question_id'];
  const deptCol= colIdx['department'];
  const catCol = colIdx['category'];
  const subCol = colIdx['subcategory'];
  const topCol = colIdx['subtopic'];

  const allData = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  let totalUpdated = 0;
  const summary = [];

  depts.forEach(({ code, label }) => {
    // この学科のJSONデータをlookup化
    const lookup = {};
    allQuestions.filter(q => q.department === code).forEach(q => {
      lookup[String(q.question_id)] = {
        category:    q.category    || '',
        subcategory: q.subcategory || '',
        subtopic:    q.subtopic    || '',
      };
    });

    let count = 0;
    allData.forEach((row, i) => {
      if (String(row[deptCol - 1] || '') !== code) return;
      const qid = String(row[idCol - 1] || '');
      const newData = lookup[qid];
      if (!newData) return;

      const sheetRow = i + 2;
      sheet.getRange(sheetRow, catCol).setValue(newData.category);
      sheet.getRange(sheetRow, subCol).setValue(newData.subcategory);
      sheet.getRange(sheetRow, topCol).setValue(newData.subtopic);
      count++;
      if (count % 100 === 0) Utilities.sleep(200);
    });

    summary.push(`${label}: ${count}問`);
    totalUpdated += count;
  });

  ui.alert(
    '全学科更新完了 ✅',
    `合計 ${totalUpdated}問 を更新しました。\n\n${summary.join('\n')}`,
    ui.ButtonSet.OK
  );
}

/**
 * AIダッシュボード手動更新
 */
function updateAllDashboards() {
  DashboardService.updateAll();
  SpreadsheetApp.getUi().alert(
    'AIダッシュボード更新完了',
    'すべての学生のAIコメントを更新しました。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
