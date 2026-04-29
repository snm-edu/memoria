# 学生用ツリーマップ Phase C 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase B までのツリーマップ機能に「即時更新」「楽観的更新」「ローカルキャッシュ」「オフライン対応」を追加し、本番運用に耐える耐障害性とリアルタイム性を獲得する。

**Architecture:** IndexedDB に新テーブル `treemapCache` を追加し、stale-while-revalidate でフェッチ。クイズセッション完了時にローカルキャッシュへ楽観的更新を適用し、解いた問題のセル色が即座に動く。GAS に `refreshStudentTreemap` POST API を新設して、1学生分だけの category_stats 即時再計算を提供する。

**Tech Stack:** Google Apps Script + Google Sheets, React 18 + TypeScript + Vite + Tailwind, Dexie.js (IndexedDB v8)

**Spec:** `docs/superpowers/specs/2026-04-28-student-treemap-design.md` (§7 データ更新・エラー処理・オフライン)

**Phase C スコープ** (本計画):
- GAS `refreshStudentTreemap` API 新規
- IndexedDB `treemapCache` テーブル追加 (Dexie v8)
- ⟳ 即時更新ボタン (ヘッダー右上)
- 楽観的更新 (演習後にローカルキャッシュへ反映 → 即色変化)
- stale-while-revalidate (キャッシュ即表示 + 裏で再フェッチ)
- オフライン挙動 + エラー処理マトリクス完備

**前提条件:** Phase B が main にマージ済み。新ブランチ `feat/student-treemap-phase-c` を切って作業する。PWA に自動テスト基盤がないため、Phase A・B 同様に「実装 → `npm run validate:types` → 動作確認 → コミット」サイクル。

---

## ファイル構造

### 新規作成

| パス | 責務 |
|------|------|
| (なし — すべて既存ファイル拡張) | |

### 既存修正

| パス | 修正内容 |
|------|---------|
| `gas-backend/src/TreemapService.gs` | `refreshStudentTreemap` method + `recomputeCategoryStats` ヘルパー |
| `gas-backend/src/Code.gs` | doPost に `refreshStudentTreemap` routing 追加 |
| `pwa-frontend/src/services/db.ts` | Dexie v8 + `treemapCache` テーブル + 型定義 |
| `pwa-frontend/src/services/treemapApi.ts` | `refreshStudentTreemap` POST 関数 |
| `pwa-frontend/src/components/dashboard/treemap/treemapHelpers.ts` | `findLeafByPath` + `applyOptimisticUpdate` 純粋関数 |
| `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx` | キャッシュ + stale-while-revalidate + ⟳ ボタン + オフライン挙動 |
| `pwa-frontend/src/components/quiz/QuizScreen.tsx` | クイズセッション完了時に楽観更新トリガー (origin='weakness' のときのみ) |

---

## Task 1: GAS `refreshStudentTreemap` API 実装

**Files:**
- Modify: `gas-backend/src/TreemapService.gs`
- Modify: `gas-backend/src/Code.gs`

- [ ] **Step 1: TreemapService.gs に `recomputeCategoryStats` 追加**

`gas-backend/src/TreemapService.gs` の `aggregateUnstudied` 関数の直後に追加:

```javascript
  /**
   * 1学生分の student_logs を集計して category_stats シートを差分更新する。
   *
   * 既存の DashboardService.updateCategoryStats は全学生を一括再計算するため
   * 重い。本関数は studentNumber か studentId に該当する行のみ削除→挿入する
   * 軽量版で、refresh ボタンから呼び出す用途。
   *
   * @param {Spreadsheet} ss
   * @param {string} studentId
   * @param {string} studentNumber - 空文字なら studentId フォールバック
   * @return {void}
   */
  recomputeCategoryStats: function(ss, studentId, studentNumber) {
    var sheetName = 'category_stats';
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    var headers = data[0];
    var idx = {};
    headers.forEach(function(h, i) { idx[h] = i; });

    // 該当行を削除 (下から順に削除して行番号ズレを回避)
    var useNumber = !!studentNumber;
    for (var r = data.length - 1; r >= 1; r--) {
      var row = data[r];
      var match = useNumber
        ? row[idx['student_number']] === studentNumber
        : row[idx['student_id']] === studentId;
      if (match) sheet.deleteRow(r + 1);
    }

    // student_logs を集計
    var allLogs = [];
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var ls = sheets[s];
      var name = ls.getName();
      if (name === CONFIG.SHEETS.STUDENT_LOGS || name.indexOf(CONFIG.SHEETS.STUDENT_LOGS + '_') === 0) {
        var ldata = ls.getDataRange().getValues();
        if (ldata.length <= 1) continue;
        var lheaders = ldata[0];
        var lidx = {};
        lheaders.forEach(function(h, i) { lidx[h] = i; });
        for (var i = 1; i < ldata.length; i++) {
          var lrow = ldata[i];
          var matchLog = useNumber
            ? lrow[lidx['student_number']] === studentNumber
            : lrow[lidx['student_id']] === studentId;
          if (!matchLog) continue;
          allLogs.push({
            studentId: lrow[lidx['student_id']] || '',
            studentNumber: lrow[lidx['student_number']] || '',
            department: lrow[lidx['department']] || '',
            grade: lrow[lidx['grade']] || '',
            questionId: lrow[lidx['question_id']] || '',
            isCorrect: lrow[lidx['is_correct']] === true || lrow[lidx['is_correct']] === 'TRUE',
            timestamp: lrow[lidx['timestamp']] || '',
          });
        }
      }
    }

    if (allLogs.length === 0) return;

    // questions シートからカテゴリ情報取得
    var qSheet = ss.getSheetByName(CONFIG.SHEETS.QUESTIONS);
    var qMap = {};
    if (qSheet) {
      var qdata = qSheet.getDataRange().getValues();
      var qheaders = qdata[0];
      var qidx = {};
      qheaders.forEach(function(h, i) { qidx[h] = i; });
      for (var i = 1; i < qdata.length; i++) {
        var qr = qdata[i];
        qMap[qr[qidx['question_id']]] = {
          category: qr[qidx['category']] || '',
          subcategory: qr[qidx['subcategory']] || '',
          subtopic: qr[qidx['subtopic']] || ''
        };
      }
    }

    // 学生名簿
    var nameMap = {};
    try {
      nameMap = DashboardService.getStudentNameMap();
    } catch (e) {
      Logger.log('getStudentNameMap error: ' + e);
    }

    // (cat, sub, top) で集計
    var stats = {};
    var latest = allLogs[allLogs.length - 1];
    for (var i = 0; i < allLogs.length; i++) {
      var log = allLogs[i];
      var info = qMap[log.questionId];
      if (!info) continue;
      var cat = info.category || '';
      var sub = info.subcategory || '未分類';
      var top = info.subtopic || '未分類';
      var key = cat + '|||' + sub + '|||' + top;
      if (!stats[key]) {
        stats[key] = { correct: 0, total: 0, cat: cat, sub: sub, top: top, lastDate: '' };
      }
      stats[key].total++;
      if (log.isCorrect) stats[key].correct++;
      if (log.timestamp) {
        var dateStr = String(log.timestamp).split('T')[0];
        if (dateStr > stats[key].lastDate) stats[key].lastDate = dateStr;
      }
    }

    // 行を挿入
    var rows = [];
    var studentName = nameMap[latest.studentNumber] || latest.studentNumber || studentId;
    for (var key in stats) {
      var st = stats[key];
      var rate = st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0;
      rows.push([
        studentId,
        latest.studentNumber || '',
        studentName,
        latest.department || '',
        latest.grade || '',
        st.cat, st.sub, st.top,
        st.total, st.correct, rate, st.lastDate
      ]);
    }

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 12).setValues(rows);
    }
  },
```

- [ ] **Step 2: `refreshStudentTreemap` 公開エントリを追加**

同 `TreemapService.gs` の `getStudentTreemap` の直後に追加:

```javascript
  /**
   * 1学生分の category_stats を即時再計算してから getStudentTreemap 同等のレスポンスを返す。
   * フロントの ⟳ ボタンから POST で呼ばれる。
   */
  refreshStudentTreemap: function(params) {
    if (!params || !params.studentId) {
      return { error: 'studentId is required' };
    }
    if (!params.department) {
      return { error: 'department is required' };
    }
    if (!params.categories || !params.categories.length) {
      return { error: 'categories is required' };
    }
    try {
      var ss = getSpreadsheet();
      this.recomputeCategoryStats(ss, params.studentId, params.studentNumber || '');
      return this.getStudentTreemap(params);
    } catch (e) {
      Logger.log('refreshStudentTreemap error: ' + e + '\n' + e.stack);
      return { error: String(e) };
    }
  },
```

- [ ] **Step 3: Code.gs の doPost に routing 追加**

`gas-backend/src/Code.gs` の冒頭 JSDoc コメントに追記:

```
 * POST /exec?action=refreshStudentTreemap { studentId, studentNumber, department, grade, categories }
```

doPost の switch 文に case 追加 (既存 case の中で適切な位置):

```javascript
      case 'refreshStudentTreemap':
        return jsonResponse(TreemapService.refreshStudentTreemap({
          studentId: body.studentId || '',
          studentNumber: body.studentNumber || '',
          department: body.department || '',
          grade: parseInt(body.grade) || 0,
          categories: Array.isArray(body.categories) ? body.categories : [],
        }));
```

- [ ] **Step 4: GAS エディタにファイル更新 + 新バージョンとしてデプロイ (ユーザー手動)**

ユーザーアクション:
- GAS エディタで `TreemapService.gs` と `Code.gs` を最新版に更新
- 「デプロイ → デプロイの管理 → 既存デプロイの編集 → バージョン: 新しいバージョン → デプロイ」

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/TreemapService.gs gas-backend/src/Code.gs
git commit -m "feat(gas): refreshStudentTreemap API + recomputeCategoryStats"
```

---

## Task 2: Dexie v8 — treemapCache テーブル追加

**Files:**
- Modify: `pwa-frontend/src/services/db.ts`

- [ ] **Step 1: 型定義を追加**

`pwa-frontend/src/services/db.ts` の `AiCacheEntry` interface の直後に追加:

```typescript
// ツリーマップ表示データのキャッシュ + 楽観更新管理
export interface TreemapCacheEntry {
  studentId: string; // primary key
  fetchedAt: number; // Unix ms (サーバから最後に取得した時刻)
  payload: unknown; // TreemapResponse (型循環を避けるため unknown)
  pendingSync: boolean; // 楽観更新後・サーバ未同期
  lastQuizAt: number | null; // 最後にクイズで楽観更新した時刻
}
```

- [ ] **Step 2: NurseMemoriaDB に treemapCache テーブル + v8 スキーマを追加**

`db.ts` の `NurseMemoriaDB` クラス内、既存テーブル宣言の直後に追加:

```typescript
  treemapCache!: Table<TreemapCacheEntry>;
```

constructor 内、最後のバージョン定義の後に v8 マイグレーションを追加 (既存最終バージョンが v7 の場合):

```typescript
    // v8: ツリーマップキャッシュ (Phase C: 楽観更新 + stale-while-revalidate)
    this.version(8).stores({
      profile: '++id, studentId, studentNumber, department, grade, studentType',
      cardStates: 'questionId, nextReview, [questionId+nextReview]',
      questionCache: 'question_id, department, category, exam_year',
      answerLog: '++id, questionId, timestamp, synced',
      aiCache: '++id, [questionId+selectedAnswer], questionId',
      gamification: '++id, visitorId',
      treemapCache: 'studentId',
    });
