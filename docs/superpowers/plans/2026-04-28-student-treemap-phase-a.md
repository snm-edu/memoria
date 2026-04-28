# 学生用ツリーマップ Phase A 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 学生 PWA に教員 Looker と共通言語化された3階層ネスト ツリーマップ画面を追加し、既存の `WeaknessMap.tsx` を置き換える。Phase A はインタラクション(ズーム・演習開始)を含まず、「正しい色で正しい階層が表示される」ことに集中する。

**Architecture:** PWA → GAS `getStudentTreemap` API → Sheets (`questions` × `category_stats` LEFT JOIN) → JSON ネスト構造を返却 → PWA 側で d3-hierarchy + d3-scale-chromatic で描画。curriculum マスタは PWA 側のみに存在するため、リクエスト時に `categories` リストとして GAS に渡す。

**Tech Stack:** Google Apps Script + Google Sheets, React 18 + TypeScript + Vite + Tailwind, d3-hierarchy, d3-scale-chromatic, Dexie.js

**Spec:** `docs/superpowers/specs/2026-04-28-student-treemap-design.md`

**Phase A スコープ** (本計画の範囲):
- GAS `getStudentTreemap` API
- PWA: ツリーマップ表示 (ネスト全階層・色・面積)
- パンくず・色凡例・ヘッダー UI
- 既存 `WeaknessMap.tsx` 置き換え

**Phase B/C スコープ** (本計画では扱わない):
- ズームインタラクション、演習開始連携 (Phase B)
- 即時更新ボタン、楽観的更新、オフラインキャッシュ (Phase C)

---

## ファイル構造

### 新規作成

| パス | 責務 |
|------|------|
| `gas-backend/src/TreemapService.gs` | ツリーマップ集計サービス |
| `pwa-frontend/src/services/treemapApi.ts` | GAS API 呼び出しラッパー |
| `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx` | コンテナ(フェッチ・state) |
| `pwa-frontend/src/components/dashboard/treemap/Treemap.tsx` | 描画専用 (d3 計算 + SVG) |
| `pwa-frontend/src/components/dashboard/treemap/TreemapBreadcrumb.tsx` | パンくず |
| `pwa-frontend/src/components/dashboard/treemap/TreemapLegend.tsx` | 色凡例 |
| `pwa-frontend/src/components/dashboard/treemap/treemapTypes.ts` | 型定義 |

### 既存修正

| パス | 修正内容 |
|------|---------|
| `pwa-frontend/package.json` | `d3-hierarchy`, `d3-scale-chromatic` 追加 |
| `pwa-frontend/src/App.tsx` | ナビ「📊 弱点」を `WeaknessTreemap` へルーティング |
| `gas-backend/src/Code.gs` | `getStudentTreemap` ルーティング追加 |

### 削除

| パス | 理由 |
|------|------|
| `pwa-frontend/src/components/dashboard/WeaknessMap.tsx` | 新ツリーマップで置換 |

---

## Task 1: GAS `TreemapService.gs` 新規作成 — リーフマスタ抽出

**Files:**
- Create: `gas-backend/src/TreemapService.gs`

- [ ] **Step 1: ファイル作成 + ヘッダコメント + マスタリーフ抽出関数**

```javascript
/**
 * Memoria ツリーマップサービス
 *
 * 学生個人用ツリーマップのデータを返す。
 * questions シート(出題マスタ) × category_stats(学習履歴) を
 * LEFT JOIN し、category > subcategory > subtopic のネスト構造で返却する。
 *
 * curriculum マスタは PWA 側にあるため、GAS は categories リストを
 * パラメータで受け取って大分類フィルタとして使う。
 */

const TreemapService = {
  /**
   * questions シートから (department, allowedCategories) で絞った
   * (category, subcategory, subtopic) ごとの問題数マスタを抽出する
   *
   * @param {Spreadsheet} ss
   * @param {string} department - 学科コード(例: 'clinical_eng')
   * @param {Array<string>} allowedCategories - 大分類のホワイトリスト
   * @return {Object} key=cat|||sub|||top, value={cat, sub, top, totalQuestions}
   */
  buildLeafMaster: function(ss, department, allowedCategories) {
    var sheet = ss.getSheetByName(CONFIG.SHEETS.QUESTIONS);
    if (!sheet) return {};
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return {};

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var allowedSet = {};
    allowedCategories.forEach(function(c) { allowedSet[c] = true; });

    var master = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[idx['department']] !== department) continue;
      var cat = row[idx['category']] || '';
      if (!allowedSet[cat]) continue;
      var sub = row[idx['subcategory']] || '未分類';
      var top = row[idx['subtopic']] || '未分類';
      var key = cat + '|||' + sub + '|||' + top;
      if (!master[key]) {
        master[key] = { cat: cat, sub: sub, top: top, totalQuestions: 0 };
      }
      master[key].totalQuestions++;
    }
    return master;
  },
};
```

- [ ] **Step 2: GAS エディタで動作確認関数を作成**

`TreemapService.gs` の末尾に追加:

