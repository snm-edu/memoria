import { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { db } from '../../services/db';
import {
  saveToken, resolveStudent, hydrateCardStates,
} from '../../services/restart/restartSync';
import { loadQuestionsToCache } from '../../services/dataLoader';
import type { StudentProfile, Department } from '../../types';

interface Props {
  token: string;
  /** 完了/中断時に通常画面へ戻す */
  onDone: () => void;
}

type GateStatus = 'loading' | 'error' | 'mismatch' | 'nodata';

/** 時間帯からセッション種別を決める（端末ローカル時刻＝JST想定） */
export function sessionScopeForHour(hour: number): 'all' | 'weak' {
  if (hour >= 11 && hour < 17) return 'weak'; // 昼: 弱点補強
  return 'all'; // 朝・夜: SM-2期限の復習優先（既存クイズの標準動作）
}

/**
 * 端末に残った別利用者のローカルデータを消去する（本人切り替え用）。
 * questionCache は学科共通の問題データなので残す（再ダウンロード回避）。
 */
async function wipeLocalUserData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.profile, db.cardStates, db.answerLog, db.gamification, db.aiCache, db.treemapCache],
    async () => {
      await db.profile.clear();
      await db.cardStates.clear();
      await db.answerLog.clear();
      await db.gamification.clear();
      await db.aiCache.clear();
      await db.treemapCache.clear();
    },
  );
}

export function TodayGate({ token, onDone }: Props) {
  const { dispatch } = useApp();
  const [status, setStatus] = useState<GateStatus>('loading');
  const [studentName, setStudentName] = useState('');
  const [errorDetail, setErrorDetail] = useState('');
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setErrorDetail('');
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  /** 「本人として開き直す」: 端末の旧データを消して、トークンの本人でやり直す */
  const switchToTokenStudent = useCallback(async () => {
    setStatus('loading');
    await wipeLocalUserData();
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const student = await resolveStudent(token);
        if (cancelled) return;
        if (!student) {
          // 診断用: トークン不一致（長さ・末尾）か設定漏れかを画面で判別できるようにする
          setErrorDetail(
            `code: TOKEN_NOT_FOUND / 受信トークン: ${token.length}文字 (末尾 …${token.slice(-4)})`
          );
          setStatus('error');
          return;
        }
        setStudentName(student.student_name);

        // 既存プロフィール確認（別人の端末での誤上書きを防ぐ）
        const existing = await db.profile.toCollection().first();
        if (existing && existing.studentNumber &&
            existing.studentNumber !== student.student_number) {
          setStatus('mismatch');
          return;
        }

        if (!existing) {
          // プロフィール自動作成（Teams内蔵ブラウザ等の空ストレージ対策の核心）
          const profile: StudentProfile = {
            studentId: crypto.randomUUID(),
            studentNumber: student.student_number,
            department: student.department as Department,
            grade: student.grade,
            studentType: 'graduate',
            createdAt: new Date().toISOString(),
          };
          await db.profile.add(profile);
          dispatch({ type: 'SET_PROFILE', profile });
        }

        saveToken(token);

        // 新規ブラウザ（Teams内蔵等）では問題キャッシュが空のため、ロード完了を待ってからクイズを開始する。
        // 初回アクセスは1.4MBの問題データ取得があり、モバイル回線では失敗しうるため1回だけ自動リトライする。
        let questionCount = await loadQuestionsToCache(student.department as Department);
        if (questionCount === 0 && !cancelled) {
          questionCount = await loadQuestionsToCache(student.department as Department);
        }
        if (cancelled) return;
        if (questionCount === 0) {
          setStatus('nodata');
          return;
        }

        await hydrateCardStates(token);
        if (cancelled) return;

        // 時間帯セッションでクイズ開始
        dispatch({
          type: 'START_CATEGORY_QUIZ',
          category: '',
          scope: sessionScopeForHour(new Date().getHours()),
          origin: 'home',
        });
        onDone();
      } catch (err) {
        console.error('[TodayGate]', err);
        if (!cancelled) {
          setErrorDetail(`code: FETCH_ERROR / ${err instanceof Error ? err.message : String(err)}`);
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, dispatch, onDone, attempt]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent" />
        <p className="text-slate-600 font-medium">
          {studentName ? `${studentName}さんの学習データを準備中…` : '今日の問題を準備中…'}
        </p>
      </div>
    );
  }

  if (status === 'mismatch') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-2xl">⚠️</p>
        <p className="font-bold text-slate-800">このリンクは {studentName} さん専用です</p>
        <p className="text-sm text-slate-600">
          この端末には別の利用者の学習データが残っています。
          あなたが {studentName} さん本人なら、下のボタンで切り替えてください
          （学習記録はクラウドに保存されているので消えません）。
        </p>
        <button
          onClick={switchToTokenStudent}
          className="mt-2 px-6 py-3 rounded-lg bg-blue-600 text-white font-bold"
        >
          {studentName} さんとして開き直す
        </button>
        <button onClick={onDone} className="px-6 py-2 rounded-lg bg-slate-200 text-slate-700 font-medium">
          そのまま通常画面へ
        </button>
      </div>
    );
  }

  if (status === 'nodata') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-2xl">📡</p>
        <p className="font-bold text-slate-800">問題データを取得できませんでした</p>
        <p className="text-sm text-slate-600">
          電波の良い場所で、もう一度お試しください。初回は少しダウンロードに時間がかかります。
        </p>
        <button
          onClick={retry}
          className="mt-2 px-6 py-3 rounded-lg bg-blue-600 text-white font-bold"
        >
          もう一度試す
        </button>
        <button onClick={onDone} className="px-6 py-2 rounded-lg bg-slate-200 text-slate-700 font-medium">
          通常画面へ
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-2xl">🔗</p>
      <p className="font-bold text-slate-800">リンクを確認できませんでした</p>
      <p className="text-sm text-slate-600">
        通信状態を確認してもう一度開くか、リンクが古い可能性があるため担任の先生に連絡してください。
      </p>
      {errorDetail && (
        <p className="text-xs text-slate-400 break-all max-w-xs">{errorDetail}</p>
      )}
      <button
        onClick={retry}
        className="mt-2 px-6 py-3 rounded-lg bg-blue-600 text-white font-bold"
      >
        もう一度試す
      </button>
      <button onClick={onDone} className="px-6 py-2 rounded-lg bg-slate-200 text-slate-700 font-medium">
        通常画面へ
      </button>
    </div>
  );
}
