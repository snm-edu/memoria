import { useState, useCallback } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { SetupScreen } from './components/setup/SetupScreen';
import { HomeScreen } from './components/dashboard/HomeScreen';
import { QuizScreen } from './components/quiz/QuizScreen';
import { WeaknessTreemap } from './components/dashboard/WeaknessTreemap';
import { ReviewSchedule } from './components/dashboard/ReviewSchedule';
import { SettingsScreen } from './components/settings/SettingsScreen';
import { BadgesScreen } from './components/dashboard/BadgesScreen';
import { AiDashboard } from './components/dashboard/AiDashboard';
import { PreEnrollmentGamesMenu } from './components/prospective/PreEnrollmentGamesMenu';
import { TodayGate } from './components/today/TodayGate';

/** 起動時に一度だけ ?t= を読み取り、URLから除去する（アドレスバー・履歴にトークンを残さない） */
function consumeTokenFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  if (token) {
    params.delete('t');
    const query = params.toString();
    const newUrl = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  }
  return token;
}

const initialToken = consumeTokenFromUrl();

function AppContent() {
  const { state } = useApp();
  const [gateToken, setGateToken] = useState<string | null>(initialToken);
  const closeGate = useCallback(() => setGateToken(null), []);

  if (gateToken) {
    return <TodayGate token={gateToken} onDone={closeGate} />;
  }

  switch (state.screen) {
    case 'setup':
      return <SetupScreen />;
    case 'home':
      return state.profile?.studentType === 'prospective'
        ? <PreEnrollmentGamesMenu />
        : <HomeScreen />;
    case 'prospective':
      return <PreEnrollmentGamesMenu />;
    case 'quiz':
      return <QuizScreen />;
    case 'weakness':
      return <WeaknessTreemap />;
    case 'schedule':
      return <ReviewSchedule />;
    case 'settings':
      return <SettingsScreen />;
    case 'badges':
      return <BadgesScreen />;
    case 'ai_dashboard':
      return <AiDashboard />;
    default:
      return <HomeScreen />;
  }
}

export default function App() {
  return (
    <AppProvider>
      <div className="max-w-lg mx-auto">
        <AppContent />
      </div>
    </AppProvider>
  );
}
