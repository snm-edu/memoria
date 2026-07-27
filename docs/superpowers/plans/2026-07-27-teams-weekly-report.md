# 既卒生メモリア週次レポート Teams送信 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2026年度既卒生24名のメモリア実施状況を、毎週月曜7時に藤吉先生のTeamsチャットへ自動送信する。

**Architecture:** 純粋ロジック（週の範囲計算・状態判定・メッセージ整形）を GAS API に依存しない `TeamsWeeklyReportCore.gs` に分離し、Node の `node:test` で自動テストする。Google Sheets 読み書き・メール・HTTP送信は `TeamsWeeklyReport.gs` に隔離し、Apps Script 上で手動検証する。送信先は Power Automate の HTTP トリガーで、そこから Teams チャットへ投稿する。

**Tech Stack:** Google Apps Script（V8）／ Google Sheets ／ Power Automate ／ Node.js `node:test`（純粋関数のテスト専用、本番実行には不要）

**設計書:** `docs/superpowers/specs/2026-07-27-teams-weekly-report-design.md`

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `automation/teams-weekly/TeamsWeeklyReportCore.gs` | 純粋関数のみ。日付計算・状態判定・並び替え・メッセージ整形。GAS API を一切呼ばない |
| `automation/teams-weekly/TeamsWeeklyReport.gs` | Sheets読み書き・ScriptProperties・UrlFetchApp・MailApp・トリガー。エントリポイント |
| `automation/teams-weekly/SetupReportGroup.gs` | 初回導入用。氏名リストから `students` シートの `report_group` 列を埋める |
| `automation/teams-weekly/tests/core.test.js` | `TeamsWeeklyReportCore.gs` の自動テスト（Node） |
| `automation/teams-weekly/README.md` | 導入手順・Power Automate フロー作成手順・運用手順 |

> **Git 方針:** このリポジトリは Public であり、`automation/` は `.gitignore` 済み
> （学内運用の自動化を公開リポジトリに含めない方針。既存の `parent-report` /
> `zoom-scheduler` も同じ扱い）。**本計画で作るファイルは一切コミットしない。**
> 正本は Apps Script プロジェクト側で、ローカルファイルは編集用の控えである。
> 学生の実名をコード・ドキュメントに書かないこと。

`.gs` ファイルは末尾で `module.exports` を条件付きで公開する。Apps Script では `module` が
未定義なのでこの行は無視され、Node からは `require('./TeamsWeeklyReportCore.gs')` で読める
（Node は未知の拡張子を CommonJS の JS として読む。検証済み）。

---

### Task 1: 週の範囲を求める純粋関数

**Files:**
- Create: `automation/teams-weekly/TeamsWeeklyReportCore.gs`
- Test: `automation/teams-weekly/tests/core.test.js`

日付は全て `'yyyy-MM-dd'` 文字列で扱う。タイムゾーン依存のバグを避けるため、
内部計算は UTC ミリ秒に変換して行う（JST への変換は GAS 層の責務）。

- [ ] **Step 1: 失敗するテストを書く**

`automation/teams-weekly/tests/core.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const core = require('../TeamsWeeklyReportCore.gs');

test('addDaysYmd_ は日をまたいで正しく加減算する', () => {
  assert.strictEqual(core.addDaysYmd_('2026-07-27', -7), '2026-07-20');
  assert.strictEqual(core.addDaysYmd_('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(core.addDaysYmd_('2026-12-31', 1), '2027-01-01');
});

test('diffDays_ は2つの日付の日数差を返す', () => {
  assert.strictEqual(core.diffDays_('2026-07-20', '2026-07-27'), 7);
  assert.strictEqual(core.diffDays_('2026-07-27', '2026-07-27'), 0);
});

test('previousWeekRange_ は月曜実行時に先週の月〜日を返す', () => {
  assert.deepStrictEqual(core.previousWeekRange_('2026-07-27'), {
    start: '2026-07-20',
    end: '2026-07-26',
  });
});

test('previousWeekRange_ は週の途中に実行しても同じ先週を返す', () => {
  // 2026-07-29 は水曜。今週の月曜は 07-27 なので先週は 07-20〜07-26
  assert.deepStrictEqual(core.previousWeekRange_('2026-07-29'), {
    start: '2026-07-20',
    end: '2026-07-26',
  });
});

test('previousWeekRange_ は日曜実行時も同じ週の月曜を基準にする', () => {
  // 2026-08-02 は日曜。今週の月曜は 07-27 なので先週は 07-20〜07-26
  assert.deepStrictEqual(core.previousWeekRange_('2026-08-02'), {
    start: '2026-07-20',
    end: '2026-07-26',
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test automation/teams-weekly/tests/core.test.js`
Expected: FAIL（`Cannot find module '../TeamsWeeklyReportCore.gs'`）

- [ ] **Step 3: 最小の実装を書く**

`automation/teams-weekly/TeamsWeeklyReportCore.gs`:

