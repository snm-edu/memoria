# 教員ダッシュボード ゼロログ学生の可視化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 回答ログが1件も無い既卒生（`students` シートの `report_group` が非空の行）を `ai_dashboard` に `total_questions=0` の疑似行として毎日書き出し、教員ダッシュボードの「要注意学生リスト」から不可視だった学生を可視化する。

**Architecture:** `DashboardService.updateAll()` は「回答ログを持つ studentId」しか反復しないため、ゼロログ学生はシートに1行も書かれない。これを直すため、通常ループと `updateCategoryStats()` が完了した**後**に、名簿（`STUDENT_LIST_ID` の `students` シート）を正本として `student_id = 'zerolog-{student_number}'` の疑似行を**毎回ゼロから作り直す**ブロックを追加する。判定・整形・行番号探索は GAS API を呼ばない純粋関数として新ファイル `DashboardZeroLogCore.gs` に切り出し、Node の `node:test` でテストする。`category_stats` は変更しない。

**Tech Stack:** Google Apps Script (V8) / Google Sheets / Node.js `node:test` + `assert` / clasp / Looker Studio

---

## 前提（着手前に必ず読むこと）

- 本リポジトリは **Public**。学生の実名・スプレッドシートID・Script ID・**実在の学籍番号**を、コミットするファイル・コミットメッセージ・PR本文に書かない。テストのフィクスチャは架空値（`X001` / `9001` / `0091` 等）だけを使う。実在するテスト行の番号（4桁の連番）や共用シード番号は、たとえダミー行でも書かない。
- 本番 Apps Script は問題バンクへのコンテナバインド型。**本番にだけ存在するファイルが2つある（`ParentReport.js` / `VideoDemo.js`）。素の `clasp push` はこの2つを消す**。Task 13 の手順を必ず守ること。
- 日次トリガー `runDashboardUpdate` は Head 駆動。**コード保存（または push）だけで翌朝から効く。Webアプリのデプロイ版再発行は不要。**
- 接続情報（Script ID・スプレッドシートID・clasp の置き場所・アカウント）は**プロジェクトメモリ `project_memoria_gas_backend_deploy` を参照**すること。この計画書・README には書かない。
- 環境の実測値（2026-08-21）: `node --version` = **v25.1.0**。`node --check <file>.gs` は**拡張子解決で必ず失敗する**（`ERR_UNKNOWN_FILE_EXTENSION`）。本計画では構文チェックを **`node --check < <file>.gs`（stdin 経由）** で行う。stdin 経由なら exit 0 / 構文エラー時 exit 1 になることを実測済み。

---

## 設計判断（確定事項と、レビューを受けて変更した点）

| # | 判断 | 状態 |
|---|---|---|
| 1 | `ai_dashboard` にのみ疑似行を追加する。`category_stats` は変更しない | 確定どおり |
| 2 | 疑似キーは `zerolog-{student_number}`。`student_number` が空の名簿行は疑似行を作らない。実UUIDフォールバックは書かない | 確定どおり |
| 3 | 「ログを持つか」の判定は**全ログ行**を走査して行う | **実装方式を変更**（下記） |
| 4 | 疑似行は毎回ゼロから作り直す | 確定どおり。ただし**処理順を変更**（下記） |
| 5 | ゼロログ行に Gemini API を呼ばない | 確定どおり |
| 6 | Stage 1 は `report_group` が非空の行のみ。コホート名をハードコードしない | 確定どおり＋**上限ブレーカーを追加** |
| 7 | 純粋関数を切り出して `node:test` でテストする | 確定どおり |

**判断3の実装方式変更（レビュー指摘 requirements-F5 / failure-modes-S3 を採用）**
確定事項の文言は「パス1: studentId ごとに全ログ行を走査して非空の `student_number` を1つ拾う → パス2: その集合を作る」だった。しかし studentId ごとに1件へ畳むと、**1つの studentId に複数の学籍番号がぶら下がる場合に2件目以降が落ちる**。実際に起こり得る: `AnswerService.updateStudentNumber`（`AnswerService.gs:105-152`）はメインの `student_logs` しか書き換えず、アーカイブシート（`student_logs_YYYY_MM`）には旧番号が残る。`collectAllLogs`（`DashboardService.gs:521-554`）はシートを**タブ順**で走査するため、どちらの番号が「先勝ち」になるかがタブの並び順で変わる。名簿が新番号なら実在の学習者にゴースト疑似行が出る。
→ **中間マップを廃止し、全ログ行から非空の学籍番号を1パスで集合化する。** これは確定事項の目的（「1件だけ見るのは禁止」）を弱めるのではなく強める変更であり、コード量も減る。禁止されている `logs[0]` / `logs[logs.length-1]` の参照は一切しない。

**判断4の処理順変更（レビュー指摘 failure-modes-S1 / S7 を採用）**
確定事項は「(b) 読み直し → (c) 削除 → (d) 追記」だった。この順だと、名簿の一時的な取得失敗（`openById` のタイムアウト・タブ改名・共有権限変更）で**削除だけ完了して追加0件**になり、例外も赤ログも出ないまま「今日直そうとしている症状」に戻る。
→ **(a) 名簿を読んで対象を確定し、材料が揃わなければ何も壊さずに中止 → (b) シート読み直し → (c) 削除 → (d) 追記** の順にする。`existingMap[].rowNum` を壊さないために「通常ループと `updateCategoryStats` の完了後に呼ぶ」「削除前にシートを読み直す」という確定事項の2点は変えない。

---

## ファイル構成

| ファイル | 区分 | 責務 |
|---|---|---|
| `gas-backend/src/DashboardZeroLogCore.gs` | **新規作成** | 純粋関数のみ。GAS API を一切呼ばない。突合キー正規化、ログ→学籍番号集合、名簿パース、氏名マップ構築、対象選別、16要素行の組み立て、疑似行の行番号探索と連続区間まとめ。末尾で `module.exports` を条件付き公開し Node から `require` 可能にする |
| `gas-backend/tests/dashboard_zerolog_core.test.js` | **新規作成**（ディレクトリごと新設＝Task 0 で承認が必要） | 上記の自動テスト（71件）。`node --test` で実行 |
| `gas-backend/.claspignore` | **新規作成** | 将来 `gas-backend/` を rootDir にして `clasp push` したとき、`tests/**` が Apps Script のスクリプトファイルとしてアップロードされるのを防ぐ |
| `gas-backend/src/DashboardService.gs` | 変更 | `getRosterSheet_` / `getStudentRoster_` の新設、`getStudentNameMap` の委譲、`updateAll` の名簿読み共有、`rebuildZeroLogRows_` の新設と配線、`refreshStudent` の疑似行再利用、`withDashboardLock_` |
| `gas-backend/src/TeacherCommentService.gs` | 変更（Task 0 で承認が必要） | 疑似行の `student_id` で「教員向けAI分析」が呼ばれたときのガード、`saveTeacherComment` のロック |
| `gas-backend/src/ImportService.gs` | 変更（ロック未承認時のみ） | メニュー手動実行時の警告文 |
| `gas-backend/README-zerolog.md` | **新規作成** | 仕様・デプロイ手順・ロールバック手順・既知の穴・実機検証記録・Looker 変更記録 |

**変更しないもの:** `updateCategoryStats()`（設計判断1）、`analyzeStudent()`（別issue C）、`collectAllLogs()`、`category_stats` シート、`profile` シート、Looker のデータソース接続。

---

### Task 0: 前提確認とスコープ拡張の承認

**Files:**
- Create: なし（承認と準備のみ）

- [ ] **Step 1: ユーザーにスコープ拡張を提示して承認を得る**

以下をそのまま提示し、**4項目それぞれについて可否**をもらう。承認前に Task 1 以降へ進まない。

> 本計画は、当初の「`DashboardService.gs` の変更のみ」からスコープが4点広がります。それぞれ独立に承認/却下できます。
>
> **(1) `gas-backend/tests/` ディレクトリの新設**
> テスト方式は `automation/teams-weekly/tests/core.test.js` で実証済みのパターン（純粋関数を `.gs` に切り出し、`if (typeof module !== 'undefined') module.exports = {...}` で条件付き公開し、Node から `require` する）を踏襲します。
> ただし**前例と1点だけ性質が違います**: `automation/` は `.gitignore:33` で除外されており（コメント「学校内部の運用自動化…公開リポジトリに含めない」）、`git ls-files automation/teams-weekly` は空＝未追跡です。今回新設する `gas-backend/tests/` は除外対象外なので、**Public リポジトリに公開されます**。中身は架空値のフィクスチャのみで、実名・ID・実在の学籍番号は書きません。
> 却下された場合の代替は「純粋関数のテストを省略する」ですが、その場合エッジケース（学籍番号の表記ゆれ・grade 非数値・名簿重複・`report_group` の型ゆれ）は未検証のまま本番投入になります。
>
> **(2) `DashboardService.refreshStudent()` の変更**
> 疑似行がある学生が日中に初めて学習して PWA の⟳を押すと、`refreshStudent` は `student_id` 完全一致でしか行を探さないため `appendRow` され、**同じ学生が「未着手」と実データの2行**に分裂します（翌朝4時のバッチまで最大約18時間）。行探索に `zerolog-{student_number}` も含めて上書きすれば解消します（Task 9）。
>
> **(3) `TeacherCommentService.generateAndDisplay()` の変更**
> Looker の行から「教員向けAI分析」を開く導線がある場合、疑似行の `student_id` を渡すと、24時間以内はキャッシュされた固定文言が出ますが、バッチが1日飛ぶと `generateFresh` が `対象学生の学習データが見つかりません (studentId=zerolog-…)` を返し**エラーページ＋内部IDの露出**になります。疑似行専用のガードを1本入れて回避します（Task 10）。
>
> **(4) `LockService` の導入（`DashboardService` と `TeacherCommentService`）**
> これまで `ai_dashboard` への行の増減は `appendRow`（末尾追加）だけで、既存行の行番号は動きませんでした。今回 `deleteRow(s)` を毎日実行するため、行番号を引いてから書く3経路（`refreshStudent`、`TeacherCommentService.saveTeacherComment`、そして今回の再構築）が競合すると**別人の行を上書き**しえます。`ImportService.gs:464` のメニュー「🤖 AIダッシュボード更新」で職員が**日中に手動実行できる**ため、「4時のトリガーだから誰もいない」は成立しません。ロックは全参加者が取らないと意味がないので、3箇所すべてに入れます（Task 11）。
> 却下された場合は、README に危険を明記し、メニュー手動実行時の確認ダイアログに警告文を出す代替（Task 11 の分岐B）に切り替えます。

- [ ] **Step 2: 作業ブランチを切る**

現在のブランチ `feature/teams-weekly-report` ではなく main から切る。作業ツリーに無関係な変更（`pwa-frontend/tsconfig.tsbuildinfo` 等）があるため、**`git add .` は使わず常に明示パスで add する**こと。

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git fetch origin
git switch -c feature/dashboard-zerolog-rows origin/main
git status --short
```

Expected: 新ブランチに切り替わり、`pwa-frontend/tsconfig.tsbuildinfo` などの既存の未コミット変更がそのまま残っていること（これらは本計画では触らない）。

- [ ] **Step 3: Node の実行環境を確認する**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --version && node --check < src/DashboardService.gs && echo "stdin-check-ok"
```
Expected: バージョンが v18 以上（実測 v25.1.0）で、`stdin-check-ok` が出ること。
**注意:** `node --check src/DashboardService.gs`（stdin を使わない形）は拡張子 `.gs` の解決に失敗して必ず異常終了する。本計画では以後すべて stdin 形式を使う。

---

### Task 1: 突合キーの正規化と「ログを持つ学籍番号の集合」

**Files:**
- Create: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardZeroLogCore.gs`
- Test: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/tests/dashboard_zerolog_core.test.js`

**背景（実装者向け）:**
- 同一学生のログ行には `student_number` が空の行と非空の行が混在する。PWA の単問回答経路（`pwa-frontend/src/services/api.ts:67-83`）は `studentNumber` をペイロードに含めず、バッチ同期経路（`sync.ts:25-34`）は含めるため。したがって `logs[0]` や `logs[logs.length-1]` の1件だけを見てはならない（既存 `analyzeStudent`（`DashboardService.gs:598-599`）の潜在バグと同型）。
- さらに **studentId ごとに1件へ畳むのも禁止**（設計判断3の変更点。アーカイブに旧学籍番号が残るため）。全ログ行から非空の学籍番号をすべて集合に入れる。
- 突合キーは表記ゆれを吸収する。名簿がテキスト書式 `'0091'` でもログ側は `appendRow` の user-entered 解析で数値 91 になりうる。名簿に IME 由来の全角数字が入ることもある。**ただし `student_id` の生成には正規化前の表記（trim のみ）を使う**（教員が名簿の表記で検索できるようにするため）。

- [ ] **Step 1: 失敗するテストを書く**

`gas-backend/tests/dashboard_zerolog_core.test.js` を新規作成する。

```javascript
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: FAIL with `Cannot find module '../src/DashboardZeroLogCore.gs'`

- [ ] **Step 3: 最小の実装を書く**

`gas-backend/src/DashboardZeroLogCore.gs` を新規作成する。

```javascript
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
```

- [ ] **Step 4: テストを実行して成功を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: PASS（11 tests, 0 fail）

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardZeroLogCore.gs gas-backend/tests/dashboard_zerolog_core.test.js
git commit -m "feat: 突合キー正規化と全ログ行からの学籍番号集合を作る純粋関数を追加"
```

---