```javascript
/**
 * 手動動作確認用 — GAS エディタから実行する
 */
function testBuildLeafMaster() {
  var ss = getSpreadsheet();
  var allowed = ['医用電気電子工学', '医学概論', '生体機能代行装置学'];
  var master = TreemapService.buildLeafMaster(ss, 'clinical_eng', allowed);
  var keys = Object.keys(master);
  Logger.log('リーフ件数: ' + keys.length);
  Logger.log('サンプル(先頭3件):');
  for (var i = 0; i < Math.min(3, keys.length); i++) {
    Logger.log(keys[i] + ' => ' + JSON.stringify(master[keys[i]]));
  }
}
```

- [ ] **Step 3: GAS エディタで `testBuildLeafMaster` を実行**

期待ログ例:
```
リーフ件数: (50〜200程度)
サンプル(先頭3件):
医用電気電子工学|||電気工学|||オームの法則 => {"cat":"医用電気電子工学","sub":"電気工学","top":"オームの法則","totalQuestions":15}
...
```

リーフ件数が0、もしくはエラーが出る場合は `CONFIG.SHEETS.QUESTIONS` の名前と questions シートの列名 (department, category, subcategory, subtopic) を確認する。

- [ ] **Step 4: コミット**

```bash
git add gas-backend/src/TreemapService.gs
git commit -m "feat(gas): TreemapService — リーフマスタ抽出 (questions シート集計)"
```

---

## Task 2: GAS `TreemapService.gs` — 学習済みマップ抽出

**Files:**
- Modify: `gas-backend/src/TreemapService.gs`

- [ ] **Step 1: `buildLearnedMap` 関数を `TreemapService` オブジェクトに追加**

`buildLeafMaster` の直後に追加:

```javascript
  /**
   * category_stats シートから studentId フィルタで
   * (category, subcategory, subtopic) ごとの学習結果マップを抽出する
   *
   * @param {Spreadsheet} ss
   * @param {string} studentId
   * @return {Object} key=cat|||sub|||top, value={answered, correct, lastDate}
   */
  buildLearnedMap: function(ss, studentId) {
    var sheet = ss.getSheetByName('category_stats');
    if (!sheet) return {};
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return {};

    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    var learned = {};
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[idx['student_id']] !== studentId) continue;
      var cat = row[idx['category']] || '';
      var sub = row[idx['subcategory']] || '未分類';
      var top = row[idx['subtopic']] || '未分類';
      var key = cat + '|||' + sub + '|||' + top;
      learned[key] = {
        answered: Number(row[idx['total_count']]) || 0,
        correct: Number(row[idx['correct_count']]) || 0,
        lastDate: row[idx['last_study_date']] || ''
      };
    }
    return learned;
  },
```

- [ ] **Step 2: 動作確認関数を追加**

```javascript
function testBuildLearnedMap() {
  var ss = getSpreadsheet();
  // 実在する studentId を category_stats シートから1つ拾って差し替え
  var testStudentId = 'PASTE_REAL_STUDENT_ID_HERE';
  var learned = TreemapService.buildLearnedMap(ss, testStudentId);
  var keys = Object.keys(learned);
  Logger.log('学習済み件数: ' + keys.length);
  for (var i = 0; i < Math.min(3, keys.length); i++) {
    Logger.log(keys[i] + ' => ' + JSON.stringify(learned[keys[i]]));
  }
}
```

- [ ] **Step 3: GAS エディタで実在する studentId を category_stats シートから取得し、`testStudentId` に貼って実行**

期待ログ例:
```
学習済み件数: 30〜80
医用電気電子工学|||電気工学|||オームの法則 => {"answered":12,"correct":10,"lastDate":"2026-04-25"}
...
```

学習済み件数が0の場合は studentId が間違っているか、その学生がまだ問題を解いていない可能性。

- [ ] **Step 4: コミット**

```bash
git add gas-backend/src/TreemapService.gs
git commit -m "feat(gas): TreemapService — 学習済みマップ抽出 (category_stats から studentId フィルタ)"
```

---

## Task 3: GAS `TreemapService.gs` — LEFT JOIN + confidence 判定

**Files:**
- Modify: `gas-backend/src/TreemapService.gs`

- [ ] **Step 1: `mergeLeafs` 関数を追加**

```javascript
  /**
   * マスタリーフ × 学習済みマップを LEFT JOIN し、
   * confidence (high/low/none) と correctRate を付与する
   *
   * @param {Object} master - buildLeafMaster の戻り値
   * @param {Object} learned - buildLearnedMap の戻り値
   * @return {Array<Object>} {cat, sub, top, totalQuestions, answered, correct, correctRate, confidence, lastDate}
   */
  mergeLeafs: function(master, learned) {
    var leafs = [];
    var keys = Object.keys(master);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var m = master[key];
      var l = learned[key];
      var leaf = {
        cat: m.cat,
        sub: m.sub,
        top: m.top,
        totalQuestions: m.totalQuestions,
        answered: 0,
        correct: 0,
        correctRate: null,
        confidence: 'none',
        lastDate: ''
      };
      if (l) {
        leaf.answered = l.answered;
        leaf.correct = l.correct;
        leaf.lastDate = l.lastDate;
        if (l.answered > 0) {
          leaf.correctRate = Math.round((l.correct / l.answered) * 100);
        }
        if (l.answered >= 5) {
          leaf.confidence = 'high';
        } else if (l.answered >= 1) {
          leaf.confidence = 'low';
        }
      }
      leafs.push(leaf);
    }
    return leafs;
  },
```

