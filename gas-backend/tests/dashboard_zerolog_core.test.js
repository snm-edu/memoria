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

// ---------------------------------------------------------------------------
// selectZeroLogRosterRecords_
// ---------------------------------------------------------------------------

/** テスト用の名簿レコードを作るヘルパー（parseRosterValues_ の出力と同じ形） */
function rec(studentNumber, reportGroup, extra) {
  return Object.assign({
    studentNumber: String(studentNumber === null || studentNumber === undefined ? '' : studentNumber).trim(),
    studentNumberRaw: String(studentNumber === null || studentNumber === undefined ? '' : studentNumber),
    studentName: '名簿氏名',
    department: 'clinical_eng',
    grade: '4',
    reportGroup: reportGroup,
  }, extra || {});
}

test('名簿0件・null なら選別結果も0件でカウンタは全て0', () => {
  const got = core.selectZeroLogRosterRecords_([], { X001: true });
  assert.deepStrictEqual(got.records, []);
  assert.strictEqual(got.groupRows, 0);
  assert.strictEqual(got.withLogsExcluded, 0);
  assert.strictEqual(got.booleanGroupRows, 0);
  assert.deepStrictEqual(got.duplicateNumbers, []);
  assert.deepStrictEqual(core.selectZeroLogRosterRecords_(null, {}).records, []);
});

test('report_groupが空欄の行は対象外（Stage 1のスコープ）', () => {
  const roster = [rec('X001', ''), rec('X002', '2026既卒')];
  const got = core.selectZeroLogRosterRecords_(roster, {});
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['X002']);
  assert.strictEqual(got.groupRows, 1);
});

test('report_groupの値は問わない（コホート名をハードコードしない）', () => {
  const roster = [rec('X001', '2027既卒'), rec('X002', '2026既卒')];
  const got = core.selectZeroLogRosterRecords_(roster, {});
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['X001', 'X002']);
});

test('report_groupが空白文字だけの行は空欄とみなして対象外', () => {
  const got = core.selectZeroLogRosterRecords_([rec('X001', '   ')], {});
  assert.deepStrictEqual(got.records, []);
  assert.strictEqual(got.groupRows, 0);
});

test('report_groupが boolean false の行は対象外（チェックボックス列への変更対策）', () => {
  const got = core.selectZeroLogRosterRecords_([rec('X001', false)], {});
  assert.deepStrictEqual(got.records, []);
  assert.strictEqual(got.booleanGroupRows, 1);
  assert.strictEqual(got.groupRows, 0);
});

test('report_groupが boolean true の行も対象外（コホート名として扱えないため）', () => {
  const got = core.selectZeroLogRosterRecords_([rec('X001', true)], {});
  assert.deepStrictEqual(got.records, []);
  assert.strictEqual(got.booleanGroupRows, 1);
});

test('report_groupが "-" の行は対象になる（文字列ブロックリストは持たない・上限ブレーカーで受ける）', () => {
  const got = core.selectZeroLogRosterRecords_([rec('X001', '-')], {});
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['X001']);
});

test('report_groupが数値でも対象になる', () => {
  const got = core.selectZeroLogRosterRecords_([rec('X001', 2027)], {});
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['X001']);
});

test('report_groupがDateでも対象になる', () => {
  const got = core.selectZeroLogRosterRecords_([rec('X001', new Date('2026-03-31T00:00:00Z'))], {});
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['X001']);
});

test('ログを持つ学籍番号は対象外', () => {
  const roster = [rec('X001', '2026既卒'), rec('X002', '2026既卒')];
  const got = core.selectZeroLogRosterRecords_(roster, { X001: true });
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['X002']);
  assert.strictEqual(got.withLogsExcluded, 1);
});

test('student_numberが空・空白の名簿行は疑似行を作らない（防御。通常は parse 側で落ちる）', () => {
  const roster = [rec('', '2026既卒'), rec('   ', '2026既卒'), rec('X002', '2026既卒')];
  const got = core.selectZeroLogRosterRecords_(roster, {});
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['X002']);
});

test('名簿に同一student_numberの重複行があっても1件に絞り、重複を記録する（先勝ち）', () => {
  const roster = [
    rec('X001', '2026既卒', { studentName: '先の行' }),
    rec('X001', '2026既卒', { studentName: '後の行' }),
  ];
  const got = core.selectZeroLogRosterRecords_(roster, {});
  assert.strictEqual(got.records.length, 1);
  assert.strictEqual(got.records[0].studentName, '先の行');
  assert.deepStrictEqual(got.duplicateNumbers, ['X001']);
});

test('ログ0件（集合が空）なら report_group を持つ全員が対象になる', () => {
  const roster = [rec('X001', '2026既卒'), rec('X002', '2026既卒')];
  assert.strictEqual(core.selectZeroLogRosterRecords_(roster, {}).records.length, 2);
});

test('名簿がテキスト書式の前ゼロでもログ側の数値と突合できる', () => {
  const roster = [rec('0091', '2026既卒'), rec('0092', '2026既卒')];
  const got = core.selectZeroLogRosterRecords_(roster, { 91: true });
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['0092']);
});

