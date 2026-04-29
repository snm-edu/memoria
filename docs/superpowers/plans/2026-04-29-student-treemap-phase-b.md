# 学生用ツリーマップ Phase B 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase A で表示できるようになった学生用ツリーマップに、タップ→ズーム挙動・小分類ボトムシート・ChallengeFab・未着手まとめセルを実装し、ツリーマップから直接演習開始できるようにする (既存 SM-2 + AI類題生成と自動連携)。

**Architecture:** ズーム状態 (`focusPath: string[]`) を `WeaknessTreemap` で一元管理し、`Treemap` / `TreemapBreadcrumb` / `ChallengeFab` / `LeafDetailSheet` 各子コンポーネントに渡す。出題開始は既存 `START_CATEGORY_QUIZ` dispatch を `subtopic` + `scope` で拡張して再利用する。未着手まとめセルは GAS 集約段階で挿入し、フロントは展開フラグ管理のみ。

**Tech Stack:** React 18 + TypeScript, d3-hierarchy, Tailwind, Google Apps Script, Dexie.js (IndexedDB)

**Spec:** `docs/superpowers/specs/2026-04-28-student-treemap-design.md` (§4.3 ジェスチャ, §4.5 FAB, §5 演習開始フロー, §6.3 まとめセル化)

**Phase B スコープ** (本計画):
- AppContext / QuizFilters の `subtopic` + `scope` 拡張
- 未着手まとめセル化 (GAS 集約)
- ツリーマップのタップ→ズーム挙動
- パンくずクリック対応
- 小分類タップ時のボトムシート (`LeafDetailSheet`)
- 「ここから解く」FAB (`ChallengeFab`)
- ツリーマップから既存 SM-2 + AI 類題生成へ自動連携

**Phase C スコープ** (本計画では扱わない):
- ⟳ 即時更新ボタン (`refreshStudentTreemap`)
- 楽観的更新・`treemapCache` IndexedDB
- stale-while-revalidate
- オフライン挙動

**前提条件:** Phase A が main にマージ済み。`feat/student-treemap-phase-a` ブランチは既に削除済み。本計画も新ブランチ `feat/student-treemap-phase-b` を切って作業する。

---

## ファイル構造

### 新規作成

| パス | 責務 |
|------|------|
| `pwa-frontend/src/components/dashboard/treemap/LeafDetailSheet.tsx` | 小分類タップ時の詳細ボトムシート |
| `pwa-frontend/src/components/dashboard/treemap/ChallengeFab.tsx` | 「ここから解く」FAB |
| `pwa-frontend/src/components/dashboard/treemap/treemapHelpers.ts` | focusPath 走査・サブツリー抽出・苦手数集計の純粋関数 |

### 既存修正

| パス | 修正内容 |
|------|---------|
| `pwa-frontend/src/context/AppContext.tsx` | AppState に `quizSubtopic`, `quizScope` 追加 / `START_CATEGORY_QUIZ` ペイロード拡張 |
| `pwa-frontend/src/hooks/useQuiz.ts` | `QuizFilters` に `subtopic`, `scope` 追加 + 出題ロジック拡張 |
| `pwa-frontend/src/components/quiz/QuizScreen.tsx` | `quizSubtopic` / `quizScope` を filters に渡す |
| `pwa-frontend/src/components/dashboard/AiDashboard.tsx` | 既存 dispatch に `scope: 'all'` を補う (型整合) |
| `pwa-frontend/src/components/dashboard/treemap/treemapTypes.ts` | リーフ型に `isAggregate?: boolean`、aggregate セル用 `aggregateLeaves?` 追加 |
| `pwa-frontend/src/components/dashboard/treemap/Treemap.tsx` | onCellClick prop + focusPath によるサブツリー絞り込み |
| `pwa-frontend/src/components/dashboard/treemap/TreemapBreadcrumb.tsx` | onSegmentClick prop 追加 |
| `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx` | focusPath state + 子コンポーネント連動 + LeafDetailSheet表示制御 |
| `gas-backend/src/TreemapService.gs` | `aggregateUnstudied` 関数で同一親内の `confidence:'none'` 3件以上を `+未着手N件` セルに集約 |

---

## Task 1: AppContext に subtopic/scope 拡張

**Files:**
- Modify: `pwa-frontend/src/context/AppContext.tsx`

- [ ] **Step 1: AppState と AppAction を拡張**

`pwa-frontend/src/context/AppContext.tsx` の該当箇所を以下に書き換え:

```typescript
type QuizScope = 'all' | 'weak' | 'unstudied';

interface AppState {
  profile: StudentProfile | null;
  screen: Screen;
  isOnline: boolean;
  pendingSyncCount: number;
  lastSync: string;
  quizMode: QuizMode;
  quizCategory: string;
  quizSubcategory: string;
  quizSubtopic: string;
  quizScope: QuizScope;
}

type AppAction =
  | { type: 'SET_PROFILE'; profile: StudentProfile }
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_ONLINE'; isOnline: boolean }
  | { type: 'SET_SYNC_COUNT'; count: number }
  | { type: 'SET_LAST_SYNC'; timestamp: string }
  | { type: 'SET_QUIZ_MODE'; mode: QuizMode }
  | {
      type: 'START_CATEGORY_QUIZ';
      category: string;
      subcategory?: string;
      subtopic?: string;
      scope?: QuizScope;
    };
```

