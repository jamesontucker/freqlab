import { useSettingsStore } from './stores/settingsStore';
import { WelcomeWizard } from './components/Setup/WelcomeWizard';
import { MainLayout } from './components/Layout/MainLayout';

function App() {
  const setupComplete = useSettingsStore((state) => state.setupComplete);

  if (!setupComplete) {
    return <WelcomeWizard />;
  }

  return (
    <MainLayout>
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="text-6xl">🎛️</div>
          <h2 className="text-2xl font-semibold text-text-primary">No plugins yet</h2>
          <p className="text-text-secondary">
            Click "New Plugin" to create your first VST plugin
          </p>
        </div>
      </div>
    </MainLayout>
  );
}

export default App;
