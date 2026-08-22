/**
 * ゼロログ学生の疑似行を作るための純粋関数群。
 *
 * このファイルは GAS API（SpreadsheetApp / PropertiesService / Logger 等）を一切呼ばない。
 * Node の node:test からテストできるようにするため、末尾で条件付きに module.exports する。
 * Apps Script では module が未定義なのでこのブロックは無視される。
 *
 * 背景: DashboardService.updateAll() は「回答ログを持つ studentId」しか反復しないため、
 * 一度も問題を解いていない学生は ai_dashboard に1行も書かれず、教員ダッシュボードから不可視だった。
 */

/** 疑似行の student_id 接頭辞。v4 UUID は 16進数字とハイフンのみなので z/l/o/g/r は原理的に非衝突 */
var ZEROLOG_ID_PREFIX = 'zerolog-';

/** 1回の実行で作ってよい疑似行の上限（Stage 1 の対象24名に対する安全弁） */
var ZEROLOG_MAX_ROWS = 40;

/**
 * 表示・ID生成用の正規化。表記は保ったまま前後の空白だけ落とす。
 * String.prototype.trim は Unicode の空白（全角スペース U+3000 を含む）を除去する。
 */
function normalizeStudentNumber_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * 突合専用の正規化キー。名簿とログの表記ゆれを吸収する。
 *  - 全角英数字を半角化（名簿の IME 入力対策）
 *  - 大文字化（'x001' と 'X001' を同一視）
 *  - 全桁数字なら前ゼロを潰す（名簿がテキスト書式 '0091'、ログが数値 91 になるケース）
 * ID 生成には使わない（教員が名簿の表記で検索できなくなるため）。
 */
function normalizeMatchKey_(value) {
  var s = normalizeStudentNumber_(value).replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  }).toUpperCase();
  if (s && /^[0-9]+$/.test(s)) return String(Number(s));
  return s;
}

/**
 * 全ログ行を1パスで走査し、「ログに1度でも現れた学籍番号」の集合を作る。
 *
 * studentId ごとに1件へ畳んではならない: AnswerService.updateStudentNumber はメインの
 * student_logs しか書き換えず、アーカイブシートには旧学籍番号が残る。1件だけ採ると
 * どちらが残るかがシートのタブ順で変わり、実在の学習者にゴースト疑似行が出る。
 *
 * @param {Array<Object>} logs collectAllLogs() が返す形の配列
 * @return {Object} { 正規化キー: true }
 */
function buildStudentNumbersWithLogs_(logs) {
  var set = {};
  if (!logs || !logs.length) return set;
  for (var i = 0; i < logs.length; i++) {
    var log = logs[i] || {};
    if (!normalizeStudentNumber_(log.studentId)) continue;
    var key = normalizeMatchKey_(log.studentNumber);
    if (!key) continue;
    set[key] = true;
  }
  return set;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ZEROLOG_ID_PREFIX,
    ZEROLOG_MAX_ROWS,
    normalizeStudentNumber_,
    normalizeMatchKey_,
    buildStudentNumbersWithLogs_,
  };
}