### Task 2: 名簿シートの2次元配列をレコード配列にパースする

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardZeroLogCore.gs`（`if (typeof module !== 'undefined')` ブロックの直前に追記）
- Test: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/tests/dashboard_zerolog_core.test.js`（末尾に追記）

**背景:** 名簿 `students` シートは A〜E の5列（`student_number` / `student_name` / `department` / `grade` / `report_group`）。`department` は canonical 英語id（`nursing` / `clinical_eng` / `orthoptist` / `dental_hyg`）で `ai_dashboard` 側と同一語彙のため変換不要。`grade` は生値のまま保持する（数値化は Task 5 の責務）。`studentNumberRaw`（trim 前の生値）も併せて持つ: Task 3 の氏名マップが**既存の非 trim キーを維持**するために必要。

- [ ] **Step 1: 失敗するテストを書く**

`gas-backend/tests/dashboard_zerolog_core.test.js` の末尾に追記する。

```javascript
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: FAIL with `TypeError: core.parseRosterValues_ is not a function`

- [ ] **Step 3: 最小の実装を書く**

`gas-backend/src/DashboardZeroLogCore.gs` の `if (typeof module !== 'undefined')` ブロックの直前に追記する。

```javascript
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
```

`module.exports` のオブジェクトに `parseRosterValues_,` を追加する。

- [ ] **Step 4: テストを実行して成功を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: PASS（21 tests, 0 fail）

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardZeroLogCore.gs gas-backend/tests/dashboard_zerolog_core.test.js
git commit -m "feat: 名簿シートの2次元配列をレコード配列にパースする純粋関数を追加"
```

---

### Task 3: 氏名マップの構築（既存 `getStudentNameMap()` の後方互換）

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardZeroLogCore.gs`
- Test: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/tests/dashboard_zerolog_core.test.js`

**背景（この関数が必要な理由）:** Task 7 で `getStudentNameMap()` をレコード配列からの構築に変えるが、**現行実装（`DashboardService.gs:492`, `:508`）は `String(cell || '')` で trim していない**。素直に `parseRosterValues_` の `studentNumber`（trim 済み）だけをキーにすると、名簿もログも末尾スペース付きだった学生の氏名が引けなくなる（引く側 `updateAll:149` の `nameMap[analysis.studentNumber]` は `collectAllLogs:540` の生値のまま）。呼び出し元は6箇所（`DashboardService.gs:28, 211, 957` / `WorksheetService.gs:202` / `TeacherCommentService.gs:194` / `TreemapService.gs:475`）あり、片側だけ正規化を変えるのが最悪。
→ **生キー（`studentNumberRaw`）と trim 済みキーの両方を登録する。** 既存の一致は必ず保たれ、trim 済みキーは純増になる。重複行が来たときの「後勝ち」も現行と同じにする（現行はループで上書きするため後勝ち）。

- [ ] **Step 1: 失敗するテストを書く**

`gas-backend/tests/dashboard_zerolog_core.test.js` の末尾に追記する。

```javascript
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: FAIL with `TypeError: core.buildNameMapFromRoster_ is not a function`

- [ ] **Step 3: 最小の実装を書く**

`gas-backend/src/DashboardZeroLogCore.gs` の `if (typeof module !== 'undefined')` ブロックの直前に追記する。

```javascript
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
```

`module.exports` のオブジェクトに `buildNameMapFromRoster_,` を追加する。

- [ ] **Step 4: テストを実行して成功を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: PASS（26 tests, 0 fail）

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardZeroLogCore.gs gas-backend/tests/dashboard_zerolog_core.test.js
git commit -m "feat: 名簿レコードから氏名マップを作る関数を追加（既存キーの後方互換つき）"
```

---

### Task 4: 疑似行を作るべき名簿レコードの選別

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardZeroLogCore.gs`
- Test: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/tests/dashboard_zerolog_core.test.js`

**背景:** Stage 1 の対象は「`report_group` が空でない名簿行」。現状これはちょうど24行＝既卒生と一致することを実測済みだが、**`'2026既卒'` という文字列はハードコードしない**（将来コホート名が変わったときにフィルタが黙って0件になり、今日と同じ症状が無言で再発するため）。
ただし「非空なら対象」だけだと**緩すぎる方向に壊れる**。名簿E列がチェックボックス列に変更されると、未チェックのセルは boolean `false` になり `String(false)` は非空なので全138名が対象化する（＝ユーザー承認が必要な Stage 2 が承認なしに発動する）。
→ **boolean は型で除外**する（型に基づく判定なので、コホート名のハードコードには当たらない）。文字列 `'-'` `'なし'` `'N/A'` 等のブロックリストは**採用しない**（隠れたルールが増え、`-` を正式なコホート名にしたときに無言で0件になる。同種の再発を防ぐという判断6の趣旨に反する）。代わりに件数の上限ブレーカー（Task 8）で受け止める。
選別結果と一緒に**除外理由の件数**を返す。Task 14 の検証で「なぜ N が 24 でないのか」をログだけで説明できるようにするため。

- [ ] **Step 1: 失敗するテストを書く**

`gas-backend/tests/dashboard_zerolog_core.test.js` の末尾に追記する。

```javascript
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: FAIL with `TypeError: core.selectZeroLogRosterRecords_ is not a function`

- [ ] **Step 3: 最小の実装を書く**

`gas-backend/src/DashboardZeroLogCore.gs` の `if (typeof module !== 'undefined')` ブロックの直前に追記する。

```javascript
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
```

`module.exports` のオブジェクトに `selectZeroLogRosterRecords_,` を追加する。

- [ ] **Step 4: テストを実行して成功を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: PASS（43 tests, 0 fail）

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardZeroLogCore.gs gas-backend/tests/dashboard_zerolog_core.test.js
git commit -m "feat: 疑似行を作る名簿レコードの選別関数を追加（コホート名は不問・除外理由を集計）"
```

---

### Task 5: 名簿レコードから `ai_dashboard` の16要素配列を作る

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardZeroLogCore.gs`
- Test: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/tests/dashboard_zerolog_core.test.js`

**背景:**
- `ai_dashboard` のヘッダーは16列固定（`DashboardService.gs:37-43`）。
- Gemini API は呼ばない（設計判断5）。観察できる事実が何も無く、既存の `totalQuestions < 5` ガードが返す固定文言と同じものにしかならないうえ、既存コードは生成分岐ごとに `Utilities.sleep(1000)` を2回通る（`:115`, `:146`）ため24名で約48秒の無駄な待機が発生する。
- `student_name` が空のときは `student_number` にフォールバックする。これは**このコードベース自身の明示ルール**（`DashboardService.gs:241-243` のコメント「student_nameが空の場合は student_number → student_id の順でフォールバック / Looker Studioのフィルターコントロールで空値が混入しないようにするため」）に合わせるため。`department` は空でも埋めない（存在しない学科名を捏造すると Looker の学科フィルタに偽の選択肢が出るため。空件数は Task 8 でログに出す）。
- `grade` は数値に正規化する。Looker の Google Sheets コネクタは列の型をデータから推定するため、これまで数値だけだった列に文字列が混入すると TEXT 型に再分類され既存の学年フィルタが壊れるリスクがある（未検証だが回避する）。**`Number()` は日付セルを大きな有限値に変換してしまう**ため、`Number.isInteger` と 0〜9 の範囲で判定する（実測: `Number(new Date('2026-08-21'))` は整数 1787270400000、`Number(true)` は 1）。boolean は明示的に 0 にする。

- [ ] **Step 1: 失敗するテストを書く**

`gas-backend/tests/dashboard_zerolog_core.test.js` の末尾に追記する。

```javascript
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
  assert.strictEqual(row[6], 0);              // correct_rate
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: FAIL with `TypeError: core.buildZeroLogDashboardRow_ is not a function`

- [ ] **Step 3: 最小の実装を書く**

`gas-backend/src/DashboardZeroLogCore.gs` の `if (typeof module !== 'undefined')` ブロックの直前に追記する。

```javascript
/**
 * ゼロログ学生の teacher_comment 固定文言。
 * Gemini は呼ばない（観察できる事実が無く、既存の totalQuestions<5 ガードと同じ内容にしかならない）。
 */
var ZEROLOG_TEACHER_COMMENT = '未着手（回答ログなし）。初回ログインと初回演習の声かけが必要。';

/**
 * 学年を数値に正規化する。
 * 数値として解釈できない値（空欄・全角数字・'4年' 等）と、学年としてありえない値
 * （Date・boolean・範囲外・小数）は 0 にする。
 *
 * Number() は Date を巨大な有限の整数に変換するため、isFinite だけでは弾けない
 * （実測: Number(new Date('2026-08-21')) === 1787270400000）。
 * Looker の Google Sheets コネクタは列の型をデータから推定するため、
 * これまで数値だけだった grade 列に文字列が混入すると TEXT 型に再分類され、
 * 既存の学年フィルタが壊れるリスクがある（未検証だが回避する）。
 */
function toGradeNumber_(value) {
  if (typeof value === 'boolean') return 0;
  var n = Number(value);
  if (!Number.isInteger(n)) return 0;
  if (n < 0 || n > 9) return 0;
  return n;
}

/**
 * 名簿レコード1件から ai_dashboard の16要素配列を作る。
 *
 * 列順は DashboardService.updateAll() の dashHeaders と完全に一致させること:
 * student_id, student_number, student_name, department, grade,
 * total_questions, correct_rate, streak_days,
 * weak_categories, strong_categories, weekly_trend, error_patterns,
 * ai_comment, last_study_date, updated_at, teacher_comment
 *
 * student_name が空のときは student_number にフォールバックする
 * （DashboardService.gs:241-243 と同じ規約。Looker のフィルターコントロールに空値を混ぜないため）。
 *
 * @param {Object} record 名簿レコード
 * @param {string} updatedAtIso ISO8601 文字列（同一バッチ内では同じ値を渡す）
 * @return {Array} 16要素
 */
function buildZeroLogDashboardRow_(record, updatedAtIso) {
  var r = record || {};
  var num = normalizeStudentNumber_(r.studentNumber);
  var name = r.studentName ? String(r.studentName) : num;
  return [
    ZEROLOG_ID_PREFIX + num,          // student_id
    num,                              // student_number
    name,                             // student_name
    r.department ? String(r.department) : '', // department
    toGradeNumber_(r.grade),          // grade
    0,                                // total_questions
    0,                                // correct_rate
    0,                                // streak_days
    '[]',                             // weak_categories
    '[]',                             // strong_categories
    '[]',                             // weekly_trend
    '[]',                             // error_patterns
    '',                               // ai_comment
    '',                               // last_study_date
    updatedAtIso,                     // updated_at
    ZEROLOG_TEACHER_COMMENT           // teacher_comment
  ];
}
```

`module.exports` のオブジェクトに `ZEROLOG_TEACHER_COMMENT, toGradeNumber_, buildZeroLogDashboardRow_,` を追加する。

- [ ] **Step 4: テストを実行して成功を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: PASS（59 tests, 0 fail）

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardZeroLogCore.gs gas-backend/tests/dashboard_zerolog_core.test.js
git commit -m "feat: ゼロログ学生の ai_dashboard 16要素行を組み立てる関数を追加"
```

---

### Task 6: 既存の疑似行の行番号を降順で列挙し、連続区間にまとめる

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardZeroLogCore.gs`
- Test: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/tests/dashboard_zerolog_core.test.js`

**背景:** 疑似行は毎回ゼロから作り直す（設計判断4）。行削除は行番号をずらすため、必ず**降順**で削除する必要がある。順序を間違えると別人の行を消す。さらに、疑似行は毎回まとめて末尾に追記されるため実運用ではほぼ1ブロックに連続する。`deleteRows(start, count)` でまとめれば、24回のシート API 往復が1回になる（日次バッチの最後尾＝実行時間6分上限にいちばん近い位置での節約になる）。

- [ ] **Step 1: 失敗するテストを書く**

`gas-backend/tests/dashboard_zerolog_core.test.js` の末尾に追記する。

```javascript
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: FAIL with `TypeError: core.findZeroLogRowNumbersDesc_ is not a function`

- [ ] **Step 3: 最小の実装を書く**

`gas-backend/src/DashboardZeroLogCore.gs` の `if (typeof module !== 'undefined')` ブロックの直前に追記する。

```javascript
/**
 * ai_dashboard の getValues() 結果から、疑似行（student_id が接頭辞で始まる行）の
 * 行番号（1始まり）を降順で返す。
 *
 * 削除は行番号をずらすため、必ずこの降順のまま削除すること。
 *
 * @param {Array<Array>} values 1行目がヘッダーの2次元配列
 * @return {Array<number>} 降順の行番号
 */
function findZeroLogRowNumbersDesc_(values) {
  var rowNums = [];
  if (!values || values.length <= 1) return rowNums;

  var headers = values[0] || [];
  var sidIdx = -1;
  for (var h = 0; h < headers.length; h++) {
    if (String(headers[h]).trim() === 'student_id') { sidIdx = h; break; }
  }
  if (sidIdx === -1) return rowNums;

  for (var i = values.length - 1; i >= 1; i--) {
    var sid = String((values[i] || [])[sidIdx] || '');
    if (sid.indexOf(ZEROLOG_ID_PREFIX) === 0) rowNums.push(i + 1);
  }
  return rowNums;
}

/**
 * 降順の行番号配列を、連続区間のブロックにまとめる。
 * 返り値は「開始行の降順」なので、この順に deleteRows(start, count) を呼べば
 * 後続ブロックの行番号がずれない。
 *
 * @param {Array<number>} rowNumsDesc findZeroLogRowNumbersDesc_() の戻り値
 * @return {Array<{start: number, count: number}>}
 */