- [ ] **Step 2: 動作確認関数を追加**

```javascript
function testMergeLeafs() {
  var ss = getSpreadsheet();
  var allowed = ['医用電気電子工学', '医学概論'];
  var master = TreemapService.buildLeafMaster(ss, 'clinical_eng', allowed);
  var learned = TreemapService.buildLearnedMap(ss, 'PASTE_REAL_STUDENT_ID_HERE');
  var leafs = TreemapService.mergeLeafs(master, learned);

  var stats = { high: 0, low: 0, none: 0 };
  for (var i = 0; i < leafs.length; i++) stats[leafs[i].confidence]++;
  Logger.log('confidence分布: ' + JSON.stringify(stats));
  Logger.log('サンプル(highの先頭1件):');
  for (var i = 0; i < leafs.length; i++) {
    if (leafs[i].confidence === 'high') {
      Logger.log(JSON.stringify(leafs[i]));
      break;
    }
  }
}
```

- [ ] **Step 3: GAS エディタで `testMergeLeafs` を実行**

期待ログ例:
```
confidence分布: {"high":12,"low":8,"none":45}
サンプル(highの先頭1件):
{"cat":"医用電気電子工学","sub":"電気工学","top":"オームの法則","totalQuestions":15,"answered":12,"correct":10,"correctRate":83,"confidence":"high","lastDate":"2026-04-25"}
```

- [ ] **Step 4: コミット**

```bash
git add gas-backend/src/TreemapService.gs
git commit -m "feat(gas): TreemapService — リーフ LEFT JOIN + confidence 判定"
```

---

## Task 4: GAS `TreemapService.gs` — ネスト構造化

**Files:**
- Modify: `gas-backend/src/TreemapService.gs`

- [ ] **Step 1: `buildTree` 関数を追加**

```javascript
  /**
   * フラットなリーフ配列から category > subcategory > subtopic の
   * ネスト構造に変換する。親階層の totalQuestions, answered, correct,
   * correctRate も同時に集約する。
   *
   * @param {Array<Object>} leafs - mergeLeafs の戻り値
   * @return {Object} {name:'すべて', children:[...大分類...]}
   */
  buildTree: function(leafs) {
    var catMap = {}; // cat -> { name, children:{}, totals }

    for (var i = 0; i < leafs.length; i++) {
      var leaf = leafs[i];
      var cat = leaf.cat;
      var sub = leaf.sub;

      if (!catMap[cat]) {
        catMap[cat] = {
          name: cat,
          subMap: {},
          totalQuestions: 0,
          answered: 0,
          correct: 0
        };
      }
      var catNode = catMap[cat];
      catNode.totalQuestions += leaf.totalQuestions;
      catNode.answered += leaf.answered;
      catNode.correct += leaf.correct;

      if (!catNode.subMap[sub]) {
        catNode.subMap[sub] = {
          name: sub,
          children: [],
          totalQuestions: 0,
          answered: 0,
          correct: 0
        };
      }
      var subNode = catNode.subMap[sub];
      subNode.totalQuestions += leaf.totalQuestions;
      subNode.answered += leaf.answered;
      subNode.correct += leaf.correct;

      subNode.children.push({
        name: leaf.top,
        totalQuestions: leaf.totalQuestions,
        answered: leaf.answered,
        correct: leaf.correct,
        correctRate: leaf.correctRate,
        confidence: leaf.confidence,
        lastDate: leaf.lastDate
      });
    }

    function ratePercent(correct, answered) {
      return answered > 0 ? Math.round((correct / answered) * 100) : null;
    }

    var rootChildren = [];
    var catKeys = Object.keys(catMap);
    for (var c = 0; c < catKeys.length; c++) {
      var cat = catMap[catKeys[c]];
      var subChildren = [];
      var subKeys = Object.keys(cat.subMap);
      for (var s = 0; s < subKeys.length; s++) {
        var sub = cat.subMap[subKeys[s]];
        subChildren.push({
          name: sub.name,
          totalQuestions: sub.totalQuestions,
          answered: sub.answered,
          correctRate: ratePercent(sub.correct, sub.answered),
          children: sub.children
        });
      }
      rootChildren.push({
        name: cat.name,
        totalQuestions: cat.totalQuestions,
        answered: cat.answered,
        correctRate: ratePercent(cat.correct, cat.answered),
        children: subChildren
      });
    }

    var totalQuestions = 0;
    var totalAnswered = 0;
    for (var i = 0; i < rootChildren.length; i++) {
      totalQuestions += rootChildren[i].totalQuestions;
      totalAnswered += rootChildren[i].answered;
    }

    return {
      name: 'すべて',
      totalQuestions: totalQuestions,
      answered: totalAnswered,
      children: rootChildren
    };
  },
```

- [ ] **Step 2: 動作確認関数を追加**

