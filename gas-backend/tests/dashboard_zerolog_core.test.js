// Run: node --test tests/dashboard_zerolog_core.test.js
// （gas-backend/ ディレクトリから実行する。ディレクトリ自体を渡すと .gs を実行しようとして失敗するので、
//   必ずファイルを指定すること）
const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../src/DashboardZeroLogCore.gs');

// ---------------------------------------------------------------------------
// normalizeStudentNumber_ / normalizeMatchKey_
// ---------------------------------------------------------------------------

test('normalizeStudentNumber_ は表記を保ったまま trim だけする（student_id 生成用）', () => {
  assert.strictEqual(core.normalizeStudentNumber_('  X001 '), 'X001');
  assert.strictEqual(core.normalizeStudentNumber_('　0091　'), '0091'); // 全角空白も trim される
  assert.strictEqual(core.normalizeStudentNumber_(9001), '9001');
  assert.strictEqual(core.normalizeStudentNumber_(null), '');
  assert.strictEqual(core.normalizeStudentNumber_(undefined), '');
});

test('normalizeMatchKey_ は全角英数字を半角化し大文字化する', () => {
  assert.strictEqual(core.normalizeMatchKey_('９００１'), '9001');
  assert.strictEqual(core.normalizeMatchKey_('x001'), 'X001');
  assert.strictEqual(core.normalizeMatchKey_('Ｘ００１'), 'X001');
});

test('normalizeMatchKey_ は全桁数字なら前ゼロを潰す（テキスト書式と数値セルの突合）', () => {
  assert.strictEqual(core.normalizeMatchKey_('0091'), '91');
  assert.strictEqual(core.normalizeMatchKey_(91), '91');
  assert.strictEqual(core.normalizeMatchKey_('000'), '0');
});

test('normalizeMatchKey_ は数字以外を含む値の前ゼロは潰さない', () => {
  assert.strictEqual(core.normalizeMatchKey_('0abc9'), '0ABC9');
  assert.strictEqual(core.normalizeMatchKey_(''), '');
});

// ---------------------------------------------------------------------------
// buildStudentNumbersWithLogs_
// ---------------------------------------------------------------------------

test('ログ0件なら空の集合を返す', () => {
  assert.deepStrictEqual(core.buildStudentNumbersWithLogs_([]), {});
  assert.deepStrictEqual(core.buildStudentNumbersWithLogs_(null), {});
});

test('同一studentIdのログで空と非空が混在しても非空の学籍番号を拾う（末尾が空でも拾う）', () => {
  const logs = [
    { studentId: 'uuid-a', studentNumber: '' },   // 単問経路（学籍番号なし）
    { studentId: 'uuid-a', studentNumber: '' },
    { studentId: 'uuid-a', studentNumber: 'X001' }, // バッチ同期経路
    { studentId: 'uuid-a', studentNumber: '' },   // 最後の行は再び空
  ];
  assert.deepStrictEqual(core.buildStudentNumbersWithLogs_(logs), { X001: true });
});

test('同一studentIdに異なる学籍番号が2つあれば両方を集合に入れる（アーカイブの旧番号対策）', () => {
  const logs = [
    { studentId: 'uuid-a', studentNumber: 'X001' }, // アーカイブに残った旧番号
    { studentId: 'uuid-a', studentNumber: 'X900' }, // 改番後の新番号
  ];
  assert.deepStrictEqual(core.buildStudentNumbersWithLogs_(logs), { X001: true, X900: true });
});

test('全ログ行の学籍番号が空なら集合は空（＝ゼロログ扱いになる既知の穴）', () => {
  const logs = [
    { studentId: 'uuid-b', studentNumber: '' },
    { studentId: 'uuid-b', studentNumber: '' },
  ];
  assert.deepStrictEqual(core.buildStudentNumbersWithLogs_(logs), {});
});

test('同じ学籍番号に複数のstudentId(UUID)がぶら下がっても集合は1件にまとまる', () => {
  const logs = [
    { studentId: 'uuid-c1', studentNumber: 'X002' },
    { studentId: 'uuid-c2', studentNumber: 'X002' },
  ];
  assert.deepStrictEqual(core.buildStudentNumbersWithLogs_(logs), { X002: true });
});

test('studentIdが空のログ行は無視する', () => {
  const logs = [{ studentId: '', studentNumber: 'X003' }];
  assert.deepStrictEqual(core.buildStudentNumbersWithLogs_(logs), {});
});

test('学籍番号が数値型・前ゼロ・全角でも同じキーに正規化される', () => {
  const logs = [
    { studentId: 'uuid-d', studentNumber: 91 },
    { studentId: 'uuid-e', studentNumber: '  X004 ' },
    { studentId: 'uuid-f', studentNumber: '９００２' },
  ];
  assert.deepStrictEqual(core.buildStudentNumbersWithLogs_(logs), {
    91: true, X004: true, 9002: true,
  });
});

// ---------------------------------------------------------------------------
// parseRosterValues_
// ---------------------------------------------------------------------------

const ROSTER_HEADERS = ['student_number', 'student_name', 'department', 'grade', 'report_group'];

test('ヘッダー名でインデックスを引いてレコード化する', () => {
  const values = [
    ROSTER_HEADERS,
    ['X001', '氏名A', 'clinical_eng', 4, '2026既卒'],
    ['X002', '氏名B', 'nursing', 1, ''],
  ];
  assert.deepStrictEqual(core.parseRosterValues_(values), [
    { studentNumber: 'X001', studentNumberRaw: 'X001', studentName: '氏名A', department: 'clinical_eng', grade: 4, reportGroup: '2026既卒' },
    { studentNumber: 'X002', studentNumberRaw: 'X002', studentName: '氏名B', department: 'nursing', grade: 1, reportGroup: '' },
  ]);
});