```javascript
/**
 * 既卒生 週次レポート — 純粋ロジック層
 *
 * このファイルは GAS の API（SpreadsheetApp / Utilities / UrlFetchApp 等）を
 * 一切呼ばない。日付は全て 'yyyy-MM-dd' 文字列で受け渡しし、内部計算は UTC で行う。
 * Node からもそのまま require できるため、tests/core.test.js で自動テストしている。
 */

/** 'yyyy-MM-dd' を UTC ミリ秒に変換する */
function ymdToUtc_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  if (!m) throw new Error("日付は 'yyyy-MM-dd' 形式で指定してください: " + ymd);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** UTC ミリ秒を 'yyyy-MM-dd' に変換する */
function utcToYmd_(ms) {
  var d = new Date(ms);
  var mm = ('0' + (d.getUTCMonth() + 1)).slice(-2);
  var dd = ('0' + d.getUTCDate()).slice(-2);
  return d.getUTCFullYear() + '-' + mm + '-' + dd;
}

/** 'yyyy-MM-dd' に n 日を加算する（負数で減算） */
function addDaysYmd_(ymd, n) {
  return utcToYmd_(ymdToUtc_(ymd) + n * 86400000);
}

/** from から to までの日数差（to - from） */
function diffDays_(fromYmd, toYmd) {
  return Math.round((ymdToUtc_(toYmd) - ymdToUtc_(fromYmd)) / 86400000);
}

/**
 * 実行日を含む週の月曜を基準に、先週の月〜日を返す
 * @return {{start: string, end: string}}
 */
function previousWeekRange_(todayYmd) {
  var dow = new Date(ymdToUtc_(todayYmd)).getUTCDay(); // 0=日, 1=月
  var offsetToMonday = dow === 0 ? -6 : 1 - dow;
  var thisMonday = addDaysYmd_(todayYmd, offsetToMonday);
  return { start: addDaysYmd_(thisMonday, -7), end: addDaysYmd_(thisMonday, -1) };
}

if (typeof module !== 'undefined') {
  module.exports = { ymdToUtc_, utcToYmd_, addDaysYmd_, diffDays_, previousWeekRange_ };
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test automation/teams-weekly/tests/core.test.js`
Expected: PASS（5 tests pass）

- [ ] **Step 5: 保存を確認する（コミットはしない）**

`automation/` は .gitignore 済み（公開リポジトリに学内自動化を含めない方針）。
このタスクのファイルは **git add しない**。ワークツリーに保存されていることだけ確認する。

```bash
git status --short automation/   # 何も出なければ正常（ignore されている）
ls -l automation/teams-weekly/
```

---

### Task 2: 学生の状態判定

**Files:**
- Modify: `automation/teams-weekly/TeamsWeeklyReportCore.gs`
- Test: `automation/teams-weekly/tests/core.test.js`

集計済みの1人分のデータ（`stat`）を受け取り、5状態のいずれかを返す。

```
stat = {
  studentNumber: '23040001',
  studentName: 'テスト 花子',
  weekAnswers: 42,      // 対象週の回答数
  weekCorrect: 24,      // 対象週の正答数
  weekDays: 4,          // 対象週に学習した日数
  totalAnswers: 112,    // 累計回答数（アーカイブ含む）
  firstDate: '2026-06-10' | null,  // 初回学習日
  lastDate: '2026-07-24' | null,   // 最終学習日
  since: '2026-05-01',  // 未着手期間の起点日
}
```

- [ ] **Step 1: 失敗するテストを書く**

`automation/teams-weekly/tests/core.test.js` の末尾に追記:

```javascript
const RANGE = { start: '2026-07-20', end: '2026-07-26' };
const TODAY = '2026-07-27';

function stat(overrides) {
  return Object.assign({
    studentNumber: '23040001',
    studentName: 'テスト 太郎',
    weekAnswers: 0,
    weekCorrect: 0,
    weekDays: 0,
    totalAnswers: 0,
    firstDate: null,
    lastDate: null,
    since: '2026-05-01',
  }, overrides);
}

test('累計0は never', () => {
  assert.strictEqual(core.classifyStudent_(stat({}), RANGE, TODAY), 'never');
});

test('今週実施かつ初回が今週内なら new', () => {
  const s = stat({ weekAnswers: 7, totalAnswers: 7, firstDate: '2026-07-22', lastDate: '2026-07-22' });
  assert.strictEqual(core.classifyStudent_(s, RANGE, TODAY), 'new');
});

test('今週実施で初回が今週より前なら active', () => {
  const s = stat({ weekAnswers: 42, totalAnswers: 112, firstDate: '2026-06-10', lastDate: '2026-07-24' });
  assert.strictEqual(core.classifyStudent_(s, RANGE, TODAY), 'active');
});

test('今週未実施で最終学習から14日以上なら stalled', () => {
  const s = stat({ totalAnswers: 112, firstDate: '2026-06-10', lastDate: '2026-07-02' });
  assert.strictEqual(core.classifyStudent_(s, RANGE, TODAY), 'stalled');
});

test('今週未実施だが14日未満なら paused', () => {
  const s = stat({ totalAnswers: 35, firstDate: '2026-06-10', lastDate: '2026-07-17' });
  assert.strictEqual(core.classifyStudent_(s, RANGE, TODAY), 'paused');
});

test('最終学習からちょうど14日は stalled（境界）', () => {
  const s = stat({ totalAnswers: 35, firstDate: '2026-06-10', lastDate: '2026-07-13' });
  assert.strictEqual(core.classifyStudent_(s, RANGE, TODAY), 'stalled');
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test automation/teams-weekly/tests/core.test.js`
Expected: FAIL（`core.classifyStudent_ is not a function`）

