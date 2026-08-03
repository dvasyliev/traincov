/**
 * Стан поїздки живе ПОЗА React: фікси приходять кілька разів на секунду,
 * і ганяти через них увесь дерево компонентів немає сенсу.
 * Трекер — маленький зовнішній стор: `subscribe` + `getSnapshot`
 * (сумісний з `useSyncExternalStore`), а карта і стрічка ще й читають
 * оновлення імперативно, взагалі без ререндера.
 */
import { OFF_ROUTE_M, createRouteLocator, type RouteLocator } from './linref';
import { STALE_FIX_MS, createSpeedEstimator, type SpeedConfidence } from './speed';
import type { GeoSource } from './geo-source';
import type { RouteBundle } from './types';

export type TripStatus =
  /** Трекінг не запущено. */
  | 'idle'
  /** Чекаємо перший фікс. */
  | 'acquiring'
  | 'moving'
  | 'stopped'
  /** Далі як OFF_ROUTE_M від колії. */
  | 'off-route'
  /** Фіксів немає довше STALE_FIX_MS — тунель або небо закрите. */
  | 'no-gps'
  /** Дозвіл на геолокацію не дали. */
  | 'denied';

export interface TripSnapshot {
  tracking: boolean;
  status: TripStatus;
  km: number | null;
  /**
   * `true` — км не з GPS, а порахований dead reckoning'ом (тунель).
   * Саме в дірі користувач дивиться на екран найпильніше, тож рух маркера
   * там важливіший за формальну точність — але позначка обов'язкова.
   */
  kmEstimated: boolean;
  speedKmh: number | null;
  confidence: SpeedConfidence;
  /** Відколи стоїмо, ms epoch — прогноз віднімає це від планової стоянки. */
  stoppedSince: number | null;
  offsetM: number | null;
  /** Точка на колії — саме її показує карта. */
  snapped: [number, number] | null;
  /**
   * Сирий фікс, як його дав GPS. Карті він не потрібен (вона малює `snapped`),
   * а логеру замірів — так: у файл має їхати те, що виміряв приймач, а не те,
   * що з нього вийшло після проєкції на колію.
   */
  fix: { lat: number; lng: number; accuracyM: number } | null;
  lastFixTs: number | null;
  error: string | null;
  simulated: boolean;
}

export interface TripTracker {
  readonly bundle: RouteBundle;
  readonly locator: RouteLocator;
  /** «Зараз» у шкалі фіксів: у симуляторі час віртуальний. */
  now(): number;
  getSnapshot(): TripSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
}

/** Раз на секунду перевіряємо, чи фікси не протухли (нових подій при цьому немає). */
const TICK_MS = 1000;

function idleSnapshot(simulated: boolean): TripSnapshot {
  return {
    tracking: false,
    status: 'idle',
    km: null,
    kmEstimated: false,
    speedKmh: null,
    confidence: 'none',
    stoppedSince: null,
    offsetM: null,
    snapped: null,
    fix: null,
    lastFixTs: null,
    error: null,
    simulated,
  };
}

function same(a: TripSnapshot, b: TripSnapshot): boolean {
  return (
    a.tracking === b.tracking &&
    a.status === b.status &&
    a.km === b.km &&
    a.kmEstimated === b.kmEstimated &&
    a.speedKmh === b.speedKmh &&
    a.confidence === b.confidence &&
    a.stoppedSince === b.stoppedSince &&
    a.offsetM === b.offsetM &&
    a.fix === b.fix &&
    a.lastFixTs === b.lastFixTs &&
    a.error === b.error
  );
}

