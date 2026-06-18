import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { fetchVideoRecommendations, markVideoRecommendation } from '../../services/api';
import { db } from '../../services/db';
import type { StudentProfile, VideoRecommendation, VideoRecommendationEventType, VideoRecommendationStatus } from '../../types';

interface RecommendedVideosCardProps {
  profile: StudentProfile;
  isOnline: boolean;
}

const ACTIVE_STATUSES: VideoRecommendationStatus[] = ['approved', 'shown'];

export function RecommendedVideosCard({ profile, isOnline }: RecommendedVideosCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const recommendations = useLiveQuery(async () => {
    const rows = await db.videoRecommendations
      .where('studentId')
      .equals(profile.studentId)
      .toArray();

    return rows
      .filter((row) => ACTIVE_STATUSES.includes(row.status))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [profile.studentId], []);

  useEffect(() => {
    let cancelled = false;

    async function loadRecommendations() {
      if (!isOnline) return;
      setLoading(true);
      setError('');

      const res = await fetchVideoRecommendations({
        studentId: profile.studentId,
        studentNumber: profile.studentNumber,
        limit: 3,
      });

      if (cancelled) return;
      setLoading(false);

      if (!res.success) {
        setError(res.error || '動画推薦を取得できませんでした');
        return;
      }

      const now = new Date().toISOString();
      const rows = (res.data?.recommendations || []).map((recommendation) => ({
        ...recommendation,
        studentId: profile.studentId,
        studentNumber: profile.studentNumber,
        updatedAt: recommendation.updatedAt || now,
      }));

      if (rows.length > 0) {
        await db.videoRecommendations.bulkPut(rows);
      }
    }

    loadRecommendations();

    return () => {
      cancelled = true;
    };
  }, [profile.studentId, profile.studentNumber, isOnline]);

  const items = useMemo(() => recommendations || [], [recommendations]);

  async function recordAction(
    recommendation: VideoRecommendation,
    eventType: VideoRecommendationEventType,
    feedback = ''
  ) {
    if (isOnline) {
      await markVideoRecommendation({
        recommendationId: recommendation.recommendationId,
        studentId: profile.studentId,
        studentNumber: profile.studentNumber,
        eventType,
        feedback,
      });
    }

    const statusByEvent: Record<VideoRecommendationEventType, VideoRecommendationStatus> = {
      opened: 'shown',
      viewed: 'completed',
      later: 'shown',
      wrong_content: 'needs_review',
    };

    await db.videoRecommendations.update(recommendation.recommendationId, {
      status: statusByEvent[eventType],
      updatedAt: new Date().toISOString(),
    });
  }

  async function openVideo(recommendation: VideoRecommendation) {
    if (recommendation.videoUrl) {
      window.open(recommendation.videoUrl, '_blank', 'noopener,noreferrer');
    }
    await recordAction(recommendation, 'opened');
  }

  if (items.length === 0 && !loading && !error) {
    return null;
  }

  return (
    <section className="card mb-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl">🎥</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-slate-700">今日の復習動画</h2>
          <p className="text-xs text-slate-400">最近の解答状況に合わせた授業ポイント</p>
        </div>
      </div>

      {loading && items.length === 0 && (
        <p className="text-sm text-slate-400">推薦を確認しています...</p>
      )}

      {error && items.length === 0 && (
        <p className="text-sm text-amber-600">{error}</p>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <article key={item.recommendationId} className="rounded-xl border border-slate-100 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700 line-clamp-2">{item.title}</p>
                {(item.category || item.subcategory || item.displayTime) && (
                  <p className="mt-1 text-xs text-slate-400 truncate">
                    {[item.category, item.subcategory, item.displayTime].filter(Boolean).join(' / ')}
                  </p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-600">
                {Math.round(item.score)}
              </span>
            </div>

            {item.reason && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{item.reason}</p>
            )}
            {item.summary && (
              <p className="mt-1 text-xs leading-relaxed text-slate-400 line-clamp-2">{item.summary}</p>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => openVideo(item)}
                disabled={!item.videoUrl}
                className="rounded-lg bg-primary-500 px-2 py-2 text-xs font-bold text-white disabled:bg-slate-200"
              >
                見る
              </button>
              <button
                type="button"
                onClick={() => recordAction(item, 'viewed')}
                className="rounded-lg bg-emerald-50 px-2 py-2 text-xs font-bold text-emerald-600"
              >
                完了
              </button>
              <button
                type="button"
                onClick={() => recordAction(item, 'wrong_content', '受講者が内容違いとして報告')}
                className="rounded-lg bg-slate-50 px-2 py-2 text-xs font-bold text-slate-500"
              >
                違う
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
