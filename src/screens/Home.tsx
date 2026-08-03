import { demoRoute } from '../data/demo-route';

export function Home({ onOpenTrip }: { onOpenTrip: () => void }) {
  return (
    <div className="screen screen--padded">
      <h1 className="title">TrainCov</h1>
      <p className="subtitle">Де і коли зникне інтернет у потязі</p>

      <section className="card">
        <div className="card__label">Демо-рейс</div>
        <div className="card__value">{demoRoute.name}</div>
        <div className="card__meta">
          {demoRoute.stops.length} зупинок · {demoRoute.shape.geometry.coordinates.length} точок
          геометрії
        </div>
        <button className="button" onClick={onOpenTrip}>
          Відкрити маршрут
        </button>
      </section>

      <p className="hint">
        Задача 01: каркас і карта. Реальні рейси, GPS та мертві зони — у наступних задачах.
      </p>
    </div>
  );
}