function groupContiguousDesc_(rowNumsDesc) {
  var blocks = [];
  if (!rowNumsDesc || !rowNumsDesc.length) return blocks;

  var start = rowNumsDesc[0];
  var count = 1;
  for (var i = 1; i < rowNumsDesc.length; i++) {
    if (rowNumsDesc[i] === start - 1) {
      start = rowNumsDesc[i];
      count++;
    } else {
      blocks.push({ start: start, count: count });
      start = rowNumsDesc[i];
      count = 1;
    }
  }
  blocks.push({ start: start, count: count });
  return blocks;
}
```

`module.exports` のオブジェクトに `findZeroLogRowNumbersDesc_, groupContiguousDesc_,` を追加する。

- [ ] **Step 4: テストを実行して成功を確認**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --test tests/dashboard_zerolog_core.test.js
```
Expected: PASS（71 tests, 0 fail）

- [ ] **Step 5: 非ASCIIのホモグリフ混入を検査する**

コメントに日本語を使うため、コピー&ペースト時に別言語の文字（ハングル・キリル文字・ギリシャ文字）が紛れても `node --check` は通ってしまう（Unicode 識別子として合法）。識別子側に混入すると GAS 実行時に初めて `ReferenceError` になるので、機械的に弾く。

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node -e "
const fs=require('fs');
const files=['src/DashboardZeroLogCore.gs','src/DashboardService.gs'];
let bad=false;
for (const f of files) {
  const m=fs.readFileSync(f,'utf8').match(/[Ͱ-ϿЀ-ӿᄀ-ᇿ가-힯]/g);
  if (m) { bad=true; console.error(f+': 想定外の文字 '+[...new Set(m)].join(' ')); }
}
if (bad) process.exit(1);
console.log('homoglyph-check-ok');
"
```
Expected: `homoglyph-check-ok`（ヒットしたらその文字を日本語の正しい表記に直す）

- [ ] **Step 6: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardZeroLogCore.gs gas-backend/tests/dashboard_zerolog_core.test.js
git commit -m "feat: 既存の疑似行を降順で列挙し連続区間にまとめる関数を追加"
```

---

### Task 7: `getStudentRoster_()` の新設と `getStudentNameMap()` の委譲

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardService.gs:476-516`（`getStudentNameMap` のコメントから閉じ括弧まで）
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardService.gs:27-28`（`updateAll` 内の名簿読み）

**背景:** 現行 `getStudentNameMap()`（476-516行）は、`STUDENT_LIST_ID` がある場合／無い場合（コンテナ内 `students` シートへのフォールバック）で**ほぼ同じパース処理を2回書いている**。名簿レコードが必要になったので、シートを取る部分（`getRosterSheet_`）／値をレコード化する部分（`parseRosterValues_`：Task 2）／氏名マップに畳む部分（`buildNameMapFromRoster_`：Task 3）に分ける。
`getStudentRoster_()` は**取得失敗時に `null`、本当に0件のときに `[]`** を返す。この区別が無いと、名簿の一時的な取得失敗（`openById` タイムアウト・タブ改名・権限剥奪）で「対象0件」と誤認し、既存の疑似行を全部消してしまう（Task 8 のガードがこの区別に依存する）。
`getStudentNameMap()` の**戻り値の形（`{学籍番号: 氏名}`）と、例外を投げずに空オブジェクトを返す挙動は変えない**。キーは Task 3 のとおり生キー＋trim 済みキーの両方になる（純増）。

- [ ] **Step 1: 既存の呼び出し元を確認する**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）" && grep -rn "getStudentNameMap" gas-backend/src/
```
Expected: 呼び出し元が `DashboardService.gs:28` / `DashboardService.gs:211` / `DashboardService.gs:957` / `WorksheetService.gs:202` / `TeacherCommentService.gs:194` / `TreemapService.gs:475` の6箇所であることを確認する。これ以外があれば、そこも戻り値の形に依存していないか確認してから進む。

- [ ] **Step 2: `getStudentNameMap()` を差し替える**

`gas-backend/src/DashboardService.gs` の476行（`  /**`）から516行（`  },`）までを、以下で置き換える。

```javascript
  /**
   * 名簿の students シートを取得する。
   * ScriptProperty STUDENT_LIST_ID があれば外部スプレッドシート、無ければコンテナ内を見る。
   * 見つからなければ null を返す。
   */
  getRosterSheet_() {
    var nameSheetId = PropertiesService.getScriptProperties().getProperty('STUDENT_LIST_ID');
    if (!nameSheetId) {
      return getSpreadsheet().getSheetByName('students');
    }
    return SpreadsheetApp.openById(nameSheetId).getSheetByName('students');
  },

  /**
   * 学生名簿をレコード配列で取得する。
   * 形: [{ studentNumber, studentNumberRaw, studentName, department, grade, reportGroup }, ...]
   *
   * 取得に失敗した場合・シートが見つからない場合は null を返す（例外は投げない）。
   * 「取得できなかった」と「本当に0件」を区別できないと、名簿の一時障害のときに
   * 疑似行を全部消してしまうため、[] とは別の値にすること。
   */
  getStudentRoster_() {
    try {
      var sheet = this.getRosterSheet_();
      if (!sheet) {
        Logger.log('学生名簿: students シートが見つかりません');
        return null;
      }
      var values = sheet.getDataRange().getValues();
      var records = parseRosterValues_(values);
      var skipped = Math.max(0, values.length - 1 - records.length);
      if (skipped > 0) {
        Logger.log('学生名簿: 学籍番号が空の行を ' + skipped + '件スキップしました');
      }
      return records;
    } catch (e) {
      Logger.log('学生名簿取得エラー: ' + (e && e.stack ? e.stack : e));
      return null;
    }
  },

  /**
   * 学生名簿スプレッドシートから学籍番号→氏名のマップを取得
   * （getStudentRoster_ に委譲。戻り値の形と「例外を投げない」挙動は従来どおり。
   *   キーは生値＋trim 済みの両方が登録されるので、従来一致していた参照は必ず維持される）
   */
  getStudentNameMap() {
    return buildNameMapFromRoster_(this.getStudentRoster_() || []);
  },
```

- [ ] **Step 3: `updateAll()` の名簿読みを1回にまとめる**

`gas-backend/src/DashboardService.gs` の27〜28行を置き換える。

置換前:
```javascript
    // 学生名簿から学籍番号→氏名のマップを作成
    var nameMap = this.getStudentNameMap();
```

置換後:
```javascript
    // 学生名簿を1回だけ読み、氏名マップとゼロログ疑似行の両方で共有する
    // （roster が null なら名簿の取得に失敗している。氏名は空のまま続行し、疑似行は作らない）
    var roster = this.getStudentRoster_();
    var nameMap = buildNameMapFromRoster_(roster || []);
```

- [ ] **Step 4: 構文チェックと純粋関数テストを実行**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --check < src/DashboardService.gs && node --check < src/DashboardZeroLogCore.gs && node --test tests/dashboard_zerolog_core.test.js
```
Expected: 構文エラーなし、PASS（71 tests, 0 fail）
**注意:** `node --check src/....gs`（stdin を使わない形）は `ERR_UNKNOWN_FILE_EXTENSION` で必ず失敗する。必ず `<` を付けること。

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardService.gs
git commit -m "refactor: 名簿の読み取りを getStudentRoster_ に集約し updateAll での重複読み込みを解消"
```

---

### Task 8: `rebuildZeroLogRows_()` の新設と `updateAll()` への配線

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardService.gs`（`getStudentRoster_()` の直後に `rebuildZeroLogRows_` を新設）
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardService.gs:182-190`（`updateCategoryStats` 呼び出しから `return {...};` まで）

**背景（守るべき不変条件）:**
1. **処理順**: `updateAll()` 冒頭で作る `existingMap[].rowNum`（`:59-71` で構築、`:170` で消費、ループ終了は `:176`）は行番号を保持している。疑似行の削除は行番号をずらすため、**必ず通常ループと `updateCategoryStats()` が完了した後**に行い、**削除前にシートを読み直す**こと。
2. **材料が先、破壊が後**: 名簿を読んで対象を確定してから削除する。名簿が読めないときは1行も消さずに中止する。
3. **グリッド行数**: `deleteRow(s)` はシートのグリッド行数（`getMaxRows()`）を減らす。追記は `appendRow` ではなく `setValues` の一括書き込みにするため（24回の API 往復を1回にするため）、**`getRange` の範囲がグリッドを超えないよう `insertRowsAfter` で足りない行を先に足す**。これをしないと、毎日 N 行ずつ空き行が目減りし、いつか範囲外例外で書き込みだけが落ちて「削除だけ済む」状態になる。
4. **上限ブレーカー**: `report_group` の運用変更で対象が急増したら、書かずに中止する。

- [ ] **Step 1: `rebuildZeroLogRows_()` を新設する**

`gas-backend/src/DashboardService.gs` の `getStudentRoster_()` の直後（`getStudentNameMap()` の直前）に追記する。

```javascript
  /**
   * ゼロログ学生の疑似行を毎回ゼロから作り直す。
   *
   * 処理順（厳守）:
   *   0. 通常の学生ループと updateCategoryStats が完了した後に呼ぶこと
   *      （下の削除が行番号をずらすため、updateAll 冒頭の existingMap[].rowNum が無効になる）
   *   1. 名簿から対象を確定する。名簿が取れない/0件なら1行も壊さずに中止する
   *      （削除を先にすると、名簿の一時障害の日だけ既卒生が全員消える＝直そうとしている症状に戻る）
   *   2. シートを読み直す（updateAll 冒頭の oldData は使わない）
   *   3. 疑似行を降順・連続区間まとめで削除する
   *   4. グリッド行数を確保してから一括追記する
   *
   * 「有ログ化したら消す」条件方式にしないのは、削除条件が発火しないケースで
   * ゴースト行が永久に残るため。毎回作り直せば判定結果が変わった瞬間に自動追随する
   * （ただし追随の粒度は日次。日中の遷移は refreshStudent 側で吸収する）。
   *
   * Gemini API は呼ばない（観察できる事実が無いため。設計判断5）。
   *
   * @param {Sheet} dashboard ai_dashboard シート
   * @param {Array<Object>} allLogs collectAllLogs() の結果
   * @param {number} columnCount ヘッダー列数（16）
   * @param {Array<Object>|null} roster getStudentRoster_() の結果（null は取得失敗）
   * @param {Object} result 進捗を書き込む集計オブジェクト（部分失敗時も呼び出し側が実績を読めるようにする）
   * @return {Object} result と同じ参照
   */
  rebuildZeroLogRows_(dashboard, allLogs, columnCount, roster, result) {
    result.deleted = 0;
    result.added = 0;
    result.aborted = '';

    // --- 1. 材料をそろえる（破壊的操作より前に必ず行う） ---
    if (roster === null || roster === undefined) {
      result.aborted = 'roster_unavailable';
      Logger.log('ゼロログ疑似行: 名簿を取得できないため中止（既存の疑似行はそのまま保持）');
      return result;
    }
    if (!roster.length) {
      result.aborted = 'roster_empty';
      Logger.log('ゼロログ疑似行: 名簿0件のため中止（既存の疑似行はそのまま保持）');
      return result;
    }

    var numbersWithLogs = buildStudentNumbersWithLogs_(allLogs);
    var selection = selectZeroLogRosterRecords_(roster, numbersWithLogs);
    var targets = selection.records;

    var emptyDept = 0;
    for (var e = 0; e < targets.length; e++) {
      if (!targets[e].department) emptyDept++;
    }

    Logger.log('ゼロログ疑似行: 名簿 ' + roster.length + '件'
      + ' / コホート対象 ' + selection.groupRows + '件'
      + ' / ログ有りで除外 ' + selection.withLogsExcluded + '件'
      + ' / 学籍番号重複で除外 ' + selection.duplicateNumbers.length + '件'
      + ' / report_groupがboolean ' + selection.booleanGroupRows + '件'
      + ' / 疑似行の対象 ' + targets.length + '件'
      + '（うち学科が空 ' + emptyDept + '件）');

    if (targets.length > ZEROLOG_MAX_ROWS) {
      result.aborted = 'too_many';
      Logger.log('ゼロログ疑似行: 対象 ' + targets.length + '件が上限 ' + ZEROLOG_MAX_ROWS
        + ' 件を超過したため中止（既存の疑似行はそのまま保持）。'
        + 'report_group 列の運用が変わっていないか確認すること');
      return result;
    }

    var updatedAt = new Date().toISOString();
    var rows = [];
    for (var t = 0; t < targets.length; t++) {
      rows.push(buildZeroLogDashboardRow_(targets[t], updatedAt));
    }

    // --- 2. シートを読み直す ---
    var values = dashboard.getDataRange().getValues();
    var blocks = groupContiguousDesc_(findZeroLogRowNumbersDesc_(values));

    // --- 3. 既存の疑似行を削除（開始行の降順なので行番号がずれない） ---
    for (var b = 0; b < blocks.length; b++) {
      dashboard.deleteRows(blocks[b].start, blocks[b].count);
      result.deleted += blocks[b].count;
    }

    // --- 4. 一括追記（deleteRows でグリッド行数が減っているので不足分を先に足す） ---
    if (rows.length) {
      var startRow = dashboard.getLastRow() + 1;
      var needRows = startRow + rows.length - 1;
      var maxRows = dashboard.getMaxRows();
      if (needRows > maxRows) {
        dashboard.insertRowsAfter(maxRows, needRows - maxRows);
      }
      dashboard.getRange(startRow, 1, rows.length, columnCount).setValues(rows);
      result.added = rows.length;
    }

    Logger.log('ゼロログ疑似行: 削除 ' + result.deleted + '行 / 追加 ' + result.added + '行');
    return result;
  },