- [ ] **Step 2: reducer の START_CATEGORY_QUIZ ケースを拡張**

```typescript
    case 'START_CATEGORY_QUIZ':
      return {
        ...state,
        screen: 'quiz',
        quizMode: 'free',
        quizCategory: action.category,
        quizSubcategory: action.subcategory || '',
        quizSubtopic: action.subtopic || '',
        quizScope: action.scope || 'all',
      };
```

- [ ] **Step 3: initialState に新フィールド追加**

```typescript
const initialState: AppState = {
  profile: null,
  screen: 'setup',
  isOnline: navigator.onLine,
  pendingSyncCount: 0,
  lastSync: '',
  quizMode: 'free',
  quizCategory: '',
  quizSubcategory: '',
  quizSubtopic: '',
  quizScope: 'all',
};
```

- [ ] **Step 4: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

期待: AiDashboard の START_CATEGORY_QUIZ 呼出は `scope?` がオプショナルなのでエラーにならない。エラーが出るなら Task 2/3 で対処。

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/context/AppContext.tsx
git commit -m "feat(pwa): AppContext に quizSubtopic/quizScope 追加 (Phase B 準備)"
```

---

## Task 2: QuizFilters と useQuiz の出題ロジック拡張

**Files:**
- Modify: `pwa-frontend/src/hooks/useQuiz.ts`

- [ ] **Step 1: QuizFilters 型拡張**

`useQuiz.ts:17-23` を以下に書き換え:

```typescript
export type QuizScope = 'all' | 'weak' | 'unstudied';

export interface QuizFilters {
  category?: string;
  subcategory?: string;
  subtopic?: string;
  scope?: QuizScope;
  year?: number;
  gradeLimit?: number;
  sourceFilter?: 'official' | 'mock' | 'all';
}
```

- [ ] **Step 2: startSession のフィルタ後ろに subtopic/scope 適用ロジックを追加**

`useQuiz.ts` の `startSession` 内、既存の `if (filters?.subcategory && q.subcategory !== filters.subcategory) return false;` の直後に追加:

```typescript
      if (filters?.subtopic && q.subtopic !== filters.subtopic) return false;
```

そして `pool.filter(...)` ループ後 (= base pool が確定した後)、`scope` 別の絞り込みを追加。`pool` 確定行の直後に挿入:

```typescript
    // scope: weak / unstudied の追加絞り込み
    if (filters?.scope === 'weak' || filters?.scope === 'unstudied') {
      const allCardStates = await db.cardStates.toArray();
      const cardMap = new Map(allCardStates.map((c) => [c.questionId, c]));

      if (filters.scope === 'unstudied') {
        // cardStates に登場していない (= 一度も解いていない) 問題のみ
        pool = pool.filter((q) => !cardMap.has(q.question_id));
      } else if (filters.scope === 'weak') {
        // answerLog 内の正答率<60% の問題、または cardStates の repetitions=0 を優先
        const allLogs = await db.answerLog.toArray();
        const accByQ = new Map<string, { correct: number; total: number }>();
        for (const log of allLogs) {
          const a = accByQ.get(log.questionId) || { correct: 0, total: 0 };
          a.total++;
          if (log.isCorrect) a.correct++;
          accByQ.set(log.questionId, a);
        }
        pool = pool.filter((q) => {
          const a = accByQ.get(q.question_id);
          if (!a || a.total === 0) {
            // 未解答は weak には含めない
            return false;
          }
          return a.correct / a.total < 0.6;
        });
      }
    }
```

`pool = ` で再代入するため、既存の `const pool = ...` を `let pool = ...` に変更する必要がある。該当箇所を `let pool = await db.questionCache.filter(...).toArray();` のように書き換える (既存実装の正確な行は `pool.filter` の前)。

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

期待: エラーなし。

- [ ] **Step 4: dev server で動作確認 (現状の AiDashboard 経由)**

```bash
npm run dev
```

ブラウザで「📊 弱点」 → 「AI分析」と遷移した後の挑戦ボタンが従来通り動くことを確認 (まだツリーマップ側で subtopic/scope は使っていないため、回帰テストとして AiDashboard 経由で挑戦ボタンを試す)。

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/hooks/useQuiz.ts
git commit -m "feat(quiz): QuizFilters に subtopic/scope 追加 + weak/unstudied 絞り込み"
```

---

## Task 3: QuizScreen で quizSubtopic / quizScope を filters に渡す

**Files:**
- Modify: `pwa-frontend/src/components/quiz/QuizScreen.tsx`