```

注: `db.ts` 末尾で v7 までの定義がある場合、その後ろに上記を追加する。既存バージョンが v7 より新しければ、既存最終バージョン+1 として v9 等にずらす (v 番号は単調増加であれば良い)。

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

期待: エラーなし。

- [ ] **Step 4: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/services/db.ts
git commit -m "feat(pwa): Dexie v8 — treemapCache テーブル追加"
```

---

## Task 3: treemapApi.ts に refreshStudentTreemap 追加

**Files:**
- Modify: `pwa-frontend/src/services/treemapApi.ts`

- [ ] **Step 1: refreshStudentTreemap 関数を追加**

`treemapApi.ts` の末尾 (既存 `fetchStudentTreemap` の後) に追加:

```typescript
/**
 * GAS API (POST): 1学生分の category_stats を即時再計算してから取得。
 * ⟳ ボタンから呼び出す。
 *
 * GAS の同時実行制限・短期連打を避けるため、呼び出し側でデバウンスを実装する。
 */
export async function refreshStudentTreemap(params: {
  studentId: string;
  studentNumber: string;
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

  try {
    const res = await fetch(GAS_API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'refreshStudentTreemap',
        studentId: params.studentId,
        studentNumber: params.studentNumber,
        department: params.department,
        grade: params.grade,
        categories,
      }),
    });
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

- [ ] **Step 3: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/services/treemapApi.ts
git commit -m "feat(pwa): treemapApi に refreshStudentTreemap (POST) 追加"
```

---

## Task 4: treemapHelpers に楽観的更新 + リーフ走査関数

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/treemap/treemapHelpers.ts`

- [ ] **Step 1: ヘルパー関数 2つを追加**

`treemapHelpers.ts` の末尾 (既存 `dispatchScopeFromPath` の後) に追加:

```typescript
/**
 * セッション中に解いた問題ログ (questionId + isCorrect 等) を表す型。
 * applyOptimisticUpdate に渡す。
 */
export interface SessionLogEntry {
  category: string;
  subcategory: string;
  subtopic: string;
  isCorrect: boolean;
}

/**
 * payload.tree から (cat, sub, top) パスのリーフを探す。集約セルは除外。
 */
export function findLeafByPath(
  tree: TreemapRoot,
  cat: string,
  sub: string,
  top: string
): TreemapLeaf | null {
  const norm = (v: string) => (v && v !== '' ? v : '未分類');
  const targetCat = cat;
  const targetSub = norm(sub);
  const targetTop = norm(top);
  for (const c of tree.children) {
    if (c.name !== targetCat) continue;
    for (const s of c.children) {
      if (s.name !== targetSub) continue;
      for (const leaf of s.children) {
        if (leaf.isAggregate) continue;
        if (leaf.name === targetTop) return leaf;
      }
    }
  }
  return null;
}

/**
 * クイズセッションで解いた問題ログを使って payload.tree のリーフを楽観的に更新する。
 * answered/correct を加算、correctRate を再計算、confidence を再判定。
 * 親階層 (subcategory/category) の集計は変更しない (見た目に大きな影響がないため)。
 *
 * 注: 引数 payload は in-place で改変される。React state 用には呼び出し側で
 * 浅いコピーを作ってから渡すこと。
 */
export function applyOptimisticUpdate(
  tree: TreemapRoot,
  logs: SessionLogEntry[]
): void {
  for (const log of logs) {
    const leaf = findLeafByPath(tree, log.category, log.subcategory, log.subtopic);
    if (!leaf) continue;
    leaf.answered += 1;
    if (log.isCorrect) leaf.correct += 1;
    leaf.correctRate = leaf.answered > 0
      ? Math.round((leaf.correct / leaf.answered) * 100)
      : null;
    leaf.confidence = leaf.answered >= 5 ? 'high' : leaf.answered >= 1 ? 'low' : 'none';
  }
}
```

- [ ] **Step 2: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 3: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/treemap/treemapHelpers.ts
git commit -m "feat(pwa): treemapHelpers に findLeafByPath + applyOptimisticUpdate"
```

---

