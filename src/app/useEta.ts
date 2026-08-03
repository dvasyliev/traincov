/**
 * Місток прогнозу з React.
 *
 * Стор один на поїздку, а підписуються на нього різні вузли з різною частотою:
 * хедер — щосекунди (там лічильник), стрічка — раз на 10 c. Екран поїздки при
 * цьому не ререндериться взагалі, як і на задачі 04.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createEtaStore, type EtaStore } from '../core/eta-store';
import { etaState, type EtaState } from '../core/eta-status';
import type { EtaResult } from '../core/eta';
import type { TripTracker } from '../core/trip-tracker';

const TICK_MS = 1000;

export function useEtaStore(tracker: TripTracker): EtaStore {
  const store = useMemo(() => createEtaStore(tracker), [tracker]);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return store;
}

export function useEtaResult(store: EtaStore): EtaResult | null {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(subscribe, store.getResult);
}

/** Стан хедера. Тікає щосекунди — тому викликати тільки в маленькому вузлі. */
export function useEtaState(store: EtaStore): EtaState {
  const result = useEtaResult(store);
  const [now, setNow] = useState(() => store.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(store.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [store]);

  return useMemo(() => etaState(result, now), [result, now]);
}