- [ ] **Step 3: 最小の実装を書く**

`TeamsWeeklyReportCore.gs` の `previousWeekRange_` の下に追記:

```javascript
/** 停止中と判定する日数のしきい値 */
var STALLED_DAYS = 14;

/**
 * 学生の状態を判定する
 * @return {'active'|'new'|'stalled'|'paused'|'never'}
 */
function classifyStudent_(stat, range, todayYmd) {
  if (!stat.totalAnswers) return 'never';
  if (stat.weekAnswers > 0) {
    var isNew = stat.firstDate && stat.firstDate >= range.start && stat.firstDate <= range.end;
    return isNew ? 'new' : 'active';
  }
  if (stat.lastDate && diffDays_(stat.lastDate, todayYmd) >= STALLED_DAYS) return 'stalled';
  return 'paused';
}
```

`module.exports` に `classifyStudent_` と `STALLED_DAYS` を追加する:

```javascript
if (typeof module !== 'undefined') {
  module.exports = {
    ymdToUtc_, utcToYmd_, addDaysYmd_, diffDays_, previousWeekRange_,
    classifyStudent_, STALLED_DAYS,
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test automation/teams-weekly/tests/core.test.js`
Expected: PASS（11 tests pass）

- [ ] **Step 5: 保存を確認する（コミットはしない）**

`automation/` は .gitignore 済み（公開リポジトリに学内自動化を含めない方針）。
このタスクのファイルは **git add しない**。ワークツリーに保存されていることだけ確認する。

```bash
git status --short automation/   # 何も出なければ正常（ignore されている）
ls -l automation/teams-weekly/
```

---

### Task 3: セクションへの振り分けと並び替え

**Files:**
- Modify: `automation/teams-weekly/TeamsWeeklyReportCore.gs`
- Test: `automation/teams-weekly/tests/core.test.js`

`buildSections_` は全学生の `stat` 配列を受け取り、状態別に振り分けて並び替えた構造を返す。

- 実施者（`active` + `new`）: 週の回答数の降順
- 停止中（`stalled`）: 最終学習日からの経過日数の降順
- 小休止（`paused`）: 最終学習日からの経過日数の降順
- 未着手（`never`）: `since` からの経過日数の降順（放置が長い順）

- [ ] **Step 1: 失敗するテストを書く**

`automation/teams-weekly/tests/core.test.js` の末尾に追記:

```javascript
test('buildSections_ は状態別に振り分け、規定の順序で並べる', () => {
  const stats = [
    stat({ studentNumber: 'A', studentName: 'A', weekAnswers: 7, weekCorrect: 3, weekDays: 1,
           totalAnswers: 7, firstDate: '2026-07-22', lastDate: '2026-07-22' }),
    stat({ studentNumber: 'B', studentName: 'B', weekAnswers: 42, weekCorrect: 24, weekDays: 4,
           totalAnswers: 112, firstDate: '2026-06-10', lastDate: '2026-07-24' }),
    stat({ studentNumber: 'C', studentName: 'C', totalAnswers: 112,
           firstDate: '2026-06-01', lastDate: '2026-07-02' }),
    stat({ studentNumber: 'D', studentName: 'D', totalAnswers: 35,
           firstDate: '2026-06-01', lastDate: '2026-06-28' }),
    stat({ studentNumber: 'E', studentName: 'E', since: '2026-05-01' }),
    stat({ studentNumber: 'F', studentName: 'F', since: '2026-06-15' }),
  ];
  const s = core.buildSections_(stats, RANGE, TODAY);

  assert.deepStrictEqual(s.active.map((x) => x.studentNumber), ['B', 'A']);
  assert.deepStrictEqual(s.stalled.map((x) => x.studentNumber), ['D', 'C']);
  assert.deepStrictEqual(s.never.map((x) => x.studentNumber), ['E', 'F']);
  assert.strictEqual(s.counts.total, 6);
  assert.strictEqual(s.counts.active, 2);
  assert.strictEqual(s.counts.never, 2);
});

test('buildSections_ は各行に派生値を付ける', () => {
  const stats = [
    stat({ studentNumber: 'B', studentName: 'B', weekAnswers: 42, weekCorrect: 24, weekDays: 4,
           totalAnswers: 112, firstDate: '2026-06-10', lastDate: '2026-07-24' }),
    stat({ studentNumber: 'C', studentName: 'C', totalAnswers: 112,
           firstDate: '2026-06-01', lastDate: '2026-07-02' }),
    stat({ studentNumber: 'E', studentName: 'E', since: '2026-05-01' }),
  ];
  const s = core.buildSections_(stats, RANGE, TODAY);

  assert.strictEqual(s.active[0].accuracy, 57);       // 24/42 = 57.1%
  assert.strictEqual(s.active[0].isNew, false);
  assert.strictEqual(s.stalled[0].daysSinceLast, 25); // 7/2 → 7/27
  assert.strictEqual(s.never[0].weeksSinceStart, 12); // 5/1 → 7/27 は87日 = 12週
});

test('buildSections_ は回答0で正答率0を返す（ゼロ除算しない）', () => {
  const s = core.buildSections_([stat({ studentNumber: 'E', studentName: 'E' })], RANGE, TODAY);
  assert.strictEqual(s.never[0].accuracy, 0);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test automation/teams-weekly/tests/core.test.js`
