import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { loadQuestionsToCache } from '../services/dataLoader';
import { syncPendingAnswers } from '../services/sync';
import type { StudentProfile, Screen } from '../types';

// クイズモード: 'home'からの学年制限付き or 'nav'からの自由選択
type QuizMode = 'graded' | 'free';

interface AppState {
  profile: StudentProfile | null;
  screen: Screen;
  isOnline: boolean;
  pendingSyncCount: number;
  lastSync: string;
  quizMode: QuizMode;
  quizCategory: string; // カテゴリ指定クイズ用（空文字=指定なし）
  quizSubcategory: string; // サブカテゴリ指定（空文字=指定なし）
}

type AppAction =
  | { type: 'SET_PROFILE'; profile: StudentProfile }
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_ONLINE'; isOnline: boolean }
  | { type: 'SET_SYNC_COUNT'; count: number }
  | { type: 'SET_LAST_SYNC'; timestamp: string }
  | { type: 'SET_QUIZ_MODE'; mode: QuizMode }
  | { type: 'START_CATEGORY_QUIZ'; category: string; subcategory?: string };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_PROFILE':
      return { ...state, profile: action.profile };
    case 'SET_SCREEN':
      return { ...state, screen: action.screen };
    case 'SET_ONLINE':
      return { ...state, isOnline: action.isOnline };
    case 'SET_SYNC_COUNT':
      return { ...state, pendingSyncCount: action.count };
    case 'SET_LAST_SYNC':
      return { ...state, lastSync: action.timestamp };
    case 'SET_QUIZ_MODE':
      return { ...state, quizMode: action.mode };
    case 'START_CATEGORY_QUIZ':
      return { ...state, screen: 'quiz', quizMode: 'free', quizCategory: action.category, quizSubcategory: action.subcategory || '' };
  }
}

const initialState: AppState = {
  profile: null,
  screen: 'setup',
  isOnline: navigator.onLine,
  pendingSyncCount: 0,
  lastSync: '',
  quizMode: 'free',
  quizCategory: '',
  quizSubcategory: '',
};

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  triggerSync: () => Promise<void>;
}>({ state: initialState, dispatch: () => {}, triggerSync: async () => {} });

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // プロフィール読み込み
  const profile = useLiveQuery(() => db.profile.toCollection().first());

  useEffect(() => {
    if (profile) {
      dispatch({ type: 'SET_PROFILE', profile });
      dispatch({ type: 'SET_SCREEN', screen: 'home' });
    }
  }, [profile]);

  // 問題データを初期ロード（プロフィールの学科が確定してから実行）
  useEffect(() => {
    if (!profile?.department) return;
    loadQuestionsToCache(profile.department).then((count) => {
      if (count > 0) console.log(`問題データ: ${count}問ロード済み`);
    });
  }, [profile?.department]);

  // オンライン状態監視
  useEffect(() => {
    const handleOnline = () => dispatch({ type: 'SET_ONLINE', isOnline: true });
    const handleOffline = () => dispatch({ type: 'SET_ONLINE', isOnline: false });

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 未同期件数（synced === false のログをカウント）
  const pendingCount = useLiveQuery(
    async () => {
      const all = await db.answerLog.toArray();
      return all.filter(log => log.synced === false || log.synced === 0 as unknown as boolean).length;
    },
    [],
    0
  );

  useEffect(() => {
    dispatch({ type: 'SET_SYNC_COUNT', count: pendingCount });
  }, [pendingCount]);

  // バッチ同期関数
  const triggerSync = useCallback(async () => {
    if (!state.profile || !state.isOnline) return;
    try {
      const result = await syncPendingAnswers(
        state.profile.studentId,
        state.profile.department,
        state.profile.grade,
        state.profile.studentNumber,
        state.profile.studentType,
      );
      if (result.synced > 0) {
        console.log(`同期完了: ${result.synced}件送信`);
        dispatch({ type: 'SET_LAST_SYNC', timestamp: new Date().toISOString() });
      }
    } catch (err) {
      console.error('同期エラー:', err);
    }
  }, [state.profile, state.isOnline]);

  // アプリ起動時に自動同期
  useEffect(() => {
    if (state.profile && state.isOnline) {
      triggerSync();
    }
  }, [state.profile, state.isOnline, triggerSync]);

  return (
    <AppContext.Provider value={{ state, dispatch, triggerSync }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
