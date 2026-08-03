/**
 * Місток між трекером і `sessionStorage`-записом активної поїздки
 * (`core/trip-session.ts`). Один hook пише, другий читає.
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
  getTripSession,
  setTripSession,
  subscribeTripSession,
  type TripSession,
} from '../core/trip-session';
import type { TripTracker } from '../core/trip-tracker';

/** Тримає запис синхронним із трекером: старт поїздки — пишемо, стоп — стираємо. */
export function useTripSessionSync(tracker: TripTracker, tripId: string): void {
  useEffect(() => {
    // Пишемо лише на переходах. Інакше перший же виклик з `tracking: false`
    // стер би запис, заради якого все й затівалось — той, що лишився після kill.
    let wrote = false;
    const sync = () => {
      const { tracking } = tracker.getSnapshot();
      if (tracking === wrote) return;
      wrote = tracking;
      setTripSession(tracking ? { tripId, startedAt: Date.now() } : null);
    };

    sync();
    const unsubscribe = tracker.subscribe(sync);
    return () => {
      unsubscribe();
      // Пішли з екрана — трекер зупинено, поїздки більше немає.
      // А от kill застосунку сюди не доходить: запис лишається, і саме він
      // дає підставу спитати «продовжити поїздку?».
      if (wrote) setTripSession(null);
    };
  }, [tracker, tripId]);
}

export function useTripSession(): TripSession | null {
  return useSyncExternalStore(subscribeTripSession, getTripSession);
}
