import type {
  TreemapRoot,
  TreemapCategory,
  TreemapSubcategory,
  TreemapLeaf,
  FocusPath,
} from './treemapTypes';

export type ScopedView =
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
    if (leaf.isAggregate) return;
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
 * focusPath とリーフから dispatch 用のクイズ範囲を組み立てる。
 */
export function dispatchScopeFromPath(
  path: FocusPath,
  leaf?: TreemapLeaf
): { category: string; subcategory?: string; subtopic?: string } {
  const out: { category: string; subcategory?: string; subtopic?: string } = {
    category: path[0] || '',
  };
  if (path.length >= 2) out.subcategory = path[1];
  if (leaf && !leaf.isAggregate) out.subtopic = leaf.name;
  return out;
}

/**
 * クイズセッション中に解いた1問分のログ。Phase C 楽観更新で使う。
 */
export interface SessionLogEntry {
  category: string;
  subcategory: string;
  subtopic: string;
  isCorrect: boolean;
}

/**
 * payload.tree から (cat, sub, top) パスのリーフを探す。
 * 集約セル (`+未着手N件`) は除外、空文字は GAS と同じ '未分類' に正規化。
 */
export function findLeafByPath(
  tree: TreemapRoot,
  cat: string,
  sub: string,
  top: string
): TreemapLeaf | null {
  const norm = (v: string) => (v && v !== '' ? v : '未分類');
  const targetSub = norm(sub);
  const targetTop = norm(top);
  for (const c of tree.children) {
    if (c.name !== cat) continue;
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
 * 親階層の集計値 (subcategory/category) は変更しない (見た目影響が少ないため)。
 *
 * 注: 引数 tree は in-place で改変される。React state 用には呼び出し側で
 * JSON.parse(JSON.stringify(...)) で深コピーしてから渡すこと。
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
    leaf.correctRate =
      leaf.answered > 0 ? Math.round((leaf.correct / leaf.answered) * 100) : null;
    leaf.confidence =
      leaf.answered >= 5 ? 'high' : leaf.answered >= 1 ? 'low' : 'none';
  }
}
