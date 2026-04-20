import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { useApp } from '../../context/AppContext';
import { DEPARTMENT_LABELS, GRADES } from '../../types';
import { updateStudentNumber } from '../../services/api';

export function SettingsScreen() {
  const { state, dispatch, triggerSync } = useApp();
  const { profile } = state;

  const [studentNumber, setStudentNumber] = useState(profile?.studentNumber || '');
  const [grade, setGrade] = useState(profile?.grade || 1);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!profile) return null;

  const hasChanges =
    studentNumber.trim() !== profile.studentNumber ||
    grade !== profile.grade;

  async function handleSave() {
    if (!profile || !studentNumber.trim()) return;
    setIsSaving(true);
    setMessage(null);

    try {
      const oldStudentNumber = profile.studentNumber;
      const newStudentNumber = studentNumber.trim();

      // まず未同期の回答を送信
      await triggerSync();

      // 学籍番号が変わった場合、スプレッドシート上のログも更新
      if (oldStudentNumber && oldStudentNumber !== newStudentNumber) {
        const res = await updateStudentNumber({
          oldStudentNumber,
          newStudentNumber,
          studentId: profile.studentId,
        });
        if (!res.success) {
          console.warn('スプレッドシート側の更新に失敗:', res.error);
        }
      }

      // ローカルDB更新
      await db.profile.update(profile.id!, {
        studentNumber: newStudentNumber,
        grade,
      });

      // AppContext更新
      dispatch({
        type: 'SET_PROFILE',
        profile: { ...profile, studentNumber: newStudentNumber, grade },
      });

      setMessage({ type: 'success', text: '保存しました' });
    } catch (err) {
      console.error('プロフィール更新エラー:', err);
      setMessage({ type: 'error', text: '保存に失敗しました' });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-[100dvh] p-4 pb-20">
      <header className="flex items-center mb-6">
        <button
          onClick={() => dispatch({ type: 'SET_SCREEN', screen: 'home' })}
          className="text-slate-400 mr-3"
        >
          ← 戻る
        </button>
        <h1 className="text-xl font-bold">設定</h1>
      </header>

      <div className="space-y-6">
        {/* 学籍番号 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <label className="block text-sm font-bold text-slate-500 mb-2">
            学籍番号
          </label>
          <input
            type="text"
            value={studentNumber}
            onChange={(e) => setStudentNumber(e.target.value)}
            className="w-full p-3 rounded-xl border-2 border-slate-200 text-lg font-bold
              focus:border-primary-400 focus:outline-none transition-all"
          />
          <p className="text-xs text-slate-400 mt-2">
            変更するとスプレッドシート上の過去の記録も自動で更新されます
          </p>
        </div>

        {/* 学科 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <label className="block text-sm font-bold text-slate-500 mb-2">
            学科
          </label>
          <p className="text-lg font-bold text-slate-700">
            {DEPARTMENT_LABELS[profile.department]}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            学科の変更はデータリセットが必要です。教員に相談してください。
          </p>
        </div>

        {/* 学年 */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
          <label className="block text-sm font-bold text-slate-500 mb-3">
            学年
          </label>
          <div className="grid grid-cols-3 gap-3">
            {GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setGrade(g)}
                className={`p-3 rounded-xl text-center font-bold text-lg transition-all
                  ${grade === g
                    ? 'bg-primary-500 text-white shadow-lg'
                    : 'bg-slate-100 border-2 border-slate-200'
                  }`}
              >
                {g}年
              </button>
            ))}
          </div>
        </div>

        {/* 保存ボタン */}
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={isSaving || !studentNumber.trim()}
            className={`w-full p-4 rounded-xl font-bold text-lg transition-all
              ${isSaving
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-primary-500 text-white shadow-lg active:bg-primary-600'
              }`}
          >
            {isSaving ? '保存中...' : '変更を保存'}
          </button>
        )}

        {/* メッセージ */}
        {message && (
          <div className={`p-3 rounded-xl text-center text-sm font-bold
            ${message.type === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
            }`}>
            {message.text}
          </div>
        )}

        {/* デバッグ情報（開発環境のみ） */}
        {import.meta.env.DEV && <DebugInfo profile={profile} state={state} />}
      </div>
    </div>
  );
}

/** DB内容を表示するデバッグコンポーネント */
function DebugInfo({ profile, state }: { profile: NonNullable<ReturnType<typeof useApp>['state']['profile']>; state: ReturnType<typeof useApp>['state'] }) {
  const answerLogCount = useLiveQuery(() => db.answerLog.count(), [], 0);
  const cardStatesCount = useLiveQuery(() => db.cardStates.count(), [], 0);
  const questionCacheCount = useLiveQuery(() => db.questionCache.count(), [], 0);

  const recentLogs = useLiveQuery(async () => {
    return db.answerLog.orderBy('timestamp').reverse().limit(5).toArray();
  }, [], []);

  const recentCards = useLiveQuery(async () => {
    return db.cardStates.limit(5).toArray();
  }, [], []);

  return (
    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
      <p className="text-xs font-bold text-slate-500">デバッグ情報</p>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-slate-400">回答ログ</p>
          <p className="text-sm font-bold">{answerLogCount}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">カード状態</p>
          <p className="text-sm font-bold">{cardStatesCount}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">問題キャッシュ</p>
          <p className="text-sm font-bold">{questionCacheCount}</p>
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-1">端末ID</p>
        <p className="text-xs text-slate-500 font-mono break-all">{profile.studentId}</p>
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-1">未同期: {state.pendingSyncCount}件</p>
        {state.lastSync && (
          <p className="text-xs text-slate-500">
            最終同期: {new Date(state.lastSync).toLocaleString('ja-JP')}
          </p>
        )}
      </div>

      {recentLogs.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-1">直近の回答ログ</p>
          {recentLogs.map((log, i) => (
            <p key={i} className="text-xs text-slate-500 font-mono">
              {log.questionId.slice(-10)} {log.isCorrect ? '⭕' : '❌'} {new Date(log.timestamp).toLocaleTimeString('ja-JP')}
            </p>
          ))}
        </div>
      )}

      {recentCards.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-1">カード状態（上位5件）</p>
          {recentCards.map((card, i) => (
            <p key={i} className="text-xs text-slate-500 font-mono">
              {card.questionId.slice(-10)} next:{card.nextReview} rep:{card.repetitions} hl:{card.hintLevel}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