test('名簿が全角数字でもログ側の半角と突合できる', () => {
  const roster = [rec('９００１', '2026既卒'), rec('9002', '2026既卒')];
  const got = core.selectZeroLogRosterRecords_(roster, { 9001: true });
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), ['9002']);
});

test('学籍番号が数値型のレコードでも突合できる（防御。通常は parse 側で文字列化される）', () => {
  const roster = [
    { studentNumber: 9001, studentNumberRaw: '9001', studentName: 'A', department: 'nursing', grade: 4, reportGroup: '2026既卒' },
    { studentNumber: 9002, studentNumberRaw: '9002', studentName: 'B', department: 'nursing', grade: 4, reportGroup: '2026既卒' },
  ];
  const got = core.selectZeroLogRosterRecords_(roster, { 9001: true });
  assert.deepStrictEqual(got.records.map((r) => r.studentNumber), [9002]);
});

test('groupRows は report_group が非空の行数（対象外になった行も含む）を数える', () => {
  const roster = [rec('X001', '2026既卒'), rec('X002', '2026既卒'), rec('X003', '')];
  const got = core.selectZeroLogRosterRecords_(roster, { X001: true });
  assert.strictEqual(got.groupRows, 2);
  assert.strictEqual(got.records.length, 1);
});

// ---------------------------------------------------------------------------
// toGradeNumber_ / buildZeroLogDashboardRow_
// ---------------------------------------------------------------------------

const AT = '2026-08-21T19:00:00.000Z';

test('16要素の配列を返し、各列が仕様どおりの型・値になる', () => {
  const row = core.buildZeroLogDashboardRow_(
    { studentNumber: 'X001', studentNumberRaw: 'X001', studentName: '名簿氏名', department: 'clinical_eng', grade: '4', reportGroup: '2026既卒' },
    AT
  );
  assert.strictEqual(row.length, 16);
  assert.strictEqual(row[0], 'zerolog-X001'); // student_id
  assert.strictEqual(row[1], 'X001');         // student_number
  assert.strictEqual(row[2], '名簿氏名');      // student_name
  assert.strictEqual(row[3], 'clinical_eng'); // department
  assert.strictEqual(row[4], 4);              // grade（数値）
  assert.strictEqual(row[5], 0);              // total_questions
  // correct_rate は数値0ではなく空文字。0 を書くと Looker の平均正答率の母数に
  // 0% として混ざる（実測で 24.9% → 16.5% まで下がった）。
  // 「未着手は空値」は updateCategoryStats:308 が既に採っている規約。
  assert.strictEqual(row[6], '');             // correct_rate（空値。0 にしないこと）
  assert.strictEqual(row[7], 0);              // streak_days
  assert.strictEqual(row[8], '[]');           // weak_categories
  assert.strictEqual(row[9], '[]');           // strong_categories
  assert.strictEqual(row[10], '[]');          // weekly_trend
  assert.strictEqual(row[11], '[]');          // error_patterns
  assert.strictEqual(row[12], '');            // ai_comment（Geminiを呼ばない）
  assert.strictEqual(row[13], '');            // last_study_date
  assert.strictEqual(row[14], AT);            // updated_at
  assert.strictEqual(row[15], core.ZEROLOG_TEACHER_COMMENT); // teacher_comment（固定文言）
});

test('gradeが空欄なら0にする', () => {
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001', grade: '' }, AT)[4], 0);
});

test('gradeが非数値文字列なら0にする（列がTEXT型に再分類されるのを防ぐ）', () => {
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001', grade: '４' }, AT)[4], 0);
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001', grade: '4年' }, AT)[4], 0);
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001', grade: 'abc' }, AT)[4], 0);
});

test('gradeが数値型ならそのまま数値になる', () => {
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001', grade: 3 }, AT)[4], 3);
});

test('gradeが数値文字列なら数値化する', () => {
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001', grade: '4' }, AT)[4], 4);
});

test('gradeが未定義・nullでも0にする', () => {
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001' }, AT)[4], 0);
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001', grade: null }, AT)[4], 0);
});

test('gradeが0ならそのまま0', () => {
  assert.strictEqual(core.toGradeNumber_(0), 0);
});

test('gradeにDateが入っていても0にする（Number(Date)は巨大な有限値になるため）', () => {
  assert.strictEqual(core.toGradeNumber_(new Date('2026-08-21T00:00:00Z')), 0);
});

test('gradeにbooleanが入っていても0にする', () => {
  assert.strictEqual(core.toGradeNumber_(true), 0);
  assert.strictEqual(core.toGradeNumber_(false), 0);
});

test('gradeが範囲外の数値なら0にする', () => {
  assert.strictEqual(core.toGradeNumber_(10), 0);
  assert.strictEqual(core.toGradeNumber_(-1), 0);
  assert.strictEqual(core.toGradeNumber_(2.5), 0);
});

test('student_nameが未定義なら student_number にフォールバックする（コードベースの既存規約）', () => {
  const row = core.buildZeroLogDashboardRow_({ studentNumber: 'X001' }, AT);
  assert.strictEqual(row[2], 'X001');
});