- [ ] **Step 1: filters 構築箇所に追記**

`QuizScreen.tsx:111-119` 付近の `const filters: QuizFilters = { category: state.quizCategory };` 周辺を以下のように書き換え:

```typescript
      const filters: QuizFilters = { category: state.quizCategory };
      if (state.quizSubcategory) {
        filters.subcategory = state.quizSubcategory;
      }
      if (state.quizSubtopic) {
        filters.subtopic = state.quizSubtopic;
      }
      if (state.quizScope && state.quizScope !== 'all') {
        filters.scope = state.quizScope;
      }
```

- [ ] **Step 2: useEffect の依存配列を更新**

同ファイル `}, [hasCategory, state.quizCategory, state.quizSubcategory, quiz.startSession, dispatch]);` を以下に変更:

```typescript
  }, [
    hasCategory,
    state.quizCategory,
    state.quizSubcategory,
    state.quizSubtopic,
    state.quizScope,
    quiz.startSession,
    dispatch,
  ]);
```

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 4: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/quiz/QuizScreen.tsx
git commit -m "feat(quiz): QuizScreen で subtopic/scope を filters に渡す"
```

---

## Task 4: GAS で未着手まとめセル化

**Files:**
- Modify: `gas-backend/src/TreemapService.gs`

- [ ] **Step 1: `aggregateUnstudied` 関数を `TreemapService` に追加**

`TreemapService.gs` の `buildTree` 関数の直後 (`getStudentTreemap` の前) に追加:

```javascript
  /**
   * ツリー内の同一親に属する confidence:'none' リーフが3件以上ある場合、
   * '+未着手N件' という isAggregate セルに集約する。
   *
   * 大分類はまとめない (Spec §6.3)。中分類・小分類の親階層 (= 中分類セル内の小分類群)
   * のみ対象。学習が進むと自然にまとめセルが減り進捗実感に繋がる。
   *
   * @param {Object} tree - buildTree の戻り値
   * @return {Object} 同じ tree (in-place 改変)
   */
  aggregateUnstudied: function(tree) {
    var THRESHOLD = 3;
    if (!tree || !tree.children) return tree;

    for (var c = 0; c < tree.children.length; c++) {
      var cat = tree.children[c];
      if (!cat.children) continue;

      for (var s = 0; s < cat.children.length; s++) {
        var sub = cat.children[s];
        if (!sub.children) continue;

        var unstudied = [];
        var others = [];
        for (var l = 0; l < sub.children.length; l++) {
          var leaf = sub.children[l];
          if (leaf.confidence === 'none') unstudied.push(leaf);
          else others.push(leaf);
        }

        if (unstudied.length >= THRESHOLD) {
          var totalQ = 0;
          for (var u = 0; u < unstudied.length; u++) totalQ += unstudied[u].totalQuestions;
          var aggregate = {
            name: '+未着手' + unstudied.length + '件',
            totalQuestions: totalQ,
            answered: 0,
            correct: 0,
            correctRate: null,
            confidence: 'none',
            lastDate: '',
            isAggregate: true,
            aggregateLeaves: unstudied
          };
          sub.children = others.concat([aggregate]);
        }
      }
    }
    return tree;
  },
```

- [ ] **Step 2: `getStudentTreemap` 内で aggregateUnstudied を呼び出す**

`TreemapService.gs` の `getStudentTreemap` 内、`var tree = this.buildTree(leafs);` の直後に追加:

```javascript
      tree = this.aggregateUnstudied(tree);
```

- [ ] **Step 3: テスト関数を追加 (動作確認用)**

ファイル末尾に追加:

```javascript
function testAggregateUnstudied() {
  var ss = getSpreadsheet();
  var allowed = ['医用電気電子工学', '医学概論', '生体機能代行装置学', '医用機械工学',
                 '医用機器安全管理学', '生体計測装置学', '医用治療機器学',
                 '生体物性材料工学', '臨床医学総論'];
  var master = TreemapService.buildLeafMaster(ss, 'clinical_eng', allowed);
  var learned = TreemapService.buildLearnedMap(ss, '', 'snm');
  var leafs = TreemapService.mergeLeafs(master, learned);
  var tree = TreemapService.buildTree(leafs);
  tree = TreemapService.aggregateUnstudied(tree);

  var aggCount = 0;
  for (var c = 0; c < tree.children.length; c++) {
    for (var s = 0; s < tree.children[c].children.length; s++) {
      var sub = tree.children[c].children[s];
      for (var l = 0; l < sub.children.length; l++) {
        if (sub.children[l].isAggregate) {
          aggCount++;
          Logger.log(tree.children[c].name + ' > ' + sub.name + ' > '
            + sub.children[l].name + ' (内包 '
            + sub.children[l].aggregateLeaves.length + ' 件, totalQ='
            + sub.children[l].totalQuestions + ')');
        }
      }
    }
  }
  Logger.log('まとめセル数: ' + aggCount);
}
```

- [ ] **Step 4: ユーザーに GAS エディタでファイル更新 + `testAggregateUnstudied` 実行 + 新バージョンとしてデプロイ依頼**

ユーザーアクション (Claude が依頼を出す):
- GAS エディタで `TreemapService.gs` を最新版に更新
- `testAggregateUnstudied` を実行 → ログで「まとめセル数」が学生の学習進捗に応じた件数 (snm 学籍番号なら数件〜十数件) になることを確認
- 「デプロイ → デプロイの管理 → 既存デプロイの編集 → バージョン: 新しいバージョン → デプロイ」

- [ ] **Step 5: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add gas-backend/src/TreemapService.gs
git commit -m "feat(gas): TreemapService.aggregateUnstudied (3件以上で +未着手N件 集約)"
```

