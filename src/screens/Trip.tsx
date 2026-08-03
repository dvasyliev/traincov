import { Map } from '../components/Map';
import { demoRoute } from '../data/demo-route';

export function Trip() {
  return (
    <div className="screen screen--full">
      <header className="trip-header">
        <span className="trip-header__badge">DEMO</span>
        <span className="trip-header__title">{demoRoute.name}</span>
      </header>
      <Map route={demoRoute.shape} stops={demoRoute.stops} />
    </div>
  );
}