```

- [ ] **Step 2: `updateAll()` から呼び出す**

`gas-backend/src/DashboardService.gs` の182〜190行を以下で置き換える。

置換前:
```javascript
    // category_statsシートを更新（ツリーマップ用）
    this.updateCategoryStats(ss, allLogs, categoryMap);

    return {
      updated: updatedCount,
      studentAiSkipped: studentAiSkipped,
      teacherAiSkipped: teacherAiSkipped,
      teacherAiGenerated: teacherAiGenerated
    };
```

置換後:
```javascript
    // category_statsシートを更新（ツリーマップ用）
    // 注: category_stats には疑似行を書かない。学生×カテゴリ×サブカテゴリ×サブトピックの
    //     リーフ単位なのでゼロログ学生1名で数百行になり、「未着手」という1つの事実の
    //     言い換えが増えるだけになるため（設計判断1）
    this.updateCategoryStats(ss, allLogs, categoryMap);

    // ゼロログ学生の疑似行を作り直す。
    // 必ずこの位置（通常ループと updateCategoryStats の完了後）で呼ぶこと。
    // 行削除で行番号がずれ、上の existingMap[].rowNum が無効になるため。
    var zeroLog = { deleted: 0, added: 0, aborted: '', error: '' };
    try {
      this.rebuildZeroLogRows_(dashboard, allLogs, dashHeaders.length, roster, zeroLog);
    } catch (e) {
      // 疑似行の失敗で日次バッチ全体を落とさない（通常学生の更新はすでに完了している）。
      // zeroLog は参照渡しなので、途中まで進んだ実績（削除件数）はここでも読める。
      zeroLog.error = String(e);
      Logger.log('ゼロログ疑似行の更新に失敗: ' + (e && e.stack ? e.stack : e)
        + '（この時点の実績: 削除 ' + zeroLog.deleted + '行 / 追加 ' + zeroLog.added + '行）');
    }

    return {
      updated: updatedCount,
      studentAiSkipped: studentAiSkipped,
      teacherAiSkipped: teacherAiSkipped,
      teacherAiGenerated: teacherAiGenerated,
      zeroLogAdded: zeroLog.added,
      zeroLogDeleted: zeroLog.deleted,
      zeroLogAborted: zeroLog.aborted,
      zeroLogError: zeroLog.error
    };
```

- [ ] **Step 3: 構文チェックとテストを実行**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --check < src/DashboardService.gs && node --test tests/dashboard_zerolog_core.test.js
```
Expected: 構文エラーなし、PASS（71 tests, 0 fail）

- [ ] **Step 4: 呼び出し順と副作用を目視レビューする**

以下をコードを読んで確認し、1つでも満たさなければ Step 1〜2 に戻る。

- `rebuildZeroLogRows_` の呼び出しが `this.updateCategoryStats(...)` より**後**にある
- `rebuildZeroLogRows_` の中で名簿由来の `targets` を確定させてから `deleteRows` を呼んでいる（削除が先になっていない）
- `roster === null` と `roster.length === 0` の両方で、**1行も削除せずに** return している
- シートの読み直しが `dashboard.getDataRange().getValues()` で、`updateAll()` 冒頭の `oldData` を再利用していない
- 削除が `groupContiguousDesc_(findZeroLogRowNumbersDesc_(values))` の返す順（開始行の降順）のまま実行されている
- 追記の直前に `getMaxRows()` を見て `insertRowsAfter` している（`setValues` がグリッド外に出ない）
- `generateAiComment` / `generateTeacherComment` / `Utilities.sleep` を疑似行の経路で呼んでいない
- `updateCategoryStats` と `category_stats` シートに一切変更が入っていない

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardService.gs
git commit -m "feat: ゼロログ学生を ai_dashboard に疑似行として毎回作り直す処理を追加"
```

---

### Task 9: `refreshStudent()` が疑似行を再利用するようにする

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardService.gs:982-999`（既存行の探索ブロック）

**背景:** 疑似行がある学生が日中に初めて学習して PWA の⟳を押すと、`refreshStudent`（`:932-1024`）は `student_id` 完全一致でしか行を探さない（`:989-999`）ため `appendRow`（`:1023`）され、**同じ学生が「未着手」の疑似行と実データ行の2行**になる。Looker の要注意リストは「未学習日数が最大」の疑似行を上位に出すので、教員には「今日から解き始めた学生」が「未着手」として提示される。翌朝4時のバッチまで最大約18時間続く。

- [ ] **Step 1: Task 0 の承認結果を確認する**

Task 0 Step 1 の項目(2)が承認されていることを確認する。**却下されている場合は本タスクをスキップし**、Task 12 の README「既知の穴」に次の一文をそのまま追記して次のタスクへ進む。

> 疑似行がある学生が日中に初めて学習して PWA の⟳を押すと、`refreshStudent` が新しい行を追記するため、同じ学生が「未着手」の疑似行と実データ行の2行に分裂して見える。翌朝の日次バッチで疑似行が消えるまで最大約18時間続く（対処はユーザー判断により見送り）。

- [ ] **Step 2: 既存行の探索ブロックを差し替える**

`gas-backend/src/DashboardService.gs` の982行（`    // 既存行を探し、teacher_comment 列の既存値を保持`）から999行（`    }`）までを、以下で置き換える。

```javascript
    // 既存行を探し、teacher_comment 列の既存値を保持
    // 日次バッチが作った疑似行 (zerolog-<student_number>) が残っている場合は、その行を再利用して
    // 上書きする。append すると同一学生が「未着手」と実データの2行に分裂して見えるため
    // （翌朝のバッチまで最大約18時間その状態が続く）。
    var data = dashboard.getDataRange().getValues();
    var headers = data[0] || [];
    var sidIdx = headers.indexOf('student_id');
    var existingTeacherCommentIdx = headers.indexOf('teacher_comment');
    var existingTeacherComment = '';
    var foundRow = -1;
    var zeroLogRow = -1;
    var analysisNumber = normalizeStudentNumber_(analysis.studentNumber);
    var zeroLogId = analysisNumber ? (ZEROLOG_ID_PREFIX + analysisNumber) : '';
    if (sidIdx !== -1) {
      for (var i = 1; i < data.length; i++) {
        var rowSid = String(data[i][sidIdx] || '');
        if (rowSid === studentId) {
          foundRow = i + 1;
          if (existingTeacherCommentIdx !== -1) {
            existingTeacherComment = data[i][existingTeacherCommentIdx] || '';
          }
          break;
        }
        if (zeroLogRow === -1 && zeroLogId && rowSid === zeroLogId) {
          zeroLogRow = i + 1;
        }
      }
    }
    // 実UUIDの行が無く疑似行だけがある場合は、疑似行を実データで上書きする。
    // 疑似行の teacher_comment は固定文言なので引き継がない（空のまま再生成に委ねる）。
    if (foundRow === -1 && zeroLogRow !== -1) {
      foundRow = zeroLogRow;
    }
```

- [ ] **Step 3: 構文チェックとテストを実行**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --check < src/DashboardService.gs && node --test tests/dashboard_zerolog_core.test.js
```
Expected: 構文エラーなし、PASS（71 tests, 0 fail）

- [ ] **Step 4: 上書き後の整合性を目視レビューする**

以下を確認する。

- 疑似行を上書きした行の `student_id` は実UUIDに置き換わる（`row` の先頭要素が `studentId`）
- したがって翌朝の `rebuildZeroLogRows_` はこの行を疑似行として検出しない（`zerolog-` で始まらないため削除対象外）
- `analysis.studentNumber` が空文字のときは `zeroLogId` が空になり、疑似行の探索が働かない（誤って別人の行を上書きしない）

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardService.gs
git commit -m "fix: refreshStudent が疑似行を再利用して同一学生の二重表示を防ぐ"
```

---

### Task 10: 疑似行から「教員向けAI分析」を開いたときのガード

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/TeacherCommentService.gs:64-66`（`if (!studentId)` ブロックの直後）

**背景:** `Code.gs` の Web アプリ経由で `TeacherCommentService.generateAndDisplay(studentId)` が呼ばれる。Looker の行から `student_id` を渡す導線があると、疑似行では次の挙動になる。
- バッチ実行から24時間以内: `getCachedComment` が固定文言を返し `fresh: true`（`CACHE_HOURS: 24`）→ 固定文言が表示される（実害なし）
- 24時間を超えた場合（バッチが1日飛んだ後など）: `generateFresh`（`:164-170`）が `studentLogs.length === 0` で `対象学生の学習データが見つかりません (studentId=zerolog-…)` を返し、**エラーページ＋内部IDの露出**になる
従来は「行が無いのでリンクも存在しない」だったものが「リンクはあるが押すと壊れる」に変わるため、専用ガードを入れる。

- [ ] **Step 1: Task 0 の承認結果を確認する**

Task 0 Step 1 の項目(3)が承認されていることを確認する。**却下されている場合は本タスクをスキップし**、Task 12 の README「既知の穴」に次の一文をそのまま追記して次のタスクへ進む。

> Looker から疑似行の「教員向けAI分析」を開くと、日次バッチから24時間を超えている場合にエラーページ（`対象学生の学習データが見つかりません (studentId=zerolog-…)`）が出る。Task 15 のチェックリストで挙動を確認すること（対処はユーザー判断により見送り）。

- [ ] **Step 2: ガードを追加する**

`gas-backend/src/TeacherCommentService.gs` の64〜66行を以下で置き換える。

置換前:
```javascript
    if (!studentId) {
      return this.renderErrorPage('studentId が指定されていません', email);
    }
```

置換後:
```javascript
    if (!studentId) {
      return this.renderErrorPage('studentId が指定されていません', email);
    }

    // ゼロログ疑似行 (zerolog-<student_number>) は学習データを持たないため、
    // generateFresh に渡すと「対象学生の学習データが見つかりません」のエラーページになる。
    // Gemini は呼ばず、ai_dashboard に書かれている固定文言をそのまま表示する。
    if (String(studentId).indexOf(ZEROLOG_ID_PREFIX) === 0) {
      var zeroLogInfo = this.getCachedComment(studentId);
      // ⚠ この Logger.log は採用しないこと（2026-08-23 の監査で指摘）。
      //    studentId は zerolog-{実在の学籍番号}、email は教員の実アドレスであり、
      //    実装すると GAS の実行ログ画面に学籍番号と教員メールが常時記録される。
      //    ガードを入れる場合もこの1行は落とすこと。詳細は非公開メモ
      //    project_memoria_dashboard_zerolog_private を参照。
      // Logger.log('[TeacherComment] Zero-log row requested studentId=' + studentId + ' by=' + email);
      return this.renderCommentPage(studentId, {
        comment: zeroLogInfo.comment || ZEROLOG_TEACHER_COMMENT,
        updatedAt: zeroLogInfo.updatedAt || '',
        studentNumber: zeroLogInfo.studentNumber || '',
        studentName: zeroLogInfo.studentName || '',
        department: zeroLogInfo.department || '',
        grade: zeroLogInfo.grade || ''
      }, email, true);
    }
```

- [ ] **Step 3: 構文チェックを実行**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --check < src/TeacherCommentService.gs && echo "syntax-ok"
```
Expected: `syntax-ok`

- [ ] **Step 4: 依存する関数の形を目視確認する**

- `renderCommentPage(studentId, info, viewerEmail, fromCache)` の引数順が一致している（`TeacherCommentService.gs:237`）
- `getCachedComment(studentId)` が行を見つけられなかった場合に `{ fresh: false }` を返すので、`comment` 等が `undefined` になりフォールバックが効く（`:104`, `:143`）
- `ZEROLOG_ID_PREFIX` / `ZEROLOG_TEACHER_COMMENT` は `DashboardZeroLogCore.gs` のグローバル変数で、Apps Script では同一スコープから参照できる

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/TeacherCommentService.gs
git commit -m "fix: 疑似行から教員向けAI分析を開いてもエラーページにならないようにする"
```

---

### Task 11: `ai_dashboard` の行番号レースへの対処

**Files:**
- Modify（分岐A）: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/DashboardService.gs`（`withDashboardLock_` の新設、`rebuildZeroLogRows_` と `refreshStudent` への適用）
- Modify（分岐A）: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/TeacherCommentService.gs:210-233`（`saveTeacherComment`）
- Modify（分岐B）: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src/ImportService.gs:464-472`（`updateAllDashboards`）

**背景:** これまで `ai_dashboard` への行の増減は `appendRow` だけで、既存行の行番号は動かなかった。そのため「`getValues()` で行番号を決める → その行番号に `setValue`」という3経路（`DashboardService.refreshStudent:983-1024`、`TeacherCommentService.saveTeacherComment:215-232`、今回の再構築）は実質安全だった。今回 `deleteRows` を毎日実行するため、read と write の間に削除が挟まると**別人の行を上書きする**。`grep -rn LockService gas-backend/src/` の結果、`DashboardService.gs` と `TeacherCommentService.gs` にはロックが無い。`ImportService.gs:464` のメニュー「🤖 AIダッシュボード更新」で職員が**日中に手動実行できる**ため、「4時のトリガーだから誰もいない」は成立しない。

- [ ] **Step 1: Task 0 の承認結果で分岐を決める**

Task 0 Step 1 の項目(4)が承認されていれば **Step 2A → Step 3A** を実行する。却下されていれば **Step 2B** を実行する。どちらの場合も Step 4 を実行する。

- [ ] **Step 2A: `withDashboardLock_` を新設し、再構築と `refreshStudent` に適用する**

