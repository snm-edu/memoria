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
