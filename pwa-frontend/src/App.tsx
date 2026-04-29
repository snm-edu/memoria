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

function AppContent() {
  const { state } = useApp();

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