まず `gas-backend/src/DashboardService.gs` の `getRosterSheet_()` の直前に、次のメソッドを追記する。

```javascript
  /**
   * ai_dashboard の「行番号を引いてから書く」処理を直列化する。
   *
   * 2026-08-21 以降、日次バッチが疑似行を deleteRows するため既存行の行番号が動く。
   * read と write の間に削除が挟まると別人の行を上書きするので、
   * refreshStudent / saveTeacherComment / rebuildZeroLogRows_ の3経路すべてがこのロックを取る。
   * （ロックは全参加者が取って初めて機能する。1箇所だけ取っても意味が無い）
   *
   * @param {Function} fn ロック内で実行する処理
   * @return {*} fn の戻り値
   */
  withDashboardLock_(fn) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      throw new Error('ai_dashboard のロックを20秒待っても取得できませんでした');
    }
    try {
      return fn();
    } finally {
      lock.releaseLock();
    }
  },
```

次に `rebuildZeroLogRows_` の中で、削除と追記だけをロックで囲む（材料の算出はロックの外でよい）。Task 8 Step 1 で書いた次のブロック

```javascript
    // --- 2. シートを読み直す ---
    var values = dashboard.getDataRange().getValues();
    var blocks = groupContiguousDesc_(findZeroLogRowNumbersDesc_(values));

    // --- 3. 既存の疑似行を削除（開始行の降順なので行番号がずれない） ---
    for (var b = 0; b < blocks.length; b++) {
      dashboard.deleteRows(blocks[b].start, blocks[b].count);
      result.deleted += blocks[b].count;
    }

    // --- 4. 一括追記（deleteRows でグリッド行数が減っているので不足分を先に足す） ---
    if (rows.length) {
      var startRow = dashboard.getLastRow() + 1;
      var needRows = startRow + rows.length - 1;
      var maxRows = dashboard.getMaxRows();
      if (needRows > maxRows) {
        dashboard.insertRowsAfter(maxRows, needRows - maxRows);
      }
      dashboard.getRange(startRow, 1, rows.length, columnCount).setValues(rows);
      result.added = rows.length;
    }
```

を、以下で置き換える。

```javascript
    // --- 2〜4. 読み直し・削除・追記はロック内で一息に行う（行番号レース対策） ---
    this.withDashboardLock_(function () {
      var values = dashboard.getDataRange().getValues();
      var blocks = groupContiguousDesc_(findZeroLogRowNumbersDesc_(values));

      for (var b = 0; b < blocks.length; b++) {
        dashboard.deleteRows(blocks[b].start, blocks[b].count);
        result.deleted += blocks[b].count;
      }

      if (rows.length) {
        var startRow = dashboard.getLastRow() + 1;
        var needRows = startRow + rows.length - 1;
        var maxRows = dashboard.getMaxRows();
        if (needRows > maxRows) {
          dashboard.insertRowsAfter(maxRows, needRows - maxRows);
        }
        dashboard.getRange(startRow, 1, rows.length, columnCount).setValues(rows);
        result.added = rows.length;
      }
    });
```

さらに `refreshStudent` の read-then-write 区間をロックで囲む。Task 9 Step 2 で置き換えた `// 既存行を探し、teacher_comment 列の既存値を保持` の行から、`:1024` の `appendRow` を含むブロックの閉じ括弧までが対象。具体的には、

- `var data = dashboard.getDataRange().getValues();` の直前に次の2行を挿入する:
```javascript
    var self = this;
    this.withDashboardLock_(function () {
```
- `refreshStudent` の書き込み部分
```javascript
    if (foundRow > 0) {
      dashboard.getRange(foundRow, 1, 1, dashHeaders.length).setValues([row]);
    } else {
      dashboard.appendRow(row);
    }
```
の直後に次の1行を挿入して無名関数を閉じる:
```javascript
    });
```
- 無名関数の中で `this` を使っている箇所があれば `self` に置き換える（Task 9 適用後のこの区間には `this` の参照は無いので、そのままでよい。挿入後に `node --check` と目視で確認する）
- `row` は無名関数の外（`:1001-1018`）で組み立てているので、無名関数の内側からクロージャで参照できる。**`row` の組み立てもロックの内側に入るように** `var row = [` から `];` までをロック開始行より後ろに置くこと（読み取り→組み立て→書き込みを一息にするため）

- [ ] **Step 3A: `saveTeacherComment` をロックで囲む**

`gas-backend/src/TeacherCommentService.gs` の210行（`  saveTeacherComment: function(studentId, comment) {`）から233行（`  },`）までを、以下で置き換える。

```javascript
  saveTeacherComment: function(studentId, comment) {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
    if (!sheet) return;

    // 行番号を引いてから書くため、日次バッチの疑似行削除と競合すると別人の行を上書きしうる。
    // DashboardService と同じスクリプトロックで直列化する。
    DashboardService.withDashboardLock_(function () {
      var data = sheet.getDataRange().getValues();
      if (data.length <= 1) return;

      var headers = data[0];
      var sidIdx = headers.indexOf('student_id');
      var tcIdx = headers.indexOf('teacher_comment');
      var updatedIdx = headers.indexOf('updated_at');
      if (sidIdx === -1 || tcIdx === -1) return;

      for (var i = 1; i < data.length; i++) {
        if (data[i][sidIdx] === studentId) {
          sheet.getRange(i + 1, tcIdx + 1).setValue(comment);
          if (updatedIdx !== -1) {
            sheet.getRange(i + 1, updatedIdx + 1).setValue(new Date().toISOString());
          }
          return;
        }
      }
    });
  },
```

- [ ] **Step 2B: ロックを入れない場合の代替（承認が得られなかった場合のみ）**

`gas-backend/src/ImportService.gs` の464〜472行（`function updateAllDashboards() {` から閉じ括弧まで）を、以下で置き換える。

```javascript
/**
 * AIダッシュボード手動更新
 *
 * 注意: この処理は ai_dashboard のゼロログ疑似行を削除して作り直すため、
 * 実行中に学生がPWAの⟳（AI分析）を押したり、教員が教員向けAIコメントを保存すると、
 * 行番号がずれて別人の行が上書きされる可能性がある（LockService 未導入のため）。
 */
function updateAllDashboards() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(
    'AIダッシュボード更新',
    '実行中は学生のAI分析（⟳）と教員コメント保存を行わないでください。\n'
    + '（ai_dashboard の行を削除・再作成するため、同時操作で別の行を壊す可能性があります）\n\n'
    + '続行しますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;

  DashboardService.updateAll();
  ui.alert(
    'AIダッシュボード更新完了',
    'すべての学生のAIコメントを更新しました。',
    ui.ButtonSet.OK
  );
}
```

- [ ] **Step 4: 構文チェックとテストを実行してコミット**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && node --check < src/DashboardService.gs && node --check < src/TeacherCommentService.gs && node --check < src/ImportService.gs && node --test tests/dashboard_zerolog_core.test.js
```
Expected: 構文エラーなし、PASS（71 tests, 0 fail）

分岐Aを実行した場合:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/DashboardService.gs gas-backend/src/TeacherCommentService.gs
git commit -m "fix: ai_dashboard の行番号レースを LockService で直列化する"
```

