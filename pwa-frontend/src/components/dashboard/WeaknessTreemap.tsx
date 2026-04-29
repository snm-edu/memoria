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
        } as typeof scope;
      }
    }
    return scope;
  }, [data, focusPath, aggregateExpanded]);

  const fabSummary = useMemo(() => {
    if (!scopedData) return { total: 0, weak: 0 };
    return {
      total: scopedData.node.totalQuestions,
      weak: countWeakAnswered(scopedData),
    };
  }, [scopedData]);

  function handleCellClick(depth: number, datum: unknown) {
    const cur = focusPath;
    if (cur.length === 0 && depth === 1) {
      setFocusPath([(datum as { name: string }).name]);
      return;
    }
    if (cur.length === 1 && depth === 1) {
      setFocusPath([cur[0]!, (datum as { name: string }).name]);
      return;
    }
    if (cur.length === 2 && depth === 1) {
      setActiveLeaf(datum as TreemapLeaf);
      return;
    }
  }

  function handleSegmentClick(index: number) {
    setFocusPath(focusPath.slice(0, index));
  }

  function handleFabChallenge() {
    const params = dispatchScopeFromPath(focusPath);
    dispatch({
      type: 'START_CATEGORY_QUIZ',
      category: params.category,
      subcategory: params.subcategory,
      scope: 'all',
    });
  }

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

  const showFab = !!data && !loading && !error;

  return (
    <div className="min-h-[100dvh] flex flex-col pb-20">
      <header className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
          className="text-slate-400"
        >
          ← 戻る
        </button>
        <h2 className="text-xl font-bold flex-1">分野別学習マップ</h2>
        {showFab && <ChallengeFab onChallenge={handleFabChallenge} />}
      </header>

      <TreemapBreadcrumb
        segments={breadcrumbSegments}
        onSegmentClick={handleSegmentClick}
        totalQuestions={showFab ? fabSummary.total : undefined}
        weakCount={showFab ? fabSummary.weak : undefined}
      />

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
