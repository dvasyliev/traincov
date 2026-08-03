import { Map } from '../components/Map';
import { useAppActions, useAppState } from '../app/app-state';
import { formatKm, formatTime } from '../core/format';
import { operatorLabel } from '../core/operators';

export function Trip() {
  const { currentTrip, operator } = useAppState();
  const { setScreen } = useAppActions();

  // Редірект робить App; сюди потрапляємо лише на кадр між dispatch і ререндером.
  if (!currentTrip) return null;

  const last = currentTrip.stops[currentTrip.stops.length - 1];

  return (
    <div className="screen screen--full">
      <header className="trip-header">
        <span className="trip-header__badge">{currentTrip.carrier}</span>
        <span className="trip-header__title">{currentTrip.name}</span>
        <button type="button" className="trip-header__change" onClick={() => setScreen('home')}>
          {operator ? operatorLabel(operator) : 'оператор'} · змінити
        </button>
      </header>
      <div className="trip-subheader">
        {formatTime(currentTrip.stops[0]?.dep ?? null)} → {formatTime(last?.arr ?? null)} ·{' '}
        {formatKm(currentTrip.lengthKm)} · {currentTrip.stops.length} зупинок
      </div>
      <Map route={currentTrip.shape} stops={currentTrip.stops} />
    </div>
  );
}
