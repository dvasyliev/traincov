import { useMemo, useState } from 'react';
import { useAppActions, useAppState } from '../app/app-state';
import { OperatorPicker } from '../components/OperatorPicker';
import { TripCard } from '../components/TripCard';
import { formatKm, formatTime } from '../core/format';
import { groupByDirection, matchesQuery, sortByDeparture } from '../core/trip-search';
import { useTripIndex } from '../data/trip-index';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import type { TripIndexEntry } from '../core/types';

export function Home() {
  const { operator, currentTrip, savedTripIds, loadingTripId, hydrated } = useAppState();
  const { setOperator, selectTrip, openCurrentTrip } = useAppActions();
  const indexState = useTripIndex();
  const online = useOnlineStatus();
  const [query, setQuery] = useState('');

  const index = indexState.status === 'ready' ? indexState.index : null;

  const matches = useMemo(
    () => (index ? sortByDeparture(index.trips.filter((trip) => matchesQuery(trip, query))) : []),
    [index, query],
  );
  const groups = useMemo(() => groupByDirection(matches), [matches]);
  const isSearching = query.trim().length > 0;

  const renderCard = (entry: TripIndexEntry) => {
    const saved = savedTripIds.includes(entry.tripId);
    return (
      <TripCard
        key={entry.tripId}
        entry={entry}
        saved={saved}
        loading={loadingTripId === entry.tripId}
        unavailable={!online && !saved}
        current={currentTrip?.tripId === entry.tripId}
        onSelect={selectTrip}
      />
    );
  };

  return (
    <div className="screen screen--padded">
      <h1 className="title">TrainCov</h1>
      <p className="subtitle">Де і коли зникне інтернет у потязі</p>

      {!online && (
        <div className="banner banner--warn">
          Офлайн. Нові пакети завантажити не можна — доступні лише збережені рейси.
        </div>
      )}

      {hydrated && currentTrip && (
        <section className="card card--resume">
          <div className="card__label">Продовжити</div>
          <div className="card__value">{currentTrip.name}</div>
          <div className="card__meta">
            {formatTime(currentTrip.stops[0]?.dep ?? null)} · {formatKm(currentTrip.lengthKm)} ·{' '}
            {currentTrip.stops.length} зупинок
          </div>
          <button className="button" onClick={openCurrentTrip}>
            Відкрити маршрут
          </button>
        </section>
      )}

      <OperatorPicker value={operator} onChange={setOperator} />

      <section className="section">
        <h2 className="section__title">Рейс</h2>
        <input
          className="search"
          type="search"
          inputMode="search"
          placeholder="wroclaw warszawa, IC 1234…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Пошук рейсу"
        />

        {indexState.status === 'loading' && (
          <div className="skeleton-list" aria-hidden="true">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        )}

        {indexState.status === 'error' && (
          <div className="banner banner--error">
            Немає списку рейсів: {indexState.message}. Згенеруй бандли — <code>npm run pipeline</code>
            .
          </div>
        )}

        {index && matches.length === 0 && (
          <p className="hint">Нічого не знайдено. Спробуй назву станції або номер потяга.</p>
        )}

        {index &&
          matches.length > 0 &&
          (isSearching
            ? <div className="trip-list">{matches.map(renderCard)}</div>
            : groups.map((group) => (
                <div key={group.key} className="trip-group">
                  <h3 className="trip-group__title">{group.label}</h3>
                  <div className="trip-list">{group.trips.map(renderCard)}</div>
                </div>
              )))}
      </section>

      {index && (
        <footer className="attribution">
          {index.source} · розклад типового дня ({index.serviceDate}) · {index.trips.length} рейсів
        </footer>
      )}
    </div>
  );
}
