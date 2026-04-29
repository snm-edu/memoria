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
