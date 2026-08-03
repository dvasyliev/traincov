/**
 * Місток логер ↔ React ↔ Dexie.
 *
 * Логер живе рівно стільки, скільки триває трекінг на екрані поїздки: probe
 * коштує трафік і батарею, і робити його «про всяк випадок» немає підстав.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { appendMeasurement, closeLogSession, openLogSession } from '../core/db';
import { createProbeLogger, type LoggerSnapshot } from '../core/probe-logger';
import type { TripTracker } from '../core/trip-tracker';
import type { OperatorId } from '../core/operators';

export function useProbeLogger(
  tracker: TripTracker,
  operator: OperatorId | null,
  enabled: boolean,
): LoggerSnapshot {
  const logger = useMemo(
    () =>
      createProbeLogger({
        tracker,
        // Помилка запису не має валити поїздку: екран важливіший за лог.
        onMeasurement: (measurement) => void appendMeasurement(measurement).catch(() => {}),
      }),
    [tracker],
  );

  useEffect(() => {
    let disposed = false;
    let active = false;

    const finish = () => {
      const { sessionId } = logger.getSnapshot();
      logger.stop();
      if (sessionId) void closeLogSession(sessionId).catch(() => {});
    };

    const sync = () => {
      const { tracking, simulated } = tracker.getSnapshot();
      const want = tracking && enabled;
      if (want === active) return;
      active = want;

      if (!want) {
        finish();
        return;
      }

      void (async () => {
        const session = await openLogSession(tracker.bundle, operator, simulated).catch(() => null);
        if (!session) return;
        // Поїздку могли спинити, поки Dexie відкривала сесію: тоді сесію треба
        // закрити тут, бо `finish` про неї ще не знав і бейдж «активна» завис би.
        if (disposed || !active) {
          void closeLogSession(session.id).catch(() => {});
          return;
        }
        logger.start({
          sessionId: session.id,
          tripId: session.tripId,
          operator,
          zones: session.zones,
        });
      })();
    };

    sync();
    const unsubscribe = tracker.subscribe(sync);
    return () => {
      disposed = true;
      unsubscribe();
      if (active) finish();
    };
  }, [tracker, logger, operator, enabled]);

  const subscribe = useCallback((listener: () => void) => logger.subscribe(listener), [logger]);
  return useSyncExternalStore(subscribe, logger.getSnapshot);
}