## Task 5: WeaknessTreemap で stale-while-revalidate + キャッシュ表示

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx`

- [ ] **Step 1: import を更新**

ファイル先頭の import 部分を以下に拡張:

```tsx
import { useEffect, useState, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchStudentTreemap, refreshStudentTreemap } from '../../services/treemapApi';
import { db } from '../../services/db';
import { Treemap } from './treemap/Treemap';
import { TreemapBreadcrumb } from './treemap/TreemapBreadcrumb';
import { TreemapLegend } from './treemap/TreemapLegend';
import { ChallengeFab } from './treemap/ChallengeFab';
import { LeafDetailSheet } from './treemap/LeafDetailSheet';
import {
  resolveScope,
  countWeakAnswered,
  dispatchScopeFromPath,
} from './treemap/treemapHelpers';
import type {
  TreemapResponse,
  TreemapLeaf,
  FocusPath,
} from './treemap/treemapTypes';
```

- [ ] **Step 2: 既存 fetch useEffect を stale-while-revalidate に置き換え**

`WeaknessTreemap.tsx` 内、既存の `useEffect(() => { ... fetchStudentTreemap ... }, [profile])` を以下に置き換え:

```tsx
  const STALE_MS = 24 * 60 * 60 * 1000; // 24時間

  useEffect(() => {
    if (!profile) {
      setLoading(false);
      setError('プロファイル未登録');
      return;
    }
    let cancelled = false;

    async function loadFromCache() {
      const cached = await db.treemapCache.get(profile!.studentId);
      if (cached && cached.payload) {
        if (!cancelled) {
          setData(cached.payload as TreemapResponse);
          setLoading(false);
        }
        return cached;
      }
      return null;
    }

    async function fetchFresh() {
      const res = await fetchStudentTreemap({
        studentId: profile!.studentId,
        studentNumber: profile!.studentNumber || '',
        department: profile!.department,
        grade: profile!.grade,
      });
      if (cancelled) return;
      if (res.success && res.data) {
        setData(res.data);
        setError('');
        await db.treemapCache.put({
          studentId: profile!.studentId,
          fetchedAt: Date.now(),
          payload: res.data,
          pendingSync: false,
          lastQuizAt: null,
        });
      } else {
        // キャッシュがあればそのまま、無ければエラー表示
        const cached = await db.treemapCache.get(profile!.studentId);
        if (!cached) {
          setError(res.error || 'データの取得に失敗しました');
        }
      }
      if (!cancelled) setLoading(false);
    }

    setLoading(true);
    setError('');

    (async () => {
      const cached = await loadFromCache();
      const isStale = !cached || Date.now() - cached.fetchedAt > STALE_MS;
      if (!cached || isStale) {
        // キャッシュなし or stale → 即フェッチ (オフラインなら fetchFresh が失敗してフォールバック)
        if (navigator.onLine) {
          await fetchFresh();
        } else if (!cached) {
          setError('オフラインです。一度オンラインで起動するとキャッシュされます。');
          setLoading(false);
        } else {
          // オフライン + キャッシュあり: そのまま表示
          setLoading(false);
        }
      } else {
        // 新鮮なキャッシュあり: 表示済み、裏フェッチ不要
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile]);
```

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 4: dev server で動作確認**

```bash
npm run dev
```

ブラウザで「📊 弱点」を開く → 1回目はサーバ取得して表示 → 一度別タブに行ってから再度「📊 弱点」 → キャッシュから即表示される。

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx
git commit -m "feat(pwa): WeaknessTreemap に stale-while-revalidate キャッシュ"
```

---

## Task 6: WeaknessTreemap に ⟳ 即時更新ボタン

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx`

- [ ] **Step 1: refreshing state と handleRefresh を追加**

`WeaknessTreemap.tsx` 内、既存 useState 群の後に追加:

```tsx
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshAt = useRef<number>(0);

  const handleRefresh = useCallback(async () => {
    if (!profile || refreshing) return;
    // 60秒デバウンス
    if (Date.now() - lastRefreshAt.current < 60_000) {
      return;
    }
    lastRefreshAt.current = Date.now();
    setRefreshing(true);
    try {
      const res = await refreshStudentTreemap({
        studentId: profile.studentId,
        studentNumber: profile.studentNumber || '',
        department: profile.department,
        grade: profile.grade,
      });
      if (res.success && res.data) {
        setData(res.data);
        setError('');
        await db.treemapCache.put({
          studentId: profile.studentId,
          fetchedAt: Date.now(),
          payload: res.data,
          pendingSync: false,
          lastQuizAt: null,
        });
      } else {
        setError(res.error || '更新に失敗しました');
      }
    } finally {
      setRefreshing(false);
    }
  }, [profile, refreshing]);
```

- [ ] **Step 2: ヘッダーに ⟳ ボタンを追加**

`<header>` 内、既存の戻るボタンとタイトルの後 (ChallengeFab の前) に挿入:

```tsx
        {data && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="最新データに更新"
            className={`w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0 transition-colors ${
              refreshing ? 'bg-slate-100 text-slate-400 animate-spin' : 'bg-slate-100 text-slate-600 active:bg-slate-200'
            }`}
          >
            ⟳
          </button>
        )}
```

ヘッダーの flex 配置は既存通り (戻る → タイトル → ⟳ → ChallengeFab)。

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 4: dev server で確認**

「📊 弱点」を開いて ⟳ ボタンをタップ → スピナー回転 → 数秒後に最新データに更新。直後にもう一度押そうとしても反応しない (60秒デバウンス)。

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx
git commit -m "feat(pwa): WeaknessTreemap に ⟳ 即時更新ボタン (60秒デバウンス)"
```

---

## Task 7: QuizScreen から楽観的更新トリガー

**Files:**
- Modify: `pwa-frontend/src/components/quiz/QuizScreen.tsx`

- [ ] **Step 1: import を追加**

`QuizScreen.tsx` の import 群に追加:

```tsx
import { db } from '../../services/db';
import {
  applyOptimisticUpdate,
  type SessionLogEntry,
} from '../../components/dashboard/treemap/treemapHelpers';
import type { TreemapResponse } from '../../components/dashboard/treemap/treemapTypes';
```

(既に `useApp` などは import 済みのはず)

- [ ] **Step 2: isFinished useEffect を追加**

`QuizScreen.tsx` の関数コンポーネント内、既存の useEffect 群の後に追加:

```tsx
  // クイズセッション完了時、ツリーマップ起点の演習なら treemapCache を楽観更新する。
  // QuizScreen が isFinished になった瞬間、最新 sessionStats.total 件の answerLog を
  // セッションログとみなして applyOptimisticUpdate を実行する。
  const optimisticDoneRef = useRef(false);
  useEffect(() => {
    if (!quiz.isFinished) {
      optimisticDoneRef.current = false;
      return;
    }
    if (optimisticDoneRef.current) return;
    if (state.quizOrigin !== 'weakness') return;
    if (!state.profile) return;
    if (quiz.sessionStats.total === 0) return;
    optimisticDoneRef.current = true;

    (async () => {
      const cached = await db.treemapCache.get(state.profile!.studentId);
      if (!cached || !cached.payload) return;
      const payload = cached.payload as TreemapResponse;

      // 直近 N 件の answerLog をこのセッションのログとみなす
      const recentLogs = await db.answerLog
        .orderBy('timestamp')
        .reverse()
        .limit(quiz.sessionStats.total)
        .toArray();

      // questionCache と join して category/subcategory/subtopic を取得
      const qIds = recentLogs.map((l) => l.questionId);
      const qs = await db.questionCache.where('question_id').anyOf(qIds).toArray();
      const qMap = new Map(qs.map((q) => [q.question_id, q]));

      const sessionLogs: SessionLogEntry[] = [];
      for (const log of recentLogs) {
        const q = qMap.get(log.questionId);
        if (!q) continue;
        sessionLogs.push({
          category: q.category,
          subcategory: q.subcategory || '',
          subtopic: q.subtopic || '',
          isCorrect: log.isCorrect,
        });
      }

      // payload を浅くクローンして in-place 更新 → 永続化
      const cloned = JSON.parse(JSON.stringify(payload)) as TreemapResponse;
      applyOptimisticUpdate(cloned.tree, sessionLogs);

      await db.treemapCache.put({
        studentId: state.profile!.studentId,
        fetchedAt: cached.fetchedAt,
        payload: cloned,
        pendingSync: true,
        lastQuizAt: Date.now(),
      });
    })();
  }, [quiz.isFinished, quiz.sessionStats.total, state.quizOrigin, state.profile]);
```

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 4: dev server で動作確認**

「📊 弱点」 → 大分類 → 小分類タップ → 「この分野を解く」 → 数問解く → 終了画面 → 「学習マップに戻る」 → 解いたセルの色が変化していること確認。

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/quiz/QuizScreen.tsx
git commit -m "feat(pwa): クイズ完了時に treemapCache を楽観的更新"
```

---

## Task 8: オフライン挙動 + エラー処理マトリクス

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx`

- [ ] **Step 1: オフライン状態とキャッシュ取得時刻を表示**

`WeaknessTreemap.tsx` のステート定義に追加:

```tsx
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
```

Task 5 で書いた `loadFromCache` および `fetchFresh` の各分岐で、setCachedAt / setPendingSync を更新するように改修:

```tsx
    async function loadFromCache() {
      const cached = await db.treemapCache.get(profile!.studentId);
      if (cached && cached.payload) {
        if (!cancelled) {
          setData(cached.payload as TreemapResponse);
          setCachedAt(cached.fetchedAt);
          setPendingSync(cached.pendingSync);
          setLoading(false);
        }
        return cached;
      }
      return null;
    }

    async function fetchFresh() {
      const res = await fetchStudentTreemap({
        studentId: profile!.studentId,
        studentNumber: profile!.studentNumber || '',
        department: profile!.department,
        grade: profile!.grade,
      });
      if (cancelled) return;
      if (res.success && res.data) {
        setData(res.data);
        setError('');
        const now = Date.now();
        setCachedAt(now);
        setPendingSync(false);
        await db.treemapCache.put({
          studentId: profile!.studentId,
          fetchedAt: now,
          payload: res.data,
          pendingSync: false,
          lastQuizAt: null,
        });
      } else {
        const cached = await db.treemapCache.get(profile!.studentId);
        if (!cached) {
          setError(res.error || 'データの取得に失敗しました');
        }
      }
      if (!cancelled) setLoading(false);
    }
```

- [ ] **Step 2: TreemapLegend に渡す updatedAt をローカルキャッシュ基準に変更**

`<TreemapLegend updatedAt={data.updatedAt} />` を以下に変更:

```tsx
      {data && (
        <TreemapLegend
          updatedAt={
            cachedAt ? new Date(cachedAt).toISOString() : data.updatedAt
          }
        />
      )}
```

- [ ] **Step 3: pendingSync バッジを画面下部に表示**

`<nav>` 直前 (ナビバーの上) に追加:

```tsx
      {pendingSync && (
        <div className="fixed bottom-16 left-0 right-0 px-4 z-10 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-3 py-2 text-center">
            🔄 ローカル表示中。⟳ で最新化できます
          </div>
        </div>
      )}
```

- [ ] **Step 4: オフライン時のバッジ追加**

`<header>` の下、`<TreemapBreadcrumb>` の上に挿入:

```tsx
      {!navigator.onLine && (
        <div className="bg-slate-100 text-slate-500 text-xs px-4 py-1 text-center">
          📡 オフラインです (キャッシュ表示中)
        </div>
      )}
```

注: `navigator.onLine` は React の再レンダ契機にならないため、`useApp().state.isOnline` (既存) を使う。修正:

```tsx
      {!state.isOnline && (
        <div className="bg-slate-100 text-slate-500 text-xs px-4 py-1 text-center">
          📡 オフラインです (キャッシュ表示中)
        </div>
      )}
```

- [ ] **Step 5: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 6: dev server で動作確認**

DevTools → Network → Throttling: Offline にしてリロード → キャッシュ表示+「オフラインです」バッジ。Online に戻して ⟳ → サーバ取得 → バッジ消える。

- [ ] **Step 7: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx
git commit -m "feat(pwa): オフラインバッジ + pendingSync 表示 + キャッシュ取得時刻表示"
```

---

## Task 9: 動作確認 (ユーザー手動)

**Files:** (修正なし)

- [ ] **Step 1: GAS デプロイの完了確認**

ユーザーが Task 1 Step 4 のデプロイを完了している前提。未完了なら依頼。

- [ ] **Step 2: dev server 起動**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run dev
```

- [ ] **Step 3: 動作確認チェックリスト**

- [ ] 「📊 弱点」初回表示 → サーバ取得 → 色付きツリーマップ表示
- [ ] 別タブに行ってから戻る → キャッシュから即時表示 (<100ms)
- [ ] ⟳ ボタンタップ → スピナー回転 → 最新データ表示
- [ ] ⟳ 直後に再度タップ → 反応なし (60秒デバウンス)
- [ ] 大分類タップ → ズーム → 小分類タップ → ボトムシート → 「この分野を解く」 → クイズ
- [ ] 数問解いて完了 → 「学習マップに戻る」 → **解いたセルの色が変化** (楽観更新)
- [ ] 画面下部に「🔄 ローカル表示中。⟳ で最新化できます」バッジ
- [ ] ⟳ で最新化 → バッジ消える
- [ ] DevTools Network → Offline → リロード → キャッシュ表示 + 「📡 オフラインです」
- [ ] Online に戻す → ⟳ で再フェッチ
- [ ] アプリを完全リセット (DevTools → Application → IndexedDB → Delete) して Offline でアクセス → 「オフラインです。一度オンラインで起動するとキャッシュされます。」エラー表示

- [ ] **Step 4: 整合性チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate
npm run validate:types
```

両方ともエラーなし。

- [ ] **Step 5: 残課題があれば個別 Task に戻って修正、無ければ Phase C 完了**

---

## Phase C 完了条件

- ✅ ⟳ ボタンで即時データ更新 (60秒デバウンス)
- ✅ クイズセッション後にローカルキャッシュへ楽観更新 → 即色変化
- ✅ stale-while-revalidate でキャッシュ即表示・24h で裏フェッチ
- ✅ オフライン時にキャッシュから表示 + バッジ
- ✅ pendingSync 中に「ローカル表示中」のヒント表示
- ✅ `npm run validate` / `npm run validate:types` 成功

---

## 自己レビュー結果

**1. Spec coverage:**
- §7.1 更新タイミング: Task 5 (stale-while-revalidate, mount時), Task 6 (即時更新), Task 7 (演習後楽観), Task 1 (日次バッチは既存)
- §7.2 エラー処理マトリクス: Task 5 (キャッシュフォールバック), Task 6 (refresh失敗時), Task 8 (オフラインバッジ)
- §7.3 レート制限対策: Task 6 (60秒デバウンス)
- §7.4 オフライン挙動: Task 5 (オフライン+キャッシュ), Task 8 (バッジ)
- §7.5 楽観的更新: Task 4 (helpers), Task 7 (QuizScreen 統合)

**2. プレースホルダ:** なし。各 Step に具体コード含む

**3. 型一貫性:**
- `TreemapCacheEntry`: Task 2 で定義、Task 5/6/7/8 で参照
- `SessionLogEntry`: Task 4 で定義、Task 7 で使用
- `findLeafByPath` `applyOptimisticUpdate`: Task 4 定義、Task 7 で `applyOptimisticUpdate` 使用
- `refreshStudentTreemap` API: Task 1 (GAS) → Task 3 (PWA wrapper) → Task 6 (UI) で一貫したシグネチャ

**4. スコープ:** Phase C のみ、各タスクが独立したコミット単位で動作可能。Phase A・B との後方互換は維持
