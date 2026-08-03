import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { TripIndexEntry } from '../core/types';
import { isOperatorId, type OperatorId } from '../core/operators';
import {
  clearStoredBundles,
  getSetting,
  getStoredBundle,
  listSavedTrips,
  pruneStoredBundles,
  setSetting,
  storeBundle,
} from '../core/db';
import { loadRouteBundle } from '../data/route-bundle';
import { cachedDataVersion } from '../data/trip-index';
import type { Screen } from './screens';
import {
  AppActionsContext,
  AppStateContext,
  appReducer,
  initialAppState,
  type AppActions,
} from './app-state';

const OFFLINE_MESSAGE = "Немає з'єднання. Пакет треба завантажити до поїздки.";
const TOAST_MS = 5000;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);

  // Відновлення стану: оператор + останній рейс, якщо його бандл ще в Dexie.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Спершу прибрати бандли старого формату, потім читати список збережених.
        await pruneStoredBundles().catch(() => 0);
        const [operator, lastTripId, saved] = await Promise.all([
          getSetting('operator'),
          getSetting('lastTripId'),
          listSavedTrips(),
        ]);
        const trip =
          typeof lastTripId === 'string' ? ((await getStoredBundle(lastTripId)) ?? null) : null;
        if (!cancelled) {
          dispatch({
            type: 'hydrated',
            operator: isOperatorId(operator) ? operator : null,
            trip,
            saved,
          });
        }
      } catch {
        // IndexedDB недоступний (приватний режим Safari) — працюємо без збереження.
        if (!cancelled) dispatch({ type: 'hydrated', operator: null, trip: null, saved: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    const timer = setTimeout(() => dispatch({ type: 'toast', message: null }), TOAST_MS);
    return () => clearTimeout(timer);
  }, [state.toast]);

  const setOperator = useCallback((operator: OperatorId) => {
    dispatch({ type: 'operator', operator });
    void setSetting('operator', operator).catch(() => {});
  }, []);

  const setScreen = useCallback((screen: Screen) => dispatch({ type: 'screen', screen }), []);

  const selectTrip = useCallback(async (entry: TripIndexEntry, options?: { force?: boolean }) => {
    dispatch({ type: 'select-start', tripId: entry.tripId });
    try {
      // Спершу Dexie: повторний вибір рейсу має працювати в airplane mode.
      // Але лише якщо копія тієї ж версії, що й поточний index.json.
      const dataVersion = cachedDataVersion();
      let bundle = options?.force
        ? undefined
        : await getStoredBundle(entry.tripId, dataVersion).catch(() => undefined);
      if (!bundle) {
        bundle = await loadRouteBundle(entry.file);
        // QuotaExceededError на iOS: пакет уже в пам'яті, поїздка поїде,
        // офлайну для нього просто не буде — і про це скаже відсутній бейдж.
        await storeBundle(bundle, dataVersion, entry).catch(() => {});
      }
      await setSetting('lastTripId', entry.tripId).catch(() => {});
      const saved = await listSavedTrips().catch(() => []);
      dispatch({ type: 'select-done', bundle, screen: 'trip', saved });
    } catch (err) {
      const message = navigator.onLine
        ? `Не вдалося завантажити пакет: ${err instanceof Error ? err.message : String(err)}`
        : OFFLINE_MESSAGE;
      dispatch({ type: 'select-fail', message });
    }
  }, []);

  const openCurrentTrip = useCallback(() => dispatch({ type: 'screen', screen: 'trip' }), []);

  const clearBundles = useCallback(async () => {
    await clearStoredBundles();
    dispatch({ type: 'bundles-cleared' });
    dispatch({ type: 'toast', message: 'Збережені пакети видалено.' });
  }, []);

  const dismissToast = useCallback(() => dispatch({ type: 'toast', message: null }), []);

  const actions = useMemo<AppActions>(
    () => ({ setOperator, setScreen, selectTrip, openCurrentTrip, clearBundles, dismissToast }),
    [setOperator, setScreen, selectTrip, openCurrentTrip, clearBundles, dismissToast],
  );

  return (
    <AppStateContext.Provider value={state}>
      <AppActionsContext.Provider value={actions}>{children}</AppActionsContext.Provider>
    </AppStateContext.Provider>
  );
}
