/**
 * Хедер екрана поїздки: великі цифри й керування трекінгом.
 * Єдиний компонент, який ререндериться на кожен GPS-фікс — тому й маленький.
 */
import { useTripSnapshot } from '../app/useTrip';
import { formatKm1 } from '../core/format';
import type { TripStatus, TripTracker } from '../core/trip-tracker';

const STATUS_LABEL: Record<TripStatus, string> = {
  idle: 'не в дорозі',
  acquiring: 'шукаємо GPS…',
  moving: 'їдемо',
  stopped: 'стоїмо',
  'off-route': 'не на маршруті',
  'no-gps': 'немає GPS',
  denied: 'немає дозволу',
};

const CONFIDENCE_NOTE: Record<string, string> = {
  derived: 'швидкість за треком',
  none: 'дані застаріли',
};

export function TripStatusBar({ tracker }: { tracker: TripTracker }) {
  const snapshot = useTripSnapshot(tracker);
  const { bundle } = tracker;
  const { km, kmEstimated, speedKmh, status, tracking, confidence, offsetM, simulated } = snapshot;

  const next = km === null ? undefined : bundle.stops.find((stop) => stop.km > km + 0.05);
  const note = tracking ? CONFIDENCE_NOTE[confidence] : undefined;

  return (
    <div className="trip-status">
      <div className="trip-status__main">
        <div className="trip-status__speed">
          <span className="trip-status__number">
            {speedKmh === null ? '—' : Math.round(speedKmh)}
          </span>
          <span className="trip-status__unit">км/год</span>
        </div>
        <div className="trip-status__km">
          <span
            className={`trip-status__number trip-status__number--small${
              kmEstimated ? ' trip-status__number--estimated' : ''
            }`}
          >
            {km === null ? '—' : formatKm1(km)}
          </span>
          <span className="trip-status__unit">із {formatKm1(bundle.lengthKm)} км</span>
        </div>
      </div>

      <div className="trip-status__row">
        <span className={`status-chip status-chip--${status}`}>{STATUS_LABEL[status]}</span>
        {note && <span className="trip-status__note">{note}</span>}
        {/* У тунелі км рахується dead reckoning'ом — це має бути видно. */}
        {kmEstimated && <span className="badge badge--muted">км — оцінка</span>}
        {simulated && <span className="badge badge--muted">симулятор</span>}
        {next && (
          <span className="trip-status__next">
            → {next.name}
            {km !== null && ` · ${formatKm1(next.km - km)} км`}
          </span>
        )}
      </div>

      {status === 'off-route' && (
        <div className="banner banner--warn">
          Ви за {offsetM} м від колії. Схоже, це не цей маршрут — км і швидкість зараз не мають
          сенсу.
        </div>
      )}
      {status === 'denied' && (
        <div className="banner banner--error">
          Дозволу на геолокацію немає. Увімкніть його для сайту в налаштуваннях браузера
          (iOS: Налаштування → Safari → Геопозиція; Chrome: 🔒 біля адреси → Дозволи) і спробуйте
          знову.
        </div>
      )}

      <button
        type="button"
        className={`button ${tracking ? 'button--danger' : ''}`}
        onClick={() => (tracking ? tracker.stop() : tracker.start())}
      >
        {tracking ? 'Завершити поїздку' : 'Почати поїздку'}
      </button>
    </div>
  );
}
