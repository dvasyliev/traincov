import { useEffect, useState } from 'react';
import type { RouteBundle, TripIndex, TripIndexEntry } from '../core/types';

/** `public/data/**` віддається статикою; BASE_URL — щоб пережити деплой у підкаталог. */
const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(relativePath: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}${relativePath}`);
  if (!res.ok) throw new Error(`${relativePath}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const loadTripIndex = () => getJson<TripIndex>('index.json');
export const loadRouteBundle = (file: string) => getJson<RouteBundle>(file);

export type RouteState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; index: TripIndex; entry: TripIndexEntry; bundle: RouteBundle };

/**
 * Задача 02 показує один рейс. Беремо перший із index.json, а не зашитий tripId:
 * trip_id у GTFS змінюються з кожним оновленням фіда, і хардкод ламався б
 * після кожного `npm run pipeline`. Вибір рейсу зʼявиться в задачі 03.
 */
export function useRouteBundle(): RouteState {
  const [state, setState] = useState<RouteState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const index = await loadTripIndex();
        const entry = index.trips[0];
        if (!entry) throw new Error('index.json порожній — запусти `npm run pipeline`');
        const bundle = await loadRouteBundle(entry.file);
        if (!cancelled) setState({ status: 'ready', index, entry, bundle });
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/** `14:35:00` → `14:35`; години ≥ 24 лишаємо як є (рейс перетинає північ). */
export function formatTime(time: string | null): string {
  return time ? time.slice(0, 5) : '—';
}
