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

/**
 * 名簿 students シートの getValues() 結果をレコード配列に変換する。
 *
 * 期待する列（A〜E）: student_number / student_name / department / grade / report_group
 * department は canonical 英語id（nursing / clinical_eng / orthoptist / dental_hyg）で
 * ai_dashboard 側と同一語彙のため変換しない。
 * grade は生値のまま保持する（数値化は buildZeroLogDashboardRow_ の責務）。
 * studentNumberRaw は trim 前の生値（buildNameMapFromRoster_ が既存キーを維持するために使う）。
 *
 * @param {Array<Array>} values 1行目がヘッダーの2次元配列
 * @return {Array<Object>}
 */
function parseRosterValues_(values) {
  var records = [];
  if (!values || values.length <= 1) return records;

  var headers = values[0] || [];
  var idx = {};
  for (var h = 0; h < headers.length; h++) {
    idx[String(headers[h]).trim()] = h;
  }
  if (idx['student_number'] === undefined) return records;

  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var rawCell = row[idx['student_number']];
    var num = normalizeStudentNumber_(rawCell);
    if (!num) continue;
    records.push({
      studentNumber: num,
      studentNumberRaw: rawCell === null || rawCell === undefined ? '' : String(rawCell),
      studentName: idx['student_name'] !== undefined ? (row[idx['student_name']] || '') : '',
      department: idx['department'] !== undefined ? (row[idx['department']] || '') : '',
      grade: idx['grade'] !== undefined ? (row[idx['grade']] === undefined ? '' : row[idx['grade']]) : '',
      reportGroup: idx['report_group'] !== undefined
        ? (row[idx['report_group']] === undefined ? '' : row[idx['report_group']])
        : ''
    });
  }
  return records;
}

/**
 * 名簿レコードから「学籍番号 → 氏名」のマップを作る。
 *
 * 現行の getStudentNameMap() は名簿セルを trim せずキーにしていた（DashboardService.gs:492, :508）。
 * 引く側（updateAll:149 など）はログの生値で引くため、キーを trim だけにすると
 * 「名簿もログも末尾スペース付き」の学生の氏名が引けなくなる。
 * そこで生キーと trim 済みキーの両方を登録し、既存の一致を必ず維持する。
 * 重複行が後勝ちになる点も現行実装と同じ。
 *
 * @param {Array<Object>} rosterRecords parseRosterValues_() の戻り値
 * @return {Object} { 学籍番号: 氏名 }
 */
function buildNameMapFromRoster_(rosterRecords) {
  var nameMap = {};
  if (!rosterRecords || !rosterRecords.length) return nameMap;
  for (var i = 0; i < rosterRecords.length; i++) {
    var r = rosterRecords[i] || {};
    var name = r.studentName === undefined || r.studentName === null ? '' : r.studentName;
    if (r.studentNumberRaw) nameMap[r.studentNumberRaw] = name;
    if (r.studentNumber) nameMap[r.studentNumber] = name;
  }
  return nameMap;
}

/**
 * 疑似行を作るべき名簿レコードを選別する。
 *
 * 条件（Stage 1）:
 *   1. report_group が boolean でない（チェックボックス列に変更されたとき全名簿が対象化するのを防ぐ）
 *   2. report_group が空でない（＝レポート対象コホートに属する）
 *      ※ コホート名の文字列はハードコードしない。将来コホート名が変わったときに
 *        フィルタが無言で0件になるのを防ぐため
 *   3. student_number が空でない（空だと疑似キーが全員同一になり上書き事故になる）
 *   4. その student_number がログ側の集合に存在しない（突合は正規化キーで行う）
 *   5. 同一 student_number の重複行は先勝ちで1件に絞る（重複は記録して呼び出し側でログに出す）
 *
 * @param {Array<Object>} rosterRecords parseRosterValues_() が返す形の配列
 * @param {Object} studentNumbersWithLogs buildStudentNumbersWithLogs_() の戻り値
 * @return {{records: Array<Object>, groupRows: number, withLogsExcluded: number,
 *           booleanGroupRows: number, duplicateNumbers: Array<string>}}
 */
function selectZeroLogRosterRecords_(rosterRecords, studentNumbersWithLogs) {
  var result = {
    records: [],
    groupRows: 0,
    withLogsExcluded: 0,
    booleanGroupRows: 0,
    duplicateNumbers: []
  };
  if (!rosterRecords || !rosterRecords.length) return result;
  var withLogs = studentNumbersWithLogs || {};
  var seen = {};

  for (var i = 0; i < rosterRecords.length; i++) {
    var record = rosterRecords[i] || {};

    if (typeof record.reportGroup === 'boolean') {
      result.booleanGroupRows++;
      continue;
    }
    var group = normalizeStudentNumber_(record.reportGroup);
    if (!group) continue;
    result.groupRows++;

    var num = normalizeStudentNumber_(record.studentNumber);
    if (!num) continue;

    var key = normalizeMatchKey_(record.studentNumber);
    if (withLogs[key]) {
      result.withLogsExcluded++;
      continue;
    }
    if (seen[key]) {
      result.duplicateNumbers.push(num);
      continue;
    }

    seen[key] = true;
    result.records.push(record);
  }
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ZEROLOG_ID_PREFIX,
    ZEROLOG_MAX_ROWS,
    normalizeStudentNumber_,
    normalizeMatchKey_,
    buildStudentNumbersWithLogs_,
    parseRosterValues_,
    buildNameMapFromRoster_,
    selectZeroLogRosterRecords_,
  };
}
