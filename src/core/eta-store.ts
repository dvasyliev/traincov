/**
 * Прогноз як зовнішній стор — тим самим способом, що й `trip-tracker.ts`.
 *
 * Політика перерахунку (задача 06): важкий `computeTripEta` крутиться на подію
 * трекера, тобто фактично на GPS-фікс. Секундний тік у хедері лише віднімає
 * `etaIn - now`, а стрічка читає той самий результат раз на 10 c — тому
 * підписка мусить бути окремою від React-дерева екрана.
 */
import { computeTripEta, type EtaResult } from './eta';
import type { TripTracker } from './trip-tracker';

/** Розклад-only не має джерела подій: без цього мітки застигли б назавжди. */
const SCHEDULE_REFRESH_MS = 10_000;

export interface EtaStore {
  getResult(): EtaResult | null;
  subscribe(listener: () => void): () => void;
  /** «Зараз» у шкалі трекера: у симуляторі час віртуальний. */
  now(): number;
  start(): void;
  stop(): void;
}

export function createEtaStore(tracker: TripTracker): EtaStore {
  const listeners = new Set<() => void>();

  let result: EtaResult | null = null;
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  /** Зона з попереднього розрахунку — вхід для гістерезису на межах. */
  let prevZoneId: string | null = null;
  let computedAt = 0;

  const recompute = () => {
    const snapshot = tracker.getSnapshot();
    const now = tracker.now();
    // Поза маршрутом (і без дозволу) км — сміття: чесніше показати розклад.
    const km =
      snapshot.tracking && snapshot.status !== 'off-route' && snapshot.status !== 'denied'
        ? snapshot.km
        : null;

    result = computeTripEta({
      bundle: tracker.bundle,
      now,
      km,
      speedKmh: snapshot.speedKmh,
      confidence: snapshot.confidence,
      stopped: snapshot.status === 'stopped',
      stoppedSince: snapshot.stoppedSince,
      prevZoneId,
    });
    prevZoneId = result?.inZone?.zone.id ?? null;
    computedAt = now;
    for (const listener of listeners) listener();
  };

  return {
    getResult: () => result,

    now: () => tracker.now(),

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (unsubscribe) return;
      recompute();
      unsubscribe = tracker.subscribe(recompute);
      timer = setInterval(() => {
        // Живий режим перераховується на фіксах; таймер потрібен лише розкладу.
        if (result !== null && result.source !== 'plan') return;
        if (tracker.now() - computedAt < SCHEDULE_REFRESH_MS) return;
        recompute();
      }, SCHEDULE_REFRESH_MS);
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
