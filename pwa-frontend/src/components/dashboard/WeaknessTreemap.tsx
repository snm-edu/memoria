import { useEffect, useState, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchStudentTreemap, refreshStudentTreemap } from '../../services/treemapApi';
import { fetchMyRanking, type MyRankingPayload } from '../../services/rankingApi';
import { db } from '../../services/db';
import { Treemap } from './treemap/Treemap';
import { TreemapBreadcrumb } from './treemap/TreemapBreadcrumb';
import { TreemapLegend } from './treemap/TreemapLegend';
import { ClassRankingCard } from './treemap/ClassRankingCard';
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

const STALE_MS = 24 * 60 * 60 * 1000; // 24時間
const REFRESH_DEBOUNCE_MS = 60 * 1000; // 60秒

export function WeaknessTreemap() {
  const { state, dispatch } = useApp();
  const profile = state.profile;
  const [data, setData] = useState<TreemapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const lastRefreshAt = useRef<number>(0);

  const [focusPath, setFocusPath] = useState<FocusPath>([]);
  const [activeLeaf, setActiveLeaf] = useState<TreemapLeaf | null>(null);
  const [aggregateExpanded, setAggregateExpanded] = useState<Set<string>>(new Set());
  const [ranking, setRanking] = useState<MyRankingPayload | null>(null);

  // 同学年内ランキングをフェッチ (画面マウント時に1回、軽量集計なのでキャッシュなし)
  useEffect(() => {
    if (!profile?.studentId) return;
    let cancelled = false;
    fetchMyRanking(profile.studentId).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setRanking(res.data);
    });
    return () => { cancelled = true; };
  }, [profile?.studentId]);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // mount 時のフェッチ: stale-while-revalidate
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
        const now = Date.now();
        setData(res.data);
        setError('');
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

    setLoading(true);
    setError('');

    (async () => {
      const cached = await loadFromCache();
      const isStale = !cached || Date.now() - cached.fetchedAt > STALE_MS;
      if (!cached || isStale) {
        if (navigator.onLine) {
          await fetchFresh();
        } else if (!cached) {
          setError('オフラインです。一度オンラインで起動するとキャッシュされます。');
          setLoading(false);
        } else {
          setLoading(false);
        }
      }
    })();

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

  // ⟳ 即時更新ボタン (60秒デバウンス)
  const handleRefresh = useCallback(async () => {
    if (!profile || refreshing) return;
    if (Date.now() - lastRefreshAt.current < REFRESH_DEBOUNCE_MS) {
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
        const now = Date.now();
        setData(res.data);
        setError('');
        setCachedAt(now);
        setPendingSync(false);
        await db.treemapCache.put({
          studentId: profile.studentId,
          fetchedAt: now,
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

  function handleCellClick(_depth: number, datum: unknown) {
    const node = datum as { name: string; children?: unknown[] };
    if (!data) return;

    if (node.children) {
      for (const cat of data.tree.children) {
        if (cat.name === node.name) {
          setFocusPath([cat.name]);
          return;
        }
        for (const sub of cat.children) {
          if (sub.name === node.name) {
            setFocusPath([cat.name, sub.name]);
            return;
          }
        }
      }
      return;
    }

    if (focusPath.length === 2) {
      setActiveLeaf(datum as TreemapLeaf);
      return;
    }

    const leafName = node.name;
    for (const cat of data.tree.children) {
      for (const sub of cat.children) {
        for (const leaf of sub.children) {
          if (leaf.name === leafName) {
            setFocusPath([cat.name, sub.name]);
            return;
          }
        }
      }
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
      origin: 'weakness',
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
      origin: 'weakness',
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
  const showActionBar = !!data && !loading && !error;
  const legendUpdatedAt = cachedAt
    ? new Date(cachedAt).toISOString()
    : data?.updatedAt || '';

  // ヘッダーの「← 戻る」: ズーム階層がある時は1階層戻る、無い時はホームへ
  function handleBackButton() {
    if (focusPath.length > 0) {
      setFocusPath(focusPath.slice(0, -1));
      setActiveLeaf(null);
    } else {
      dispatch({ type: 'SET_SCREEN', screen: 'home' });
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col pb-20">
      <header className="flex items-center gap-2 px-4 py-3">
        <button
          onClick={handleBackButton}
          className="text-slate-400 flex-shrink-0"
        >
          ← 戻る
        </button>
        <h2 className="text-xl font-bold flex-1 min-w-0 truncate">分野別学習マップ</h2>
        {data && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="最新データに更新"
            className={`w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0 transition-colors ${
              refreshing
                ? 'bg-slate-100 text-slate-400 animate-spin'
                : 'bg-slate-100 text-slate-600 active:bg-slate-200'
            }`}
          >
            ⟳
          </button>
        )}
        {showActionBar && (
          <ChallengeFab focusPath={focusPath} onChallenge={handleFabChallenge} />
        )}
      </header>

      {!state.isOnline && (
        <div className="bg-slate-100 text-slate-500 text-xs px-4 py-1 text-center">
          📡 オフラインです (キャッシュ表示中)
        </div>
      )}

      <TreemapBreadcrumb
        segments={breadcrumbSegments}
        onSegmentClick={handleSegmentClick}
        totalQuestions={showActionBar ? fabSummary.total : undefined}
        weakCount={showActionBar ? fabSummary.weak : undefined}
      />

      {ranking?.available && <ClassRankingCard ranking={ranking} />}

      {data && <TreemapLegend updatedAt={legendUpdatedAt} />}

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

      {pendingSync && (
        <div className="fixed bottom-16 left-0 right-0 px-4 z-10 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-3 py-2 text-center">
            🔄 ローカル表示中。⟳ で最新化できます
          </div>
        </div>
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