```javascript
function testBuildTree() {
  var ss = getSpreadsheet();
  var allowed = ['医用電気電子工学', '医学概論'];
  var master = TreemapService.buildLeafMaster(ss, 'clinical_eng', allowed);
  var learned = TreemapService.buildLearnedMap(ss, 'PASTE_REAL_STUDENT_ID_HERE');
  var leafs = TreemapService.mergeLeafs(master, learned);
  var tree = TreemapService.buildTree(leafs);
  Logger.log('ルート totalQuestions: ' + tree.totalQuestions);
  Logger.log('大分類数: ' + tree.children.length);
  for (var i = 0; i < tree.children.length; i++) {
    var c = tree.children[i];
    Logger.log('  ' + c.name + ' total=' + c.totalQuestions
      + ' answered=' + c.answered + ' rate=' + c.correctRate
      + ' subCount=' + c.children.length);
  }
}
```

- [ ] **Step 3: GAS エディタで `testBuildTree` を実行**

期待ログ例:
```
ルート totalQuestions: 1100
大分類数: 2
  医用電気電子工学 total=320 answered=180 rate=78 subCount=4
  医学概論 total=780 answered=232 rate=72 subCount=6
```

- [ ] **Step 4: コミット**

```bash
git add gas-backend/src/TreemapService.gs
git commit -m "feat(gas): TreemapService — ネスト構造化 (大→中→小分類)"
```

---

## Task 5: GAS `TreemapService.gs` — `getStudentTreemap` 完成形

**Files:**
- Modify: `gas-backend/src/TreemapService.gs`

- [ ] **Step 1: 公開エントリ関数 `getStudentTreemap` を追加**

```javascript
  /**
   * ツリーマップ用データ取得 (公開エントリ)
   *
   * @param {Object} params
   * @param {string} params.studentId
   * @param {string} params.department
   * @param {number} params.grade
   * @param {Array<string>} params.categories - PWA から渡される大分類ホワイトリスト
   * @return {Object} {success, data} or {success:false, error}
   */
  getStudentTreemap: function(params) {
    if (!params || !params.studentId) {
      return { success: false, error: 'studentId is required' };
    }
    if (!params.department) {
      return { success: false, error: 'department is required' };
    }
    if (!params.categories || !params.categories.length) {
      return { success: false, error: 'categories is required' };
    }

    try {
      var ss = getSpreadsheet();
      var master = this.buildLeafMaster(ss, params.department, params.categories);
      var learned = this.buildLearnedMap(ss, params.studentId);
      var leafs = this.mergeLeafs(master, learned);
      var tree = this.buildTree(leafs);

      // 学生名簿から名前取得 (DashboardService と同パターン)
      var nameMap = {};
      try {
        nameMap = DashboardService.getStudentNameMap();
      } catch (e) {
        Logger.log('getStudentNameMap error (fallback to empty): ' + e);
      }

      // 最新データ取得時刻 = 現在時刻 (Phase A は即時計算なので now)
      var data = {
        studentId: params.studentId,
        department: params.department,
        grade: params.grade,
        updatedAt: new Date().toISOString(),
        totalQuestions: tree.totalQuestions,
        answered: tree.answered,
        tree: tree
      };
      return { success: true, data: data };
    } catch (e) {
      Logger.log('getStudentTreemap error: ' + e + '\n' + e.stack);
      return { success: false, error: String(e) };
    }
  },
```

- [ ] **Step 2: 動作確認関数を追加**

```javascript
function testGetStudentTreemap() {
  var result = TreemapService.getStudentTreemap({
    studentId: 'PASTE_REAL_STUDENT_ID_HERE',
    department: 'clinical_eng',
    grade: 2,
    categories: ['医用電気電子工学', '医学概論', '生体機能代行装置学', '医用機械工学']
  });
  Logger.log(JSON.stringify(result, null, 2).substring(0, 1500));
}
```

- [ ] **Step 3: GAS エディタで実行 → JSON が `success:true` で出ることを確認**

エラーで失敗する場合:
- `studentId is required` → studentId を貼り直す
- `department is required` → department コードを確認 (`clinical_eng`, `nursing`, `dental_hyg`, `orthoptist`)
- `Cannot read property...` → 個別関数 (Task 1〜4) のテスト関数を再実行して切り分け

- [ ] **Step 4: コミット**

```bash
git add gas-backend/src/TreemapService.gs
git commit -m "feat(gas): TreemapService.getStudentTreemap 公開エントリ実装"
```

---

## Task 6: GAS `Code.gs` ルーティング追加

**Files:**
- Modify: `gas-backend/src/Code.gs`

- [ ] **Step 1: `doGet` の switch に `getStudentTreemap` ケースを追加**

`gas-backend/src/Code.gs` の `case 'getDashboard':` の直後に挿入:

```javascript
      case 'getStudentTreemap':
        var categoriesParam = e.parameter.categories || '';
        var categories = categoriesParam ? categoriesParam.split(',') : [];
        return jsonResponse(TreemapService.getStudentTreemap({
          studentId: e.parameter.studentId || '',
          department: e.parameter.department || '',
          grade: parseInt(e.parameter.grade) || 0,
          categories: categories
        }));
```

- [ ] **Step 2: ファイル先頭のルートコメントに記載追加**

`gas-backend/src/Code.gs` 冒頭の JSDoc コメント (`GET /exec?action=...` の一覧) に追加:

```
 * GET  /exec?action=getStudentTreemap&studentId=xxx&department=clinical_eng&grade=2&categories=cat1,cat2,...
```

- [ ] **Step 3: GAS エディタからプロジェクトを `clasp push` するか、エディタで保存 → 「デプロイ → デプロイの管理 → 新しいバージョンとしてデプロイ」**

(プロジェクトのデプロイ手順は CLAUDE.md と既存の運用に従う)

- [ ] **Step 4: curl で動作確認**

```bash
GAS_URL="https://script.google.com/macros/s/.../exec"  # 実 URL に置き換え
STUDENT_ID="..."  # 実 studentId
curl -sL "$GAS_URL?action=getStudentTreemap&studentId=$STUDENT_ID&department=clinical_eng&grade=2&categories=$(printf '%s' '医用電気電子工学,医学概論' | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')" | python3 -m json.tool | head -40
```

期待出力: `"success": true` で始まり `data.tree.children` に大分類配列が見える。

- [ ] **Step 5: コミット**

```bash
git add gas-backend/src/Code.gs
git commit -m "feat(gas): Code.gs に getStudentTreemap ルーティング追加"
```

---

## Task 7: PWA 依存追加 + 型定義

**Files:**
- Modify: `pwa-frontend/package.json`
- Create: `pwa-frontend/src/components/dashboard/treemap/treemapTypes.ts`

- [ ] **Step 1: PWA ディレクトリで依存をインストール**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm install d3-hierarchy d3-scale-chromatic
npm install -D @types/d3-hierarchy @types/d3-scale-chromatic
```

- [ ] **Step 2: 型定義ファイル作成**

`pwa-frontend/src/components/dashboard/treemap/treemapTypes.ts`:

```typescript
export type Confidence = 'high' | 'low' | 'none';

export interface TreemapLeaf {
  name: string;
  totalQuestions: number;
  answered: number;
  correct: number;
  correctRate: number | null;
  confidence: Confidence;
  lastDate: string;
}

export interface TreemapSubcategory {
  name: string;
  totalQuestions: number;
  answered: number;
  correctRate: number | null;
  children: TreemapLeaf[];
}

export interface TreemapCategory {
  name: string;
  totalQuestions: number;
  answered: number;
  correctRate: number | null;
  children: TreemapSubcategory[];
}

export interface TreemapRoot {
  name: string;
  totalQuestions: number;
  answered: number;
  children: TreemapCategory[];
}

export interface TreemapResponse {
  studentId: string;
  department: string;
  grade: number;
  updatedAt: string;
  totalQuestions: number;
  answered: number;
  tree: TreemapRoot;
}
```

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

期待: エラーなしで完了。

- [ ] **Step 4: コミット**

```bash
git add pwa-frontend/package.json pwa-frontend/package-lock.json pwa-frontend/src/components/dashboard/treemap/treemapTypes.ts
git commit -m "feat(pwa): d3-hierarchy 依存追加 + ツリーマップ型定義"
```

---

## Task 8: PWA `services/treemapApi.ts` 作成

**Files:**
- Create: `pwa-frontend/src/services/treemapApi.ts`

- [ ] **Step 1: API ラッパー作成**

```typescript
import type { ApiResponse } from '../types';
import type { TreemapResponse } from '../components/dashboard/treemap/treemapTypes';

const GAS_API_URL = import.meta.env.VITE_GAS_API_URL || '';

interface CurriculumData {
  department: string;
  grades: Record<string, { categories: string[]; maxDifficulty: number }>;
}

/**
 * 学生プロファイルから curriculum.json を読み込み、
 * その学年までに累積される大分類リストを返す。
 *
 * 例: grade=2 の場合、grade 1 と 2 の categories の和集合を返す。
 */
