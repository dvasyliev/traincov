/**
 * Джерело позицій. Один інтерфейс для реального GPS і для симулятора,
 * щоб трекер (і весь UI) не знали, звідки взялись фікси.
 */

export interface GeoFix {
  ts: number;
  lat: number;
  lng: number;
  accuracyM: number;
  /** `coords.speed`, м/с; `null` — пристрій не дає. */
  speedMs: number | null;
}

export type GeoFailureKind = 'permission' | 'unavailable';

export interface GeoFailure {
  kind: GeoFailureKind;
  message: string;
  /** `true` — далі чекати нема сенсу, трекінг зупиняємо. */
  fatal: boolean;
}

export interface GeoSource {
  readonly kind: 'real' | 'simulated';
  /**
   * «Зараз» у тій самій шкалі, що й `GeoFix.ts`.
   * У симуляторі час віртуальний і біжить швидше — інакше 30-секундне
   * протухання фіксів довелось би чекати по-справжньому.
   */
  now(): number;
  start(onFix: (fix: GeoFix) => void, onFailure: (failure: GeoFailure) => void): void;
  stop(): void;
}

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 3000,
  timeout: 15_000,
};

/** iOS Safari уміє «приспати» watchPosition — перезапускаємо його самі. */
const RESTART_AFTER_MS = 30_000;
const WATCHDOG_MS = 5_000;

export function createRealGeoSource(): GeoSource {
  let watchId: number | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let lastActivityTs = 0;
  let fixHandler: ((fix: GeoFix) => void) | null = null;
  let failureHandler: ((failure: GeoFailure) => void) | null = null;

  const clearWatch = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  };

  const beginWatch = () => {
    lastActivityTs = Date.now();
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastActivityTs = Date.now();
        fixHandler?.({
          ts: pos.timestamp,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          speedMs: pos.coords.speed,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          clearWatch();
          failureHandler?.({
            kind: 'permission',
            message: 'Доступ до геолокації заборонено',
            fatal: true,
          });
          return;
        }
        // TIMEOUT — нормальна ситуація в дорозі, просто чекаємо наступний фікс.
        if (err.code === err.POSITION_UNAVAILABLE) {
          lastActivityTs = Date.now();
          failureHandler?.({
            kind: 'unavailable',
            message: 'Позиція недоступна',
            fatal: false,
          });
        }
      },
      WATCH_OPTIONS,
    );
  };

  const restartIfStale = () => {
    if (watchId === null) return;
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastActivityTs < RESTART_AFTER_MS) return;
    clearWatch();
    beginWatch();
  };

  return {
    kind: 'real',
    now: () => Date.now(),

    start(onFix, onFailure) {
      fixHandler = onFix;
      failureHandler = onFailure;
      if (!('geolocation' in navigator)) {
        onFailure({ kind: 'unavailable', message: 'Браузер не має геолокації', fatal: true });
        return;
      }
      beginWatch();
      watchdog = setInterval(restartIfStale, WATCHDOG_MS);
      document.addEventListener('visibilitychange', restartIfStale);
    },

    stop() {
      clearWatch();
      if (watchdog !== null) clearInterval(watchdog);
      watchdog = null;
      document.removeEventListener('visibilitychange', restartIfStale);
      fixHandler = null;
      failureHandler = null;
    },
  };
}
