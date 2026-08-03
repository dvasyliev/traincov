import { useState } from 'react';
import { Home } from '../screens/Home';
import { Trip } from '../screens/Trip';
import { Log } from '../screens/Log';
import { TabBar } from './TabBar';
import type { Screen } from './screens';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');

  return (
    <div className="app">
      <main className="app__body">
        {screen === 'home' && <Home onOpenTrip={() => setScreen('trip')} />}
        {screen === 'trip' && <Trip />}
        {screen === 'log' && <Log />}
      </main>
      <TabBar active={screen} onChange={setScreen} />
    </div>
  );
}
