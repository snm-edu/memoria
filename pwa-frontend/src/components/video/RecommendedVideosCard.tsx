import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { fetchVideoRecommendations, markVideoRecommendation } from '../../services/api';
import { db } from '../../services/db';
import type { StudentProfile, VideoRecommendation, VideoRecommendationEventType, VideoRecommendationStatus } from '../../types';

interface RecommendedVideosCardProps {
  profile: StudentProfile;
  isOnline: boolean;
  onOpenAiDashboard: () => void;
}

const ACTIVE_STATUSES: VideoRecommendationStatus[] = ['approved', 'shown'];

/** Google Drive の共有URL(/view 等)を、iframe 埋め込み再生用の /preview に変換する。Drive 以外は null。 */
function toDrivePreviewUrl(url: string): string | null {
  const match = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : null;
}

/** Drive 直ストリーミング用APIキー。リファラ制限付きの公開制限キーで、未設定なら /preview 埋め込みへフォールバック。 */
const DRIVE_API_KEY = import.meta.env.VITE_DRIVE_API_KEY;

function driveFileIdFromUrl(url: string): string | null {
  const match = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/** display_time（"54:08-1:02:22" 形式）を開始・終了秒に変換する。解釈できなければ null。 */
function parseDisplayTime(displayTime: string): { startSec: number; endSec: number } | null {
  const parts = String(displayTime || '').split('-');
  if (parts.length !== 2) return null;
  const toSec = (clock: string): number | null => {
    const nums = clock.trim().split(':').map(Number);
    if (nums.length === 0 || nums.length > 3 || nums.some(Number.isNaN)) return null;
    return nums.reduce((acc, n) => acc * 60 + n, 0);
  };
  const startSec = toSec(parts[0] ?? '');
  const endSec = toSec(parts[1] ?? '');
  if (startSec === null || endSec === null || endSec <= startSec) return null;
  return { startSec, endSec };
}

/**
 * 授業動画プレーヤー。APIキーがあれば Drive API 直ストリーミング（<video>）で
 * チャプター開始位置へ自動頭出しし、終了位置で自動停止する。
 * キー未設定・再生失敗時は従来の Drive /preview 埋め込みへフォールバックする。
 */
function DriveVideoPlayer({ recommendation }: { recommendation: VideoRecommendation }) {
  const [directPlayFailed, setDirectPlayFailed] = useState(false);
  const autoStoppedRef = useRef(false);

  const fileId = driveFileIdFromUrl(recommendation.videoUrl);
  const range = parseDisplayTime(recommendation.displayTime);
  const canDirectPlay = Boolean(DRIVE_API_KEY && fileId) && !directPlayFailed;

  if (!canDirectPlay) {
    return (
      <>
        {recommendation.displayTime && (
          <p className="mb-2 text-xs font-bold text-amber-600">
            ▶ {recommendation.displayTime} 付近を再生してください
          </p>
        )}
        <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
          <iframe
            src={toDrivePreviewUrl(recommendation.videoUrl) || ''}
            title={recommendation.title}
            className="h-full w-full"
            allow="autoplay; fullscreen"
            allowFullScreen
          />
        </div>
      </>
    );
  }

  return (
    <>
      {range && (
        <p className="mb-2 text-xs font-bold text-emerald-600">
          ▶ {recommendation.displayTime} を自動頭出しで再生します（終了位置で自動停止）
        </p>
      )}
      <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="h-full w-full"
          src={`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`}
          onLoadedMetadata={(event) => {
            if (range) {
              event.currentTarget.currentTime = range.startSec;
            }
          }}
          onTimeUpdate={(event) => {
            if (!range || autoStoppedRef.current) return;
            if (event.currentTarget.currentTime >= range.endSec) {
              autoStoppedRef.current = true;
              event.currentTarget.pause();
            }
          }}
          onError={() => setDirectPlayFailed(true)}
        />
      </div>
    </>
  );
}

export function RecommendedVideosCard({ profile, isOnline, onOpenAiDashboard }: RecommendedVideosCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [activeVideo, setActiveVideo] = useState<VideoRecommendation | null>(null);

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

      await db.videoRecommendations
        .where('studentId')
        .equals(profile.studentId)
        .filter((row) => ACTIVE_STATUSES.includes(row.status))
        .delete();

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
      // Drive 動画はアプリ内モーダルで埋め込み再生。それ以外は従来どおり別タブで開く。
      if (toDrivePreviewUrl(recommendation.videoUrl)) {
        setActiveVideo(recommendation);
      } else {
        window.open(recommendation.videoUrl, '_blank', 'noopener,noreferrer');
      }
    }
    await recordAction(recommendation, 'opened');
  }

  const primary = items[0];
  const additionalItems = expanded ? items.slice(1) : [];

  return (
    <section className="card mb-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🤖</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-slate-700">今日のAI復習ナビ</h2>
          <p className="text-xs text-slate-400">
            {primary ? 'いま見る復習ポイントを1つに絞りました' : '苦手分野と学習状況を確認できます'}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAiDashboard}
          className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 active:bg-slate-100"
        >
          AI分析
        </button>
      </div>

      {loading && items.length === 0 && (
        <p className="mt-3 text-sm text-slate-400">推薦を確認しています...</p>
      )}

      {error && items.length === 0 && (
        <p className="mt-3 text-sm text-amber-600">{error}</p>
      )}

      {primary ? (
        <div className="mt-3 space-y-3">
          <article className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-xl">
                🎥
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-slate-800 line-clamp-2">{primary.title}</p>
                  <span className="shrink-0 rounded-full bg-white px-2 py-1 text-xs font-bold text-blue-600">
                    {Math.round(primary.score)}
                  </span>
                </div>
                {(primary.category || primary.subcategory || primary.displayTime) && (
                  <p className="mt-1 text-xs text-slate-500 truncate">
                    {[primary.category, primary.subcategory, primary.displayTime].filter(Boolean).join(' / ')}
                  </p>
                )}
              </div>
            </div>

            {primary.reason && (
              <p className="mt-3 text-xs leading-relaxed text-slate-600">{primary.reason}</p>
            )}
            {primary.summary && (
              <p className="mt-1 text-xs leading-relaxed text-slate-500 line-clamp-2">{primary.summary}</p>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => openVideo(primary)}
                disabled={!primary.videoUrl}
                className="rounded-lg bg-primary-500 px-2 py-2 text-xs font-bold text-white disabled:bg-slate-200"
              >
                3分だけ見る
              </button>
              <button
                type="button"
                onClick={() => recordAction(primary, 'viewed')}
                className="rounded-lg bg-emerald-50 px-2 py-2 text-xs font-bold text-emerald-600"
              >
                完了
              </button>
              <button
                type="button"
                onClick={() => recordAction(primary, 'wrong_content', '受講者が内容違いとして報告')}
                className="rounded-lg bg-slate-50 px-2 py-2 text-xs font-bold text-slate-500"
              >
                違う
              </button>
            </div>
          </article>

          {items.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-full rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 active:bg-slate-100"
            >
              {expanded ? 'おすすめを閉じる' : `ほかのおすすめ ${items.length - 1}件`}
            </button>
          )}

          {additionalItems.map((item) => (
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
      ) : (
        !loading && (
          <button
            type="button"
            onClick={onOpenAiDashboard}
            className="mt-3 w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-left active:bg-slate-100"
          >
            <p className="text-sm font-bold text-slate-700">苦手分野を確認する</p>
            <p className="mt-1 text-xs text-slate-400">AI分析で、次に重点復習する分野を見直します</p>
          </button>
        )
      )}

      {activeVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setActiveVideo(null)}
        >
          <div
            className="w-full max-w-2xl rounded-xl bg-white p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-bold text-slate-700">{activeVideo.title}</p>
              <button
                type="button"
                onClick={() => setActiveVideo(null)}
                className="shrink-0 rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500 active:bg-slate-200"
              >
                閉じる
              </button>
            </div>
            <DriveVideoPlayer key={activeVideo.recommendationId} recommendation={activeVideo} />
            <a
              href={activeVideo.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 block text-center text-xs text-slate-400 underline"
            >
              再生できない場合はこちら（Driveで開く）
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