分岐Bを実行した場合:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/ImportService.gs
git commit -m "docs: ダッシュボード手動更新時の同時操作リスクを警告ダイアログで明示する"
```

---

### Task 12: `.claspignore` と運用文書の作成

**Files:**
- Create: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/.claspignore`
- Create: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/README-zerolog.md`

**背景:** `gas-backend/tests/dashboard_zerolog_core.test.js` は拡張子 `.js` なので、将来 `gas-backend/` を rootDir にして `clasp push` すると **Apps Script のスクリプトファイルとしてアップロードされ**、`require('node:test')` で実行時エラーになる。Task 13 の手順では一時 clone に2ファイルだけコピーするので直接の被害は無いが、ディレクトリを新設した以上、除外設定を同時にコミットしておく。

- [ ] **Step 1: `.claspignore` を作成する**

`gas-backend/.claspignore` を新規作成する。

```
tests/**
**/*.test.js
node_modules/**
.claude/**
src/.claude/**
.DS_Store
README-zerolog.md
```

- [ ] **Step 2: 運用文書を作成する**

`gas-backend/README-zerolog.md` を新規作成する。**ロールバック手順まで含めて完成させること**（他タスクから「後で追記される節」を参照しない）。

~~~markdown
# ai_dashboard のゼロログ疑似行

## 何をするものか

`DashboardService.updateAll()` は回答ログを持つ studentId しか反復しないため、一度も問題を
解いていない学生は `ai_dashboard` に1行も書かれず、教員ダッシュボードの「要注意学生リスト」から
不可視だった。これを解消するため、名簿 `students` シートの `report_group` が空でない学生のうち、
回答ログに学籍番号が1度も現れない者について、`student_id = 'zerolog-{student_number}'` の
疑似行を日次バッチ（`runDashboardUpdate`、毎日4時、Head 駆動）で書き出す。

- 疑似行は `total_questions = 0` / `last_study_date = ''` / `ai_comment = ''` /
  `teacher_comment = 固定文言`。Gemini API は呼ばない。
- 疑似行は**毎回ゼロから作り直す**（削除→一括追記）。学生が学習を始めれば翌日の実行で自動的に消える。
  日中に学習を始めた場合は `refreshStudent`（PWAの⟳）が疑似行を実データで上書きする。
- `category_stats` には疑似行を書かない（リーフ単位で行数が爆発するため）。
- 1回の実行で作る疑似行の上限は `ZEROLOG_MAX_ROWS`（40）。超えたら**何も書かずに中止**する。
  `report_group` 列の運用が変わったときに、承認なく全名簿へ拡大するのを防ぐ安全弁。
- 名簿が読めない・0件のときは**既存の疑似行を消さずに中止**する（削除だけ済んで追加0件になると、
  直そうとしている症状に戻るため）。

## 疑似キーについて

`zerolog-` 接頭辞は v4 UUID（16進数字とハイフンのみ）とは原理的に衝突しない。
ただし `ai_dashboard.student_id` はログ由来の任意文字列であり UUID を強制していないので、
**`zerolog-` で始まる student_id を手で入れないこと**（日次バッチが削除対象とみなす）。

## デプロイ手順

**本番 Apps Script にはリポジトリに存在しないファイルが2つある（`ParentReport.js` / `VideoDemo.js`）。**
素の `clasp push` はこの2つを消す。以下のどちらかで更新すること。接続情報は非公開の
プロジェクトメモリ `project_memoria_gas_backend_deploy` を参照。

### 手順A: clasp
1. 一時ディレクトリで `clasp clone <SCRIPT_ID>`
2. `ls -1` で `ParentReport.js` / `VideoDemo.js` の存在を確認
3. `diff -rq` でリポジトリの `gas-backend/src` と突き合わせ、想定外の差分が無いことを確認
   （`src/.claude/` はリポジトリ側にだけあるディレクトリなので差分として出るのが正常）
4. `ParentReport.js` / `VideoDemo.js` に、追加するグローバル識別子と同名の定義が無いことを grep で確認
5. 変更したファイルだけを clone 先へ `cp` して `clasp push`
6. push 結果に `ParentReport.js` / `VideoDemo.js` が含まれることを確認

### 手順B: エディタ手貼り
1. 変更したファイルだけをエディタ上で作成／上書きして保存
2. 保存前に `ParentReport.js` / `VideoDemo.js` を開き、同名のグローバル関数・変数が無いことを確認
3. 保存後に両ファイルがファイル一覧に残っていることを確認

日次トリガー `runDashboardUpdate` は Head 駆動のため、保存だけで翌朝の実行に反映される。
Webアプリのデプロイ版再発行は不要（`/exec` の挙動は変えていない）。

## ロールバック手順

目的に応じて3段階ある。上から順に軽い。

### 1. シート上の疑似行だけを今すぐ消す（コードは残す）

Apps Script エディタに以下を貼って実行する。**実行後、この関数は削除すること。**
次回の日次バッチで疑似行はまた作られるので、恒久停止したい場合は 2 か 3 を行う。

    function removeZeroLogRowsOnce() {
      var ss = getSpreadsheet();
      var sheet = ss.getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
      if (!sheet) { Logger.log('ai_dashboard が無い'); return; }
      var blocks = groupContiguousDesc_(findZeroLogRowNumbersDesc_(sheet.getDataRange().getValues()));
      var removed = 0;
      for (var i = 0; i < blocks.length; i++) {
        sheet.deleteRows(blocks[i].start, blocks[i].count);
        removed += blocks[i].count;
      }
      Logger.log('疑似行を削除: ' + removed + '行');
    }

関数名の末尾にアンダースコアを付けないこと（Apps Script は `_` で終わる関数を private 扱いし、
エディタの実行対象一覧に出さないため実行できない）。
`DashboardZeroLogCore.gs` を先に消してしまった場合は、スプレッドシート上で `student_id` 列を
`zerolog-` で始まる行だけにフィルタして手で削除する。

### 2. コードを撤回する（疑似行の生成を止める）

    cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
    git log --oneline -- gas-backend/src/DashboardService.gs gas-backend/src/DashboardZeroLogCore.gs
    git revert --no-commit <疑似行ブロック追加のコミット>
    git commit -m "revert: ゼロログ疑似行の生成を一時停止"

その後、上の「デプロイ手順」に従って本番へ反映する。反映後に 1 を実行して残った疑似行を掃除する。

注意: 名簿読み取りの委譲リファクタ・`refreshStudent` の疑似行再利用・LockService の導入は
それぞれ別コミットで、疑似行の生成とは独立している。revert 対象は疑似行ブロックのコミットだけにすること。

### 3. Looker 側の変更を戻す

計算フィールドやフィルタを変更した場合、Looker Studio のレポート編集画面の「バージョン履歴」から
変更前の版に戻せる。数式を手で戻す場合は、本ファイルの「Looker 側の変更記録」に控えた
**変更前の数式**を使う。

## 既知の穴

- **単問回答経路だけで学習した学生は誤判定される。** PWA の `submitAnswer`
  （`pwa-frontend/src/services/api.ts:67-83`）は `studentNumber` をペイロードに含めないため、
  この経路だけで学習した学生は全ログ行の `student_number` が空になり、ゼロログと判定されて
  実データ行とは別に疑似行が出る。その学生が一度でもバッチ同期（`sync.ts:25-34`）した時点で
  翌日の実行から解消する。恒久対処は `submitAnswer` に `studentNumber` を含めること（別issue）。
- **`report_group` が空欄の学生（在校生）は Stage 1 の対象外。** 全名簿への拡張は別途承認が必要。
- **判定の追随粒度は日次。** 日中の遷移は `refreshStudent` が疑似行を上書きすることで吸収する。
- **名簿の `student_number` が重複している行は先勝ちで1件だけ疑似行になる。** 除外件数は実行ログに出る。

## 実機検証記録

（Task 14 で追記）

## Looker 側の変更記録

（Task 15 で追記）
~~~

- [ ] **Step 3: 承認が得られなかったタスクの帰結を追記する**

Task 9 / Task 10 / Task 11 のいずれかがユーザーの却下でスキップされた場合、各タスクの Step 1 / Step 2B に書かれた文面を README の「既知の穴」節にそのまま追記する。すべて承認されていれば追記不要。

- [ ] **Step 4: 秘匿情報が入っていないことを確認する**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）" && grep -nE "[0-9]{10,}|docs\.google\.com|script\.google\.com|AKfyc" gas-backend/README-zerolog.md gas-backend/.claspignore
```
Expected: ヒット0件（スプレッドシートID・Script ID・デプロイURLが混入していないこと）

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/.claspignore gas-backend/README-zerolog.md
git commit -m "docs: ゼロログ疑似行の仕様・デプロイ・ロールバック手順を文書化し .claspignore を追加"
```

---

### Task 13: 本番 Apps Script へのデプロイ

**Files:**
- Modify: なし（本番プロジェクトへの反映作業）

**背景:** 本番 Apps Script には**リポジトリに存在しないファイルが2つある（`ParentReport.js` 279行 / `VideoDemo.js` 109行）**。`clasp push` はリモートのファイル集合をローカルで置き換えるため、素で押すとこの2つが消える。過去に同型の事故が2件（Zoom自動予約・Teams週次レポート）あり、今回が3件目。
加えて、Apps Script は全 `.gs`/`.js` が同一グローバルスコープで、**同名の `function` 宣言は後から評価されたファイルが黙って勝つ**（エラーも警告も出ない）。今回追加するグローバル識別子は、本番限定2ファイルとの衝突が未検証。

接続情報（Script ID・clasp 作業ディレクトリ・アカウント）は**プロジェクトメモリ `project_memoria_gas_backend_deploy` を参照**すること。

- [ ] **Step 1: どちらの手順で行くかユーザーに確認する**

以下を提示して選んでもらう。

> 手順A（clasp）: 一時ディレクトリに本番を clone → 差分と名前衝突を確認 → 本番限定の2ファイルを含めた状態で push。差分が機械的に確認できる。
> 手順B（エディタ手貼り）: Apps Script エディタで変更ファイルだけを作成・上書きする。2ファイルに触れないので事故確率が最も低い。今回の変更は3〜4ファイルなのでこちらでも実務的。

- [ ] **Step 2: リポジトリ内でのグローバル識別子の衝突が無いことを確認する**

Run:
```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend" && grep -rnE "function (normalizeStudentNumber_|normalizeMatchKey_|buildStudentNumbersWithLogs_|parseRosterValues_|buildNameMapFromRoster_|selectZeroLogRosterRecords_|toGradeNumber_|buildZeroLogDashboardRow_|findZeroLogRowNumbersDesc_|groupContiguousDesc_)\b|\b(ZEROLOG_ID_PREFIX|ZEROLOG_TEACHER_COMMENT|ZEROLOG_MAX_ROWS)\b" src/ | grep -v "^src/DashboardZeroLogCore.gs"</dev/null
```
Expected: `DashboardService.gs` / `TeacherCommentService.gs` からの**参照**のみがヒットし、`function ...` の**定義**は `DashboardZeroLogCore.gs` 以外に無いこと。

- [ ] **Step 3（手順A）: 本番を一時ディレクトリに clone し、差分と名前衝突を確認する**

```bash
mkdir -p "/private/tmp/claude-501/-Users-ny-Documents-MyVault-30-Work------Memoria-/096318ba-e891-48e5-ac97-d010ea0ec74e/scratchpad/gas-live"
cd "/private/tmp/claude-501/-Users-ny-Documents-MyVault-30-Work------Memoria-/096318ba-e891-48e5-ac97-d010ea0ec74e/scratchpad/gas-live"
# Script ID はプロジェクトメモリ project_memoria_gas_backend_deploy を参照して手で入力する
clasp clone <SCRIPT_ID>
ls -1
```
Expected: 本番のファイル一覧が出て、**`ParentReport.js` と `VideoDemo.js` が存在する**こと。存在しなければ以降を中止し、ユーザーに報告する（前提が崩れている）。

差分を取る。

```bash
cd "/private/tmp/claude-501/-Users-ny-Documents-MyVault-30-Work------Memoria-/096318ba-e891-48e5-ac97-d010ea0ec74e/scratchpad/gas-live"
diff -rq . "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src" | sort
```
Expected: 差分は次のものだけ。
- `DashboardService.gs` / `TeacherCommentService.gs`（Task 11 分岐Bなら `ImportService.gs`）が異なる
- `DashboardZeroLogCore.gs` がリポジトリ側にだけ存在
- `ParentReport.js` と `VideoDemo.js` が本番側にだけ存在
- `Only in .../gas-backend/src: .claude`（リポジトリ側にだけあるディレクトリ。正常）
- `.clasp.json` / `appsscript.json` の配置差
**これ以外の差分が出たら push せず、内容をユーザーに報告する**（本番が別途手編集されている可能性がある）。

本番限定2ファイルとのグローバル名前衝突を確認する。

```bash
cd "/private/tmp/claude-501/-Users-ny-Documents-MyVault-30-Work------Memoria-/096318ba-e891-48e5-ac97-d010ea0ec74e/scratchpad/gas-live"
grep -nE "function (normalizeStudentNumber_|normalizeMatchKey_|buildStudentNumbersWithLogs_|parseRosterValues_|buildNameMapFromRoster_|selectZeroLogRosterRecords_|toGradeNumber_|buildZeroLogDashboardRow_|findZeroLogRowNumbersDesc_|groupContiguousDesc_|withDashboardLock_|getRosterSheet_|getStudentRoster_|rebuildZeroLogRows_)\b|\b(ZEROLOG_ID_PREFIX|ZEROLOG_TEACHER_COMMENT|ZEROLOG_MAX_ROWS)\b" ParentReport.js VideoDemo.js
```
Expected: **ヒット0件**。1件でもヒットしたら push せず、衝突する関数・変数を `DashboardZeroLogCore.gs` 側でリネーム（例: `zlParseRosterValues_`）してから Task 1〜11 のコード・テストを更新し、やり直す。

- [ ] **Step 4（手順A）: 2ファイルを保持したまま push する**

clone した作業ディレクトリ側に、今回の変更ファイルだけをコピーしてから push する。`ParentReport.js` / `VideoDemo.js` は clone 済みなのでそのまま残る。

**必ず `.js` 名で上書きすること（2026-08-23 の実施時に判明した罠）。** clone されるファイルは全て `.js` だが、`.clasp.json` の `scriptExtensions` は `[".js", ".gs"]` の**両方**である。`.gs` のままコピーすると `DashboardService.js` と `DashboardService.gs` が**別ファイルとして両方 push され**、`const DashboardService` が二重宣言になって**本番プロジェクト全体が構文エラーで停止する**。

```bash
SRC="/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/src"
DST="/private/tmp/claude-501/-Users-ny-Documents-MyVault-30-Work------Memoria-/096318ba-e891-48e5-ac97-d010ea0ec74e/scratchpad/gas-live"
cp "$SRC/DashboardService.gs" "$DST/DashboardService.js"
cp "$SRC/DashboardZeroLogCore.gs" "$DST/DashboardZeroLogCore.js"
cp "$SRC/TeacherCommentService.gs" "$DST/TeacherCommentService.js"
cd "$DST" && ls -1 && clasp push
```
Expected: push 結果のファイル一覧に `ParentReport.js` と `VideoDemo.js` が**含まれている**こと。含まれていなければ即座にユーザーへ報告する（本番から消える）。
（Task 10 / Task 11 が却下でスキップされた場合、対応する `cp` 行は実行しない。変更していないファイルをコピーしても内容は同じなので害は無いが、差分を最小にするため）

- [ ] **Step 5（手順B）: エディタで変更ファイルだけを更新する**

1. Apps Script エディタを開く（プロジェクトメモリ `project_memoria_gas_backend_deploy` の手順で開く）
2. 左のファイル一覧に `ParentReport.js` と `VideoDemo.js` があることを確認する（無ければ中止して報告）
3. `ParentReport.js` と `VideoDemo.js` を開き、Step 3 の grep と同じ識別子（`normalizeStudentNumber_` / `parseRosterValues_` / `toGradeNumber_` / `ZEROLOG_*` など）が定義されていないことをエディタの検索で確認する。定義があればリネームしてからやり直す
4. 「＋ > スクリプト」で `DashboardZeroLogCore` を新規作成し、`gas-backend/src/DashboardZeroLogCore.gs` の全文を貼り付けて保存
5. `DashboardService.gs` を開き、全選択して `gas-backend/src/DashboardService.gs` の全文で置き換えて保存
6. Task 10 / Task 11 分岐A を実行した場合は `TeacherCommentService.gs` も同様に置き換えて保存
7. Task 11 分岐B を実行した場合は `ImportService.gs` も同様に置き換えて保存
8. 保存後、左のファイル一覧に `ParentReport.js` / `VideoDemo.js` が**まだ存在すること**を再確認する

- [ ] **Step 6: デプロイ版の再発行は行わないことを確認する**

日次トリガー `runDashboardUpdate` は Head 駆動のため、保存（または push）だけで翌朝の実行に反映される。**Webアプリ `/exec` の挙動は今回変更していないので、デプロイ版の再発行はしない。**（再発行すると無関係な差分まで本番Webアプリに乗る）

---

### Task 14: 実機検証（GAS 側）

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/README-zerolog.md`（「実機検証記録」節に追記）

**注意:** ここまでの全ての主張は「未検証（Node のテストは純粋関数のみ）」である。以下を実行するまで「動いた」と言ってはならない。

- [ ] **Step 1: 実行前の `ai_dashboard` の状態を記録する**

Apps Script エディタに以下を貼って実行し、ログの3つの数値を控える。**確認が終わったら必ずこの関数を削除する**（本番プロジェクトに残さない）。関数名の末尾にアンダースコアを付けないこと（`_` で終わる関数はエディタの実行対象一覧に出ない）。

```javascript
function inspectDashboardGrid() {
  var sheet = getSpreadsheet().getSheetByName(CONFIG.SHEETS.AI_DASHBOARD);
  var zero = findZeroLogRowNumbersDesc_(sheet.getDataRange().getValues()).length;
  Logger.log('lastRow=' + sheet.getLastRow() + ' maxRows=' + sheet.getMaxRows() + ' zerolog行=' + zero);
}
```

Expected: 初回は `zerolog行=0`。`lastRow` と `maxRows` を控える（`maxRows` は Step 4 の判定に使う）。

- [ ] **Step 2: `updateAll()` を手動実行する**

Apps Script エディタで関数 `runDashboardUpdate` を実行し、実行ログを確認する。

Expected:
- 実行が成功する
- ログに `ゼロログ疑似行: 名簿 …件 / コホート対象 …件 / ログ有りで除外 …件 / …/ 疑似行の対象 N件` が出る
- ログに `ゼロログ疑似行: 削除 0行 / 追加 N行` が出る
- **N が 24 以下**であること（`report_group` 非空の24名のうち、既に学習実績がある者を除いた数）。内訳は1行目のログで説明できる
- `ゼロログ疑似行: … 中止` が出ていないこと（出ていたら Step 6 へ）

- [ ] **Step 3: `ai_dashboard` を目視する**

以下を全て確認する。1つでも満たさなければ実装に戻る。

- `student_id` が `zerolog-` で始まる行が N 行ある
- 各疑似行の `student_number` / `student_name` / `department` が名簿と一致している
- `grade` 列が**数値として右寄せ表示**されている（文字列なら左寄せになる。列の型が壊れるリスクの目視チェック）
- `total_questions` / `correct_rate` / `streak_days` が 0
- `ai_comment` が空、`teacher_comment` が固定文言
- `last_study_date` が空
- **通常学生の行が壊れていない**（実行前に控えた `lastRow` ＋N になっていること、既存学生の `total_questions` が0に書き換わっていないこと）

- [ ] **Step 4: 2回目を実行して冪等性とグリッド行数を確認する**

もう一度 `runDashboardUpdate` を実行し、続けて `inspectDashboardGrid` を実行する。

Expected:
- ログが `ゼロログ疑似行: 削除 N行 / 追加 N行` になる
- `lastRow` が1回目実行後と**変わらない**（増えていれば削除ロジックが効いていない）
- **`maxRows` が1回目実行後と変わらない**。N だけ減っていたら `insertRowsAfter` のガードが効いておらず、毎日グリッドが目減りする（＝いずれ書き込みだけが落ちて「削除だけ済む」状態になる）ので、Task 8 Step 1 の追記ブロックを見直す

- [ ] **Step 5: 実行時間を記録する**

Apps Script の「実行数」画面で `runDashboardUpdate` の所要時間を確認し、控える。6分（360秒）の上限に対する余裕を記録に残す。**300秒を超えていた場合**は、ユーザーに報告し、`rebuildZeroLogRows_` を独立トリガー（例: 5時の `runZeroLogSync`）に分離する案を提示して判断を仰ぐ（本計画では分離しない。理由は「別issue」節を参照）。

- [ ] **Step 6: N が 0 だった / 中止ログが出た場合の切り分け**

Apps Script エディタに以下の一時関数を貼り、実行してログを読む。**確認が終わったら必ずこの関数を削除する**。

```javascript
function debugZeroLogSelection() {
  var ss = getSpreadsheet();
  var allLogs = DashboardService.collectAllLogs(ss);
  var roster = DashboardService.getStudentRoster_();
  if (roster === null) { Logger.log('名簿の取得に失敗（null）。STUDENT_LIST_ID と共有権限を確認'); return; }

  var withLogs = buildStudentNumbersWithLogs_(allLogs);
  var selection = selectZeroLogRosterRecords_(roster, withLogs);
  var withLogsCount = 0;
  for (var k in withLogs) withLogsCount++;

  Logger.log('名簿件数: ' + roster.length);
  Logger.log('report_group 非空: ' + selection.groupRows);
  Logger.log('report_group が boolean: ' + selection.booleanGroupRows);
  Logger.log('ログを持つ学籍番号: ' + withLogsCount);
  Logger.log('ログ有りで除外: ' + selection.withLogsExcluded);
  Logger.log('学籍番号重複で除外: ' + selection.duplicateNumbers.length);
  Logger.log('疑似行の対象: ' + selection.records.length);
}
```

切り分けの読み方:
- `名簿の取得に失敗（null）` → `STUDENT_LIST_ID` が未設定、シート名が `students` でない、または共有権限が外れている
- `名簿件数: 0` → シートにデータ行が無い、または `student_number` 列のヘッダー名が違う
- `report_group 非空: 0` かつ `report_group が boolean: N` → E列がチェックボックス列に変更されている
- `report_group 非空: 0` かつ boolean も0 → 列名が `report_group` でない、または値が消えている
- `ログを持つ学籍番号` が名簿件数と同数 → 対象者全員に学習実績がある（正常。疑似行は不要）
- `ログ有りで除外` が想定より多い → 名簿とログの表記ゆれが正規化で吸収された結果か、別人の番号が混ざっている

- [ ] **Step 7: 検証記録を README に追記してコミット**

`gas-backend/README-zerolog.md` の「## 実機検証記録」節に、実行日時・ログの数値（名簿件数 / コホート対象 / 除外内訳 / N）・`lastRow` と `maxRows` の前後・実行時間・目視結果を**事実として**追記する（推測は書かない）。学生の実名・実在の学籍番号は書かない。

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/README-zerolog.md
git commit -m "docs: ゼロログ疑似行の実機検証記録を追記"
```

---

### Task 15: Looker Studio 側の確認と NULL 伝播への対処

**Files:**
- Modify: `/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/gas-backend/README-zerolog.md`（「Looker 側の変更記録」節に追記）

**背景（未確認事項として明記する）:** GAS が疑似行を書いても、Looker 側で除外されれば教員には見えない。以下は**すべて未確認**であり、Task 14 が成功しても本タスクが終わるまで「解決した」と言ってはならない。

- 計算フィールド「未学習日数」「リスク判定」「学年ラベル」「学科ラベル」の実定義（未確認）
- 「要注意学生リスト」ウィジェットのフィルタ条件（未確認）
- レポート／ウィジェットの「デフォルトの日付範囲ディメンション」の設定（未確認）
- `ai_dashboard` データソースにおける `last_study_date` / `grade` 列の型推定（未確認）

Looker Studio の `CASE WHEN` は SQL の三値論理に従い、NULL はどの条件にも一致せず ELSE（無ければ NULL）に落ちる（Google 公式ドキュメントの仕様）。空文字が NULL として解釈されると「未学習日数」→「リスク判定」が NULL 化し、**GAS は成功したのに Looker には何も出ない**という、今回とそっくりの症状が別の理由で再発しうる。

- [ ] **Step 1: データソースの型推定を確認する**

Looker Studio でレポートを編集モードで開き、`ai_dashboard` データソースのフィールド一覧を見て控える。

- `grade` の型が「数値」のままか（テキストに変わっていたら `toGradeNumber_` が効いていない＝行に文字列が混入している。Task 14 Step 3 の右寄せ確認に戻る）
- `last_study_date` の型が何か（テキスト／日付）
- `total_questions` が「数値」のままか

**型が変わっていた場合は、データソース編集画面でフィールドの型を元に戻し、レポートを再読み込みする。**

- [ ] **Step 2: 疑似行がデータソースに届いているかを最短経路で確認する**

「探索」または新規のスコアカード／表を一時的に作り、ディメンション `student_id`・指標 `total_questions` で、`student_id` に `zerolog` を含む行が出るか見る。

- 出る → データは届いている。Step 3 へ（除外しているのはウィジェット側のフィルタか計算フィールド）
- 出ない → キャッシュの可能性。右上「データを更新」を実行して再確認。それでも出なければデータソースの接続範囲（シート範囲指定が固定行数になっていないか）を確認する

- [ ] **Step 3: 現状の定義を「変更前」として記録する**

以下をすべて控え、**この時点で README の「## Looker 側の変更記録」に「変更前」として追記してコミットする**（変更後だけを記録するとロールバックできなくなる）。

- 「要注意学生リスト」ウィジェットに適用されているフィルタ条件（フィールド名・演算子・値）
- 同ウィジェットの期間ディメンションの設定
- 「リソース > 計算フィールドを管理」または各フィールドの編集画面から、「未学習日数」「リスク判定」「学年ラベル」「学科ラベル」の**実際の数式**（全文）

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/README-zerolog.md
git commit -m "docs: Looker の計算フィールドとフィルタ条件を変更前の状態として記録"
```

- [ ] **Step 4: 判定と対処（該当する分岐だけを実行する）**

**分岐A: 「未学習日数」が `last_study_date` 由来で、疑似行が NULL になっている場合**

現象: 疑似行の「未学習日数」が空欄になり、「リスク判定」も空欄になる。

対処（データソース側の計算フィールドを編集）:
1. 「未学習日数」の数式を、NULL を最大値に潰す形に変える。既存が
   `DATE_DIFF(CURRENT_DATE(), PARSE_DATE("%Y-%m-%d", last_study_date))` の形なら
   `IFNULL(DATE_DIFF(CURRENT_DATE(), PARSE_DATE("%Y-%m-%d", last_study_date)), 9999)` にする
2. `last_study_date` がテキスト型で空文字が NULL にならない場合は、先に
   `IF(last_study_date = "", NULL, PARSE_DATE("%Y-%m-%d", last_study_date))` で明示的に NULL 化してから 1 を適用する
3. 保存後、「要注意学生リスト」に疑似行が出るか確認する

**分岐B: 「リスク判定」の CASE に未着手のケースが無い場合**

現象: 「未学習日数」は 9999 等で出るのに、「リスク判定」が空欄またはリストに出ない。

対処:
1. 「リスク判定」の `CASE` 文の**最初の WHEN** に未着手ケースを足す:
   `CASE WHEN total_questions = 0 THEN "未着手" WHEN 未学習日数 >= 14 THEN "要注意" ... ELSE "順調" END`
   （既存の WHEN 群・ELSE はそのまま残す。`total_questions = 0` を先頭に置くのは、未着手が
   「未学習日数」の値に依存せず確定する事実だから）
2. `ELSE` 句が無ければ `ELSE "判定不能"` を足す（NULL を残さない）
3. 保存後、「要注意学生リスト」に「未着手」が出るか確認する

**分岐C: ウィジェットのフィルタが疑似行を落としている場合**

現象: 計算フィールドは正しい値を返すのに、リストに出ない。

対処（どちらか一方）:
- フィルタ条件が「リスク判定 が 要注意 と等しい」なら、`OR` 条件で「リスク判定 が 未着手 と等しい」を追加する
- フィルタ条件が「未学習日数 >= 14」のような数値条件なら、`OR` で「total_questions が 0 と等しい」を追加する

**分岐D: 期間ディメンションが `last_study_date` になっている場合**

現象: 疑似行だけが期間フィルタで落ちる（`last_study_date` が空のため範囲外扱い）。

対処（どちらか一方）:
- ウィジェットの「期間ディメンション」を「なし」に設定する（要注意学生リストは最新スナップショットを見るものなので期間は不要）
- 期間ディメンションが必要な場合は `updated_at` に変更する（毎回のバッチで必ず書かれるので疑似行も範囲に入る）

**分岐E: どれにも該当せず疑似行が出ない場合**

Step 2 に戻り、データソースのキャッシュ更新（右上「データを更新」）と、データソースのシート範囲設定（「最初の行をヘッダーとして使用」「範囲」）を確認する。それでも解決しない場合は、判明した事実（どの分岐まで確認して何が観測されたか）を列挙してユーザーに報告し、**推測でウィジェットを作り替えない**。

- [ ] **Step 5: 疑似行からの遷移先を確認する**

「要注意学生リスト」の行から「教員向けAI分析」を開く導線がある場合、**疑似行を1件クリックして遷移先を確認する**。

- Task 10 を実施した場合の Expected: 固定文言のコメントページが表示され、エラーページにならない
- Task 10 をスキップした場合の Expected: 24時間以内なら固定文言、超過するとエラーページ（`対象学生の学習データが見つかりません`）。**観測結果をそのまま README に記録する**（推測で「たぶん大丈夫」と書かない）
- 導線自体が存在しない場合: 「導線なし」と記録する

- [ ] **Step 6: 変更内容と確認結果を記録してコミット**

`gas-backend/README-zerolog.md` の「## Looker 側の変更記録」に、分岐A〜Dのどれを適用したか・**変更後の数式全文**・Step 5 の観測結果を追記する。**Looker の実画面のスクリーンショットは共有しない**（社内NG）。

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/README-zerolog.md
git commit -m "docs: Looker側の確認結果とNULL伝播への対処を記録"
```

---

## 別issue（本計画のスコープ外。実装しない。記録のみ）

以下は今回の調査で判明したが、本計画では**触らない**。疑似行の実装がこれらに依存しないよう設計してある。それぞれ独立の課題として起票すること。

| # | 症状 | 分かっている原因 | 本計画との関係 |
|---|---|---|---|
| A | 「要注意学生リスト」に氏名が空の行が複数ある（名簿に存在しない学籍番号が入っている） | ログ側の `student_number` に名簿と対応しない値が入っている行がある。入力経路は未特定 | 疑似行は名簿を正本にするため影響を受けない。ただしこのゴミ行は疑似行を入れても残る。なお疑似行側は `student_name` が空なら `student_number` にフォールバックするので、疑似行が「氏名空の行」を新たに増やすことはない |
| B | 同一学籍番号・同一氏名で最終学習日が1日違う行が2件ある | 1人が複数の studentId(UUID) を持つと `ai_dashboard` 上で別人として重複表示される。UUID は PWA が端末ごとに `crypto.randomUUID()` で発行するため、端末やブラウザを変えると増える | 疑似行の判定は「学籍番号がログ側に1度でも現れたか」なので、複数UUIDでも重複して疑似行を作ることはない（Task 1・Task 4 でテスト済み） |
| C | `analyzeStudent`（`DashboardService.gs:598-599`）が `logs[logs.length - 1]` の1件だけから `studentNumber` を取る | 最後のログが単問回答経路（`student_number` 空）だと、学籍番号を持つ学生でも `ai_dashboard.student_number` が空欄になる | 本計画の判定は全ログ行を見るため、このバグの影響を受けない。ただし**既存の通常行の `student_number` 欠落は直らない**。`updateCategoryStats:239-240` も同じ形をしている |
| D | 回答ログの二重登録（`sync.ts` の失敗時再送＋冪等キー不在） | プロジェクトメモリ `project_memoria_duplicate_answer_logs` に記録済み | 疑似行の判定は件数を使わないため影響なし |
| E | `AnswerService.updateStudentNumber`（`AnswerService.gs:105-152`）がアーカイブシートを更新しない | 学籍番号を改番すると、`student_logs_YYYY_MM` に旧番号が残り続ける | 本計画は全ログ行から**両方**の番号を集合に入れるため誤判定しない（Task 1 でテスト済み）。ただしデータとしての不整合は残る |
| F | 単問回答経路（`pwa-frontend/src/services/api.ts:67-83`）が `studentNumber` を送らない | `AnswerService.submitAnswer` は `student_number: studentNumber || ''` を書くため空文字になる | **本計画に残る既知の穴。** この経路だけで学習した学生はゼロログと誤判定される。一度でもバッチ同期（`sync.ts:25-34`）すれば翌日の実行で自動解消する。恒久対処は `submitAnswer` に `studentNumber` を含めること |
| G | `rebuildZeroLogRows_` を独立トリガーに分離する案 | `updateAll` は学生ごとに最大2秒 `Utilities.sleep` するため、6分上限に対する余裕が読めない。疑似行の再構築は最後尾に置かれる | **今回は分離しない。** 分離すると `collectAllLogs` の再実行コストと2本目のトリガー運用が増え、失敗経路も倍になる。まず Task 14 Step 5 で実行時間を実測し、300秒を超えていたら改めて判断する |

Stage 2（`report_group` の有無を問わず全名簿138名へ拡張）は、**別途ユーザー承認を得てから**着手する。行数が 24 → 130前後に増えるため、Looker のリスト表示・フィルタ運用への影響と `ZEROLOG_MAX_ROWS` の引き上げを先に検討する必要がある。

---

## 完了条件

- [ ] `gas-backend/tests/dashboard_zerolog_core.test.js` が `node --test tests/dashboard_zerolog_core.test.js` で全件 PASS（**71 tests / 0 fail**）
- [ ] テストが以下の入力を実際に網羅している: `student_number` 空文字・空白のみ / 同一 studentId のログで空と非空が混在（末尾が空） / 同一 studentId に異なる学籍番号2件 / 同じ学籍番号に複数UUID / 学籍番号の数値型・前ゼロ・全角数字・小文字英字・前後の半角/全角空白 / `report_group` 空欄・空白のみ・別コホート名・数値・Date・boolean false・boolean true・`'-'` / `grade` 空欄・全角数字・`'4年'`・`'abc'`・数値・数値文字列・null・undefined・0・Date・boolean・範囲外・小数 / 名簿0件・null / ログ0件・null / 名簿の同一 `student_number` 重複 / ヘッダーの前後空白・列順入れ替え・列欠落 / `student_id` 列欠落・前方一致以外・数値セル / 連続行と非連続行の削除ブロック
- [ ] `node --check < src/DashboardService.gs` / `< src/DashboardZeroLogCore.gs` / `< src/TeacherCommentService.gs` / `< src/ImportService.gs` がすべて通る（`<` 無しの形は環境依存で必ず失敗するので使わない）
- [ ] ホモグリフ検査（Task 6 Step 5）が `homoglyph-check-ok` を返す
- [ ] `getStudentNameMap()` の戻り値の形と「例外を投げない」挙動が従来どおりで、生キー＋trim 済みキーの両方が登録されることをテストで確認済み。6箇所の呼び出し元を壊していないことをコード読みで確認済み
- [ ] `updateCategoryStats` と `category_stats` シートに一切変更を入れていない
- [ ] 疑似行の生成経路で `generateAiComment` / `generateTeacherComment` / `Utilities.sleep` を呼んでいない
- [ ] 名簿が取得できない（null）・0件のときに1行も削除せず中止することをコード読みで確認済み
- [ ] `setValues` の直前に `getMaxRows()` を見て `insertRowsAfter` していることをコード読みで確認済み
- [ ] 本番 Apps Script に反映済みで、**`ParentReport.js` と `VideoDemo.js` が本番に残っている**ことを反映後に確認済み
- [ ] 本番限定2ファイルに、追加したグローバル識別子と同名の定義が無いことを grep で確認済み
- [ ] `runDashboardUpdate` を手動実行し、内訳ログと `ゼロログ疑似行: 削除 x行 / 追加 N行` が出て成功している
- [ ] 2回連続実行しても `ai_dashboard` の `lastRow` と **`maxRows` の両方**が変わらない（冪等性とグリッド非目減りを実測で確認）
- [ ] `ai_dashboard` に `zerolog-` 行が N 行あり、`grade` が数値として右寄せ表示され、通常学生の行が壊れていない
- [ ] `runDashboardUpdate` の実行時間を実測して記録済み（300秒超なら別issue G としてユーザーに報告済み）
- [ ] Looker の「要注意学生リスト」に、一度も解いていない学生が**実際に表示されている**（Task 15 の分岐のどれを適用したかと、変更前・変更後の数式の両方を記録済み）
- [ ] 疑似行からの「教員向けAI分析」導線の挙動を実際に確認して記録済み（導線が無い場合は「導線なし」と記録）
- [ ] `gas-backend/README-zerolog.md` に仕様・デプロイ手順・ロールバック手順・既知の穴・実機検証記録・Looker 変更記録が揃っている（他タスクで後から作られる節への宙吊り参照が無い）
- [ ] コミットしたファイルに学生の実名・スプレッドシートID・Script ID・実在の学籍番号が含まれていない（`git log -p` で最終確認）
- [ ] 一時的にエディタへ貼った検証・ロールバック用関数（`inspectDashboardGrid` / `debugZeroLogSelection` / `removeZeroLogRowsOnce`）を本番プロジェクトから削除済み

---

## レビュー記録

3つのレビューレンズからの指摘を、すべて (a) 計画に反映 または (b) 不採用の理由を明記 のいずれかで処理した。

| レンズ | 指摘件数 | 全面採用 | 方針変更のうえ採用 | 部分採用（一部不採用） | 無視 |
|---|---|---|---|---|---|
| requirements | 16（F1〜F16） | 15 | 1（F5） | 0 | 0 |
| failure-modes | 13（S1〜S12＋品質メモ） | 9 | 0 | 4（S5 / S7 / S10 / S6） | 0 |
| gas-correctness | 13（F1〜F13） | 13 | 0 | 0 | 0 |
| **合計** | **42** | **37** | **1** | **4** | **0** |

### 反映先の対応表（抜粋）

| 指摘 | 反映先 |
|---|---|
| requirements-F1 / gas-correctness-F1（`node --check` が `.gs` で失敗） | 前提節・Task 0 Step 3・Task 6〜11 の全構文チェックを `node --check < file` に変更。requirements は「`.js` へコピーして check」を提案したが、**一時ファイルを作らない stdin 方式を採った**（gas-correctness が実測で確認済みの方法。ファイル名が出ない点は両案とも同じ） |
| requirements-F2 / failure-modes-S2 / gas-correctness-F2（グリッド行数の目減り） | Task 8 Step 1 に `getMaxRows()` + `insertRowsAfter` ガード。Task 8 Step 4 の目視項目を修正。Task 14 Step 1/4 に `maxRows` の前後実測を追加 |
| requirements-F3 / gas-correctness-F3（末尾 `_` の関数はエディタから実行不可） | `debugZeroLogSelection` / `removeZeroLogRowsOnce` / `inspectDashboardGrid` から末尾 `_` を除去。README にも理由を明記 |
| requirements-F4 / failure-modes-S9 / gas-correctness-F6（氏名マップのキー正規化変更） | Task 3 で `buildNameMapFromRoster_` を新設し、**生キーと trim 済みキーの両方**を登録。回帰テスト5件を追加。Task 2 で `studentNumberRaw` を保持 |
| requirements-F5 / failure-modes-S3（中間マップが情報を落とす） | **設計判断3の実装方式を変更**。`buildStudentNumberByStudentId_` を廃止し1パス集合化。理由を「設計判断」節に明記 |
| requirements-F6（`automation/` は公開除外という前例の差） | Task 0 Step 1 の承認テキストに `.gitignore:33` と「`gas-backend/tests/` は公開される」を明記 |
| requirements-F7（Task 11 が存在しない記録を参照） | Task 15 Step 3 で**変更前の数式を先にコミット**する手順を独立ステップ化。Step 6 で変更後を追記 |
| requirements-F8 / gas-correctness-F7-1（コードブロックの文字化け） | 該当コードを正しい日本語で書き直し、「目視で直せ」という注記を削除。加えて Task 6 Step 5 に機械的なホモグリフ検査を追加（failure-modes 品質メモ） |
| requirements-F9 / gas-correctness-F5（本番限定2ファイルとの名前衝突） | Task 13 Step 2（リポジトリ内）・Step 3（clone 先、中止条件つき）・Step 5-3（エディタ手順）に grep を追加。README のデプロイ手順にも記載 |
| requirements-F10（実在の学籍番号をフィクスチャに使用） | 全フィクスチャを `X001` / `X900` / `9001` / `0091` / `０９０…` 等の架空値に置換。前提節に「実在するテスト行の番号は書かない」を明記 |
| requirements-F11（到達不能な数値型テスト） | **テストは削除せず残した**（レンズは「害は無いが将来パーサの正規化を外した変更を素通しさせる」と指摘）。理由: 本計画の指示は「レンズが挙げた入力は全量テストに追加する」であり、削るのは逆行する。代わりにテスト名と実装コメントに「防御。通常は parse 側で文字列化される」と明記して契約を誤読させないようにした |
| requirements-F12 / gas-correctness-F8（`toGradeNumber_` の死にコードと範囲） | `typeof value === 'boolean'` の明示除外＋`Number.isInteger` ＋0〜9 の範囲判定に変更。Date・boolean・範囲外・小数のテストを追加 |
| requirements-F13（README の宙吊り参照） | README を Task 12 で**ロールバック手順まで完成**させ、後続タスクは既存の空節（実機検証記録／Looker 側の変更記録）に追記するだけにした。旧 Task 11（ロールバック文書化）は廃止 |
| requirements-F14 / gas-correctness-F7-2,3（Files ヘッダーの行番号ずれ） | 実ファイルを読んで確認し、Task 7 は `476-516`、Task 8 は `182-190`、Task 9 は `982-999`、Task 10 は `64-66`、Task 11 は `210-233` / `464-472` に訂正 |
| requirements-F15（Task 8 のステップ番号衝突） | Task 13 で Step 1〜6 の単一系列に再採番（手順A/Bは Step 3-4 と Step 5 に分離） |
| requirements-F16 / gas-correctness-F9（名簿の読み取り回数） | Task 7 Step 3 で `updateAll` が名簿を1回だけ読み、`nameMap` と `rebuildZeroLogRows_` で共有する形に変更。コミットメッセージも実態に合わせて修正（`updateCategoryStats` の署名は変えないため、全体では従来と同じ2回） |
| failure-modes-S1（削除が先で材料が後） | Task 8 Step 1 で処理順を「材料確定 → 中止判定 → 読み直し → 削除 → 追記」に変更。`getStudentRoster_` は取得失敗を `null`、0件を `[]` で返し分ける（Task 7） |
| failure-modes-S4（前ゼロ・全角の表記ゆれ） | Task 1 で `normalizeMatchKey_` を新設（全角→半角・大文字化・全桁数字の前ゼロ潰し）。突合のみに使い、`student_id` 生成には使わない。指摘された入力を全量テスト化 |
| failure-modes-S5（`report_group` の型ゆれ） | boolean を型で除外＋`ZEROLOG_MAX_ROWS`（40）のブレーカーを追加。**`'-'` `'なし'` 等の文字列ブロックリストは不採用**（隠れたルールが増え、`-` を正式なコホート名にしたときに無言で0件になる＝設計判断6が防ごうとした再発と同型になるため）。`'-'` が対象化する挙動をテストで固定し、ブレーカーで受ける方針を明記 |
| failure-modes-S6（日中の二重表示） | Task 9 で `refreshStudent` が疑似行を再利用するよう変更（Task 0 の承認が必要）。「判定結果が変わった瞬間に自動追随する」という文言を「追随の粒度は日次。日中は refreshStudent が吸収」に修正。**恒久化する変種（単問経路のみの学習者）は別issue F として記録し、本計画では直さない** |
| failure-modes-S7（6分上限） | 処理順の是正と `deleteRows` の連続区間まとめを採用。Task 14 Step 5 に実行時間の実測を追加。**独立トリガーへの分離は不採用**（トリガーと失敗経路が倍増し `collectAllLogs` を二重に走らせるため。300秒超なら別issue G として再判断する条件つき） |
| failure-modes-S8（名簿の重複を静かに畳む） | `selectZeroLogRosterRecords_` が除外理由の件数と重複番号を返すよう変更し、Task 8 で内訳をログ出力。Task 14 Step 2 の期待値を「内訳ログで N を説明できること」にした |
| failure-modes-S10（`student_name` 空値の混入） | `buildZeroLogDashboardRow_` で `student_name` が空なら `student_number` にフォールバック（既存規約 `DashboardService.gs:241-243` に準拠）。**`department` の空は埋めない**（存在しない学科名を捏造すると Looker の学科フィルタに偽の選択肢が出るため）。代わりに空件数を Task 8 のログに出す |
| failure-modes-S11（疑似行からの AI 分析リンク） | Task 10 で `generateAndDisplay` に疑似行ガードを追加（Task 0 の承認が必要）。Task 15 Step 5 に実機での遷移確認を追加 |
| failure-modes-S12 / gas-correctness-F4（行番号レース） | Task 11 で `withDashboardLock_` を新設し、再構築・`refreshStudent`・`saveTeacherComment` の3経路すべてに適用（Task 0 の承認が必要）。承認が得られない場合の分岐Bとして、`updateAllDashboards` の確認ダイアログに警告文を出す代替を用意。`ImportService.gs:464` の日中手動実行経路を背景に明記 |
| gas-correctness-F10（`.claspignore` 不在・`src/.claude` の差分） | Task 12 で `.claspignore` を作成。Task 13 Step 3 の想定差分リストに `Only in .../src: .claude` を追加 |
| gas-correctness-F11（部分失敗時のカウンタと失われるスタック） | `rebuildZeroLogRows_` が集計オブジェクトを参照渡しで受け取り、途中経過を呼び出し側の catch から読めるようにした。`Logger.log` は `e.stack` を出す |
| gas-correctness-F12（疑似キー非衝突の論拠） | README に「v4 UUID とは原理的に衝突しないが、`student_id` は UUID を強制していないので `zerolog-` 始まりの値を手で入れないこと」と記載 |
| gas-correctness-F13（`deleteRow` の一括化） | Task 6 で `groupContiguousDesc_` を新設し、Task 8 で `deleteRows(start, count)` を使用 |
