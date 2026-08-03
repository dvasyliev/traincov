/**
 * Планувальник замірів: раз на ~10 c зондує мережу і збирає рядок логу
 * з поточного стану трекера.
 *
 * Зовнішній стор тим самим способом, що `trip-tracker.ts` і `eta-store.ts`:
 * лічильник у хедері підписується на нього, а екран поїздки не ререндериться.
 *
 * Куди писати рядок — вирішує той, хто створює логер (`onMeasurement`).
 * Так модуль не залежить від IndexedDB і перевіряється звичайним тестом.
 */
import { buildMeasurement, measurementQuality, type Measurement, type MeasurementContext, type ProbeQuality } from './measurements';
import { probe as defaultProbe, PROBE_TIMEOUT_MS, type ProbeResult } from './probe';
import type { TripTracker } from './trip-tracker';

export const PROBE_INTERVAL_MS = 10_000;
/** Джиттер ±2 c: інакше всі клієнти сходяться в одну секунду з чужими періодичностями. */
export const PROBE_JITTER_MS = 2_000;
/** Перший замір робимо швидко — «лічильник не рухається» читається як поламаний логер. */
const FIRST_PROBE_MS = 1_000;

export interface LoggerSnapshot {
  running: boolean;
  sessionId: string | null;
  count: number;
  deadCount: number;
  last: { ts: number; quality: ProbeQuality; rttMs: number | null } | null;
}

const IDLE: LoggerSnapshot = {
  running: false,
  sessionId: null,
  count: 0,
  deadCount: 0,
  last: null,
};

export interface ProbeLoggerDeps {
  tracker: TripTracker;
  onMeasurement: (measurement: Measurement) => void;
  /** Підміняється в тестах. */
  probe?: (timeoutMs?: number) => Promise<ProbeResult>;
  /** У фоні таймери тротляться, а probe міряв би не мережу, а політику браузера. */
  visible?: () => boolean;
  random?: () => number;
}

export interface ProbeLogger {
  getSnapshot(): LoggerSnapshot;
  subscribe(listener: () => void): () => void;
  start(context: MeasurementContext): void;
  stop(): void;
}

/** `navigator.connection` є лише в Chrome/Android — решті чесно пишемо `null`. */
function effectiveType(): string | null {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } })
    .connection;
  return connection?.effectiveType ?? null;
}

export function createProbeLogger(deps: ProbeLoggerDeps): ProbeLogger {
  const { tracker, onMeasurement } = deps;
  const runProbe = deps.probe ?? defaultProbe;
  const isVisible = deps.visible ?? (() => document.visibilityState === 'visible');
  const random = deps.random ?? Math.random;

  const listeners = new Set<() => void>();
  let snapshot: LoggerSnapshot = IDLE;
  let context: MeasurementContext | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publish = (next: LoggerSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  /**
   * Коли замір має сенс. Поза маршрутом і без дозволу писати не можна: км там
   * сміття, а сміття в даних гірше за їх відсутність — воно виглядає як факт.
   */
  const measurable = () => {
    const trip = tracker.getSnapshot();
    if (!trip.tracking) return null;
    if (trip.status === 'off-route' || trip.status === 'denied') return null;
    if (trip.km === null) return null;
    return trip;
  };

  const delay = () => PROBE_INTERVAL_MS + (random() * 2 - 1) * PROBE_JITTER_MS;

  const schedule = (ms: number) => {
    timer = setTimeout(() => {
      timer = null;
      void cycle();
    }, ms);
  };

  const cycle = async () => {
    if (!context) return;
    try {
      if (isVisible() && measurable()) await measure();
    } finally {
      if (context) schedule(delay());
    }
  };

  const measure = async () => {
    const result = await runProbe(PROBE_TIMEOUT_MS);
    // Стан міг змінитися за ті секунди, поки чекали на відповідь.
    const trip = measurable();
    if (!context || !trip) return;

    const measurement = buildMeasurement(context, {
      ts: result.ts,
      lat: trip.fix?.lat ?? null,
      lng: trip.fix?.lng ?? null,
      acc: trip.fix ? Math.round(trip.fix.accuracyM) : null,
      km: trip.km,
      kmEstimated: trip.kmEstimated,
      probeOk: result.ok,
      probeRttMs: result.rttMs,
      effectiveType: effectiveType(),
    });

    onMeasurement(measurement);

    const quality = measurementQuality(result.ok, result.rttMs);
    publish({
      running: true,
      sessionId: context.sessionId,
      count: snapshot.count + 1,
      deadCount: snapshot.deadCount + (quality === 'dead' ? 1 : 0),
      last: { ts: result.ts, quality, rttMs: result.rttMs },
    });
  };

  const stop = () => {
    context = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (snapshot.running) publish({ ...snapshot, running: false });
  };

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start(next) {
      if (context?.sessionId === next.sessionId) {
        context = next;
        return;
      }
      stop();
      context = next;
      // Лічильник починається з нуля — це лічильник ЦЬОГО заходу на екран,
      // а не сесії; повну цифру показує екран логера, читаючи Dexie.
      publish({ ...IDLE, running: true, sessionId: next.sessionId });
      schedule(FIRST_PROBE_MS);
    },

    stop,
  };
}