test('student_nameが空文字でも student_number にフォールバックする', () => {
  const row = core.buildZeroLogDashboardRow_({ studentNumber: 'X001', studentName: '' }, AT);
  assert.strictEqual(row[2], 'X001');
});

test('departmentが未定義なら空文字にする（存在しない学科名を捏造しない）', () => {
  assert.strictEqual(core.buildZeroLogDashboardRow_({ studentNumber: 'X001' }, AT)[3], '');
});

test('学籍番号が数値型でも student_id は文字列連結になる', () => {
  const row = core.buildZeroLogDashboardRow_({ studentNumber: 9001, grade: 4 }, AT);
  assert.strictEqual(row[0], 'zerolog-9001');
  assert.strictEqual(row[1], '9001');
});

test('student_id は名簿の表記をそのまま使う（前ゼロを潰さない）', () => {
  const row = core.buildZeroLogDashboardRow_({ studentNumber: '0091' }, AT);
  assert.strictEqual(row[0], 'zerolog-0091');
  assert.strictEqual(row[1], '0091');
});

test('疑似キーの接頭辞はv4 UUIDと衝突しない文字を含む', () => {
  // v4 UUID は 16進数字とハイフンのみ。z/l/o/g/r は出現しない
  assert.match(core.ZEROLOG_ID_PREFIX, /[zlogr]/);
  assert.doesNotMatch(core.ZEROLOG_ID_PREFIX, /^[0-9a-f-]+$/);
});

// ---------------------------------------------------------------------------
// findZeroLogRowNumbersDesc_ / groupContiguousDesc_
// ---------------------------------------------------------------------------

const DASH_HEADERS = [
  'student_id', 'student_number', 'student_name', 'department', 'grade',
  'total_questions', 'correct_rate', 'streak_days',
  'weak_categories', 'strong_categories', 'weekly_trend',
  'error_patterns', 'ai_comment', 'last_study_date', 'updated_at', 'teacher_comment',
];

/** student_id だけを持つダッシュボード行を作るヘルパー */
function dashRow(studentId) {
  const row = new Array(DASH_HEADERS.length).fill('');
  row[0] = studentId;
  return row;
}

test('疑似行の行番号を1始まりで、降順に返す', () => {
  const values = [
    DASH_HEADERS,
    dashRow('11111111-2222-4333-8444-555555555555'), // 2行目: 実UUID
    dashRow('zerolog-X001'),                          // 3行目
    dashRow('99999999-2222-4333-8444-555555555555'), // 4行目
    dashRow('zerolog-X002'),                          // 5行目
  ];
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_(values), [5, 3]);
});

test('疑似行が無ければ空配列', () => {
  const values = [DASH_HEADERS, dashRow('11111111-2222-4333-8444-555555555555')];
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_(values), []);
});

test('シートが空・ヘッダーのみ・null なら空配列', () => {
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_([]), []);
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_([DASH_HEADERS]), []);
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_(null), []);
});

test('student_id列が無いシートでは空配列（誤削除を防ぐ）', () => {
  const values = [['foo', 'bar'], ['zerolog-X001', 'x']];
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_(values), []);
});

test('接頭辞が途中に出てくるだけの行は対象外（前方一致のみ）', () => {
  const values = [DASH_HEADERS, dashRow('abc-zerolog-X001')];
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_(values), []);
});

test('student_idが空の行は無視する', () => {
  const values = [DASH_HEADERS, dashRow(''), dashRow('zerolog-X001')];
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_(values), [3]);
});

test('student_idが数値セルでも落ちない', () => {
  const values = [DASH_HEADERS, dashRow(9001), dashRow('zerolog-X001')];
  assert.deepStrictEqual(core.findZeroLogRowNumbersDesc_(values), [3]);
});

test('groupContiguousDesc_: 空配列・null なら空配列', () => {
  assert.deepStrictEqual(core.groupContiguousDesc_([]), []);
  assert.deepStrictEqual(core.groupContiguousDesc_(null), []);
});

test('groupContiguousDesc_: 単独行は count 1 のブロックになる', () => {
  assert.deepStrictEqual(core.groupContiguousDesc_([4]), [{ start: 4, count: 1 }]);
});

test('groupContiguousDesc_: 連続しない行はブロックを分ける（開始行の降順）', () => {
  assert.deepStrictEqual(core.groupContiguousDesc_([5, 3]), [
    { start: 5, count: 1 },
    { start: 3, count: 1 },
  ]);
});

test('groupContiguousDesc_: 連続する行を1ブロックにまとめる', () => {
  assert.deepStrictEqual(core.groupContiguousDesc_([12, 11, 10]), [{ start: 10, count: 3 }]);
});

test('groupContiguousDesc_: 連続と単独が混在しても開始行の降順で返す', () => {
  assert.deepStrictEqual(core.groupContiguousDesc_([9, 8, 7, 5, 3, 2]), [
    { start: 7, count: 3 },
    { start: 5, count: 1 },
    { start: 2, count: 2 },
  ]);
});