export async function loadAllowedCategories(
  department: string,
  grade: number
): Promise<string[]> {
  const url = `${import.meta.env.BASE_URL || '/'}data/curriculum/${department}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`curriculum.json fetch failed: ${res.status}`);
  const data = (await res.json()) as CurriculumData;

  const accumulated = new Set<string>();
  for (let g = 1; g <= grade; g++) {
    const entry = data.grades[String(g)];
    if (!entry) continue;
    for (const cat of entry.categories) accumulated.add(cat);
  }
  return Array.from(accumulated);
}

/**
 * GAS API: ツリーマップ取得
 */
export async function fetchStudentTreemap(params: {
  studentId: string;
  department: string;
  grade: number;
}): Promise<ApiResponse<TreemapResponse>> {
  if (!GAS_API_URL) {
    return { success: false, error: 'API URL not configured' };
  }

  let categories: string[];
  try {
    categories = await loadAllowedCategories(params.department, params.grade);
  } catch (err) {
    return { success: false, error: 'curriculum 読み込み失敗: ' + String(err) };
  }
  if (categories.length === 0) {
    return { success: false, error: '対象学年の出題範囲が空です' };
  }

  const url = new URL(GAS_API_URL);
  url.searchParams.set('action', 'getStudentTreemap');
  url.searchParams.set('studentId', params.studentId);
  url.searchParams.set('department', params.department);
  url.searchParams.set('grade', String(params.grade));
  url.searchParams.set('categories', categories.join(','));

  try {
    const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' });
    return await res.json();
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
```

- [ ] **Step 2: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

期待: エラーなし。

- [ ] **Step 3: dev console での動作確認 (任意・参考用)**

`vite dev` 起動中に DevTools console から呼び出して JSON 受信を確認できる。Phase A の自動テスト基盤がないため、Task 13 の画面表示で総合確認する。

- [ ] **Step 4: コミット**

```bash
git add pwa-frontend/src/services/treemapApi.ts
git commit -m "feat(pwa): treemapApi — curriculum 結合 + GAS API 呼び出し"
```

---

## Task 9: PWA `Treemap.tsx` 描画コンポーネント

**Files:**
- Create: `pwa-frontend/src/components/dashboard/treemap/Treemap.tsx`

- [ ] **Step 1: 描画コンポーネント作成**

```tsx
import { useMemo } from 'react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { interpolateRdYlGn } from 'd3-scale-chromatic';
import type {
  TreemapRoot,
  TreemapCategory,
  TreemapSubcategory,
  TreemapLeaf,
  Confidence,
} from './treemapTypes';

interface TreemapProps {
  data: TreemapRoot;
  width: number;
  height: number;
}

type AnyNode =
  | TreemapRoot
  | TreemapCategory
  | TreemapSubcategory
  | TreemapLeaf;

function isLeaf(node: AnyNode): node is TreemapLeaf {
  return !('children' in node);
}

function leafColor(leaf: TreemapLeaf): { fill: string; opacity: number } {
  if (leaf.confidence === 'none' || leaf.correctRate === null) {
    return { fill: '#cbd5e1', opacity: 1 };
  }
  const fill = interpolateRdYlGn(leaf.correctRate / 100);
  const opacity = leaf.confidence === 'low' ? 0.5 : 1;
  return { fill, opacity };
}

const HEADER_CAT = 24;
const HEADER_SUB = 18;
const LABEL_MIN_W = 40;
const LABEL_MIN_H = 24;

export function Treemap({ data, width, height }: TreemapProps) {
  const root = useMemo(() => {
    const h = hierarchy<AnyNode>(data, (d) =>
      isLeaf(d) ? null : (d as { children: AnyNode[] }).children
    );
    h.sum((d) => (isLeaf(d) ? d.totalQuestions : 0));
    h.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<AnyNode>()
      .size([width, height])
      .tile(treemapSquarify)
      .paddingTop((node) => {
        if (node.depth === 1) return HEADER_CAT;
        if (node.depth === 2) return HEADER_SUB;
        return 0;
      })
      .paddingInner(2)
      .paddingOuter(1)
      .round(true)(h);
    return h;
  }, [data, width, height]);

  const leaves = root.descendants();

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block', background: '#ffffff' }}
    >
      {leaves.map((node, i) => {
        const x = node.x0 ?? 0;
        const y = node.y0 ?? 0;
        const w = (node.x1 ?? 0) - x;
        const h = (node.y1 ?? 0) - y;
        if (w <= 0 || h <= 0) return null;

        const datum = node.data;
        const depth = node.depth;

        if (depth === 0) {
          return null;
        }

        if (isLeaf(datum)) {
          const color = leafColor(datum);
          const showLabel = w >= LABEL_MIN_W && h >= LABEL_MIN_H;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={color.fill}
                fillOpacity={color.opacity}
                stroke="#ffffff"
                strokeWidth={1}
              />
              {showLabel && (
                <text
                  x={x + w / 2}
                  y={y + h / 2}
                  fontSize={11}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#1e293b"
                  pointerEvents="none"
                >
                  {datum.name}
                </text>
              )}
            </g>
          );
        }

        // 親階層: 白背景 + 上端ヘッダ帯のみ
        const headerH = depth === 1 ? HEADER_CAT : HEADER_SUB;
        const fontWeight = depth === 1 ? 700 : 500;
        const fontSize = depth === 1 ? 13 : 11;
        const showHeader = w >= LABEL_MIN_W && headerH >= 14;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="#ffffff"
              stroke="#e2e8f0"
              strokeWidth={depth === 1 ? 2 : 1}
            />
            {showHeader && (
              <>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={headerH}
                  fill="#f1f5f9"
                />
                <text
                  x={x + 6}
                  y={y + headerH / 2}
                  fontSize={fontSize}
                  fontWeight={fontWeight}
                  dominantBaseline="middle"
                  fill="#1e293b"
                  pointerEvents="none"
                >
                  {datum.name}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 2: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

期待: エラーなし。

- [ ] **Step 3: コミット**

```bash
git add pwa-frontend/src/components/dashboard/treemap/Treemap.tsx
git commit -m "feat(pwa): Treemap 描画コンポーネント (d3-hierarchy + RdYlGn)"
```

---

## Task 10: PWA `TreemapBreadcrumb.tsx`

**Files:**
- Create: `pwa-frontend/src/components/dashboard/treemap/TreemapBreadcrumb.tsx`

- [ ] **Step 1: パンくずコンポーネント作成 (Phase A はクリック非対応・表示のみ)**

```tsx
interface TreemapBreadcrumbProps {
  segments: string[];
}

export function TreemapBreadcrumb({ segments }: TreemapBreadcrumbProps) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 text-sm text-slate-500 overflow-x-auto whitespace-nowrap">
      {segments.map((seg, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-300">/</span>}
          <span className={i === segments.length - 1 ? 'font-bold text-slate-700' : ''}>
            {seg}
          </span>
        </span>
      ))}
    </div>
  );
}
```

Phase A では表示のみで、Phase B でクリックハンドラを追加する。

- [ ] **Step 2: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 3: コミット**

```bash
git add pwa-frontend/src/components/dashboard/treemap/TreemapBreadcrumb.tsx
git commit -m "feat(pwa): TreemapBreadcrumb (Phase A は表示のみ)"
```

---

## Task 11: PWA `TreemapLegend.tsx`

**Files:**
- Create: `pwa-frontend/src/components/dashboard/treemap/TreemapLegend.tsx`

- [ ] **Step 1: 色凡例コンポーネント作成**

```tsx
import { interpolateRdYlGn } from 'd3-scale-chromatic';