export function createTripTracker(bundle: RouteBundle, source: GeoSource): TripTracker {
  const locator = createRouteLocator(bundle.shape);
  const speed = createSpeedEstimator();
  const listeners = new Set<() => void>();

  let snapshot = idleSnapshot(source.kind === 'simulated');
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  /** Момент останнього кроку dead reckoning — щоб не інтегрувати той самий Δt двічі. */
  let reckonedAt: number | null = null;

  const publish = (next: TripSnapshot) => {
    if (same(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const statusOf = (draft: Omit<TripSnapshot, 'status'>): TripStatus => {
    if (!draft.tracking) return 'idle';
    if (draft.error) return 'denied';
    if (draft.lastFixTs === null) return 'acquiring';
    if (draft.offsetM !== null && draft.offsetM > OFF_ROUTE_M) return 'off-route';
    if (source.now() - draft.lastFixTs > STALE_FIX_MS) return 'no-gps';
    return speed.state(source.now()).stopped ? 'stopped' : 'moving';
  };

  const commit = (draft: Omit<TripSnapshot, 'status'>) => {
    publish({ ...draft, status: statusOf(draft) });
  };

  const onFix = (fix: { ts: number; lat: number; lng: number; accuracyM: number; speedMs: number | null }) => {
    const position = locator.locate(fix.lng, fix.lat);
    const offRoute = position.offsetM > OFF_ROUTE_M;

    // Поза маршрутом км — сміття: годувати ним оцінювач швидкості не можна.
    const speedState = offRoute
      ? speed.state(source.now())
      : speed.push({
          ts: fix.ts,
          km: position.km,
          gpsSpeedMs: fix.speedMs,
          accuracyM: fix.accuracyM,
        });

    reckonedAt = null;
    commit({
      tracking: true,
      km: position.km,
      kmEstimated: false,
      speedKmh: speedState.speedKmh,
      confidence: speedState.confidence,
      stoppedSince: speedState.stoppedSince,
      offsetM: Math.round(position.offsetM),
      snapped: position.snapped,
      fix: { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM },
      lastFixTs: fix.ts,
      error: null,
      simulated: snapshot.simulated,
    });
  };

  const tick = () => {
    if (!started) return;
    const now = source.now();
    const speedState = speed.state(now);

    // Dead reckoning: фіксів немає (тунель), але потяг їде. Рухаємо км за
    // останньою відомою швидкістю — інакше в дірі екран просто завмирає.
    let km = snapshot.km;
    let snapped = snapshot.snapped;
    let kmEstimated = snapshot.kmEstimated;
    const stale = snapshot.lastFixTs !== null && now - snapshot.lastFixTs > STALE_FIX_MS;
    const kmh = speedState.speedKmh;

    if (stale && km !== null && kmh !== null && kmh > 0 && !speedState.stopped) {
      const from = reckonedAt ?? snapshot.lastFixTs ?? now;
      km = Math.min(bundle.lengthKm, km + (kmh * (now - from)) / 3_600_000);
      snapped = locator.coordinateAt(km);
      kmEstimated = true;
    }
    reckonedAt = now;

    commit({
      tracking: true,
      km,
      kmEstimated,
      speedKmh: speedState.speedKmh,
      confidence: speedState.confidence,
      stoppedSince: speedState.stoppedSince,
      offsetM: snapshot.offsetM,
      snapped,
      // Фікси протухли — координат більше немає. Саме така «діра з км, але без
      // GPS» і є найціннішим рядком у логу замірів.
      fix: stale ? null : snapshot.fix,
      lastFixTs: snapshot.lastFixTs,
      error: snapshot.error,
      simulated: snapshot.simulated,
    });
  };

  return {
    bundle,
    locator,

    now: () => source.now(),

    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (started) return;
      started = true;
      locator.reset();
      speed.reset();
      reckonedAt = null;
      commit({ ...idleSnapshot(snapshot.simulated), tracking: true });
      // Таймер заводимо ДО source.start: відмова може прийти синхронно
      // (немає geolocation узагалі) і має мати що прибирати.
      timer = setInterval(tick, TICK_MS);
      source.start(onFix, (failure) => {
        if (!failure.fatal) return;
        started = false;
        source.stop();
        if (timer !== null) clearInterval(timer);
        timer = null;
        publish({ ...snapshot, tracking: false, status: 'denied', error: failure.message });
      });
    },

    stop() {
      if (!started) return;
      started = false;
      source.stop();
      if (timer !== null) clearInterval(timer);
      timer = null;
      publish(idleSnapshot(snapshot.simulated));
    },
  };
}