---

## Task 5: PWA 型定義を aggregate セル対応に拡張

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/treemap/treemapTypes.ts`

- [ ] **Step 1: TreemapLeaf に aggregate フィールドを追加**

ファイル全体を以下に書き換え:

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
  isAggregate?: boolean;
  aggregateLeaves?: TreemapLeaf[];
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
  studentNumber: string;
  department: string;
  grade: number;
  updatedAt: string;
  totalQuestions: number;
  answered: number;
  tree: TreemapRoot;
}

export type FocusPath = string[]; // 例: [], ['医用電気電子工学'], ['医用電気電子工学', '電気工学']
```

注: `TreemapLeaf.correct` は Phase A で必須にしていたが、aggregate セルでは `correct: 0` で問題なし。型は変更不要。

- [ ] **Step 2: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 3: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/treemap/treemapTypes.ts
git commit -m "feat(pwa): TreemapLeaf に isAggregate/aggregateLeaves 追加 + FocusPath 型"
```

---

## Task 6: treemapHelpers.ts を新規作成 (focusPath 走査の純粋関数)

**Files:**
- Create: `pwa-frontend/src/components/dashboard/treemap/treemapHelpers.ts`

- [ ] **Step 1: ヘルパー関数を作成**

```typescript
import type {
  TreemapRoot,
  TreemapCategory,
  TreemapSubcategory,
  TreemapLeaf,
  FocusPath,
} from './treemapTypes';

type ScopedView =
  | { kind: 'root'; node: TreemapRoot }
  | { kind: 'category'; node: TreemapCategory }
  | { kind: 'subcategory'; node: TreemapSubcategory };

/**
 * focusPath に従ってサブツリーを取り出す。
 * - [] → ルート (大分類のグリッド)
 * - ['cat'] → 指定大分類 (中分類のグリッド)
 * - ['cat', 'sub'] → 指定中分類 (小分類のグリッド)
 * 不正なパスの場合はルートを返す (フォールバック)。
 */
export function resolveScope(tree: TreemapRoot, path: FocusPath): ScopedView {
  if (path.length === 0) return { kind: 'root', node: tree };

  const cat = tree.children.find((c) => c.name === path[0]);
  if (!cat) return { kind: 'root', node: tree };
  if (path.length === 1) return { kind: 'category', node: cat };

  const sub = cat.children.find((s) => s.name === path[1]);
  if (!sub) return { kind: 'category', node: cat };
  return { kind: 'subcategory', node: sub };
}

/**
 * スコープ内の苦手リーフ数 (correctRate < 60% かつ confidence != 'none') を集計。
 * ChallengeFab の「苦手N問」表示用。
 */
export function countWeakAnswered(scope: ScopedView): number {
  let count = 0;
  function visit(leaf: TreemapLeaf) {
    if (leaf.isAggregate) return; // 未着手まとめは苦手に含めない
    if (leaf.confidence === 'none') return;
    if (leaf.correctRate !== null && leaf.correctRate < 60) {
      count += leaf.answered;
    }
  }
  if (scope.kind === 'root') {
    for (const cat of scope.node.children)
      for (const sub of cat.children) for (const leaf of sub.children) visit(leaf);
  } else if (scope.kind === 'category') {
    for (const sub of scope.node.children) for (const leaf of sub.children) visit(leaf);
  } else {
    for (const leaf of scope.node.children) visit(leaf);
  }
  return count;
}

/**
 * スコープから dispatch 用のクイズ範囲を組み立てる。
 * subtopic 単独 or subcategory レベル or category レベルのいずれか。
 */
