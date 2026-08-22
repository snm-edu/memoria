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