Expected: FAIL（`core.buildSections_ is not a function`）

- [ ] **Step 3: 最小の実装を書く**

`TeamsWeeklyReportCore.gs` の `classifyStudent_` の下に追記:

```javascript
/**
 * 学生ごとの集計結果を状態別セクションに振り分け、並び替えて返す
 * @param {Array<Object>} stats
 * @param {{start: string, end: string}} range
 * @param {string} todayYmd
 */
function buildSections_(stats, range, todayYmd) {
  var rows = stats.map(function (s) {
    var status = classifyStudent_(s, range, todayYmd);
    return {
      studentNumber: s.studentNumber,
      studentName: s.studentName,
      status: status,
      isNew: status === 'new',
      weekAnswers: s.weekAnswers,
      weekDays: s.weekDays,
      totalAnswers: s.totalAnswers,
      lastDate: s.lastDate,
      accuracy: s.weekAnswers ? Math.round((s.weekCorrect / s.weekAnswers) * 100) : 0,
      daysSinceLast: s.lastDate ? diffDays_(s.lastDate, todayYmd) : null,
      weeksSinceStart: Math.floor(diffDays_(s.since, todayYmd) / 7),
    };
  });

  var pick = function (statuses) {
    return rows.filter(function (r) { return statuses.indexOf(r.status) >= 0; });
  };
  var byAnswersDesc = function (a, b) { return b.weekAnswers - a.weekAnswers; };
  var byLastDesc = function (a, b) { return b.daysSinceLast - a.daysSinceLast; };
  var byWeeksDesc = function (a, b) { return b.weeksSinceStart - a.weeksSinceStart; };

  var active = pick(['active', 'new']).sort(byAnswersDesc);
  var stalled = pick(['stalled']).sort(byLastDesc);
  var paused = pick(['paused']).sort(byLastDesc);
  var never = pick(['never']).sort(byWeeksDesc);

  return {
    active: active,
    stalled: stalled,
    paused: paused,
    never: never,
    all: rows,
    counts: {
      total: rows.length,
      active: active.length,
      stalled: stalled.length,
      paused: paused.length,
      never: never.length,
    },
  };
}
```

`module.exports` に `buildSections_` を追加する。

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test automation/teams-weekly/tests/core.test.js`
Expected: PASS（14 tests pass）

- [ ] **Step 5: 保存を確認する（コミットはしない）**

`automation/` は .gitignore 済み（公開リポジトリに学内自動化を含めない方針）。
このタスクのファイルは **git add しない**。ワークツリーに保存されていることだけ確認する。

```bash
git status --short automation/   # 何も出なければ正常（ignore されている）
ls -l automation/teams-weekly/
```

---

### Task 4: メッセージ整形

**Files:**
- Modify: `automation/teams-weekly/TeamsWeeklyReportCore.gs`
- Test: `automation/teams-weekly/tests/core.test.js`

`formatLines_` はプレーンテキストの行配列を返す。`toHtml_` はそれを Teams 投稿用の
HTML（`<br>` 区切り）に変換する。Power Automate の「チャットにメッセージを投稿」は
本文を HTML として解釈するため、改行を `<br>` にしないと1行に潰れる。

- [ ] **Step 1: 失敗するテストを書く**

`automation/teams-weekly/tests/core.test.js` の末尾に追記:

```javascript
test('formatLines_ は見出しと各セクションを出力する', () => {
  const stats = [
    stat({ studentNumber: 'B', studentName: '佐藤 花子', weekAnswers: 42, weekCorrect: 24, weekDays: 4,
           totalAnswers: 112, firstDate: '2026-06-10', lastDate: '2026-07-24' }),
    stat({ studentNumber: 'A', studentName: '鈴木 一郎', weekAnswers: 7, weekCorrect: 3, weekDays: 1,
           totalAnswers: 7, firstDate: '2026-07-22', lastDate: '2026-07-22' }),
    stat({ studentNumber: 'C', studentName: '田中 二郎', totalAnswers: 112,
           firstDate: '2026-06-01', lastDate: '2026-07-02' }),
    stat({ studentNumber: 'E', studentName: '伊藤 四郎', since: '2026-05-01' }),
  ];
  const sections = core.buildSections_(stats, RANGE, TODAY);
  const lines = core.formatLines_(sections, RANGE, 'https://example.com/sheet');
  const text = lines.join('\n');

  assert.match(text, /7\/20.*7\/26/);
  assert.match(text, /対象 4名/);
  assert.match(text, /今週実施 2名/);
  assert.match(text, /累計未着手 1名/);
  assert.match(text, /佐藤 花子/);
  assert.match(text, /42問・4日・正答率57%/);
  assert.match(text, /鈴木 一郎.*🌱/);
  assert.match(text, /田中 二郎.*25日前/);
  assert.match(text, /伊藤 四郎（12週）/);
  assert.match(text, /https:\/\/example\.com\/sheet/);
});