interface TreemapLegendProps {
  updatedAt: string;
}

const STOPS = 11; // 0%, 10%, 20%, ..., 100%

export function TreemapLegend({ updatedAt }: TreemapLegendProps) {
  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    : '---';

  const gradientStops = Array.from({ length: STOPS }, (_, i) => {
    const t = i / (STOPS - 1);
    return interpolateRdYlGn(t);
  });
  const gradient = `linear-gradient(to right, ${gradientStops.join(', ')})`;

  return (
    <div className="flex items-center gap-3 px-4 py-1 text-xs text-slate-500">
      <div className="flex items-center gap-1">
        <div className="w-3 h-3 rounded-sm bg-slate-300" />
        <span>未着手</span>
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span>苦手</span>
        <div
          className="flex-1 h-3 rounded-sm border border-slate-200"
          style={{ background: gradient }}
        />
        <span>得意</span>
      </div>
      <span className="text-slate-400 flex-shrink-0">最終更新: {updatedLabel}</span>
    </div>
  );
}
```

- [ ] **Step 2: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 3: コミット**

```bash
git add pwa-frontend/src/components/dashboard/treemap/TreemapLegend.tsx
git commit -m "feat(pwa): TreemapLegend (RdYlGn グラデ + 未着手 + 最終更新)"
```

---

## Task 12: PWA `WeaknessTreemap.tsx` コンテナ

**Files:**
- Create: `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx`

- [ ] **Step 1: コンテナコンポーネント作成**

```tsx
import { useEffect, useState, useRef, useLayoutEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchStudentTreemap } from '../../services/treemapApi';
import { Treemap } from './treemap/Treemap';
import { TreemapBreadcrumb } from './treemap/TreemapBreadcrumb';
import { TreemapLegend } from './treemap/TreemapLegend';
import type { TreemapResponse } from './treemap/treemapTypes';

export function WeaknessTreemap() {
  const { state, dispatch } = useApp();
  const profile = state.profile;
  const [data, setData] = useState<TreemapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      setError('プロファイル未登録');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    fetchStudentTreemap({
      studentId: profile.studentId,
      department: profile.department,
      grade: profile.grade,
    }).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setError(res.error || 'データの取得に失敗しました');
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [profile]);

  useLayoutEffect(() => {
    function update() {
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [data]);

  return (
    <div className="min-h-[100dvh] flex flex-col pb-20">
      <header className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
          className="text-slate-400"
        >
          ← 戻る
        </button>
        <h2 className="text-xl font-bold">分野別学習マップ</h2>
      </header>

      <TreemapBreadcrumb segments={['全体']} />

      {data && <TreemapLegend updatedAt={data.updatedAt} />}

      <div ref={canvasRef} className="flex-1 min-h-[60dvh]">
        {loading && (
          <div className="text-center text-slate-400 py-8">
            読み込み中...
          </div>
        )}
        {error && (
          <div className="text-center text-slate-400 py-8 px-4">
            <p>{error}</p>
          </div>
        )}
        {data && !error && size.width > 0 && (
          <Treemap data={data.tree} width={size.width} height={size.height} />
        )}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-3 px-4">
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">🏠</span><span className="text-xs">ホーム</span>
        </button>
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'quiz' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">📝</span><span className="text-xs">クイズ</span>
        </button>
        <button className="flex flex-col items-center text-primary-500">
          <span className="text-lg">📊</span><span className="text-xs">弱点</span>
        </button>
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'schedule' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">📅</span><span className="text-xs">予定</span>
        </button>
        <button onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'settings' })} className="flex flex-col items-center text-slate-400">
          <span className="text-lg">⚙️</span><span className="text-xs">設定</span>
        </button>
      </nav>
    </div>
  );
}
```

- [ ] **Step 2: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 3: コミット**

```bash
git add pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx
git commit -m "feat(pwa): WeaknessTreemap コンテナ (フェッチ + 描画統合)"
```

---

## Task 13: ナビ差替・既存削除

**Files:**
- Modify: `pwa-frontend/src/App.tsx`
- Delete: `pwa-frontend/src/components/dashboard/WeaknessMap.tsx`

- [ ] **Step 1: App.tsx で `WeaknessMap` のインポートと参照を `WeaknessTreemap` に置換**

`pwa-frontend/src/App.tsx` を開き、以下を実施:

1. `import { WeaknessMap } from './components/dashboard/WeaknessMap';` を `import { WeaknessTreemap } from './components/dashboard/WeaknessTreemap';` に書き換え
2. JSX 中の `<WeaknessMap />` を `<WeaknessTreemap />` に書き換え

(画面ルーティングが switch/match 形式なら、`case 'weakness':` 内のコンポーネントを差し替える)

- [ ] **Step 2: 旧ファイル削除**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git rm pwa-frontend/src/components/dashboard/WeaknessMap.tsx
```

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

