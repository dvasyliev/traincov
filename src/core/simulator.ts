/**
 * Симулятор поїздки: рухає «потяг» по shape зі швидкістю з розкладу.
 * Без нього кожен баг трекінгу довелось би ловити в реальному потязі.
 *
 * Вмикається `?sim=1` (плюс `&simScale=` і `&simKm=`).
 */
import { createRouteLocator } from './linref';
import type { GeoFix, GeoSource } from './geo-source';
import type { RouteBundle, RouteStop } from './types';

export interface SimOptions {
  /** У скільки разів віртуальний час швидший за реальний. */
  scale: number;
  /** Стартовий км — щоб не чекати пів маршруту до цікавого місця. */
  startKm: number;
}

/** Крок віртуального часу між фіксами. */
const FIX_STEP_MS = 2_000;
/** Реальний інтервал таймера не робимо коротшим — 20 тіків/с ніхто не побачить. */
const MIN_REAL_INTERVAL_MS = 100;
const DEFAULT_SCALE = 10;
const MAX_SCALE = 20;
/**
 * Стоянка на станції: беремо з розкладу (arr → dep), але не коротшу за це.
 * EMA-швидкість спадає до «стоїмо» приблизно за хвилину, тож коротша стоянка
 * просто не встигла б проявитись у статусі.
 */
const MIN_DWELL_MS = 120_000;
/** Гаусів шум GPS. */
const NOISE_SIGMA_M = 15;
const METERS_PER_DEG_LAT = 111_320;

/** Синтетична «діра» без GPS, якщо мертвих зон ще немає (вони — задача 05). */
const FALLBACK_HOLE_AT = 0.4;
const FALLBACK_HOLE_KM = 3;

export function parseSimOptions(search: string): SimOptions | null {
  const params = new URLSearchParams(search);
  if (params.get('sim') !== '1') return null;
  const scale = Number(params.get('simScale'));
  const startKm = Number(params.get('simKm'));
  return {
    scale: Number.isFinite(scale) && scale > 0 ? Math.min(scale, MAX_SCALE) : DEFAULT_SCALE,
    startKm: Number.isFinite(startKm) && startKm > 0 ? startKm : 0,
  };
}

/** Ділянка, на якій симулятор перестає віддавати фікси (перевірка стану «немає GPS»). */
export function simulatedGpsHole(bundle: RouteBundle): { fromKm: number; toKm: number } {
  const zone = bundle.deadZones[0];
  if (zone) return { fromKm: zone.fromKm, toKm: zone.toKm };
  const from = bundle.lengthKm * FALLBACK_HOLE_AT;
  return { fromKm: from, toKm: Math.min(from + FALLBACK_HOLE_KM, bundle.lengthKm) };
}

/** `06:38:00` → секунди від опівночі; години ≥ 24 допустимі. */
function gtfsSeconds(time: string | null): number | null {
  if (!time) return null;
  const [h, m, s] = time.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 3600 + m * 60 + (s || 0) : null;
}

function dwellMs(stop: RouteStop): number {
  const arr = gtfsSeconds(stop.arr);
  const dep = gtfsSeconds(stop.dep);
  const scheduled = arr !== null && dep !== null && dep > arr ? (dep - arr) * 1000 : 0;
  return Math.max(MIN_DWELL_MS, scheduled);
}

function gaussian(): number {
  // Box–Muller; Math.random() ніколи не 0 у знаменнику логарифма.
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function createSimulatedGeoSource(bundle: RouteBundle, options: SimOptions): GeoSource {
  const locator = createRouteLocator(bundle.shape);
  const hole = simulatedGpsHole(bundle);
  const realInterval = Math.max(MIN_REAL_INTERVAL_MS, Math.round(FIX_STEP_MS / options.scale));

  let timer: ReturnType<typeof setInterval> | null = null;
  let virtualNow = Date.now();
  let km = Math.min(options.startKm, bundle.lengthKm);
  let dwellUntil = 0;
  // Станції позаду стартового км уже «проїхали» — на них не зупиняємось.
  let nextStop = bundle.stops.findIndex((s) => s.km > km);

  const scheduledKmh = (atKm: number): number => {
    const segment = bundle.speedProfile.find((s) => atKm >= s.fromKm && atKm < s.toKm);
    return segment?.kmh ?? bundle.speedProfile[bundle.speedProfile.length - 1]?.kmh ?? 80;
  };

  const step = (): { kmh: number } => {
    virtualNow += FIX_STEP_MS;
    if (virtualNow < dwellUntil) return { kmh: 0 };
    if (km >= bundle.lengthKm) return { kmh: 0 };

    const kmh = scheduledKmh(km);
    const advanced = km + (kmh * FIX_STEP_MS) / 3_600_000;
    const stop = nextStop >= 0 ? bundle.stops[nextStop] : undefined;

    if (stop && advanced >= stop.km) {
      km = stop.km;
      dwellUntil = virtualNow + dwellMs(stop);
      nextStop = nextStop + 1 < bundle.stops.length ? nextStop + 1 : -1;
      return { kmh: 0 };
    }

    km = Math.min(advanced, bundle.lengthKm);
    return { kmh };
  };

  const fixAt = (kmh: number): GeoFix => {
    const [lng, lat] = locator.coordinateAt(km);
    const dLat = (gaussian() * NOISE_SIGMA_M) / METERS_PER_DEG_LAT;
    const dLng =
      (gaussian() * NOISE_SIGMA_M) /
      (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || METERS_PER_DEG_LAT);
    return {
      ts: virtualNow,
      lat: lat + dLat,
      lng: lng + dLng,
      accuracyM: 8 + Math.random() * 12,
      speedMs: kmh / 3.6,
    };
  };

  return {
    kind: 'simulated',
    now: () => virtualNow,

    start(onFix) {
      virtualNow = Date.now();
      timer = setInterval(() => {
        const { kmh } = step();
        // У «тунелі» GPS зникає разом зі зв'язком — фіксів просто немає.
        if (km >= hole.fromKm && km <= hole.toKm) return;
        onFix(fixAt(kmh));
      }, realInterval);
    },

    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
