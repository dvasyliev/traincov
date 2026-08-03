import { useState } from 'react';
import { Home } from '../screens/Home';
import { Trip } from '../screens/Trip';
import { Log } from '../screens/Log';
import { TabBar } from './TabBar';
import type { Screen } from './screens';
import { useRouteBundle } from '../data/route-bundle';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  // Один бандл на весь застосунок: Home і Trip дивляться на той самий стан.
  const route = useRouteBundle();

  return (
    <div className="app">
      <main className="app__body">
        {screen === 'home' && <Home route={route} onOpenTrip={() => setScreen('trip')} />}
        {screen === 'trip' && <Trip route={route} />}
        {screen === 'log' && <Log />}
      </main>
      <TabBar active={screen} onChange={setScreen} />
    </div>
  );
}
