import { useEffect } from 'react';
import { Home } from '../screens/Home';
import { Trip } from '../screens/Trip';
import { Log } from '../screens/Log';
import { TabBar } from './TabBar';
import { Toast } from '../components/Toast';
import { AppStateProvider } from './AppStateProvider';
import { useAppActions, useAppState } from './app-state';

function Shell() {
  const { screen, currentTrip, toast } = useAppState();
  const { setScreen, dismissToast } = useAppActions();

  // Trip без обраного рейсу показувати нічого — повертаємо на Home.
  useEffect(() => {
    if (screen === 'trip' && !currentTrip) setScreen('home');
  }, [screen, currentTrip, setScreen]);

  return (
    <div className="app">
      <main className="app__body">
        {screen === 'home' && <Home />}
        {screen === 'trip' && <Trip />}
        {screen === 'log' && <Log />}
      </main>
      {toast && <Toast message={toast} onDismiss={dismissToast} />}
      <TabBar active={screen} onChange={setScreen} disabled={currentTrip ? [] : ['trip']} />
    </div>
  );
}

export function App() {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