test('空配列・ヘッダー行のみ・null なら空配列を返す', () => {
  assert.deepStrictEqual(core.parseRosterValues_([]), []);
  assert.deepStrictEqual(core.parseRosterValues_([ROSTER_HEADERS]), []);
  assert.deepStrictEqual(core.parseRosterValues_(null), []);
});

test('report_group列が存在しない名簿でも落ちず、reportGroupは空文字になる', () => {
  const values = [
    ['student_number', 'student_name', 'department', 'grade'],
    ['X001', '氏名A', 'nursing', 2],
  ];
  assert.deepStrictEqual(core.parseRosterValues_(values), [
    { studentNumber: 'X001', studentNumberRaw: 'X001', studentName: '氏名A', department: 'nursing', grade: 2, reportGroup: '' },
  ]);
});

test('student_number列が存在しない名簿では空配列を返す（突合キーが無いため）', () => {
  const values = [['student_name', 'grade'], ['氏名A', 2]];
  assert.deepStrictEqual(core.parseRosterValues_(values), []);
});

test('学籍番号が空・空白のみの行はスキップする', () => {
  const values = [
    ROSTER_HEADERS,
    ['', '氏名A', 'nursing', 1, ''],
    ['   ', '氏名B', 'nursing', 1, ''],
    ['X002', '氏名C', 'nursing', 1, ''],
  ];
  assert.deepStrictEqual(core.parseRosterValues_(values).map((r) => r.studentNumber), ['X002']);
});

test('grade空欄はそのまま空文字で保持する（数値化は行組み立て側の責務）', () => {
  const values = [ROSTER_HEADERS, ['X001', '氏名A', 'nursing', '', '2026既卒']];
  assert.strictEqual(core.parseRosterValues_(values)[0].grade, '');
});

test('学籍番号は文字列に正規化され、生値も保持される（数値セル対策）', () => {
  const values = [ROSTER_HEADERS, [9001, '氏名A', 'nursing', 4, '2026既卒']];
  const rec0 = core.parseRosterValues_(values)[0];
  assert.strictEqual(rec0.studentNumber, '9001');
  assert.strictEqual(rec0.studentNumberRaw, '9001');
});

test('学籍番号に前後空白があると studentNumber は trim 済み・Raw は生値になる', () => {
  const values = [ROSTER_HEADERS, ['X001 ', '氏名A', 'nursing', 4, '2026既卒']];
  const rec0 = core.parseRosterValues_(values)[0];
  assert.strictEqual(rec0.studentNumber, 'X001');
  assert.strictEqual(rec0.studentNumberRaw, 'X001 ');
});

test('ヘッダーに前後空白があっても列を引ける', () => {
  const values = [
    [' student_number ', 'student_name ', ' department', 'grade', 'report_group'],
    ['X001', '氏名A', 'nursing', 3, '2026既卒'],
  ];
  assert.deepStrictEqual(core.parseRosterValues_(values)[0], {
    studentNumber: 'X001', studentNumberRaw: 'X001', studentName: '氏名A',
    department: 'nursing', grade: 3, reportGroup: '2026既卒',
  });
});

test('列順が入れ替わっていてもヘッダー名で引く', () => {
  const values = [
    ['report_group', 'grade', 'department', 'student_name', 'student_number'],
    ['2026既卒', 4, 'orthoptist', '氏名A', 'X001'],
  ];
  assert.deepStrictEqual(core.parseRosterValues_(values)[0], {
    studentNumber: 'X001', studentNumberRaw: 'X001', studentName: '氏名A',
    department: 'orthoptist', grade: 4, reportGroup: '2026既卒',
  });
});

// ---------------------------------------------------------------------------
// buildNameMapFromRoster_
// ---------------------------------------------------------------------------

test('学籍番号→氏名のマップを返す', () => {
  const roster = core.parseRosterValues_([
    ROSTER_HEADERS,
    ['X001', '氏名A', 'nursing', 1, ''],
    ['X002', '氏名B', 'nursing', 1, ''],
  ]);
  assert.deepStrictEqual(core.buildNameMapFromRoster_(roster), { X001: '氏名A', X002: '氏名B' });
});

test('空配列・null なら空オブジェクト', () => {
  assert.deepStrictEqual(core.buildNameMapFromRoster_([]), {});
  assert.deepStrictEqual(core.buildNameMapFromRoster_(null), {});
});

test('前後空白のある学籍番号は生キーと trim キーの両方を登録する（既存挙動の後方互換）', () => {
  const roster = core.parseRosterValues_([ROSTER_HEADERS, ['X001 ', '氏名A', 'nursing', 1, '']]);
  const nameMap = core.buildNameMapFromRoster_(roster);
  assert.strictEqual(nameMap['X001 '], '氏名A'); // 現行実装が作っていたキー
  assert.strictEqual(nameMap['X001'], '氏名A');  // 追加されるキー
});

test('氏名が空の行でもキーは登録される（現行実装と同じ）', () => {
  const roster = core.parseRosterValues_([ROSTER_HEADERS, ['X001', '', 'nursing', 1, '']]);
  assert.deepStrictEqual(core.buildNameMapFromRoster_(roster), { X001: '' });
});

test('同一学籍番号の重複行は後勝ちで上書きされる（現行実装と同じ）', () => {
  const roster = core.parseRosterValues_([
    ROSTER_HEADERS,
    ['X001', '先の行', 'nursing', 1, ''],
    ['X001', '後の行', 'nursing', 1, ''],
  ]);
  assert.strictEqual(core.buildNameMapFromRoster_(roster)['X001'], '後の行');
});