export function dispatchScopeFromPath(path: FocusPath, leaf?: TreemapLeaf): {
  category: string;
  subcategory?: string;
  subtopic?: string;
} {
  const out: { category: string; subcategory?: string; subtopic?: string } = {
    category: path[0] || '',
  };
  if (path.length >= 2) out.subcategory = path[1];
  if (leaf && !leaf.isAggregate) out.subtopic = leaf.name;
  return out;
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
git commit -m "feat(pwa): treemapHelpers (focusPath 走査・苦手集計・dispatch構築)"
```

---

## Task 7: Treemap.tsx に onCellClick + focusPath 表示

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/treemap/Treemap.tsx`

- [ ] **Step 1: Props を拡張**

`Treemap.tsx` の interface 部分を以下に書き換え:

```tsx
import type {
  TreemapRoot,
  TreemapCategory,
  TreemapSubcategory,
  TreemapLeaf,
} from './treemapTypes';

interface TreemapProps {
  data: TreemapRoot | TreemapCategory | TreemapSubcategory;
  width: number;
  height: number;
  onCellClick?: (depth: number, datum: AnyNode) => void;
}

type AnyNode =
  | TreemapRoot
  | TreemapCategory
  | TreemapSubcategory
  | TreemapLeaf;
```

`data` 型がスコープに応じて変わるため、Root だけでなく Category / Subcategory も受け取れるようにする。`useMemo` 内の `hierarchy` 呼び出しはそのままで OK (型ジェネリクスが `AnyNode` のため)。

- [ ] **Step 2: SVG セルに onClick ハンドラを付与**

`Treemap.tsx` の `nodes.map((node, i) => {` 内、`<g key={i}>` の開きタグ部分を以下のように書き換え (リーフ・親階層の両方の `<g>` に同じ onClick を付ける):

リーフ側:
```tsx
            <g
              key={i}
              onClick={() => onCellClick?.(node.depth, datum)}
              style={{ cursor: onCellClick ? 'pointer' : 'default' }}
            >
```

親階層側 (depth=1 / depth=2):
```tsx
          <g
            key={i}
            onClick={() => onCellClick?.(node.depth, datum)}
            style={{ cursor: onCellClick ? 'pointer' : 'default' }}
          >
```

- [ ] **Step 3: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 4: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/treemap/Treemap.tsx
git commit -m "feat(pwa): Treemap に onCellClick + スコープ可変 data 対応"
```

---

## Task 8: TreemapBreadcrumb.tsx クリック対応

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/treemap/TreemapBreadcrumb.tsx`

- [ ] **Step 1: ファイル全体を以下に書き換え**

```tsx
interface TreemapBreadcrumbProps {
  segments: string[];
  onSegmentClick?: (index: number) => void;
}

export function TreemapBreadcrumb({ segments, onSegmentClick }: TreemapBreadcrumbProps) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 text-sm text-slate-500 overflow-x-auto whitespace-nowrap">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        const clickable = !isLast && !!onSegmentClick;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-300">/</span>}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSegmentClick(i)}
              className={
                isLast
                  ? 'font-bold text-slate-700'
                  : clickable
                  ? 'text-slate-500 hover:text-primary-500 active:text-primary-600'
                  : 'text-slate-500'
              }
            >
              {seg}
            </button>
          </span>
        );
      })}
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
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/treemap/TreemapBreadcrumb.tsx
git commit -m "feat(pwa): TreemapBreadcrumb クリック対応 (上位階層へジャンプ)"
```

---

## Task 9: ChallengeFab.tsx 新規作成

**Files:**
- Create: `pwa-frontend/src/components/dashboard/treemap/ChallengeFab.tsx`

- [ ] **Step 1: コンポーネント作成**

```tsx
import type { FocusPath } from './treemapTypes';

interface ChallengeFabProps {
  focusPath: FocusPath;
  totalQuestions: number;
  weakCount: number;
  onChallenge: () => void;
}

function scopeLabel(focusPath: FocusPath): string {
  if (focusPath.length === 0) return '全範囲を解く';
  const last = focusPath[focusPath.length - 1];
  return `「${last}」を解く`;
}

export function ChallengeFab({
  focusPath,
  totalQuestions,
  weakCount,
  onChallenge,
}: ChallengeFabProps) {
  const label = scopeLabel(focusPath);
  const subLabel = `${totalQuestions}問 · 苦手${weakCount}問`;

  return (
    <div className="fixed bottom-16 left-0 right-0 px-4 pointer-events-none z-10">
      <div className="max-w-lg mx-auto pointer-events-auto">
        <button
          type="button"
          onClick={onChallenge}
          className="w-full bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl py-3 px-4 shadow-lg active:scale-95 transition-transform"
        >
          <div className="text-base font-bold">🎯 {label}</div>
          <div className="text-xs opacity-90 mt-0.5">{subLabel}</div>
        </button>
      </div>
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
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/treemap/ChallengeFab.tsx
git commit -m "feat(pwa): ChallengeFab (現在スコープを解く・苦手数表示)"
```

---

## Task 10: LeafDetailSheet.tsx 新規作成

**Files:**
- Create: `pwa-frontend/src/components/dashboard/treemap/LeafDetailSheet.tsx`

- [ ] **Step 1: ボトムシートコンポーネント作成**

```tsx
import { interpolateRdYlGn } from 'd3-scale-chromatic';
import type { TreemapLeaf } from './treemapTypes';

interface LeafDetailSheetProps {
  leaf: TreemapLeaf;
  pathLabel: string; // 例: '医用電気電子工学 / 電気工学 / オームの法則'
  onClose: () => void;
  onChallenge: (scope: 'all' | 'weak' | 'unstudied') => void;
  onExpandAggregate?: () => void; // isAggregate のときに展開コールバック
}

function leafColor(leaf: TreemapLeaf): string {
  if (leaf.confidence === 'none' || leaf.correctRate === null) return '#cbd5e1';
  return interpolateRdYlGn(leaf.correctRate / 100);
}

export function LeafDetailSheet({
  leaf,
  pathLabel,
  onClose,
  onChallenge,
  onExpandAggregate,
}: LeafDetailSheetProps) {
  const isAggregate = !!leaf.isAggregate;
  const dateLabel = leaf.lastDate
    ? new Date(leaf.lastDate).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    : '---';

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-end z-30"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-4 h-4 rounded-sm flex-shrink-0 mt-1"
            style={{ backgroundColor: leafColor(leaf) }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 truncate">{pathLabel}</p>
            <p className="text-lg font-bold text-slate-700">{leaf.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 text-xl leading-none">×</button>
        </div>

        {!isAggregate && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-400">出題数</p>
              <p className="text-base font-bold">{leaf.totalQuestions}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-400">解答数</p>
              <p className="text-base font-bold">{leaf.answered}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2 text-center">
              <p className="text-xs text-slate-400">正答率</p>
              <p className="text-base font-bold">
                {leaf.correctRate !== null ? `${leaf.correctRate}%` : '—'}
              </p>
            </div>
          </div>
        )}

        {!isAggregate && (
          <p className="text-xs text-slate-400 mb-4">最終学習日: {dateLabel}</p>
        )}

        {isAggregate && (
          <p className="text-sm text-slate-600 mb-4">
            この中分類には未着手の小分類が {leaf.aggregateLeaves?.length ?? 0} 件あります。
          </p>
        )}

        <div className="space-y-2">
          {isAggregate ? (
            <>
              <button
                onClick={() => onExpandAggregate?.()}
                className="w-full bg-slate-100 text-slate-700 py-3 rounded-lg font-bold active:bg-slate-200"
              >
                個別に表示する
              </button>
              <button
                onClick={() => onChallenge('unstudied')}
                className="w-full bg-primary-500 text-white py-3 rounded-lg font-bold active:bg-primary-600"
              >
                未着手をまとめて解く ({leaf.totalQuestions}問)
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onChallenge('all')}
                className="w-full bg-primary-500 text-white py-3 rounded-lg font-bold active:bg-primary-600"
              >
                この分野を解く
              </button>
              {leaf.answered > 0 && (
                <button
                  onClick={() => onChallenge('weak')}
                  className="w-full bg-red-500 text-white py-3 rounded-lg font-bold active:bg-red-600"
                >
                  苦手だけ解く
                </button>
              )}
              {leaf.confidence === 'none' && (
                <button
                  onClick={() => onChallenge('unstudied')}
                  className="w-full bg-amber-500 text-white py-3 rounded-lg font-bold active:bg-amber-600"
                >
                  初挑戦する
                </button>
              )}
            </>
          )}
        </div>
      </div>
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
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/treemap/LeafDetailSheet.tsx
git commit -m "feat(pwa): LeafDetailSheet (小分類タップ時のボトムシート)"
```

---

## Task 11: WeaknessTreemap.tsx でズーム状態管理 + 各子コンポーネント連動

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx`

- [ ] **Step 1: ファイル全体を以下に書き換え**

```tsx
import { useEffect, useState, useRef, useLayoutEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchStudentTreemap } from '../../services/treemapApi';
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

export function WeaknessTreemap() {
  const { state, dispatch } = useApp();
  const profile = state.profile;
  const [data, setData] = useState<TreemapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [focusPath, setFocusPath] = useState<FocusPath>([]);
  const [activeLeaf, setActiveLeaf] = useState<TreemapLeaf | null>(null);
  const [aggregateExpanded, setAggregateExpanded] = useState<Set<string>>(new Set());

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
      studentNumber: profile.studentNumber || '',
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
  }, [data, focusPath]);

  // focusPath とまとめセル展開状態を加味したサブツリー
  const scopedData = useMemo(() => {
    if (!data) return null;
    const scope = resolveScope(data.tree, focusPath);
    if (scope.kind === 'subcategory') {
      // まとめセル展開中なら個別リーフに置換
      const aggKey = focusPath.join('/');
      if (aggregateExpanded.has(aggKey)) {
        const expandedChildren: TreemapLeaf[] = [];
        for (const leaf of scope.node.children) {
          if (leaf.isAggregate && leaf.aggregateLeaves) {
            expandedChildren.push(...leaf.aggregateLeaves);
          } else {
            expandedChildren.push(leaf);
          }
        }
        return {
          kind: scope.kind,
          node: { ...scope.node, children: expandedChildren },
        };
      }
    }
    return scope;
  }, [data, focusPath, aggregateExpanded]);

  // FAB 用集計
  const fabSummary = useMemo(() => {
    if (!scopedData) return { total: 0, weak: 0 };
    const node = scopedData.node;
    return {
      total: node.totalQuestions,
      weak: countWeakAnswered(scopedData),
    };
  }, [scopedData]);

  // セルタップハンドラ
  function handleCellClick(depth: number, datum: unknown) {
    if (!scopedData) return;
    const cur = focusPath;
    // ルートビュー (cur=[]) で大分類タップ → ['cat']
    // 大分類ビュー (cur=['cat']) で中分類タップ → ['cat', 'sub']
    // 中分類ビュー (cur=['cat','sub']) で小分類タップ → ボトムシート
    if (cur.length === 0 && depth === 1) {
      setFocusPath([(datum as { name: string }).name]);
      return;
    }
    if (cur.length === 1 && depth === 1) {
      setFocusPath([cur[0], (datum as { name: string }).name]);
      return;
    }
    if (cur.length === 2 && depth === 1) {
      setActiveLeaf(datum as TreemapLeaf);
      return;
    }
  }

  // パンくずクリック
  function handleSegmentClick(index: number) {
    setFocusPath(focusPath.slice(0, index));
  }

  // FAB タップ
  function handleFabChallenge() {
    const params = dispatchScopeFromPath(focusPath);
    dispatch({
      type: 'START_CATEGORY_QUIZ',
      category: params.category,
      subcategory: params.subcategory,
      scope: 'all',
    });
  }

  // ボトムシートからの演習開始
  function handleLeafChallenge(scope: 'all' | 'weak' | 'unstudied') {
    if (!activeLeaf) return;
    const params = dispatchScopeFromPath(focusPath, activeLeaf);
    setActiveLeaf(null);
    dispatch({
      type: 'START_CATEGORY_QUIZ',
      category: params.category,
      subcategory: params.subcategory,
      subtopic: params.subtopic,
      scope,
    });
  }

  // まとめセル展開
  function handleExpandAggregate() {
    const aggKey = focusPath.join('/');
    setAggregateExpanded((prev) => {
      const next = new Set(prev);
      next.add(aggKey);
      return next;
    });
    setActiveLeaf(null);
  }

  const breadcrumbSegments = ['全体', ...focusPath];

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

      <TreemapBreadcrumb segments={breadcrumbSegments} onSegmentClick={handleSegmentClick} />

      {data && <TreemapLegend updatedAt={data.updatedAt} />}

      <div ref={canvasRef} className="flex-1 min-h-[55dvh]">
        {loading && (
          <div className="text-center text-slate-400 py-8">読み込み中...</div>
        )}
        {error && (
          <div className="text-center text-slate-400 py-8 px-4">
            <p>{error}</p>
          </div>
        )}
        {scopedData && !error && size.width > 0 && (
          <Treemap
            data={scopedData.node}
            width={size.width}
            height={size.height}
            onCellClick={handleCellClick}
          />
        )}
      </div>

      {data && !loading && !error && (
        <ChallengeFab
          focusPath={focusPath}
          totalQuestions={fabSummary.total}
          weakCount={fabSummary.weak}
          onChallenge={handleFabChallenge}
        />
      )}

      {activeLeaf && (
        <LeafDetailSheet
          leaf={activeLeaf}
          pathLabel={[...focusPath, activeLeaf.name].join(' / ')}
          onClose={() => setActiveLeaf(null)}
          onChallenge={handleLeafChallenge}
          onExpandAggregate={activeLeaf.isAggregate ? handleExpandAggregate : undefined}
        />
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around py-3 px-4 z-20">
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
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/WeaknessTreemap.tsx
git commit -m "feat(pwa): WeaknessTreemap にズーム/ボトムシート/FAB/まとめセル展開を統合"
```

---

## Task 12: AiDashboard.tsx の dispatch を新シグネチャに整合 (任意)

**Files:**
- Modify: `pwa-frontend/src/components/dashboard/AiDashboard.tsx`

- [ ] **Step 1: 既存 dispatch 呼び出しに `scope: 'all'` を補う**

`AiDashboard.tsx:218` 周辺:

```tsx
                          onClick={() => dispatch({
                            type: 'START_CATEGORY_QUIZ',
                            category: cat.category,
                            scope: 'all',
                          })}
```

`AiDashboard.tsx:247` 周辺:

```tsx
                                  onClick={() => dispatch({
                                    type: 'START_CATEGORY_QUIZ',
                                    category: cat.category,
                                    subcategory: subName,
                                    scope: 'all',
                                  })}
```

(scope はオプショナルなので省略しても型は通るが、明示することで意図が明確になる)

- [ ] **Step 2: 型チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate:types
```

- [ ] **Step 3: コミット**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）"
git add pwa-frontend/src/components/dashboard/AiDashboard.tsx
git commit -m "chore(pwa): AiDashboard の START_CATEGORY_QUIZ に scope:'all' を明示"
```

---

## Task 13: 動作確認 (ユーザー手動)

**Files:** (修正なし)

- [ ] **Step 1: GAS の Task 4 デプロイが完了していることを確認**

GAS エディタで `testAggregateUnstudied` を実行 → ログで「まとめセル数」が出ていれば OK。

- [ ] **Step 2: dev server 起動**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run dev
```

- [ ] **Step 3: ブラウザで「📊 弱点」タブを開いて以下をチェック**

- [ ] FAB「全範囲を解く (◯問・苦手◯問)」が画面下部に表示される
- [ ] 大分類セルをタップ → その大分類だけ画面いっぱいにズーム
- [ ] パンくずに `全体 / 医用電気電子工学` のように追加され、`全体` がクリック可能
- [ ] FAB のラベルが「『医用電気電子工学』を解く」に変わる
- [ ] 中分類セルをタップ → その中分類だけ画面いっぱいにズーム
- [ ] パンくずに `全体 / 医用電気電子工学 / 電気工学` と表示
- [ ] 小分類セルをタップ → ボトムシートが下からスライド表示される
- [ ] ボトムシートに「分野名・出題数・解答数・正答率・最終学習日」表示
- [ ] 「この分野を解く」ボタンタップ → クイズ画面に遷移し subtopic 指定で出題される
- [ ] 解答終了後、ホームに戻るとクイズ画面で answerLog に記録される (既存挙動)
- [ ] 「📊 弱点」へ再度遷移すると、解いたセルの色が変化していない (Phase A は楽観更新なし、Phase C で実装)
- [ ] `+未着手N件` のセルをタップ → ボトムシートで「個別に表示する」ボタンが出て、押下するとサブツリーが個別表示される
- [ ] パンくずの `全体` をタップ → focusPath がリセットされ大分類グリッドに戻る

- [ ] **Step 4: 整合性チェック**

```bash
cd "/Users/ny/Documents/MyVault/30_Work/メモリア（Memoria）/pwa-frontend"
npm run validate
npm run validate:types
```

両方ともエラーなし。

- [ ] **Step 5: 残課題があれば個別 Task に戻って修正**

問題なければ Phase B 完了。

---

## Phase B 完了条件

- ✅ ツリーマップから直接演習を開始できる (FAB および 小分類ボトムシート)
- ✅ 大分類タップ → 中分類タップ → 小分類タップのドリルダウン
- ✅ パンくずから上位階層へ戻れる
- ✅ 未着手まとめセル (`+未着手N件`) が3件以上で発動・タップで展開
- ✅ 演習結果は既存 SM-2 + AI類題生成に自動連携 (新規ロジック不要)
- ✅ `npm run validate` / `npm run validate:types` 成功

---

## Phase C 予告

Phase B 完了後、別計画として実施:

- ⟳ 即時更新ボタン (`refreshStudentTreemap` API 新規追加)
- 楽観的更新 (演習後にローカル `treemapCache` を即座に色変化反映)
- IndexedDB `treemapCache` テーブル追加
- stale-while-revalidate
- オフライン挙動・エラー処理マトリクス完備

---

## 自己レビュー結果

**1. Spec coverage:**
- §4.3 ジェスチャ: Task 7 (Treemap onCellClick), Task 8 (Breadcrumb), Task 11 (WeaknessTreemap で組合せ) でカバー
- §4.5 FAB: Task 9 (ChallengeFab) + Task 11 (連動)
- §5.1-5.2 演習開始フロー / dispatch ペイロード拡張: Task 1, 2, 3
- §5.3 既存仕組みとの統合: 新規ロジック不要 (既存 START_CATEGORY_QUIZ → QuizScreen → useQuiz の流れに subtopic/scope を載せるだけ)
- §6.3 まとめセル化: Task 4 (GAS aggregateUnstudied) + Task 5 (型) + Task 11 (展開状態管理)
- 楽観的更新・キャッシュ・⟳ ボタン: Phase C にて (本計画スコープ外)

**2. プレースホルダ:** なし

**3. 型一貫性:**
- `FocusPath = string[]` を Task 5 で定義、以降 Task 6, 9, 11 で参照
- `QuizScope = 'all' | 'weak' | 'unstudied'` を Task 1 と Task 2 でそれぞれ定義しているが、AppContext と useQuiz は別ファイルかつ exports/imports していない既存設計。ただし型として完全一致しており、文字列リテラルなので互換性問題なし。
- `TreemapLeaf.isAggregate` `aggregateLeaves` を Task 5 で追加、Task 6, 10, 11 で参照
- `dispatchScopeFromPath` の戻り値は `{category, subcategory?, subtopic?}` で、Task 11 の dispatch 呼び出しと一致

**4. スコープ:** Phase B のみで動作するソフトウェアになる (各タスク完了後にも常に画面が動作する形を維持)
