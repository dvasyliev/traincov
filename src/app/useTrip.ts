/**
 * Місток між трекером (звичайний JS-стор) і React.
 *
 * Два способи читати стан:
 * - `useTripSnapshot` — звичайна підписка, ререндер компонента на кожен фікс.
 *   Тільки для маленьких вузлів (хедер).
 * - `useTripUpdates` — імперативний колбек без ререндера. Для стрічки й карти.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createRealGeoSource } from '../core/geo-source';
import { createSimulatedGeoSource, parseSimOptions } from '../core/simulator';
import { createTripTracker, type TripSnapshot, type TripTracker } from '../core/trip-tracker';
import type { RouteBundle } from '../core/types';

/** `?sim=1` читаємо один раз: перемикати режим на льоту немає сенсу. */
export const SIM_OPTIONS = parseSimOptions(window.location.search);

export function useTripTracker(bundle: RouteBundle): TripTracker {
  const tracker = useMemo(() => {
    const source = SIM_OPTIONS
      ? createSimulatedGeoSource(bundle, SIM_OPTIONS)
      : createRealGeoSource();
    return createTripTracker(bundle, source);
  }, [bundle]);

  // Пішли з екрана — watchPosition треба зняти, інакше він мовчки їсть батарею.
  useEffect(() => () => tracker.stop(), [tracker]);

  return tracker;
}

export function useTripSnapshot(tracker: TripTracker): TripSnapshot {
  const subscribe = useCallback((listener: () => void) => tracker.subscribe(listener), [tracker]);
  return useSyncExternalStore(subscribe, tracker.getSnapshot);
}

/** Підписка без ререндера: колбек отримує кожен новий знімок стану. */
export function useTripUpdates(tracker: TripTracker, onUpdate: (snapshot: TripSnapshot) => void) {
  const handler = useRef(onUpdate);
  handler.current = onUpdate;

  useEffect(() => {
    handler.current(tracker.getSnapshot());
    return tracker.subscribe(() => handler.current(tracker.getSnapshot()));
  }, [tracker]);
}
