/**
 * ナースメモリア GASバックエンド 設定
 */

const CONFIG = {
  // Google Sheets 問題バンクのスプレッドシートID
  // URLの https://docs.google.com/spreadsheets/d/{ここがID}/edit 部分
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '',

  // Gemini API キー（AI Studio発行）
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '',

  // Gemini モデル
  GEMINI_MODEL: 'gemini-2.0-flash',

  // Gemini API エンドポイント
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/',

  // レート制限
  MAX_AI_CALLS_PER_STUDENT_DAY: 5,

  // シート名
  SHEETS: {
    QUESTIONS: 'questions',
    STUDENT_LOGS: 'student_logs',
    AI_GENERATED: 'ai_generated',
    AI_DASHBOARD: 'ai_dashboard',
  },

  // デフォルト取得件数
  DEFAULT_QUESTION_LIMIT: 20,
  MAX_QUESTION_LIMIT: 100,
};

/**
 * スプレッドシートを取得
 */
function getSpreadsheet() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/**
 * シートを取得（存在しなければ作成）
 */
function getOrCreateSheet(sheetName) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // ヘッダー行を設定
    const headers = getSheetHeaders(sheetName);
    if (headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sheet;
}

/**
 * シートのヘッダー定義
 */
function getSheetHeaders(sheetName) {
  switch (sheetName) {
    case CONFIG.SHEETS.QUESTIONS:
      return [
        'question_id', 'department', 'exam_year', 'exam_number',
        'category', 'subcategory', 'subtopic', 'difficulty',
        'question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d', 'choice_e',
        'correct_answer', 'explanation', 'has_image', 'image_url', 'is_multi_select',
        'source', 'created_at'
      ];
    case CONFIG.SHEETS.STUDENT_LOGS:
      return [
        'log_id', 'student_id', 'department', 'grade',
        'question_id', 'selected_answer', 'is_correct',
        'response_time_ms', 'attempt_count', 'timestamp'
      ];
    case CONFIG.SHEETS.AI_GENERATED:
      return [
        'gen_id', 'original_question_id', 'error_type',
        'question_text', 'choice_a', 'choice_b', 'choice_c', 'choice_d',
        'correct_answer', 'explanation', 'difficulty', 'created_at'
      ];
    default:
      return [];
  }
}