期待: エラーなし。`WeaknessMap` 参照が他に残っていればここで型エラーになるので修正する。

- [ ] **Step 4: その他の `WeaknessMap` 参照確認**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
grep -rn "WeaknessMap" src/ 2>/dev/null
```

期待: 結果ゼロ件 (差替済み)。残っていれば手動で `WeaknessTreemap` に置換。

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/App.tsx
git commit -m "feat(pwa): ナビ📊弱点を WeaknessTreemap に差替・旧 WeaknessMap 削除"
```

---

## Task 14: ローカル動作確認

**Files:** (修正なし — 動作確認のみ)

- [ ] **Step 1: dev server 起動**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run dev
```

別ターミナルで継続。

- [ ] **Step 2: ブラウザで `http://localhost:5173/` (または vite が表示する URL) を開く**

DevTools の Console を開いておく。

- [ ] **Step 3: 既存プロファイルでログイン (もしくは新規セットアップ)**

- [ ] **Step 4: 下部ナビ「📊 弱点」をタップ**

- [ ] **Step 5: 動作確認チェックリスト**

以下を目視確認:

- [ ] ヘッダーに「分野別学習マップ」と表示される
- [ ] 「全体」のパンくずが表示される
- [ ] 色凡例(赤→黄→緑グラデ + 未着手グレーサンプル + 最終更新日)が表示される
- [ ] ツリーマップ本体に大分類のヘッダー帯 + 中分類のヘッダー帯 + 小分類セルが**ネストして**表示される
- [ ] 小分類セルの色が、教員 Looker と同じく「赤いほど課題大、緑ほど習熟」になる
- [ ] 未着手分野が グレー で表示される
- [ ] 1-4問しか解いていない分野が 半透明 で表示される
- [ ] スマホ縦長サイズ (DevTools の iPhone 14 Pro エミュレート等) でレイアウトが崩れない

- [ ] **Step 6: GAS API 通信エラーケースの動作確認**

DevTools の Network タブで `getStudentTreemap` リクエストを 「Block request URL」してリロード。
期待: 「データの取得に失敗しました」のエラー表示が出る。

- [ ] **Step 7: 整合性チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate
npm run validate:types
```

両方ともエラーなしで完了することを確認。

- [ ] **Step 8: 動作確認結果を記録**

問題があった場合はここで個別 Task に戻って修正。問題なければ Phase A 完了。

- [ ] **Step 9: 最終コミット (動作確認による微修正があった場合のみ)**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git status
# 修正があった場合
git add -A
git commit -m "fix(pwa): Phase A 動作確認に基づく微調整"
```

---

## Phase A 完了条件

すべて満たされた時点で Phase A 完了:

- ✅ 学生 PWA 「📊 弱点」タブで新ツリーマップが表示される
- ✅ 大分類 > 中分類 > 小分類 の3階層がネスト構造で表示される
- ✅ 小分類セルが教員 Looker と同じ色スケール(RdYlGn)で塗られる
- ✅ 未着手分野がグレーで、1-4問の分野が半透明で表示される
- ✅ 旧 `WeaknessMap.tsx` が削除されている
- ✅ `npm run validate` と `npm run validate:types` が成功する

---

## Phase B/C 予告

Phase A 完了後、別計画として実施:

**Phase B**: タップ→ズーム、ボトムシート、ChallengeFab、未着手まとめセル化、`START_CATEGORY_QUIZ` 連携 (ペイロード拡張: `subtopic`, `scope`)

**Phase C**: ⟳ 即時更新ボタン (`refreshStudentTreemap`)、楽観的更新、`treemapCache` IndexedDB、stale-while-revalidate、オフライン挙動

---

## 自己レビュー結果

- スペックカバレッジ: §1-3 (アーキテクチャ・データモデル) は本計画の Task 1-13 で実装。§4 のうち縦長レイアウト・色凡例・パンくず表示・ヘッダー帯は本計画でカバー。§4 のジェスチャ・ズーム・FAB は Phase B、§5-7 は Phase B/C
- プレースホルダ: なし。`PASTE_REAL_STUDENT_ID_HERE` は実 GAS テスト時に手動置換する旨を文中で明示済み
- 型一貫性: `TreemapLeaf`/`TreemapSubcategory`/`TreemapCategory`/`TreemapRoot`/`TreemapResponse` を Task 7 で定義し、以降の Task 8/9/12 で同一名で参照
- スコープ: Phase A 単独で動作するソフトウェアになる構造を維持
