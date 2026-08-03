import type { RouteState } from '../data/route-bundle';
import { formatTime } from '../data/route-bundle';

export function Home({ route, onOpenTrip }: { route: RouteState; onOpenTrip: () => void }) {
  if (route.status === 'loading') {
    return (
      <div className="screen screen--padded">
        <h1 className="title">TrainCov</h1>
        <p className="subtitle">Завантаження рейсів…</p>
      </div>
    );
  }

  if (route.status === 'error') {
    return (
      <div className="screen screen--padded">
        <h1 className="title">TrainCov</h1>
        <p className="subtitle">Немає даних маршрутів</p>
        <section className="card">
          <div className="card__label">Помилка</div>
          <div className="card__meta">{route.message}</div>
          <div className="card__meta">
            Згенеруй бандли: <code>npm run pipeline</code>
          </div>
        </section>
      </div>
    );
  }

  const { index, bundle } = route;
  const last = bundle.stops[bundle.stops.length - 1];

  return (
    <div className="screen screen--padded">
      <h1 className="title">TrainCov</h1>
      <p className="subtitle">Де і коли зникне інтернет у потязі</p>

      <section className="card">
        <div className="card__label">
          {bundle.carrierName} · розклад на {index.serviceDate}
        </div>
        <div className="card__value">{bundle.name}</div>
        <div className="card__meta">
          {formatTime(bundle.stops[0].dep)} → {formatTime(last.arr)} · {bundle.lengthKm} км ·{' '}
          {bundle.stops.length} зупинок · {bundle.shape.geometry.coordinates.length} точок геометрії
        </div>
        <button className="button" onClick={onOpenTrip}>
          Відкрити маршрут
        </button>
      </section>

      <p className="hint">
        Задача 02: реальні дані GTFS. У пакеті {index.trips.length} рейсів; вибір рейсу — задача 03,
        мертві зони — задача 05.
      </p>

      <footer className="attribution">{index.source}</footer>
    </div>
  );
}
