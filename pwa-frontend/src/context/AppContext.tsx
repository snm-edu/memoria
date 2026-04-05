import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { loadQuestionsToCache } from '../services/dataLoader';
import type { StudentProfile, Screen } from '../types';

interface AppState {
  profile: StudentProfile | null;
  screen: Screen;
  isOnline: boolean;
  pendingSyncCount: number;
}

type AppAction =
  | { type: 'SET_PROFILE'; profile: StudentProfile }
  | { type: 'SET_SCREEN'; screen: Screen }
  | { type: 'SET_ONLINE'; isOnline: boolean }
  | { type: 'SET_SYNC_COUNT'; count: number };

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
  }
}

const initialState: AppState = {
  profile: null,
  screen: 'setup',
  isOnline: navigator.onLine,
  pendingSyncCount: 0,
};

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}>({ state: initialState, dispatch: () => {} });

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

  // 問題データを初期ロード
  useEffect(() => {
    loadQuestionsToCache().then((count) => {
      if (count > 0) console.log(`問題データ: ${count}問ロード済み`);
    });
  }, []);

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

  // 未同期件数
  const pendingCount = useLiveQuery(
    () => db.answerLog.where('synced').equals(0).count(),
    [],
    0
  );

  useEffect(() => {
    dispatch({ type: 'SET_SYNC_COUNT', count: pendingCount });
  }, [pendingCount]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
