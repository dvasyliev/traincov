import { useState } from 'react';
import { Map } from '../components/Map';
import { RouteRibbon } from '../components/RouteRibbon';
import { TripStatusBar } from '../components/TripStatusBar';
import { useAppActions, useAppState } from '../app/app-state';
import { useTripTracker } from '../app/useTrip';
import { formatKm, formatTime } from '../core/format';
import { operatorLabel } from '../core/operators';
import type { OperatorId } from '../core/operators';
import type { RouteBundle } from '../core/types';

type View = 'ribbon' | 'map';

export function Trip() {
  const { currentTrip, operator } = useAppState();

  // Редірект робить App; сюди потрапляємо лише на кадр між dispatch і ререндером.
  if (!currentTrip) return null;

  // key: інший рейс — інший трекер, інша стрічка, все з нуля.
  return <TripView key={currentTrip.tripId} bundle={currentTrip} operator={operator} />;
}

function TripView({ bundle, operator }: { bundle: RouteBundle; operator: OperatorId | null }) {
  const { setScreen } = useAppActions();
  const tracker = useTripTracker(bundle);
  const [view, setView] = useState<View>('ribbon');

  const last = bundle.stops[bundle.stops.length - 1];

  return (
    <div className="screen screen--full">
      <header className="trip-header">
        <span className="trip-header__badge">{bundle.carrier}</span>
        <span className="trip-header__title">{bundle.name}</span>
        <button type="button" className="trip-header__change" onClick={() => setScreen('home')}>
          {operator ? operatorLabel(operator) : 'оператор'} · змінити
        </button>
      </header>
      <div className="trip-subheader">
        {formatTime(bundle.stops[0]?.dep ?? null)} → {formatTime(last?.arr ?? null)} ·{' '}
        {formatKm(bundle.lengthKm)} · {bundle.stops.length} зупинок
      </div>

      <TripStatusBar tracker={tracker} />

      <div className="view-switch">
        <button
          type="button"
          className={`view-switch__item ${view === 'ribbon' ? 'view-switch__item--active' : ''}`}
          onClick={() => setView('ribbon')}
        >
          Стрічка
        </button>
        <button
          type="button"
          className={`view-switch__item ${view === 'map' ? 'view-switch__item--active' : ''}`}
          onClick={() => setView('map')}
        >
          Карта
        </button>
      </div>

      {view === 'ribbon' ? (
        <RouteRibbon tracker={tracker} />
      ) : (
        <Map route={bundle.shape} stops={bundle.stops} tracker={tracker} />
      )}
    </div>
  );
}
