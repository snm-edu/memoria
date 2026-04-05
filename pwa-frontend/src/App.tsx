import { AppProvider, useApp } from './context/AppContext';
import { SetupScreen } from './components/setup/SetupScreen';
import { HomeScreen } from './components/dashboard/HomeScreen';
import { QuizScreen } from './components/quiz/QuizScreen';
import { WeaknessMap } from './components/dashboard/WeaknessMap';
import { ReviewSchedule } from './components/dashboard/ReviewSchedule';
import { SettingsScreen } from './components/settings/SettingsScreen';

function AppContent() {
  const { state } = useApp();

  switch (state.screen) {
    case 'setup':
      return <SetupScreen />;
    case 'home':
      return <HomeScreen />;
    case 'quiz':
      return <QuizScreen />;
    case 'weakness':
      return <WeaknessMap />;
    case 'schedule':
      return <ReviewSchedule />;
    case 'settings':
      return <SettingsScreen />;
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
