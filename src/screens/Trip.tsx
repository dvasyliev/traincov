import { Map } from '../components/Map';
import type { RouteState } from '../data/route-bundle';
import { formatTime } from '../data/route-bundle';

export function Trip({ route }: { route: RouteState }) {
  if (route.status !== 'ready') {
    return (
      <div className="screen screen--padded">
        <p className="hint">
          {route.status === 'loading' ? 'Завантаження маршруту…' : route.message}
        </p>
      </div>
    );
  }

  const { bundle } = route;

  return (
    <div className="screen screen--full">
      <header className="trip-header">
        <span className="trip-header__badge">{bundle.carrier}</span>
        <span className="trip-header__title">{bundle.name}</span>
        <span className="trip-header__meta">
          {formatTime(bundle.stops[0].dep)} · {bundle.lengthKm} км
        </span>
      </header>
      <Map route={bundle.shape} stops={bundle.stops} />
    </div>
  );
}