test('formatLines_ は該当者ゼロのセクションを省略する', () => {
  const stats = [stat({ studentNumber: 'E', studentName: '伊藤 四郎', since: '2026-05-01' })];
  const sections = core.buildSections_(stats, RANGE, TODAY);
  const text = core.formatLines_(sections, RANGE, 'https://example.com/sheet').join('\n');

  assert.doesNotMatch(text, /今週実施（/);
  assert.doesNotMatch(text, /停止中/);
  assert.match(text, /今週実施 0名/);
  assert.match(text, /未着手（1名/);
});

test('toHtml_ は改行を br に変換し HTML をエスケープする', () => {
  const html = core.toHtml_(['a<b>', 'c&d']);
  assert.strictEqual(html, 'a&lt;b&gt;<br>c&amp;d');
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test automation/teams-weekly/tests/core.test.js`
Expected: FAIL（`core.formatLines_ is not a function`）

- [ ] **Step 3: 最小の実装を書く**

`TeamsWeeklyReportCore.gs` の `buildSections_` の下に追記:

```javascript
/** 'yyyy-MM-dd' を '7/20' 形式にする */
function shortDate_(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  return m ? Number(m[2]) + '/' + Number(m[3]) : String(ymd);
}

/**
 * Teams へ送るメッセージをプレーンテキストの行配列として組み立てる
 * @param {Object} sections buildSections_ の戻り値
 * @param {{start: string, end: string}} range
 * @param {string} sheetUrl 詳細シートのURL
 * @return {Array<string>}
 */
function formatLines_(sections, range, sheetUrl) {
  var c = sections.counts;
  var lines = [];

  lines.push('📊 メモリア週次レポート  ' + shortDate_(range.start) + '〜' + shortDate_(range.end));
  lines.push('対象 ' + c.total + '名 ／ 今週実施 ' + c.active + '名 ／ 累計未着手 ' + c.never + '名');

  if (sections.active.length) {
    lines.push('');
    lines.push('✅ 今週実施（' + sections.active.length + '名）');
    sections.active.forEach(function (r) {
      lines.push('　' + r.studentName + '　' + r.weekAnswers + '問・' + r.weekDays + '日・正答率'
        + r.accuracy + '%' + (r.isNew ? '　🌱今週はじめて着手' : ''));
    });
  }

  if (sections.stalled.length) {
    lines.push('');
    lines.push('😴 停止中（' + STALLED_DAYS + '日以上・' + sections.stalled.length + '名）');
    sections.stalled.forEach(function (r) {
      lines.push('　' + r.studentName + '　最終 ' + shortDate_(r.lastDate) + '（' + r.daysSinceLast
        + '日前）・累計' + r.totalAnswers + '問');
    });
  }

  if (sections.paused.length) {
    lines.push('');
    lines.push('💤 小休止（' + sections.paused.length + '名）');
    sections.paused.forEach(function (r) {
      lines.push('　' + r.studentName + '　最終 ' + shortDate_(r.lastDate) + '（' + r.daysSinceLast + '日前）');
    });
  }

  if (sections.never.length) {
    lines.push('');
    lines.push('⛔ 未着手（' + sections.never.length + '名／未着手期間の長い順）');
    sections.never.forEach(function (r) {
      lines.push('　' + r.studentName + '（' + r.weeksSinceStart + '週）');
    });
  }

  lines.push('');
  lines.push('▶ 詳細シート: ' + sheetUrl);
  return lines;
}

/** 行配列を Teams 投稿用の HTML に変換する */
function toHtml_(lines) {
  return lines.map(function (line) {
    return String(line)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }).join('<br>');
}
```

`module.exports` に `shortDate_`, `formatLines_`, `toHtml_` を追加する。

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `node --test automation/teams-weekly/tests/core.test.js`
Expected: PASS（17 tests pass）

- [ ] **Step 5: 保存を確認する（コミットはしない）**

`automation/` は .gitignore 済み（公開リポジトリに学内自動化を含めない方針）。
このタスクのファイルは **git add しない**。ワークツリーに保存されていることだけ確認する。

```bash
git status --short automation/   # 何も出なければ正常（ignore されている）
ls -l automation/teams-weekly/
```

---

### Task 5〜7: GAS I/O層（TeamsWeeklyReport.gs）

> **この3タスクの当初コードは実装後のレビューで棄却された。** 以下が現行の仕様である。
> 実装済みファイル: `automation/teams-weekly/TeamsWeeklyReport.gs`（Git管理外）。
> コード全文はここに再掲しない — 二重管理になり、必ず片方が古くなるため。
> 変更の背景は設計書 `docs/superpowers/specs/2026-07-27-teams-weekly-report-design.md` を参照。

**当初計画の何が誤っていたか**

学習ログを `student_number` で突合する設計だった。これは動かない。PWA の単問回答 API
（`pwa-frontend/src/services/api.ts` の `submitAnswer`）は `studentNumber` を送らず、
`gas-backend/src/AnswerService.gs:63` は `student_number: studentNumber || ''` と
空文字で書き込む。学籍番号だけで突合すると、**毎日学習している学生が「未着手」として
藤吉先生に報告される** — このシステムが最も避けるべき誤りそのものだった。

**現行仕様**

| 領域 | 内容 |
|---|---|
| 突合 | 2パス。パス1で `student_number` が非空かつ対象の行から `student_id`(UUID) 集合を作り、パス2で「学籍番号一致 **または** UUID一致」で集計。学籍番号変更でアーカイブ履歴が切れる問題も同時に解消する |
| 走査 | 全12列ではなく `student_id` / `student_number` / `is_correct` / `timestamp` の4列のみ読む。アーカイブは `/^student_logs_\d{4}_\d{2}$/` に一致するシートだけ |
| 沈黙対策 | 6分制限による強制終了は catch 不能。実行開始・正常終了を ScriptProperties に記録し、火曜8:00 の `checkWeeklyRunHealth` が今週の成功記録なしを検知して管理者へメールする |
| 同時実行 | `LockService` のスクリプトロックで全体を保護。送信済み判定は集計前に実施し、ロック取得後に再確認。ペイロードに `weekStart` を冪等キーとして含める |
| 通知の堅牢性 | `notifyAdmin_` は自前の try/catch で `Logger.log` にフォールバック。二重通知の抑止はエラーメッセージの部分一致ではなく `e.__notified` フラグで行う |
| 名簿 | `getDisplayValues()` で読む（学籍番号の先頭ゼロ対策）。`student_number` 重複行は除外し警告をログ |
| 監査シート | 問題バンクではなく名簿スプレッドシート（`STUDENT_LIST_ID`）に出力。氏名と未着手状態の組は `ANYONE_ANONYMOUS` 公開のバンクに置かない |
| 紐づけ不能ログ | 件数を数えるが、**監査シートにも Teams メッセージにも出さない**。全校規模の数字であり教員には解釈も対処もできない。Logger と管理者メールのみ |

**検証状況**: 構文チェックと呼び出しシグネチャの照合のみ実施済み。**実行時の挙動は未検証**
（Apps Script ランタイムが必要）。Task 9 の dryRun で実データに対して確認する。

---


### Task 8: 対象者へのマーキング補助（SetupReportGroup.gs）

**Files:**
- Create: `automation/teams-weekly/SetupReportGroup.gs`

xlsx にある24名の氏名を `students` シートの `student_name` と突き合わせ、
`report_group` 列に `2026既卒` を書き込む。表記ゆれ（全角/半角スペース、
異体字）で一致しない氏名は**書き込まずに一覧で報告する**。手作業の取りこぼしを防ぐ。

- [ ] **Step 1: セットアップ用スクリプトを作成する**

`automation/teams-weekly/SetupReportGroup.gs`:

```javascript
/**
 * 初回導入用: students シートの report_group 列に対象者を設定する
 *
 * 事前準備:
 *   問題バンクのスプレッドシートに「対象者リスト」シートを作り、
 *   A列に対象者の氏名を1行1名で貼り付ける（1行目から。ヘッダー不要）。
 *   進捗状況一覧の xlsx から氏名列をコピーすればよい。
 *
 * 使い方:
 *   1. dryRunReportGroup()  … 一致/不一致を確認するだけ（書き込まない）
 *   2. applyReportGroup()   … 実際に report_group 列へ書き込む
 *
 * 表記ゆれで一致しなかった氏名はログに出るので、手動で該当行に入力すること。
 *
 * 氏名をこのファイルに直接書かないこと。このリポジトリは Public であり、
 * automation/ は .gitignore 済みだが、実名をコードに残さない運用を徹底する。
 */

var TARGET_LIST_SHEET = '対象者リスト';

/** 「対象者リスト」シートのA列から対象者の氏名を読む */
function loadTargetNames_() {
  var sheet = openBank_().getSheetByName(TARGET_LIST_SHEET);
  if (!sheet) {
    throw new Error('「' + TARGET_LIST_SHEET + '」シートがありません。'
      + 'A列に対象者の氏名を1行1名で貼り付けてください');
  }
  var values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
  var names = [];
  values.forEach(function (row) {
    var name = String(row[0] || '').trim();
    if (name) names.push(name);
  });
  if (!names.length) throw new Error('「' + TARGET_LIST_SHEET + '」シートのA列が空です');
  return names;
}

/** 氏名を比較用に正規化する（全角/半角スペース・空白を除去） */
function normalizeName_(name) {
  return String(name).replace(/[\s　]/g, '');
}

/** 一致状況を確認する（書き込みなし） */
function dryRunReportGroup() {
  return applyReportGroupInternal_(true);
}

/** report_group 列へ書き込む */
function applyReportGroup() {
  return applyReportGroupInternal_(false);
}

function applyReportGroupInternal_(dryRun) {
  var group = prop_('REPORT_GROUP', TWR.DEFAULT_GROUP);
  var sheet = openRosterSheet_();
  var data = sheet.getDataRange().getValues();
  var idx = headerIndex_(data[0]);

  if (idx['student_name'] === undefined) throw new Error('名簿シートに student_name 列がありません');

  // report_group 列がなければ末尾に追加する
  var groupCol = idx['report_group'];
  if (groupCol === undefined) {
    if (dryRun) {
      Logger.log('report_group 列は未作成です（applyReportGroup 実行時に末尾へ追加されます）');
      groupCol = data[0].length;
    } else {
      groupCol = data[0].length;
      sheet.getRange(1, groupCol + 1).setValue('report_group').setFontWeight('bold');
    }
  }

  var targetNames = loadTargetNames_();
  var wanted = {};
  targetNames.forEach(function (n) { wanted[normalizeName_(n)] = n; });

  var matched = [];
  var updates = [];
  for (var i = 1; i < data.length; i++) {
    var key = normalizeName_(data[i][idx['student_name']]);
    if (!wanted[key]) continue;
    matched.push({ row: i + 1, name: data[i][idx['student_name']],
      number: data[i][idx['student_number']] });
    updates.push(i + 1);
    delete wanted[key];
  }

  var unmatched = Object.keys(wanted).map(function (k) { return wanted[k]; });

  Logger.log('一致 ' + matched.length + '名 / 対象 ' + targetNames.length + '名');
  matched.forEach(function (m) { Logger.log('  ' + m.number + '  ' + m.name + '（' + m.row + '行目）'); });
  if (unmatched.length) {
    Logger.log('⚠ 一致しなかった氏名（手動で report_group に「' + group + '」を入力してください）:');
    unmatched.forEach(function (n) { Logger.log('  ' + n); });
  }

  if (!dryRun) {
    updates.forEach(function (row) { sheet.getRange(row, groupCol + 1).setValue(group); });
    Logger.log(updates.length + '行に「' + group + '」を書き込みました');
  }

  return { matched: matched, unmatched: unmatched, dryRun: !!dryRun };
}
```

- [ ] **Step 2: Apps Script で dryRun を実行して一致状況を確認する**

エディタで `dryRunReportGroup` を実行し、実行ログを見る。

Expected: 「一致 N名 / 対象 24名」と、一致した学籍番号・氏名の一覧が出る。
一致しなかった氏名（表記ゆれ・別姓など）があれば控えておく。
**この一覧を目視するまで、次のステップに進まない。**

- [ ] **Step 3: 書き込みを実行し、残りを手で埋める**

`applyReportGroup` を実行する。そのあと `students` シートを開き、
Step 2 で一致しなかった氏名の行を探して `report_group` に `2026既卒` を手入力する。

最後にシート上でフィルタをかけ、`report_group = 2026既卒` が**24行**あることを目視で確認する。

- [ ] **Step 4: 保存を確認する（コミットはしない）**

`automation/` は .gitignore 済み（公開リポジトリに学内自動化を含めない方針）。
このタスクのファイルは **git add しない**。ワークツリーに保存されていることだけ確認する。

```bash
git status --short automation/   # 何も出なければ正常（ignore されている）
ls -l automation/teams-weekly/
```

---

### Task 9: dryRun による実データ検証

**Files:**
- なし（Apps Script 上での検証のみ）

- [ ] **Step 1: dryRun を実行する**

Apps Script エディタで下記を実行する:

```javascript
function debugDryRun() {
  var r = buildWeeklyReport(true);
  Logger.log('対象 ' + r.counts.total + ' / 実施 ' + r.counts.active
    + ' / 停止 ' + r.counts.stalled + ' / 小休止 ' + r.counts.paused
    + ' / 未着手 ' + r.counts.never);
  Logger.log(r.text);
}
```

Expected: エラーなく完了し、ログにメッセージ本文が出る。
`counts.total` が **24** であること。
`active + stalled + paused + never` の合計が `total` と一致すること。

- [ ] **Step 2: シートの内容を実データと突き合わせる**

`週次Teams_YYYYMMDD` シートを開き、次を目視で確認する:

1. 24行あること
2. `student_logs` に回答がある学生の `累計回答数` が0でないこと
   （`student_logs` を `student_number` でフィルタして件数を数え、一致するか確認）
3. ログが1行もない学生の `status` が `never` であること
4. `最終学習日` が `student_logs` の当該学生の最新 `timestamp` と一致すること

**ここで数字が合わなければ先に進まない。** 集計が誤ったまま送信すると、
教員の判断材料としては害になる。

- [ ] **Step 3: 確認結果を記録する**

`automation/teams-weekly/README.md` に「検証記録」節を作り、
実行日・対象人数・突き合わせた学生番号・結果を書き残す。

- [ ] **Step 4: 保存を確認する（コミットはしない）**

`automation/` は .gitignore 済み（公開リポジトリに学内自動化を含めない方針）。
このタスクのファイルは **git add しない**。ワークツリーに保存されていることだけ確認する。

```bash
git status --short automation/   # 何も出なければ正常（ignore されている）
ls -l automation/teams-weekly/
```

---

### Task 10: Power Automate フロー作成と送信テスト

**Files:**
- Modify: `automation/teams-weekly/README.md`

- [ ] **Step 1: フローを作る**

Power Automate（make.powerautomate.com、学校の Microsoft アカウント）で
インスタント クラウド フローを新規作成する。

1. トリガー: **「HTTP 要求の受信時」**
2. 要求本文の JSON スキーマに以下を貼る:

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "summary": { "type": "string" },
    "text": { "type": "string" },
    "html": { "type": "string" },
    "sheetUrl": { "type": "string" }
  }
}
```

3. アクション: **「チャットまたはチャネルにメッセージを投稿する」**
   - 投稿者: **フロー ボット**
   - 投稿先: **チャットとグループ チャット**
   - 受信者: 藤吉先生
   - メッセージ: 動的コンテンツの **`html`**
4. 保存すると、トリガーに **HTTP POST の URL** が表示される。これをコピーする

- [ ] **Step 2: URL をスクリプトプロパティに登録する**

Apps Script の「プロジェクトの設定 > スクリプト プロパティ」で
`TEAMS_FLOW_URL` に貼り付ける。

**この URL はリポジトリにも、チャットにも、コミットメッセージにも貼らない。**
URL を知っていれば誰でも藤吉先生にメッセージを送れるため、CLAUDE.md の
secret 判定基準における「認証情報」相当として扱う。

- [ ] **Step 3: 単発送信テストを行う**

Apps Script で `buildAndSendWeeklyReport` を実行する。

Expected:
- Teams の藤吉先生とのチャットに Flow ボットからメッセージが届く
- 改行が保たれている（1行に潰れていない）
- 絵文字・氏名が文字化けしていない
- 詳細シートのリンクが開ける

崩れていた場合は `toHtml_` の出力とフロー側の「メッセージ」欄の設定を見直す。

- [ ] **Step 4: 二重送信ガードを確認する**

もう一度 `buildAndSendWeeklyReport` を実行する。

Expected: Teams に**2通目は届かない**。実行ログに
「この週（YYYY-MM-DD）は送信済みのためスキップします」が出る。

- [ ] **Step 5: 異常系を確認する**

`TEAMS_FLOW_URL` の値を一時的に `https://example.invalid/` に書き換え、
`resetSentGuard()` を実行してから `buildAndSendWeeklyReport` を実行する。

Expected: 3回リトライしたのち例外で終了し、`ADMIN_EMAIL`（未設定なら実行者）宛に
「Teams送信に失敗しました」というメールが本文つきで届く。
確認後、`TEAMS_FLOW_URL` を正しい値に戻す。

- [ ] **Step 6: 手順と検証結果を README に書く**

`automation/teams-weekly/README.md` に Step 1〜5 の手順と、
実際に確認できた結果（届いた／崩れなかった／ガードが効いた／エラーメールが来た）を記録する。
URL の実値は書かない。

- [ ] **Step 7: 保存を確認する（コミットはしない）**

`automation/` は .gitignore 済み（公開リポジトリに学内自動化を含めない方針）。
このタスクのファイルは **git add しない**。ワークツリーに保存されていることだけ確認する。

```bash
git status --short automation/   # 何も出なければ正常（ignore されている）
ls -l automation/teams-weekly/
```

---

### Task 11: 週次トリガーの設定と初回自動配信の確認

**Files:**
- Modify: `automation/teams-weekly/README.md`

- [ ] **Step 1: トリガーを設定する**

Apps Script で `installWeeklyTrigger` を実行する。

Expected: ログに「毎週月曜 7時のトリガーを設定しました」。
左メニュー「トリガー」に `buildAndSendWeeklyReport` が週次で1件だけ登録されている
（重複がないこと）。

- [ ] **Step 2: 送信済みフラグを解除する**

`resetSentGuard()` を実行する。手動テストで立ったフラグを消しておかないと、
翌週の自動実行が「送信済み」と誤判定してスキップされる可能性がある
（週が変われば `range.start` も変わるため通常は問題ないが、確実にしておく）。

- [ ] **Step 3: 翌週月曜に実配信を確認する**

翌週の月曜 7時以降に Teams を確認する。届いていなければ Apps Script の
「実行数」画面でエラー内容を確認する。

- [ ] **Step 4: 運用手順を README に完成させる**

以下を含める:

- 対象者を増減するとき: `students` シートの `report_group` 列を編集するだけ
- 年度が変わるとき: `REPORT_GROUP` プロパティを新しい値に変更し、名簿を付け替える
- 送信を止めるとき: Apps Script の「トリガー」から削除する
- 同じ週にもう一度送りたいとき: `resetSentGuard()` → `buildAndSendWeeklyReport()`
- 実施者が増えて正答率・苦手分野を出したくなったとき: 設計書の「将来の拡張ポイント」を参照

- [ ] **Step 5: 保存を確認する（コミットはしない）**

`automation/` は .gitignore 済み（公開リポジトリに学内自動化を含めない方針）。
このタスクのファイルは **git add しない**。ワークツリーに保存されていることだけ確認する。

```bash
git status --short automation/   # 何も出なければ正常（ignore されている）
ls -l automation/teams-weekly/
```

---

## 完了条件

1. `node --test automation/teams-weekly/tests/core.test.js` が全件パスする
2. `週次Teams_YYYYMMDD` シートに対象24名が出力され、実データと突き合わせて数値が一致している
3. Teams の藤吉先生とのチャットに、崩れのないメッセージが実際に届いている
4. 同一週の再実行で二重送信されないことを実行して確認している
5. 送信失敗時にエラーメールが届くことを実行して確認している
6. 週次トリガーが1件だけ登録されている
7. `TEAMS_FLOW_URL` の実値がリポジトリのどこにも含まれていない
8. `git status --short automation/` が何も出力しない（`automation/` 配下が1件も
   コミット対象になっていない）
9. 学生の実名がコード・ドキュメント・コミットメッセージのいずれにも含まれていない
   （`docs/` 配下は公開される。氏名は `対象者リスト` シートと `students` シートにのみ置く）
